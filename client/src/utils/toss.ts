// ===== 甩牌客户端预校验 =====
// 与服务端 server/src/logic/toss.ts 规则保持一致，但**只能校验能看到的信息**：
// 是不是本墩先出牌的人、够不够 2 张、是不是同一门。
//
// 「能不能甩成」只由「别人压不压得住」决定，而别人的手牌客户端看不到，
// 所以这里【不】做任何牌力大小的判断 —— 本模块只负责挡住那些
// 一眼就不合法的操作（跨门、跟牌时想甩），最终判定一律以服务端为准。
//
// ⚠️ 这里曾经还检查过「甩出的必须是你手上该门最大的若干张」，那是错的：
// 规则里的「最大」指的是**别人压不起**，不是"自己手里最大"。
// 甩牌的本意只是提高出牌效率（我这门反正通吃了，一次打完省得一墩墩磨），
// 所以留着 A 先甩 K+Q 完全合理。那条检查会把大量本该合法的甩牌
// 拦在客户端，就是用户反馈的"有时候甩不了牌"。

import type { Card, Suit } from '../types';
import { isMainCard } from './cardUtils';

/** 甩牌所属的门。主牌统一算一门，副牌按花色分门。 */
export type TossGroup = { kind: 'main' } | { kind: 'suit'; suit: Suit };

export function getTossGroup(card: Card, mainSuit: Suit | null): TossGroup {
  return isMainCard(card, mainSuit) ? { kind: 'main' } : { kind: 'suit', suit: card.suit };
}

export function isSameGroup(a: TossGroup, b: TossGroup): boolean {
  if (a.kind === 'main' || b.kind === 'main') return a.kind === b.kind;
  return a.suit === b.suit;
}

export function isInGroup(card: Card, group: TossGroup, mainSuit: Suit | null): boolean {
  return isSameGroup(getTossGroup(card, mainSuit), group);
}

export interface TossPrecheck {
  /** 本地可见规则是否通过（仍需服务端做压制判定）。 */
  ok: boolean;
  /** 不通过时给用户看的中文原因。 */
  reason?: string;
}

/**
 * 甩牌本地预校验。
 * @param isLeader 是否本墩首家
 */
export function precheckToss(
  cards: Card[],
  /**
   * 自己的整手牌。
   *
   * 现在【用不到】，但签名保留：一是调用点还在传，二是留个明确的位置提醒
   * 后来人 —— 会想拿它来做"是不是自己最大"的校验，而那正是错的（见文件头）。
   */
  _hand: Card[],
  mainSuit: Suit | null,
  isLeader: boolean,
): TossPrecheck {
  // 「首家」= 本墩第一个出牌的人。每墩都会换人（上一墩的赢家领出下一墩），
  // 不是「整局第一个出牌的人」。提示必须说清楚，否则玩家会误以为只有开局能甩。
  if (!isLeader) return { ok: false, reason: '只有本墩先出牌的人可以甩牌，跟牌不能甩' };
  if (cards.length < 2) return { ok: false, reason: '甩牌至少要选 2 张' };

  const group = getTossGroup(cards[0], mainSuit);
  if (cards.some(c => !isInGroup(c, group, mainSuit))) {
    return { ok: false, reason: '甩牌必须是同一门牌（主牌算一门）' };
  }

  /* 到这里本地能查的都查完了。
   * 「别人有没有更大的牌」看不到，所以不再拦 —— 交给服务端判。
   * 客户端多拦一层的代价是"明明能甩却按不动"，那比让服务端回一句
   * "被某家压住了"糟糕得多。 */
  return { ok: true };
}
