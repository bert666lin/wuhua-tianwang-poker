/**
 * 主游戏房间 - 天王扑克4人标准场
 * 
 * 游戏流程：
 * 1. 发牌（dealing）
 * 2. 叫主（calling_suit）- 选定主花色
 * 3. 叫分定庄（calling_score）- 确定庄家和叫分
 * 4. 庄家扣底（discarding）- 庄家将12张底牌扣下
 * 5. 出牌对局（playing）- 4人轮流出牌
 * 6. 剩牌结算（settling）- 有人先出完即停，庄家实际剩牌参与结算
 */

import { Room, Client, type RoomOptions } from '@colyseus/core';
import type { Delayed } from '@colyseus/timer';
import { GameState } from '../states/GameState.js';
import { PlayerState } from '../states/PlayerState.js';
import { CardSchema } from '../states/CardSchema.js';
import { TrickPlayState } from '../states/TrickPlayState.js';
import { AuctionEntryState, type AuctionKind } from '../states/AuctionEntryState.js';
import { GAME_CONFIG, GAME_MODES, GameModeConfig, Phase, CardData, Suit } from '../logic/config.js';
import { dealCards } from '../logic/deck.js';
import { dealAnimationMs } from '../logic/dealTiming.js';
import { isMainCard } from '../logic/compare.js';
import { resolveToss, type TossRejectReason } from '../logic/toss.js';
import { aiNameForSeat } from '../logic/aiNames.js';
import { isValidRoomCode, allocRoomCode } from './roomCode.js';
import { VoiceRateLimiter } from './voiceRate.js';
import { isFinalTrick as calcIsFinalTrick } from '../logic/trickProgress.js';
import { computeSettlement } from '../logic/settlement.js';
import { createFlowBreakDeltas } from '../logic/levels.js';
import { resolveOutcomeKind, type OutcomeKind } from '../logic/outcome.js';
import { RoundRecordState } from '../states/RoundRecordState.js';
import {
  checkScoreBid,
  checkSuitCall,
  currentBidCeiling,
  isAiBidUsable,
  isBiddingDone,
  requiredSevens as calcRequiredSevens,
  rotateFrom,
  suitFromFlippedCard,
} from '../logic/bidding.js';
import {
  createPlayRound,
  submitRoundPlay,
  type PlayRoundState,
  type RoundActionResult,
} from '../logic/round.js';
import { authByToken, adjustBalance, adjustBalanceClamped, addScore, recordRound, getById, spendRoomCard } from '../data/accounts.js';
import { calcRoundCoins, calcEscapePenalty, rankNameOf, tierOf, DEFAULT_TIER, type RoomTierId } from '../data/economy.js';
import {
  chooseAiBid,
  chooseAiDiscard,
  chooseAiPlay,
  chooseAiSuit,
  enumerateHintPlays,
  type AiPlayContext,
} from '../logic/ai.js';
import { removeAdminRoomParticipants, setAdminRoomParticipants } from './adminRoomParticipants.js';

// 定义房间选项类型，包含GameState
interface GameRoomOptions extends RoomOptions {
  state: GameState;
}

/**
 * 一片语音数据（客户端 -> 服务端）。
 * data 是 MediaRecorder 切出来的音频字节，服务端不解码，原样转发。
 */
interface VoiceChunkMessage {
  /** 容器 MIME（浏览器不同：webm/opus 或 mp4/aac），接收端要用它构造 Blob。 */
  mime?: string;
  /** 同一次按住的分片共享的会话 id。 */
  sessionId?: string;
  /** 分片序号。 */
  seq?: number;
  data?: Uint8Array;
}

export class GameRoom extends Room<GameRoomOptions> {
  private static activeCustomRoomIds = new Set<string>();
  maxClients = 4;

  /** 本房间使用的模式配置（人数、牌数、底牌数、叫分等）。 */
  private mode: GameModeConfig = GAME_MODES.fourPlayerTwoDecks;

  /**
   * 叫分起始分（= 基准分 / 满一级分）：两副牌125分，三副牌145分。
   * 叫分从基准分往下叫，谁叫得最低谁坐庄。
   */
  private get bidMax(): number {
    return this.mode.fullLevelScore;
  }

  // 内部状态（不同步给客户端）
  private hands: Map<string, CardData[]> = new Map(); // 玩家手牌（原始数据）
  private bottomCards: CardData[] = []; // 底牌
  /**
   * 庄家分批扣牌的暂存区：sessionId -> 已放进底牌区但还没提交的牌。
   *
   * 扣底要求一次交够 N 张（两副12/三副18），一次性从几十张里挑齐很痛苦。
   * 这里允许先放几张、再放几张，凑够张数才真正结算，中途还能取回。
   * 只在 Discarding 阶段有效，阶段结束/新一局必须清空。
   */
  private discardStaging: Map<string, CardData[]> = new Map();
  /**
   * 「提示」轮转游标：sessionId -> 已经看过几套方案。
   *
   * 玩家反复按提示时要给出**不同**的合规方案（按提示 -> 撤回 -> 再按提示），
   * 所以要记住上次给到第几套。轮到下一手牌 / 换阶段就必须清零，
   * 否则新的一手第一次按提示会直接跳到第 3 套去。
   */
  private hintCursor: Map<string, number> = new Map();
  /**
   * sessionId -> 账号 id。
   *
   * 结算要给真实账号发金币/记战绩，而 sessionId 每次连接都会变，
   * 所以入座时就把 token 认成账号存下来。没带 token 的（老客户端、
   * 未登录）不在这个表里，结算时跳过发币即可，不影响对局本身。
   */
  private accountBySession: Map<string, string> = new Map();
  /** 已罚过逃跑的 session，防止重复扣钱。 */
  private escapedSessions: Set<string> = new Set();
  /** 场次（初级/中级/高级/大师），决定底分与入场门槛。 */
  private tierId: RoomTierId = DEFAULT_TIER;
  /**
   * 房卡局（朋友局）开关。
   *
   * 为 true 时：不收入场费、不看金币余额、结算不动金币、逃跑不罚金币，
   * 但**战绩与积分照旧记**（用户明确要求计入胜率统计）。
   * 房卡在 onCreate 里已经向房主扣过一张（一张管一整房）。
   */
  private isCardRoom = false;
  /** 本局发牌时刻，用于战绩页显示真实对局时长（原来前端写死 360 秒）。 */
  private roundStartedAt = 0;
  /** 本局已打完的墩数，战绩页「吃了几墩」用真实值。 */
  private trickCount = 0;
  private playRound: PlayRoundState | null = null;
  private trickScores: number[] = []; // 各座位得分，开局时按模式人数初始化
  private callingSuitCandidates: string[] = []; // 叫主顺序
  private callingSuitIndex = 0;
  private lastSuitCallerId: string | null = null;
  /**
   * 本局叫主/抢主/叫分的过程记录。
   * 同时写进 state.auction（给重连的人）和随结算下发（结算页要复述）。
   */
  private auctionLog: {
    kind: AuctionKind;
    seatIndex: number;
    playerName: string;
    suit: number;
    sevenCount: number;
    score: number;
  }[] = [];
  /**
   * 上一局庄家的座位（255=还没打过／上一局流局也会记）。
   * 规则：第一局随机决定首位叫主者，之后由上一局庄家先叫主。
   * 必须在 resetForNewRound 清掉 state.bankerSeat 之前存下来。
   */
  private lastBankerSeat: number = 255;
  private callingScoreOrder: string[] = []; // 叫分顺序
  private callingScoreIndex = 0;
  private currentBidderId: string | null = null;
  private currentBid: number = this.bidMax;
  private playerBySeat: Map<number, string> = new Map(); // 座位号->sessionId映射
  private lastWinningCards: CardData[] = [];
  /** 本局已经公开打出的牌，供AI/提示做记牌判断。 */
  private playedCards: CardData[] = [];
  private newRoundTimer: Delayed | null = null;
  private turnTimer: Delayed | null = null;
  /** 本墩收牌前的展示停顿计时器：最后一家的牌要先亮出来再清桌。 */
  private trickResolveTimer: Delayed | null = null;
  /** 发牌动画窗口计时器：动画播完才进叫主，否则叫主面板会插进动画中间。 */
  private dealTimer: Delayed | null = null;
  private customRoomId: string | null = null;
  /** 叫主/叫分/扣底阶段的超时兜底计时器。 */
  private phaseTimer: Delayed | null = null;
  /** 每名真人连续超时次数：达到2次进入持续托管。 */
  private timeoutStreak: Map<string, number> = new Map();
  private aiSerial = 0;

  /** 各阶段思考时限（秒）。 */
  private static readonly CALL_SUIT_SECONDS = 15;
  private static readonly CALL_SCORE_SECONDS = 15;
  /* 扣底给 60 秒：庄家拿到底牌后手上牌最多（每人牌数 + 底牌数），
   * 既要挑扣哪些、又要考虑做缺门，45 秒实测不够，而且现在支持分批扣牌，
   * 更需要留出反复调整的时间。 */
  private static readonly DISCARD_SECONDS = 60;
  private static readonly PLAY_SECONDS = 30;
  /** 本墩收满后，牌在桌面上的展示时长（含最后一家）。 */
  private static readonly TRICK_SHOW_MS = 1400;

  /** 该玩家当前是否由服务端代打（AI、掉线接管或持续托管）。 */
  private isServerControlled(player: PlayerState): boolean {
    return player.isAI || player.isAutoPlay || player.isTrusteeByOffline;
  }

  /** 记一次超时；连续两次进入持续托管。返回是否已进入托管。 */
  private registerTimeout(player: PlayerState): boolean {
    const next = (this.timeoutStreak.get(player.id) ?? 0) + 1;
    this.timeoutStreak.set(player.id, next);
    if (next >= 2 && !player.isAutoPlay) {
      player.isAutoPlay = true;
      this.broadcast('trustee_on', {
        playerId: player.id,
        playerName: player.name,
        seatIndex: player.seatIndex,
        reason: 'timeout',
      });
    }
    return player.isAutoPlay;
  }

  /** 玩家自己操作成功即清零超时计数。 */
  private clearTimeoutStreak(playerId: string) {
    this.timeoutStreak.delete(playerId);
  }

  private clearPhaseTimer() {
    this.phaseTimer?.clear();
    this.phaseTimer = null;
  }

  /**
   * 某玩家被AI接管后，如果当前正卡在他的操作上，立刻让服务端代打，
   * 否则整桌会一直等一个已经掉线的人。
   */
  private resumeIfStuckOn(player: PlayerState) {
    const playerId = player.id;
    switch (this.state.phase) {
      case Phase.CallingSuit:
        if (player.isCalling) {
          this.clearPhaseTimer();
          this.phaseTimer = this.clock.setTimeout(() => {
            this.phaseTimer = null;
            this.performAiSuitCall(playerId);
          }, 300);
        }
        break;
      case Phase.CallingScore:
        if (player.isCalling) {
          this.clearPhaseTimer();
          this.phaseTimer = this.clock.setTimeout(() => {
            this.phaseTimer = null;
            this.performAiScoreCall(playerId);
          }, 300);
        }
        break;
      case Phase.Discarding:
        if (player.isBanker) {
          this.clearPhaseTimer();
          this.phaseTimer = this.clock.setTimeout(() => {
            this.phaseTimer = null;
            this.performAiDiscard(playerId);
          }, 300);
        }
        break;
      case Phase.Playing:
        if (this.state.currentTurn === player.seatIndex) {
          this.turnTimer?.clear();
          this.turnTimer = this.clock.setTimeout(() => {
            this.turnTimer = null;
            this.performAutoPlay(playerId);
          }, 300);
        }
        break;
      default:
        break;
    }
  }

  /**
   * 为叫主/叫分/扣底阶段安排超时兜底。
   * AI 与已托管玩家立即代打，真人给足思考时间后再代打一次。
   */
  private schedulePhaseAction(player: PlayerState, seconds: number, action: () => void) {
    this.clearPhaseTimer();
    if (this.isServerControlled(player)) {
      this.phaseTimer = this.clock.setTimeout(() => {
        this.phaseTimer = null;
        action();
      }, 250);
      return;
    }
    this.phaseTimer = this.clock.setTimeout(() => {
      this.phaseTimer = null;
      this.registerTimeout(player);
      this.broadcast('action_timeout', {
        playerId: player.id,
        playerName: player.name,
        seatIndex: player.seatIndex,
        phase: this.state.phase,
      });
      action();
    }, seconds * 1000);
  }

  onCreate(options: any) {
    console.log('[GameRoom] 房间创建');

    this.setState(new GameState());

    const modeId = String(options?.mode ?? 'fourPlayerTwoDecks');
    const selected = (GAME_MODES as Record<string, GameModeConfig>)[modeId];
    if (selected) {
      this.mode = selected;
      this.maxClients = selected.playerCount;
      this.state.modeId = modeId;
      this.state.modePlayerCount = selected.playerCount;
    }

    // 场次决定底分和入场门槛。认不出的一律回落到初级场（最便宜），
    // 免得客户端传个乱值就按大师场扣钱。
    this.tierId = tierOf(options?.tier).id;
    this.state.tierId = this.tierId;

    /* 房卡局：建房时向房主扣一张房卡，整桌就不输赢金币了。
     *
     * 为什么在 onCreate 而不是 onJoin 里扣：“一张管一整个房间、房主付费”，
     * 放到 onJoin 就会每个人都扣。onCreate 拿不到 client，所以房主的 token
     * 由建房参数带过来。
     *
     * 扣不成就**抩房**（throw），不能默默降级成金币局：
     * 玩家以为开的是不输钱的朋友局，结果打完发现金币没了，那是事故。 */
    if (options?.cardRoom) {
      const hostAccount = options?.token ? authByToken(String(options.token)) : null;
      if (!hostAccount) {
        throw new Error('房卡局需要先登录');
      }
      if (!spendRoomCard(hostAccount.id, `建房消耗（${this.mode.playerCount} 人场）`)) {
        throw new Error('房卡不足，去商城用金币兑换或领取每日免费房卡');
      }
      this.isCardRoom = true;
      this.state.isCardRoom = true;
      console.log(`[GameRoom] 房卡局，已扣房主 ${hostAccount.nickname} 一张房卡`);
    }

    // 房间号统一成 6 位纯数字：玩家要口头/微信报房号，字母数字混排容易
    // 把 0/O、1/I 念错，纯数字还能直接用九宫格键盘输入。
    // 自定义房号也只收 6 位数字；没传就自动分配一个没被占用的。
    const customRoomId = String(options?.customRoomId ?? '').trim();
    if (customRoomId) {
      if (!isValidRoomCode(customRoomId)) {
        throw new Error('房间号必须是 6 位数字（首位不能是 0）');
      }
      if (GameRoom.activeCustomRoomIds.has(customRoomId)) {
        throw new Error('房间号已存在，请换一个');
      }
      GameRoom.activeCustomRoomIds.add(customRoomId);
      this.customRoomId = customRoomId;
      this.roomId = customRoomId;
    } else {
      const generated = allocRoomCode(code => GameRoom.activeCustomRoomIds.has(code));
      if (generated) {
        GameRoom.activeCustomRoomIds.add(generated);
        this.customRoomId = generated;
        this.roomId = generated;
      }
      // 万一 6 位号段被占满（实际几乎不可能），就退回 Colyseus 默认 roomId，
      // 房间还是能开，只是号码不好念。
    }
    
    this.setMetadata({
      name: `天王扑克${this.mode.playerCount}人场`,
      gameType: 'tianwang_poker',
      maxPlayers: this.mode.playerCount,
      // 大厅房间列表要用：模式、人数、阶段、房主
      modeId,
      playerCount: this.mode.playerCount,
      deckCount: this.mode.deckCount,
      phase: this.state.phase,
      hostName: '',
      hostScore: 0,
    });

    // 玩家准备
    this.onMessage('ready', (client: Client) => {
      if (this.state.phase === Phase.Settling) {
        // 结算面板上点“准备下一局”时立即进入等待，不必硬等自动倒计时。
        this.resetForNewRound();
      }
      if (this.state.phase !== Phase.Waiting) return;

      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.isReady = true;
        console.log(`[GameRoom] 玩家 ${player.name} 已准备`);
        
        // 检查是否所有玩家都准备好了
        let readyCount = 0;
        this.state.players.forEach((p: PlayerState) => {
          if (p.isReady) readyCount++;
        });
        
        if (readyCount === this.mode.playerCount) {
          this.startGame();
        }
      }
    });

    // 叫主
    this.onMessage('call_suit', (client: Client, message: { suit: number }) => {
      this.handleCallSuit(client, message.suit);
    });

    // 叫分
    this.onMessage('call_score', (client: Client, message: { score: number }) => {
      this.handleCallScore(client, message.score);
    });

    // 扣底：一次交够张数（分批扣牌走 discard_stage / discard_unstage）
    this.onMessage('discard', (client: Client, message: { cardIds: string[] }) => {
      this.handleDiscard(client, message.cardIds);
    });

    // 分批扣牌：把选中的牌先放进底牌区（不结算），凑够张数才自动提交
    this.onMessage('discard_stage', (client: Client, message: { cardIds: string[] }) => {
      this.handleDiscardStage(client, message?.cardIds ?? []);
    });

    // 分批扣牌：把已放进底牌区的牌取回手里
    this.onMessage('discard_unstage', (client: Client, message: { cardIds: string[] }) => {
      this.handleDiscardUnstage(client, message?.cardIds ?? []);
    });

    // 确认埋底：底牌区已经凑够张数，庄家点确认才真正开打
    this.onMessage('confirm_discard', (client: Client) => {
      this.handleConfirmDiscard(client);
    });

    // 出牌
    this.onMessage('play', (client: Client, message: { cardIds: string[] }) => {
      this.handlePlay(client, message.cardIds);
    });

    // 甩牌：独立消息。不能和 play 合并，否则玩家想打「该门最大的一对」
    // 会被当成甩牌，失败后牌型被拆成单张，完全不符合预期。
    this.onMessage('toss', (client: Client, message: { cardIds: string[] }) => {
      this.handleToss(client, message.cardIds);
    });

    // 提示：返回一手推荐出牌的ID（仅推荐，不自动出）
    this.onMessage('hint', (client: Client) => {
      this.handleHint(client);
    });

    // 扣底推荐：返回最弱的N张牌ID
    this.onMessage('discard_hint', (client: Client) => {
      this.handleDiscardHint(client);
    });

    // 玩家收回托管：立刻恢复手动操作，若正好轮到自己则重新计时。
    this.onMessage('resume_control', (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isAI) return;
      this.clearTimeoutStreak(client.sessionId);
      if (!player.isAutoPlay && !player.isTrusteeByOffline) return;
      player.isAutoPlay = false;
      player.isTrusteeByOffline = false;
      this.broadcast('trustee_off', {
        playerId: client.sessionId,
        playerName: player.name,
        seatIndex: player.seatIndex,
      });
      // 正好轮到他且还在出牌阶段，则把这一手交还给他并重新给足时间。
      if (this.state.phase === Phase.Playing && this.state.currentTurn === player.seatIndex) {
        this.promptPlayTurn(player.seatIndex);
      }
    });

    // 房主管理：等待阶段可以加减AI、踢人；开局后房间自动锁定。
    this.onMessage('add_ai', (client: Client) => {
      this.handleAddAi(client);
    });
    this.onMessage('remove_ai', (client: Client) => {
      this.handleRemoveAi(client);
    });
    this.onMessage('kick_player', (client: Client, message: { playerId: string }) => {
      this.handleKickPlayer(client, String(message?.playerId ?? ''));
    });

    // 出牌阶段不允许过牌；保留该消息仅用于对旧客户端返回明确错误。
    this.onMessage('pass', (client: Client) => {
      client.send('error', { message: '出牌阶段不能过牌，必须跟首家相同张数' });
    });

    // 聊天
    this.onMessage('chat', (client: Client, message: { text: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        this.broadcast('chat', {
          playerId: client.sessionId,
          playerName: player.name,
          text: message.text,
        });
      }
    });

    // ===== 实时语音（按住说话）=====
    // 纯转发：客户端把 MediaRecorder 切出来的分片发上来，这里补上说话人身份
    // 再广播给同房其他人（except 自己，不然会听到自己的回声）。
    // 服务端不做转码/混音 —— 那需要 ffmpeg 常驻，对"轮流说一句"的对讲场景
    // 完全不必要，也会把单机部署的成本抬上去。
    this.onMessage('voice', (client: Client, message: VoiceChunkMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // 限流：一次按住每 250ms 一片，正常 4 片/秒。给到 12 片/秒的余量，
      // 超出的直接丢，避免被改客户端刷流量。
      if (!this.voiceRate.allow(client.sessionId)) return;

      // 体积上限见 voiceRate.ts（要迁就 iOS 首片带 ftyp+moov 的情况）
      const data = message?.data;
      const size = (data as any)?.byteLength ?? (data as any)?.length ?? 0;
      if (!data || !VoiceRateLimiter.isValidChunkSize(size)) return;

      this.broadcast('voice', {
        playerId: client.sessionId,
        playerName: player.name,
        seatIndex: player.seatIndex,
        mime: String(message.mime ?? 'audio/webm'),
        sessionId: String(message.sessionId ?? ''),
        seq: Number(message.seq ?? 0),
        data,
      }, { except: client });
    });
  }

  /** 语音限流器（滚动 1 秒窗口，实现见 rooms/voiceRate.ts）。 */
  private voiceRate = new VoiceRateLimiter();

  onJoin(client: Client, options?: any) {
    if (this.state.phase !== Phase.Waiting) {
      client.leave(4000, '牌局已开始，不能中途加入');
      return;
    }

    const seatIndex = this.state.players.size;
    
    if (this.state.players.size >= this.mode.playerCount) {
      client.leave(4000, '房间已满');
      return;
    }

    /* 认账号：客户端带 token 进来，这里换成账号 id 存起来，
     * 结算时才知道该给谁发金币、记谁的战绩。
     * 认不出来也照样能玩（只是不发币），不要因此把人挡在门外。 */
    const account = options?.token ? authByToken(String(options.token)) : null;
    if (account) {
      /* 入场门槛：金币不够就别让进，否则一局下来直接被扣穿。
       * 只拦认得出账号的人 —— 认不出账号本来就不发币不扣币，拦了没意义。 */
      /* 房卡局不查余额：房主已经用房卡买下整桌，其他人免费进，
       * 而且这种局不输赢金币，拦余额没意义——输光了也应该能被朋友拉进来玩。 */
      if (!this.isCardRoom) {
        const tier = tierOf(this.tierId);
        if (account.coins < tier.entry) {
          client.leave(4001, `${tier.name}需要 ${tier.entry} 金币才能进，你还差 ${tier.entry - account.coins}`);
          return;
        }
      }
      this.accountBySession.set(client.sessionId, account.id);
    }

    const player = new PlayerState();
    player.id = client.sessionId;
    // 昵称优先用账号里的，避免客户端传个假名字冒充别人
    player.name = account?.nickname || options?.name || `玩家${seatIndex + 1}`;
    player.seatIndex = seatIndex;
    // 累计积分从账号带出来，段位显示才是真的
    player.score = account?.score ?? 0;
    player.isReady = false;
    player.isAI = false;
    player.isOwner = this.state.players.size === 0;
    
    this.state.players.set(client.sessionId, player);
    this.hands.set(client.sessionId, []);
    this.playerBySeat.set(seatIndex, client.sessionId);
    
    console.log(`[GameRoom] 玩家 ${player.name} 加入，座位号 ${seatIndex}`);

    this.broadcast('player_joined', {
      playerName: player.name,
      seatIndex: seatIndex,
      currentCount: this.state.players.size,
    });

    const requestedAiCount = Number(options?.aiCount ?? 0);
    if (seatIndex === 0 && requestedAiCount > 0) {
      this.addAiPlayers(Math.min(requestedAiCount, this.mode.playerCount - 1));
    }

    this.syncMetadata();

    if (this.state.players.size === this.mode.playerCount) {
      this.broadcast('room_full', {
        message: '房间已满，请准备开始游戏',
      });
    }
  }

  async onLeave(client: Client, code?: number) {
    // 语音限流桶按 sessionId 存，人走了要清掉，否则长时间运行会缓慢泄漏
    this.voiceRate.forget(client.sessionId);

    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.isOffline = true;
      console.log(`[GameRoom] 玩家 ${player.name} 离开, code=${code}`);
      
      this.broadcast('player_left', {
        playerName: player.name,
        seatIndex: player.seatIndex,
      });

      // 对局进行中掉线：立即由AI接管该座位，其余玩家不受影响继续打完本局。
      const inProgress = this.state.phase !== Phase.Waiting && this.state.phase !== Phase.Settling;
      // 有了真金币输赢，输家会掉线逃单，所以主动中途退出直接罚金。
      // 非主动断线（网络问题）先不罚，等 120 秒重连窗口过了再算。
      if (inProgress && code === 4000) {
        this.applyEscapePenalty(client.sessionId, player);
      }
      if (inProgress && code !== 4000) {
        player.isTrusteeByOffline = true;
        this.broadcast('trustee_on', {
          playerId: client.sessionId,
          playerName: player.name,
          seatIndex: player.seatIndex,
          reason: 'offline',
        });
        // 如果正好卡在他的回合，立刻由AI顶上，避免整桌等待。
        this.resumeIfStuckOn(player);
      }

      // 非主动退出先保留较长的重连窗口，允许断线重连并重发私有手牌。
      if (code !== 4000) {
        try {
          const reconnectedClient = await this.allowReconnection(client, 120);
          player.isOffline = false;
          // 重连后先保持AI托管，由玩家自己点“收回托管”接管，避免刚回来就被逼着出牌。
          reconnectedClient.send('hand_update', { hand: this.hands.get(client.sessionId) || [] });
          reconnectedClient.send('reconnected', {
            phase: this.state.phase,
            isTrustee: player.isAutoPlay || player.isTrusteeByOffline,
            bottomCards: player.isBanker && this.state.phase === Phase.Discarding
              ? this.bottomCards
              : [],
          });
          this.broadcast('player_reconnected', {
            playerName: player.name,
            seatIndex: player.seatIndex,
          });
          return;
        } catch {
          console.log(`[GameRoom] 玩家 ${player.name} 重连超时，释放座位`);
          // 120 秒都没回来，对局里其他人已经被迫等过一轮了，按逃跑处理
          if (this.state.phase !== Phase.Waiting && this.state.phase !== Phase.Settling) {
            this.applyEscapePenalty(client.sessionId, player);
          }
        }
      }

      // 对局仍在进行且座位已被AI接管：保留座位打完本局，不清空整桌。
      if (this.state.phase !== Phase.Waiting && this.state.phase !== Phase.Settling) {
        player.isTrusteeByOffline = true;
        this.resumeIfStuckOn(player);
        return;
      }

      this.accountBySession.delete(client.sessionId);
      this.state.players.delete(client.sessionId);
      this.hands.delete(client.sessionId);
      this.discardStaging.delete(client.sessionId);
      this.hintCursor.delete(client.sessionId);
      this.timeoutStreak.delete(client.sessionId);

      // 重新紧凑排座，让新玩家可立即补位。
      this.playerBySeat.clear();
      if (player.isOwner) {
        const nextOwner = [...this.state.players.values()].find(p => !p.isAI);
        if (nextOwner) nextOwner.isOwner = true;
      }
      let seatIndex = 0;
      this.state.players.forEach((remaining: PlayerState) => {
        remaining.seatIndex = seatIndex;
        this.playerBySeat.set(seatIndex, remaining.id);
        seatIndex++;
      });
    }

    // 有人离开后本局作废，清掉牌局数据，回到等待补位状态。
    this.resetForNewRound();
  }

  onDispose() {
    this.trickResolveTimer?.clear();
    this.trickResolveTimer = null;
    this.dealTimer?.clear();
    this.dealTimer = null;
    if (this.customRoomId) GameRoom.activeCustomRoomIds.delete(this.customRoomId);
    removeAdminRoomParticipants(this.roomId);
    console.log('[GameRoom] 房间销毁');
  }

  /**
   * 把房间当前状态同步到 metadata，供大厅 /rooms 列表展示。
   * 人数/阶段/房主变化时都要调，否则列表数据会过期。
   */
  private syncMetadata() {
    const host = [...this.state.players.values()].find(p => p.isOwner);
    setAdminRoomParticipants(this.roomId, [...this.state.players.values()].map(player => ({
      accountId: player.isAI ? null : (this.accountBySession.get(player.id) ?? null),
      username: player.name,
      isAI: player.isAI,
    })));
    this.setMetadata({
      name: `天王扑克${this.mode.playerCount}人场`,
      gameType: 'tianwang_poker',
      maxPlayers: this.mode.playerCount,
      modeId: this.state.modeId,
      playerCount: this.mode.playerCount,
      deckCount: this.mode.deckCount,
      phase: this.state.phase,
      hostName: host?.name ?? '',
      // 大厅列表按房主真实积分显示段位，不再前端写死「青铜」
      hostScore: host?.score ?? 0,
      // 真人数：房间列表要过滤掉「只剩 AI 的空房」，否则点进去没人陪你打
      humanCount: [...this.state.players.values()].filter(p => !p.isAI).length,
      // 场次与底分：房间列表要显示"这房多大注"，也用于入场门槛提示
      tierId: this.tierId,
      stake: tierOf(this.tierId).stake,
      // 房间列表要把房卡局标出来（不输赢金币，对玩家是关键信息）
      isCardRoom: this.isCardRoom,
    }).catch(() => undefined);
  }

  private assertOwnerAndWaiting(client: Client): PlayerState | null {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.isOwner) {
      client.send('error', { message: '只有房主可以管理房间' });
      return null;
    }
    if (this.state.phase !== Phase.Waiting) {
      client.send('error', { message: '牌局已开始，不能调整座位' });
      return null;
    }
    return player;
  }

  private recompactSeats() {
    this.playerBySeat.clear();
    let seatIndex = 0;
    this.state.players.forEach((player: PlayerState) => {
      player.seatIndex = seatIndex;
      this.playerBySeat.set(seatIndex, player.id);
      seatIndex++;
    });
    this.syncMetadata();
  }

  private handleAddAi(client: Client) {
    if (!this.assertOwnerAndWaiting(client)) return;
    if (this.state.players.size >= this.mode.playerCount) {
      client.send('error', { message: '房间已满，不能再加AI' });
      return;
    }
    this.addAiPlayers(1);
  }

  private handleRemoveAi(client: Client) {
    if (!this.assertOwnerAndWaiting(client)) return;
    const aiPlayers = [...this.state.players.values()].filter(p => p.isAI);
    const target = aiPlayers[aiPlayers.length - 1];
    if (!target) {
      client.send('error', { message: '当前没有AI玩家' });
      return;
    }
    this.state.players.delete(target.id);
    this.hands.delete(target.id);
    this.discardStaging.delete(target.id);
    this.hintCursor.delete(target.id);
    this.timeoutStreak.delete(target.id);
    this.recompactSeats();
    this.broadcast('player_left', {
      playerName: target.name,
      seatIndex: target.seatIndex,
      reason: 'ai_removed',
    });
  }

  private handleKickPlayer(client: Client, playerId: string) {
    const owner = this.assertOwnerAndWaiting(client);
    if (!owner) return;
    if (playerId === owner.id) {
      client.send('error', { message: '不能移出自己' });
      return;
    }
    const target = this.state.players.get(playerId);
    if (!target) {
      client.send('error', { message: '玩家不在房间内' });
      return;
    }
    if (target.isAI) {
      this.state.players.delete(target.id);
      this.hands.delete(target.id);
      this.discardStaging.delete(target.id);
      this.hintCursor.delete(target.id);
      this.timeoutStreak.delete(target.id);
      this.recompactSeats();
      this.broadcast('player_left', {
        playerName: target.name,
        seatIndex: target.seatIndex,
        reason: 'kicked',
      });
      return;
    }
    const targetClient = this.clients.find(item => item.sessionId === playerId);
    targetClient?.leave(4000, '已被房主移出房间');
  }

  private addAiPlayers(count: number) {
    for (let index = 0; index < count && this.state.players.size < this.mode.playerCount; index++) {
      const seatIndex = this.state.players.size;
      this.aiSerial += 1;
      const playerId = `ai-${this.roomId}-${this.aiSerial}`;
      const player = new PlayerState();
      player.id = playerId;
      // 用中文昵称而不是 "AI 2"：匹配页和牌桌共用同一份名单，两边一致。
      // 身份不隐瞒 —— isAI 仍为 true，前端照常显示"电脑"标记。
      player.name = aiNameForSeat(seatIndex);
      player.seatIndex = seatIndex;
      player.isReady = true;
      player.isAI = true;
      this.state.players.set(playerId, player);
      this.hands.set(playerId, []);
      this.playerBySeat.set(seatIndex, playerId);
      this.broadcast('player_joined', {
        playerName: player.name,
        seatIndex,
        currentCount: this.state.players.size,
        isAI: true,
      });
    }
    this.syncMetadata();
  }

  /**
   * 开始游戏
   */
  private startGame() {
    console.log('[GameRoom] 游戏开始！');
    
    this.playedCards = [];
    this.roundStartedAt = Date.now();
    this.trickCount = 0;
    this.state.phase = Phase.Dealing;
    // 开局后大厅列表要显示“对战中”
    this.syncMetadata();

    // 每局开始按模式人数重置抓分，5/6人局不能沿用固定4位数组，否则出现NaN。
    this.trickScores = Array.from({ length: this.mode.playerCount }, () => 0);

    // 洗牌发牌
    const { hands, bottom } = dealCards(this.mode);
    
    // 分配手牌给玩家
    let seatIndex = 0;
    this.state.players.forEach((player: PlayerState) => {
      const handCards = hands[seatIndex];
      this.hands.set(player.id, handCards);
      
      player.handCount = handCards.length;
      
      // 私下发牌给玩家
      const client = this.clients.find((c) => c.sessionId === player.id);
      if (client) {
        client.send('deal', { hand: handCards });
      }
      
      seatIndex++;
    });
    
    // 保存底牌
    this.bottomCards = bottom;
    this.state.bottomCount = bottom.length;

    // 发牌动画窗口：客户端要把 24~48 张牌一张张飞进手里、翻面、再自动理牌。
    // 这段时间必须停在 Dealing 阶段 —— 以前发完牌立刻切 CallingSuit，
    // 手牌是瞬间整排出现的，而且叫主面板会直接盖在动画上。
    this.state.phase = Phase.Dealing;
    this.broadcast('deal_start', {
      perPlayer: this.mode.perPlayer,
      durationMs: dealAnimationMs(this.mode.perPlayer),
    });
    this.dealTimer?.clear();
    this.dealTimer = this.clock.setTimeout(() => {
      this.dealTimer = null;
      this.beginCallingSuit();
    }, dealAnimationMs(this.mode.perPlayer));
  }

  /**
   * 发牌动画播完后真正进入叫主阶段。
   * 从 startGame 拆出来：发牌与叫主之间隔了一个动画窗口，
   * 中途有人离桌会走 resetForNewRound，那里必须清掉 dealTimer。
   */
  private beginCallingSuit() {
    if (this.state.phase !== Phase.Dealing) return;

    this.state.phase = Phase.CallingSuit;

    // 首位叫主者：第一局随机；之后由上一局庄家先叫主。
    const playerIds = Array.from(this.state.players.keys());
    let firstCallerIndex = -1;
    if (this.lastBankerSeat !== 255) {
      firstCallerIndex = playerIds.findIndex(
        id => this.state.players.get(id)?.seatIndex === this.lastBankerSeat
      );
    }
    // 上一局庄家已离桌（或第一局）时退回随机，保证一定有人先叫。
    if (firstCallerIndex < 0) {
      firstCallerIndex = Math.floor(Math.random() * playerIds.length);
    }
    this.callingSuitCandidates = rotateFrom(playerIds, firstCallerIndex);
    this.callingSuitIndex = 0;
    this.lastSuitCallerId = null;
    // 同一房间连打多局：上一局的叫牌过程必须清掉，否则会累积成一长串。
    this.auctionLog = [];
    this.state.auction.length = 0;
    this.state.mainSuit = 255;
    this.state.mainSuitCallCount = 0;
    
    this.promptCurrentSuitCaller();
  }

  /**
   * 记一条叫主/叫分过程。
   *
   * 同时写两处是刻意的：state.auction 让重连的人也能看到完整过程，
   * auctionLog 在结算时随 game_settled 一起下发（结算页要标明谁叫的主、谁叫的分）。
   */
  private recordAuction(entry: {
    kind: AuctionKind;
    seatIndex?: number;
    playerName?: string;
    suit?: number;
    sevenCount?: number;
    score?: number;
  }) {
    const row = {
      kind: entry.kind,
      seatIndex: entry.seatIndex ?? 255,
      playerName: entry.playerName ?? '',
      suit: entry.suit ?? 255,
      sevenCount: entry.sevenCount ?? 0,
      score: entry.score ?? 0,
    };
    this.auctionLog.push(row);
    const schema = new AuctionEntryState();
    schema.kind = row.kind;
    schema.seatIndex = row.seatIndex;
    schema.playerName = row.playerName;
    schema.suit = row.suit;
    schema.sevenCount = row.sevenCount;
    schema.score = row.score;
    this.state.auction.push(schema);
  }

  /**
   * 当前叫主/抢主需要亮出的同花色 7 的张数。
   * 还没人叫主时 1 张即可；已有人叫主时必须比他亮的更多。
   */
  private requiredSevens(): number {
    return calcRequiredSevens(this.state.mainSuit, this.state.mainSuitCallCount);
  }

  /**
   * 处理叫主
   */
  private promptCurrentSuitCaller() {
    const playerId = this.callingSuitCandidates[this.callingSuitIndex];
    const player = playerId ? this.state.players.get(playerId) : undefined;
    if (!player) {
      this.finishCallingSuit();
      return;
    }
    player.isCalling = true;
    this.state.currentTurn = player.seatIndex;
    this.broadcast('call_suit_turn', {
      playerId,
      playerName: player.name,
      seatIndex: player.seatIndex,
      timeLimit: GameRoom.CALL_SUIT_SECONDS,
      deadline: Date.now() + GameRoom.CALL_SUIT_SECONDS * 1000,
    });
    // AI/托管立即代打；真人超时后按“放弃叫主”推进，避免整桌无限等待。
    this.schedulePhaseAction(player, GameRoom.CALL_SUIT_SECONDS, () => {
      if (this.state.phase !== Phase.CallingSuit) return;
      const current = this.state.players.get(playerId);
      if (!current?.isCalling) return;
      if (this.isServerControlled(current)) this.performAiSuitCall(playerId);
      else {
        current.isCalling = false;
        this.advanceSuitCaller();
      }
    });
  }

  private performAiSuitCall(playerId: string) {
    if (this.state.phase !== Phase.CallingSuit) return;
    const player = this.state.players.get(playerId);
    if (!player || !this.isServerControlled(player) || !player.isCalling) return;
    const hand = this.hands.get(playerId) ?? [];
    // 已有人叫主时必须多亮一张才能抢，和真人走同一门槛。
    const minSevens = this.requiredSevens();
    const isSteal = this.state.mainSuit !== 255;
    /* 叫主必须和「打算不打算抢庄」一起判断（chooseAiSuit 的 bidMax）。
     * 之前只看这门牌够不够强，结果 AI 亮 7 定了主、随后叫分阶段又不敢叫，
     * 庄让给别人 —— 等于白白暴露自己的常主 7，纯亏。实测 33% 的局都这样。 */
    const suit = chooseAiSuit(hand, minSevens, {
      bidMax: this.bidMax,
      hasCurrentBid: false,
    });
    if (suit !== 255) {
      // 与真人一致：只亮到刚好够门槛的张数，不把手上的 7 全亮出去。
      const sevenCount = minSevens;
      this.state.mainSuit = suit;
      this.state.mainSuitCallCount = sevenCount;
      this.lastSuitCallerId = playerId;
      this.recordAuction({
        kind: isSteal ? 'steal_suit' : 'call_suit',
        seatIndex: player.seatIndex,
        playerName: player.name,
        suit,
        sevenCount,
      });
      this.broadcast('suit_called', {
        playerId,
        playerName: player.name,
        seatIndex: player.seatIndex,
        suit,
        sevenCount,
        isSteal,
      });
    } else {
      this.recordAuction({
        kind: 'pass_suit',
        seatIndex: player.seatIndex,
        playerName: player.name,
      });
    }
    player.isCalling = false;
    this.advanceSuitCaller();
  }

  private advanceSuitCaller() {
    this.callingSuitIndex++;
    if (this.callingSuitIndex >= this.callingSuitCandidates.length) {
      this.finishCallingSuit();
    } else {
      this.promptCurrentSuitCaller();
    }
  }

  private finishCallingSuit() {
    if (this.state.mainSuit === 255) {
      // 无人叫主：翻底牌第6张定主。按确认规则，翻到大王算红桃、小王算黑桃。
      const flipped = this.bottomCards[5];
      this.state.mainSuit = suitFromFlippedCard(flipped);
      // 翻主不是亮牌，门槛保持 0：后续没有抢主环节了，这里只为语义清晰。
      this.state.mainSuitCallCount = 0;
      this.recordAuction({ kind: 'bottom_suit', suit: this.state.mainSuit });
      this.broadcast('suit_from_bottom', { suit: this.state.mainSuit, card: flipped });
    }
    this.state.phase = Phase.CallingScore;
    this.startCallingScore();
  }

  private handleCallSuit(client: Client, suit: number) {
    if (this.state.phase !== Phase.CallingSuit) return;
    
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.isCalling) return;

    // 注意：校验未通过时必须保留超时兜底计时器，否则整桌会永久卡在本阶段。
    if (suit === 255) {
      console.log(`[GameRoom] 玩家 ${player.name} 放弃叫主`);
      this.recordAuction({
        kind: 'pass_suit',
        seatIndex: player.seatIndex,
        playerName: player.name,
      });
    } else {
      /* 门槛判定与 AI 走同一个 checkSuitCall（logic/bidding.ts，有单测）：
       * 以前这里和 performAiSuitCall 各写一遍，改规则容易只改一边。 */
      const check = checkSuitCall({
        suit,
        hand: this.hands.get(client.sessionId) || [],
        mainSuit: this.state.mainSuit,
        mainSuitCallCount: this.state.mainSuitCallCount,
      });
      if (!check.ok) {
        client.send('error', { message: check.message });
        return;
      }
      const sevenCount = check.sevenCount;
      const isSteal = this.state.mainSuit !== 255;
      this.state.mainSuit = suit;
      this.state.mainSuitCallCount = sevenCount;
      this.lastSuitCallerId = client.sessionId;
      console.log(`[GameRoom] 玩家 ${player.name} 叫主: ${suit} (${sevenCount}张7)`);
      this.recordAuction({
        kind: isSteal ? 'steal_suit' : 'call_suit',
        seatIndex: player.seatIndex,
        playerName: player.name,
        suit,
        sevenCount,
      });
      this.broadcast('suit_called', {
        playerId: client.sessionId,
        playerName: player.name,
        seatIndex: player.seatIndex,
        suit: suit,
        sevenCount,
        isSteal,
      });
      
    }
    // 走到这里说明操作合法，才取消超时兜底并清零连续超时计数。
    this.clearPhaseTimer();
    this.clearTimeoutStreak(client.sessionId);
    player.isCalling = false;
    this.advanceSuitCaller();
  }

  /**
   * 开始叫分定庄
   */
  private startCallingScore() {
    const startId = this.lastSuitCallerId || this.callingSuitCandidates[0];
    const startIndex = this.callingSuitCandidates.indexOf(startId);
    this.callingScoreOrder = rotateFrom(this.callingSuitCandidates, startIndex);
    this.callingScoreIndex = 0;
    this.currentBidderId = null;
    this.currentBid = this.bidMax;
    this.state.callScore = this.bidMax;
    this.state.nextBidMax = this.bidMax;
    this.promptCurrentScoreCaller();
  }

  private promptCurrentScoreCaller() {
    const playerId = this.callingScoreOrder[this.callingScoreIndex];
    const player = playerId ? this.state.players.get(playerId) : undefined;
    if (!player) {
      this.finalizeBanker();
      return;
    }
    player.isCalling = true;
    this.state.currentTurn = player.seatIndex;
    const ceiling = currentBidCeiling({
      hasBidder: this.currentBidderId !== null,
      currentBid: this.currentBid,
      bidMax: this.bidMax,
    });
    this.state.nextBidMax = ceiling;
    this.broadcast('call_score_turn', {
      playerId,
      playerName: player.name,
      seatIndex: player.seatIndex,
      minScore: GAME_CONFIG.callScoreMin,
      maxScore: ceiling,
      currentScore: this.currentBid,
      step: GAME_CONFIG.callScoreStep,
      timeLimit: GameRoom.CALL_SCORE_SECONDS,
      deadline: Date.now() + GameRoom.CALL_SCORE_SECONDS * 1000,
    });
    // 真人超时按“放弃叫分”推进；全员放弃仍会正常走流局。
    this.schedulePhaseAction(player, GameRoom.CALL_SCORE_SECONDS, () => {
      if (this.state.phase !== Phase.CallingScore) return;
      const current = this.state.players.get(playerId);
      if (!current?.isCalling) return;
      if (this.isServerControlled(current)) this.performAiScoreCall(playerId);
      else {
        current.isCalling = false;
        this.advanceScoreCaller();
      }
    });
  }

  private performAiScoreCall(playerId: string) {
    if (this.state.phase !== Phase.CallingScore) return;
    const player = this.state.players.get(playerId);
    if (!player || !this.isServerControlled(player) || !player.isCalling) return;
    const hasBidder = this.currentBidderId !== null;
    const maxScore = currentBidCeiling({
      hasBidder, currentBid: this.currentBid, bidMax: this.bidMax,
    });
    const score = chooseAiBid(
      this.hands.get(playerId) ?? [],
      this.state.mainSuit,
      maxScore,
      hasBidder,
    );
    // 能不能叫得出去交给 logic/bidding.ts 判（含「还没人叫、按基准分开叫」这种情况）
    if (isAiBidUsable({ score, currentBid: this.currentBid, hasBidder, bidMax: this.bidMax })) {
      this.currentBid = score;
      this.currentBidderId = playerId;
      this.state.callScore = score;
      this.recordAuction({
        kind: 'bid',
        seatIndex: player.seatIndex,
        playerName: player.name,
        score,
      });
      this.broadcast('score_bid', {
        playerId,
        playerName: player.name,
        seatIndex: player.seatIndex,
        score,
      });
    } else {
      this.recordAuction({
        kind: 'pass_bid',
        seatIndex: player.seatIndex,
        playerName: player.name,
      });
    }
    player.isCalling = false;
    this.advanceScoreCaller();
  }

  private advanceScoreCaller() {
    this.callingScoreIndex++;
    if (isBiddingDone({
      nextIndex: this.callingScoreIndex,
      orderLength: this.callingScoreOrder.length,
      currentBid: this.currentBid,
    })) {
      this.finalizeBanker();
    } else {
      this.promptCurrentScoreCaller();
    }
  }

  /**
   * 处理叫分
   */
  private handleCallScore(client: Client, score: number) {
    if (this.state.phase !== Phase.CallingScore) return;
    
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.isCalling) return;

    // 注意：校验未通过时必须保留超时兜底计时器，否则整桌会永久卡在本阶段。
    if (score === 0) {
      console.log(`[GameRoom] 玩家 ${player.name} 放弃叫分`);
      this.recordAuction({
        kind: 'pass_bid',
        seatIndex: player.seatIndex,
        playerName: player.name,
      });
    } else {
      // 与 AI 路径共用同一份规则（logic/bidding.ts，有单测）
      const check = checkScoreBid({
        score,
        bidMax: this.bidMax,
        currentBid: this.currentBid,
        hasBidder: this.currentBidderId !== null,
      });
      if (!check.ok) {
        client.send('error', { message: check.message });
        return;
      }
      this.currentBid = score;
      this.currentBidderId = client.sessionId;
      this.state.callScore = score;
      console.log(`[GameRoom] 玩家 ${player.name} 叫分: ${score}`);
      this.recordAuction({
        kind: 'bid',
        seatIndex: player.seatIndex,
        playerName: player.name,
        score,
      });
      this.broadcast('score_bid', {
        playerId: client.sessionId,
        playerName: player.name,
        seatIndex: player.seatIndex,
        score: score,
      });
    }
    // 走到这里说明操作合法，才取消超时兜底并清零连续超时计数。
    this.clearPhaseTimer();
    this.clearTimeoutStreak(client.sessionId);
    player.isCalling = false;
    this.advanceScoreCaller();
  }

  private finalizeBanker() {
    if (!this.currentBidderId) {
      this.handleFlowBreak();
      return;
    }
    const bankerId = this.currentBidderId;
    const player = this.state.players.get(bankerId);
    const client = this.clients.find(item => item.sessionId === bankerId);
    if (!player) return;

    this.state.callScore = this.currentBid;
    this.state.bankerSeat = player.seatIndex;
    player.isBanker = true;
    this.state.phase = Phase.Discarding;
    this.state.currentTurn = player.seatIndex;

    const combinedHand = [...(this.hands.get(bankerId) || []), ...this.bottomCards];
    this.hands.set(bankerId, combinedHand);
    player.handCount = combinedHand.length;
    client?.send('deal_bottom', { bottomCards: this.bottomCards });
    client?.send('hand_update', { hand: combinedHand });

    this.broadcast('score_called', {
      playerId: bankerId,
      playerName: player.name,
      score: this.state.callScore,
      bankerSeat: player.seatIndex,
    });
    this.broadcast('discard_turn', {
      playerId: bankerId,
      playerName: player.name,
      count: this.mode.discardCount,
      timeLimit: GameRoom.DISCARD_SECONDS,
      deadline: Date.now() + GameRoom.DISCARD_SECONDS * 1000,
    });
    // 庄家超时由AI策略自动扣底，避免卡在扣底阶段。
    this.schedulePhaseAction(player, GameRoom.DISCARD_SECONDS, () => {
      if (this.state.phase !== Phase.Discarding) return;
      this.performAiDiscard(bankerId);
    });
  }

  private performAiDiscard(playerId: string) {
    if (this.state.phase !== Phase.Discarding) return;
    const player = this.state.players.get(playerId);
    const hand = this.hands.get(playerId);
    if (!player || !hand || !player.isBanker) return;

    /* 关键：先把分批扣牌的暂存区并回手里再让AI挑。
     * 分批扣牌时那几张牌已经从 hands 里移走了，如果直接拿当前手牌算，
     * 暂存的牌既不在手上也不在底牌里 —— 整局会凭空少几张牌（发牌数不守恒），
     * 后面墩数和结算全会错。庄家放了一半就挂机/掉线时必然踩到。 */
    const staged = this.discardStaging.get(playerId) ?? [];

    /* 庄家已经挑满了、只是没来得及点「确认埋底」就超时 ——
     * 这时该按他挑好的落底，而不是让 AI 推翻重挑。
     * 加了确认按钮之后这种情况会变常见（挑完在想要不要换），
     * 用 AI 结果覆盖等于把庄家的决策白扔了。 */
    if (staged.length === this.mode.discardCount) {
      this.commitDiscard(playerId, player, hand, staged);
      return;
    }

    const fullHand = staged.length > 0 ? [...hand, ...staged] : hand;
    this.discardStaging.delete(playerId);

    const discarded = chooseAiDiscard(fullHand, this.mode.discardCount, this.state.mainSuit);
    const discardedIds = new Set(discarded.map(card => card.id));
    const remainingHand = fullHand.filter(card => !discardedIds.has(card.id));
    this.bottomCards = discarded;
    this.hands.set(playerId, remainingHand);
    player.handCount = remainingHand.length;
    this.clients.find(item => item.sessionId === playerId)?.send('hand_update', { hand: remainingHand });
    this.broadcast('discard_done', {
      bankerId: playerId,
      bankerName: player.name,
      discardCount: this.mode.discardCount,
    });
    this.beginPlaying(player.seatIndex);
  }

  /** 当前暂存了几张。 */
  private stagedCount(playerId: string): number {
    return this.discardStaging.get(playerId)?.length ?? 0;
  }

  /** 把暂存区状态推给庄家，前端据此渲染底牌区与「还需几张」。 */
  private sendStagingUpdate(client: Client, playerId: string) {
    const staged = this.discardStaging.get(playerId) ?? [];
    client.send('discard_staged', {
      staged,
      stagedCount: staged.length,
      need: this.mode.discardCount,
      remaining: Math.max(0, this.mode.discardCount - staged.length),
      /* 够张数了 -> 前端把主按钮切成「确认埋底」。
       * 由服务端算而不是前端自己比大小：张数以暂存区为准，前端的本地计数
       * 在网络抖动时会和服务端不一致，那时按钮状态就会骗人。 */
      canConfirm: staged.length === this.mode.discardCount,
    });
  }

  /**
   * 分批扣牌 —— 放牌进底牌区。
   *
   * 允许一次放任意张数，凑够 discardCount 就自动提交（等价于原来的一次性扣底）。
   * 超出需要的张数会被拒绝，避免庄家把手牌扣穿。
   * 注意：这里不能清 phaseTimer —— 只是暂存，还没真正扣完，
   * 超时兜底必须继续有效，否则庄家放一半就挂机会让整桌永久卡住。
   */
  private handleDiscardStage(client: Client, cardIds: string[]) {
    if (this.state.phase !== Phase.Discarding) return;
    const player = this.state.players.get(client.sessionId);
    const hand = this.hands.get(client.sessionId);
    if (!player || !player.isBanker || !hand) return;
    if (cardIds.length === 0) return;

    const staged = this.discardStaging.get(client.sessionId) ?? [];
    const stagedIds = new Set(staged.map(c => c.id));
    const room = this.mode.discardCount - staged.length;
    if (cardIds.length > room) {
      client.send('error', { message: `底牌区还差 ${room} 张，一次放不了 ${cardIds.length} 张` });
      return;
    }

    // 必须都在手里、且没被放过（重复ID也要挡，否则同一张牌会被算两次）
    const handById = new Map(hand.map(c => [c.id, c]));
    const picked: CardData[] = [];
    const seen = new Set<string>();
    for (const id of cardIds) {
      const card = handById.get(id);
      if (!card || stagedIds.has(id) || seen.has(id)) {
        client.send('error', { message: '这张牌不在手上' });
        return;
      }
      seen.add(id);
      picked.push(card);
    }

    // 从手牌移到暂存区
    const pickedIds = new Set(picked.map(c => c.id));
    const nextHand = hand.filter(c => !pickedIds.has(c.id));
    const nextStaged = [...staged, ...picked];
    this.hands.set(client.sessionId, nextHand);
    this.discardStaging.set(client.sessionId, nextStaged);
    player.handCount = nextHand.length;
    client.send('hand_update', { hand: nextHand });
    this.sendStagingUpdate(client, client.sessionId);

    /* 凑够张数**不再**自动结算。
     *
     * 原来一凑够就直接开打，庄家误点最后一张就永久失去调整机会（底牌决定
     * 一整局的缺门布局，扣错一张可能直接输掉）。用户明确要求「选完牌后再
     * 做一个确认按钮，让确认一遍再开始打牌」。
     * 现在凑够只是告诉前端「可以确认了」，真正落底由 confirm_discard 触发。
     * 注意这里同样不能清 phaseTimer：庄家可能凑够了就挂机，超时兜底必须还在。 */
    if (nextStaged.length === this.mode.discardCount) {
      client.send('discard_ready', {
        stagedCount: nextStaged.length,
        need: this.mode.discardCount,
      });
    }
  }

  /**
   * 庄家点「确认埋底」。
   *
   * 独立成一个消息而不是复用 discard：discard 语义是「把这些牌一次交上来」，
   * 而这里是「底牌区里已经放好的就是我要扣的，开打」——参数不同，混用会让
   * 「确认」在还差几张时报出"不在手上"这种无关提示。
   */
  private handleConfirmDiscard(client: Client) {
    if (this.state.phase !== Phase.Discarding) return;
    const player = this.state.players.get(client.sessionId);
    const hand = this.hands.get(client.sessionId);
    if (!player || !player.isBanker || !hand) return;

    const staged = this.discardStaging.get(client.sessionId) ?? [];
    if (staged.length !== this.mode.discardCount) {
      const short = this.mode.discardCount - staged.length;
      client.send('error', {
        message: short > 0
          ? `底牌区还差 ${short} 张，凑够 ${this.mode.discardCount} 张才能确认`
          : `底牌区多了 ${-short} 张`,
      });
      return;
    }
    this.commitDiscard(client.sessionId, player, hand, staged);
  }

  /** 分批扣牌 —— 把底牌区的牌取回手上（放错了要能改）。 */
  private handleDiscardUnstage(client: Client, cardIds: string[]) {
    if (this.state.phase !== Phase.Discarding) return;
    const player = this.state.players.get(client.sessionId);
    const hand = this.hands.get(client.sessionId);
    if (!player || !player.isBanker || !hand) return;

    const staged = this.discardStaging.get(client.sessionId) ?? [];
    if (staged.length === 0) return;
    // 不传 ID 视为「全部取回」，前端的「清空底牌区」用这个
    const takeBackIds = cardIds.length > 0 ? new Set(cardIds) : new Set(staged.map(c => c.id));
    const takeBack = staged.filter(c => takeBackIds.has(c.id));
    if (takeBack.length === 0) return;

    const backIds = new Set(takeBack.map(c => c.id));
    this.discardStaging.set(client.sessionId, staged.filter(c => !backIds.has(c.id)));
    const nextHand = [...hand, ...takeBack];
    this.hands.set(client.sessionId, nextHand);
    player.handCount = nextHand.length;
    client.send('hand_update', { hand: nextHand });
    this.sendStagingUpdate(client, client.sessionId);
  }

  /** 扣底结算：落底牌、清计时器、进入出牌阶段。一次性扣底与分批扣满都走这里。 */
  private commitDiscard(
    playerId: string,
    player: PlayerState,
    remainingHand: CardData[],
    bottom: CardData[],
  ) {
    this.clearPhaseTimer();
    this.clearTimeoutStreak(playerId);
    this.discardStaging.delete(playerId);

    this.bottomCards = bottom;
    this.hands.set(playerId, remainingHand);
    player.handCount = remainingHand.length;

    console.log(`[GameRoom] 庄家 ${player.name} 扣底完成`);
    this.broadcast('discard_done', {
      bankerId: playerId,
      bankerName: player.name,
      discardCount: this.mode.discardCount,
    });
    this.beginPlaying(player.seatIndex);
  }

  /**
   * 处理扣底
   */
  private handleDiscard(client: Client, cardIds: string[]) {
    if (this.state.phase !== Phase.Discarding) return;
    
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.isBanker) return;

    const hand = this.hands.get(client.sessionId);
    if (!hand) return;

    /* 已经放进底牌区的牌要算进总数里。
     * 分批扣牌时手牌已经少了那几张，如果这里仍然要求"一次提交满 N 张"，
     * 庄家放了 5 张再点确认就会被拒，且提示还说"必须扣12张"，无从下手。 */
    const staged = this.discardStaging.get(client.sessionId) ?? [];
    const total = staged.length + cardIds.length;
    // 注意：校验未通过时必须保留超时兜底计时器，否则整桌会永久卡在扣底阶段。
    if (total !== this.mode.discardCount) {
      const short = this.mode.discardCount - total;
      client.send('error', {
        message: short > 0
          ? `还差 ${short} 张才够 ${this.mode.discardCount} 张`
          : `多了 ${-short} 张，只能扣 ${this.mode.discardCount} 张`,
      });
      return;
    }

    // 验证扣的牌都在手牌中
    const handIds = new Set(hand.map(c => c.id));
    for (const id of cardIds) {
      if (!handIds.has(id)) {
        client.send('error', { message: '扣的牌不在手牌中' });
        return;
      }
    }
    
    // 将扣的牌作为新底牌（含之前分批放进去的）
    const pickedIds = new Set(cardIds);
    const newBottom: CardData[] = [...staged];
    const remainingHand: CardData[] = [];

    for (const card of hand) {
      if (pickedIds.has(card.id)) newBottom.push(card);
      else remainingHand.push(card);
    }

    // 走到这里说明扣底合法，由 commitDiscard 统一收尾（清计时器 + 进入出牌）
    client.send('hand_update', { hand: remainingHand });
    this.commitDiscard(client.sessionId, player, remainingHand, newBottom);
  }

  private beginPlaying(leaderSeat: number) {
    this.state.phase = Phase.Playing;
    this.state.currentTurn = leaderSeat;
    this.state.trickLeader = leaderSeat;
    this.playRound = createPlayRound(this.mode.playerCount, leaderSeat);
    this.state.currentPlays.clear();
    this.state.requiredPlayCount = 0;
    this.promptPlayTurn(leaderSeat);
  }

  /** 将每家本墩的实际出牌按座位同步，不再把四家牌混成一手。 */
  private syncSeatPlay(seatIndex: number, cards: CardData[]) {
    const play = new TrickPlayState();
    play.seatIndex = seatIndex;
    for (const card of cards) {
      const cardSchema = new CardSchema();
      cardSchema.id = card.id;
      cardSchema.suit = card.suit;
      cardSchema.rank = card.rank;
      play.cards.push(cardSchema);
    }
    this.state.currentPlays.set(String(seatIndex), play);
    this.state.requiredPlayCount = this.playRound?.plays[0]?.cards.length ?? 0;
    this.state.currentWinnerSeat = this.playRound?.currentWinnerSeat ?? 255;
  }

  /**
   * 处理出牌
   */
  private handlePlay(client: Client, cardIds: string[]) {
    if (this.state.phase !== Phase.Playing) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (player.seatIndex !== this.state.currentTurn) {
      client.send('error', { message: '不是你的回合' });
      return;
    }

    const hand = this.hands.get(client.sessionId);
    if (!hand || !this.playRound) return;
    if (cardIds.length === 0 || new Set(cardIds).size !== cardIds.length) {
      client.send('error', { message: '请选择有效手牌' });
      return;
    }

    const cardIdSet = new Set(cardIds);
    const playedCards = hand.filter(card => cardIdSet.has(card.id));
    if (playedCards.length !== cardIds.length) {
      client.send('error', { message: '出的牌不在手牌中' });
      return;
    }

    let roundResult: RoundActionResult;
    try {
      roundResult = submitRoundPlay(
        this.playRound,
        player.seatIndex,
        playedCards,
        this.state.mainSuit,
        hand,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : '出牌不合法';
      const messages: Record<string, string> = {
        'invalid lead pattern': '首家领出的不是合法牌型',
        'must follow same count': '必须跟首家相同张数',
        'must follow lead category': '有首家花色必须优先跟足，不足才能垫牌或主杀',
      };
      client.send('error', { message: messages[reason] ?? reason });
      return;
    }

    // 真人自己出牌成功：撤掉超时计时器并清零连续超时。
    this.turnTimer?.clear();
    this.turnTimer = null;
    this.clearTimeoutStreak(client.sessionId);

    this.commitPlay(player, hand, playedCards, roundResult, client.sessionId);
  }

  /**
   * 甩牌。
   *
   * 规则（与产品确认）：
   * 1. 只有本墩首家能甩，且至少 2 张。
   *    「首家」= 每一墩第一个出牌的人（上墩赢家领出下墩），
   *    **不是**整局第一个出牌的人 —— 每墩的领出者都可以甩；
   * 2. 必须同门（主牌算一门，副牌按花色分门）；
   * 3. 甩出的必须是自己该门最大的若干张（等大的必须一起甩）；
   * 4. 其他任意一家手上该门只要有一张大于「所甩牌中最小的那张」，甩牌失败；
   * 5. 失败则收回甩牌，强制只打出那张最小的牌，本墩按单张继续，不额外罚分。
   *
   * 压制判定要读其他玩家手牌，因此只能在服务端做，客户端仅能做同门/最大的预校验。
   */
  private handleToss(client: Client, cardIds: string[]) {
    if (this.state.phase !== Phase.Playing) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (player.seatIndex !== this.state.currentTurn) {
      client.send('error', { message: '不是你的回合' });
      return;
    }

    const hand = this.hands.get(client.sessionId);
    if (!hand || !this.playRound) return;

    if (cardIds.length === 0 || new Set(cardIds).size !== cardIds.length) {
      client.send('error', { message: '请选择有效手牌' });
      return;
    }

    const cardIdSet = new Set(cardIds);
    const playedCards = hand.filter(card => cardIdSet.has(card.id));
    if (playedCards.length !== cardIds.length) {
      client.send('error', { message: '甩的牌不在手牌中' });
      return;
    }

    const isLeader = this.playRound.plays.length === 0;

    // 收集其他还有牌的玩家手牌用于压制判定
    const otherHands = new Map<number, CardData[]>();
    this.state.players.forEach((p: PlayerState) => {
      if (p.id === client.sessionId) return;
      const h = this.hands.get(p.id);
      if (h && h.length > 0) otherHands.set(p.seatIndex, h);
    });

    const outcome = resolveToss(playedCards, hand, otherHands, this.state.mainSuit, isLeader);

    // 资格不符：直接报错，不打出任何牌，让玩家重新选
    if (outcome.cards.length === 0) {
      const messages: Record<TossRejectReason, string> = {
        not_leader: '只有本墩先出牌的人可以甩牌，跟牌不能甩',
        too_few: '甩牌至少要 2 张',
        mixed_group: '甩牌必须是同一门牌（主牌算一门）',
        not_in_hand: '甩的牌不在手牌中',
      };
      const reason = outcome.reason;
      client.send('error', { message: reason ? messages[reason] : '甩牌不合法' });
      return;
    }

    let roundResult: RoundActionResult;
    try {
      roundResult = submitRoundPlay(
        this.playRound,
        player.seatIndex,
        outcome.cards,
        this.state.mainSuit,
        hand,
        // 甩牌成功时打出的是同门任意多张，不一定构成标准牌型，需显式放行。
        { tossLead: outcome.accepted && outcome.cards.length >= 2 },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : '甩牌不合法';
      client.send('error', { message: reason });
      return;
    }

    // 甩牌成功/失败都要让全场看到，客户端据此提示
    this.broadcast('toss_result', {
      seatIndex: player.seatIndex,
      playerName: player.name,
      success: outcome.accepted,
      cardIds: outcome.cards.map(c => c.id),
      attemptedCardIds: playedCards.map(c => c.id),
      blockedBy: outcome.blockedBy ?? [],
    });

    // 真人自己操作成功：撤掉超时计时器并清零连续超时
    this.turnTimer?.clear();
    this.turnTimer = null;
    this.clearTimeoutStreak(client.sessionId);

    this.commitPlay(player, hand, outcome.cards, roundResult, client.sessionId);
  }

  private promptPlayTurn(seatIndex: number) {
    this.turnTimer?.clear();
    this.turnTimer = null;
    this.state.currentTurn = seatIndex;
    // 换手了：提示要从「推荐的那一套」重新开始轮转，不能接着上一手的游标。
    this.hintCursor.clear();
    const playerId = this.playerBySeat.get(seatIndex);
    const player = playerId ? this.state.players.get(playerId) : undefined;
    if (!playerId || !player) return;
    const deadline = Date.now() + GameRoom.PLAY_SECONDS * 1000;
    this.broadcast('play_turn', {
      playerId,
      playerName: player.name,
      seatIndex,
      isLeader: (this.playRound?.plays.length ?? 0) === 0,
      requiredCount: this.playRound?.plays[0]?.cards.length ?? 0,
      timeLimit: GameRoom.PLAY_SECONDS,
      deadline,
      isTrustee: this.isServerControlled(player) && !player.isAI,
    });

    // AI、掉线接管和持续托管都直接由服务端代打，不再等30秒。
    if (this.isServerControlled(player)) {
      this.turnTimer = this.clock.setTimeout(() => {
        this.turnTimer = null;
        if (this.state.phase !== Phase.Playing || this.state.currentTurn !== seatIndex) return;
        if (player.isAI) this.performAiPlay(playerId);
        else this.performAutoPlay(playerId);
      }, 400);
      return;
    }

    // 真人超时代打一手；连续两次超时进入持续托管，玩家可随时收回。
    this.turnTimer = this.clock.setTimeout(() => {
      this.turnTimer = null;
      if (this.state.phase !== Phase.Playing || this.state.currentTurn !== seatIndex) return;
      const trustee = this.registerTimeout(player);
      this.broadcast('auto_play', {
        seatIndex,
        playerName: player.name,
        trustee,
      });
      this.performAutoPlay(playerId);
    }, GameRoom.PLAY_SECONDS * 1000);
  }

  /** 真人超时托管：用与AI相同的策略选一手合法牌并打出。 */
  private performAutoPlay(playerId: string) {
    if (this.state.phase !== Phase.Playing || !this.playRound) return;
    const player = this.state.players.get(playerId);
    const hand = this.hands.get(playerId);
    if (!player || player.isAI || !hand || hand.length === 0) return;
    if (player.seatIndex !== this.state.currentTurn) return;

    const leadCards = this.playRound.plays[0]?.cards ?? [];
    const action = chooseAiPlay(hand, leadCards, this.state.mainSuit, this.buildAiContext(player));
    const result = submitRoundPlay(
      this.playRound,
      player.seatIndex,
      action.cards,
      this.state.mainSuit,
      hand,
    );
    this.commitPlay(player, hand, action.cards, result, playerId, false);
  }

  /**
   * 提示：把一套合规的出牌方案私下返回给请求的玩家。
   *
   * 反复按提示会在多套方案之间轮转（第一套是AI推荐的最优解），按到最后一套
   * 再按会回到第一套。这样玩家可以「按提示 -> 撤回 -> 再按提示」看别的打法，
   * 而不是每次都收到同一手牌。
   * 游标在轮到自己出牌时清零（见 promptPlayTurn），所以每一手都从推荐开始。
   */
  private handleHint(client: Client) {
    if (this.state.phase !== Phase.Playing || !this.playRound) return;
    const player = this.state.players.get(client.sessionId);
    const hand = this.hands.get(client.sessionId);
    if (!player || !hand || player.seatIndex !== this.state.currentTurn) return;
    if (hand.length === 0) {
      client.send('error', { message: '你已经出完了，不用再看提示了' });
      return;
    }

    const leadCards = this.playRound.plays[0]?.cards ?? [];
    const options = enumerateHintPlays(
      hand,
      leadCards,
      this.state.mainSuit,
      this.buildAiContext(player),
    );
    if (options.length === 0) {
      client.send('error', { message: '暂时没有可推荐的牌' });
      return;
    }

    const cursor = this.hintCursor.get(client.sessionId) ?? 0;
    const index = cursor % options.length;
    this.hintCursor.set(client.sessionId, index + 1);
    client.send('hint_result', {
      cardIds: options[index].map(c => c.id),
      // nonce 让客户端能识别「同样的牌但是新一次提示」，否则 React 里
      // 内容相同的数组不会触发重选。
      nonce: index + 1,
      index,
      total: options.length,
    });
  }

  /** 扣底推荐：用与AI相同的扣底策略，返回最弱的discardCount张牌ID。 */
  private handleDiscardHint(client: Client) {
    if (this.state.phase !== Phase.Discarding) return;
    const player = this.state.players.get(client.sessionId);
    const hand = this.hands.get(client.sessionId);
    if (!player || !player.isBanker || !hand) return;

    /* 分批扣牌后手牌张数会变少，原来这里卡死"手牌必须正好是 perPlayer+bottomCount"，
     * 于是庄家一旦放进去一张，「提示」就悄悄失效（点了完全没反应，也没有报错）。
     * 现在按"还差几张"来推荐，且只在还没放满的牌里挑。 */
    const staged = this.discardStaging.get(client.sessionId) ?? [];
    const remaining = this.mode.discardCount - staged.length;
    if (remaining <= 0) return;
    if (hand.length < remaining) return;

    const recommended = chooseAiDiscard(hand, remaining, this.state.mainSuit);
    client.send('discard_hint_result', { cardIds: recommended.map(c => c.id) });
  }

  private performAiPlay(playerId: string) {
    if (this.state.phase !== Phase.Playing || !this.playRound) return;
    const player = this.state.players.get(playerId);
    const hand = this.hands.get(playerId);
    if (!player?.isAI || !hand || hand.length === 0) return;
    if (player.seatIndex !== this.state.currentTurn) return;

    const leadCards = this.playRound.plays[0]?.cards ?? [];
    const action = chooseAiPlay(hand, leadCards, this.state.mainSuit, this.buildAiContext(player));

    const result = submitRoundPlay(
      this.playRound,
      player.seatIndex,
      action.cards,
      this.state.mainSuit,
      hand,
    );
    this.commitPlay(player, hand, action.cards, result, playerId, true);
  }

  /** 出牌提交流程：真人、AI、超时托管共用。 */
  private commitPlay(
    player: PlayerState,
    hand: CardData[],
    playedCards: CardData[],
    roundResult: RoundActionResult,
    playerId: string,
    isAI: boolean = false,
  ) {
    this.playRound = roundResult.state;
    const playedIds = new Set(playedCards.map(card => card.id));
    const remainingHand = hand.filter(card => !playedIds.has(card.id));
    this.hands.set(playerId, remainingHand);
    player.handCount = remainingHand.length;
    this.playedCards.push(...playedCards);

    // 私下把更新后的手牌发给对应玩家（真人需要，AI无影响）
    const client = this.clients.find(c => c.sessionId === playerId);
    client?.send('hand_update', { hand: remainingHand });

    for (const card of playedCards) {
      const cardSchema = new CardSchema();
      cardSchema.id = card.id;
      cardSchema.suit = card.suit;
      cardSchema.rank = card.rank;
      this.state.currentTrick.push(cardSchema);
    }
    this.syncSeatPlay(player.seatIndex, playedCards);
    this.broadcast('player_played', {
      playerId,
      playerName: player.name,
      seatIndex: player.seatIndex,
      cards: playedCards,
      handCount: remainingHand.length,
      isAI,
    });

    // 有人打完最后一张牌也不能当场结算：本墩排在其后的座位必须继续跟完，
    // 否则最后一手的天王/大小王没有机会出手，挖底会被漏判。
    if (roundResult.state.resolved) {
      // 关键：不能在同一帧里 syncSeatPlay 完就 clear()。
      // Colyseus 只同步最终状态，立即收墩会让最后一家的牌永远不出现在客户端。
      // 先留一段展示时间，让四家的牌都亮完再收。
      this.scheduleTrickResolve(roundResult);
    } else {
      this.promptPlayTurn(roundResult.state.currentTurn);
    }
  }

  /**
   * 组装AI的阵营视角：只包含桌面公开信息和自己的身份，
   * 让AI知道该压谁、该给谁喂分，不读取任何隐藏手牌。
   */
  private buildAiContext(player: PlayerState): AiPlayContext {
    const round = this.playRound;
    const bankerSeat = this.state.bankerSeat;
    const isAlly = (seat: number) => (seat === bankerSeat) === player.isBanker;
    const leaderSeat = round?.plays[0]?.seat ?? player.seatIndex;
    const winnerSeat = round?.currentWinnerSeat ?? leaderSeat;

    return {
      playedCards: [...this.playedCards],
      deckCount: this.mode.deckCount,
      isBanker: player.isBanker,
      leaderIsAlly: isAlly(leaderSeat),
      currentWinningCards: round ? [...round.currentWinningCards] : [],
      winnerIsAlly: winnerSeat !== player.seatIndex && isAlly(winnerSeat),
      isLastToPlay: (round?.plays.length ?? 0) === this.mode.playerCount - 1,
      /* 是不是本局最后一墩。判据：这一墩打完手上就没牌了。
       *
       * 为什么必须告诉 AI：最后一墩决定底牌分归谁，闲家用天王/大小王
       * 赢下它还额外拿保底级数（挖底）。不给这个信号的话，AI 会一直
       * 省着天王不用，结果留到局终烂在手里 —— 闲家白丢挖底，
       * 庄家也不知道该在这一墩全力保底。
       *
       * 手牌数要算上本墩已经打出去的那几张：
       * 领出者出牌后 hand 已经少了，用 leadCards 长度补回来。 */
      isFinalTrick: this.isFinalTrick(player),
    };
  }

  /**
   * 这一墩是不是本局最后一墩（打完这墩手上就空了）。
   *
   * 用当前玩家的剩余手牌数判断：还没出牌的人手上剩几张，
   * 就代表还要打几墩（每墩每人出的张数相同）。
   */
  private isFinalTrick(player: PlayerState): boolean {
    const round = this.playRound;
    return calcIsFinalTrick({
      handCount: (this.hands.get(player.id) ?? []).length,
      perTrick: round?.plays[0]?.cards.length,
      alreadyPlayed: round?.plays.some(p => p.seat === player.seatIndex) ?? false,
    });
  }

  /**
   * 本墩已收满：先让最后一家的牌在桌上停留 TRICK_SHOW_MS，再真正收墩。
   * 这段停顿是可见性的一部分，不是装饰——没有它最后一手牌不会被渲染。
   */
  private scheduleTrickResolve(result: RoundActionResult) {
    this.trickResolveTimer?.clear();
    this.trickResolveTimer = this.clock.setTimeout(() => {
      this.trickResolveTimer = null;
      // 停顿期间房间可能已经进入其它阶段（掉线重开/结算），过期就丢弃。
      if (this.state.phase !== Phase.Playing) return;
      this.resolvePlayRound(result);
    }, GameRoom.TRICK_SHOW_MS);
  }

  /** 四家全部跟出相同张数后，本墩最大者抓分并领出下一墩。 */
  private resolvePlayRound(result: RoundActionResult) {
    const winnerSeat = result.roundWinnerSeat;
    if (winnerSeat === null || !this.playRound) return;
    const winnerCards = [...this.playRound.currentWinningCards];
    const allCards = this.playRound.plays.flatMap(play => play.cards);
    const trickScore = result.capturedScore;
    this.trickScores[winnerSeat] += trickScore;
    this.trickCount += 1;

    this.state.players.forEach((p: PlayerState) => {
      if (p.seatIndex === winnerSeat) p.takenScore = this.trickScores[p.seatIndex];
    });

    this.state.lastWinner = winnerSeat;
    this.lastWinningCards = [...winnerCards];
    this.state.lastTrick.length = 0;
    for (const card of allCards) {
      const cardSchema = new CardSchema();
      cardSchema.id = card.id;
      cardSchema.suit = card.suit;
      cardSchema.rank = card.rank;
      this.state.lastTrick.push(cardSchema);
    }
    /* 每家在这一墩实际打出的牌。结算页要把「大家最后一手牌」摆出来当证据
     * （用户原话：结算要突出大家最后一手牌是什么），所以这份按座位分开的
     * 记录不能只用于 trick_end 广播 —— 终局时要一起传给 settleGame。 */
    const seatPlays = this.playRound.plays.map(play => ({ seat: play.seat, cards: play.cards }));
    this.broadcast('trick_end', {
      winnerSeat,
      trickScore,
      allCards,
      plays: seatPlays,
    });

    // 本墩打完后才判断终局：任一玩家已无手牌则整局结束，
    // 用这一墩的赢家和赢牌判定挖底。
    if (this.isAnyHandEmpty()) {
      this.settleGame(winnerSeat, winnerCards, seatPlays);
      return;
    }

    this.state.currentTrick.length = 0;
    this.state.currentPlays.clear();
    this.state.requiredPlayCount = 0;
    this.state.currentWinnerSeat = 255;
    this.state.trickLeader = winnerSeat;
    this.state.round++;
    this.playRound = createPlayRound(this.mode.playerCount, winnerSeat);
    this.promptPlayTurn(winnerSeat);
  }

  /** 任一在座玩家已经打完手牌。张数相等时全场同墩打完，因此等价于终局。 */
  private isAnyHandEmpty(): boolean {
    let empty = false;
    this.state.players.forEach((p: PlayerState) => {
      if ((this.hands.get(p.id) ?? []).length === 0) empty = true;
    });
    return empty;
  }

  /**
   * 游戏结算
   */
  private settleGame(
    lastTrickWinner: number,
    winningCards: CardData[] = [],
    lastTrickPlays: { seat: number; cards: CardData[] }[] = [],
  ) {
    this.turnTimer?.clear();
    this.turnTimer = null;
    this.trickResolveTimer?.clear();
    this.trickResolveTimer = null;
    this.clearPhaseTimer();
    this.state.phase = Phase.Settling;

    const bankerId = this.playerBySeat.get(this.state.bankerSeat);
    const bankerRemainingCards = bankerId ? [...(this.hands.get(bankerId) ?? [])] : [];
    const bottomCards = [...this.bottomCards];

    // 座位 -> 是否庄家。computeSettlement 只认数组，不认 Schema。
    const isBankerBySeat: boolean[] = new Array(this.mode.playerCount).fill(false);
    this.state.players.forEach((p: PlayerState) => {
      isBankerBySeat[p.seatIndex] = p.isBanker;
    });

    /* 分数与级数的算术全在 logic/settlement.ts（纯函数、有单测）。
     * 这里只负责把结果写进 state、发广播、发奖 —— 算错级数直接等于
     * 算错金币和段位，那段逻辑必须能单独测。 */
    const s = computeSettlement({
      lastTrickWinner,
      winningCards,
      bankerSeat: this.state.bankerSeat,
      mainSuit: this.state.mainSuit,
      bankerRemainingCards,
      bottomCards,
      trickScores: this.trickScores,
      isBankerBySeat,
      callScore: this.state.callScore,
      deckCount: this.mode.deckCount,
      playerCount: this.mode.playerCount,
      totalScore: this.mode.totalScore,
    });

    this.state.players.forEach((p: PlayerState) => {
      p.score += s.deltas[p.seatIndex];
    });

    /* 房间累计战绩：这一桌打了几局、各家累计几级。
     * 放在写完 p.score 之后、组装广播之前 —— 顺序不重要，但集中在一处好核对。 */
    const outcome = resolveOutcomeKind({
      bankerWin: s.bankerWin,
      opponentScore: s.opponentScore,
      digSuccess: s.digSuccess,
    });
    this.recordRoundHistory({
      bankerSeat: this.state.bankerSeat,
      callScore: this.state.callScore,
      bankerWin: s.bankerWin,
      level: s.level,
      opponentScore: s.opponentScore,
      outcome,
      deltas: s.deltas,
    });

    const result = {
      /* 战果代号由服务端定，客户端只负责把它变成中文和动效。
       * 客户端本地也有一份同口径判定（老版本要兼容），但以这个字段为准 ——
       * 两边分档万一漂移，至少牌桌横幅和战绩列表说的是同一句话。 */
      outcome,
      /* 这是本房间的第几局，结算页要显示「第 3 局」。 */
      roundNo: this.state.roundsPlayed,
      bankerWin: s.bankerWin,
      finisherSeat: lastTrickWinner,
      finisherIsBanker: lastTrickWinner === this.state.bankerSeat,
      level: s.level,
      levelDeltas: s.deltas,
      callScore: this.state.callScore,
      opponentScore: s.opponentScore,
      bankerScore: s.bankerScore,
      scoreLevel: s.scoreLevel,
      digLevel: s.digLevel,
      trickScore: s.trickScore,
      endingTableScore: 0,
      remainingScore: s.remainingScore,
      bottomScore: s.bottomScore,
      bottomTaken: s.bottomTaken,
      digSuccess: s.digSuccess,
      digTianWangCount: s.digTianWangCount,
      digBigJokerCount: s.digBigJokerCount,
      digSmallJokerCount: s.digSmallJokerCount,
      digGuaranteeLevel: s.digGuaranteeLevel,
      lastTrickWinner,
      finalCards: winningCards,
      /* 最后一墩每家打的牌（座位 -> 牌）。
       * finalCards 只有赢家那一手，看不出别人是弃牌还是被压死；
       * 结算页要把四家的最后一手并排摆出来，玩家才能自己复盘。 */
      lastTrickPlays,
      bottomCards,
      bankerRemainingCards,
      /* 本局叫主/抢主/叫分的完整过程（谁叫的、亮了几张7、叫了多少分）。
       * 牌桌和结算页都要标明「是谁叫的」，而重连会丢掉逐条广播，
       * 所以整份日志随结算一起下发。 */
      auctionLog: this.auctionLog.map(e => ({ ...e })),
    };

    // 记下本局庄家：下一局由他先叫主（必须在 resetForNewRound 清空 bankerSeat 前存）。
    this.lastBankerSeat = this.state.bankerSeat;

    // 发金币 + 记战绩（真人且已登录的才发；AI 和未登录的跳过）
    const coinRewards = this.settleRewards({
      bankerWin: s.bankerWin,
      level: s.level,
      deltas: s.deltas,
      digSuccess: s.digSuccess,
      callScore: this.state.callScore,
      opponentScore: s.opponentScore,
    });

    this.broadcast('game_settled', { ...result, coinRewards });

    console.log('[GameRoom] 游戏结算:', result);

    // 结算窗口必须由玩家手动进入下一局，不自动关闭。
  }

  /**
   * 结算发奖：给每个已登录的真人发金币、累加积分、写战绩。
   *
   * 为什么放服务端：金币要能兑换实物，客户端算的一律不可信。
   * 单个账号写库失败不能连累整桌结算（比如账号被删了），所以逐个 try。
   *
   * @returns seatIndex -> 本局获得的金币，前端结算页据此显示「+410 金币」
   */
  /**
   * 逃跑惩罚：对局中途跑掉的按判负扣币，并额外加罚金。
   *
   * 不罚的话，眼看要输的人直接关页面就能免掉损失，
   * 留下的人白打一局 —— 这是所有带输赢的棋牌都必须堵的口子。
   * 用 escapedSessions 去重，避免"主动退出 + 重连超时"被扣两次。
   */
  private applyEscapePenalty(sessionId: string, player: PlayerState) {
    // 房卡局不动金币，自然也没有逃跑罚金（朋友局没必要罚钱）
    if (this.isCardRoom) return;
    const accountId = this.accountBySession.get(sessionId);
    if (!accountId) return;
    if (this.escapedSessions.has(sessionId)) return;
    this.escapedSessions.add(sessionId);

    const humanCount = [...this.state.players.values()].filter(p => !p.isAI).length;
    const isBanker = player.seatIndex === this.state.bankerSeat;
    // 用 1 级算：中途跑时本局还没结算，级数未定，按最低档罚最轻的那档
    const penalty = calcEscapePenalty(1, isBanker, this.tierId, humanCount);
    try {
      const applied = adjustBalanceClamped(accountId, 'coins', penalty, 'escape', '中途退出罚金');
      console.log(`[GameRoom] ${player.name} 逃跑罚金 ${applied}`);
      this.broadcast('player_escaped', {
        playerName: player.name,
        seatIndex: player.seatIndex,
        penalty: applied,
      });
    } catch (err) {
      console.error(`[GameRoom] 逃跑罚金扣除失败:`, err);
    }
  }

  private settleRewards(input: {
    bankerWin: boolean;
    level: number;
    deltas: number[];
    digSuccess: boolean;
    callScore: number;
    opponentScore: number;
  }): Record<number, number> {
    const rewards: Record<number, number> = {};
    // 防挂机刷币：带 3 个 AI 反复赢的收益要打折（大师场一局 3 万，不折会被刷穿）
    const humanCount = [...this.state.players.values()].filter(p => !p.isAI).length;
    const durationSec = this.roundStartedAt
      ? Math.max(1, Math.round((Date.now() - this.roundStartedAt) / 1000))
      : 0;
    // 同桌其他人的名字与段位，写进战绩供详情页展示（AI 也算，标注出来）
    const seatInfo: { seat: number; name: string; rankName: string }[] = [];
    this.state.players.forEach((p: PlayerState) => {
      seatInfo.push({
        seat: p.seatIndex,
        name: p.isAI ? `${p.name}(AI)` : p.name,
        rankName: rankNameOf(p.score),
      });
    });

    this.state.players.forEach((player: PlayerState) => {
      if (player.isAI) return;
      const accountId = this.accountBySession.get(player.id);
      if (!accountId) return;

      const isBanker = player.seatIndex === this.state.bankerSeat;
      // 庄家赢则庄家阵营赢，否则闲家阵营赢
      const iWon = isBanker ? input.bankerWin : !input.bankerWin;
      const scoreDelta = input.deltas[player.seatIndex] ?? 0;
      /* 房卡局金币一律为 0，但下面的 addScore / recordRound 照旧跑——
       * 用户明确要求房卡局也计入胜率与战绩统计。 */
      const coins = this.isCardRoom ? 0 : calcRoundCoins(
        iWon, input.level, isBanker, input.digSuccess, this.tierId, humanCount,
      );

      try {
        /* 赢的用 adjustBalance，输的必须用 adjustBalanceClamped：
         * 余额不足时 adjustBalance 会抛「金币不足」，那样这局的战绩和积分
         * 就全写不进去了（白打一局，比少扣几个币严重得多）。
         * 扣到 0 为止，实际扣掉多少就如实记多少。 */
        let settledCoins = coins;
        if (coins > 0) {
          adjustBalance(accountId, 'coins', coins, 'round', `赢 ${input.level} 级`);
        } else if (coins < 0) {
          settledCoins = adjustBalanceClamped(
            accountId, 'coins', coins, 'round', `输 ${input.level} 级`,
          );
        }
        addScore(accountId, scoreDelta);
        recordRound({
          accountId,
          // 用 state.modeId（camelCase，如 fourPlayerTwoDecks）而不是 mode.id
          // （snake_case，如 four_player_two_decks）：前端战绩页按 camelCase
          // 反查中文标签，写成 snake_case 会全部显示「未知模式」。
          modeId: this.state.modeId,
          iAmBanker: isBanker,
          iWon,
          level: input.level,
          scoreDelta,
          callScore: input.callScore,
          // 挖底只归闲家：庄家不存在"挖自己的底"
          digSuccess: input.digSuccess && !isBanker,
          coinsDelta: settledCoins,
          bankerWin: input.bankerWin,
          opponentScore: input.opponentScore,
          durationSec,
          trickCount: this.trickCount,
          isCardRoom: this.isCardRoom,
          /* 房间维度：战绩页要把「同一桌连着打的几局」折叠成一条来看。
           * roundsPlayed 在 recordRoundHistory 里已经自增过了，
           * 所以这里读到的就是本局的局号，和结算页/顶栏显示的是同一个数。 */
          roomId: this.roomId,
          roomRoundNo: this.state.roundsPlayed,
          opponents: seatInfo
            .filter(info => info.seat !== player.seatIndex)
            .map(info => ({ name: info.name, rankName: info.rankName })),
        });
        rewards[player.seatIndex] = settledCoins;
        // 账号积分是权威值，回写到房间状态，段位显示才跟得上
        const fresh = getById(accountId);
        if (fresh) player.score = fresh.score;
      } catch (err) {
        console.error(`[GameRoom] 给 ${player.name} 结算发奖失败:`, err);
      }
    });

    return rewards;
  }

  /**
   * 把一局的战果记进【房间累计战绩】。
   *
   * 为什么要有这份记录：一桌人往往连打十几把，中间会反复问"我们打了几把了？
   * 我到底赢了几级？"。逐条 game_settled 广播答不了这个问题 ——
   * 掉线重连、换设备、后来加入的人一条都收不到。写进 state 后，
   * 任何时刻连上来的客户端都能一次拿到完整历史。
   *
   * ⚠️ 这里累加的 `roomLevel` 与 `PlayerState.score`（账号终身积分，进房时从
   * 数据库带出来）是两回事。房间战绩只算"在这张桌子上"的输赢，
   * 所以退出房间后就该消失，不能拿去算段位。
   *
   * ⚠️ 必须只在这一个地方写 history，别在广播里再算一遍：
   * 记录和广播算出两个不同的结果是最难查的那种 bug。
   */
  private recordRoundHistory(input: {
    bankerSeat: number;
    callScore: number;
    bankerWin: boolean;
    level: number;
    opponentScore: number;
    outcome: OutcomeKind;
    deltas: number[];
  }) {
    const record = new RoundRecordState();
    // roundsPlayed 先自增，这局就是第 N 局（从 1 开始，玩家眼里没有"第 0 局"）。
    this.state.roundsPlayed += 1;
    record.roundNo = this.state.roundsPlayed;
    record.bankerSeat = input.bankerSeat;
    record.callScore = input.callScore;
    record.bankerWin = input.bankerWin;
    record.level = input.level;
    // opponentScore 是 uint16，理论上不会负，但流局那条传的是 0，保险起见夹一下。
    record.opponentScore = Math.max(0, Math.round(input.opponentScore));
    record.outcome = input.outcome;
    for (let seat = 0; seat < this.mode.playerCount; seat++) {
      record.deltas.push(input.deltas[seat] ?? 0);
    }
    this.state.history.push(record);

    this.state.players.forEach((p: PlayerState) => {
      p.roomLevel += input.deltas[p.seatIndex] ?? 0;
      if (p.seatIndex === input.bankerSeat) {
        p.roomBankerCount += 1;
        if (input.bankerWin) p.roomBankerWins += 1;
      }
    });
  }

  /**
   * 流局处理
   */
  private handleFlowBreak() {
    console.log('[GameRoom] 流局');
    this.clearPhaseTimer();
    this.turnTimer?.clear();
    this.turnTimer = null;

    const counts = Array.from({ length: this.mode.playerCount }, () => 0);
    this.state.players.forEach((player: PlayerState) => {
      counts[player.seatIndex] = (this.hands.get(player.id) ?? [])
        .filter(card => isMainCard(card, this.state.mainSuit)).length;
    });
    const maxCount = Math.max(...counts);
    const bankerSeat = counts.findIndex(count => count === maxCount);
    const deltas = createFlowBreakDeltas(counts);

    this.state.bankerSeat = bankerSeat;
    // 流局里「主牌最多者」被视为庄家，下一局也由他先叫主。
    this.lastBankerSeat = bankerSeat;
    this.state.players.forEach((player: PlayerState) => {
      player.score += deltas[player.seatIndex] ?? 0;
    });

    /* 流局也要进战绩：它照样动了各家的级数，漏记就会出现
     * 「逐局明细加起来 ≠ 累计级数」，玩家一定会发现并且不信这份记录。 */
    this.recordRoundHistory({
      bankerSeat,
      // 流局没人叫分，记 0 而不是硬塞一个假分数。
      callScore: 0,
      // 流局里"庄家"是被推出来背锅的，一定是输的一方。
      bankerWin: false,
      level: 1,
      opponentScore: 0,
      outcome: 'flow_break',
      deltas,
    });

    this.state.phase = Phase.Settling;
    this.broadcast('game_flow_break', {
      message: '全员放弃叫分，流局',
      mainCounts: counts,
      bankerSeat,
      losingSeats: [bankerSeat],
      levelDeltas: deltas,
      level: 1,
    });

    this.newRoundTimer = this.clock.setTimeout(() => {
      this.newRoundTimer = null;
      this.resetForNewRound();
    }, 5000);
  }

  /**
   * 重置为新的一局
   */
  private resetForNewRound() {
    this.newRoundTimer?.clear();
    this.newRoundTimer = null;
    // 发牌动画窗口里有人离桌时必须清掉，否则 2 秒后 beginCallingSuit 会
    // 在已经回到 Waiting 的房间里再把阶段推到叫主（阶段守卫也会拦，但别留悬空计时器）。
    this.dealTimer?.clear();
    this.dealTimer = null;
    this.turnTimer?.clear();
    this.turnTimer = null;
    this.trickResolveTimer?.clear();
    this.trickResolveTimer = null;
    this.clearPhaseTimer();
    this.timeoutStreak.clear();
    this.state.phase = Phase.Waiting;
    this.state.mainSuit = 255;
    this.state.mainSuitCallCount = 0;
    this.state.bankerSeat = 255;
    this.state.callScore = 0;
    this.state.nextBidMax = this.bidMax;
    this.state.bottomCount = 0;
    this.state.currentTurn = 0;
    this.state.round = 0;
    this.state.lastTrick.length = 0;
    this.state.currentTrick.length = 0;
    this.state.currentPlays.clear();
    this.state.requiredPlayCount = 0;
    this.state.lastWinner = 255;
    this.state.trickLeader = 255;
    this.state.currentWinnerSeat = 255;
    // 回到等待态，大厅列表恢复“空闲”并可被加入
    this.syncMetadata();
    
    this.hands.clear();
    this.bottomCards = [];
    this.discardStaging.clear();
    this.hintCursor.clear();
    this.playRound = null;
    this.trickScores = Array.from({ length: this.mode.playerCount }, () => 0);
    this.lastWinningCards = [];
    this.auctionLog = [];
    this.state.auction.length = 0;
    
    this.state.players.forEach((p: PlayerState) => {
      // AI没有可点击的“准备”按钮，新一局必须自动保持准备。
      p.isReady = p.isAI;
      p.isBanker = false;
      p.isCalling = false;
      p.takenScore = 0;
      p.handCount = 0;
      // 新一局解除超时托管；仍处于掉线状态的座位继续由AI接管。
      p.isAutoPlay = false;
      p.isTrusteeByOffline = p.isOffline;
      // 掉线未回来的座位由AI托管，必须自动算准备，否则下一局永远开不了。
      if (p.isTrusteeByOffline) p.isReady = true;
      const client = this.clients.find(item => item.sessionId === p.id);
      client?.send('hand_update', { hand: [] });
    });
    
    this.broadcast('new_round', {
      message: '新一局开始，请准备',
    });
  }
}
