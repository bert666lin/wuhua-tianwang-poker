import { CardData, Rank, Suit } from './config.js';
import { isMainCard, isTianWang } from './compare.js';

/**
 * 挖底判定结果。
 *
 * 挖底分两层，不要混为一谈：
 *   1. **底牌分归属**（bottomTaken）：闲家赢下最后一墩就把底牌分算给闲家，
 *      用普通牌赢也算，不要求天王或大小王。
 *   2. **保底级数**（guaranteeLevel / success）：只有用天王或大小王赢下最后一墩
 *      才额外拿保底级（双天王4、单天王3、仅大小王1）。用普通牌赢没有保底级，
 *      闲家要靠总分（已含底牌分）达到叫分才算赢。
 */
export interface DigResult {
  /** 是否触发保底级数（闲家用天王或大小王赢下最后一墩）。 */
  success: boolean;
  /** 底牌分是否计入闲家：闲家赢下最后一墩即可，不论用什么牌赢。 */
  bottomTaken: boolean;
  tianWangCount: number;
  bigJokerCount: number;
  smallJokerCount: number;
  /** 挖底保底级数：双/三天王=4，一个天王=3，仅大小王=1，普通牌=0 */
  guaranteeLevel: number;
  /** 赢下最后一墩的是闲家 */
  opponentWonLastTrick: boolean;
}

export interface OpponentLevelInput {
  opponentScore: number;
  callScore: number;
  deckCount: 2 | 3;
  dig: DigResult;
}

export interface OpponentLevelResult {
  opponentWon: boolean;
  scoreLevel: number;
  digLevel: number;
  finalLevel: number;
}

export function getFullLevelScore(deckCount: 2 | 3): number {
  return deckCount === 2 ? 125 : 145;
}

function isJoker(card: CardData): boolean {
  return card.suit === Suit.BigJoker
    || card.suit === Suit.SmallJoker
    || card.rank === Rank.BigJoker
    || card.rank === Rank.SmallJoker;
}

/**
 * 判定挖底。
 * @param winnerSeat 最后一墩赢家座位
 * @param bankerSeat 庄家座位
 * @param winningCards 赢家赢下最后一墩的那手牌
 */
export function evaluateDig(
  winnerSeat: number,
  bankerSeat: number,
  winningCards: CardData[],
  mainSuit: number,
): DigResult {
  const opponentWonLastTrick = winnerSeat !== bankerSeat;
  if (!opponentWonLastTrick || winningCards.length === 0) {
    return {
      success: false,
      bottomTaken: false,
      tianWangCount: 0,
      bigJokerCount: 0,
      smallJokerCount: 0,
      guaranteeLevel: 0,
      opponentWonLastTrick,
    };
  }

  const tianWangCount = winningCards.filter(c => isTianWang(c, mainSuit)).length;
  const bigJokerCount = winningCards.filter(c => c.suit === Suit.BigJoker || c.rank === Rank.BigJoker).length;
  const smallJokerCount = winningCards.filter(c => c.suit === Suit.SmallJoker || c.rank === Rank.SmallJoker).length;
  const hasJoker = bigJokerCount + smallJokerCount > 0;

  let guaranteeLevel = 0;
  if (tianWangCount >= 2) guaranteeLevel = 4;
  else if (tianWangCount === 1) guaranteeLevel = 3;
  else if (hasJoker) guaranteeLevel = 1;

  return {
    // 保底级只看天王/大小王。
    success: guaranteeLevel > 0,
    // 底牌分只看「最后一墩是不是闲家赢的」，普通牌赢同样计入。
    bottomTaken: true,
    tianWangCount,
    bigJokerCount,
    smallJokerCount,
    guaranteeLevel,
    opponentWonLastTrick,
  };
}

/** 达到庄家叫分后每45分加一级，封顶4级。未达叫分返回0。 */
export function getScoreLevel(opponentScore: number, callScore: number, _deckCount?: 2 | 3): number {
  if (opponentScore < callScore) return 0;
  return Math.min(4, 1 + Math.max(0, Math.floor((opponentScore - callScore) / 45)));
}

/** 庄家赢的级数：闲家0分输4级，1~40分输2级，超过40分输1级。 */
export function getBankerWinLevel(opponentScore: number): number {
  if (opponentScore <= 0) return 4;
  if (opponentScore <= 40) return 2;
  return 1;
}

/**
 * 闲家胜负与级数：
 * - 拿到保底级（天王/大小王赢最后一墩）：保底级数与分数级取高，封顶4级；
 * - 没拿到保底级：仅按分数级判定，闲家总分（已含底牌分）达到叫分才赢。
 *
 * 注意 opponentScore 传进来时就应该已经把底牌分算好了（见 dig.bottomTaken），
 * 这个函数不负责加底牌分。
 */
export function calculateOpponentLevel(input: OpponentLevelInput): OpponentLevelResult {
  const scoreLevel = getScoreLevel(input.opponentScore, input.callScore, input.deckCount);
  const digLevel = input.dig.success ? input.dig.guaranteeLevel : 0;
  const opponentWon = scoreLevel > 0 || input.dig.success;
  const finalLevel = opponentWon
    ? Math.min(4, Math.max(scoreLevel, digLevel))
    : 0;

  return { opponentWon, scoreLevel, digLevel, finalLevel };
}

/**
 * 流局结算：主牌最多者视为庄家并默认输一级。
 * 并列最多时取座位顺序最靠前的一位作为庄家，保持整局零和。
 */
export function createFlowBreakDeltas(mainCounts: number[]): number[] {
  if (!Array.isArray(mainCounts) || mainCounts.length < 2) {
    throw new Error('mainCounts must contain at least 2 players');
  }
  if (mainCounts.some(count => !Number.isInteger(count) || count < 0)) {
    throw new Error('invalid main card count');
  }
  const bankerSeat = mainCounts.reduce(
    (best, count, seat) => (count > mainCounts[best] ? seat : best),
    0
  );
  return createLevelDeltas(mainCounts.length, bankerSeat, false, 1);
}

/** 零和级别结算：4人局闲家每人+N级，庄家-3N。 */
export function createLevelDeltas(
  playerCount: number,
  bankerSeat: number,
  bankerWon: boolean,
  level: number
): number[] {
  if (playerCount < 2) throw new Error('playerCount must be at least 2');
  if (bankerSeat < 0 || bankerSeat >= playerCount) throw new Error('invalid bankerSeat');
  if (!Number.isInteger(level) || level < 1) throw new Error('level must be a positive integer');

  const opponentDelta = bankerWon ? -level : level;
  const bankerDelta = -opponentDelta * (playerCount - 1);
  return Array.from({ length: playerCount }, (_, seat) =>
    seat === bankerSeat ? bankerDelta : opponentDelta
  );
}
