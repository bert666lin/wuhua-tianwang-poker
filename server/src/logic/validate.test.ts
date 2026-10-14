/**
 * 跟牌校验单测。
 *
 * checkFollow / isLeadCategory / getLeadCategoryCards 是所有出牌路径
 * （真人出牌、AI、超时托管、甩牌）共用的守门函数，之前零覆盖，这里补齐。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CardData, Rank, Suit } from './config.js';
import { checkFollow, getLeadCategoryCards, isLeadCategory } from './validate.js';

let seq = 0;
const card = (suit: number, rank: number): CardData => ({ id: `v-${seq++}`, suit, rank });
const copies = (count: number, suit: number, rank: number): CardData[] =>
  Array.from({ length: count }, () => card(suit, rank));

const MAIN = Suit.Heart;

test('isLeadCategory：首家出主牌时，只有主牌算同类别', () => {
  const leadMain = card(Suit.Heart, Rank.Ace);
  assert.equal(isLeadCategory(card(Suit.Heart, Rank.Four), leadMain, MAIN), true);
  // 常主：任意花色的 7 和 2 都是主牌
  assert.equal(isLeadCategory(card(Suit.Spade, Rank.Seven), leadMain, MAIN), true);
  assert.equal(isLeadCategory(card(Suit.Club, Rank.Two), leadMain, MAIN), true);
  assert.equal(isLeadCategory(card(Suit.BigJoker, Rank.BigJoker), leadMain, MAIN), true);
  // 天王＝主花色3
  assert.equal(isLeadCategory(card(Suit.Heart, Rank.Three), leadMain, MAIN), true);
  // 副牌不算
  assert.equal(isLeadCategory(card(Suit.Spade, Rank.Ace), leadMain, MAIN), false);
});

test('isLeadCategory：首家出副牌时，同花色且非主牌才算同类别', () => {
  const leadSide = card(Suit.Spade, Rank.Four);
  assert.equal(isLeadCategory(card(Suit.Spade, Rank.Ace), leadSide, MAIN), true);
  // 黑桃3不是主花色3，属普通副牌
  assert.equal(isLeadCategory(card(Suit.Spade, Rank.Three), leadSide, MAIN), true);
  // 黑桃7和黑桃2是常主，虽同花色但属主牌门
  assert.equal(isLeadCategory(card(Suit.Spade, Rank.Seven), leadSide, MAIN), false);
  assert.equal(isLeadCategory(card(Suit.Spade, Rank.Two), leadSide, MAIN), false);
  assert.equal(isLeadCategory(card(Suit.Club, Rank.Four), leadSide, MAIN), false);
});

test('checkFollow：张数不同一律不合法', () => {
  const lead = copies(2, Suit.Spade, Rank.Four);
  const hand = [card(Suit.Spade, Rank.Five), card(Suit.Spade, Rank.Six)];
  assert.equal(checkFollow(lead, hand.slice(0, 1), hand, MAIN), false);
  assert.equal(checkFollow(lead, hand, hand, MAIN), true);
});

test('checkFollow：空输入不合法', () => {
  const one = [card(Suit.Spade, Rank.Four)];
  assert.equal(checkFollow([], one, one, MAIN), false);
  assert.equal(checkFollow(one, [], one, MAIN), false);
  assert.equal(checkFollow(one, one, [], MAIN), false);
});

test('checkFollow：有首家花色却垫牌被拒，跟足才通过', () => {
  const lead = [card(Suit.Spade, Rank.Four)];
  const spadeFive = card(Suit.Spade, Rank.Five);
  const clubNine = card(Suit.Club, Rank.Nine);
  const hand = [spadeFive, clubNine];
  assert.equal(checkFollow(lead, [clubNine], hand, MAIN), false);
  assert.equal(checkFollow(lead, [spadeFive], hand, MAIN), true);
});

test('checkFollow：首家花色不足时必须先跟完，再用任意牌补齐张数', () => {
  const lead = copies(3, Suit.Spade, Rank.Four);
  const spadeFive = card(Suit.Spade, Rank.Five);
  const clubNine = card(Suit.Club, Rank.Nine);
  const clubTen = card(Suit.Club, Rank.Ten);
  const hand = [spadeFive, clubNine, clubTen];
  // 手里只有一张黑桃，必须带上它
  assert.equal(checkFollow(lead, [clubNine, clubTen, spadeFive], hand, MAIN), true);
  // 藏着黑桃不出＝违规
  assert.equal(checkFollow(lead, [clubNine, clubTen, clubNine], hand, MAIN), false);
});

test('checkFollow：完全缺门时可以随意垫牌或整手主杀', () => {
  const lead = copies(2, Suit.Spade, Rank.Four);
  const clubNine = card(Suit.Club, Rank.Nine);
  const clubTen = card(Suit.Club, Rank.Ten);
  const heartAce = card(Suit.Heart, Rank.Ace);
  const heartKing = card(Suit.Heart, Rank.King);
  const hand = [clubNine, clubTen, heartAce, heartKing];
  assert.equal(checkFollow(lead, [clubNine, clubTen], hand, MAIN), true);
  assert.equal(checkFollow(lead, [heartAce, heartKing], hand, MAIN), true);
});

test('checkFollow：首家出主牌时有主必须跟主，不能用副牌凑数', () => {
  const lead = [card(Suit.Heart, Rank.Ace)];
  const heartFour = card(Suit.Heart, Rank.Four);
  const spadeAce = card(Suit.Spade, Rank.Ace);
  const hand = [heartFour, spadeAce];
  assert.equal(checkFollow(lead, [spadeAce], hand, MAIN), false);
  assert.equal(checkFollow(lead, [heartFour], hand, MAIN), true);
});

test('checkFollow：常主也算主牌，首家出主时必须跟出', () => {
  const lead = [card(Suit.Heart, Rank.Four)];
  const spadeSeven = card(Suit.Spade, Rank.Seven);
  const clubNine = card(Suit.Club, Rank.Nine);
  const hand = [spadeSeven, clubNine];
  // 黑桃7是常主，属主牌门，必须跟出
  assert.equal(checkFollow(lead, [clubNine], hand, MAIN), false);
  assert.equal(checkFollow(lead, [spadeSeven], hand, MAIN), true);
});

test('checkFollow：不再校验首家牌型，甩牌领出后跟家能正常跟牌', () => {
  // 甩牌：♠A + ♠K，同门但不成对，identifyCardType 为 null。
  // 首家牌型合法性由 round.ts 负责，checkFollow 只管跟家跟得对不对。
  const toss = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.King)];
  const spadeFive = card(Suit.Spade, Rank.Five);
  const spadeSix = card(Suit.Spade, Rank.Six);
  const clubNine = card(Suit.Club, Rank.Nine);
  const hand = [spadeFive, spadeSix, clubNine];
  assert.equal(checkFollow(toss, [spadeFive, spadeSix], hand, MAIN), true);
  // 有两张黑桃却只跟一张＝违规
  assert.equal(checkFollow(toss, [spadeFive, clubNine], hand, MAIN), false);
});

test('getLeadCategoryCards：返回必须跟出的候选，首家为空时返回全部手牌', () => {
  const spadeFive = card(Suit.Spade, Rank.Five);
  const clubNine = card(Suit.Club, Rank.Nine);
  const hand = [spadeFive, clubNine];
  assert.equal(getLeadCategoryCards([], hand, MAIN).length, 2);
  const lead = [card(Suit.Spade, Rank.Four)];
  const candidates = getLeadCategoryCards(lead, hand, MAIN);
  assert.deepEqual(candidates.map(c => c.id), [spadeFive.id]);
});

test('getLeadCategoryCards：甩牌领出时同样能给出该门候选', () => {
  const toss = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.King)];
  const hand = [
    card(Suit.Spade, Rank.Five),
    card(Suit.Spade, Rank.Six),
    card(Suit.Club, Rank.Nine),
  ];
  assert.equal(getLeadCategoryCards(toss, hand, MAIN).length, 2);
});
