import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_BACKS, nextCardBack } from './preferences.js';

test('nextCardBack 在可选牌背里循环，最后一个回到第一个', () => {
  assert.equal(nextCardBack(CARD_BACKS[0]), CARD_BACKS[1]);
  assert.equal(nextCardBack(CARD_BACKS[CARD_BACKS.length - 1]), CARD_BACKS[0]);
});

test('nextCardBack 遇到未知牌背回落到第一个，不返回 undefined', () => {
  assert.equal(nextCardBack('不存在的牌背'), CARD_BACKS[0]);
});

import { cardBackTheme } from './preferences.js';

test('cardBackTheme 把中文牌背名映射成 CSS 主题键', () => {
  assert.equal(cardBackTheme('默认蓝金'), 'blue');
  assert.equal(cardBackTheme('墨绿丝绸'), 'green');
  assert.equal(cardBackTheme('黄金 VIP'), 'gold');
});

test('cardBackTheme 遇到未知牌背回落 blue，不产生非法选择器', () => {
  assert.equal(cardBackTheme('乱写'), 'blue');
});

import { suitGlyph, suitClass } from './preferences.js';

test('suitGlyph 给四个花色加上 U+FE0E 文字形态选择符', () => {
  // 不加这个选择符，iOS 会用彩色 emoji 字形渲染并无视 CSS color，
  // 导致四色牌失效、iPhone 与安卓牌面不一致。
  for (const sym of ['\u2660', '\u2665', '\u2663', '\u2666']) {
    assert.equal(suitGlyph(sym), sym + '\uFE0E', `${sym} 应带文字形态选择符`);
  }
});

test('suitGlyph 幂等：重复调用不会叠加多个选择符', () => {
  // 渲染路径可能嵌套调用，叠加会让字符串越来越长且渲染异常
  const once = suitGlyph('\u2660');
  assert.equal(suitGlyph(once), once);
});

test('suitGlyph 不动王与空值', () => {
  // ★ 本身不是 emoji 兼容字符，空字符串是王牌的 suit 值
  assert.equal(suitGlyph('\u2605'), '\u2605');
  assert.equal(suitGlyph(''), '');
});

test('suitClass 仍按裸符号判定，不受 suitGlyph 影响', () => {
  // 关键契约：四色牌的 CSS 类名来自 suitClass，
  // 若把带 FE0E 的值传进来会全部落到 joker 分支、四色牌整体失效。
  assert.equal(suitClass('\u2660'), 'spade');
  assert.equal(suitClass('\u2665'), 'heart');
  assert.equal(suitClass('\u2663'), 'club');
  assert.equal(suitClass('\u2666'), 'diamond');
});

import { getFourColor, setFourColor } from './preferences.js';

/** node 环境没有 localStorage，装一个最小实现来测读写契约。 */
function stubLocalStorage(): { restore: () => void } {
  const store = new Map<string, string>();
  const prev = (globalThis as Record<string, unknown>).localStorage;
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  return { restore: () => { (globalThis as Record<string, unknown>).localStorage = prev; } };
}

test('getFourColor 默认关闭（传统红黑）', () => {
  // 行为变更锁定：四色牌以前默认开，把梅花染绿、方块染蓝，
  // 玩家反馈「iPhone 花色是彩色的、和安卓不一样、很难看」。
  // 现在默认必须是关，也就是没存过值时返回 false。
  const s = stubLocalStorage();
  try {
    assert.equal(getFourColor(), false);
  } finally { s.restore(); }
});

test('getFourColor 只认 "1"，其他值都当关', () => {
  // 历史上存过 'true'/'0' 等值，只有显式 '1' 才算开，
  // 否则老用户的脏数据会把四色牌又打开。
  const s = stubLocalStorage();
  try {
    for (const v of ['0', 'true', 'false', '', 'yes']) {
      localStorage.setItem('tw_four_color', v);
      assert.equal(getFourColor(), false, `存 ${JSON.stringify(v)} 时应为关`);
    }
    localStorage.setItem('tw_four_color', '1');
    assert.equal(getFourColor(), true);
  } finally { s.restore(); }
});

test('setFourColor 写入的值能被 getFourColor 读回（开关往返一致）', () => {
  const s = stubLocalStorage();
  try {
    setFourColor(true);
    assert.equal(getFourColor(), true);
    setFourColor(false);
    assert.equal(getFourColor(), false);
  } finally { s.restore(); }
});

test('没有 localStorage 时 getFourColor 不抛异常且返回关', () => {
  // 无痕模式/禁用存储时读 localStorage 会抛，抛出去会白屏
  const prev = (globalThis as Record<string, unknown>).localStorage;
  (globalThis as Record<string, unknown>).localStorage = undefined;
  try {
    assert.equal(getFourColor(), false);
  } finally { (globalThis as Record<string, unknown>).localStorage = prev; }
});
