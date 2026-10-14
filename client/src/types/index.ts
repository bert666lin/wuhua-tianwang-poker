// ===== 五华天王扑克 共享类型定义 =====

import type { OutcomeKind } from '../utils/outcome';


/** 花色 */
export type Suit = 'spade' | 'heart' | 'diamond' | 'club' | 'joker';

/** 点数 */
export type Rank =
  | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A' | '2'
  | 'small_joker' | 'big_joker';

/** 单张牌 */
export interface Card {
  suit: Suit;
  rank: Rank;
  id: string; // 唯一ID（多副牌区分）
}

/** 牌型 */
export type CardPattern = 'single' | 'pair' | 'triple' | 'straight' | 'tractor';

/** 玩家 */
export interface Player {
  id: string;
  name: string;
  seatIndex: number;
  isBanker: boolean;
  score: number;        // 累计积分
  takenScore: number;   // 本局已抓分
  handCount: number;
  isReady: boolean;     // 是否准备
  isCalling: boolean;   // 是否正在叫主/叫分
  isOffline: boolean;   // 是否离线
  isAI: boolean;        // 是否为AI玩家
  isOwner: boolean;     // 是否房主
  isAutoPlay: boolean;  // 真人进入持续托管
  isTrusteeByOffline: boolean; // 掉线被AI接管
  /**
   * 本房间累计级数（可负）。
   *
   * ⚠️ 和上面的 `score` 是两回事：`score` 是账号终身积分（决定段位），
   * 这个只算"在这张桌子上"的输赢，进房从 0 开始、退房就没了。
   * 牌桌上和房间结算清单显示的"赢了几级"指的是这个。
   */
  roomLevel: number;
  /** 本房间坐庄次数。 */
  roomBankerCount: number;
  /** 本房间坐庄且守住的次数。 */
  roomBankerWins: number;
}

/** 当局叫分记录 */
export interface BidEvent {
  playerId: string;
  playerName: string;
  seatIndex: number;
  score: number;
}

/**
 * 叫主 / 抢主 / 叫分的一条记录。
 * 与服务端 states/AuctionEntryState.ts 对齐。
 * 牌桌顶栏、记录面板、结算页都要用它标明「是谁叫的」。
 */
export type AuctionKind =
  | 'call_suit'   // 叫主
  | 'steal_suit'  // 抢主（多亮一张7）
  | 'pass_suit'   // 不叫主
  | 'bottom_suit' // 无人叫主，翻底牌定主
  | 'bid'         // 叫分
  | 'pass_bid';   // 不叫分

export interface AuctionEntry {
  kind: AuctionKind;
  /** 255 = 没有座位（翻底定主）。 */
  seatIndex: number;
  playerName: string;
  /** 花色 0-3；255 = 与花色无关。 */
  suit: number;
  sevenCount: number;
  score: number;
}

/** 游戏阶段 */
/** 牌桌操作类型。 */
export type ActionType = 'ready' | 'pass' | 'call_suit' | 'call_score' | 'play' | 'discard' | 'next' | 'toss';

export type GamePhase =
  | 'waiting'
  | 'dealing'
  | 'calling_suit'
  | 'calling_score'
  | 'discarding'
  | 'playing'
  | 'settling'
  | 'flow_end';

/**
 * 一局打完的战果记录（房间累计战绩的一行）。
 * 与服务端 states/RoundRecordState.ts 对齐。
 */
export interface RoundRecord {
  /** 第几局，从 1 开始。 */
  roundNo: number;
  /** 这局庄家座位；255 = 未知（不该出现，兜底值）。 */
  bankerSeat: number;
  callScore: number;
  bankerWin: boolean;
  level: number;
  /** 闲家总得分（已含底牌分）。 */
  opponentScore: number;
  /**
   * 战果代号。'flow_break' 是流局，只在这份记录里出现，
   * 不走 describeOutcome（流局没有叫分也没有闲家分）。
   */
  outcome: OutcomeKind | 'flow_break';
  /** 各座位这局的级数增减，索引 = 座位号。 */
  deltas: number[];
}

/** 房间状态 */
export interface RoomState {
  modeId: string;
  modePlayerCount: number;
  phase: GamePhase;
  mainSuit: Suit | null;   // 主花色
  mainSuitCallCount: number; // 当前主花色是用几张7亮出来的（抢主需严格更多）
  bankerSeat: number;      // 庄家座位
  callScore: number;       // 叫分
  nextBidMax: number;      // 当前轮可叫的最高分
  totalScore: number;      // 全局总分
  currentTurn: number;     // 当前出牌玩家
  lastTrick: Card[];       // 上一轮出的牌
  lastWinner: number;      // 上一轮赢家
  currentTrick: Card[];    // 当前轮出的牌
  currentPlays: Record<number, Card[]>; // 当前墩每个座位实际打出的牌
  requiredPlayCount: number; // 后家必须跟出的张数，领出时为0
  currentWinnerSeat: number; // 本墩暂时最大的座位
  trickLeader: number;     // 当前轮首个出牌玩家
  players: Player[];       // 玩家列表
  round: number;           // 回合数
  bottomCount: number;     // 底牌数量
  /**
   * 本局叫主/抢主/叫分的过程。
   * 放在 state 里而不是只靠广播：重连的人也要能看到「主是谁叫的、庄是谁叫的」。
   */
  auction: AuctionEntry[];
  /**
   * 这张桌子已经打完的每一局战果，按时间顺序。
   * 从 state 同步而不是靠广播累积：重连/换设备/中途加入的人也要能翻完整历史。
   */
  history: RoundRecord[];
  /** 这张桌子已经打完几局（= history.length，服务端冗余给的标量）。 */
  roundsPlayed: number;
}

/** 单局结算：有人先出完就立即停止，并按抠底/挖底结果计分加级。 */
export interface SettlementResult {
  bankerWin: boolean;
  finisherSeat: number;
  finisherIsBanker: boolean;
  level: number;
  levelDeltas: number[];
  callScore: number;
  opponentScore: number;
  bankerScore: number;
  scoreLevel: number;
  digLevel: number;
  /** 各墩抓到的分 */
  trickScore: number;
  /** 结束当墩桌面上已打出的分 */
  endingTableScore: number;
  /** 庄家手上剩牌计入闲家的分 */
  remainingScore: number;
  bottomScore: number;
  /** 最后一手全主牌才抠底成功，底牌分归闲家 */
  bottomTaken: boolean;
  /** 闲家用天王或大小王赢下最后一墩，挖底成功 */
  digSuccess: boolean;
  digTianWangCount: number;
  digBigJokerCount: number;
  digSmallJokerCount: number;
  digGuaranteeLevel: number;
  lastTrickWinner: number;
  finalCards: Card[];
  /**
   * 最后一墩每家实际打出的牌。
   * finalCards 只有赢家那一手，看不出别人是被压死还是弃牌；
   * 结算页要把各家的最后一手并排摆出来当"牌面证据"。
   */
  lastTrickPlays: { seat: number; cards: Card[] }[];
  /** 本局叫主/抢主/叫分的完整过程，结算页要标明谁叫的主、谁叫的分。 */
  auctionLog: AuctionEntry[];
  bottomCards: Card[];
  bankerRemainingCards: Card[];
  /**
   * 本局各座位真实获得的金币（服务端结算时按 economy.ts 的口径算好发下来）。
   * 只包含已登录的真人；AI 和未登录的座位不在里面。
   * 结算页原来写死「赢 +3 / 输 +1」，跟实际到账的金币完全不是一回事。
   */
  coinRewards?: Record<number, number>;
}

/** 聊天消息 */
export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}
