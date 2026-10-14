// ===== 叫主 / 叫分的规则判定 =====
// 从 GameRoom.ts 抽出（原文件 2279 行）。
//
// 为什么值得独立：这些门槛原先在「真人操作」和「AI 代打」两条路径里各写了
// 一遍（handleCallSuit vs performAiSuitCall、handleCallScore vs
// performAiScoreCall）。改规则时漏改一边，就会出现「AI 能抢主但真人不能」
// 这类没人能一眼看出的偏差。现在两条路径调同一个函数，且能单测。

import { Suit, GAME_CONFIG, type CardData } from './config.js';

/**
 * 把队列旋转到从 startIndex 开始（叫主/叫分都按座位顺序轮一圈）。
 *
 * 越界起点必须原样返回整个队列，保证「一定有人先叫」——
 * 上一局庄家已离桌时 findIndex 会给 -1，这种情况真的会发生。
 * 其中 `<= 0` 那半边是必需的（slice(-1) 只会取到最后一个，队列就乱了）；
 * `>= items.length` 那半边严格说是冗余（slice 对超大下标本来就返回全量），
 * 留着只是把「起点不可信时原样返回」这个意图写明白。
 */
export function rotateFrom<T>(items: T[], startIndex: number): T[] {
  if (startIndex <= 0 || startIndex >= items.length) return [...items];
  return [...items.slice(startIndex), ...items.slice(0, startIndex)];
}

/**
 * 当前叫主/抢主要亮出的同花色 7 的张数。
 * 还没人叫主时 1 张即可；已有人叫主时必须比他亮的更多（同花色再叫也要更多）。
 */
export function requiredSevens(mainSuit: number, mainSuitCallCount: number): number {
  return mainSuit === 255 ? 1 : mainSuitCallCount + 1;
}

export type BidCheck =
  | { ok: true; sevenCount: number }
  | { ok: false; message: string };

/**
 * 校验一次叫主/抢主。
 *
 * 通过时返回该亮几张 7：**只亮到刚好够门槛的张数**，多余的 7 留着不亮。
 * 抢主要做庄，做庄不一定赢；亮少一点既给后面的人留抢主空间，也不暴露牌力。
 */
export function checkSuitCall(input: {
  suit: number;
  hand: CardData[];
  mainSuit: number;
  mainSuitCallCount: number;
}): BidCheck {
  if (input.suit < Suit.Spade || input.suit > Suit.Club) {
    return { ok: false, message: '无效主花色' };
  }
  const owned = input.hand.filter(
    card => card.suit === input.suit && card.rank === 7,
  ).length;
  if (owned === 0) {
    return { ok: false, message: '必须持有对应花色的7才能叫主' };
  }
  const required = requiredSevens(input.mainSuit, input.mainSuitCallCount);
  if (owned < required) {
    return { ok: false, message: `抢主需要${required}张7，你只有${owned}张` };
  }
  return { ok: true, sevenCount: required };
}

/**
 * 当前轮到的人最高能叫多少分。
 * 还没人叫过就是基准分（125/145）；已经有人叫过必须比他低一个步长。
 */
export function currentBidCeiling(input: {
  hasBidder: boolean;
  currentBid: number;
  bidMax: number;
}): number {
  return input.hasBidder
    ? input.currentBid - GAME_CONFIG.callScoreStep
    : input.bidMax;
}

/**
 * 校验一次叫分。叫分从基准分往下叫，谁叫得最低谁坐庄。
 * 放弃叫分（score === 0）不走这里，由调用方直接跳过。
 */
export function checkScoreBid(input: {
  score: number;
  bidMax: number;
  currentBid: number;
  hasBidder: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (input.score < GAME_CONFIG.callScoreMin || input.score > input.bidMax) {
    return { ok: false, message: '叫分超出范围' };
  }
  if (input.score % GAME_CONFIG.callScoreStep !== 0) {
    return { ok: false, message: `叫分必须是${GAME_CONFIG.callScoreStep}的倍数` };
  }
  if (input.hasBidder && input.score >= input.currentBid) {
    return { ok: false, message: `后叫必须低于${input.currentBid}分` };
  }
  return { ok: true };
}

/**
 * AI 算出的分数能不能真的叫出去。
 *
 * 两种情况都算有效：比当前最低价更低（正常压价），
 * 或者还没人叫、AI 想按基准分开叫（此时 score === bidMax，不算"更低"）。
 */
export function isAiBidUsable(input: {
  score: number;
  currentBid: number;
  hasBidder: boolean;
  bidMax: number;
}): boolean {
  if (input.score >= GAME_CONFIG.callScoreMin && input.score < input.currentBid) return true;
  return !input.hasBidder && input.score === input.bidMax;
}

/**
 * 叫分是否该收尾：轮完一圈，或者已经有人叫到下限（不可能再被压价）。
 */
export function isBiddingDone(input: {
  nextIndex: number;
  orderLength: number;
  currentBid: number;
}): boolean {
  return input.nextIndex >= input.orderLength
    || input.currentBid === GAME_CONFIG.callScoreMin;
}

/**
 * 无人叫主时翻底牌定主：翻到大王算红桃、小王算黑桃，其余按翻出的花色。
 */
export function suitFromFlippedCard(card: CardData): number {
  if (card.suit === Suit.BigJoker) return Suit.Heart;
  if (card.suit === Suit.SmallJoker) return Suit.Spade;
  return card.suit;
}
