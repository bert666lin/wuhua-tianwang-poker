// ===== 五华天王扑克 牌力工具 =====

import type { Card, Suit, Rank } from '../types';
import { SCORE_CARDS } from './gameConfig';

/**
 * 常主排序（从大到小）：
 * 主花色3(天王) > 大王 > 小王 > 主7 > 副7 > 主2 > 副2 > A > K > Q > J > 10 > 9 > 8 > 6 > 5 > 4 > 普通3
 *
 * 其中"主"指与主花色同花色的牌。
 * 天王随主花色变化。
 */

/** 判断是否主牌：主花色全部牌、大小王、所有花色的7和2。 */
export function isMainCard(card: Card, mainSuit: Suit | null): boolean {
  if (card.suit === 'joker') return true;
  if (card.rank === '7' || card.rank === '2') return true;
  if (mainSuit && card.suit === mainSuit) return true;
  return false;
}

/**
 * 获取牌力权重值
 * 主牌 > 副牌；同级内主花色 > 副花色
 */
export function getCardPower(card: Card, mainSuit: Suit | null): number {
  if (mainSuit && card.suit === mainSuit && card.rank === '3') return 1000;
  if (card.suit === 'joker' && card.rank === 'big_joker') return 900;
  if (card.suit === 'joker' && card.rank === 'small_joker') return 800;
  if (card.rank === '7') return card.suit === mainSuit ? 700 : 600;
  if (card.rank === '2') return card.suit === mainSuit ? 500 : 400;

  const numericRank: Record<Rank, number> = {
    '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, J: 11, Q: 12, K: 13, A: 14, '2': 15,
    small_joker: 16, big_joker: 17,
  };
  return (card.suit === mainSuit ? 300 : 100) + numericRank[card.rank];
}

/**
 * 比较两张牌大小
 * @returns 正数=cardA更大，负数=cardB更大，0=相等
 */
export function compareCard(cardA: Card, cardB: Card, mainSuit: Suit | null): number {
  const aMain = isMainCard(cardA, mainSuit);
  const bMain = isMainCard(cardB, mainSuit);

  // 主牌 > 副牌
  if (aMain && !bMain) return 1;
  if (!aMain && bMain) return -1;

  // 都是主牌或都是副牌，按权重比较
  const aPower = getCardPower(cardA, mainSuit);
  const bPower = getCardPower(cardB, mainSuit);
  return aPower - bPower;
}

/** 花色固定展示次序：王 → 黑桃 → 红桃 → 梅花 → 方块。 */
const SUIT_ORDER: Record<Suit, number> = {
  joker: 0,
  spade: 1,
  heart: 2,
  club: 3,
  diamond: 4,
};

/** 按牌力从大到小排序，不按花色分组。 */
export function sortHandByPower(hand: Card[], mainSuit: Suit | null): Card[] {
  return [...hand].sort((a, b) => comparePowerThenSuit(a, b, mainSuit));
}

/**
 * 同牌力时的兜底次序：先按花色，再按 id。
 *
 * 必须有这层兜底，否则：
 * 1) 四门的副7牌力都是 600、副2都是 400，不同花色会乱插到一起；
 * 2) 多副牌里同点同花色的牌完全等价，Array.sort 在不同输入顺序下
 *    可能给出不同结果，手牌每次刷新就会跳动、堆叠分组也会被拆散。
 */
function comparePowerThenSuit(a: Card, b: Card, mainSuit: Suit | null): number {
  const byPower = getCardPower(b, mainSuit) - getCardPower(a, mainSuit);
  if (byPower !== 0) return byPower;
  const bySuit = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  if (bySuit !== 0) return bySuit;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 手牌整理（发完牌即用）：
 * 主牌整堆排最前，副牌按花色分堆跟在后面，每堆内部牌力从大到小。
 *
 * 主牌堆内次序即牌力次序：天王 > 大王 > 小王 > 主7 > 副7 > 主2 > 副2 > 主花色其余牌。
 * 未定主（mainSuit=null）时王、7、2 仍算主牌，先集中在前面，定主后会自动重排。
 */
export function sortHand(hand: Card[], mainSuit: Suit | null): Card[] {
  return [...hand].sort((a, b) => {
    const aMain = isMainCard(a, mainSuit);
    const bMain = isMainCard(b, mainSuit);
    if (aMain !== bMain) return aMain ? -1 : 1;
    // 副牌先按花色分堆，堆内再按牌力；主牌不分堆，直接按牌力
    if (!aMain && a.suit !== b.suit) {
      return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    }
    return comparePowerThenSuit(a, b, mainSuit);
  });
}

/** 获取分数牌分值（5=5分, 10=10分, K=10分） */
export function getCardScore(card: Card): number {
  return SCORE_CARDS[card.rank] ?? 0;
}

/** 获取花色显示名称 */
export function getSuitName(suit: Suit): string {
  const names: Record<Suit, string> = {
    spade: '黑桃',
    heart: '红桃',
    diamond: '方块',
    club: '梅花',
    joker: '王',
  };
  return names[suit];
}

/** 获取点数显示文本 */
export function getRankLabel(rank: Rank): string {
  if (rank === 'small_joker') return '小王';
  if (rank === 'big_joker') return '大王';
  return rank;
}

/** 获取花色符号 */
export function getSuitSymbol(suit: Suit): string {
  const symbols: Record<Suit, string> = {
    spade: '♠',
    heart: '♥',
    diamond: '♦',
    club: '♣',
    joker: '★',
  };
  return symbols[suit];
}

/** 判断是否红色花色（红桃、方块、大王） */
export function isRedCard(card: Card): boolean {
  if (card.suit === 'heart') return true;
  if (card.suit === 'diamond') return true;
  if (card.suit === 'joker' && card.rank === 'big_joker') return true;
  return false;
}

// describePattern 已删除，改用 utils/pattern.ts 的 describeSelection。
// 删掉而不是留着不用：它不收 mainSuit，判不出「主副不能混组」——
// 主♠时 ♦6♦6+♦7♦7 会被它标成「拖拉机」，但服务端 identifyCardType 会拒绝
// （♦7是常主、♦6是副牌）。留在这里迟早有人再 import 它。

/** 生成一副完整牌 */
export function generateDeck(deckCount: number = 2): Card[] {
  const suits: Suit[] = ['spade', 'heart', 'diamond', 'club'];
  const ranks: Rank[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const cards: Card[] = [];

  for (let d = 0; d < deckCount; d++) {
    // 每副加大小王
    cards.push({ suit: 'joker', rank: 'small_joker', id: `joker-s-${d}` });
    cards.push({ suit: 'joker', rank: 'big_joker', id: `joker-b-${d}` });

    for (const suit of suits) {
      for (const rank of ranks) {
        cards.push({ suit, rank, id: `${suit}-${rank}-${d}` });
      }
    }
  }

  return cards;
}
