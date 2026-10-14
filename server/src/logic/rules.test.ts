import test from 'node:test';
import assert from 'node:assert/strict';
import { CardData, CardType, GAME_CONFIG, GAME_MODES, Rank, Suit } from './config.js';
import {
  comparePattern,
  getCardRank,
  identifyCardType,
  isJokerCombo,
  isMainCard,
  isTianWang,
  isTractor,
  isTripleRun,
} from './compare.js';
import {
  calculateOpponentLevel,
  createFlowBreakDeltas,
  createLevelDeltas,
  evaluateDig,
  getBankerWinLevel,
  getScoreLevel,
} from './levels.js';
import { calcTrickScore } from './score.js';
import { checkFollow } from './validate.js';

let nextId = 0;
const card = (suit: number, rank: number): CardData => ({ id: `card-${nextId++}`, suit, rank });
const copies = (count: number, suit: number, rank: number): CardData[] =>
  Array.from({ length: count }, () => card(suit, rank));

test('第一阶段使用4人两副牌，总分200且底牌12张', () => {
  assert.equal(GAME_CONFIG.playerCount, 4);
  assert.equal(GAME_CONFIG.deckCount, 2);
  assert.equal(GAME_CONFIG.totalScore, 200);
  assert.equal(GAME_CONFIG.bottomCount, 12);
});

test('最终模式最多三副牌且每个模式牌数守恒', () => {
  for (const mode of Object.values(GAME_MODES)) {
    assert.ok(mode.deckCount <= 3);
    assert.equal(mode.playerCount * mode.perPlayer + mode.bottomCount, mode.totalCards);
    assert.equal(mode.totalCards, mode.deckCount * 54);
    assert.equal(mode.totalScore, mode.deckCount * 100);
  }
});

test('完整牌力顺序：主牌整体大于副牌', () => {
  const mainSuit = Suit.Heart;
  const cards = [
    card(Suit.Heart, Rank.Three),      // 天王
    card(Suit.BigJoker, Rank.BigJoker),
    card(Suit.SmallJoker, Rank.SmallJoker),
    card(Suit.Heart, Rank.Seven),       // 主7
    card(Suit.Spade, Rank.Seven),       // 副7
    card(Suit.Heart, Rank.Two),         // 主2
    card(Suit.Spade, Rank.Two),         // 副2
    card(Suit.Heart, Rank.Ace),
    card(Suit.Heart, Rank.King),
    card(Suit.Heart, Rank.Queen),
    card(Suit.Heart, Rank.Jack),
    card(Suit.Heart, Rank.Ten),
    card(Suit.Heart, Rank.Nine),
    card(Suit.Heart, Rank.Eight),
    card(Suit.Heart, Rank.Four),
    card(Suit.Spade, Rank.Ace),         // 副牌A
    card(Suit.Spade, Rank.King),
    card(Suit.Spade, Rank.Queen),
    card(Suit.Spade, Rank.Jack),
    card(Suit.Spade, Rank.Ten),
    card(Suit.Spade, Rank.Nine),
    card(Suit.Spade, Rank.Eight),
    card(Suit.Spade, Rank.Six),
    card(Suit.Spade, Rank.Five),
    card(Suit.Spade, Rank.Three),       // 副牌3
  ];
  for (let i = 0; i < cards.length - 1; i++) {
    assert.ok(
      getCardRank(cards[i], mainSuit) > getCardRank(cards[i + 1], mainSuit),
      `第${i + 1}张应大于第${i + 2}张`
    );
  }
});

test('天王跟随主花色变化，主花色3全场最大', () => {
  const heartThree = card(Suit.Heart, Rank.Three);
  const diamondThree = card(Suit.Diamond, Rank.Three);
  const bigJoker = card(Suit.BigJoker, Rank.BigJoker);

  assert.equal(isTianWang(heartThree, Suit.Heart), true);
  assert.equal(isTianWang(diamondThree, Suit.Heart), false);
  assert.equal(isMainCard(heartThree, Suit.Heart), true);
  assert.ok(getCardRank(heartThree, Suit.Heart) > getCardRank(bigJoker, Suit.Heart));
});

test('三张必须是三张完全相同的牌', () => {
  const tripleFours = copies(3, Suit.Club, Rank.Four);
  const twoTianWangAndJoker = [
    ...copies(2, Suit.Heart, Rank.Three),
    card(Suit.BigJoker, Rank.BigJoker),
  ];

  assert.equal(identifyCardType(tripleFours, Suit.Heart), CardType.Triple);
  assert.equal(identifyCardType(twoTianWangAndJoker, Suit.Heart), null);
  assert.equal(comparePattern(twoTianWangAndJoker, tripleFours, Suit.Heart), -1);
});

test('不支持顺子：同花色连续5张或6张都不是合法牌型', () => {
  const twoToSix = [Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Six]
    .map(rank => card(Suit.Spade, rank));
  const threeToEight = [Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven, Rank.Eight]
    .map(rank => card(Suit.Spade, rank));
  assert.equal(identifyCardType(twoToSix, Suit.Spade), null);
  assert.equal(identifyCardType(threeToEight, Suit.Spade), null);
});

test('跟牌不强制匹配对子或三张结构，只要类别跟足、张数正确', () => {
  const mainSuit = Suit.Heart;
  // 首家出梅花对子
  const lead = copies(2, Suit.Club, Rank.Four);
  // 跟牌者有梅花但没有对子，出两张单张梅花合法
  const hand = [card(Suit.Club, Rank.Five), card(Suit.Club, Rank.Six), card(Suit.Spade, Rank.Ace)];
  const played = [card(Suit.Club, Rank.Five), card(Suit.Club, Rank.Six)];
  assert.equal(checkFollow(lead, played, hand, mainSuit), true);
});

test('首家出主牌时，有主必须跟主，不能用副牌凑数', () => {
  const mainSuit = Suit.Heart;
  // 首家出方块2（2是常主，属于主牌）
  const lead = [card(Suit.Diamond, Rank.Two)];
  const hand = [card(Suit.Heart, Rank.Four), card(Suit.Diamond, Rank.Four)];
  // 出方块4（非主）不合法，必须跟红桃4（主）
  assert.equal(checkFollow(lead, [card(Suit.Diamond, Rank.Four)], hand, mainSuit), false);
  assert.equal(checkFollow(lead, [card(Suit.Heart, Rank.Four)], hand, mainSuit), true);
});

test('首家出副牌花色时，有该花色必须跟足，不足才能垫牌', () => {
  const mainSuit = Suit.Heart;
  const lead = copies(3, Suit.Club, Rank.Four);
  // 只有1张梅花，必须出那张梅花，其余2张可任意垫
  const hand = [card(Suit.Club, Rank.Five), card(Suit.Spade, Rank.Six), card(Suit.Spade, Rank.Seven)];
  const played = [card(Suit.Club, Rank.Five), card(Suit.Spade, Rank.Six), card(Suit.Spade, Rank.Seven)];
  assert.equal(checkFollow(lead, played, hand, mainSuit), true);
  // 不出梅花直接垫3张黑桃不合法
  const noFollow = [card(Suit.Spade, Rank.Six), card(Suit.Spade, Rank.Seven), card(Suit.Spade, Rank.Eight)];
  assert.equal(checkFollow(lead, noFollow, hand, mainSuit), false);
});

test('同花色才能组成对子和拖拉机', () => {
  // 不同花色同点数不算对子
  assert.equal(identifyCardType([card(Suit.Heart, Rank.Four), card(Suit.Spade, Rank.Four)], Suit.Heart), null);
  // 同花色同点数才是对子
  assert.equal(identifyCardType(copies(2, Suit.Heart, Rank.Four), Suit.Heart), CardType.Pair);
});

test('拖拉机允许AA+22、22+33和天王对子参与', () => {
  const kingAce = [
    ...copies(2, Suit.Heart, Rank.King),
    ...copies(2, Suit.Heart, Rank.Ace),
  ];
  const aceTwo = [
    ...copies(2, Suit.Heart, Rank.Ace),
    ...copies(2, Suit.Heart, Rank.Two),
  ];
  const twoThree = [
    ...copies(2, Suit.Heart, Rank.Two),
    ...copies(2, Suit.Heart, Rank.Three),
  ];

  assert.equal(identifyCardType(kingAce, Suit.Heart), CardType.Tractor);
  assert.equal(identifyCardType(aceTwo, Suit.Heart), CardType.Tractor);
  assert.equal(identifyCardType(twoThree, Suit.Heart), CardType.Tractor);
  assert.ok(comparePattern(kingAce, aceTwo, Suit.Heart) > 0);
  assert.ok(comparePattern(aceTwo, twoThree, Suit.Heart) > 0);
});

test('拖拉机按牌面组合比较：55+44 大于 44+33 大于 33+22', () => {
  const tractor = (high: number, low: number) => [
    ...copies(2, Suit.Heart, high),
    ...copies(2, Suit.Heart, low),
  ];
  const fiveFour = tractor(Rank.Five, Rank.Four);
  const fourThree = tractor(Rank.Four, Rank.Three);
  const threeTwo = tractor(Rank.Three, Rank.Two);

  assert.ok(comparePattern(fiveFour, fourThree, Suit.Heart) > 0);
  assert.ok(comparePattern(fourThree, threeTwo, Suit.Heart) > 0);
});

test('不同结构和不同张数不能互相压制', () => {
  const triple = copies(3, Suit.Club, Rank.Four);
  const pair = copies(2, Suit.Heart, Rank.Three);
  const straightFive = [Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven]
    .map(rank => card(Suit.Spade, rank));
  const straightSix = [...straightFive, card(Suit.Spade, Rank.Eight)];

  assert.equal(comparePattern(pair, triple, Suit.Heart), -1);
  assert.equal(comparePattern(straightSix, straightFive, Suit.Heart), -1);
});

test('等级按叫分计算：达到叫分后每45分加一级，封顶4级', () => {
  // 叫80分
  assert.equal(getScoreLevel(79, 80), 0);
  assert.equal(getScoreLevel(80, 80), 1);
  assert.equal(getScoreLevel(124, 80), 1);
  assert.equal(getScoreLevel(125, 80), 2);
  assert.equal(getScoreLevel(170, 80), 3);
  // 叫105分
  assert.equal(getScoreLevel(104, 105), 0);
  assert.equal(getScoreLevel(105, 105), 1);
  assert.equal(getScoreLevel(150, 105), 2);
  assert.equal(getScoreLevel(195, 105), 3);
  assert.equal(getScoreLevel(240, 105), 4);
  // 叫40分
  assert.equal(getScoreLevel(40, 40), 1);
  assert.equal(getScoreLevel(85, 40), 2);
  assert.equal(getScoreLevel(130, 40), 3);
  assert.equal(getScoreLevel(175, 40), 4);
  assert.equal(getScoreLevel(220, 40), 4);
});

const noDig = { success:false,bottomTaken:false,tianWangCount:0,bigJokerCount:0,smallJokerCount:0,guaranteeLevel:0,opponentWonLastTrick:false };

test('一个天王挖底保底3级，底牌分计入后按分数级取高，封顶4级', () => {
  const dig = evaluateDig(1, 3, copies(1, Suit.Heart, Rank.Three), Suit.Heart);
  assert.equal(dig.success, true);
  assert.equal(dig.tianWangCount, 1);
  assert.equal(dig.guaranteeLevel, 3);

  // 各墩抓分60 + 底牌分0 = 60，未达125，按保底3级
  let r = calculateOpponentLevel({ opponentScore: 60, callScore: 105, deckCount: 2, dig });
  assert.equal(r.opponentWon, true);
  assert.equal(r.scoreLevel, 0);
  assert.equal(r.finalLevel, 3);

  // 各墩抓分170，分数级=2，仍按保底3级
  r = calculateOpponentLevel({ opponentScore: 170, callScore: 105, deckCount: 2, dig });
  assert.equal(r.scoreLevel, 2);
  assert.equal(r.finalLevel, 3);

  // 各墩抓分220，分数级=3，等于保底3级
  r = calculateOpponentLevel({ opponentScore: 220, callScore: 105, deckCount: 2, dig });
  assert.equal(r.scoreLevel, 3);
  assert.equal(r.finalLevel, 3);

  // 各墩抓分270，分数级=4，封顶4级
  r = calculateOpponentLevel({ opponentScore: 270, callScore: 105, deckCount: 2, dig });
  assert.equal(r.scoreLevel, 4);
  assert.equal(r.finalLevel, 4);
});

test('双天王或三天王挖底直接封顶4级', () => {
  const two = evaluateDig(1, 3, copies(2, Suit.Heart, Rank.Three), Suit.Heart);
  assert.equal(two.guaranteeLevel, 4);
  assert.equal(calculateOpponentLevel({ opponentScore: 40, callScore: 105, deckCount: 2, dig: two }).finalLevel, 4);
});

test('大小王挖底（无天王）保底1级加分数级', () => {
  const big = evaluateDig(1, 3, [card(Suit.BigJoker, Rank.BigJoker)], Suit.Heart);
  assert.equal(big.success, true);
  assert.equal(big.guaranteeLevel, 1);
  let r = calculateOpponentLevel({ opponentScore: 50, callScore: 105, deckCount: 2, dig: big });
  assert.equal(r.opponentWon, true);
  assert.equal(r.finalLevel, 1);
  r = calculateOpponentLevel({ opponentScore: 170, callScore: 105, deckCount: 2, dig: big });
  assert.equal(r.finalLevel, 2);
});

test('闲家用普通牌赢最后一墩：底牌分照样计入，但没有保底级', () => {
  const dig = evaluateDig(1, 3, [card(Suit.Spade, Rank.Nine)], Suit.Heart);
  // 没有天王/大小王 -> 没有保底级
  assert.equal(dig.success, false);
  assert.equal(dig.guaranteeLevel, 0);
  // 但闲家赢下了最后一墩 -> 底牌分归闲家
  assert.equal(dig.bottomTaken, true);
  // 赢了最后一墩但没王，只能靠总分（已含底牌分）达叫分才赢
  const r = calculateOpponentLevel({ opponentScore: 130, callScore: 105, deckCount: 2, dig });
  assert.equal(r.opponentWon, true);
  assert.equal(r.scoreLevel, 1);
  assert.equal(r.finalLevel, 1);
  // 总分不够叫分时，即便拿了底牌分也算庄家赢
  const lose = calculateOpponentLevel({ opponentScore: 100, callScore: 105, deckCount: 2, dig });
  assert.equal(lose.opponentWon, false);
  assert.equal(lose.finalLevel, 0);
});

test('庄家赢最后一墩：底牌分作废，闲家拿不到', () => {
  const dig = evaluateDig(3, 3, [card(Suit.Heart, Rank.Ace)], Suit.Heart);
  assert.equal(dig.bottomTaken, false);
  assert.equal(dig.success, false);
});

test('天王/大小王赢最后一墩：底牌分计入且拿到保底级', () => {
  const tw = evaluateDig(1, 3, copies(1, Suit.Heart, Rank.Three), Suit.Heart);
  assert.equal(tw.bottomTaken, true);
  assert.equal(tw.success, true);
  assert.equal(tw.guaranteeLevel, 3);
  const joker = evaluateDig(1, 3, [card(Suit.BigJoker, Rank.BigJoker)], Suit.Heart);
  assert.equal(joker.bottomTaken, true);
  assert.equal(joker.guaranteeLevel, 1);
});

test('庄家赢最后一墩不挖底', () => {
  const dig = evaluateDig(3, 3, [card(Suit.Heart, Rank.Ace)], Suit.Heart);
  assert.equal(dig.success, false);
  assert.equal(dig.opponentWonLastTrick, false);
});

test('闲家未达叫分且没挖底则庄家赢，按抓分分档定级', () => {
  const r = calculateOpponentLevel({ opponentScore: 60, callScore: 105, deckCount: 2, dig: noDig });
  assert.equal(r.opponentWon, false);
  assert.equal(r.finalLevel, 0);
  assert.equal(getBankerWinLevel(0), 4);
  assert.equal(getBankerWinLevel(40), 2);
  assert.equal(getBankerWinLevel(45), 1);
  assert.equal(getBankerWinLevel(100), 1);
});

test('庄家剩牌中的5、10、K均按原始分值计入一次', () => {
  const bankerRemainingCards = [
    card(Suit.Spade, Rank.Five),
    card(Suit.Heart, Rank.Ten),
    card(Suit.Club, Rank.King),
    card(Suit.Diamond, Rank.Ace),
  ];
  assert.equal(calcTrickScore(bankerRemainingCards), 25);
});

test('流局按主牌最多者作为庄家并零和输一级', () => {
  assert.deepEqual(createFlowBreakDeltas([2, 5, 1, 3]), [1, -3, 1, 1]);
  // 并列最多时取座位顺序靠前者作为唯一庄家，保证零和
  assert.deepEqual(createFlowBreakDeltas([4, 4, 1]), [-2, 1, 1]);
  assert.deepEqual(createFlowBreakDeltas([1, 4, 4, 0]), [1, -3, 1, 1]);
});

test('4人局三级采用零和级别结算', () => {
  assert.deepEqual(createLevelDeltas(4, 1, false, 3), [3, -9, 3, 3]);
  assert.deepEqual(createLevelDeltas(4, 1, true, 3), [-3, 9, -3, -3]);
});


// ===== 新增牌型：多组连对 / 连三张 / 王组合 =====

test('连对：2组起成立，组数不限，允许 K-A-2-3 跨接', () => {
  const two   = [...copies(2, Suit.Spade, Rank.Three), ...copies(2, Suit.Spade, Rank.Four)];
  const three = [...two, ...copies(2, Suit.Spade, Rank.Five)];
  const four  = [...three, ...copies(2, Suit.Spade, Rank.Six)];
  for (const set of [two, three, four]) {
    assert.equal(isTractor(set, Suit.Spade), true);
    assert.equal(identifyCardType(set, Suit.Spade), CardType.Tractor);
  }
  // 跨接
  assert.equal(isTractor([...copies(2, Suit.Spade, Rank.Ace), ...copies(2, Suit.Spade, Rank.Two)], Suit.Spade), true);
  assert.equal(isTractor([...copies(2, Suit.Spade, Rank.Two), ...copies(2, Suit.Spade, Rank.Three)], Suit.Spade), true);
  // 不连续 / 跨花色不成立
  assert.equal(isTractor([...copies(2, Suit.Spade, Rank.Three), ...copies(2, Suit.Spade, Rank.Five)], Suit.Spade), false);
  assert.equal(isTractor([...copies(2, Suit.Spade, Rank.Three), ...copies(2, Suit.Heart, Rank.Four)], Suit.Spade), false);
});

/**
 * 「跳过 7」的连对在任何主牌下都不成立。
 *
 * 由来：用户核对规则文档时抓出一处错误 —— 文档原先写「主是♦时
 * ♦6♦6+♦7♦7 和 ♦6♦6+♦8♦8 都成立」。前者对（整手都是主牌，不混组），
 * 后者错：6 和 8 之间跳过了 7，点数本身就不连续，跟主牌是什么无关。
 * 代码行为一直是对的，是文档写错了。这里把它锁死，
 * 避免以后有人照着错文档去"修"代码。
 */
test('连对跳过7：不论主牌是什么都不成立，而 66+77 只在主=♦ 时成立', () => {
  const skip7 = [...copies(2, Suit.Diamond, Rank.Six), ...copies(2, Suit.Diamond, Rank.Eight)];
  const with7 = [...copies(2, Suit.Diamond, Rank.Six), ...copies(2, Suit.Diamond, Rank.Seven)];

  // 跳过 7 —— 四种主花色全试一遍，一个都不能成立
  for (const main of [Suit.Spade, Suit.Heart, Suit.Diamond, Suit.Club]) {
    assert.equal(
      isTractor(skip7, main), false,
      `♦6♦6+♦8♦8 在主=${main} 时也必须不成立：中间跳过 7，点数不连续`,
    );
    assert.equal(identifyCardType(skip7, main), null);
  }

  // 含 7 的那组：主=♦ 时整手都是主牌，成立；主=♠ 时 ♦7 是常主而 ♦6 是副牌，混组不成立
  assert.equal(isTractor(with7, Suit.Diamond), true, '主=♦ 时 ♦6♦6+♦7♦7 应成立');
  assert.equal(identifyCardType(with7, Suit.Diamond), CardType.Tractor);
  assert.equal(isTractor(with7, Suit.Spade), false, '主=♠ 时 ♦6♦6+♦7♦7 混主副，不成立');
});

test('连三张：333+444 起成立，可多组，如 333+444+555+666', () => {
  const two  = [...copies(3, Suit.Spade, Rank.Three), ...copies(3, Suit.Spade, Rank.Four)];
  const four = [...two, ...copies(3, Suit.Spade, Rank.Five), ...copies(3, Suit.Spade, Rank.Six)];
  assert.equal(isTripleRun(two, Suit.Spade), true);
  assert.equal(identifyCardType(two, Suit.Spade), CardType.TripleRun);
  assert.equal(isTripleRun(four, Suit.Spade), true);
  assert.equal(identifyCardType(four, Suit.Spade), CardType.TripleRun);
  // 不连续 / 跨花色 / 张数不齐（3+2）不成立
  assert.equal(isTripleRun([...copies(3, Suit.Spade, Rank.Three), ...copies(3, Suit.Spade, Rank.Five)], Suit.Spade), false);
  assert.equal(isTripleRun([...copies(3, Suit.Spade, Rank.Three), ...copies(3, Suit.Heart, Rank.Four)], Suit.Spade), false);
  assert.equal(isTripleRun([...copies(3, Suit.Spade, Rank.Three), ...copies(2, Suit.Spade, Rank.Four)], Suit.Spade), false);
});

test('连三张比较：444+555 大于 333+444，与连对同口径', () => {
  const r345 = [...copies(3, Suit.Spade, Rank.Four), ...copies(3, Suit.Spade, Rank.Five)];
  const r334 = [...copies(3, Suit.Spade, Rank.Three), ...copies(3, Suit.Spade, Rank.Four)];
  assert.equal(comparePattern(r345, r334, Suit.Heart) > 0, true);
  assert.equal(comparePattern(r334, r345, Suit.Heart) > 0, false);
});

test('王组合：大小王等量成立（大对+小对、三大+三小），不等量不成立', () => {
  const pairCombo = [...copies(2, Suit.BigJoker, Rank.BigJoker), ...copies(2, Suit.SmallJoker, Rank.SmallJoker)];
  const tripleCombo = [...copies(3, Suit.BigJoker, Rank.BigJoker), ...copies(3, Suit.SmallJoker, Rank.SmallJoker)];
  assert.equal(isJokerCombo(pairCombo), true);
  assert.equal(identifyCardType(pairCombo, Suit.Spade), CardType.JokerCombo);
  assert.equal(isJokerCombo(tripleCombo), true);
  assert.equal(identifyCardType(tripleCombo, Suit.Spade), CardType.JokerCombo);
  // 不等量 / 全同一种王 / 混入普通牌都不成立
  assert.equal(isJokerCombo([...copies(2, Suit.BigJoker, Rank.BigJoker), ...copies(1, Suit.SmallJoker, Rank.SmallJoker)]), false);
  assert.equal(isJokerCombo(copies(4, Suit.BigJoker, Rank.BigJoker)), false);
  assert.equal(isJokerCombo([...copies(2, Suit.BigJoker, Rank.BigJoker), ...copies(2, Suit.Spade, Rank.Ace)]), false);
});

test('王组合压制：同张数下压主花色连对，反之压不过', () => {
  const jokers = [...copies(2, Suit.BigJoker, Rank.BigJoker), ...copies(2, Suit.SmallJoker, Rank.SmallJoker)];
  // 主=黑桃，黑桃33+44 是主花色连对
  const mainTractor = [...copies(2, Suit.Spade, Rank.Three), ...copies(2, Suit.Spade, Rank.Four)];
  assert.equal(comparePattern(jokers, mainTractor, Suit.Spade) > 0, true);
  assert.equal(comparePattern(mainTractor, jokers, Suit.Spade) > 0, false);
});

test('张数不同的牌型永远不能互压（连三张 6 张 vs 连对 4 张）', () => {
  const run = [...copies(3, Suit.Spade, Rank.Three), ...copies(3, Suit.Spade, Rank.Four)];
  const tractor = [...copies(2, Suit.Spade, Rank.Three), ...copies(2, Suit.Spade, Rank.Four)];
  assert.equal(comparePattern(run, tractor, Suit.Spade), -1);
  assert.equal(comparePattern(tractor, run, Suit.Spade), -1);
});

test('叫分基准分：两副牌125，三副牌145', () => {
  assert.equal(GAME_MODES.fourPlayerTwoDecks.fullLevelScore, 125);
  assert.equal(GAME_MODES.threePlayerTwoDecks.fullLevelScore, 125);
  assert.equal(GAME_MODES.fourPlayerThreeDecks.fullLevelScore, 145);
  assert.equal(GAME_MODES.sixPlayerThreeDecks.fullLevelScore, 145);
  // 叫分上限跟随基准分，不再写死 105
  assert.equal(GAME_CONFIG.callScoreMax, 125);
});

// ===== 用户已确认的三条结算口径（防止以后被误改） =====

test('确认口径1：庄家赢的级数只看闲家抓分，与叫分完全无关', () => {
  // 前提：先要判定成"庄家赢"（闲家没达到叫分、也没拿保底级），
  // 才轮到 getBankerWinLevel 定级。注意叫40分时闲家抓40分已经达标，
  // 那是闲家赢，不走这条路径。
  for (const callScore of [60, 95, 125, 145]) {
    // 闲家0分 -> 庄家赢4级
    let r = calculateOpponentLevel({ opponentScore: 0, callScore, deckCount: 2, dig: noDig });
    assert.equal(r.opponentWon, false, `叫${callScore}分时闲家0分应该庄家赢`);
    assert.equal(getBankerWinLevel(0), 4);
    // 闲家40分（未达这些叫分）-> 庄家赢2级，级数与叫分无关
    r = calculateOpponentLevel({ opponentScore: 40, callScore, deckCount: 2, dig: noDig });
    assert.equal(r.opponentWon, false);
    assert.equal(getBankerWinLevel(40), 2);
  }
  // 叫分低到40时，闲家抓40分就达标了，属于闲家赢1级而不是庄家赢
  const lowBid = calculateOpponentLevel({ opponentScore: 40, callScore: 40, deckCount: 2, dig: noDig });
  assert.equal(lowBid.opponentWon, true, '叫40分时闲家抓满40分应该闲家赢');
  assert.equal(lowBid.finalLevel, 1);
  // 边界：0分和1分是不同档（4级 vs 2级）
  assert.equal(getBankerWinLevel(0), 4);
  assert.equal(getBankerWinLevel(1), 2);
  // 边界：40分和41分是不同档（2级 vs 1级）
  assert.equal(getBankerWinLevel(40), 2);
  assert.equal(getBankerWinLevel(41), 1);
  // 41分以上一律1级，不再随分数变化
  assert.equal(getBankerWinLevel(199), 1);
});

test('确认口径2：分数级的步长起点是叫分本身，不是基准分125/145', () => {
  // 叫分越低，闲家越容易升级——步长起点跟着叫分走，而不是固定从125起算
  assert.equal(getScoreLevel(60, 60), 1, '叫60分时闲家60分就达标1级');
  assert.equal(getScoreLevel(60, 125), 0, '叫125分时闲家60分不达标');
  // 同一个闲家分数，叫分不同则级数不同
  assert.equal(getScoreLevel(150, 40), 3);
  assert.equal(getScoreLevel(150, 105), 2);
  assert.equal(getScoreLevel(150, 145), 1);
  // 基准分125并不参与分数级计算：叫40分时闲家85分就2级，远低于125
  assert.equal(getScoreLevel(85, 40), 2);
});

test('确认口径3：最终级数 = max(分数级, 保底级)，不是相加', () => {
  const oneTianWang = evaluateDig(1, 3, copies(1, Suit.Heart, Rank.Three), Suit.Heart);
  assert.equal(oneTianWang.guaranteeLevel, 3);

  // 分数级1 + 保底级3：取max=3，不是相加的4
  let r = calculateOpponentLevel({ opponentScore: 95, callScore: 95, deckCount: 2, dig: oneTianWang });
  assert.equal(r.scoreLevel, 1);
  assert.equal(r.digLevel, 3);
  assert.equal(r.finalLevel, 3, 'max(1,3)=3，不是1+3=4');

  // 分数级4 + 保底级3：取max=4，不是相加的7（也不会超过封顶4）
  r = calculateOpponentLevel({ opponentScore: 230, callScore: 95, deckCount: 2, dig: oneTianWang });
  assert.equal(r.scoreLevel, 4);
  assert.equal(r.digLevel, 3);
  assert.equal(r.finalLevel, 4, 'max(4,3)=4，不是4+3=7');

  // 仅大王保底1级：分数级2时取max=2，保底级不额外加成
  const jokerOnly = evaluateDig(1, 3, [card(Suit.BigJoker, Rank.BigJoker)], Suit.Heart);
  assert.equal(jokerOnly.guaranteeLevel, 1);
  r = calculateOpponentLevel({ opponentScore: 140, callScore: 95, deckCount: 2, dig: jokerOnly });
  assert.equal(r.scoreLevel, 2);
  assert.equal(r.digLevel, 1);
  assert.equal(r.finalLevel, 2, 'max(2,1)=2，不是2+1=3');
});
