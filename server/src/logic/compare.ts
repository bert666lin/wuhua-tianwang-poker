/**
 * 核心牌力系统
 * 
 * 常主排序：主花色3(天王) > 大王 > 小王 > 主7 > 副7 > 主2 > 副2
 * 主花色牌：主花色的所有牌（除常主外，按A>K>...>4排序）
 * 副牌排序：A > K > Q > J > 10 > 9 > 8 > 6 > 5 > 4 > 普通3
 * 注意：天王随主花色变化，不再固定为方块3。
 */

import { CardData, Suit, Rank, CardType } from './config.js';

/**
 * 判断是否为天王（主花色3）
 */
export function isTianWang(card: CardData, mainSuit: number): boolean {
  return mainSuit >= Suit.Spade
    && mainSuit <= Suit.Club
    && card.suit === mainSuit
    && card.rank === Rank.Three;
}

/**
 * 判断是否为大王
 */
export function isBigJoker(card: CardData): boolean {
  return card.suit === Suit.BigJoker;
}

/**
 * 判断是否为小王
 */
export function isSmallJoker(card: CardData): boolean {
  return card.suit === Suit.SmallJoker;
}

/**
 * 判断是否为常主（天王/大小王/所有7/所有2）
 * 常主在任何花色下都是主牌
 */
export function isConstantMain(card: CardData, mainSuit: number): boolean {
  // 天王（主花色3）
  if (isTianWang(card, mainSuit)) return true;
  // 大小王
  if (isBigJoker(card) || isSmallJoker(card)) return true;
  // 所有7（4个花色的7都是常主）
  if (card.rank === Rank.Seven) return true;
  // 所有2（4个花色的2都是常主）
  if (card.rank === Rank.Two) return true;
  return false;
}

/**
 * 判断一张牌是否为主牌
 * 主牌 = 常主 + 主花色牌
 * 
 * @param card 牌数据
 * @param mainSuit 主花色 (0-3, 255=未定)
 */
export function isMainCard(card: CardData, mainSuit: number): boolean {
  // 常主始终是主牌
  if (isConstantMain(card, mainSuit)) return true;
  // 主花色未定时，只有常主是主牌
  if (mainSuit === 255 || mainSuit === undefined) return false;
  // 主花色的牌都是主牌（但天王、7、2已经是常主了，这里处理主花色的其他牌）
  // 注意：大王和小王没有花色，不在此列
  if (card.suit === mainSuit) return true;
  return false;
}

/**
 * 获取牌力排序值
 * 值越大牌力越大
 * 
 * 排序规则：
 * 1. 天王（主花色3）= 1000（全场最大）
 * 2. 大王 = 900
 * 3. 小王 = 800
 * 4. 主7（主花色的7）= 700
 * 5. 副7（非主花色的7）= 600
 * 6. 主2（主花色的2）= 500
 * 7. 副2（非主花色的2）= 400
 * 8. 主花色牌（A>K>...>4，不含常主）= 300+rank
 * 9. 副花色牌（A>K>...>3，不含天王/7/2）= 100+rank
 * 
 * 注意：只有主花色3是天王，其他花色3是普通副牌。
 */
export function getCardRank(card: CardData, mainSuit: number): number {
  // 天王（主花色3）- 全场最大
  if (isTianWang(card, mainSuit)) return 1000;
  
  // 大王
  if (isBigJoker(card)) return 900;
  
  // 小王
  if (isSmallJoker(card)) return 800;
  
  // 7：主7 > 副7
  if (card.rank === Rank.Seven) {
    if (card.suit === mainSuit) return 700;
    return 600;
  }
  
  // 2：主2 > 副2
  if (card.rank === Rank.Two) {
    if (card.suit === mainSuit) return 500;
    return 400;
  }
  
  // 主花色牌（不含7和2，它们已是常主）
  if (card.suit === mainSuit) {
    // 主花色的普通牌：A(14)>K(13)>...>4(4)
    // 主花色3是天王，已在上面处理
    return 300 + card.rank;
  }
  
  // 副花色牌：A(14)>K(13)>Q(12)>J(11)>10>9>8>6>5>4>3
  return 100 + card.rank;
}

/**
 * 比较两张牌的大小
 * 
 * @param cardA 牌A
 * @param cardB 牌B
 * @param mainSuit 主花色 (0-3, 255=未定)
 * @returns 1=A大, -1=B大, 0=相等
 */
export function compareCard(
  cardA: CardData,
  cardB: CardData,
  mainSuit: number
): number {
  const rankA = getCardRank(cardA, mainSuit);
  const rankB = getCardRank(cardB, mainSuit);
  
  if (rankA > rankB) return 1;
  if (rankA < rankB) return -1;
  
  // 同级别牌力（如同为副7，但不同花色），需要进一步区分
  // 对于副7，不同花色之间视为相等（实际游戏中同级别只需要比花色）
  // 但在天王扑克中，同为副7的不同花色7应该是等价的
  // 同理副2也是
  
  return 0;
}

/** 吃墩比较：主牌优先；都不是主牌时只有首家花色有资格赢墩。 */
export function compareTrickCard(
  challenger: CardData,
  currentWinner: CardData,
  leadCard: CardData,
  mainSuit: number
): number {
  const challengerMain = isMainCard(challenger, mainSuit);
  const winnerMain = isMainCard(currentWinner, mainSuit);
  if (challengerMain !== winnerMain) return challengerMain ? 1 : -1;
  if (challengerMain && winnerMain) return compareCard(challenger, currentWinner, mainSuit);

  const challengerFollowsLead = challenger.suit === leadCard.suit;
  const winnerFollowsLead = currentWinner.suit === leadCard.suit;
  if (challengerFollowsLead !== winnerFollowsLead) return challengerFollowsLead ? 1 : -1;
  if (!challengerFollowsLead) return -1;
  return compareCard(challenger, currentWinner, mainSuit);
}

/**
 * 对手牌进行排序（从大到小）
 */
export function sortCards(cards: CardData[], mainSuit: number): CardData[] {
  return [...cards].sort((a, b) => getCardRank(b, mainSuit) - getCardRank(a, mainSuit));
}

/**
 * 识别牌型。
 *
 * 需要 mainSuit：连对/连三张禁止主副混组，而一张牌是主还是副取决于主花色。
 * 例如 ♦6♦6+♦7♦7 在主=♠ 时非法（♦7 是常主），在主=♦ 时合法（整手都是主牌）。
 *
 * @returns 牌型类型，无法识别返回 null
 */
export function identifyCardType(cards: CardData[], mainSuit: number): CardType | null {
  if (cards.length === 0) return null;
  if (cards.length === 1) return CardType.Single;
  if (cards.length === 2) return cards.every(card => isSameFace(card, cards[0]))
    ? CardType.Pair
    : null;
  if (cards.length === 3 && cards.every(card => isSameFace(card, cards[0]))) {
    return CardType.Triple;
  }
  // 王组合要在连对/连三张之前判：大小王没有花色，走不通同花色连续那套判定。
  if (isJokerCombo(cards)) return CardType.JokerCombo;
  if (isTractor(cards, mainSuit)) return CardType.Tractor;
  if (isTripleRun(cards, mainSuit)) return CardType.TripleRun;
  return null;
}

/** 自然点数排序：2-3-4-...-A，A与2不首尾相连；仅用于拖拉机比较。 */
const NATURAL_RANKS = [
  Rank.Two,
  Rank.Three,
  Rank.Four,
  Rank.Five,
  Rank.Six,
  Rank.Seven,
  Rank.Eight,
  Rank.Nine,
  Rank.Ten,
  Rank.Jack,
  Rank.Queen,
  Rank.King,
  Rank.Ace,
] as const;

const naturalRankIndex = new Map<number, number>(NATURAL_RANKS.map((rank, index) => [rank, index]));

function nextTractorRank(rank: number): number | null {
  if (rank === Rank.Ace) return Rank.Two;
  if (rank === Rank.Two) return Rank.Three;
  if (rank >= Rank.Three && rank < Rank.Ace) return rank + 1;
  return null;
}

/**
 * 同花色「连续等量组」判定，连对与连三张共用。
 *
 * groupSize=2 -> 连对（33+44）；groupSize=3 -> 连三张（333+444）。
 * 规则：
 *   1. 全部同花色（大小王没有花色，被 suit > Club 挡掉，不能参与）；
 *   2. 每个点数恰好 groupSize 张，至少 2 组；
 *   3. 点数按自然顺序连续，允许 K-A-2-3 跨接；
 *   4. **主牌和副牌不能混在同一组合里**。
 *
 * 第 4 条是关键：7 和 2 是常主。副花色的 7、2 属于主牌，
 * 所以副花色连对不能含 7 或 2，也不能跨过它们接续：
 *   - 主=♠ 时 ♦6♦6+♦7♦7 不成立（♦7 是主牌，与副牌 ♦6 混组）
 *   - 主=♦ 时 ♦6♦6+♦7♦7 成立（整手都是主牌）
 *   - 主=♦ 时 ♦A♦A+♦2♦2、♦2♦2+♦3♦3 成立（整手都是主牌）
 *   - ♦6♦6+♦8♦8 **在任何主牌下都不成立**：跳过 7 就是点数不连续，
 *     这一条由第 3 条（连续性）挡掉，与主副归属无关。别把它写成
 *     "主=♦ 时就成立" —— 文档里犯过这个错，用户核对时抓出来的。
 * 主花色 3 是天王，但在组合里只按花色点数参与连续性和比较，
 * 单出/出对/出三张时才体现它的最大牌力。
 */
function isConsecutiveGroups(cards: CardData[], groupSize: number, mainSuit: number): boolean {
  if (cards.length < groupSize * 2 || cards.length % groupSize !== 0) return false;
  if (cards[0].suit > Suit.Club || cards.some(card => card.suit !== cards[0].suit)) return false;
  // 主副不能混组：同花色下只要主牌归属不一致就不成型。
  const firstIsMain = isMainCard(cards[0], mainSuit);
  if (cards.some(card => isMainCard(card, mainSuit) !== firstIsMain)) return false;

  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  if ([...counts.values()].some(count => count !== groupSize)) return false;

  const ranks = new Set(counts.keys());
  // 从任一点数起，看能否顺着接完全部组（覆盖 K-A-2-3 这种跨接顺序）
  for (const start of ranks) {
    let current: number | null = start;
    let matched = true;
    for (let index = 1; index < ranks.size; index++) {
      current = current === null ? null : nextTractorRank(current);
      if (current === null || !ranks.has(current)) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * 连对（拖拉机）：至少两组同花色、同主副归属的连续对子，允许 K-A-2-3 跨接。
 * 组数不限：33+44、33+44+55、33+44+55+66 都成立。
 * 大小王不能参与；主牌与副牌不能混组（见 isConsecutiveGroups）。
 */
export function isTractor(cards: CardData[], mainSuit: number): boolean {
  return isConsecutiveGroups(cards, 2, mainSuit);
}

/**
 * 连三张：至少两组同花色、同主副归属的连续三张，如 333+444、333+444+555+666。
 * 与连对同一套连续性和主副归属规则，只是每组 3 张。
 */
export function isTripleRun(cards: CardData[], mainSuit: number): boolean {
  return isConsecutiveGroups(cards, 3, mainSuit);
}

/**
 * 王组合：大王组 + 小王组，且两组张数相同。
 * 例：大王对+小王对（4张）、三大王+三小王（6张）。
 * 大小王没有花色，走不通同花色连续那套判定，所以单独成型。
 */
export function isJokerCombo(cards: CardData[]): boolean {
  if (cards.length < 4 || cards.length % 2 !== 0) return false;
  const big = cards.filter(card => card.suit === Suit.BigJoker).length;
  const small = cards.filter(card => card.suit === Suit.SmallJoker).length;
  // 必须全是王，且大小王各占一半
  if (big + small !== cards.length) return false;
  return big === small && big >= 2;
}

function patternSuit(cards: CardData[]): number | null {
  return cards.every(card => card.suit === cards[0].suit) ? cards[0].suit : null;
}

function naturalRankPower(rank: number): number {
  return naturalRankIndex.get(rank) ?? -1;
}

/** 把任意数值收敛成 1/-1/0，保证 comparePattern 的返回值契约。 */
function sign(value: number): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function compareRankSets(cardsA: CardData[], cardsB: CardData[]): number {
  const ranksA = [...new Set(cardsA.map(card => card.rank))]
    .sort((a, b) => naturalRankPower(b) - naturalRankPower(a));
  const ranksB = [...new Set(cardsB.map(card => card.rank))]
    .sort((a, b) => naturalRankPower(b) - naturalRankPower(a));
  for (let index = 0; index < Math.min(ranksA.length, ranksB.length); index++) {
    const difference = naturalRankPower(ranksA[index]) - naturalRankPower(ranksB[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * 同牌型压牌。返回1表示挑战牌更大，-1表示压不过，0表示完全相同（先出者大）。
 * 不同牌型或不同张数永远不能互压。
 */
export function comparePattern(
  challenger: CardData[],
  current: CardData[],
  mainSuit: number
): number {
  const challengerType = identifyCardType(challenger, mainSuit);
  const currentType = identifyCardType(current, mainSuit);
  if (!challengerType || !currentType || challenger.length !== current.length) return -1;

  // 王组合是唯一能跨牌型压制的组合：同张数下它压连对/连三张。
  // 这一段必须放在「牌型必须相同」之前，否则会被当成不同牌型直接判压不过。
  const challengerIsJoker = challengerType === CardType.JokerCombo;
  const currentIsJoker = currentType === CardType.JokerCombo;
  if (challengerIsJoker || currentIsJoker) {
    if (challengerIsJoker !== currentIsJoker) return challengerIsJoker ? 1 : -1;
    // 都是王组合：比最大的那张（大王 > 小王）
    return compareCard(
      sortCards(challenger, mainSuit)[0],
      sortCards(current, mainSuit)[0],
      mainSuit,
    );
  }

  if (challengerType !== currentType) return -1;

  if (challengerType === CardType.Single
    || challengerType === CardType.Pair
    || challengerType === CardType.Triple) {
    return compareCard(challenger[0], current[0], mainSuit);
  }

  const challengerSuit = patternSuit(challenger);
  const currentSuit = patternSuit(current);
  const challengerIsMainSuit = challengerSuit === mainSuit;
  const currentIsMainSuit = currentSuit === mainSuit;
  if (challengerIsMainSuit !== currentIsMainSuit) return challengerIsMainSuit ? 1 : -1;
  // 组合牌型按牌面点数比，不看常主牌力：天王(主3)在连对里也只算点数3。
  return sign(compareRankSets(challenger, current));
}

/**
 * 判断两张牌是否完全相同（花色+点数）
 * 注意：多副牌中可能有相同花色点数但不同id的牌
 */
export function isSameFace(cardA: CardData, cardB: CardData): boolean {
  return cardA.suit === cardB.suit && cardA.rank === cardB.rank;
}
