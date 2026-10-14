/**
 * 甩牌（Toss）
 *
 * 规则（已与产品确认，2026-09 修正）：
 * 1. 只有首家（本墩第一个出牌的人）可以甩牌，跟牌不能甩。
 * 2. 甩出的牌必须同属一门：主牌算作一门（含天王/大小王/常主/主花色），
 *    副牌则要求同一个花色且都不是主牌。
 * 3. 不要求成对或成拖拉机，同门任意多张即可（≥2 张才算甩牌）。
 * 4. 甩牌成功与否，只取决于【别人压不压得住】：
 *    其他任意一家手上该门只要有一张 > 所甩牌中的最小牌，即甩牌失败。
 * 5. 失败惩罚：收回甩牌，强制只打出所甩牌中最小的一张，
 *    本墩按普通单张继续正常进行，不额外罚分。
 *
 * ⚠️ 曾经有过一条错误的限制（已删除）：「甩出的必须是你手上该门最大的若干张」。
 * 那是把「最大」理解成了"自己手里最大"，而规则里的「最大」是指
 * **别人压不起**。甩牌的本意只是提高出牌效率 —— 我手上这一门反正已经
 * 通吃了，一次打出去让大家跟完，不必一墩一墩磨。
 * 既然如此，玩家想留着 A 先甩 K+Q 也完全合理：只要没人压得住就该放行。
 * 那条限制会把大量本该合法的甩牌判成「甩牌必须是你该门最大的牌」，
 * 也就是用户反馈的"有时候甩不了牌"。
 *
 * 注意：判定要读其他玩家手牌，因此只能在服务端做，客户端仅可做预校验提示。
 */

import { CardData } from './config.js';
import { getCardRank, isMainCard } from './compare.js';

/** 甩牌所属的"门"。主牌统一算一门，副牌按花色分门。 */
export type TossGroup = { kind: 'main' } | { kind: 'suit'; suit: number };

/** 取一张牌所属的门。 */
export function getTossGroup(card: CardData, mainSuit: number): TossGroup {
  return isMainCard(card, mainSuit) ? { kind: 'main' } : { kind: 'suit', suit: card.suit };
}

/** 两个门是否相同。 */
export function isSameGroup(a: TossGroup, b: TossGroup): boolean {
  if (a.kind === 'main' || b.kind === 'main') return a.kind === b.kind;
  return a.suit === b.suit;
}

/** 一张牌是否属于指定的门。 */
export function isInGroup(card: CardData, group: TossGroup, mainSuit: number): boolean {
  return isSameGroup(getTossGroup(card, mainSuit), group);
}

export type TossRejectReason =
  | 'not_leader'        // 不是首家
  | 'too_few'           // 少于 2 张，按普通出牌处理
  | 'mixed_group'       // 跨门
  | 'not_in_hand';      // 有牌不在手上
  // 注意：这里【故意】没有 'not_highest'。
  // 「甩出的必须是自己该门最大的若干张」曾是一条错误限制，已删除，
  // 详见文件顶部说明。别再加回来。

export interface TossValidation {
  /** 是否构成一次合法的甩牌尝试。 */
  valid: boolean;
  reason?: TossRejectReason;
  /** 甩牌所属的门（valid 时有值）。 */
  group?: TossGroup;
  /** 所甩牌中最小的一张（valid 时有值，失败惩罚要打它）。 */
  lowest?: CardData;
}

/**
 * 校验甩牌是否满足「同门 + 都是自己该门最大的若干张」。
 * 这一步只看自己的手牌，不涉及其他玩家。
 */
export function validateToss(
  cards: CardData[],
  playerHand: CardData[],
  mainSuit: number,
  isLeader: boolean,
): TossValidation {
  if (!isLeader) return { valid: false, reason: 'not_leader' };
  if (cards.length < 2) return { valid: false, reason: 'too_few' };

  // 所有牌必须在手上（按 id 唯一，多副牌靠 id 区分）
  const handIds = new Set(playerHand.map(c => c.id));
  if (cards.some(c => !handIds.has(c.id))) return { valid: false, reason: 'not_in_hand' };

  // 必须同门
  const group = getTossGroup(cards[0], mainSuit);
  if (cards.some(c => !isInGroup(c, group, mainSuit))) {
    return { valid: false, reason: 'mixed_group' };
  }

  const lowest = lowestCard(cards, mainSuit);

  /* 这里【不】检查"是不是自己该门最大的若干张"。
   * 手上留着更大的牌照样可以甩 —— 能不能甩成，只由 challengeToss
   * 看别人压不压得住来决定。详见文件顶部的说明。 */
  return { valid: true, group, lowest };
}

/** 取一组牌里牌力最小的一张。 */
export function lowestCard(cards: CardData[], mainSuit: number): CardData {
  if (cards.length === 0) throw new Error('lowestCard: empty cards');
  return cards.reduce((min, c) =>
    getCardRank(c, mainSuit) < getCardRank(min, mainSuit) ? c : min
  );
}

export interface TossChallengeResult {
  /** 甩牌是否成功。 */
  success: boolean;
  /** 失败时：压住甩牌的那些座位。 */
  blockedBy: number[];
  /** 失败时：强制改为打出的这一张（所甩牌中最小的）。 */
  forcedCard?: CardData;
}

/**
 * 甩牌挑战：看其他玩家手上该门有没有比所甩最小牌更大的牌。
 * 只要有任意一张更大，甩牌即失败。
 *
 * @param otherHands 其他玩家手牌，key 为座位号（不含甩牌者本人）
 */
export function challengeToss(
  cards: CardData[],
  group: TossGroup,
  otherHands: Map<number, CardData[]>,
  mainSuit: number,
): TossChallengeResult {
  const lowest = lowestCard(cards, mainSuit);
  const threshold = getCardRank(lowest, mainSuit);

  const blockedBy: number[] = [];
  for (const [seat, hand] of otherHands) {
    const hasBigger = hand.some(
      c => isInGroup(c, group, mainSuit) && getCardRank(c, mainSuit) > threshold
    );
    if (hasBigger) blockedBy.push(seat);
  }

  blockedBy.sort((a, b) => a - b);
  return blockedBy.length === 0
    ? { success: true, blockedBy: [] }
    : { success: false, blockedBy, forcedCard: lowest };
}

export interface TossResolution {
  /** 甩牌是否被接受。 */
  accepted: boolean;
  /** 最终实际打出的牌：成功=原样甩出，失败=只打最小那张。 */
  cards: CardData[];
  reason?: TossRejectReason;
  blockedBy?: number[];
}

/**
 * 甩牌完整结算：先校验资格，再让其他玩家"挑战"。
 * 失败时按规则收回甩牌，只打出所甩牌中最小的一张。
 */
export function resolveToss(
  cards: CardData[],
  playerHand: CardData[],
  otherHands: Map<number, CardData[]>,
  mainSuit: number,
  isLeader: boolean,
): TossResolution {
  const check = validateToss(cards, playerHand, mainSuit, isLeader);
  if (!check.valid || !check.group || !check.lowest) {
    return { accepted: false, cards: [], reason: check.reason };
  }

  const challenge = challengeToss(cards, check.group, otherHands, mainSuit);
  if (challenge.success) {
    return { accepted: true, cards: [...cards] };
  }

  // 失败：强制只打出最小的一张，本墩转为普通单张继续
  return {
    accepted: false,
    cards: [challenge.forcedCard!],
    blockedBy: challenge.blockedBy,
  };
}
