// ===== Colyseus Schema 状态的读取形状 =====
//
// 服务端的权威定义在 server/src/states/*.ts（GameState / PlayerState /
// TrickPlayState），那些类带 @colyseus/schema 装饰器，客户端不能直接 import
// （会把整个服务端模块拖进前端包）。这里声明「客户端实际会读到的那部分」，
// 替掉原来的 `state: any`。
//
// 为什么全部可选：Colyseus 的状态是增量同步的。刚 join 那一瞬间只到了一部分
// 字段，剩下的还在路上；写成必填会让类型系统骗人——编译不报错，运行时照样
// 拿到 undefined。标可选后，取值处被迫走 readNumber 之类的兜底，
// 这才是真实情况。
//
// ⚠️ 改服务端 Schema 时这里要跟着改。字段名不一致不会编译报错（少一个字段
// 只是永远读到 undefined），所以 roomStateShape.test.ts 会交叉读服务端源码
// 校验字段名，改错一边测试就红。

/** 线上牌：花色/点数都是数字，见 server/src/states/CardSchema.ts。 */
export interface CardSchemaLike {
  id: string;
  suit: number;
  rank: number;
}

/**
 * Colyseus 的 ArraySchema / MapSchema 在客户端只用得到 forEach 和 length。
 * 不直接用 Array 类型：ArraySchema 并不是真数组，标成数组会让人误以为
 * 可以 .map/.filter（运行时确实有，但语义与同步时机不同，容易踩）。
 */
export interface SchemaCollection<T> {
  forEach(cb: (value: T, key: never) => void): void;
  readonly length?: number;
}

/** MapSchema：遍历时能同时拿到 key（座位号是字符串形式）。 */
export interface SchemaMap<T> {
  forEach(cb: (value: T, key: string) => void): void;
}

/** 见 server/src/states/PlayerState.ts。 */
export interface PlayerStateLike {
  id: string;
  name: string;
  seatIndex: number;
  isBanker: boolean;
  isReady: boolean;
  score: number;
  takenScore: number;
  isOffline: boolean;
  handCount: number;
  isCalling: boolean;
  isAI: boolean;
  isOwner?: boolean;
  isAutoPlay?: boolean;
  isTrusteeByOffline?: boolean;
  /** 本房间累计级数（可负）。与 score（账号终身积分）不是一回事。 */
  roomLevel?: number;
  roomBankerCount?: number;
  roomBankerWins?: number;
}

/** 见 server/src/states/TrickPlayState.ts。 */
export interface TrickPlayStateLike {
  seatIndex?: number;
  cards?: SchemaCollection<CardSchemaLike>;
}

/** 见 server/src/states/AuctionEntryState.ts。 */
export interface AuctionEntryStateLike {
  kind?: string;
  seatIndex?: number;
  playerName?: string;
  suit?: number;
  sevenCount?: number;
  score?: number;
}

/** 见 server/src/states/RoundRecordState.ts。 */
export interface RoundRecordStateLike {
  roundNo?: number;
  bankerSeat?: number;
  callScore?: number;
  bankerWin?: boolean;
  level?: number;
  opponentScore?: number;
  /** 战果代号（'bald' / 'small_bald' / 'hold' / 'dig' / 'over' / 'flow_break'）。 */
  outcome?: string;
  /** ArraySchema<number>，只能 forEach。 */
  deltas?: SchemaCollection<number>;
}

/** 见 server/src/states/GameState.ts。 */
export interface GameStateLike {
  modeId?: string;
  modePlayerCount?: number;
  tierId?: string;
  isCardRoom?: boolean;
  phase?: string;
  /** 0-3 是四个花色，255 = 还没定主。 */
  mainSuit?: number;
  mainSuitCallCount?: number;
  /** 255 = 还没定庄。 */
  bankerSeat?: number;
  callScore?: number;
  nextBidMax?: number;
  totalScore?: number;
  currentTurn?: number;
  lastTrick?: SchemaCollection<CardSchemaLike>;
  /** 255 = 还没有上一墩。 */
  lastWinner?: number;
  currentTrick?: SchemaCollection<CardSchemaLike>;
  currentPlays?: SchemaMap<TrickPlayStateLike>;
  requiredPlayCount?: number;
  currentWinnerSeat?: number;
  trickLeader?: number;
  players?: SchemaMap<PlayerStateLike>;
  round?: number;
  bottomCount?: number;
  /** 本局叫主/抢主/叫分的过程（重连的人也能拿到完整记录）。 */
  auction?: SchemaCollection<AuctionEntryStateLike>;
  /** 这张桌子打完的每一局战果，按时间顺序。 */
  history?: SchemaCollection<RoundRecordStateLike>;
  /** 打完几局（= history.length 的冗余标量）。 */
  roundsPlayed?: number;
}
