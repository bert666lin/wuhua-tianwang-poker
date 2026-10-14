/**
 * 出牌合法性校验
 *
 * 跟牌规则（按最新确认的玩法）：
 * 1. 首家出主牌，其他家有主必须跟主；
 * 2. 首家出某副牌花色，其他家有该花色副牌必须跟该花色；
 * 3. 同类别（主/副花色）牌不足时，先把手里该类别全部跟出，再用任意牌补齐张数；
 * 4. 跟牌不强制匹配对子/三张/拖拉机结构，只需张数正确、类别跟足。
 *    想用对子/拖拉机/主牌赢墩，是 canCompeteWithLead 在 round.ts 里判断的事。
 * 5. 不支持顺子。
 *
 * 注意：这里只管「跟家跟得对不对」，不校验首家领出的牌型是否合法。
 * 首家牌型（含甩牌这种同门任意多张的形态）由 round.ts 的 submitRoundPlay 负责，
 * 否则甩牌领出后所有跟家都会被误判为非法。
 */

import { CardData } from './config.js';
import { isMainCard } from './compare.js';

/** 一张牌是否属于首家的"类别"：首家是主则跟主，首家是副牌则跟同花色非主牌。 */
export function isLeadCategory(card: CardData, leadCard: CardData, mainSuit: number): boolean {
  if (isMainCard(leadCard, mainSuit)) return isMainCard(card, mainSuit);
  return card.suit === leadCard.suit && !isMainCard(card, mainSuit);
}

/**
 * 跟牌合法性校验。
 */
export function checkFollow(
  firstCards: CardData[],
  playedCards: CardData[],
  playerHand: CardData[],
  mainSuit: number,
): boolean {
  if (firstCards.length === 0 || playedCards.length === 0 || playerHand.length === 0) return false;
  if (playedCards.length !== firstCards.length) return false;

  const leadCard = firstCards[0];
  const availableInCategory = playerHand.filter(c => isLeadCategory(c, leadCard, mainSuit)).length;
  const playedInCategory = playedCards.filter(c => isLeadCategory(c, leadCard, mainSuit)).length;

  // 有多少该类别的牌就必须跟多少，最多跟到首家张数。
  return playedInCategory === Math.min(firstCards.length, availableInCategory);
}

/**
 * 返回手牌中属于首家类别的牌（用于"提示"功能）。
 * 注意：这只是"必须跟出的候选"，最终选几张/怎么补牌由调用方决定。
 */
export function getLeadCategoryCards(
  firstCards: CardData[],
  playerHand: CardData[],
  mainSuit: number,
): CardData[] {
  if (firstCards.length === 0) return playerHand;
  return playerHand.filter(c => isLeadCategory(c, firstCards[0], mainSuit));
}
