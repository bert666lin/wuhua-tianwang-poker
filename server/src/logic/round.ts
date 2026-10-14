import { CardData, CardType } from './config.js';
import { comparePattern, getCardRank, identifyCardType, isMainCard } from './compare.js';
import { calcTrickScore } from './score.js';
import { checkFollow } from './validate.js';

export interface RoundPlay {
  seat: number;
  cards: CardData[];
}

export interface PlayRoundState {
  playerCount: number;
  leaderSeat: number;
  currentTurn: number;
  currentWinnerSeat: number | null;
  currentWinningCards: CardData[];
  plays: RoundPlay[];
  resolved: boolean;
  /** 本墩首家是否为甩牌（同门任意多张，不构成标准牌型）。 */
  leadIsToss: boolean;
}

export interface SubmitPlayOptions {
  /**
   * 本手是首家甩牌。甩牌形态（同门任意多张、可以不成对）不属于标准牌型，
   * 资格已由 logic/toss.ts 的 validateToss/resolveToss 校验过，
   * 所以这里必须显式放行，否则会被当成非法牌型拒绝。
   */
  tossLead?: boolean;
}

export interface RoundActionResult {
  state: PlayRoundState;
  roundWinnerSeat: number | null;
  capturedScore: number;
}

export function createPlayRound(playerCount: number, leaderSeat: number): PlayRoundState {
  if (playerCount < 2) throw new Error('playerCount must be at least 2');
  if (leaderSeat < 0 || leaderSeat >= playerCount) throw new Error('invalid leaderSeat');
  return {
    playerCount,
    leaderSeat,
    currentTurn: leaderSeat,
    currentWinnerSeat: null,
    currentWinningCards: [],
    plays: [],
    resolved: false,
    leadIsToss: false,
  };
}

function cloneState(state: PlayRoundState): PlayRoundState {
  return {
    ...state,
    currentWinningCards: [...state.currentWinningCards],
    plays: state.plays.map(play => ({ seat: play.seat, cards: [...play.cards] })),
  };
}

function assertTurn(state: PlayRoundState, seat: number): void {
  if (state.resolved) throw new Error('round already resolved');
  if (state.currentTurn !== seat) throw new Error('not current turn');
  if (state.plays.some(play => play.seat === seat)) throw new Error('player already followed');
}

function followsLeadCategory(card: CardData, leadCard: CardData, mainSuit: number): boolean {
  return isMainCard(leadCard, mainSuit)
    ? isMainCard(card, mainSuit)
    : !isMainCard(card, mainSuit) && card.suit === leadCard.suit;
}

/**
 * 只有与首家牌型相同的整套牌才有资格赢墩；副牌缺门时，同结构的整套主牌可以杀牌。
 * 跟出的散牌、对子+单张等仍是合法跟牌，但不能赢过首家的完整结构。
 */
function canCompeteWithLead(cards: CardData[], leadCards: CardData[], mainSuit: number): boolean {
  const leadType = identifyCardType(leadCards, mainSuit);
  const responseType = identifyCardType(cards, mainSuit);
  if (!leadType || !responseType || cards.length !== leadCards.length) return false;
  // 王组合可以跨牌型压连对/连三张（大小王本身就比任何主花色牌大），
  // 其余情况仍要求牌型完全一致。
  const jokerKill = responseType === CardType.JokerCombo
    && (leadType === CardType.Tractor || leadType === CardType.TripleRun);
  if (!jokerKill && responseType !== leadType) return false;

  const leadIsMain = leadCards.every(card => isMainCard(card, mainSuit));
  const responseIsMain = cards.every(card => isMainCard(card, mainSuit));
  if (leadIsMain) return responseIsMain;

  const followsLead = cards.every(card => followsLeadCategory(card, leadCards[0], mainSuit));
  return followsLead || responseIsMain;
}

/**
 * 甩牌墩的赢墩资格。
 *
 * 甩牌能成立的前提是「其他任何人手上该门都没有更大的牌」，
 * 所以同门跟牌永远压不过甩牌；只有副牌缺门的玩家用整手主牌才能杀掉。
 * 主牌甩牌则无人可压。
 */
function canCompeteWithToss(cards: CardData[], leadCards: CardData[], mainSuit: number): boolean {
  if (cards.length !== leadCards.length) return false;
  if (leadCards.every(card => isMainCard(card, mainSuit))) return false;
  return cards.every(card => isMainCard(card, mainSuit));
}

/** 甩牌墩里两手牌的比较口径：看最大的那一张。 */
function topPower(cards: CardData[], mainSuit: number): number {
  return Math.max(...cards.map(card => getCardRank(card, mainSuit)));
}

function beatsToss(
  challenger: CardData[],
  currentWinner: CardData[],
  leadCards: CardData[],
  mainSuit: number,
): boolean {
  if (!canCompeteWithToss(challenger, leadCards, mainSuit)) return false;
  const winnerMain = currentWinner.every(card => isMainCard(card, mainSuit));
  // 首家甩的是副牌，第一个用整手主牌杀牌的人直接接管本墩。
  if (!winnerMain) return true;
  // 已经有人主杀过，就按最大的一张比。
  return topPower(challenger, mainSuit) > topPower(currentWinner, mainSuit);
}

function beatsCurrentWinner(
  challenger: CardData[],
  currentWinner: CardData[],
  leadCards: CardData[],
  mainSuit: number,
  leadIsToss: boolean,
): boolean {
  if (leadIsToss) return beatsToss(challenger, currentWinner, leadCards, mainSuit);
  if (!canCompeteWithLead(challenger, leadCards, mainSuit)) return false;

  const challengerMain = challenger.every(card => isMainCard(card, mainSuit));
  const winnerMain = currentWinner.every(card => isMainCard(card, mainSuit));
  if (challengerMain !== winnerMain) return challengerMain;
  return comparePattern(challenger, currentWinner, mainSuit) > 0;
}

/** 一墩中每家必须实际出牌一次，后家必须与首家出相同张数并遵守跟牌义务。 */
export function submitRoundPlay(
  input: PlayRoundState,
  seat: number,
  cards: CardData[],
  mainSuit: number,
  playerHand: CardData[],
  options?: SubmitPlayOptions,
): RoundActionResult {
  assertTurn(input, seat);

  const state = cloneState(input);
  const leadCards = state.plays[0]?.cards;
  if (!leadCards) {
    const isToss = options?.tossLead === true && cards.length >= 2;
    if (!isToss && !identifyCardType(cards, mainSuit)) throw new Error('invalid lead pattern');
    state.leadIsToss = isToss;
    state.currentWinnerSeat = seat;
    state.currentWinningCards = [...cards];
  } else {
    if (cards.length !== leadCards.length) throw new Error('must follow same count');
    if (!checkFollow(leadCards, cards, playerHand, mainSuit)) {
      throw new Error('must follow lead category');
    }
    if (beatsCurrentWinner(cards, state.currentWinningCards, leadCards, mainSuit, state.leadIsToss)) {
      state.currentWinnerSeat = seat;
      state.currentWinningCards = [...cards];
    }
  }

  state.plays.push({ seat, cards: [...cards] });
  if (state.plays.length === state.playerCount) {
    state.resolved = true;
    const allCards = state.plays.flatMap(play => play.cards);
    return {
      state,
      roundWinnerSeat: state.currentWinnerSeat,
      capturedScore: calcTrickScore(allCards),
    };
  }

  state.currentTurn = (seat + 1) % state.playerCount;
  return { state, roundWinnerSeat: null, capturedScore: 0 };
}
