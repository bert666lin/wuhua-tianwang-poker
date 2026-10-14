import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_MODES, GAME_CONFIG, CardData, Rank, Suit } from './config.js';
import { dealCards } from './deck.js';
import { chooseAiDiscard, chooseAiPlay, type AiPlayContext } from './ai.js';
import { createPlayRound, submitRoundPlay, type PlayRoundState } from './round.js';
import { calcTrickScore } from './score.js';
import { calculateOpponentLevel, evaluateDig, createLevelDeltas } from './levels.js';

function runMode(modeId: keyof typeof GAME_MODES) {
  const mode = GAME_MODES[modeId];
  const { hands, bottom } = dealCards(mode);
  assert.equal(hands.length, mode.playerCount);
  hands.forEach((h, i) => assert.equal(h.length, mode.perPlayer, `seat ${i} has ${h.length}`));
  assert.equal(bottom.length, mode.bottomCount);

  let mainSuit = 255;
  for (const h of hands) { const s = h.find(c => c.rank === Rank.Seven)?.suit; if (s !== undefined) { mainSuit = s; break; } }
  if (mainSuit === 255) mainSuit = bottom[5]?.suit <= 3 ? bottom[5].suit : 0;
  const bankerSeat = 0;
  let bankerHand = [...hands[bankerSeat], ...bottom];
  const discarded = chooseAiDiscard(bankerHand, mode.discardCount, mainSuit);
  const ids = new Set(discarded.map(c => c.id));
  hands[bankerSeat] = bankerHand.filter(c => !ids.has(c.id));
  const bottomCards = discarded;

  const trickScores = new Array(mode.playerCount).fill(0);
  let round: PlayRoundState = createPlayRound(mode.playerCount, bankerSeat);
  let guard = 0;
  while (guard++ < 600) {
    const seat = round.currentTurn;
    const hand = hands[seat];
    const lead = round.plays[0]?.cards ?? [];
    const isAlly = (s: number) => (s === bankerSeat) === (seat === bankerSeat);
    const leaderSeat = round.plays[0]?.seat ?? seat;
    const winnerSeat = round.currentWinnerSeat ?? leaderSeat;
    const ctx: AiPlayContext = { isBanker: seat===bankerSeat, leaderIsAlly: isAlly(leaderSeat),
      currentWinningCards: [...round.currentWinningCards], winnerIsAlly: winnerSeat!==seat && isAlly(winnerSeat),
      isLastToPlay: round.plays.length === mode.playerCount - 1 };
    const action = chooseAiPlay(hand, lead, mainSuit, ctx);
    const res = submitRoundPlay(round, seat, action.cards, mainSuit, hand);
    const played = new Set(action.cards.map(c=>c.id));
    hands[seat] = hand.filter(c=>!played.has(c.id));
    round = res.state;
    if (res.state.resolved && res.roundWinnerSeat !== null) {
      trickScores[res.roundWinnerSeat] += res.capturedScore;
      if (hands.every(h => h.length === 0)) {
        const winningCards = [...res.state.currentWinningCards];
        const dig = evaluateDig(res.roundWinnerSeat, bankerSeat, winningCards, mainSuit);
        let opp = trickScores.reduce((s,v,i)=> i===bankerSeat?s:s+v,0);
        if (dig.success) opp += calcTrickScore(bottomCards);
        const level = calculateOpponentLevel({ opponentScore: opp, callScore: 105, deckCount: mode.deckCount as 2|3, dig });
        assert.ok(level.finalLevel >= 0 && level.finalLevel <= 4);
        assert.doesNotThrow(() => createLevelDeltas(mode.playerCount, bankerSeat, !level.opponentWon, Math.max(1, level.finalLevel)));
        return { dig, opp, level: level.finalLevel };
      }
      round = createPlayRound(mode.playerCount, res.roundWinnerSeat);
    }
  }
  throw new Error(`${modeId} did not finish`);
}

test('3人两副牌完整对局闭环', () => { runMode('threePlayerTwoDecks'); });
test('3人三副牌完整对局闭环', () => { runMode('threePlayerThreeDecks'); });
test('4人两副牌完整对局闭环', () => { runMode('fourPlayerTwoDecks'); });
test('4人三副牌完整对局闭环', () => { runMode('fourPlayerThreeDecks'); });
test('5人三副牌完整对局闭环', () => { runMode('fivePlayerThreeDecks'); });
test('6人三副牌完整对局闭环', () => { runMode('sixPlayerThreeDecks'); });
