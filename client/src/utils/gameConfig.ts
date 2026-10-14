// ===== 五华天王扑克 4人标准场配置 =====

/**
 * 规则概要（从PRD提取）：
 * - 2副完整牌108张，主花色3为天王
 * - 全局总分200分，5/10/K为分数牌
 */

export const GAME_CONFIG = {
  /** 牌副数 */
  deckCount: 2,
  /** 总牌数 */
  totalCards: 108,
  /** 全局总分 */
  totalScore: 200,
  /** 每人发牌数 */
  cardsPerPlayer: 24,
  /** 玩家数量 */
  playerCount: 4,
  /** 底牌数量 */
  bottomCardCount: 12,
  /** 庄家扣底数量 */
  discardCount: 12,
  /** 叫分上限 */
  callScoreMax: 105,
  /** 叫分下限 */
  callScoreMin: 40,
  /** 叫分步长 */
  callScoreStep: 5,
  /** 对抗关系：1庄VS3闲 */
  bankerCount: 1,
  defenderCount: 3,
} as const;

/** 分数牌分值映射（5=5分, 10=10分, K=10分） */
export const SCORE_CARDS: Record<string, number> = {
  '5': 5,
  '10': 10,
  'K': 10,
};

/** 牌力排序权重（数值越大越强） */
export const RANK_ORDER: Record<string, number> = {
  '3': 0,
  '4': 1,
  '5': 2,
  '6': 3,
  '8': 4,
  '9': 5,
  '10': 6,
  'J': 7,
  'Q': 8,
  'K': 9,
  'A': 10,
  '2': 20,
  '7': 30,
  'small_joker': 40,
  'big_joker': 50,
};

// 注意：主2、主7、天王（主花色3）的权重由 cardUtils 动态计算
