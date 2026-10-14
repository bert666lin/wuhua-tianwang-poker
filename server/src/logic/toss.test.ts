import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CardData, Rank, Suit } from './config.js';
import {
  getTossGroup, isSameGroup, isInGroup, lowestCard,
  validateToss, challengeToss, resolveToss,
} from './toss.js';

let id = 0;
const card = (suit: number, rank: number): CardData => ({ id: `toss-${id++}`, suit, rank });
const MAIN = Suit.Heart;   // 约定测试里主花色为红桃

// 常主与天王速记
const tianWang = () => card(Suit.Heart, Rank.Three);   // 主花色3 = 天王
const bigJoker = () => card(Suit.BigJoker, Rank.BigJoker);
const smallJoker = () => card(Suit.SmallJoker, Rank.SmallJoker);

describe('门（group）划分', () => {
  it('主花色牌、常主7/2、天王、大小王都算主牌一门', () => {
    const mains = [
      card(Suit.Heart, Rank.Ace),      // 主花色普通牌
      card(Suit.Spade, Rank.Seven),    // 副7 也是常主
      card(Suit.Club, Rank.Two),       // 副2 也是常主
      tianWang(), bigJoker(), smallJoker(),
    ];
    for (const c of mains) {
      assert.deepEqual(getTossGroup(c, MAIN), { kind: 'main' }, `${c.suit}-${c.rank} 应为主牌门`);
    }
  });

  it('非主花色的普通牌按花色分门', () => {
    assert.deepEqual(getTossGroup(card(Suit.Spade, Rank.Ace), MAIN), { kind: 'suit', suit: Suit.Spade });
    assert.deepEqual(getTossGroup(card(Suit.Club, Rank.Five), MAIN), { kind: 'suit', suit: Suit.Club });
  });

  it('主牌门与任何副牌门都不相同', () => {
    assert.equal(isSameGroup({ kind: 'main' }, { kind: 'suit', suit: Suit.Spade }), false);
    assert.equal(isSameGroup({ kind: 'main' }, { kind: 'main' }), true);
    assert.equal(isSameGroup({ kind: 'suit', suit: Suit.Spade }, { kind: 'suit', suit: Suit.Club }), false);
  });

  it('isInGroup 能识别副7属于主牌门而非其原花色门', () => {
    const sub7 = card(Suit.Spade, Rank.Seven);
    assert.equal(isInGroup(sub7, { kind: 'main' }, MAIN), true);
    assert.equal(isInGroup(sub7, { kind: 'suit', suit: Suit.Spade }, MAIN), false);
  });
});

describe('lowestCard', () => {
  it('按牌力取最小，而不是按点数数值', () => {
    // 副2(400) 比 副A(114) 牌力大，所以最小的是 A
    const cards = [card(Suit.Spade, Rank.Two), card(Suit.Spade, Rank.Ace)];
    assert.equal(lowestCard(cards, MAIN).rank, Rank.Ace);
  });

  it('天王/大小王参与比较时最小的是普通主花色牌', () => {
    const cards = [tianWang(), bigJoker(), card(Suit.Heart, Rank.Four)];
    assert.equal(lowestCard(cards, MAIN).rank, Rank.Four);
  });

  it('空数组抛错而不是返回 undefined', () => {
    assert.throws(() => lowestCard([], MAIN), /empty cards/);
  });
});

describe('validateToss — 甩牌资格', () => {
  it('非首家不能甩牌', () => {
    const hand = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.King)];
    const r = validateToss(hand, hand, MAIN, false);
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'not_leader');
  });

  it('单张不算甩牌（走普通出牌）', () => {
    const hand = [card(Suit.Spade, Rank.Ace)];
    const r = validateToss(hand, hand, MAIN, true);
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'too_few');
  });

  it('跨门甩牌非法', () => {
    const a = card(Suit.Spade, Rank.Ace);
    const b = card(Suit.Club, Rank.Ace);
    const r = validateToss([a, b], [a, b], MAIN, true);
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'mixed_group');
  });

  it('副牌与常主混甩非法（副7属于主牌门）', () => {
    const spadeAce = card(Suit.Spade, Rank.Ace);
    const spade7 = card(Suit.Spade, Rank.Seven);   // 常主，属主牌门
    const r = validateToss([spadeAce, spade7], [spadeAce, spade7], MAIN, true);
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'mixed_group');
  });

  it('甩不在手上的牌非法', () => {
    const inHand = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.King)];
    const ghost = card(Suit.Spade, Rank.Queen);
    const r = validateToss([inHand[0], ghost], inHand, MAIN, true);
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'not_in_hand');
  });

  it('手上留有更大的牌照样合法：「最大」指别人压不起，不是自己手里最大', () => {
    /* 用户原话：「甩牌不是要选择自己同花色最大的甩，可以选择小的。
     * 最大的是指对家打不起的牌，不是指自己的牌大小。甩牌只是提高出牌效率。」
     * 所以甩 K+Q 却留着 A 必须合法 —— 能不能甩成交给 challengeToss。 */
    const ace = card(Suit.Spade, Rank.Ace);
    const king = card(Suit.Spade, Rank.King);
    const queen = card(Suit.Spade, Rank.Queen);
    const r = validateToss([king, queen], [ace, king, queen], MAIN, true);
    assert.equal(r.valid, true, '留着 A 只甩 K+Q 不该被判非法');
    assert.equal(r.lowest?.rank, Rank.Queen, '最小牌仍是 Q（失败时要打它）');
  });

  it('甩该门最大的若干张合法，且返回最小牌', () => {
    const ace = card(Suit.Spade, Rank.Ace);
    const king = card(Suit.Spade, Rank.King);
    const small = card(Suit.Spade, Rank.Four);
    const r = validateToss([ace, king], [ace, king, small], MAIN, true);
    assert.equal(r.valid, true);
    assert.deepEqual(r.group, { kind: 'suit', suit: Suit.Spade });
    assert.equal(r.lowest?.rank, Rank.King);
  });

  it('其他门有更大的牌不影响本门甩牌资格', () => {
    const spadeAce = card(Suit.Spade, Rank.Ace);
    const spadeKing = card(Suit.Spade, Rank.King);
    const hand = [spadeAce, spadeKing, bigJoker(), card(Suit.Club, Rank.Ace)];
    const r = validateToss([spadeAce, spadeKing], hand, MAIN, true);
    assert.equal(r.valid, true);
  });

  it('多副牌下等大的牌不必一起甩', () => {
    // 两副牌里有两张黑桃A，只甩其中一张 + K 也合法：
    // 合法性跟"自己留了什么"无关，只跟别人压不压得住有关
    const ace1 = card(Suit.Spade, Rank.Ace);
    const ace2 = card(Suit.Spade, Rank.Ace);
    const king = card(Suit.Spade, Rank.King);
    const r1 = validateToss([ace1, king], [ace1, ace2, king], MAIN, true);
    assert.equal(r1.valid, true, '留下等大的另一张 A 也该合法');
    const r2 = validateToss([ace1, ace2], [ace1, ace2, king], MAIN, true);
    assert.equal(r2.valid, true);
  });

  it('主牌门可以跨花色甩（天王+大小王+主花色牌算同一门）', () => {
    const tw = tianWang();
    const bj = bigJoker();
    const hand = [tw, bj, card(Suit.Heart, Rank.Four)];
    const r = validateToss([tw, bj], hand, MAIN, true);
    assert.equal(r.valid, true);
    assert.deepEqual(r.group, { kind: 'main' });
  });
});

describe('challengeToss — 其他玩家压制判定', () => {
  const group = { kind: 'suit' as const, suit: Suit.Spade };

  it('没人有更大的牌则甩牌成功', () => {
    const toss = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.King)];
    const others = new Map([
      [1, [card(Suit.Spade, Rank.Queen), card(Suit.Club, Rank.Ace)]],
      [2, [card(Suit.Spade, Rank.Five)]],
    ]);
    const r = challengeToss(toss, group, others, MAIN);
    assert.equal(r.success, true);
    assert.deepEqual(r.blockedBy, []);
  });

  it('任意一家有一张更大即失败，并给出强制打出的最小牌', () => {
    const toss = [card(Suit.Spade, Rank.King), card(Suit.Spade, Rank.Queen)];
    const others = new Map([
      [1, [card(Suit.Spade, Rank.Five)]],
      [2, [card(Suit.Spade, Rank.Ace)]],   // A > K，压住
    ]);
    const r = challengeToss(toss, group, others, MAIN);
    assert.equal(r.success, false);
    assert.deepEqual(r.blockedBy, [2]);
    assert.equal(r.forcedCard?.rank, Rank.Queen, '强制打出所甩牌中最小的一张');
  });

  it('比较基准是所甩牌里最小的那张，而不是最大的', () => {
    const toss = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.Four)];
    // 别人有 K：K > 4（最小牌）-> 失败
    const others = new Map([[1, [card(Suit.Spade, Rank.King)]]]);
    const r = challengeToss(toss, group, others, MAIN);
    assert.equal(r.success, false);
  });

  it('其他门的大牌不构成压制', () => {
    const toss = [card(Suit.Spade, Rank.King), card(Suit.Spade, Rank.Queen)];
    const others = new Map([
      [1, [bigJoker(), card(Suit.Club, Rank.Ace)]],   // 都不是黑桃门
    ]);
    const r = challengeToss(toss, group, others, MAIN);
    assert.equal(r.success, true);
  });

  it('副7属于主牌门，不能压制黑桃门的甩牌', () => {
    const toss = [card(Suit.Spade, Rank.King), card(Suit.Spade, Rank.Queen)];
    const others = new Map([[1, [card(Suit.Spade, Rank.Seven)]]]);   // 副7 -> 主牌门
    const r = challengeToss(toss, group, others, MAIN);
    assert.equal(r.success, true, '副7 已是常主，不算黑桃门');
  });

  it('多家压制时 blockedBy 按座位升序返回全部', () => {
    const toss = [card(Suit.Spade, Rank.Five), card(Suit.Spade, Rank.Four)];
    const others = new Map([
      [3, [card(Suit.Spade, Rank.Ace)]],
      [1, [card(Suit.Spade, Rank.King)]],
      [2, [card(Suit.Club, Rank.Ace)]],
    ]);
    const r = challengeToss(toss, group, others, MAIN);
    assert.deepEqual(r.blockedBy, [1, 3]);
  });

  it('等大的牌不构成压制（必须严格更大）', () => {
    const toss = [card(Suit.Spade, Rank.Ace), card(Suit.Spade, Rank.King)];
    const others = new Map([[1, [card(Suit.Spade, Rank.King)]]]);   // 与最小牌等大
    const r = challengeToss(toss, group, others, MAIN);
    assert.equal(r.success, true);
  });
});

describe('resolveToss — 完整结算', () => {
  it('成功时原样打出所甩的牌', () => {
    const ace = card(Suit.Spade, Rank.Ace);
    const king = card(Suit.Spade, Rank.King);
    const hand = [ace, king, card(Suit.Spade, Rank.Four)];
    const others = new Map([[1, [card(Suit.Spade, Rank.Queen)]]]);
    const r = resolveToss([ace, king], hand, others, MAIN, true);
    assert.equal(r.accepted, true);
    assert.equal(r.cards.length, 2);
  });

  it('失败时只打出最小那张，本墩不额外罚分', () => {
    const king = card(Suit.Spade, Rank.King);
    const queen = card(Suit.Spade, Rank.Queen);
    const hand = [king, queen, card(Suit.Spade, Rank.Four)];
    const others = new Map([[2, [card(Suit.Spade, Rank.Ace)]]]);
    const r = resolveToss([king, queen], hand, others, MAIN, true);
    assert.equal(r.accepted, false);
    assert.equal(r.cards.length, 1);
    assert.equal(r.cards[0].rank, Rank.Queen);
    assert.deepEqual(r.blockedBy, [2]);
  });

  it('资格不符时不打出任何牌，并回传原因供服务端报错', () => {
    // 真正的"资格不符"只剩：跟牌、不足2张、跨门、牌不在手上
    const spadeAce = card(Suit.Spade, Rank.Ace);
    const clubAce = card(Suit.Club, Rank.Ace);
    const r = resolveToss([spadeAce, clubAce], [spadeAce, clubAce], new Map(), MAIN, true);
    assert.equal(r.accepted, false);
    assert.equal(r.cards.length, 0);
    assert.equal(r.reason, 'mixed_group');
  });

  it('留着更大的牌去甩，别人压不住就该成功（回归：曾被误判 not_highest）', () => {
    const ace = card(Suit.Spade, Rank.Ace);
    const king = card(Suit.Spade, Rank.King);
    const queen = card(Suit.Spade, Rank.Queen);
    // 别人黑桃只有小牌 -> 压不住 -> 甩牌成功，且 A 还留在自己手上
    const others = new Map([[1, [card(Suit.Spade, Rank.Five)]]]);
    const r = resolveToss([king, queen], [ace, king, queen], others, MAIN, true);
    assert.equal(r.accepted, true, '别人压不住就该甩成功');
    assert.equal(r.cards.length, 2);
  });

  it('没有其他玩家手牌信息时（都已出完）甩牌成功', () => {
    const ace = card(Suit.Spade, Rank.Ace);
    const king = card(Suit.Spade, Rank.King);
    const r = resolveToss([ace, king], [ace, king], new Map(), MAIN, true);
    assert.equal(r.accepted, true);
  });
});
