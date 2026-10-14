// ===== 客户端牌型识别 =====
//
// 为什么单独一个文件、而不是继续用 cardUtils.describePattern？
//   老的 describePattern 有三处硬伤，标出来的牌型会和服务端判定打架：
//     1. 不收 mainSuit，判不出「主副不能混组」。主♠时 ♦6♦6+♦7♦7 它显示
//        「拖拉机」，但服务端会拒绝 —— 因为♦7是常主、♦6是副牌，混组不成型。
//        标错比不标更糟：玩家照着标签出牌，被服务端打回来会以为是 bug。
//     2. 认不出连三张（333+444）和王组合（大王对+小王对），一律落到「N 张」。
//     3. 跨接顺序只判了 A-2-3，漏了服务端支持的 K-A-2-3。
//
// 本文件是 server/src/logic/compare.ts 里 identifyCardType / isConsecutiveGroups
// 的镜像实现。**改服务端规则时这里必须同步改**，单测里锁了几组边界值。
//
// 服务端点数枚举是数字（Three=3 … Ace=14, Two=15, SmallJoker=16, BigJoker=17），
// 客户端是字符串，所以这里先把 rank 映射成同一套数字再套用同样的算法，
// 避免两边各写一套顺序表以后走偏。

import type { Card, Suit } from '../types';
import { isMainCard } from './cardUtils';

/** 与服务端 CardType 对齐的牌型标识。null = 不是合法牌型。 */
export type PatternKind =
  | 'single'
  | 'pair'
  | 'triple'
  | 'tractor'
  | 'triple_run'
  | 'joker_combo';

/** 客户端 rank 字符串 -> 服务端 Rank 数值。顺序必须与 logic/config.ts 的 Rank 枚举一致。 */
const RANK_VALUE: Record<string, number> = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14, '2': 15,
  small_joker: 16, big_joker: 17,
};

const ACE = RANK_VALUE.A;   // 14
const TWO = RANK_VALUE['2']; // 15

/**
 * 拖拉机的「下一个点数」。镜像服务端 nextTractorRank。
 * 链路是 3→4→…→K→A→2→3，所以 K-A-2-3 能跨接，而 2 之后回到 3。
 */
function nextTractorRank(rank: number): number | null {
  if (rank === ACE) return TWO;
  if (rank === TWO) return 3;
  if (rank >= 3 && rank < ACE) return rank + 1;
  return null;
}

/** 花色+点数完全相同（多副牌里 id 不同但牌面一样）。镜像服务端 isSameFace。 */
function isSameFace(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/**
 * 同花色「连续等量组」判定，连对（groupSize=2）与连三张（groupSize=3）共用。
 * 镜像服务端 isConsecutiveGroups，四条约束一条都不能少：
 *   1. 全部同花色，大小王不能参与（服务端用 suit > Club 挡，这里挡 'joker'）；
 *   2. 主副归属必须一致 —— 这是老实现漏掉、最容易踩的一条；
 *   3. 每个点数恰好 groupSize 张，至少 2 组；
 *   4. 点数按 nextTractorRank 链连续，允许 K-A-2-3 跨接。
 */
function isConsecutiveGroups(cards: Card[], groupSize: number, mainSuit: Suit | null): boolean {
  if (cards.length < groupSize * 2 || cards.length % groupSize !== 0) return false;
  if (cards[0].suit === 'joker') return false;
  if (cards.some(c => c.suit !== cards[0].suit)) return false;

  const firstIsMain = isMainCard(cards[0], mainSuit);
  if (cards.some(c => isMainCard(c, mainSuit) !== firstIsMain)) return false;

  const counts = new Map<number, number>();
  for (const c of cards) {
    const v = RANK_VALUE[c.rank];
    if (v === undefined) return false;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if ([...counts.values()].some(n => n !== groupSize)) return false;

  const ranks = new Set(counts.keys());
  // 从任一点数起顺着链走，能一次覆盖全部组才算连续（覆盖 K-A-2-3 这种起点不在最小值的情况）
  for (const start of ranks) {
    let current: number | null = start;
    let matched = true;
    for (let i = 1; i < ranks.size; i++) {
      current = current === null ? null : nextTractorRank(current);
      if (current === null || !ranks.has(current)) { matched = false; break; }
    }
    if (matched) return true;
  }
  return false;
}

/** 连对（拖拉机）。 */
export function isTractor(cards: Card[], mainSuit: Suit | null): boolean {
  return isConsecutiveGroups(cards, 2, mainSuit);
}

/** 连三张。 */
export function isTripleRun(cards: Card[], mainSuit: Suit | null): boolean {
  return isConsecutiveGroups(cards, 3, mainSuit);
}

/**
 * 王组合：大王组 + 小王组，两组张数相同（大王对+小王对、三大王+三小王…）。
 * 大小王没有花色，走不通同花色连续那套判定，所以单独成型。
 */
export function isJokerCombo(cards: Card[]): boolean {
  if (cards.length < 4 || cards.length % 2 !== 0) return false;
  const big = cards.filter(c => c.suit === 'joker' && c.rank === 'big_joker').length;
  const small = cards.filter(c => c.suit === 'joker' && c.rank === 'small_joker').length;
  if (big + small !== cards.length) return false;
  return big === small && big >= 2;
}

/** 识别牌型。判定顺序必须与服务端 identifyCardType 一致（王组合要在连对之前）。 */
export function identifyPattern(cards: Card[], mainSuit: Suit | null): PatternKind | null {
  if (cards.length === 0) return null;
  if (cards.length === 1) return 'single';
  if (cards.length === 2) return cards.every(c => isSameFace(c, cards[0])) ? 'pair' : null;
  if (cards.length === 3 && cards.every(c => isSameFace(c, cards[0]))) return 'triple';
  if (isJokerCombo(cards)) return 'joker_combo';
  if (isTractor(cards, mainSuit)) return 'tractor';
  if (isTripleRun(cards, mainSuit)) return 'triple_run';
  return null;
}

const KIND_LABEL: Record<PatternKind, string> = {
  single: '单张',
  pair: '对子',
  triple: '三张',
  tractor: '拖拉机',
  triple_run: '连三张',
  joker_combo: '王组合',
};

/**
 * 牌型中文标签，用于操作栏提示。
 * 认不出来时不编名字，直接报张数 —— 可能是甩牌（服务端另有 toss 判定），
 * 也可能压根不合规，这两种都不该显示一个像模像样的牌型名去误导玩家。
 */
export function describeSelection(cards: Card[], mainSuit: Suit | null): string {
  if (cards.length === 0) return '';
  const kind = identifyPattern(cards, mainSuit);
  if (kind) {
    // 连对/连三张再补上组数，「拖拉机×3」比光写「拖拉机」信息量大
    if (kind === 'tractor' || kind === 'triple_run') {
      const groups = new Set(cards.map(c => c.rank)).size;
      return `${KIND_LABEL[kind]}×${groups}`;
    }
    return KIND_LABEL[kind];
  }
  return `${cards.length} 张`;
}
