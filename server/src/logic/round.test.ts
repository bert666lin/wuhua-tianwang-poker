import test from 'node:test';
import assert from 'node:assert/strict';
import { CardData, Rank, Suit } from './config.js';
import { createPlayRound, submitRoundPlay } from './round.js';

let id = 0;
const card = (suit: number, rank: number): CardData => ({ id: `round-${id++}`, suit, rank });
const copies = (count: number, suit: number, rank: number): CardData[] =>
  Array.from({ length: count }, () => card(suit, rank));

test('四家必须各跟相同张数，不存在过牌', () => {
  const leadHand = copies(3, Suit.Club, Rank.Four);
  let result = submitRoundPlay(createPlayRound(4, 0), 0, leadHand, Suit.Heart, leadHand);

  const bankerHand = [
    ...copies(2, Suit.Heart, Rank.Three),
    card(Suit.BigJoker, Rank.BigJoker),
  ];
  result = submitRoundPlay(result.state, 1, bankerHand, Suit.Heart, bankerHand);
  const thirdHand = copies(3, Suit.Spade, Rank.Five);
  result = submitRoundPlay(result.state, 2, thirdHand, Suit.Heart, thirdHand);
  const fourthHand = copies(3, Suit.Diamond, Rank.Six);
  result = submitRoundPlay(result.state, 3, fourthHand, Suit.Heart, fourthHand);

  assert.equal(result.state.resolved, true);
  assert.equal(result.state.plays.length, 4);
  assert.equal(result.roundWinnerSeat, 0);
});

test('两天王加大王必须实际跟出，但对子加单张赢不了三张4', () => {
  const tripleFours = copies(3, Suit.Club, Rank.Four);
  let result = submitRoundPlay(createPlayRound(2, 0), 0, tripleFours, Suit.Heart, tripleFours);
  const bankerCards = [
    ...copies(2, Suit.Heart, Rank.Three),
    card(Suit.BigJoker, Rank.BigJoker),
  ];
  result = submitRoundPlay(result.state, 1, bankerCards, Suit.Heart, bankerCards);

  assert.equal(result.state.resolved, true);
  assert.equal(result.state.plays[1].cards.length, 3);
  assert.equal(result.roundWinnerSeat, 0);
});

test('有首家花色必须跟该花色', () => {
  const lead = [card(Suit.Club, Rank.Four)];
  let result = submitRoundPlay(createPlayRound(2, 0), 0, lead, Suit.Heart, lead);
  const clubFive = card(Suit.Club, Rank.Five);
  const spadeAce = card(Suit.Spade, Rank.Ace);
  const hand = [clubFive, spadeAce];

  assert.throws(
    () => submitRoundPlay(result.state, 1, [spadeAce], Suit.Heart, hand),
    /must follow lead category/,
  );
  result = submitRoundPlay(result.state, 1, [clubFive], Suit.Heart, hand);
  assert.equal(result.roundWinnerSeat, 1);
});

test('首家出三张时，跟牌不强制跟三张，但三张能赢墩', () => {
  const lead = copies(3, Suit.Club, Rank.Four);
  const tripleFives = copies(3, Suit.Club, Rank.Five);
  const clubPair = copies(2, Suit.Club, Rank.Six);
  const hand = [...tripleFives, ...clubPair, card(Suit.Club, Rank.Eight)];
  const state = submitRoundPlay(createPlayRound(2, 0), 0, lead, Suit.Heart, lead).state;

  // 跟对子+单张是合法的（同花色、同张数），但赢不了三张
  const followResult = submitRoundPlay(
    state,
    1,
    [...clubPair, card(Suit.Club, Rank.Eight)],
    Suit.Heart,
    hand,
  );
  assert.equal(followResult.roundWinnerSeat, 0);

  const result = submitRoundPlay(state, 1, tripleFives, Suit.Heart, hand);
  assert.equal(result.roundWinnerSeat, 1);
});

test('四家都跟完后，胜者收取本墩全部分牌', () => {
  const hands = [
    copies(3, Suit.Club, Rank.Ten),
    copies(3, Suit.Club, Rank.Nine),
    copies(3, Suit.Club, Rank.Eight),
    copies(3, Suit.Club, Rank.Five),
  ];
  let result = submitRoundPlay(createPlayRound(4, 0), 0, hands[0], Suit.Heart, hands[0]);
  result = submitRoundPlay(result.state, 1, hands[1], Suit.Heart, hands[1]);
  result = submitRoundPlay(result.state, 2, hands[2], Suit.Heart, hands[2]);
  result = submitRoundPlay(result.state, 3, hands[3], Suit.Heart, hands[3]);

  assert.equal(result.roundWinnerSeat, 0);
  assert.equal(result.capturedScore, 45);
});

test('先出完手牌不终止本墩：后座位仍须跟出，双天王可赢下最后一墩', () => {
  // 主花色红桃。最后一墩：闲家A(座0)先出一对4后手牌为空，
  // 庄家(座1)一对6，闲家B(座2)一对天王（红桃3）。
  const mainSuit = Suit.Heart;
  const finisherHand = copies(2, Suit.Club, Rank.Four);
  let result = submitRoundPlay(createPlayRound(3, 0), 0, finisherHand, mainSuit, finisherHand);

  // 座0已出完，但本墩没有结束，轮次必须交给座1。
  assert.equal(result.state.resolved, false);
  assert.equal(result.state.currentTurn, 1);

  const bankerHand = copies(2, Suit.Club, Rank.Six);
  result = submitRoundPlay(result.state, 1, bankerHand, mainSuit, bankerHand);
  assert.equal(result.state.currentTurn, 2);

  const tianWangPair = copies(2, Suit.Heart, Rank.Three);
  result = submitRoundPlay(result.state, 2, tianWangPair, mainSuit, tianWangPair);

  // 双天王杀掉副牌对子，闲家B赢下最后一墩。
  assert.equal(result.state.resolved, true);
  assert.equal(result.roundWinnerSeat, 2);
  assert.equal(result.state.currentWinningCards.length, 2);
  assert.ok(result.state.currentWinningCards.every(c => c.suit === Suit.Heart && c.rank === Rank.Three));
});

test('先出完手牌不终止本墩：庄家仍能用大王赢下最后一墩', () => {
  const mainSuit = Suit.Spade;
  const finisherHand = [card(Suit.Club, Rank.Nine)];
  let result = submitRoundPlay(createPlayRound(3, 0), 0, finisherHand, mainSuit, finisherHand);
  assert.equal(result.state.resolved, false);

  const secondHand = [card(Suit.Club, Rank.Ten)];
  result = submitRoundPlay(result.state, 1, secondHand, mainSuit, secondHand);

  const bankerHand = [card(Suit.BigJoker, Rank.BigJoker)];
  result = submitRoundPlay(result.state, 2, bankerHand, mainSuit, bankerHand);

  assert.equal(result.state.resolved, true);
  assert.equal(result.roundWinnerSeat, 2);
});

// ===== 甩牌墩：同门任意多张，不构成标准牌型 =====

test('甩牌领出：同门任意多张不再被判非法牌型', () => {
  // ♠A + ♠K 同门不成对，identifyCardType 为 null，必须靠 tossLead 放行
  const toss = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.King)];
  const leaderHand = [...toss, card(Suit.Spade, Rank.Four)];

  // 不带 tossLead 时按标准牌型校验，应当被拒
  assert.throws(
    () => submitRoundPlay(createPlayRound(2, 0), 0, toss, Suit.Heart, leaderHand),
    /invalid lead pattern/,
  );

  const result = submitRoundPlay(
    createPlayRound(2, 0), 0, toss, Suit.Heart, leaderHand, { tossLead: true },
  );
  assert.equal(result.state.leadIsToss, true);
  assert.equal(result.state.currentWinnerSeat, 0);
});

test('甩牌墩：同门跟牌永远压不过甩牌', () => {
  const toss = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.King)];
  const leaderHand = [...toss, card(Suit.Spade, Rank.Four)];
  let result = submitRoundPlay(
    createPlayRound(2, 0), 0, toss, Suit.Heart, leaderHand, { tossLead: true },
  );

  const followHand = [card(Suit.Spade, Rank.Five), card(Suit.Spade, Rank.Six)];
  result = submitRoundPlay(result.state, 1, followHand, Suit.Heart, followHand);
  assert.equal(result.state.resolved, true);
  assert.equal(result.roundWinnerSeat, 0);
});

test('甩牌墩：副牌甩牌可被缺门玩家用整手主牌杀掉', () => {
  const toss = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.King)];
  const leaderHand = [...toss, card(Suit.Spade, Rank.Four)];
  let result = submitRoundPlay(
    createPlayRound(3, 0), 0, toss, Suit.Heart, leaderHand, { tossLead: true },
  );

  // 座位1缺黑桃，用两张主牌（红桃为主）主杀
  const killerHand = [card(Suit.Heart, Rank.Four), card(Suit.Heart, Rank.Five)];
  result = submitRoundPlay(result.state, 1, killerHand, Suit.Heart, killerHand);
  assert.equal(result.state.currentWinnerSeat, 1);

  // 座位2也缺黑桃，但主牌更大，可以再压过去
  const biggerHand = [card(Suit.Heart, Rank.Ace), card(Suit.Heart, Rank.King)];
  result = submitRoundPlay(result.state, 2, biggerHand, Suit.Heart, biggerHand);
  assert.equal(result.roundWinnerSeat, 2);
});

test('甩牌墩：主牌甩牌无人可压', () => {
  // 天王（主花色3）+ 大王
  const toss = [card(Suit.Heart, Rank.Three), card(Suit.BigJoker, Rank.BigJoker)];
  const leaderHand = [...toss, card(Suit.Spade, Rank.Four)];
  let result = submitRoundPlay(
    createPlayRound(2, 0), 0, toss, Suit.Heart, leaderHand, { tossLead: true },
  );
  const followHand = [card(Suit.Heart, Rank.Ace), card(Suit.Heart, Rank.King)];
  result = submitRoundPlay(result.state, 1, followHand, Suit.Heart, followHand);
  assert.equal(result.roundWinnerSeat, 0);
});

test('甩牌墩：跟牌仍须跟足该门张数', () => {
  const toss = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.King)];
  const leaderHand = [...toss, card(Suit.Spade, Rank.Four)];
  const result = submitRoundPlay(
    createPlayRound(2, 0), 0, toss, Suit.Heart, leaderHand, { tossLead: true },
  );
  const spadeFive = card(Suit.Spade, Rank.Five);
  const clubNine = card(Suit.Club, Rank.Nine);
  const hand = [spadeFive, card(Suit.Spade, Rank.Six), clubNine];
  // 有两张黑桃却只跟一张，藏牌垫杂牌＝违规
  assert.throws(
    () => submitRoundPlay(result.state, 1, [spadeFive, clubNine], Suit.Heart, hand),
    /must follow lead category/,
  );
});

test('甩牌失败收回后本墩按单张正常进行', () => {
  // 失败时 resolveToss 只交出最小那一张，此时不应带 tossLead
  const forced = [card(Suit.Spade, Rank.Queen)];
  const leaderHand = [card(Suit.Spade, Rank.King), ...forced];
  let result = submitRoundPlay(
    createPlayRound(2, 0), 0, forced, Suit.Heart, leaderHand, { tossLead: false },
  );
  assert.equal(result.state.leadIsToss, false);
  // 对手用更大的同花色单张可以正常压过
  const spadeAce = [card(Suit.Spade, Rank.Ace)];
  result = submitRoundPlay(result.state, 1, spadeAce, Suit.Heart, spadeAce);
  assert.equal(result.roundWinnerSeat, 1);
});

test('甩牌放行不会被滥用：普通出牌路径仍严格校验首家牌型', () => {
  // ♠A + ♣K 跨门杂牌，既不是对子也不是甩牌
  const junk = [card(Suit.Spade, Rank.Ace), card(Suit.Club, Rank.King)];
  assert.throws(
    () => submitRoundPlay(createPlayRound(2, 0), 0, junk, Suit.Heart, junk),
    /invalid lead pattern/,
  );
  assert.throws(
    () => submitRoundPlay(createPlayRound(2, 0), 0, junk, Suit.Heart, junk, { tossLead: false }),
    /invalid lead pattern/,
  );
});

test('甩牌标记只对2张以上生效，单张不会被误标为甩牌', () => {
  const one = [card(Suit.Spade, Rank.Ace)];
  const result = submitRoundPlay(
    createPlayRound(2, 0), 0, one, Suit.Heart, one, { tossLead: true },
  );
  assert.equal(result.state.leadIsToss, false);
});

test('跟家无法用甩牌标记绕过跟牌义务', () => {
  const lead = [card(Suit.Spade, Rank.Four)];
  const state = submitRoundPlay(createPlayRound(2, 0), 0, lead, Suit.Heart, lead).state;
  const spadeFive = card(Suit.Spade, Rank.Five);
  const clubNine = card(Suit.Club, Rank.Nine);
  const hand = [spadeFive, clubNine];
  assert.throws(
    () => submitRoundPlay(state, 1, [clubNine], Suit.Heart, hand, { tossLead: true }),
    /must follow lead category/,
  );
});

// ===== 组合牌型的完整对局路径（确定性覆盖） =====
// 连三张要求同花色同点数各 3 张，随机压测只有 0.1%~2.3% 的手牌能凑出，
// 靠随机碰不稳定，所以在这里用固定牌局把「领出 → 跟牌 → 比较」走完整一遍。

test('连三张能领出，且被更大的同花色连三张压过', () => {
  const mainSuit = Suit.Heart;
  // 首家：♦444+♦555（副牌连三张）
  const lead = [...copies(3, Suit.Diamond, Rank.Four), ...copies(3, Suit.Diamond, Rank.Five)];
  let result = submitRoundPlay(createPlayRound(4, 0), 0, lead, mainSuit, lead);
  assert.equal(result.state.leadIsToss, false);
  assert.equal(result.state.currentWinnerSeat, 0);

  // 座位1：♦888+♦999 更大，应该接管本墩
  const bigger = [...copies(3, Suit.Diamond, Rank.Eight), ...copies(3, Suit.Diamond, Rank.Nine)];
  result = submitRoundPlay(result.state, 1, bigger, mainSuit, bigger);
  assert.equal(result.state.currentWinnerSeat, 1);

  // 座位2：♦333+♦444 更小，压不过
  const smaller = [...copies(3, Suit.Diamond, Rank.Three), ...copies(3, Suit.Diamond, Rank.Four)];
  result = submitRoundPlay(result.state, 2, smaller, mainSuit, smaller);
  assert.equal(result.state.currentWinnerSeat, 1);

  // 座位3：完全缺♦，垫6张梅花
  const noDiamond = [
    ...copies(3, Suit.Club, Rank.Six), ...copies(3, Suit.Club, Rank.Eight),
  ];
  result = submitRoundPlay(result.state, 3, noDiamond, mainSuit, noDiamond);
  assert.equal(result.roundWinnerSeat, 1);
});

test('主牌连三张能杀掉副牌连三张', () => {
  const mainSuit = Suit.Heart;
  const lead = [...copies(3, Suit.Diamond, Rank.Four), ...copies(3, Suit.Diamond, Rank.Five)];
  let result = submitRoundPlay(createPlayRound(2, 0), 0, lead, mainSuit, lead);
  // 座位1 完全缺♦，用主♥444+♥555 杀牌
  const mainRun = [...copies(3, Suit.Heart, Rank.Four), ...copies(3, Suit.Heart, Rank.Five)];
  result = submitRoundPlay(result.state, 1, mainRun, mainSuit, mainRun);
  assert.equal(result.roundWinnerSeat, 1);
});

test('王组合能压同张数的连对，普通连对压不回去', () => {
  const mainSuit = Suit.Spade;
  // 首家主花色连对 ♠99+♠TT
  const lead = [...copies(2, Suit.Spade, Rank.Nine), ...copies(2, Suit.Spade, Rank.Ten)];
  let result = submitRoundPlay(createPlayRound(2, 0), 0, lead, mainSuit, lead);
  // 座位1 用 大王对+小王对 杀
  const jokers = [
    ...copies(2, Suit.BigJoker, Rank.BigJoker),
    ...copies(2, Suit.SmallJoker, Rank.SmallJoker),
  ];
  result = submitRoundPlay(result.state, 1, jokers, mainSuit, jokers);
  assert.equal(result.roundWinnerSeat, 1);
});

test('主副混组不是合法牌型，不能作为首家领出', () => {
  // 主=♠ 时 ♦7 是常主（主牌），♦6 是副牌，两者不能成组
  const mixed = [
    ...copies(2, Suit.Diamond, Rank.Six),
    ...copies(2, Suit.Diamond, Rank.Seven),
  ];
  assert.throws(
    () => submitRoundPlay(createPlayRound(4, 0), 0, mixed, Suit.Spade, mixed),
    /invalid lead pattern/,
  );
  // 主=♦ 时整手都是主牌，同样的牌就合法了
  const ok = submitRoundPlay(createPlayRound(4, 0), 0, mixed, Suit.Diamond, mixed);
  assert.equal(ok.state.currentWinnerSeat, 0);
});

/**
 * 甩牌资格是「本墩领出者」，不是「整局第一个出牌的人」。
 *
 * 用户原话：「甩牌是先出牌的都可以用，不只是首家可以用」。
 * 实测代码行为本来就是对的（isLeader 取自 plays.length === 0，按墩重置），
 * 误解来自提示文案里的「首家」二字 —— 玩家理解成了开局第一个人。
 * 文案已改成「本墩先出牌的人」，这里把行为锁死，防止以后有人真的把它
 * 改成「只有整局首家能甩」。
 */
test('第二墩及以后，本墩领出者依然可以甩牌', () => {
  // 第 1 墩：座位 0 领出，座位 2 用 ♠9 拿下
  let round = createPlayRound(4, 0);
  const firstTrick: Record<number, CardData[]> = {
    0: [card(Suit.Spade, Rank.Five)],
    1: [card(Suit.Spade, Rank.Six)],
    2: [card(Suit.Spade, Rank.Nine)],
    3: [card(Suit.Spade, Rank.Four)],
  };
  let winner: number | null = null;
  for (const seat of [0, 1, 2, 3]) {
    const result = submitRoundPlay(round, seat, firstTrick[seat], Suit.Heart, firstTrick[seat]);
    round = result.state;
    if (result.roundWinnerSeat !== null) winner = result.roundWinnerSeat;
  }
  assert.equal(winner, 2, '♠9 应该拿下第一墩');

  // 第 2 墩由上墩赢家（座位 2）领出，此时他就是「本墩首家」，必须能甩
  const second = createPlayRound(4, winner!);
  assert.equal(second.plays.length, 0, '新墩的 plays 必须是空的，否则 isLeader 判定会失效');

  const toss = [card(Suit.Club, Rank.Ace), card(Suit.Club, Rank.King)];
  const hand = [...toss, card(Suit.Club, Rank.Four)];
  const result = submitRoundPlay(second, winner!, toss, Suit.Heart, hand, { tossLead: true });
  assert.equal(result.state.leadIsToss, true, '第二墩领出者的甩牌必须被当作甩牌受理');
  assert.equal(result.state.currentWinnerSeat, winner);
});

test('跟牌的人不能甩牌：张数与首家不符直接拒绝', () => {
  const lead = [card(Suit.Club, Rank.Ace)];
  const round = submitRoundPlay(createPlayRound(4, 0), 0, lead, Suit.Heart, lead).state;

  // 座位 1 想甩 2 张，但首家只出了 1 张
  const toss = [card(Suit.Club, Rank.King), card(Suit.Club, Rank.Queen)];
  assert.throws(
    () => submitRoundPlay(round, 1, toss, Suit.Heart, toss, { tossLead: true }),
    /must follow same count/,
    '跟家不能借 tossLead 绕过张数限制',
  );
});
