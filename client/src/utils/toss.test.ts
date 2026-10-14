// 甩牌客户端预校验单测。
// 与服务端 server/src/logic/toss.test.ts 的同门规则保持一致；
// 「能不能甩成」只看别人压不压得住，客户端看不到别人手牌，由服务端负责。
//
// ⚠️ 本地【不】校验牌力大小。曾经有过「甩出的必须是自己该门最大的若干张」
// 这条限制，那是把「最大」误解成"自己手里最大"，而规则里指的是**别人压不起**。
// 甩牌只为提高出牌效率，留着 A 先甩 K+Q 是合法的。下面几条测试专门钉住这点，
// 防止那条限制被"顺手加回来"。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { precheckToss, getTossGroup, isSameGroup, isInGroup } from './toss';
import type { Card, Suit, Rank } from '../types';

let i = 0;
const c = (suit: Suit, rank: Rank): Card => ({ id: `t${i++}`, suit, rank });
const MAIN: Suit = 'heart';
const bigJoker = () => c('joker', 'big_joker');
const tianWang = () => c('heart', '3');   // 主花色3 = 天王

describe('门划分（与服务端一致）', () => {
  it('主花色牌 / 常主7和2 / 天王 / 大小王 都属主牌门', () => {
    for (const card of [c('heart', 'A'), c('spade', '7'), c('club', '2'), tianWang(), bigJoker()]) {
      assert.deepEqual(getTossGroup(card, MAIN), { kind: 'main' });
    }
  });

  it('非主花色普通牌按花色分门', () => {
    assert.deepEqual(getTossGroup(c('spade', 'A'), MAIN), { kind: 'suit', suit: 'spade' });
  });

  it('副7属于主牌门，不属其原花色门', () => {
    const sub7 = c('spade', '7');
    assert.equal(isInGroup(sub7, { kind: 'main' }, MAIN), true);
    assert.equal(isInGroup(sub7, { kind: 'suit', suit: 'spade' }, MAIN), false);
  });

  it('主牌门与副牌门永不相同', () => {
    assert.equal(isSameGroup({ kind: 'main' }, { kind: 'suit', suit: 'spade' }), false);
    assert.equal(isSameGroup({ kind: 'suit', suit: 'spade' }, { kind: 'suit', suit: 'club' }), false);
  });
});

describe('precheckToss', () => {
  it('跟牌的人不能甩，原因要说清是"本墩先出牌的人"才行', () => {
    const hand = [c('spade', 'A'), c('spade', 'K')];
    const r = precheckToss(hand, hand, MAIN, false);
    assert.equal(r.ok, false);
    // 不断言「首家」二字：玩家会把它理解成"整局第一个出牌的人"，
    // 而规则是每一墩的领出者都能甩。文案必须点明「本墩」这个限定。
    assert.match(r.reason!, /本墩/);
    assert.match(r.reason!, /甩/);
  });

  it('少于 2 张不算甩牌', () => {
    const one = [c('spade', 'A')];
    const r = precheckToss(one, one, MAIN, true);
    assert.equal(r.ok, false);
    assert.match(r.reason!, /2 张/);
  });

  it('跨门被拦下', () => {
    const a = c('spade', 'A'), b = c('club', 'A');
    const r = precheckToss([a, b], [a, b], MAIN, true);
    assert.equal(r.ok, false);
    assert.match(r.reason!, /同一门/);
  });

  it('副牌与常主混甩被拦下（副7是主牌门）', () => {
    const spadeAce = c('spade', 'A'), spade7 = c('spade', '7');
    const r = precheckToss([spadeAce, spade7], [spadeAce, spade7], MAIN, true);
    assert.equal(r.ok, false);
    assert.match(r.reason!, /同一门/);
  });

  it('手上留着更大的同门牌，照样可以甩（本地不能拦）', () => {
    /* 用户原话：「甩牌不是要选择自己同花色最大的甩，可以选择小的。
     * 最大的是指对家打不起的牌，不是指自己的牌大小。」
     * 所以留着 A 只甩 K+Q 必须放行 —— 能不能甩成由服务端看别人手牌决定。 */
    const ace = c('spade', 'A'), king = c('spade', 'K'), queen = c('spade', 'Q');
    const r = precheckToss([king, queen], [ace, king, queen], MAIN, true);
    assert.equal(r.ok, true, '留着更大的牌不该被客户端拦下');
    assert.equal(r.reason, undefined);
  });

  it('甩该门最大的若干张通过预校验', () => {
    const ace = c('spade', 'A'), king = c('spade', 'K'), small = c('spade', '4');
    const r = precheckToss([ace, king], [ace, king, small], MAIN, true);
    assert.equal(r.ok, true);
    assert.equal(r.reason, undefined);
  });

  it('多副牌下不必把等大的牌一起甩', () => {
    // 两张黑桃A，只甩一张 + K 也合法：能不能甩成跟"自己留了什么"无关
    const ace1 = c('spade', 'A'), ace2 = c('spade', 'A'), king = c('spade', 'K');
    assert.equal(precheckToss([ace1, king], [ace1, ace2, king], MAIN, true).ok, true);
    assert.equal(precheckToss([ace1, ace2], [ace1, ace2, king], MAIN, true).ok, true);
  });

  it('其他门有更大的牌不影响本门甩牌资格', () => {
    const sa = c('spade', 'A'), sk = c('spade', 'K');
    const hand = [sa, sk, bigJoker(), c('club', 'A')];
    assert.equal(precheckToss([sa, sk], hand, MAIN, true).ok, true);
  });

  it('主牌门可跨花色甩（天王+大王同门）', () => {
    const tw = tianWang(), bj = bigJoker();
    const r = precheckToss([tw, bj], [tw, bj, c('heart', '4')], MAIN, true);
    assert.equal(r.ok, true);
  });

  it('门划分口径正确：副2 是常主不算副花色门，留着它甩 A+K 合法', () => {
    const two = c('spade', '2'), ace = c('spade', 'A'), king = c('spade', 'K');
    // 2 是常主，属主牌门，所以这里 2 不在黑桃门 -> 甩 A+K 合法
    const r = precheckToss([ace, king], [two, ace, king], MAIN, true);
    assert.equal(r.ok, true, '副2 是常主不算黑桃门，不应阻止黑桃门甩牌');
  });

  it('留着天王只甩大王+小王也合法（主牌门同样不看自己手里大小）', () => {
    const tw = tianWang(), bj = bigJoker(), sj = c('joker', 'small_joker');
    const r = precheckToss([bj, sj], [tw, bj, sj], MAIN, true);
    assert.equal(r.ok, true, '主牌门也不该按"自己手里最大"来拦');
  });

  it('预校验只拦这三种：跟牌 / 不足2张 / 跨门（不许再多拦）', () => {
    /* 这条是防回归的总闸：客户端多拦一层的代价是"明明能甩却按不动"，
     * 比让服务端回一句"被某家压住了"糟糕得多。 */
    const hand = [c('spade', 'A'), c('spade', 'K'), c('spade', 'Q'), c('club', '5')];
    const reasons = new Set<string>();
    // 各种"自己手里还留着更大牌"的组合，一律必须放行
    for (const pick of [[1, 2], [2, 3], [1, 3]]) {
      const cards = pick.map(i => hand[i]).filter(x => x.suit === 'spade');
      if (cards.length < 2) continue;
      const r = precheckToss(cards, hand, MAIN, true);
      if (!r.ok) reasons.add(r.reason ?? '?');
    }
    assert.deepEqual([...reasons], [], `不该有任何拒绝理由，实际：${[...reasons]}`);
  });

  it('主花色未定时，只有常主算主牌门', () => {
    const spade7 = c('spade', '7'), club2 = c('club', '2');
    // 主未定：7 和 2 仍是常主，同属主牌门
    const r = precheckToss([spade7, club2], [spade7, club2], null, true);
    assert.equal(r.ok, true);
  });
});
