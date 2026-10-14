// 手牌整理排序单测。
// 「发完牌手牌太乱」的根因是 sortHand 从没被牌桌调用过，
// 这里把排序口径钉住，避免再次退化。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sortHand, sortHandByPower, getCardPower, isMainCard } from './cardUtils';
import type { Card, Suit, Rank } from '../types';

let i = 0;
const c = (suit: Suit, rank: Rank): Card => ({ id: `c${String(i++).padStart(3, '0')}`, suit, rank });
const MAIN: Suit = 'heart';
/** 便于断言的可读牌名 */
const name = (card: Card) => `${card.suit}${card.rank}`;
const names = (cards: Card[]) => cards.map(name);

describe('sortHand 主牌堆在前', () => {
  it('主牌（含王/所有花色7和2/主花色牌）全部排在副牌之前', () => {
    const hand = [
      c('spade', 'A'), c('heart', '5'), c('club', '2'), c('diamond', 'K'),
      c('joker', 'small_joker'), c('spade', '7'), c('club', '9'),
    ];
    const sorted = sortHand(hand, MAIN);
    const firstSubIndex = sorted.findIndex(card => !isMainCard(card, MAIN));
    // 第一张副牌之后不允许再出现主牌
    assert.ok(firstSubIndex > 0);
    assert.ok(sorted.slice(firstSubIndex).every(card => !isMainCard(card, MAIN)));
  });

  it('主牌堆内次序：天王 > 大王 > 小王 > 主7 > 副7 > 主2 > 副2 > 主花色其余牌', () => {
    const hand = [
      c('heart', '4'), c('spade', '2'), c('heart', '2'), c('spade', '7'),
      c('heart', '7'), c('joker', 'small_joker'), c('joker', 'big_joker'),
      c('heart', '3'), c('heart', 'A'),
    ];
    assert.deepEqual(names(sortHand(hand, MAIN)), [
      'heart3',            // 天王（主花色3）
      'jokerbig_joker',
      'jokersmall_joker',
      'heart7',            // 主7
      'spade7',            // 副7
      'heart2',            // 主2
      'spade2',            // 副2
      'heartA',            // 主花色其余牌按点数降序
      'heart4',
    ]);
  });
});

describe('sortHand 副牌按花色分堆', () => {
  it('同花色的副牌必须连续，不被别的花色插开', () => {
    const hand = [
      c('spade', 'A'), c('club', 'K'), c('spade', '5'),
      c('diamond', '9'), c('club', '4'), c('spade', 'J'),
    ];
    const sorted = sortHand(hand, MAIN).filter(card => !isMainCard(card, MAIN));
    const seen: Suit[] = [];
    for (const card of sorted) {
      if (seen[seen.length - 1] !== card.suit) seen.push(card.suit);
    }
    // 每种花色只应出现一段
    assert.deepEqual(seen, [...new Set(seen)]);
  });

  it('每堆内部牌力从大到小', () => {
    const hand = [c('spade', '5'), c('spade', 'A'), c('spade', '10'), c('spade', 'K')];
    assert.deepEqual(names(sortHand(hand, MAIN)), ['spadeA', 'spadeK', 'spade10', 'spade5']);
  });

  it('花色堆次序固定为 黑桃 → 红桃 → 梅花 → 方块（主花色堆不在此列）', () => {
    const hand = [c('diamond', '4'), c('club', '4'), c('spade', '4')];
    // 主花色设为红桃时，红桃已并入主牌堆
    assert.deepEqual(names(sortHand(hand, MAIN)), ['spade4', 'club4', 'diamond4']);
  });
});

describe('sortHand 稳定性', () => {
  it('输入顺序不同，输出必须一致（多副牌同点同花色等价牌不能跳动）', () => {
    const build = (): Card[] => {
      i = 0;
      return [
        c('spade', 'A'), c('spade', 'A'), c('heart', '7'), c('club', '7'),
        c('diamond', '7'), c('spade', '7'), c('club', '2'), c('diamond', '2'),
        c('heart', 'K'), c('club', '10'),
      ];
    };
    const a = sortHand(build(), MAIN);
    const b = sortHand([...build()].reverse(), MAIN);
    assert.deepEqual(a.map(x => x.id), b.map(x => x.id));
  });

  it('四门副7不同花色不会乱插，按固定花色序排列', () => {
    const hand = [c('diamond', '7'), c('club', '7'), c('spade', '7')];
    assert.deepEqual(names(sortHand(hand, MAIN)), ['spade7', 'club7', 'diamond7']);
  });

  it('未定主时王与常主7、2 仍归主牌堆排前面', () => {
    const hand = [c('spade', 'A'), c('club', '7'), c('joker', 'big_joker'), c('heart', '2')];
    const sorted = sortHand(hand, null);
    assert.equal(name(sorted[sorted.length - 1]), 'spadeA');
    assert.deepEqual(names(sorted.slice(0, 3)), ['jokerbig_joker', 'club7', 'heart2']);
  });

  it('定主后主花色牌力抬升，排序结果随之变化', () => {
    const hand = [c('spade', 'A'), c('heart', '4')];
    assert.deepEqual(names(sortHand(hand, null)), ['spadeA', 'heart4']);
    assert.deepEqual(names(sortHand(hand, MAIN)), ['heart4', 'spadeA']);
  });
});

describe('sortHandByPower', () => {
  it('纯按牌力降序，不做花色分堆', () => {
    const hand = [c('spade', '5'), c('heart', '3'), c('club', 'A'), c('spade', '7')];
    const sorted = sortHandByPower(hand, MAIN);
    const powers = sorted.map(card => getCardPower(card, MAIN));
    assert.deepEqual(powers, [...powers].sort((x, y) => y - x));
  });

  it('不修改入参数组', () => {
    const hand = [c('spade', '5'), c('spade', 'A')];
    const before = names(hand);
    sortHandByPower(hand, MAIN);
    sortHand(hand, MAIN);
    assert.deepEqual(names(hand), before);
  });
});
