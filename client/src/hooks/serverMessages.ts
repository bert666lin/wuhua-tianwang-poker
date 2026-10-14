// ===== 服务端 → 客户端消息的类型契约 =====
//
// 为什么单独一个文件：useColyseus.ts 里每个 onMessage 回调原先都写
// `(message: any)`，等于把服务端广播的字段全部当成"随便什么都行"。
// 后果不是编译报错，而是**静默的错值**——服务端把 `seatIndex` 改名成 `seat`
// 之后，`message.seatIndex` 变 undefined，`Number(undefined)` 得到 NaN，
// 画面上就是"计分飘字飘到了错误的位置"或者干脆不出现，没有任何报错。
//
// 这里按服务端 GameRoom.ts 的 broadcast/send 实际字段一一对应地声明。
// 字段全部标可选 + 用下面的 read* 取值：网络来的数据不可信，
// 而且新旧客户端会同时在线（安卓壳里装的是旧包），少一个字段不该白屏。

/** 服务端 CardData 的线上格式：花色/点数都是数字，前端再转成字符串。 */
export interface WireCard {
  id: string;
  suit: number;
  rank: number;
}

/** 一名玩家在某一墩打出的牌（trick_end 里按座位分组）。 */
export interface WireTrickPlay {
  seat: number;
  cards?: WireCard[];
}

/** 轮到某人操作时下发的倒计时信息，叫主/叫分/扣底/出牌共用。 */
export interface DeadlineMessage {
  /** 绝对截止时间戳（毫秒）。优先用它，避免两端时钟漂移放大误差。 */
  deadline?: number;
  /** 时限秒数，服务端没给 deadline 时用它现算。 */
  timeLimit?: number;
}

export interface DealMessage {
  hand?: WireCard[];
}

export interface HandUpdateMessage {
  hand?: WireCard[];
}

export interface DealBottomMessage {
  bottomCards?: WireCard[];
}

export interface DiscardStagedMessage {
  staged?: WireCard[];
  stagedCount?: number;
  need?: number;
  remaining?: number;
  /** 已经凑够张数，可以点「确认埋底」了（由服务端判定，见 GameRoom.sendStagingUpdate）。 */
  canConfirm?: boolean;
}

export interface ScoreBidMessage {
  playerId?: string;
  playerName?: string;
  seatIndex?: number;
  score?: number;
}

export interface ActionTimeoutMessage {
  playerId?: string;
  playerName?: string;
  seatIndex?: number;
  phase?: string;
}

export interface PlayTurnMessage extends DeadlineMessage {
  playerId?: string;
  playerName?: string;
  seatIndex?: number;
  isLeader?: boolean;
  requiredCount?: number;
  isTrustee?: boolean;
}

export interface AutoPlayMessage {
  seatIndex?: number;
  playerName?: string;
  /** 是否已进入持续托管（连续两次超时）。 */
  trustee?: boolean;
}

export interface TrusteeMessage {
  playerId?: string;
  playerName?: string;
  seatIndex?: number;
  reason?: 'timeout' | 'offline' | string;
}

export interface ReconnectedMessage {
  phase?: string;
  isTrustee?: boolean;
  /** 只有「重连回来时正在扣底的庄家」才会带底牌。 */
  bottomCards?: WireCard[];
}

export interface HintResultMessage {
  cardIds?: unknown[];
  /** 同样的牌但是新一次提示，用它触发重选。 */
  nonce?: number;
  index?: number;
  total?: number;
}

export interface DiscardHintResultMessage {
  cardIds?: unknown[];
}

export interface TrickEndMessage {
  winnerSeat?: number;
  trickScore?: number;
  allCards?: WireCard[];
  plays?: WireTrickPlay[];
}

export interface TossResultMessage {
  seatIndex?: number;
  playerName?: string;
  success?: boolean;
  cardIds?: unknown[];
  /** 玩家原本想甩的牌；失败时用来提示「原甩 N 张」。 */
  attemptedCardIds?: unknown[];
  /** 被哪几家挡下（服务端判定甩牌不成立的依据）。 */
  blockedBy?: unknown[];
}

export interface ChatMessagePayload {
  playerId?: string;
  playerName?: string;
  text?: string;
}

export interface VoiceMessagePayload {
  playerId?: string;
  playerName?: string;
  seatIndex?: number;
  /** 容器 MIME：浏览器不同（webm/opus 或 mp4/aac），播放端要用它构造 Blob。 */
  mime?: string;
  /** 同一次按住说话的所有分片共享的 id。 */
  sessionId?: string;
  /** 分片序号。服务端原样转发，当前播放端按到达顺序播，没用到它。 */
  seq?: number;
  data?: unknown;
}

export interface ErrorMessage {
  message?: string;
}

/** 局终结算：字段与服务端 settleGame 组装的 result 对齐。 */
export interface GameSettledMessage {
  bankerWin?: boolean;
  finisherSeat?: number;
  finisherIsBanker?: boolean;
  level?: number;
  levelDeltas?: unknown[];
  callScore?: number;
  opponentScore?: number;
  bankerScore?: number;
  scoreLevel?: number;
  digLevel?: number;
  trickScore?: number;
  endingTableScore?: number;
  remainingScore?: number;
  bottomScore?: number;
  bottomTaken?: boolean;
  digSuccess?: boolean;
  digTianWangCount?: number;
  digBigJokerCount?: number;
  digSmallJokerCount?: number;
  digGuaranteeLevel?: number;
  lastTrickWinner?: number;
  finalCards?: WireCard[];
  /** 最后一墩每家打出的牌（座位 -> 牌）。 */
  lastTrickPlays?: { seat?: number; cards?: WireCard[] }[];
  /** 叫主/抢主/叫分的完整过程。 */
  auctionLog?: {
    kind?: string;
    seatIndex?: number;
    playerName?: string;
    suit?: number;
    sevenCount?: number;
    score?: number;
  }[];
  bottomCards?: WireCard[];
  bankerRemainingCards?: WireCard[];
  /** seatIndex -> 本局金币变化，结算页显示「+200 金币」。 */
  coinRewards?: Record<number, number>;
}

// ===== 取值辅助 =====
// 网络来的字段可能缺失或类型不对。这几个函数保证"拿到的一定是能用的值"，
// 而不是把 undefined 往下传，等到渲染时才变成 NaN 或空白。

/** 取数字；缺失或不是有限数时返回兜底值（默认 0）。 */
export function readNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 取字符串；缺失时返回兜底值。 */
export function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** 取数组；不是数组时返回空数组（调用方可以放心 .map）。 */
export function readArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 取牌 id 列表：统一转成字符串，过滤掉空值。
 *
 * 注意要**先**滤掉 null/undefined 再 String()——反过来的话
 * String(null) 得到 `"null"`，那是个长度 4 的"有效"字符串，
 * 会被当成一个真实牌 id 传下去，然后永远匹配不到任何一张牌。
 */
export function readCardIds(value: unknown): string[] {
  return readArray(value as unknown[])
    .filter(id => id !== null && id !== undefined)
    .map(String)
    .filter(id => id.length > 0);
}
