/**
 * 4人标准场游戏配置
 */

export interface GameModeConfig {
  id: string;
  playerCount: number;
  deckCount: 2 | 3;
  totalCards: number;
  perPlayer: number;
  bottomCount: number;
  discardCount: number;
  totalScore: number;
  fullLevelScore: number;
}

/**
 * 最终产品模式。第一阶段只开放 four_player_two_decks，其余模式共用规则内核。
 * 所有模式最多三副牌。
 */
export const GAME_MODES = {
  threePlayerTwoDecks: {
    id: 'three_player_two_decks',
    playerCount: 3,
    deckCount: 2,
    totalCards: 108,
    perPlayer: 32,
    bottomCount: 12,
    discardCount: 12,
    totalScore: 200,
    fullLevelScore: 125,
  },
  threePlayerThreeDecks: {
    id: 'three_player_three_decks',
    playerCount: 3,
    deckCount: 3,
    totalCards: 162,
    perPlayer: 48,
    bottomCount: 18,
    discardCount: 18,
    totalScore: 300,
    fullLevelScore: 145,
  },
  fourPlayerTwoDecks: {
    id: 'four_player_two_decks',
    playerCount: 4,
    deckCount: 2,
    totalCards: 108,
    perPlayer: 24,
    bottomCount: 12,
    discardCount: 12,
    totalScore: 200,
    fullLevelScore: 125,
  },
  fourPlayerThreeDecks: {
    id: 'four_player_three_decks',
    playerCount: 4,
    deckCount: 3,
    totalCards: 162,
    perPlayer: 36,
    bottomCount: 18,
    discardCount: 18,
    totalScore: 300,
    fullLevelScore: 145,
  },
  fivePlayerThreeDecks: {
    id: 'five_player_three_decks',
    playerCount: 5,
    deckCount: 3,
    totalCards: 162,
    perPlayer: 29,
    bottomCount: 17,
    discardCount: 17,
    totalScore: 300,
    fullLevelScore: 145,
  },
  sixPlayerThreeDecks: {
    id: 'six_player_three_decks',
    playerCount: 6,
    deckCount: 3,
    totalCards: 162,
    perPlayer: 24,
    bottomCount: 18,
    discardCount: 18,
    totalScore: 300,
    fullLevelScore: 145,
  },
} as const satisfies Record<string, GameModeConfig>;

const PHASE_ONE_MODE = GAME_MODES.fourPlayerTwoDecks;

export const GAME_CONFIG = {
  // 玩家数
  playerCount: PHASE_ONE_MODE.playerCount,
  // 副牌数量
  deckCount: PHASE_ONE_MODE.deckCount,
  // 总牌数：2副×54张=108张
  totalCards: PHASE_ONE_MODE.totalCards,
  // 每人发牌数
  perPlayer: PHASE_ONE_MODE.perPlayer,
  // 底牌数量
  bottomCount: PHASE_ONE_MODE.bottomCount,
  // 庄家扣底数量（=底牌数量）
  discardCount: PHASE_ONE_MODE.discardCount,
  // 两副牌总分：每副牌的 5/10/K 合计100分
  totalScore: PHASE_ONE_MODE.totalScore,
  // 两副牌125分满一级；三副牌145分满一级
  fullLevelScore: PHASE_ONE_MODE.fullLevelScore,
  // 满一级后每多45分再加一级
  levelScoreStep: 45,
  // 叫分上限（= 基准分。两副125 / 三副145，实际取 mode.fullLevelScore）
  callScoreMax: PHASE_ONE_MODE.fullLevelScore,
  // 叫分下限
  callScoreMin: 40,
  // 叫分步长
  callScoreStep: 5,
  // 对抗关系：1庄VS3闲
  bankerCount: 1,
  opponentCount: 3,
} as const;

/**
 * 牌的花色枚举
 */
export enum Suit {
  Spade = 0,    // 黑桃
  Heart = 1,     // 红桃
  Diamond = 2,   // 方块
  Club = 3,      // 梅花
  SmallJoker = 4, // 小王
  BigJoker = 5,   // 大王
}

/**
 * 牌面点数枚举
 * 3-14: 3到A (3,4,5,6,7,8,9,10,J,Q,K,A)
 * 15: 2
 * 16: 小王
 * 17: 大王
 */
export enum Rank {
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
  Nine = 9,
  Ten = 10,
  Jack = 11,
  Queen = 12,
  King = 13,
  Ace = 14,
  Two = 15,
  SmallJoker = 16,
  BigJoker = 17,
}

/**
 * 游戏阶段
 */
export enum Phase {
  Waiting = 'waiting',         // 等待玩家加入
  Dealing = 'dealing',          // 发牌
  CallingSuit = 'calling_suit', // 叫主（选定主花色）
  CallingScore = 'calling_score', // 叫分定庄
  Discarding = 'discarding',    // 庄家扣底
  Playing = 'playing',          // 出牌对局
  Settling = 'settling',        // 结算
}

/**
 * 牌型类型
 */
export enum CardType {
  Single = 'single',       // 单张
  Pair = 'pair',           // 对子
  Triple = 'triple',       // 三张完全相同
  Tractor = 'tractor',     // 连对：至少2组同花色连续对子
  TripleRun = 'triple_run',// 连三张：至少2组同花色连续三张，如 333+444+555
  JokerCombo = 'joker_combo', // 王组合：大王组+小王组且组内张数相同，如 大王对+小王对
  Toss = 'toss',           // 甩牌：同门最大的若干张，见 logic/toss.ts
}

/**
 * 牌的数据结构
 */
export interface CardData {
  id: string;     // 唯一ID（多副牌区分）
  suit: number;   // 花色 0=黑桃 1=红桃 2=方块 3=梅花 4=小王 5=大王
  rank: number;   // 点数 3-15(3-A到2), 16=小王, 17=大王
}
