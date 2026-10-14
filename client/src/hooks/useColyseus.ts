// ===== Colyseus 连接 Hook =====
// 管理与Colyseus服务器的连接、房间状态同步、消息收发

import { useState, useEffect, useCallback, useRef } from 'react';
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import type { Card, Suit, Rank, RoomState, Player, GamePhase, SettlementResult, BidEvent, ChatMessage, AuctionEntry, AuctionKind, RoundRecord } from '../types';
import type {
  ActionTimeoutMessage,
  AutoPlayMessage,
  ChatMessagePayload,
  DealBottomMessage,
  DealMessage,
  DeadlineMessage,
  DiscardHintResultMessage,
  DiscardStagedMessage,
  ErrorMessage,
  GameSettledMessage,
  HandUpdateMessage,
  HintResultMessage,
  PlayTurnMessage,
  ReconnectedMessage,
  ScoreBidMessage,
  TossResultMessage,
  TrickEndMessage,
  TrusteeMessage,
  VoiceMessagePayload,
  WireCard,
} from './serverMessages';
import { readArray, readCardIds, readNumber, readString } from './serverMessages';
import type { GameStateLike, PlayerStateLike, RoundRecordStateLike } from './roomStateShape';
import { sound, vibrate } from '../utils/sound';
import { getToken } from '../utils/api';
import { refreshAccount } from './useAccount';
import { VoiceRecorder, VoicePlayer, isVoiceSupported, isMicDenied } from '../utils/voice';
import { isVoiceMuted, setVoiceMutedPref } from '../utils/preferences';

// ===== 类型转换工具 =====
// 后端花色用数字(0-5)，前端用字符串('spade'|'heart'|'diamond'|'club'|'joker')
// 后端点数用数字(3-17)，前端用字符串('3'-'A','2','small_joker','big_joker')

/** 后端花色数字 -> 前端花色字符串 */
function suitNumToStr(suit: number): Suit {
  switch (suit) {
    case 0: return 'spade';
    case 1: return 'heart';
    case 2: return 'diamond';
    case 3: return 'club';
    case 4: return 'joker';  // 小王
    case 5: return 'joker';  // 大王
    default: return 'spade';
  }
}

/** 后端点数数字 -> 前端点数字符串 */
function rankNumToStr(rank: number): Rank {
  switch (rank) {
    case 3: return '3';
    case 4: return '4';
    case 5: return '5';
    case 6: return '6';
    case 7: return '7';
    case 8: return '8';
    case 9: return '9';
    case 10: return '10';
    case 11: return 'J';
    case 12: return 'Q';
    case 13: return 'K';
    case 14: return 'A';
    case 15: return '2';
    case 16: return 'small_joker';
    case 17: return 'big_joker';
    default: return '3';
  }
}

/** 前端花色字符串 -> 后端花色数字 */
function suitStrToNum(suit: Suit): number {
  switch (suit) {
    case 'spade': return 0;
    case 'heart': return 1;
    case 'diamond': return 2;
    case 'club': return 3;
    case 'joker': return 4;
    default: return 0;
  }
}

/** 后端CardData -> 前端Card */
function convertCard(card: WireCard): Card {
  return {
    id: card.id,
    suit: suitNumToStr(card.suit),
    rank: rankNumToStr(card.rank),
  };
}

/** 一批线上牌转成前端 Card；不是数组时得到空数组。 */
function convertCards(cards: WireCard[] | undefined): Card[] {
  return readArray(cards).map(convertCard);
}

/**
 * 一条叫主/叫分记录转成前端类型。
 *
 * kind 走白名单：服务端以后加了新类型（比如"反主"），旧客户端会把它
 * 当成未知值渲染成空白 —— 收敛成 'pass_suit' 至少不会画出一条无意义的记录。
 */
const AUCTION_KINDS: AuctionKind[] = [
  'call_suit', 'steal_suit', 'pass_suit', 'bottom_suit', 'bid', 'pass_bid',
];
function convertAuctionEntry(raw: {
  kind?: string;
  seatIndex?: number;
  playerName?: string;
  suit?: number;
  sevenCount?: number;
  score?: number;
} | undefined): AuctionEntry {
  const kind = AUCTION_KINDS.find(k => k === raw?.kind) ?? 'pass_suit';
  return {
    kind,
    seatIndex: readNumber(raw?.seatIndex, 255),
    playerName: readString(raw?.playerName, '玩家'),
    suit: readNumber(raw?.suit, 255),
    sevenCount: readNumber(raw?.sevenCount),
    score: readNumber(raw?.score),
  };
}

/**
 * 一条房间战绩记录转成前端类型。
 *
 * outcome 走白名单，理由同 convertAuctionEntry：服务端以后新增战果代号时，
 * 旧客户端拿到未知值会渲染成空白。收敛成 'flow_break'（"这局作废"的中性说法）
 * 比画一条没有战果的空行好——至少局数和级数还是对的。
 */
const OUTCOME_KINDS: RoundRecord['outcome'][] = [
  'bald', 'small_bald', 'hold', 'dig', 'over', 'flow_break',
];
function convertRoundRecord(raw: RoundRecordStateLike | undefined): RoundRecord {
  const deltas: number[] = [];
  // ArraySchema<number> 只能 forEach，不能当数组 map。
  raw?.deltas?.forEach(value => deltas.push(readNumber(value)));
  return {
    roundNo: readNumber(raw?.roundNo),
    // 座位的"空值"是 255，不是 0——兜底 0 会让面板把 0 号位错当庄家。
    bankerSeat: readNumber(raw?.bankerSeat, 255),
    callScore: readNumber(raw?.callScore),
    bankerWin: Boolean(raw?.bankerWin),
    level: readNumber(raw?.level),
    opponentScore: readNumber(raw?.opponentScore),
    outcome: OUTCOME_KINDS.find(k => k === raw?.outcome) ?? 'flow_break',
    deltas,
  };
}

/** 序列化Colyseus Schema状态为前端RoomState */
function serializeState(state: GameStateLike): RoomState {
  // 转换玩家列表
  const players: Player[] = [];
  state.players?.forEach((p: PlayerStateLike) => {
    players.push({
      id: p.id,
      name: p.name,
      seatIndex: p.seatIndex,
      isBanker: p.isBanker,
      score: p.score,
      takenScore: p.takenScore,
      isReady: p.isReady,
      isCalling: p.isCalling,
      isOffline: p.isOffline,
      isAI: p.isAI,
      isOwner: Boolean(p.isOwner),
      isAutoPlay: Boolean(p.isAutoPlay),
      isTrusteeByOffline: Boolean(p.isTrusteeByOffline),
      handCount: p.handCount,
      roomLevel: readNumber(p.roomLevel),
      roomBankerCount: readNumber(p.roomBankerCount),
      roomBankerWins: readNumber(p.roomBankerWins),
    });
  });
  players.sort((a, b) => a.seatIndex - b.seatIndex);

  // 转换上一轮出牌
  const lastTrick: Card[] = [];
  state.lastTrick?.forEach(c => lastTrick.push(convertCard(c)));

  // 转换当前轮出牌
  const currentTrick: Card[] = [];
  state.currentTrick?.forEach(c => currentTrick.push(convertCard(c)));

  const currentPlays: Record<number, Card[]> = {};
  state.currentPlays?.forEach((play, seatKey) => {
    const cards: Card[] = [];
    play.cards?.forEach(c => cards.push(convertCard(c)));
    currentPlays[Number(seatKey)] = cards;
  });

  // 叫主/叫分过程（ArraySchema，只能 forEach）
  const auction: AuctionEntry[] = [];
  state.auction?.forEach(entry => auction.push(convertAuctionEntry(entry)));

  // 房间累计战绩（同样是 ArraySchema）
  const history: RoundRecord[] = [];
  state.history?.forEach(entry => history.push(convertRoundRecord(entry)));

  // 转换主花色 (255=未定)
  // 255 = 还没定主。undefined 只会在状态尚未同步完时出现，同样按"未定"处理。
  const rawMainSuit = state.mainSuit;
  const mainSuit = rawMainSuit === undefined || rawMainSuit === 255
    ? null
    : suitNumToStr(rawMainSuit);

  return {
    modeId: String(state.modeId ?? 'fourPlayerTwoDecks'),
    modePlayerCount: Number(state.modePlayerCount ?? 4),
    phase: (state.phase ?? 'waiting') as GamePhase,
    mainSuit,
    mainSuitCallCount: readNumber(state.mainSuitCallCount),
    // 座位号的"空值"是 255（Schema 用 uint8，没法表示 null），不是 0——
    // 兜底写成 0 会让画面把 0 号位错当成庄家/赢家。
    bankerSeat: readNumber(state.bankerSeat, 255),
    callScore: readNumber(state.callScore),
    nextBidMax: readNumber(state.nextBidMax),
    totalScore: readNumber(state.totalScore),
    currentTurn: readNumber(state.currentTurn),
    lastTrick,
    lastWinner: readNumber(state.lastWinner, 255),
    currentTrick,
    currentPlays,
    requiredPlayCount: readNumber(state.requiredPlayCount),
    currentWinnerSeat: readNumber(state.currentWinnerSeat, 255),
    trickLeader: readNumber(state.trickLeader, 255),
    players,
    round: readNumber(state.round),
    bottomCount: readNumber(state.bottomCount),
    auction,
    history,
    /* 不用 history.length 代替：服务端明确给了标量，两者不一致本身就是信号
     * （比如 history 还没同步完），照抄服务端的值更诚实。 */
    roundsPlayed: readNumber(state.roundsPlayed),
  };
}

// ===== Hook 定义 =====

/**
 * 后端 WebSocket 地址。
 *
 * 优先用 VITE_COLYSEUS_URL（线上通过 Nginx 反代到 /colyseus 时必须显式配）。
 * 未配置时按当前页面来源推断，分三种情况：
 *  - 单端口部署：前端由后端自己托管，同源同端口，直接用 location.host，
 *    这样换端口或走 HTTPS(wss) 都不用改代码；
 *  - vite dev server 走 HTTPS（npm run dev:https，为了手机上能开麦克风）：
 *    页面是 https 时浏览器禁止连明文 ws://（混合内容会被直接掐断），
 *    所以走 vite 的 /colyseus-ws 代理，同源同端口由 vite 终结 TLS
 *    再明文转给本机 2567（代理规则见 client/vite.config.ts）；
 *  - vite dev server 走 HTTP：前后端分离，直连 :2567 最省事。
 */
function inferColyseusUrl(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:2567';
  const { protocol, hostname, port } = window.location;
  const isHttps = protocol === 'https:';
  const scheme = isHttps ? 'wss' : 'ws';
  // 后端自托管前端时同源，不能写死 2567
  const isDevServer = port !== '' && port !== '2567';
  if (!isDevServer) return `${scheme}://${window.location.host}`;
  // 这个前缀必须和 vite.config.ts 里的 proxy key 一致
  if (isHttps) return `wss://${window.location.host}/colyseus-ws`;
  return `ws://${hostname}:2567`;
}

const COLYSEUS_URL = import.meta.env.VITE_COLYSEUS_URL || inferColyseusUrl();
const ROOM_NAME = 'game'; // 后端注册的房间类型名: gameServer.define('game', GameRoom)

/**
 * 断线后服务端保留座位的时长（毫秒）。
 *
 * ⚠️ 必须与服务端 GameRoom.onLeave 里的 `allowReconnection(client, 120)` 一致。
 * 这个值只用于在重连遮罩上显示倒计时，超时判定权在服务端；
 * 两边不一致时玩家会看到「倒计时还剩很多但座位已被释放并挨了罚金」，
 * 或者「倒计时归零了却还在转圈」——都比没有倒计时更让人困惑。
 */
export const RECONNECT_WINDOW_MS = 120_000;

/** 游戏操作接口 */
export interface GameActions {
  createRoom: (playerName: string, aiCount?: number, customRoomId?: string, modeId?: string, tier?: string, cardRoom?: boolean) => Promise<string>;
  joinRoom: (roomCode: string, playerName: string) => Promise<void>;
  leaveRoom: () => void;
  sendReady: () => void;
  sendPlay: (cards: Card[]) => void;
  sendPass: () => void;
  sendCallSuit: (suit: Suit | null) => void;
  sendCallScore: (score: number) => void;
  sendDiscard: (cards: Card[]) => void;
  /** 分批扣牌：把选中的牌放进底牌区（凑够张数服务端自动结算）。 */
  stageDiscard: (cards: Card[]) => void;
  /** 分批扣牌：把底牌区的牌取回手上；不传则全部取回。 */
  unstageDiscard: (cards?: Card[]) => void;
  /** 确认埋底：底牌区凑够张数后由庄家手动确认才开打。 */
  confirmDiscard: () => void;
  sendToss: (cards: Card[]) => void;
  sendChat: (text: string) => void;
  /** 按住说话：开始采集并推流。返回 false = 不支持或被拒授权。 */
  startVoice: () => Promise<boolean>;
  /** 松手：停止采集。 */
  stopVoice: () => void;
  sendDiscardHint: () => void;
  clearDiscardHint: () => void;
  sendHint: () => void;
  clearHint: () => void;
  returnToLobby: () => void;
  resumeControl: () => void;
  addAi: () => void;
  removeAi: () => void;
  kickPlayer: (playerId: string) => void;
  setMuted: (muted: boolean) => void;
  /** 听筒开关：关掉后不再播别人的语音（不影响音效，也不影响自己说话）。 */
  setVoiceMuted: (muted: boolean) => void;
}

/** Hook 返回值 */
interface UseColyseusReturn {
  roomState: RoomState | null;
  myPlayerId: string | null;
  myHand: Card[];
  /** 发牌序号：自增一次代表新发了一手牌，牌桌据此重播发牌动画。 */
  dealKey: number;
  bottomCards: Card[];
  settlementResult: SettlementResult | null;
  bidHistory: BidEvent[];
  roomId: string | null;
  isConnected: boolean;
  error: string | null;
  turnDeadline: number | null;
  hintCardIds: string[];
  /**
   * 提示的轮转信息：每次收到提示都会变（哪怕牌一样），客户端据此重新选牌，
   * 并告诉玩家现在看的是第几套方案。
   */
  hintInfo: { seq: number; index: number; total: number } | null;
  lastTrickPlays: Record<number, Card[]>;
  autoPlaySeat: number | null;
  scorePopup: { score: number; seat: number; key: number } | null;
  chatMessages: ChatMessage[];
  discardHintIds: string[];
  /** 分批扣牌：已放进底牌区的牌。 */
  stagedDiscards: Card[];
  isReconnecting: boolean;
  /**
   * 重连窗口的截止时间戳（ms）。牌桌用它在遮罩上倒计时，
   * 让玩家知道「还有多久必须回来」，而不是干等一片静止。
   */
  reconnectDeadline: number | null;
  isTrustee: boolean;
  tossNotice: string | null;
  /** 本机是否具备录音能力（决定语音按钮显不显示）。 */
  voiceSupported: boolean;
  /** 听筒是否关着（关了就听不到别人说话）。 */
  voiceMuted: boolean;
  /** 我正在说话（按住中）。 */
  isTalking: boolean;
  /** 自己麦克风的实时电平 0~1（按住说话的音量反馈；没在说话时为 0）。 */
  micLevel: number;
  /** 正在说话的其他玩家 id 集合，座位上要显示声波标。 */
  speakingIds: string[];
  actions: GameActions;
}

export function useColyseus(): UseColyseusReturn {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [myHand, setMyHand] = useState<Card[]>([]);
  /** 发牌序号：每收到一次 deal 就自增，牌桌用它作为发牌动画的重播信号。 */
  const [dealKey, setDealKey] = useState(0);
  const [bottomCards, setBottomCards] = useState<Card[]>([]);
  const [settlementResult, setSettlementResult] = useState<SettlementResult | null>(null);
  const [bidHistory, setBidHistory] = useState<BidEvent[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);
  const [hintCardIds, setHintCardIds] = useState<string[]>([]);
  const [hintInfo, setHintInfo] = useState<{ seq: number; index: number; total: number } | null>(null);
  /** 提示序号只在本地自增，服务端的 nonce 只用来判断"这是新的一次提示"。 */
  const hintSeqRef = useRef(0);
  const [lastTrickPlays, setLastTrickPlays] = useState<Record<number, Card[]>>({});
  const [autoPlaySeat, setAutoPlaySeat] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [discardHintIds, setDiscardHintIds] = useState<string[]>([]);
  /** 分批扣牌暂存区（服务端权威，前端只渲染）。 */
  const [stagedDiscards, setStagedDiscards] = useState<Card[]>([]);
  const [scorePopup, setScorePopup] = useState<{ score: number; seat: number; key: number } | null>(null);

  const [isReconnecting, setIsReconnecting] = useState(false);
  /**
   * 重连窗口截止时间。
   *
   * 120000 必须和服务端 GameRoom.onLeave 里的 allowReconnection(client, 120)
   * 保持一致：这个数字改了那边不改，玩家会看到倒计时归零却仍在重连
   * （或倒计时还剩很多但座位已经被释放、还挨了逃跑罚金）。
   */
  const [reconnectDeadline, setReconnectDeadline] = useState<number | null>(null);
  const [isTrustee, setIsTrustee] = useState(false);

  /**
   * 错误提示自动消失。
   *
   * 定时器必须放 ref 里统一管理，原因有两个：
   *  1. 之前「网络已断开」这类提示**根本没有清除逻辑**，红条会一直挂在大厅上。
   *     大厅那个 onClick 只清得掉它自己的 localError，清不掉这里的 error，
   *     玩家实际上只能刷新页面才能让提示消失。
   *  2. 连续来两条提示时，如果各自挂一个 setTimeout，前一条的倒计时到点会把
   *     后一条刚显示的内容一起清掉 —— 新提示必须先顶掉旧定时器。
   */
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((message: string, autoHideMs = 4000) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setError(message);
    errorTimerRef.current = setTimeout(() => {
      errorTimerRef.current = null;
      setError(null);
    }, autoHideMs);
  }, []);

  const clearError = useCallback(() => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    setError(null);
  }, []);

  /**
   * 进入「重连中」。
   *
   * 用 setState 的函数式写法保留已有截止时间，是因为一次掉线会从**多个**入口
   * 触发这里：navigator 的 offline 事件通常最先到，接着 SDK 的 onDrop，
   * 非常规关闭码还会再走一次 onLeave 里的兜底重连。
   * 每次都重算 deadline 的话，倒计时会被反复推回 120 秒，
   * 玩家看到的数字忽上忽下，反而不如没有倒计时。
   */
  const beginReconnecting = useCallback(() => {
    setIsConnected(false);
    setIsReconnecting(true);
    setReconnectDeadline(prev => prev ?? Date.now() + RECONNECT_WINDOW_MS);
  }, []);

  /** 退出「重连中」（重连成功、或彻底放弃回大厅）。 */
  const endReconnecting = useCallback(() => {
    setIsReconnecting(false);
    setReconnectDeadline(null);
  }, []);

  // ===== 实时语音 =====
  // 录音器/播放器是长生命周期对象，放 ref 里，不参与渲染。
  const voiceRecRef = useRef<VoiceRecorder | null>(null);
  const voicePlayerRef = useRef<VoicePlayer | null>(null);
  const [isTalking, setIsTalking] = useState(false);
  /**
   * 自己麦克风的实时电平（0~1），用于「按住说话」的音量反馈。
   *
   * 为什么必须是真实电平而不是一个假动画：用户反馈「按住说话没反馈，不知道
   * 有没有在发送语音」。假动画只能证明"按钮被按下了"，证明不了麦克风真的在
   * 收音 —— 权限给了但麦克风被别的 App 占用、系统静音、蓝牙耳机没切过来，
   * 按钮一样会变色而对方什么都听不到。电平条会跟着说话声跳动才是可信反馈。
   */
  const [micLevel, setMicLevel] = useState(0);
  // 谁在说话：收到分片就点亮，700ms 没有新分片就熄灭（分片间隔 250ms，
  // 700ms 足够容忍一次抖动，又不会让标记在松手后一直亮着）。
  const [speakingIds, setSpeakingIds] = useState<string[]>([]);
  const speakingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [voiceSupported] = useState(isVoiceSupported);
  /**
   * 「听筒」开关：是否关掉别人的语音。
   *
   * 和音效静音分开：原来只有一个总静音，关语音会把出牌音效一起关掉。
   * 这个只管别人的语音，不影响音效、也不影响自己按住说话。
   */
  const [voiceMuted, setVoiceMutedState] = useState(isVoiceMuted);
  /** 甩牌成功/失败的全场提示，几秒后自动消失 */
  const [tossNotice, setTossNotice] = useState<string | null>(null);

  const clientRef = useRef<Client | null>(null);
  const roomRef = useRef<Room | null>(null);
  const bottomCardsRef = useRef<Card[]>([]);
  /** 掉线自动重连用的凭证，主动退出时清空。 */
  const reconnectTokenRef = useRef<string | null>(null);
  const intentionalLeaveRef = useRef(false);

  // 初始化Colyseus客户端
  useEffect(() => {
    clientRef.current = new Client(COLYSEUS_URL);
    // 提前建好录音器/播放器实例：构造函数只是初始化字段，start() 之前不会
    // 碰麦克风。这样 cleanup 里可以用局部变量而不是读 ref.current
    // （后者在 cleanup 执行时可能已经被换掉）。
    const rec = voiceRecRef.current ?? (voiceRecRef.current = new VoiceRecorder());
    const player = voicePlayerRef.current ?? (voicePlayerRef.current = new VoicePlayer());
    const timers = speakingTimersRef.current;
    return () => {
      roomRef.current?.leave();
      roomRef.current = null;
      // 组件卸载必须显式关麦：只丢引用不会释放麦克风，
      // 浏览器地址栏的录音红点会一直亮着。
      rec.stop();
      player.clear();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  /**
   * 物理断网即时提示（navigator.onLine）。
   *
   * 为什么不能只靠 WebSocket 的 onDrop：ws 要等心跳/TCP 超时才认定断开，
   * 手机进电梯或飞行模式时这中间有好几秒空窗，玩家看到的是牌桌莫名静止。
   * 浏览器的 offline 事件在网卡掉的那一刻就到，用它把遮罩**提前**盖上。
   *
   * 注意 onLine 只说明「有没有链路」，不代表连得上服务器（连着没有外网的 Wi-Fi
   * 时 onLine 仍是 true），所以它只做提前预警，真正判定恢复仍以 ws 重连成功为准。
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOffline = () => {
      // 只在牌桌里提示。大厅本来就是静态页面，盖遮罩反而莫名其妙。
      if (!roomRef.current || intentionalLeaveRef.current) return;
      beginReconnecting();
    };

    const handleOnline = () => {
      // 网卡回来了不等于房间已重连好，遮罩要留给 onReconnect 撤。
      // 这里只负责在「网断了但还没进牌桌」的情况下清掉过期的错误提示。
      if (!roomRef.current) clearError();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [clearError, beginReconnecting]);

  // 卸载时清掉错误提示的定时器，避免在已卸载组件上 setState
  useEffect(() => () => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
  }, []);

  // 掉线/主动退出后清空本地牌桌状态，回到大厅
  const clearRoomLocalState = useCallback(() => {
    reconnectTokenRef.current = null;
    endReconnecting();
    setIsTrustee(false);
    setRoomState(null);
    setMyPlayerId(null);
    setMyHand([]);
    setBottomCards([]);
    setSettlementResult(null);
    bottomCardsRef.current = [];
    setRoomId(null);
    setIsConnected(false);
    roomRef.current = null;
  }, [endReconnecting]);

  // 绑定房间事件监听
  /* bindRoom 需要在自己内部（onLeave 的兜底重连里）再次调用自己，
   * 而 useCallback 拿不到"自己"的稳定引用，所以放一个 ref 中转。 */
  const bindRoomRef = useRef<((room: Room) => void) | null>(null);

  const bindRoom = useCallback((room: Room) => {
    roomRef.current = room;
    setMyPlayerId(room.sessionId);
    setRoomId(room.roomId);
    setIsConnected(true);
    endReconnecting();
    clearError();
    reconnectTokenRef.current = room.reconnectionToken ?? null;
    intentionalLeaveRef.current = false;
    /* 与服务端 allowReconnection(120s) 对齐：放宽自动重连的次数与最短在线时长。
     * 仍然判空——这些字段是 SDK 0.17 才有的，安卓壳里可能装着旧包。 */
    const rc = room.reconnection;
    if (rc) {
      rc.maxRetries = 20;
      rc.maxDelay = 6000;
      rc.minUptime = 0;
    }

    // 状态变化监听 -> 序列化后同步到React
    room.onStateChange((state: GameStateLike) => {
      const serialized = serializeState(state);
      setRoomState(serialized);
      // 非扣底阶段清除底牌缓存
      if (serialized.phase !== 'discarding' && bottomCardsRef.current.length > 0) {
        bottomCardsRef.current = [];
        setBottomCards([]);
      }
      // 离开扣底阶段后底牌区必须清空，否则出牌阶段还留着一排"已扣的牌"
      if (serialized.phase !== 'discarding') setStagedDiscards(prev => (prev.length ? [] : prev));
    });

    // 收到发牌消息（提前设置手牌减少UI延迟）
    room.onMessage('deal', (message: DealMessage) => {
      setSettlementResult(null);
      setBidHistory([]);
      setDiscardHintIds([]);
      setChatMessages([]);
      setMyHand(convertCards(message.hand));
      // 每次发牌换一个新的 dealKey，牌桌据此重播「飞牌 → 翻面 → 理牌」动画。
      // 用自增序号而不是布尔量：连续两局的手牌可能长度相同，
      // 布尔量会因为 React 判定「值没变」而不重播。
      setDealKey(k => k + 1);
    });

    room.onMessage('game_settled', (message: GameSettledMessage) => {
      setSettlementResult({
        bankerWin: Boolean(message.bankerWin),
        finisherSeat: readNumber(message.finisherSeat, 255),
        finisherIsBanker: Boolean(message.finisherIsBanker),
        level: readNumber(message.level),
        levelDeltas: readArray(message.levelDeltas).map(value => readNumber(value)),
        callScore: readNumber(message.callScore),
        opponentScore: readNumber(message.opponentScore),
        bankerScore: readNumber(message.bankerScore),
        scoreLevel: readNumber(message.scoreLevel),
        digLevel: readNumber(message.digLevel),
        trickScore: readNumber(message.trickScore),
        endingTableScore: readNumber(message.endingTableScore),
        remainingScore: readNumber(message.remainingScore),
        bottomScore: readNumber(message.bottomScore),
        bottomTaken: Boolean(message.bottomTaken),
        digSuccess: Boolean(message.digSuccess),
        digTianWangCount: readNumber(message.digTianWangCount),
        digBigJokerCount: readNumber(message.digBigJokerCount),
        digSmallJokerCount: readNumber(message.digSmallJokerCount),
        digGuaranteeLevel: readNumber(message.digGuaranteeLevel),
        lastTrickWinner: readNumber(message.lastTrickWinner, 255),
        finalCards: convertCards(message.finalCards),
        lastTrickPlays: readArray(message.lastTrickPlays).map(play => ({
          seat: readNumber(play?.seat, 255),
          cards: convertCards(play?.cards),
        })),
        auctionLog: readArray(message.auctionLog).map(convertAuctionEntry),
        bottomCards: convertCards(message.bottomCards),
        bankerRemainingCards: convertCards(message.bankerRemainingCards),
        coinRewards: message.coinRewards ?? undefined,
      });

      // 战绩与金币由服务端在结算时落库（GameRoom.settleRewards），
      // 这里只需要把顶栏余额和战绩汇总重新拉一次。
      // 之前是前端自己往 localStorage 写一条记录 —— 换设备就没了，也能随手改。
      void refreshAccount();
    });

    room.onMessage('new_round', () => setSettlementResult(null));

    room.onMessage('score_bid', (message: ScoreBidMessage) => {
      setBidHistory(previous => [
        ...previous,
        {
          playerId: readString(message.playerId),
          playerName: readString(message.playerName, '玩家'),
          seatIndex: readNumber(message.seatIndex, 255),
          score: readNumber(message.score),
        },
      ]);
    });

    // 这些是用于动画/提示的广播，核心画面仍以 Schema 状态为准。
    // 显式订阅可避免 SDK 将每次 AI 出牌误报为“未注册消息”。
    const informationalMessages = [
      // 发牌动画由 'deal' 带来的 dealKey 驱动，deal_start 只是服务端广播的时间线提示；
      // 不订阅会被 SDK 当成「未注册消息」刷 warning。
      'deal_start',
      'discard_done',
      'game_flow_break',
      'player_joined',
      'player_left',
      'player_reconnected',
      'room_full',
      'score_called',
      'suit_called',
      'suit_from_bottom',
    ];
    informationalMessages.forEach(messageType => room.onMessage(messageType, () => undefined));

    // 叫主/叫分/扣底同样有服务端超时兜底，前端需要显示倒计时
    const trackDeadline = (message: DeadlineMessage) => {
      if (typeof message?.deadline === 'number') setTurnDeadline(message.deadline);
      else if (typeof message?.timeLimit === 'number') {
        setTurnDeadline(Date.now() + message.timeLimit * 1000);
      }
    };
    room.onMessage('call_suit_turn', trackDeadline);
    room.onMessage('call_score_turn', trackDeadline);
    room.onMessage('discard_turn', trackDeadline);

    // 有人操作超时被系统代打
    room.onMessage('action_timeout', (message: ActionTimeoutMessage) => {
      setAutoPlaySeat(readNumber(message.seatIndex, 255));
      setTimeout(() => setAutoPlaySeat(null), 2000);
    });

    // 出牌回合：记录截止时间用于倒计时
    room.onMessage('play_turn', (message: PlayTurnMessage) => {
      trackDeadline(message);
      // 新的一手：提示选中和轮转角标都要清掉，否则上一手的 "3/5" 会留在按钮上
      setHintCardIds([]);
      setHintInfo(null);
    });

    // 提示结果
    room.onMessage('hint_result', (message: HintResultMessage) => {
      setHintCardIds(readCardIds(message.cardIds));
      hintSeqRef.current += 1;
      setHintInfo({
        seq: hintSeqRef.current,
        index: readNumber(message.index),
        // 总数兜底给 1 而不是 0：角标要显示「1/N」，N 为 0 会写出「1/0」。
        total: readNumber(message.total, 1),
      });
      sound.hint();
      vibrate(10);
    });

    // 有人超时自动托管
    room.onMessage('auto_play', (message: AutoPlayMessage) => {
      setAutoPlaySeat(readNumber(message.seatIndex, 255));
      setTimeout(() => setAutoPlaySeat(null), 2000);
    });

    // 进入托管（自己超时两次或掉线被接管）
    room.onMessage('trustee_on', (message: TrusteeMessage) => {
      if (message.playerId === room.sessionId) setIsTrustee(true);
    });

    // 解除托管
    room.onMessage('trustee_off', (message: TrusteeMessage) => {
      if (message.playerId === room.sessionId) setIsTrustee(false);
    });

    // 重连成功后服务端回传当前状态
    room.onMessage('reconnected', (message: ReconnectedMessage) => {
      setIsTrustee(Boolean(message.isTrustee));
      const bottom = convertCards(message.bottomCards);
      if (bottom.length > 0) {
        bottomCardsRef.current = bottom;
        setBottomCards(bottom);
      }
    });

    // 出牌音效
    room.onMessage('player_played', () => {
      sound.play();
      vibrate(15);
    });

    // 一墩结束：胜者抓分音效，并把本墩四家牌留作回放
    room.onMessage('trick_end', (message: TrickEndMessage) => {
      sound.trick();
      const trickScore = readNumber(message.trickScore);
      if (trickScore > 0) {
        setTimeout(() => sound.score(), 120);
        setScorePopup({
          score: trickScore,
          seat: readNumber(message.winnerSeat, 255),
          key: Date.now(),
        });
        setTimeout(() => setScorePopup(null), 1400);
      }
      const plays: Record<number, Card[]> = {};
      for (const p of readArray(message.plays)) {
        plays[readNumber(p.seat, 255)] = convertCards(p.cards);
      }
      setLastTrickPlays(plays);
      setHintCardIds([]);
      setHintInfo(null);
    });

    room.onMessage('game_settled', (message: GameSettledMessage) => {
      if (message.bankerWin) sound.win();
      else sound.win(); // 结算统一用悦耳音，胜负细分可后续调
      vibrate([30, 40, 30]);
    });

    // 服务端私下同步自己的完整手牌，避免对手从公共状态读取牌面
    room.onMessage('hand_update', (message: HandUpdateMessage) => {
      setMyHand(convertCards(message.hand));
    });

    // 收到底牌消息（庄家扣底阶段）
    room.onMessage('deal_bottom', (message: DealBottomMessage) => {
      const cards = convertCards(message.bottomCards);
      bottomCardsRef.current = cards;
      setBottomCards(cards);
    });

    // 分批扣牌：服务端回传当前底牌区内容
    room.onMessage('discard_staged', (message: DiscardStagedMessage) => {
      setStagedDiscards(convertCards(message?.staged));
    });

    /* 底牌凑够了：服务端不再自动开打，等庄家点「确认埋底」。
     * 这条消息只是提示前端把按钮切过去，真实判定仍以 discard_staged 的
     * canConfirm / 张数为准（网络乱序时不能只靠这条）。 */
    room.onMessage('discard_ready', () => undefined);

    // 甩牌结果：成功/失败都要给全场提示（失败时服务端已强制改为出最小一张）
    room.onMessage('toss_result', (message: TossResultMessage) => {
      const who = readString(message?.playerName, '玩家');
      if (message?.success) {
        setTossNotice(`${who} 甩牌成功`);
        sound.trick();
      } else {
        const attempted = readArray(message?.attemptedCardIds).length;
        setTossNotice(`${who} 甩牌失败，已改为只出最小的 1 张${attempted ? `（原甩 ${attempted} 张）` : ''}`);
        sound.lose();
      }
      vibrate(20);
      setTimeout(() => setTossNotice(null), 3500);
    });

    // 错误消息
    room.onMessage('error', (message: ErrorMessage) => {
      showError(message?.message || '未知错误', 3000);
    });

    // 聊天
    room.onMessage('chat', (message: ChatMessagePayload) => {
      setChatMessages(prev => {
        const next = [...prev, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          playerId: readString(message.playerId),
          playerName: readString(message.playerName, '玩家'),
          text: readString(message.text),
          timestamp: Date.now(),
        }];
        return next.slice(-80);
      });
    });

    // 实时语音：收到别人的分片就入队播放，并点亮"正在说话"标记。
    // 服务端已经 except 掉发送者，这里收到的一定是别人的。
    room.onMessage('voice', (message: VoiceMessagePayload) => {
      const player = voicePlayerRef.current ?? (voicePlayerRef.current = new VoicePlayer());
      // 听筒关了就不播；音效静音不再连带屏蔽语音（两个开关互相独立）
      player.setMuted(isVoiceMuted());
      player.push({
        mime: readString(message?.mime),
        data: message?.data,
        playerId: readString(message?.playerId),
      });

      const id = readString(message?.playerId);
      if (!id) return;
      setSpeakingIds(prev => (prev.includes(id) ? prev : [...prev, id]));
      const timers = speakingTimersRef.current;
      const prevTimer = timers.get(id);
      if (prevTimer) clearTimeout(prevTimer);
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        setSpeakingIds(cur => cur.filter(x => x !== id));
      }, 700));
    });

    // 扣底推荐
    room.onMessage('discard_hint_result', (message: DiscardHintResultMessage) => {
      setDiscardHintIds(readCardIds(message.cardIds));
      sound.hint();
    });

    // 掉线：SDK 会自动退避重连，这里只负责显示重连遮罩
    room.onDrop?.(() => {
      if (intentionalLeaveRef.current) return;
      beginReconnecting();
    });

    // 重连成功：连接恢复，撤掉遮罩（私有手牌由服务端 reconnected 消息补发）
    room.onReconnect?.(() => {
      setIsConnected(true);
      endReconnecting();
      clearError();
      reconnectTokenRef.current = room.reconnectionToken ?? null;
    });

    // 真正离开房间（主动退出，或重连彻底失败）：回到大厅
    room.onLeave((code?: number) => {
      const intentional = intentionalLeaveRef.current;
      intentionalLeaveRef.current = false;

      /* 兜底重连：SDK 只把 1001/1005/1006/4010 当作"可重连"，其余关闭码
       * （例如 ws 层因单帧过大掐断的 **1009 Message Too Big**）会直接走到这里，
       * onDrop 完全不触发 —— 玩家眼里就是"一下子被踢出牌桌"，一局白打。
       * 服务端 allowReconnection 有 120s 的窗口，只要手上还有 reconnectionToken
       * 就值得自己再试一次，而不是立刻把人扔回大厅。
       * 4000=CONSENTED（自己走的）、4003=FAILED_TO_RECONNECT（SDK 已重试到底）
       * 这两种不再试。 */
      const token = reconnectTokenRef.current;
      if (!intentional && code !== 4000 && code !== 4003 && token && clientRef.current) {
        beginReconnecting();
        clientRef.current.reconnect(token)
          .then((next: Room) => { bindRoomRef.current?.(next); })
          .catch(() => {
            clearRoomLocalState();
            showError('网络已断开，未能重连回牌桌', 6000);
          });
        return;
      }

      clearRoomLocalState();
      if (!intentional && code !== 4000) {
        showError('网络已断开，未能重连回牌桌', 6000);
      }
    });

    // 连接错误
    room.onError((code: number, message?: string) => {
      showError(`连接错误(${code}): ${message ?? ''}`);
      setIsConnected(false);
    });
  }, [clearRoomLocalState, showError, clearError, beginReconnecting, endReconnecting]);

  // 让 bindRoom 内部的兜底重连能重新绑定新 room 上的全部监听
  bindRoomRef.current = bindRoom;

  // 创建房间
  const createRoom = useCallback(async (playerName: string, aiCount: number = 0, customRoomId?: string, modeId: string = 'fourPlayerTwoDecks', tier: string = 'easy', cardRoom: boolean = false): Promise<string> => {
    if (!clientRef.current) {
      showError('客户端未初始化');
      throw new Error('客户端未初始化');
    }
    try {
      const room = await clientRef.current.create(ROOM_NAME, {
        name: playerName,
        // token 让服务端认出这是哪个账号：结算才知道把金币发给谁。
        // 不带也能玩（服务端容忍未登录），只是这局不计金币和战绩。
        token: getToken() || undefined,
        aiCount,
        customRoomId: customRoomId?.replace(/\D/g, '') || undefined,
        mode: modeId,
        // 场次决定底分与入场门槛，服务端会校验金币够不够，认不出的回落到初级场
        tier,
        /* 房卡局（朋友局）：服务端会向房主扣一张房卡，整桌不输赢金币。
         * 房卡不够时服务端直接抩房（抛错），不会默默降级成金币局——
         * 否则玩家以为开的是不输钱的局，打完发现金币没了。 */
        cardRoom: cardRoom || undefined,
      });
      bindRoom(room);
      return room.roomId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(`创建房间失败: ${msg}`);
      throw err;
    }
  }, [bindRoom, showError]);

  // 加入指定房间
  const joinRoom = useCallback(async (roomCode: string, playerName: string): Promise<void> => {
    if (!clientRef.current) {
      showError('客户端未初始化');
      throw new Error('客户端未初始化');
    }
    try {
      const room = await clientRef.current.joinById(roomCode, {
        name: playerName,
        token: getToken() || undefined,
      });
      bindRoom(room);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(`加入房间失败: ${msg}`);
      throw err;
    }
  }, [bindRoom, showError]);

  // 准备
  const sendReady = useCallback(() => {
    roomRef.current?.send('ready');
  }, []);

  // 出牌
  const sendPlay = useCallback((cards: Card[]) => {
    roomRef.current?.send('play', { cardIds: cards.map(c => c.id) });
  }, []);

  // 叫主/叫分阶段的“不叫”；出牌阶段没有过牌。
  const sendPass = useCallback(() => {
    const phase = roomRef.current?.state?.phase as string | undefined;
    if (phase === 'calling_suit') {
      roomRef.current?.send('call_suit', { suit: 255 });
    } else if (phase === 'calling_score') {
      roomRef.current?.send('call_score', { score: 0 });
    }
  }, []);

  // 叫主
  const sendCallSuit = useCallback((suit: Suit | null) => {
    const suitNum = suit === null ? 255 : suitStrToNum(suit);
    roomRef.current?.send('call_suit', { suit: suitNum });
  }, []);

  // 叫分
  const sendCallScore = useCallback((score: number) => {
    roomRef.current?.send('call_score', { score });
  }, []);

  // 扣底
  const sendDiscard = useCallback((cards: Card[]) => {
    roomRef.current?.send('discard', { cardIds: cards.map(c => c.id) });
  }, []);

  // 分批扣牌：放进底牌区 / 取回
  const stageDiscard = useCallback((cards: Card[]) => {
    if (cards.length === 0) return;
    roomRef.current?.send('discard_stage', { cardIds: cards.map(c => c.id) });
  }, []);
  const unstageDiscard = useCallback((cards?: Card[]) => {
    roomRef.current?.send('discard_unstage', { cardIds: (cards ?? []).map(c => c.id) });
  }, []);
  /**
   * 确认埋底：底牌区已经凑够张数，点确认才真正开打。
   * 以前是凑够就自动开打，庄家误点最后一张就无法挽回。
   */
  const confirmDiscard = useCallback(() => {
    roomRef.current?.send('confirm_discard');
  }, []);

  // 甩牌（本质是出多张牌，后端按play处理）
  const sendToss = useCallback((cards: Card[]) => {
    roomRef.current?.send('toss', { cardIds: cards.map(c => c.id) });
  }, []);

  // 聊天
  const sendChat = useCallback((text: string) => {
    roomRef.current?.send('chat', { text });
  }, []);

  /**
   * 按住说话：打开麦克风，每 250ms 把一片音频发给服务端转发。
   * 返回 false 表示没能开始（不支持 / 被拒授权 / 没连房间），调用方据此提示用户。
   */
  const startVoice = useCallback(async (): Promise<boolean> => {
    if (!roomRef.current) return false;
    if (!isVoiceSupported()) return false;
    if (await isMicDenied()) return false;

    const rec = voiceRecRef.current ?? (voiceRecRef.current = new VoiceRecorder());
    try {
      await rec.start(
        (chunk) => {
          // sendBytes 走二进制通道，避免音频字节被 msgpack 当成数组逐元素编码
          roomRef.current?.send('voice', {
            mime: chunk.mime,
            sessionId: chunk.sessionId,
            seq: chunk.seq,
            data: chunk.data,
          });
        },
        // 到达 30 秒上限被强制松手：UI 要跟着把按钮弹回来
        () => { setIsTalking(false); setMicLevel(0); },
        // 实时电平 -> UI 电平条
        (lv) => setMicLevel(lv),
      );
      setIsTalking(true);
      vibrate(15);
      return true;
    } catch {
      // 用户点了"拒绝"，或系统没有可用麦克风
      setIsTalking(false);
      setMicLevel(0);
      return false;
    }
  }, []);

  /** 松手：立刻关麦（浏览器录音标记消失）。 */
  const stopVoice = useCallback(() => {
    voiceRecRef.current?.stop();
    setIsTalking(false);
    // 电平必须归零：不清的话按钮弹回后电平条会停在最后一帧的高度
    setMicLevel(0);
    // 松手也给一下短震动：和按下时的 15ms 配成"起/止"两个触感，
    // 手机上不用看屏幕就知道这一句已经说完发出去了。
    vibrate(10);
  }, []);

  // 提示：让服务端推荐一手合法出牌
  const sendHint = useCallback(() => {
    roomRef.current?.send('hint');
    sound.click();
  }, []);

  // 扣底推荐
  const sendDiscardHint = useCallback(() => {
    roomRef.current?.send('discard_hint');
    sound.click();
  }, []);

  const clearDiscardHint = useCallback(() => setDiscardHintIds([]), []);

  const clearHint = useCallback(() => {
    setHintCardIds([]);
    setHintInfo(null);
  }, []);

  // 返回大厅（真正离开房间）
  const returnToLobby = useCallback(() => {
    intentionalLeaveRef.current = true;
    reconnectTokenRef.current = null;
    endReconnecting();
    setIsTrustee(false);
    roomRef.current?.leave();
    roomRef.current = null;
    setRoomState(null);
    setMyPlayerId(null);
    setMyHand([]);
    setBottomCards([]);
    setSettlementResult(null);
    bottomCardsRef.current = [];
    setBidHistory([]);
    setRoomId(null);
    setTurnDeadline(null);
    setHintCardIds([]);
    setHintInfo(null);
    setLastTrickPlays({});
    setChatMessages([]);
    setDiscardHintIds([]);
    setStagedDiscards([]);
    setIsConnected(false);
    // 语音收尾：关麦、清掉没播完的分片和"正在说话"的定时器
    voiceRecRef.current?.stop();
    voicePlayerRef.current?.clear();
    setIsTalking(false);
    for (const t of speakingTimersRef.current.values()) clearTimeout(t);
    speakingTimersRef.current.clear();
    setSpeakingIds([]);
  }, [endReconnecting]);

  // 房主管理：加减AI、移出玩家（仅等待阶段可用，服务端会再校验一次）
  const addAi = useCallback(() => {
    roomRef.current?.send('add_ai');
    sound.click();
  }, []);

  const removeAi = useCallback(() => {
    roomRef.current?.send('remove_ai');
    sound.click();
  }, []);

  const kickPlayer = useCallback((playerId: string) => {
    roomRef.current?.send('kick_player', { playerId });
    sound.click();
  }, []);

  // 收回托管，恢复手动操作
  const resumeControl = useCallback(() => {
    roomRef.current?.send('resume_control');
    sound.click();
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    // 只管音效。别人的语音由独立的「听筒」开关控制 —— 用户要的是
    // "不听人说话但要听出牌音"，两者绑在一起做不到这件事。
    sound.setMuted(muted);
  }, []);

  /** 听筒开关：关掉后不再播别人的语音，并清掉已排队的分片。 */
  const setVoiceMuted = useCallback((muted: boolean) => {
    setVoiceMutedState(muted);
    setVoiceMutedPref(muted);
    voicePlayerRef.current?.setMuted(muted);
    sound.click();
  }, []);

  const actions: GameActions = {
    createRoom,
    joinRoom,
    leaveRoom: returnToLobby,
    sendReady,
    sendPlay,
    sendPass,
    sendCallSuit,
    sendCallScore,
    sendDiscard,
    stageDiscard,
    unstageDiscard,
    confirmDiscard,
    sendToss,
    sendChat,
    startVoice,
    stopVoice,
    sendDiscardHint,
    clearDiscardHint,
    sendHint,
    clearHint,
    returnToLobby,
    resumeControl,
    addAi,
    removeAi,
    kickPlayer,
    setMuted,
    setVoiceMuted,
  };

  return {
    roomState,
    myPlayerId,
    myHand,
    dealKey,
    bottomCards,
    settlementResult,
    bidHistory,
    roomId,
    isConnected,
    error,
    turnDeadline,
    hintCardIds,
    hintInfo,
    lastTrickPlays,
  autoPlaySeat,
  chatMessages,
  discardHintIds,
  stagedDiscards,
  scorePopup,
  isReconnecting,
  reconnectDeadline,
  isTrustee,
  tossNotice,
  voiceSupported,
  voiceMuted,
  isTalking,
  micLevel,
  speakingIds,
  actions,
};
}
