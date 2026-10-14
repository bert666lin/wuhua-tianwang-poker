/**
 * 分数计算逻辑
 * 
 * 计分规则：
 * - 5 = 5分
 * - 10 = 10分
 * - K = 10分
 * - 其他牌 = 0分
 * 
 * 抠底规则：
 * - 最后一轮主牌赢才抠底，副牌赢不抠
 * - 抠底分数 = 底牌总分 × 倍数（基础倍数1，可根据规则扩展）
 */

import { CardData, Rank } from './config.js';

/**
 * 获取单张牌的分值
 * - 5 = 5分
 * - 10 = 10分
 * - K = 10分
 * - 其他 = 0分
 */
export function getCardScore(card: CardData): number {
  if (card.rank === Rank.Five) return 5;
  if (card.rank === Rank.Ten) return 10;
  if (card.rank === Rank.King) return 10;
  return 0;
}

/**
 * 计算一组牌的总分
 * @param cards 牌数组
 * @returns 总分
 */
export function calcTrickScore(cards: CardData[]): number {
  return cards.reduce((sum, card) => sum + getCardScore(card), 0);
}

/**
 * 抠底分数计算
 * 
 * 抠底规则：
 * - 最后一轮主牌赢才抠底，副牌赢不抠
 * - 底牌中的分数牌计入抠底分数
 * - 抠底倍数：基础为1倍，可根据实际规则扩展（如2倍、4倍等）
 * 
 * @param bottomCards 底牌
 * @param isMainWin 最后一轮是否主牌赢
 * @param multiplier 倍数（默认1）
 * @returns 抠底总分
 */
export function calcKouDi(
  bottomCards: CardData[],
  isMainWin: boolean,
  multiplier: number = 1
): number {
  if (!isMainWin) return 0;
  
  const bottomScore = calcTrickScore(bottomCards);
  return bottomScore * multiplier;
}

/**
 * 计算闲家总分（用于判断是否过庄）
 * 闲家总分 = 各轮赢的分数总和 + 抠底分数
 * 
 * @param trickScores 各轮赢的分数数组
 * @param bottomScore 抠底分数
 * @returns 闲家总分
 */
export function calcOpponentTotalScore(
  trickScores: number[],
  bottomScore: number
): number {
  const tricksTotal = trickScores.reduce((sum, score) => sum + score, 0);
  return tricksTotal + bottomScore;
}

/**
 * 判断是否过庄（闲家赢）
 * 
 * @param opponentScore 闲家总分
 * @param callScore 庄家叫的分
 * @returns true=闲家赢（打倒庄家）, false=庄家赢
 */
export function isOpponentWin(
  opponentScore: number,
  callScore: number
): boolean {
  // 闲家得分 >= 庄家叫分，则闲家赢
  return opponentScore >= callScore;
}

/**
 * 获取整局游戏的分数分布
 * 
 * @param opponentScore 闲家总分
 * @param totalScore 全局总分（两副牌共200分）
 * @returns { bankerScore: 庄家得分, opponentScore: 闲家得分 }
 */
export function getGameScoreDistribution(
  opponentScore: number,
  totalScore: number = 200
): { bankerScore: number; opponentScore: number } {
  return {
    bankerScore: totalScore - opponentScore,
    opponentScore,
  };
}
