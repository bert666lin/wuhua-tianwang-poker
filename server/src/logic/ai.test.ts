import test from 'node:test';
import assert from 'node:assert/strict';
import { CardData, GAME_MODES, Rank, Suit } from './config.js';
import {
  chooseAiDiscard, chooseAiPlay, chooseAiSuit, chooseAiBid,
  enumerateHintPlays, evaluateHandStrength,
} from './ai.js';
import { dealCards } from './deck.js';

let id = 0;
const card = (suit: number, rank: number): CardData => ({ id: `ai-${id++}`, suit, rank });
const copies = (count: number, suit: number, rank: number): CardData[] =>
  Array.from({ length: count }, () => card(suit, rank));

test('AI只能用持有的对应花色7叫主，并偏向张数较多的花色', () => {
  const hand = [
    card(Suit.Spade, Rank.Seven),
    card(Suit.Heart, Rank.Seven),
    card(Suit.Heart, Rank.Four),
    card(Suit.Heart, Rank.Five),
  ];
  assert.equal(chooseAiSuit(hand), Suit.Heart);
  assert.equal(chooseAiSuit([card(Suit.Club, Rank.Four)]), 255);
});

test('AI用两天王加大王实际跟三张，不会过牌', () => {
  const hand = [
    ...copies(2, Suit.Heart, Rank.Three),
    card(Suit.BigJoker, Rank.BigJoker),
  ];
  const action = chooseAiPlay(hand, copies(3, Suit.Club, Rank.Four), Suit.Heart);
  assert.equal(action.type, 'play');
  assert.equal(action.cards.length, 3);
});

test('AI有首家花色对子时必须跟对子', () => {
  const hand = [
    ...copies(2, Suit.Club, Rank.Five),
    ...copies(2, Suit.Club, Rank.Six),
  ];
  const action = chooseAiPlay(hand, copies(2, Suit.Club, Rank.Four), Suit.Heart);
  assert.equal(action.type, 'play');
  assert.equal(action.cards[0].rank, Rank.Five);
});

test('AI首家花色不足时全部跟出，再用其他牌补足张数', () => {
  const clubFour = card(Suit.Club, Rank.Four);
  const hand = [
    clubFour,
    card(Suit.Spade, Rank.Five),
    card(Suit.Diamond, Rank.Six),
  ];
  const action = chooseAiPlay(hand, copies(3, Suit.Club, Rank.Nine), Suit.Heart);
  assert.equal(action.cards.length, 3);
  assert.equal(action.cards.some(item => item.id === clubFour.id), true);
});

test('AI扣底优先保留分牌和主牌', () => {
  const lowOffSuit = card(Suit.Spade, Rank.Four);
  const scoreCard = card(Suit.Spade, Rank.Ten);
  const mainCard = card(Suit.Heart, Rank.Four);
  const discarded = chooseAiDiscard([scoreCard, mainCard, lowOffSuit], 1, Suit.Heart);
  assert.equal(discarded[0].id, lowOffSuit.id);
});

function fullMemoryForConstants(deckCount: number): CardData[] {
  const cards: CardData[] = [];
  for (let suit = Suit.Spade; suit <= Suit.Club; suit++) {
    for (const rank of [Rank.Seven, Rank.Two]) {
      for (let i = 0; i < deckCount; i++) cards.push(card(suit, rank));
    }
  }
  for (const [suit, rank] of [[Suit.SmallJoker, Rank.SmallJoker], [Suit.BigJoker, Rank.BigJoker]]) {
    for (let i = 0; i < deckCount; i++) cards.push(card(suit, rank));
  }
  return cards;
}

test('AI记牌后只剩主牌时，用低一级boss开路而不是浪费A', () => {
  const hand = [
    card(Suit.Heart, Rank.Ace),
    card(Suit.Heart, Rank.King),
  ];
  const action = chooseAiPlay(hand, [], Suit.Heart, {
    playedCards: [
      ...fullMemoryForConstants(2),
      card(Suit.Heart, Rank.Ace),
      ...Array.from({ length: 2 }, () => card(Suit.Heart, Rank.Three)),
    ],
    deckCount: 2,
    isBanker: true,
    leaderIsAlly: true,
    currentWinningCards: [],
    winnerIsAlly: true,
    isLastToPlay: true,
  });
  assert.equal(action.cards[0].rank, Rank.King);
});

test('AI记牌后在无分非末位墩会保住boss', () => {
  const hand = [
    card(Suit.Club, Rank.King),
    card(Suit.Club, Rank.Three),
  ];
  const played = [
    card(Suit.Club, Rank.Ace),
    card(Suit.Club, Rank.Ace),
  ];
  const context = {
    playedCards: played,
    deckCount: 2,
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: [card(Suit.Club, Rank.Four)],
    winnerIsAlly: false,
    isLastToPlay: false,
  };
  const action = chooseAiPlay(hand, [card(Suit.Club, Rank.Four)], Suit.Heart, context);
  assert.equal(action.cards[0].rank, Rank.Three);
});

test('AI记牌后到末位或桌面有分时仍会用boss收墩', () => {
  const hand = [
    card(Suit.Club, Rank.King),
    card(Suit.Club, Rank.Three),
  ];
  const played = [
    card(Suit.Club, Rank.Ace),
    card(Suit.Club, Rank.Ace),
  ];
  const context = {
    playedCards: played,
    deckCount: 2,
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: [card(Suit.Club, Rank.Ten)],
    winnerIsAlly: false,
    isLastToPlay: true,
  };
  const action = chooseAiPlay(hand, [card(Suit.Club, Rank.Four)], Suit.Heart, context);
  assert.equal(action.cards[0].rank, Rank.King);
});

// ===== AI 应对甩牌墩（AI 自己不甩牌，但必须能正确跟别人的甩牌）=====

test('AI跟甩牌：同门牌够时跟足张数且不藏牌', () => {
  // 首家甩 ♠A ♠K（同门不成对）
  const toss = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.King)];
  const spadeFive = card(Suit.Spade, Rank.Five);
  const spadeSix = card(Suit.Spade, Rank.Six);
  const hand = [spadeFive, spadeSix, card(Suit.Club, Rank.Nine)];
  const action = chooseAiPlay(hand, toss, Suit.Heart, {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: toss,
    winnerIsAlly: false,
    isLastToPlay: false,
  });
  assert.equal(action.cards.length, 2);
  assert.equal(action.cards.every(c => c.suit === Suit.Spade), true);
});

test('AI跟甩牌：完全缺门且桌面有分时，用任意多张主牌主杀', () => {
  // 首家甩 ♠K ♠10（含分牌），AI 缺黑桃，手里主牌不成对也应能杀
  const toss = [card(Suit.Spade, Rank.King), card(Suit.Spade, Rank.Ten)];
  const hand = [
    card(Suit.Heart, Rank.Ace),
    card(Suit.Heart, Rank.Queen),
    card(Suit.Club, Rank.Four),
  ];
  const action = chooseAiPlay(hand, toss, Suit.Heart, {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: toss,
    winnerIsAlly: false,
    isLastToPlay: true,
  });
  assert.equal(action.cards.length, 2);
  // 两张都是主牌才构成主杀
  assert.equal(action.cards.every(c => c.suit === Suit.Heart), true);
});

test('AI跟甩牌：首家花色不足时先跟完再补齐张数', () => {
  const toss = [
    card(Suit.Spade, Rank.Ace),
    card(Suit.Spade, Rank.King),
    card(Suit.Spade, Rank.Queen),
  ];
  const spadeFour = card(Suit.Spade, Rank.Four);
  const hand = [spadeFour, card(Suit.Club, Rank.Five), card(Suit.Diamond, Rank.Six)];
  const action = chooseAiPlay(hand, toss, Suit.Heart, {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: toss,
    winnerIsAlly: false,
    isLastToPlay: false,
  });
  assert.equal(action.cards.length, 3);
  assert.equal(action.cards.some(c => c.id === spadeFour.id), true);
});


test('AI抢主必须满足张数门槛：只有1张7时抢不了需要2张的主', () => {
  const oneSeven = [
    card(Suit.Diamond, Rank.Seven),
    card(Suit.Diamond, Rank.Ace),
    card(Suit.Diamond, Rank.King),
  ];
  // 首家叫主(门槛1)：可以叫方块
  assert.equal(chooseAiSuit(oneSeven, 1), Suit.Diamond);
  // 已有人用1张7叫主，抢主门槛=2：手上只有1张方块7，放弃
  assert.equal(chooseAiSuit(oneSeven, 2), 255);

  // 手上有2张梅花7时，门槛2能抢梅花
  const twoSevens = [
    ...copies(2, Suit.Club, Rank.Seven),
    card(Suit.Diamond, Rank.Seven),
  ];
  assert.equal(chooseAiSuit(twoSevens, 2), Suit.Club);
  // 门槛3就抢不动了
  assert.equal(chooseAiSuit(twoSevens, 3), 255);
});

// ===== AI 智能度增强的回归锁定 =====

test('AI扣底会做缺门：能整门扣光的短门优先扣掉', () => {
  const mainSuit = Suit.Spade;
  const hand = [
    // ♦ 只有2张，是短门 -> 应该整门扣掉做缺门
    card(Suit.Diamond, Rank.Four), card(Suit.Diamond, Rank.Nine),
    // ♥ 和 ♣ 各6张，是长门
    card(Suit.Heart, Rank.Three), card(Suit.Heart, Rank.Four),
    card(Suit.Heart, Rank.Six), card(Suit.Heart, Rank.Eight),
    card(Suit.Heart, Rank.Nine), card(Suit.Heart, Rank.Jack),
    card(Suit.Club, Rank.Three), card(Suit.Club, Rank.Four),
    card(Suit.Club, Rank.Six), card(Suit.Club, Rank.Eight),
    card(Suit.Club, Rank.Nine), card(Suit.Club, Rank.Jack),
    // 主牌应该全部保留，留着杀牌
    card(Suit.Spade, Rank.Five), card(Suit.Spade, Rank.Six), card(Suit.Spade, Rank.Eight),
  ];
  const discards = chooseAiDiscard(hand, 4, mainSuit);
  assert.equal(discards.length, 4);
  // ♦ 必须被扣光，形成缺门
  const discardIds = new Set(discards.map(c => c.id));
  const remainingDiamonds = hand.filter(c => c.suit === Suit.Diamond && !discardIds.has(c.id));
  assert.equal(remainingDiamonds.length, 0, '短门♦应该被整门扣光做缺门');
  // 主牌一张都不该扣
  assert.equal(discards.filter(c => c.suit === mainSuit).length, 0, '主牌要留着杀牌，不能扣');
});

test('AI扣底不会为了缺门而拆一半：扣不光的门不动', () => {
  const mainSuit = Suit.Spade;
  // ♦ 有5张但只能扣2张，扣一半没意义（这门照样要跟牌）
  const hand = [
    card(Suit.Diamond, Rank.Four), card(Suit.Diamond, Rank.Six),
    card(Suit.Diamond, Rank.Eight), card(Suit.Diamond, Rank.Nine),
    card(Suit.Diamond, Rank.Jack),
    card(Suit.Heart, Rank.Three), card(Suit.Heart, Rank.Four),
    card(Suit.Club, Rank.Three), card(Suit.Club, Rank.Four),
  ];
  const discards = chooseAiDiscard(hand, 2, mainSuit);
  assert.equal(discards.length, 2);
  // 2张额度扣不光任何一门(♥和♣各2张其实能扣光)，应该扣♥或♣中的一门
  const suits = new Set(discards.map(c => c.suit));
  assert.equal(suits.size, 1, '应该整门扣掉♥或♣，而不是东拼西凑');
});

test('AI跟牌能用连对压过对手的连对', () => {
  const mainSuit = Suit.Spade;
  // 对手领出 ♦4♦4+♦5♦5
  const lead = [...copies(2, Suit.Diamond, Rank.Four), ...copies(2, Suit.Diamond, Rank.Five)];
  // AI 手上有 ♦9♦9+♦T♦T，能压
  const hand = [
    ...copies(2, Suit.Diamond, Rank.Nine),
    ...copies(2, Suit.Diamond, Rank.Ten),
    card(Suit.Diamond, Rank.Three),
    card(Suit.Club, Rank.Eight),
  ];
  const action = chooseAiPlay(hand, lead, mainSuit, {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: true,
  });
  assert.equal(action.cards.length, 4);
  // 必须打出 9/10 的连对，而不是随便凑4张
  const ranks = action.cards.map(c => c.rank).sort((a, b) => a - b);
  assert.deepEqual(ranks, [Rank.Nine, Rank.Nine, Rank.Ten, Rank.Ten]);
});

test('AI缺门时能用主牌连对杀掉对手的副牌连对', () => {
  const mainSuit = Suit.Spade;
  const lead = [...copies(2, Suit.Diamond, Rank.Nine), ...copies(2, Suit.Diamond, Rank.Ten)];
  // AI 完全没有 ♦，但有主♠连对
  const hand = [
    ...copies(2, Suit.Spade, Rank.Nine),
    ...copies(2, Suit.Spade, Rank.Ten),
    card(Suit.Club, Rank.Eight),
    card(Suit.Heart, Rank.Four),
  ];
  const action = chooseAiPlay(hand, lead, mainSuit, {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: true,
  });
  assert.equal(action.cards.every(c => c.suit === mainSuit), true, '应该用主牌连对杀牌');
});

/* 王组合（大王组+小王组）全场无人能压，但整副都是大小王 —— 正是挖底的本钱。
 * 原来 pickComboLead 无条件把它领出去，是"AI 早早把天王出掉"最直接的一条路径：
 * 开局摸到王组合就甩掉，等于主动放弃最后一墩的保底级数。
 * 现在只有收尾阶段（含最后一墩）才允许打。 */
test('AI手上还有别的牌时，不把王组合当开路牌甩出去', () => {
  const mainSuit = Suit.Spade;
  const hand = [
    ...copies(2, Suit.BigJoker, Rank.BigJoker),
    ...copies(2, Suit.SmallJoker, Rank.SmallJoker),
    card(Suit.Club, Rank.Eight),
    card(Suit.Heart, Rank.Four),
  ];
  const action = chooseAiPlay(hand, [], mainSuit, {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: [],
    winnerIsAlly: false,
    isLastToPlay: false,
  });
  assert.equal(
    action.cards.some(c => c.suit === Suit.BigJoker || c.suit === Suit.SmallJoker),
    false,
    '手上还有副牌可打时，不该拿大小王开路（要留着挖底）',
  );
});

test('到了最后一墩，王组合该打就打', () => {
  const mainSuit = Suit.Spade;
  const hand = [
    ...copies(2, Suit.BigJoker, Rank.BigJoker),
    ...copies(2, Suit.SmallJoker, Rank.SmallJoker),
  ];
  const action = chooseAiPlay(hand, [], mainSuit, {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: [],
    winnerIsAlly: false,
    isLastToPlay: false,
    isFinalTrick: true,
  });
  assert.equal(action.cards.length, 4, '最后一墩留着也没用，整组领出去挖底');
  assert.equal(
    action.cards.every(c => c.suit === Suit.BigJoker || c.suit === Suit.SmallJoker),
    true,
  );
});

// ===== 跟牌不该拆自己的对子（用户反馈：「别人大一对，它也要把对跟掉」）=====

test('AI压不过对手的对子时，用散牌垫，不拆自己的小对子', () => {
  const mainSuit = Suit.Heart;
  // 手上有 ♣4/♣6/♣9 三张散牌 + 一对 ♣5
  const pair = copies(2, Suit.Club, Rank.Five);
  const hand = [
    card(Suit.Club, Rank.Four),
    card(Suit.Club, Rank.Six),
    card(Suit.Club, Rank.Nine),
    ...pair,
  ];
  // 对手领出 ♣K♣K，怎么跟都压不过
  const lead = copies(2, Suit.Club, Rank.King);
  const action = chooseAiPlay(hand, lead, mainSuit, {
    playedCards: [],
    deckCount: 2,
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: false,
  });
  assert.equal(action.cards.length, 2);
  const pairIds = new Set(pair.map(c => c.id));
  const usedFromPair = action.cards.filter(c => pairIds.has(c.id)).length;
  assert.equal(usedFromPair, 0, '压不过就该垫散牌，不该动成对的牌');
});

test('AI散牌不够凑张数时，才允许拆对子补齐', () => {
  const mainSuit = Suit.Heart;
  // 只有 1 张散牌，其余全是成对的 —— 跟 3 张必须拆
  const hand = [
    card(Suit.Club, Rank.Four),
    ...copies(2, Suit.Club, Rank.Five),
  ];
  const lead = copies(3, Suit.Club, Rank.King);
  const action = chooseAiPlay(hand, lead, mainSuit, {
    playedCards: [],
    deckCount: 2,
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: false,
  });
  assert.equal(action.cards.length, 3, '张数必须跟足，不能因为舍不得拆对就少出');
});

// ===== 天王要留到最后（早早出掉等于放弃挖底）=====

test('AI领出时不会拿含天王的连对开路，先出副牌小牌', () => {
  const mainSuit = Suit.Heart; // 天王 = ♥3
  const hand = [
    ...copies(2, Suit.Heart, Rank.Three), // 天王对
    ...copies(2, Suit.Heart, Rank.Four),  // 与天王构成主花色连对
    card(Suit.Club, Rank.Five),
    card(Suit.Club, Rank.Eight),
    card(Suit.Spade, Rank.Nine),
    card(Suit.Spade, Rank.Four),
  ];
  const action = chooseAiPlay(hand, [], mainSuit, {
    playedCards: [],
    deckCount: 2,
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: [],
    winnerIsAlly: false,
    isLastToPlay: false,
  });
  const usedTianWang = action.cards.some(c => c.suit === mainSuit && c.rank === Rank.Three);
  assert.equal(usedTianWang, false, '开局不该把天王甩出去，挖底要靠它');
});

test('AI只剩主牌时先出小主牌，天王留到最后', () => {
  const mainSuit = Suit.Heart;
  const hand = [
    card(Suit.Heart, Rank.Three), // 天王
    card(Suit.Heart, Rank.Four),
    card(Suit.Heart, Rank.Five),
    card(Suit.Heart, Rank.Nine),
  ];
  const action = chooseAiPlay(hand, [], mainSuit, {
    playedCards: [],
    deckCount: 2,
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: [],
    winnerIsAlly: false,
    isLastToPlay: false,
  });
  const usedTianWang = action.cards.some(c => c.suit === mainSuit && c.rank === Rank.Three);
  assert.equal(usedTianWang, false, '手上还有别的主牌时不该先打天王');
});

test('AI收尾阶段（手牌很少）可以正常打出天王争挖底', () => {
  const mainSuit = Suit.Heart;
  const hand = [card(Suit.Heart, Rank.Three)]; // 只剩天王
  const action = chooseAiPlay(hand, [], mainSuit, {
    playedCards: [],
    deckCount: 2,
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: [],
    winnerIsAlly: false,
    isLastToPlay: false,
  });
  assert.equal(action.cards.length, 1, '只剩天王时必须能打出来，不能卡住');
  assert.equal(action.cards[0].rank, Rank.Three);
});

// ===== 提示轮转（反复按提示要给出不同的合规方案）=====

test('提示能给出多套不同的合规跟牌方案，且第一套就是AI推荐', () => {
  const hand = [
    ...copies(2, Suit.Club, Rank.Five),
    card(Suit.Club, Rank.Eight),
    card(Suit.Club, Rank.Nine),
    card(Suit.Club, Rank.Jack),
    card(Suit.Spade, Rank.Four),
  ];
  const lead = [card(Suit.Club, Rank.Six)];
  const options = enumerateHintPlays(hand, lead, Suit.Heart);
  const recommended = chooseAiPlay(hand, lead, Suit.Heart).cards;

  assert.ok(options.length >= 3, `方案数太少：${options.length}`);
  assert.deepEqual(
    options[0].map(c => c.id).sort(),
    recommended.map(c => c.id).sort(),
    '第一套必须是AI推荐的那一手',
  );
  // 每套都不重复，否则玩家反复按提示会看到一样的牌
  const keys = options.map(o => o.map(c => c.id).sort().join(','));
  assert.equal(new Set(keys).size, keys.length, '提示方案有重复');
});

test('提示给出的每套方案都合法：张数正确且本门跟足', () => {
  // 注意：7 和 2 是常主，不能拿来当副牌造用例，否则"首家领梅花"其实是领主。
  const hand = [
    ...copies(2, Suit.Club, Rank.Five),
    ...copies(2, Suit.Club, Rank.Nine),
    card(Suit.Club, Rank.King),
    card(Suit.Spade, Rank.Four),
    card(Suit.Heart, Rank.Four),
  ];
  const lead = copies(2, Suit.Club, Rank.Six);
  const options = enumerateHintPlays(hand, lead, Suit.Heart);
  assert.ok(options.length > 0);
  for (const option of options) {
    assert.equal(option.length, 2, '张数必须与首家一致');
    // 手里梅花副牌有 5 张，两张都必须是梅花
    assert.ok(
      option.every(c => c.suit === Suit.Club),
      `本门有牌却垫了别的花色：${option.map(c => c.rank).join(',')}`,
    );
  }
});

test('提示领出时给出多套合法牌型，且不含甩牌那种非标准形态', () => {
  const hand = [
    ...copies(2, Suit.Club, Rank.Five),
    ...copies(2, Suit.Club, Rank.Six),
    card(Suit.Spade, Rank.Nine),
    card(Suit.Spade, Rank.King),
  ];
  const options = enumerateHintPlays(hand, [], Suit.Heart);
  assert.ok(options.length >= 4, `领出方案太少：${options.length}`);
  for (const option of options) {
    // 单张 / 对子 / 连对 都可以；同门任意多张（甩牌）不能出现在提示里
    assert.ok([1, 2, 3, 4, 6].includes(option.length), `异常张数 ${option.length}`);
  }
});

test('提示方案数有上限，不会给玩家一长串按不完的方案', () => {
  const hand = [
    card(Suit.Club, Rank.Three), card(Suit.Club, Rank.Four),
    card(Suit.Club, Rank.Five), card(Suit.Club, Rank.Six),
    card(Suit.Club, Rank.Eight), card(Suit.Club, Rank.Nine),
    card(Suit.Club, Rank.Ten), card(Suit.Club, Rank.Jack),
    card(Suit.Club, Rank.Queen), card(Suit.Club, Rank.King),
  ];
  const options = enumerateHintPlays(hand, [card(Suit.Club, Rank.Seven)], Suit.Heart);
  assert.ok(options.length <= 6, `方案数超上限：${options.length}`);
});

test('提示在本门不够时也只给合法的补牌方案', () => {
  const hand = [
    card(Suit.Club, Rank.Five),
    card(Suit.Spade, Rank.Four),
    card(Suit.Spade, Rank.Nine),
    card(Suit.Heart, Rank.Four),
  ];
  const lead = copies(2, Suit.Club, Rank.Six);
  const options = enumerateHintPlays(hand, lead, Suit.Heart);
  assert.ok(options.length > 0);
  for (const option of options) {
    assert.equal(option.length, 2);
    // 手里只有一张梅花，它必须在每套方案里（本门有牌就得先跟出来）
    assert.equal(option.filter(c => c.suit === Suit.Club && c.rank === Rank.Five).length, 1);
  }
});

// ===== 叫主/叫分的牌力判断（用户反馈：AI 牌不好也去叫主叫分）=====

/** 造一手"真实规模"的手牌（12 张），用于牌力判断类测试。 */
function bigHand(cards: CardData[]): CardData[] {
  const filler: CardData[] = [];
  const ranks = [Rank.Four, Rank.Six, Rank.Eight, Rank.Nine, Rank.Jack, Rank.Queen];
  let i = 0;
  while (cards.length + filler.length < 12) {
    filler.push(card(Suit.Club, ranks[i % ranks.length]));
    i++;
  }
  return [...cards, ...filler];
}

test('牌力评估：强牌明显高于烂牌', () => {
  const mainSuit = Suit.Spade;
  // 强牌：天王×2 + 大小王 + 长主 + 分牌
  const strong = [
    ...copies(2, Suit.Spade, Rank.Three),
    card(Suit.BigJoker, Rank.BigJoker),
    card(Suit.SmallJoker, Rank.SmallJoker),
    ...copies(2, Suit.Spade, Rank.Seven),
    ...copies(2, Suit.Spade, Rank.Two),
    card(Suit.Spade, Rank.King),
    card(Suit.Spade, Rank.Ten),
    card(Suit.Heart, Rank.Four),
    card(Suit.Club, Rank.Six),
  ];
  // 烂牌：一张主 7 撑门面，其余全是零散小副牌
  const weak = [
    card(Suit.Spade, Rank.Seven),
    card(Suit.Heart, Rank.Four), card(Suit.Heart, Rank.Six), card(Suit.Heart, Rank.Eight),
    card(Suit.Diamond, Rank.Four), card(Suit.Diamond, Rank.Six), card(Suit.Diamond, Rank.Nine),
    card(Suit.Club, Rank.Four), card(Suit.Club, Rank.Six), card(Suit.Club, Rank.Eight),
    card(Suit.Club, Rank.Nine), card(Suit.Club, Rank.Jack),
  ];
  const sStrong = evaluateHandStrength(strong, mainSuit);
  const sWeak = evaluateHandStrength(weak, mainSuit);
  assert.ok(sStrong > 0.7, `强牌应该 >0.7，实际 ${sStrong}`);
  assert.ok(sWeak < 0.4, `烂牌应该 <0.4，实际 ${sWeak}`);
  assert.ok(sStrong > sWeak + 0.3, '强弱差距要明显');
});

test('AI 牌力不够时放弃叫主（不再摸到一张7就抢庄）', () => {
  // 一手烂牌，但手上确实有一张黑桃 7（够门槛）
  const weak = bigHand([
    card(Suit.Spade, Rank.Seven),
    card(Suit.Heart, Rank.Four),
    card(Suit.Diamond, Rank.Six),
  ]);
  assert.equal(chooseAiSuit(weak, 1), 255, '烂牌不该叫主');

  // 同样有黑桃 7，但整手牌很强 -> 该叫
  const strong = [
    ...copies(2, Suit.Spade, Rank.Seven),
    ...copies(2, Suit.Spade, Rank.Three),
    card(Suit.BigJoker, Rank.BigJoker),
    card(Suit.SmallJoker, Rank.SmallJoker),
    ...copies(2, Suit.Spade, Rank.Two),
    card(Suit.Spade, Rank.King),
    card(Suit.Spade, Rank.Ace),
    card(Suit.Spade, Rank.Ten),
    card(Suit.Heart, Rank.Four),
  ];
  assert.equal(chooseAiSuit(strong, 1), Suit.Spade, '强牌应该叫主');
});

test('AI 牌力不够时不叫分，强牌才敢叫高分', () => {
  const mainSuit = Suit.Spade;
  const weak = bigHand([
    card(Suit.Spade, Rank.Seven),
    card(Suit.Heart, Rank.Four),
    card(Suit.Diamond, Rank.Six),
  ]);
  // 没人叫过分也不能无脑顶满（原实现直接 return maxScore）
  assert.equal(chooseAiBid(weak, mainSuit, 125, false), 0, '烂牌不该叫分');

  const strong = [
    ...copies(2, Suit.Spade, Rank.Three),
    card(Suit.BigJoker, Rank.BigJoker),
    card(Suit.SmallJoker, Rank.SmallJoker),
    ...copies(2, Suit.Spade, Rank.Seven),
    ...copies(2, Suit.Spade, Rank.Two),
    card(Suit.Spade, Rank.King),
    card(Suit.Spade, Rank.Ten),
    card(Suit.Spade, Rank.Five),
    card(Suit.Heart, Rank.Four),
  ];
  const bid = chooseAiBid(strong, mainSuit, 125, false);
  assert.ok(bid >= 40, `强牌该叫分，实际 ${bid}`);
  assert.ok(bid <= 125, '不能超过上限');
});

// ===== 最后一墩：闲家挖底 / 庄家保底（用户反馈：AI 早早把天王出掉）=====

test('最后一墩闲家会用天王杀下来（挖底），不再省着不用', () => {
  const mainSuit = Suit.Spade;
  /* 手上只剩天王和一张梅花，对手领出红桃 K（10 分）。
   * 我没有红桃 —— 按规则（validate.ts：有该花色必须跟该花色）此时才可以
   * 动用主牌杀牌。若手上有红桃就必须跟红桃，那是规则而不是 AI 的选择。 */
  const hand = [
    card(Suit.Spade, Rank.Three),   // 天王
    card(Suit.Club, Rank.Four),
  ];
  const lead = [card(Suit.Heart, Rank.King)];
  const action = chooseAiPlay(hand, lead, mainSuit, {
    isBanker: false,          // 我是闲家
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: true,
    isFinalTrick: true,       // 最后一墩
  });
  assert.equal(action.cards.length, 1);
  assert.equal(action.cards[0].rank, Rank.Three, '最后一墩应该用天王杀，拿底牌分+保底级');
});

test('非最后一墩且桌上无分时，天王留着不动（这才是"省大牌"的正确时机）', () => {
  const mainSuit = Suit.Spade;
  const hand = [
    card(Suit.Spade, Rank.Three),   // 天王
    card(Suit.Club, Rank.Four),
    card(Suit.Club, Rank.Six),
  ];
  const lead = [card(Suit.Heart, Rank.Four)];  // 无分小牌
  const action = chooseAiPlay(hand, lead, mainSuit, {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: false,
    isFinalTrick: false,
  });
  assert.notEqual(action.cards[0].rank, Rank.Three, '还没到最后一墩、桌上又没分，不该甩天王');
});

test('桌面分量可观时庄家会出手杀分', () => {
  const mainSuit = Suit.Spade;
  const hand = [
    card(Suit.Spade, Rank.Two),     // 常主 2，能杀
    card(Suit.Club, Rank.Four),
    card(Suit.Club, Rank.Six),
  ];
  // 闲家领出一张 K（10 分），我没有该花色 -> 该用主牌杀分
  const lead = [card(Suit.Heart, Rank.King)];
  const action = chooseAiPlay(hand, lead, mainSuit, {
    isBanker: true,
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: false,
    isFinalTrick: false,
  });
  assert.equal(action.cards.length, 1);
  assert.equal(action.cards[0].rank, Rank.Two, '桌上有 10 分，庄家该用主牌杀掉');
});

test('桌面一分没有且不是末位时，不浪费主牌去杀', () => {
  const mainSuit = Suit.Spade;
  const hand = [
    card(Suit.Spade, Rank.Two),
    card(Suit.Club, Rank.Four),
    card(Suit.Club, Rank.Six),
  ];
  // 对手领出无分小牌，我没这门花色
  const lead = [card(Suit.Heart, Rank.Four)];
  const action = chooseAiPlay(hand, lead, mainSuit, {
    isBanker: true,
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: false,
    isFinalTrick: false,
  });
  assert.notEqual(action.cards[0].rank, Rank.Two, '桌上没分不该浪费主牌');
});


/* ===== 天王/大小王要留到最后一墩（挖底的本钱）=====
 *
 * 按规则，闲家赢下最后一墩且那手牌含天王/大小王才算「挖底」：
 * 1 张天王保底 3 级、2 张封顶 4 级、仅大小王保底 1 级。
 * 一墩分牌最多也就十几分，换掉 3 个级数是纯亏，所以门槛必须比
 * 普通大牌高得多（PREMIUM_KILL_SCORE=20，普通的 WORTH_KILLING_SCORE=10）。
 */

test('只有天王能压但桌面分很少时，宁可不压也把天王留着', () => {
  const mainSuit = Suit.Spade;
  // 手上：天王(♠3) + 同门几张跟得起的小牌
  const hand = [
    card(Suit.Spade, Rank.Three),   // 天王
    card(Suit.Club, Rank.Four),
    card(Suit.Club, Rank.Six),
    card(Suit.Club, Rank.Eight),
    card(Suit.Heart, Rank.Nine),
    card(Suit.Heart, Rank.Four),
  ];
  // 对手领出 ♣A，我的 ♣ 全压不过，只有天王能压；桌上只有 0 分
  const lead = [card(Suit.Club, Rank.Ace)];
  const action = chooseAiPlay(hand, lead, mainSuit, {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: true,
    isFinalTrick: false,
  });
  assert.equal(
    action.cards.some(c => c.suit === mainSuit && c.rank === Rank.Three),
    false,
    '桌上没分，不该拿天王去换一墩',
  );
});

test('桌面分够大时，该用天王就用', () => {
  const mainSuit = Suit.Spade;
  /* 手上不能有 ♣ —— 有首家花色就必须跟同门，根本轮不到出主牌。
   * 这里做成 ♣ 缺门，天王才是可选项。 */
  const hand = [
    card(Suit.Spade, Rank.Three),   // 天王
    card(Suit.Heart, Rank.Nine),
    card(Suit.Heart, Rank.Four),
  ];
  // 对手领出 ♣K(10分)，桌上暂时最大的也是 ♣K(10分) —— 合计 20 分，达到 PREMIUM_KILL_SCORE
  const lead = [card(Suit.Club, Rank.King)];
  const winning = [card(Suit.Club, Rank.King)];
  const action = chooseAiPlay(hand, lead, mainSuit, {
    isBanker: true,
    leaderIsAlly: false,
    currentWinningCards: winning,
    winnerIsAlly: false,
    isLastToPlay: true,
    isFinalTrick: false,
  });
  // ♣ 缺门，手上唯一能杀的主牌就是天王；20 分值得杀
  assert.equal(
    action.cards.some(c => c.suit === mainSuit && c.rank === Rank.Three),
    true,
    '桌上 20 分，庄家该用天王杀分',
  );
});

test('没有首家花色时优先用普通主牌杀，不动天王', () => {
  const mainSuit = Suit.Spade;
  const hand = [
    card(Suit.Spade, Rank.Three),   // 天王
    card(Suit.Spade, Rank.Five),    // 普通主牌，也能杀
    card(Suit.Heart, Rank.Nine),
  ];
  // 对手领出 ♣K（10 分），我没有 ♣，可以主杀
  const lead = [card(Suit.Club, Rank.King)];
  const action = chooseAiPlay(hand, lead, mainSuit, {
    isBanker: true,
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: true,
    isFinalTrick: false,
  });
  assert.equal(action.cards.length, 1);
  assert.equal(
    action.cards[0].rank === Rank.Three && action.cards[0].suit === mainSuit,
    false,
    '有普通主牌能杀就别动天王',
  );
  assert.equal(action.cards[0].suit, mainSuit, '仍然要杀掉这一墩');
});

test('最后一墩即使桌上没分，也要用天王赢下来（挖底）', () => {
  const mainSuit = Suit.Spade;
  const hand = [card(Suit.Spade, Rank.Three)];
  const lead = [card(Suit.Club, Rank.Four)];
  const action = chooseAiPlay(hand, lead, mainSuit, {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: true,
    isFinalTrick: true,
  });
  assert.equal(action.cards[0].rank, Rank.Three, '最后一墩用天王赢＝挖底保底3级');
});

test('庄家只要桌上有分就压，不让闲家白收（杀分门槛比闲家低）', () => {
  const mainSuit = Suit.Spade;
  // 同门有能压过的普通牌，不涉及天王
  const hand = [
    card(Suit.Club, Rank.Ace),
    card(Suit.Club, Rank.Four),
    card(Suit.Heart, Rank.Nine),
  ];
  // 闲家领出 ♣5（5 分），低于 WORTH_KILLING_SCORE=10
  const lead = [card(Suit.Club, Rank.Five)];
  const action = chooseAiPlay(hand, lead, mainSuit, {
    isBanker: true,
    leaderIsAlly: false,
    currentWinningCards: lead,
    winnerIsAlly: false,
    isLastToPlay: false,
    isFinalTrick: false,
  });
  assert.equal(action.cards[0].rank, Rank.Ace, '庄家 1 打 3，5 分也该收回来');
});


/* ===== 叫分方向：这是一个曾经完全反掉的 bug =====
 *
 * 规则（CONTEXT.md / PHASE1-SPEC.md）：叫分从基准分 125 起**倒着叫**，
 * 后叫必须更低，谁叫得最低谁坐庄；叫分的含义是
 * 「闲家达到这个分数就算打倒庄家」。
 * 所以叫分越低 = 契约越难 = 越需要好牌。
 *
 * 旧实现算的是"牌力越强 -> willing 越接近 125"，正好相反：
 * 强牌去接最宽松的契约，烂牌反而叫 40（最狠）。实测平均叫 58 分、
 * 庄家胜率 0.8%，等于 AI 每局自杀。
 */

test('叫分方向：强牌敢把叫分压得更低，弱牌只敢守在基准分附近', () => {
  const mainSuit = Suit.Spade;
  const strong = [
    ...copies(2, Suit.Spade, Rank.Three),   // 天王 ×2
    card(Suit.BigJoker, Rank.BigJoker),
    card(Suit.SmallJoker, Rank.SmallJoker),
    ...copies(2, Suit.Spade, Rank.Seven),
    ...copies(2, Suit.Spade, Rank.Two),
    card(Suit.Spade, Rank.Ace),
    card(Suit.Spade, Rank.King),
    card(Suit.Spade, Rank.Ten),
    card(Suit.Spade, Rank.Five),
  ];
  const mid = bigHand([
    card(Suit.Spade, Rank.Seven),
    card(Suit.Spade, Rank.Nine),
    card(Suit.Heart, Rank.King),
  ]);
  const strongBid = chooseAiBid(strong, mainSuit, 125, false);
  const midBid = chooseAiBid(mid, mainSuit, 125, false);
  assert.ok(strongBid > 0, `强牌应该敢叫分，实际 ${strongBid}`);
  assert.ok(
    midBid === 0 || strongBid < midBid,
    `强牌的叫分必须比弱牌更低（更狠）：强=${strongBid} 弱=${midBid}`,
  );
});

test('叫分永远不低于规则下限，也不超过本次允许的上限', () => {
  const mainSuit = Suit.Spade;
  const strong = [
    ...copies(2, Suit.Spade, Rank.Three),
    card(Suit.BigJoker, Rank.BigJoker),
    card(Suit.SmallJoker, Rank.SmallJoker),
    ...copies(2, Suit.Spade, Rank.Seven),
    ...copies(2, Suit.Spade, Rank.Two),
    card(Suit.Spade, Rank.Ace),
    card(Suit.Spade, Rank.King),
    card(Suit.Spade, Rank.Ten),
    card(Suit.Spade, Rank.Five),
  ];
  // 已经被别人压到 60 分：虽然规则允许（60>=40），但低于 AI 硬下限 90，所以弃庄
  assert.equal(chooseAiBid(strong, mainSuit, 60, true), 0, '被压到 90 以下应该弃庄');
  // 上限低于规则下限时必须放弃
  assert.equal(chooseAiBid(strong, mainSuit, 35, true), 0, '低于40分不能叫');
});

test('AI 叫分永不低于 90（低分契约实测必输）', () => {
  const mainSuit = Suit.Spade;
  // 构造一批强弱不一的手牌，把 maxScore 从 125 一路扫到 40，
  // 断言：要么弃庄（ 0 ），要么叫的分 >= 90，绝不出现 40~85 的自杀契约。
  const hands: CardData[][] = [
    // 极品牌
    [
      ...copies(2, Suit.Spade, Rank.Three),
      card(Suit.BigJoker, Rank.BigJoker),
      card(Suit.SmallJoker, Rank.SmallJoker),
      ...copies(2, Suit.Spade, Rank.Seven),
      ...copies(2, Suit.Spade, Rank.Two),
      card(Suit.Spade, Rank.Ace),
      card(Suit.Spade, Rank.King),
      card(Suit.Spade, Rank.Ten),
      card(Suit.Spade, Rank.Five),
    ],
    // 中等牌
    [
      card(Suit.Spade, Rank.Three),
      card(Suit.Spade, Rank.Seven),
      card(Suit.Spade, Rank.Ace),
      card(Suit.Heart, Rank.King),
      card(Suit.Heart, Rank.Ten),
      card(Suit.Club, Rank.Nine),
      card(Suit.Club, Rank.Eight),
      card(Suit.Diamond, Rank.Six),
      card(Suit.Diamond, Rank.Five),
      card(Suit.Diamond, Rank.Four),
      card(Suit.Club, Rank.Jack),
    ],
    // 烂牌
    [
      card(Suit.Heart, Rank.Four),
      card(Suit.Heart, Rank.Five),
      card(Suit.Club, Rank.Six),
      card(Suit.Club, Rank.Eight),
      card(Suit.Diamond, Rank.Nine),
      card(Suit.Diamond, Rank.Four),
      card(Suit.Heart, Rank.Six),
      card(Suit.Club, Rank.Four),
      card(Suit.Diamond, Rank.Five),
      card(Suit.Heart, Rank.Eight),
      card(Suit.Club, Rank.Nine),
    ],
  ];
  for (const hand of hands) {
    for (let maxScore = 125; maxScore >= 40; maxScore -= 5) {
      for (const hasCurrentBid of [false, true]) {
        const bid = chooseAiBid(hand, mainSuit, maxScore, hasCurrentBid);
        assert.ok(
          bid === 0 || bid >= 90,
          `AI 叫了 ${bid} 分（maxScore=${maxScore}, hasCurrentBid=${hasCurrentBid}），低于硬下限 90`,
        );
        // 叫的分不能超过允许的上限
        assert.ok(bid <= maxScore, `叫分 ${bid} 超过上限 ${maxScore}`);
      }
    }
  }
});

test('AI 手牌太少算不准牌力时，兼顶也不破 90 分硬下限', () => {
  const tiny = [card(Suit.Spade, Rank.Three), card(Suit.Heart, Rank.Four)];
  // 没人叫过时接一个最宽松的契约
  assert.equal(chooseAiBid(tiny, Suit.Spade, 125, false), 125);
  // 上限已经被压到 90 以下 -> 弃庄，而不是跟下去
  assert.equal(chooseAiBid(tiny, Suit.Spade, 70, false), 0);
  assert.equal(chooseAiBid(tiny, Suit.Spade, 125, true), 0);
});

// ===== 叫主的两个逻辑错误的回归锁定（2026-09） =====

test('选主花色按「定这门为主之后牌力多强」，不是按哪门张数多', () => {
  /* 反例来自实测：♠ 6 张但全是压不住人的小散牌；♥ 只有 5 张，
   * 但含两张 ♥3 —— 定 ♥ 为主时那两张就是天王（全场最大）。
   * 老逻辑只比门长，会选 ♠；正确答案是 ♥。 */
  const hand = [
    card(Suit.Spade, Rank.Seven),
    card(Suit.Spade, Rank.Four), card(Suit.Spade, Rank.Five),
    card(Suit.Spade, Rank.Six), card(Suit.Spade, Rank.Eight), card(Suit.Spade, Rank.Nine),
    card(Suit.Heart, Rank.Seven),
    ...copies(2, Suit.Heart, Rank.Three),
    card(Suit.Heart, Rank.Ace), card(Suit.Heart, Rank.King),
    card(Suit.Club, Rank.Four), card(Suit.Club, Rank.Nine),
    card(Suit.Diamond, Rank.Ten),
  ];
  // 前提：♥ 确实比 ♠ 强，否则这条测试测的不是它想测的东西
  assert.ok(
    evaluateHandStrength(hand, Suit.Heart) > evaluateHandStrength(hand, Suit.Spade),
    '前提不成立：定♥为主应该比定♠为主更强',
  );
  // 而 ♠ 的张数确实比 ♥ 多（老逻辑正是被这个骗到的）
  assert.ok(
    hand.filter(c => c.suit === Suit.Spade).length > hand.filter(c => c.suit === Suit.Heart).length,
    '前提不成立：♠ 应该比 ♥ 张数多',
  );
  assert.equal(chooseAiSuit(hand, 1), Suit.Heart);
});

test('牌力撑不起叫分时不叫主：亮7暴露常主又把庄让给别人，纯亏', () => {
  /* 这手牌是从真实发牌里捞出来的「问题区间」样本：
   * 定 ♥ 为主时牌力 0.675 —— 过了叫主门槛 0.65，却没过叫分门槛 0.68。
   * 老逻辑会去亮 ♥7 定主，然后叫分阶段不敢叫，庄让给别人，
   * 等于免费告诉全桌"我有几张 ♥7"。实测 23.8% 的局是这个形状。 */
  const hand = [
    card(Suit.Spade, Rank.Eight), card(Suit.Spade, Rank.Seven),
    card(Suit.Heart, Rank.Six), card(Suit.Club, Rank.Nine),
    card(Suit.SmallJoker, Rank.SmallJoker),
    card(Suit.Heart, Rank.Jack), card(Suit.Heart, Rank.Queen),
    card(Suit.Club, Rank.Ace), card(Suit.Heart, Rank.Ten),
    card(Suit.Club, Rank.Nine), card(Suit.Club, Rank.Three),
    card(Suit.Diamond, Rank.Seven), card(Suit.Club, Rank.Jack),
    card(Suit.Spade, Rank.Queen), card(Suit.Heart, Rank.Four),
    card(Suit.Heart, Rank.Eight), card(Suit.Heart, Rank.Nine),
    card(Suit.Diamond, Rank.Four), card(Suit.Spade, Rank.King),
    card(Suit.Spade, Rank.King), card(Suit.Heart, Rank.Five),
    card(Suit.Spade, Rank.Seven), card(Suit.Spade, Rank.Nine),
    card(Suit.Heart, Rank.Seven),
  ];
  // 前提锁定：这手牌确实落在「能叫主但不该叫分」的区间里。
  // 这两条断言不是装饰 —— 门槛常数以后被改动时，先在这里报错比测试悄悄
  // 变成"测了个不相关的东西"要好。
  assert.equal(chooseAiSuit(hand, 1), Suit.Heart, '前提：不带上下文时会叫♥主');
  assert.equal(chooseAiBid(hand, Suit.Heart, 125, false), 0, '前提：这手牌不该叫分');

  // 打通之后：既然不会去叫分，就不该亮 7 定主
  assert.equal(chooseAiSuit(hand, 1, { bidMax: 125, hasCurrentBid: false }), 255);
});

test('叫主与叫分打通后，「叫了主却没坐庄」的比例必须明显下降', () => {
  /* 这是本次改动真正要解决的问题（实测原来 23.8% 的局是这个形状：
   * 亮 7 定了主，随后不敢叫分，庄让给别人 —— 白白暴露常主）。
   * 用固定种子跑一批牌，比较「带 bidContext」和「不带」的差异。
   * 不写死绝对数值（发牌是随机的），只锁「必须更低」这个方向。 */
  const mode = GAME_MODES.fourPlayerTwoDecks;
  const bidMax = 125;
  const N = 400;
  let withCtx = 0, withoutCtx = 0;

  for (let g = 0; g < N; g++) {
    const { hands } = dealCards(mode);
    // 两种策略各跑一遍同一副牌
    for (const useCtx of [true, false]) {
      let mainSuit = 255, callCount = 0, callerSeat = -1;
      for (let seat = 0; seat < 4; seat++) {
        const need = mainSuit === 255 ? 1 : callCount + 1;
        const suit = useCtx
          ? chooseAiSuit(hands[seat], need, { bidMax, hasCurrentBid: false })
          : chooseAiSuit(hands[seat], need);
        if (suit !== 255) { mainSuit = suit; callCount = need; callerSeat = seat; }
      }
      if (callerSeat < 0) continue;
      // 叫分一圈，谁叫得最低谁坐庄
      let currentBid = bidMax, bidderSeat = -1, hasBid = false;
      for (let i = 0; i < 4; i++) {
        const seat = (callerSeat + i) % 4;
        const ceiling = hasBid ? currentBid - 5 : bidMax;
        const score = chooseAiBid(hands[seat], mainSuit, ceiling, hasBid);
        if (score > 0 && (score < currentBid || (!hasBid && score === bidMax))) {
          currentBid = score; bidderSeat = seat; hasBid = true;
        }
      }
      if (bidderSeat < 0 || bidderSeat === callerSeat) continue;
      if (useCtx) withCtx++; else withoutCtx++;
    }
  }
  assert.ok(withoutCtx > 0, `基线必须真的出现过这个问题，实际 ${withoutCtx}`);
  assert.ok(
    withCtx < withoutCtx,
    `打通后「叫主却没坐庄」应该更少：带上下文 ${withCtx} vs 不带 ${withoutCtx}`,
  );
});
