// ===== Table V4 适配器 =====
// 把旧 Table 的所有 props 映射成 TableV4 能用的数据和回调

import { useEffect, useMemo, useState } from 'react';
import { TableV4 } from './TableV4';
import { Settlement } from './Settlement';
import { OutcomeBanner } from './OutcomeBanner';
import type {
  Player, Card, Suit, GamePhase, BidEvent, SettlementResult, ChatMessage, ActionType, AuctionEntry,
  RoundRecord,
} from '../types';
import { summarizeAuction } from '../utils/settlementView';
import { toRoundRows, toStandings } from '../utils/roomRecord';
import {
  toHandCard, toV4Players, toTrickPlays, toV4Phase,
  getMainActionText, getMainAction, isMainActionBlocked, symToSuit, suitToSym, suitName,
} from './tableV4Transform';
import { getSuitSymbol, sortHand } from '../utils/cardUtils';
import { useDealAnimation } from './useDealAnimation';
import { precheckToss } from '../utils/toss';
import { describeSelection, identifyPattern } from '../utils/pattern';
import { rankOf } from '../utils/rank';
import { useAccount } from '../hooks/useAccount';

interface TableV4AdapterProps {
  players: Player[];
  mySeat: number;
  phase: GamePhase;
  mainSuit: Suit | null;
  bankerSeat: number;
  callScore: number;
  nextBidMax: number;
  currentTurn: number;
  lastWinner: number;
  trickLeader: number;
  lastTrick: Card[];
  currentPlays: Record<number, Card[]>;
  currentWinnerSeat: number;
  requiredPlayCount: number;
  myHand: Card[];
  /** 发牌序号（useColyseus.dealKey）：自增即重播「飞牌→翻面→理牌」动画。 */
  dealKey?: number;
  selectedIds: Set<string>;
  onCardToggle: (card: Card) => void;
  /** 批量替换选中集合（框选/刷选/整组）。不传则退化为逐张 toggle。 */
  onSelectionChange?: (ids: Set<string>) => void;
  onAction: (action: ActionType, value?: number | string) => void;
  roomId: string | null;
  error: string | null;
  /** 掉线重连中：牌桌盖遮罩，见 TableV4 里的说明 */
  isReconnecting?: boolean;
  reconnectDeadline?: number | null;
  turnDeadline: number | null;
  hintCardIds: string[];
  hintInfo?: { seq: number; index: number; total: number } | null;
  lastTrickPlays: Record<number, Card[]>;
  autoPlaySeat: number | null;
  scorePopup: { score: number; seat: number; key: number } | null;
  chatMessages: ChatMessage[];
  availableSuits: Suit[];
  /** 抢主门槛：叫主需要的同花色7张数（1=首家叫主）。 */
  minSevens?: number;
  selectedCount: number;
  isMyTurn: boolean;
  settlementResult: SettlementResult | null;
  bidHistory: BidEvent[];
  tossNotice?: string | null;
  onLeave: () => void;
  onHint: () => void;
  onDiscardHint: () => void;
  onChat: (text: string) => void;
  /** 实时语音（按住说话）。 */
  voiceSupported?: boolean;
  isTalking?: boolean;
  micLevel?: number;
  onVoiceStart?: () => Promise<boolean> | boolean;
  onVoiceStop?: () => void;
  speakingIds?: string[];
  /** 听筒开关（关了不播别人的语音，不影响音效）。 */
  voiceMuted?: boolean;
  onToggleVoiceMuted?: () => void;
  onClearSelection: () => void;
  onReturnToLobby: () => void;
  selectedPattern: string;
  isTrustee: boolean;
  onResumeControl: () => void;
  playerLimit: number;
  discardCount: number;
  /** 分批扣牌：已放进底牌区的牌 + 取回回调。 */
  stagedDiscards?: Card[];
  onUnstageDiscard?: (cards?: Card[]) => void;
  /**
   * 庄家埋底的「确认」动作。
   *
   * 以前凑够张数服务端就自动开打，庄家常常还没看清埋了什么牌就已经在出牌了，
   * 悔都来不及。现在改成必须显式确认，这个回调就是那一下。
   */
  onConfirmDiscard?: () => void;
  /** 本局叫主/抢主/叫分的完整过程（服务端 state.auction）。 */
  auction?: AuctionEntry[];
  /**
   * 这张桌子已打完的每一局战果（服务端 state.history）。
   * 从 state 来而不是靠广播累积：重连/中途加入的人也要能看到完整历史。
   */
  history?: RoundRecord[];
  /** 这张桌子打完几局。 */
  roundsPlayed?: number;
  onAddAi: () => void;
  onRemoveAi: () => void;
  onKickPlayer: (playerId: string) => void;
  /** 模式中文名，结算的分享/截图卡要用。 */
  modeName?: string;
}

// Card -> HandCardData
export function TableV4Adapter(props: TableV4AdapterProps) {
  const {
    players, mySeat, phase, mainSuit, currentTurn, trickLeader, currentWinnerSeat,
    currentPlays, myHand, selectedIds, onCardToggle, onSelectionChange,
    onAction, hintCardIds, hintInfo = null, isMyTurn, discardCount, dealKey = 0,
    callScore, bankerSeat, nextBidMax, availableSuits, minSevens = 1,
    settlementResult, chatMessages, turnDeadline, isTrustee,
    error, isReconnecting, reconnectDeadline, playerLimit, selectedCount,
    onHint, onDiscardHint, onChat, onLeave, onResumeControl,
    voiceSupported, isTalking, micLevel = 0, onVoiceStart, onVoiceStop, speakingIds,
    voiceMuted, onToggleVoiceMuted,
    onReturnToLobby, onAddAi, onRemoveAi,
    roomId, bidHistory, tossNotice,
    stagedDiscards = [], onUnstageDiscard,
    auction = [],
    history = [],
    roundsPlayed = 0,
  } = props;

  // 模式人数优先，等待阶段人未坐满时方位才不会跳动
  const playerCount = playerLimit || players.length || 4;

  const v4Phase = useMemo(() => toV4Phase(phase), [phase]);
  /**
   * 「该谁操作」的绝对座位号。只有真的在等某人动作的阶段才给号，其余给 null。
   *
   * 为什么要过滤 phase：服务端的 currentTurn 在 waiting/dealing/settling 阶段
   * 保留着上一轮的残留值，直接透给 UI 会让某家在发牌和结算时一直亮着高亮，
   * 玩家会以为卡住了在等他。
   */
  const activeTurn = useMemo(() => {
    if (phase === 'calling_suit' || phase === 'calling_score' || phase === 'playing') {
      return currentTurn;
    }
    return null;
  }, [phase, currentTurn]);
  /**
   * 本墩首家的绝对座位号。
   *
   * 服务端在非对战阶段把 trickLeader 置成 255（哨兵值，不对应任何座位），
   * 必须过滤掉，否则 `seat === 255` 永远不成立倒是没错，但语义上是在拿一个
   * 无效值去比对 —— 显式判掉更清楚，也顺手挡住越界座位号。
   */
  const leaderSeat = useMemo(() => {
    if (phase !== 'playing') return null;
    if (trickLeader < 0 || trickLeader >= playerCount) return null;
    return trickLeader;
  }, [phase, trickLeader, playerCount]);
  /**
   * 当前压着全场的那家（绝对座位号），用于在牌阵上打「压」标签。
   * 和 trickLeader 一样，非对战阶段服务端是 255 哨兵值，必须过滤。
   */
  const winnerSeat = useMemo(() => {
    if (phase !== 'playing') return null;
    if (currentWinnerSeat < 0 || currentWinnerSeat >= playerCount) return null;
    return currentWinnerSeat;
  }, [phase, currentWinnerSeat, playerCount]);
  const v4Players = useMemo(
    /* 传 roundsPlayed 是为了让座位上显示「本桌累计几级」——
     * 还没打完一局时它是 0，toV4Players 就不给任何座位挂级数标签
     * （显示「0级」会被读成"打了但不输不赢"）。 */
    () => toV4Players(players, mySeat, playerCount, activeTurn, leaderSeat, roundsPlayed),
    [players, mySeat, playerCount, activeTurn, leaderSeat, roundsPlayed]
  );
  // 发牌动画阶段机：fly（飞牌）→ flip（翻面）→ sort（理牌位移）→ idle。
  const deal = useDealAnimation(dealKey, myHand.length);

  // 手牌整理：主牌整堆在前，副牌按花色分堆，堆内牌力从大到小。
  // 依赖里必须带 mainSuit —— 叫主前后天王/主7/主花色的牌力会变，定主时要自动重排。
  const sortedHand = useMemo(() => sortHand(myHand, mainSuit), [myHand, mainSuit]);
  /**
   * 真正渲染用的手牌顺序。
   *
   * 发牌动画的「理牌」那一下就是靠这里切换实现的：飞牌与翻面期间用服务端
   * 发过来的【原始乱序】，等 deal.sorted 变 true 再换成排好的顺序，TableV4
   * 里的 FLIP 会把每张牌从旧位置滑到新位置 —— 看起来就是自动理牌。
   * 之前是发到手直接整排排好，完全没有这个过程。
   */
  const displayHand = deal.sorted ? sortedHand : myHand;
  // 依赖里必须带 mainSuit：定主/反主后主牌集合会变（主花色整门 + 主3变天王），
  // 角标要跟着重算，否则叫主前算出来的「主」标会一直挂在错的牌上。
  const v4Hand = useMemo(
    () => displayHand.map(card => toHandCard(card, mainSuit)),
    [displayHand, mainSuit]
  );
  const trickCards = useMemo(
    () => toTrickPlays(currentPlays, mySeat, playerCount, mainSuit, leaderSeat, winnerSeat),
    [currentPlays, mySeat, playerCount, mainSuit, leaderSeat, winnerSeat]
  );
  const v4AvailableSuits = useMemo(
    () => availableSuits.map(suitToSym).filter(Boolean),
    [availableSuits]
  );

  // 甩牌预校验：本墩还没人出牌且轮到自己 = 首家。
  // 「别人手上有没有更大的牌」客户端看不到，只能由服务端判定。
  const isTrickLeader = Object.keys(currentPlays).length === 0 && currentTurn === mySeat;
  const selectedCards = useMemo(
    () => sortedHand.filter(c => selectedIds.has(c.id)),
    [sortedHand, selectedIds]
  );
  const tossCheck = useMemo(
    () => precheckToss(selectedCards, sortedHand, mainSuit, isTrickLeader),
    [selectedCards, sortedHand, mainSuit, isTrickLeader]
  );

  /* 选中牌的牌型标签。
   * describeSelection 是服务端 identifyCardType 的镜像实现（见 utils/pattern.ts），
   * 必须传 mainSuit —— 主副归属决定拖拉机能不能成型：
   * 主♠时 ♦6♦6+♦7♦7 不是拖拉机（♦7是常主、♦6是副牌），老的 describePattern
   * 不收 mainSuit 所以会把它标成拖拉机，玩家照标签出牌会被服务端打回。 */
  const patternLabel = useMemo(
    () => describeSelection(selectedCards, mainSuit),
    [selectedCards, mainSuit]
  );
  const patternNamed = useMemo(
    () => identifyPattern(selectedCards, mainSuit) !== null,
    [selectedCards, mainSuit]
  );

  const mainSuitSymbol = mainSuit ? getSuitSymbol(mainSuit) : '?';
  const me = players.find(p => p.seatIndex === mySeat);
  const actionText = getMainActionText(phase);
  const mainAction = getMainAction(phase);

  // 叫主/叫分是两套完全不同的操作，必须分开
  const callingStage: 'suit' | 'score' = phase === 'calling_score' ? 'score' : 'suit';
  // 叫主/叫分阶段服务端用 currentTurn 指示该谁操作
  const canBid = currentTurn === mySeat;
  /* 扣底阶段还差几张。
   *
   * 分批扣牌后这个数必须以【服务端暂存区】为基准：已经放进底牌区的牌
   * 才是真的扣下去了。本地选中数（selectedCount）只是"这一批准备放几张"，
   * 用它算会出现放了 6 张后显示"还需 12 张"的错乱。 */
  const stagedCount = stagedDiscards.length;
  /**
   * 「还需几张」= 应扣张数 - 已放进底牌区的张数。
   *
   * ⚠️ 这里绝不能再减 selectedCount。历史上就是那么写的，后果是：
   * 还差 1 张、庄家一次选了 4 张时，这个数被算成 0，牌桌立刻显示
   * 「张数已够，确认后开打」并把主按钮切成「确认埋底」—— 可暂存区
   * 明明只有 17/18 张，点确认服务端必然拒绝。UI 在骗人，玩家以为卡住了。
   * 选中的牌只是"准备放"，没放进去就不算扣下去了。
   */
  const remainingDiscard = Math.max(0, discardCount - stagedCount);
  /** 这一批选多了几张（>0 时不能放，要给庄家明确提示）。 */
  const discardOverflow = Math.max(0, selectedCount - remainingDiscard);

  /* 埋底是否已经可以确认：暂存区张数刚好凑齐。
   *
   * 这个数必须以【服务端暂存区】为准，不能算上本地选中的牌 ——
   * 选中还没放进去，点确认服务端会拒。 */
  const canConfirmDiscard = discardCount > 0 && stagedCount >= discardCount;

  /* 叫主/抢主/叫分的过程摘要。
   * 顶栏要显示「主是谁叫的/抢的」，记录面板要逐条列出谁做了什么，
   * 都从服务端同步过来的 state.auction 现算，不在客户端另存一份历史。 */
  const auctionSummary = useMemo(() => summarizeAuction(auction), [auction]);

  /* 房间累计战绩：各家累计 + 逐局战果。
   * 整理逻辑在 utils/roomRecord.ts（纯函数，有单测）——「庄家已离桌怎么显示」
   * 「没坐过庄的成功率」这类判断有明确对错，埋在 JSX 里就没法测。 */
  const standings = useMemo(() => toStandings(players, mySeat), [players, mySeat]);
  const roundRows = useMemo(() => toRoundRows(history, players, mySeat), [history, players, mySeat]);

  // 叫主阶段反主提示文字
  const antiHint = phase === 'calling_suit' && mainSuit
    ? `当前主牌花色${suitName(mainSuit)}7`
    : phase === 'calling_score'
    ? `当前叫分 ${callScore}`
    : '';

  // 叫分阶段的分数（简单显示）
  const bubbleText = '';

  // 主按钮点击
  const handleMainAction = () => {
    onAction(mainAction);
  };

  // 反主花色点击
  const handleAntiSuit = (suit: string) => {
    if (phase === 'calling_suit') {
      onAction('call_suit', symToSuit(suit));
    }
  };

  // 庄家杀分 / 闲家抓分：按座位是否为庄家分成两个阵营累加。
  // 闲家抓分要达到叫分才能打倒庄家，所以两个数都得亮出来，
  // 原来只显示「我自己抓了多少」，看不出全局形势。
  const { bankerTakenScore, opponentTakenScore } = useMemo(() => {
    let banker = 0;
    let opponent = 0;
    for (const p of players) {
      if (p.seatIndex === bankerSeat) banker += p.takenScore ?? 0;
      else opponent += p.takenScore ?? 0;
    }
    return { bankerTakenScore: banker, opponentTakenScore: opponent };
  }, [players, bankerSeat]);

  // 牌桌左下角显示的金币：直接读账号真实余额。
  // 结算时服务端发币、useColyseus 收到 game_settled 后会刷新账号，这里跟着变。
  // 原来这里挂着一个「+ 充值」按钮走假支付流，本项目不做充值，已移除。
  const { account } = useAccount();
  const coins = account?.coins ?? 0;

  /* ===== 战果横幅 -> 结算面板 的两拍节奏 =====
   *
   * 最后一墩收完先在牌桌上砸一块「光头 / 挖底成功」的大字，播完才弹结算面板。
   * 以前是直接弹面板，那一瞬间的情绪高点被埋进结算页第 N 个区块里。
   *
   * playKey 用自增序号而不是布尔量：连着两局同样的战果（比如两次光头）
   * 布尔量不变化就不会重播动画，玩家会以为第二局漏了横幅。 */
  const [bannerDone, setBannerDone] = useState(false);
  const [bannerKey, setBannerKey] = useState(0);
  /* 结算面板被玩家收起来了（点了右上角 ✕）。
   *
   * ✕ 以前绑的是"返回大厅" —— 点一下人就被踢出房间，既违反「✕ = 关弹窗」的
   * 直觉，还绕过了退房前的房间结算清单。现在 ✕ 只是把面板收起来，
   * 让玩家回牌桌复盘最后一墩，收起后用一个小徽章可以再打开。
   * 新一局结算到来时必须重新展开，不能让上一局的"收起"状态把新结算藏掉。 */
  const [settleCollapsed, setSettleCollapsed] = useState(false);
  useEffect(() => {
    if (!settlementResult) { setBannerDone(false); setSettleCollapsed(false); return; }
    setBannerDone(false);
    setSettleCollapsed(false);
    setBannerKey(k => k + 1);
    /* 兜底：万一横幅组件因为任何原因没回调（被卸载/动画被系统掐掉），
     * 也必须把结算面板放出来 —— 玩家不能因为一个动效卡在牌桌上。 */
    const guard = setTimeout(() => setBannerDone(true), 3200);
    return () => clearTimeout(guard);
  }, [settlementResult]);

  /* 横幅文案的语气要分赢家/输家，用「我这局级数是涨还是跌」判断，
   * 比拿 bankerWin 再推一遍我是不是庄家更不容易错。 */
  const iWon = settlementResult
    ? (settlementResult.levelDeltas?.[mySeat] ?? 0) > 0
    : false;

  return (
    <TableV4
      phase={v4Phase}
      mainSuit={mainSuitSymbol}
      mainRank="7"
      catchScore={opponentTakenScore}
      bankerScore={bankerTakenScore}
      players={v4Players}
      handCards={v4Hand}
      dealStage={deal.stage}
      dealLocked={deal.locked}
      selectedIds={selectedIds}
      onCardToggle={(card) => {
        const orig = displayHand.find(c => c.id === card.id);
        if (orig) onCardToggle(orig);
      }}
      onSelectionChange={onSelectionChange}
      trickCards={trickCards}
      isMyTurn={isMyTurn}
      mainActionBlocked={isMainActionBlocked(phase, isMyTurn)}
      discardCount={remainingDiscard}
      hintCardIds={hintCardIds}
      hintInfo={hintInfo}
      actionText={actionText}
      onAction={handleMainAction}
      onAntiSuit={handleAntiSuit}
      antiHintText={antiHint}
      bubbleText={bubbleText}
      myName={me?.name ?? '我'}
      /* 这里要显示金币余额，之前误绑了对局积分 me.score */
      myCoins={coins}
      /* 段位按真实累计积分换算，之前写死「新人I」 */
      myRankLabel={me?.isBanker ? '庄家' : rankOf(me?.score ?? 0).name}
      bottomScore={callScore}
      callScore={callScore}
      multiplier={1}

      /* 座位布局 */
      playerCount={playerCount}
      seatedCount={players.length}
      aiCount={players.filter(p => p.isAI).length}
      isOwner={Boolean(me?.isOwner)}
      onAddAi={onAddAi}
      onRemoveAi={onRemoveAi}

      /* 叫主 / 叫分 */
      callingStage={callingStage}
      availableSuits={v4AvailableSuits}
      minSevens={minSevens}
      canBid={canBid}
      bidMax={nextBidMax}
      onCallScore={(score) => onAction('call_score', score)}

      /* 出牌辅助 */
      onHint={onHint}
      onDiscardHint={onDiscardHint}
      turnDeadline={turnDeadline}
      isTrustee={isTrustee}
      onResumeControl={onResumeControl}
      errorText={error}
      isReconnecting={isReconnecting}
      reconnectDeadline={reconnectDeadline}
      onLeave={onLeave}

      /* 甩牌 */
      onToss={() => onAction('toss')}
      canToss={tossCheck.ok}
      tossHint={tossCheck.reason ?? '同门 2 张以上一起打出；只要没人压得住就甩牌成功'}
      tossNotice={tossNotice}

      /* 选中牌的牌型提示 */
      selectedPattern={patternLabel}
      selectedPatternNamed={patternNamed}

      /* 房间累计战绩：顶栏「第N局 +M级」小字、记录面板、退房清单共用 */
      roundsPlayed={roundsPlayed}
      standings={standings}
      roundRows={roundRows}
      /* 只有真的在打牌时退出才算逃跑（服务端 applyEscapePenalty 的口径）。
         等待和结算阶段退出不扣币，那时候弹罚金警告是白吓人。
         这个判断必须在适配器里做：TableV4 拿到的 phase 已经把 settling
         折叠成 'playing' 了，它分不出来。 */
      leaveIsEscape={phase !== 'waiting' && phase !== 'settling' && phase !== 'flow_end'}

      /* 顶栏「记录」面板数据：bidHistory 此前被适配器接收但从未透传 */
      roomId={roomId}
      bidHistory={bidHistory}
      recordPlayers={players.map(p => ({
        name: p.name,
        takenScore: p.takenScore,
        isBanker: p.isBanker,
        handCount: p.handCount,
      }))}
      bankerName={players.find(p => p.seatIndex === bankerSeat)?.name}
      mainSuitName={mainSuit ? suitName(mainSuit) : undefined}
      bottomCount={discardCount}
      bottomCards={stagedDiscards.map(card => toHandCard(card, mainSuit))}
      stagedCount={stagedCount}
      onUnstageDiscard={onUnstageDiscard}
      canConfirmDiscard={canConfirmDiscard}
      onConfirmDiscard={props.onConfirmDiscard}
      discardOverflow={discardOverflow}

      /* 叫主/叫分归属：顶栏小字 + 记录面板逐条明细 */
      auctionRows={auctionSummary.rows}
      suitCallerName={auctionSummary.suitOwner?.playerName}
      suitCallerSevens={auctionSummary.suitOwner?.sevenCount ?? 0}
      suitFromBottom={auctionSummary.fromBottom}
      suitStealCount={auctionSummary.stealCount}
      chatMessages={chatMessages}
      onChat={onChat}

      /* 实时语音：按住说话 + 座位上的说话标记 */
      voiceSupported={voiceSupported}
      isTalking={isTalking}
      micLevel={micLevel}
      onVoiceStart={onVoiceStart}
      onVoiceStop={onVoiceStop}
      speakingIds={speakingIds}
      voiceMuted={voiceMuted}
      onToggleVoiceMuted={onToggleVoiceMuted}

      /* 结算面板：等战果横幅播完才出现，见上面 bannerDone 的说明 */
      settlementSlot={settlementResult ? (({ requestLeave }) => (
        <>
          <OutcomeBanner
            input={{
              bankerWin: settlementResult.bankerWin,
              opponentScore: settlementResult.opponentScore,
              digSuccess: settlementResult.digSuccess,
              digGuaranteeLevel: settlementResult.digGuaranteeLevel,
              callScore: settlementResult.callScore,
            }}
            playKey={bannerKey}
            iWon={iWon}
            onDone={() => setBannerDone(true)}
          />
          {bannerDone && !settleCollapsed && (
            <Settlement
              result={settlementResult}
              players={players}
              mySeat={mySeat}
              bankerSeat={bankerSeat}
              mainSuit={mainSuit}
              onNext={() => onAction('next')}
              onReturnLobby={onReturnToLobby}
              /* 「大厅」按钮先弹房间结算清单，和顶栏 ✕ 走同一条路径。
               * 直接调 onReturnToLobby 就把人踢回大厅了 —— 用户反馈的
               * 「退出房间我还没看到结算单」就是这么来的。
               *
               * ⚠️ 必须同时收起结算面板：退房清单是牌桌的内部浮层
               * （z-index 80，absolute），而结算遮罩是 z-index 300 的 fixed 层，
               * 不收起的话清单会开在结算面板**背后**，玩家点了「大厅」
               * 看起来毫无反应 —— 比原来的 bug 更难查。
               * 清单上点「继续打」会回到牌桌，用底部「查看结算」可以再打开结算。 */
              onRequestLeave={() => { setSettleCollapsed(true); requestLeave(); }}
              onClose={() => setSettleCollapsed(true)}
              modeName={props.modeName}
              roundsPlayed={roundsPlayed}
              standings={standings}
            />
          )}
          {/* 收起后的回位入口：不给它，玩家收起面板就再也找不到「下一局」了。 */}
          {bannerDone && settleCollapsed && (
            <div className="settle-collapsed-actions">
              <button
                type="button"
                className="settle-next-collapsed"
                onClick={() => onAction('next')}
              >
                开始下一局
              </button>
              <button
                type="button"
                className="settle-reopen"
                onClick={() => setSettleCollapsed(false)}
              >
                查看结算
              </button>
            </div>
          )}
        </>
      )) : null}
    />
  );
}
