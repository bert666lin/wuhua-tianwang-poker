// 客户端牌型识别单测。
// 这些用例锁的是「客户端标签与服务端判定一致」这个契约 —— 一旦标签比服务端
// 宽松，玩家照着标签出牌会被服务端打回，比不标更糟。
// 边界全部照 server/src/logic/compare.ts 的 isConsecutiveGroups 取。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { identifyPattern, isTractor, isTripleRun, isJokerCombo, describeSelection } from './pattern';
import type { Card, Suit, Rank } from '../types';

let seq = 0;
const c = (suit: Suit, rank: Rank): Card => ({ suit, rank, id: `${suit}-${rank}-${seq++}` });
/** 同花色同点数一对 */
const pair = (suit: Suit, rank: Rank): Card[] => [c(suit, rank), c(suit, rank)];
const triple = (suit: Suit, rank: Rank): Card[] => [c(suit, rank), c(suit, rank), c(suit, rank)];

describe('identifyPattern 基础牌型', () => {
  it('单张 / 对子 / 三张', () => {
    assert.equal(identifyPattern([c('spade', '5')], 'spade'), 'single');
    assert.equal(identifyPattern(pair('spade', '5'), 'spade'), 'pair');
    assert.equal(identifyPattern(triple('spade', '5'), 'spade'), 'triple');
  });

  it('两张不同牌不是对子（返回 null，不能编成对子）', () => {
    assert.equal(identifyPattern([c('spade', '5'), c('heart', '5')], 'spade'), null);
  });

  it('空数组无牌型', () => {
    assert.equal(identifyPattern([], 'spade'), null);
  });
});

describe('拖拉机（连对）主副归属', () => {
  // 核心回归：老的 describePattern 把这组标成「拖拉机」，但服务端会拒绝 ——
  // 主♠时 ♦7 是常主、♦6 是副牌，同花色但主副归属不同，不成型。
  it('主♠时 ♦6♦6+♦7♦7 不成立（♦7是常主，与♦6主副归属不同）', () => {
    const cards = [...pair('diamond', '6'), ...pair('diamond', '7')];
    assert.equal(isTractor(cards, 'spade'), false);
    assert.equal(identifyPattern(cards, 'spade'), null);
  });

  it('主♦时 ♦6♦6+♦7♦7 成立（都是主牌）', () => {
    const cards = [...pair('diamond', '6'), ...pair('diamond', '7')];
    assert.equal(isTractor(cards, 'diamond'), true);
  });

  it('♦6♦6+♦8♦8 跳过♦7 不连续，不成立', () => {
    const cards = [...pair('diamond', '6'), ...pair('diamond', '8')];
    assert.equal(isTractor(cards, 'diamond'), false);
    assert.equal(isTractor(cards, 'spade'), false);
  });

  it('副花色 ♥4♥4+♥5♥5 成立（都是副牌）', () => {
    assert.equal(isTractor([...pair('heart', '4'), ...pair('heart', '5')], 'spade'), true);
  });

  it('跨花色不成立', () => {
    assert.equal(isTractor([...pair('heart', '4'), ...pair('spade', '5')], 'club'), false);
  });

  it('三组连对成立：♥4♥4+♥5♥5+♥6♥6', () => {
    const cards = [...pair('heart', '4'), ...pair('heart', '5'), ...pair('heart', '6')];
    assert.equal(isTractor(cards, 'spade'), true);
    assert.equal(identifyPattern(cards, 'spade'), 'tractor');
  });

  it('K-A-2 跨接：主♥时 ♥K♥K+♥A♥A+♥2♥2 成立（同为主牌）', () => {
    const cards = [...pair('heart', 'K'), ...pair('heart', 'A'), ...pair('heart', '2')];
    assert.equal(isTractor(cards, 'heart'), true);
  });

  it('K-A-2 跨接：主♠时不成立（♥2是常主，♥K♥A是副牌）', () => {
    const cards = [...pair('heart', 'K'), ...pair('heart', 'A'), ...pair('heart', '2')];
    assert.equal(isTractor(cards, 'spade'), false);
  });

  it('大小王不能组连对', () => {
    const cards = [...pair('joker', 'big_joker'), ...pair('joker', 'small_joker')];
    assert.equal(isTractor(cards, 'spade'), false);
  });

  it('单组对子不算拖拉机（至少2组）', () => {
    assert.equal(isTractor(pair('heart', '4'), 'spade'), false);
  });

  it('张数不是每组恰好2张就不成立（♥4×3 + ♥5）', () => {
    const cards = [...triple('heart', '4'), c('heart', '5')];
    assert.equal(isTractor(cards, 'spade'), false);
  });
});

describe('连三张', () => {
  it('♥4×3 + ♥5×3 成立', () => {
    const cards = [...triple('heart', '4'), ...triple('heart', '5')];
    assert.equal(isTripleRun(cards, 'spade'), true);
    assert.equal(identifyPattern(cards, 'spade'), 'triple_run');
  });

  it('主♠时 ♦6×3 + ♦7×3 不成立（主副混组）', () => {
    const cards = [...triple('diamond', '6'), ...triple('diamond', '7')];
    assert.equal(isTripleRun(cards, 'spade'), false);
  });
});

describe('王组合', () => {
  it('大王对+小王对成立，且优先于连对判定', () => {
    const cards = [...pair('joker', 'big_joker'), ...pair('joker', 'small_joker')];
    assert.equal(isJokerCombo(cards), true);
    assert.equal(identifyPattern(cards, 'spade'), 'joker_combo');
  });

  it('大小王数量不等不成立', () => {
    const cards = [...triple('joker', 'big_joker'), c('joker', 'small_joker')];
    assert.equal(isJokerCombo(cards), false);
  });

  it('混了普通牌不成立', () => {
    const cards = [...pair('joker', 'big_joker'), ...pair('spade', '3')];
    assert.equal(isJokerCombo(cards), false);
  });
});

describe('describeSelection 标签文案', () => {
  it('连对/连三张带组数', () => {
    const t = [...pair('heart', '4'), ...pair('heart', '5'), ...pair('heart', '6')];
    assert.equal(describeSelection(t, 'spade'), '拖拉机×3');
    const r = [...triple('heart', '4'), ...triple('heart', '5')];
    assert.equal(describeSelection(r, 'spade'), '连三张×2');
  });

  it('认不出牌型时只报张数，不编牌型名', () => {
    const cards = [...pair('diamond', '6'), ...pair('diamond', '8')];
    assert.equal(describeSelection(cards, 'diamond'), '4 张');
  });

  it('空选择返回空串', () => {
    assert.equal(describeSelection([], 'spade'), '');
  });
});
