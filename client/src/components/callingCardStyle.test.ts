/**
 * 叫主中央牌（如「叫♠7为主」亮出的那张）的版式回归测试。
 *
 * 防的是两个已经踩过的坑：
 *
 * 1. **点数/花色和中央大花色重叠**（用户报的「叫主7出来的牌图形还是重叠了」）
 *    卡片尺寸走 --u，而角标字号原来走 --ut，这两个单位的缩放曲线**故意不同**
 *    （见 tokens.css：--ut 更平缓、下限更高，为了手机上正文不至于看不清）。
 *    屏幕越小，卡片缩得快、字缩得慢，字相对卡片越来越大，最后糊成一团。
 *    实测重叠面积：桌面 1280 宽 384px²，iPhone 横屏 844 宽 206px²。
 *    修法照抄普通手牌：字号 = 卡片宽度 × 固定比例，比例恒定就不可能叠。
 *
 * 2. **颜色写死成黑色**：叫红桃/方块时整张牌被画成黑的。
 *
 * 这里只能做静态断言（本仓库前端测试没有 DOM），真实几何是用 Playwright
 * 在 1280/1024/844/667 四种视口量过的，重叠面积均为 0。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(srcDir, 'styles/table-v4.css'), 'utf8');
const tsx = readFileSync(path.join(srcDir, 'components/TableV4.tsx'), 'utf8');

/** 取出某个选择器的样式块内容。 */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(m, `没找到样式块 ${selector}`);
  return m![1];
}

test('叫主牌的角标字号必须按卡片宽度取比例，不能用 --ut', () => {
  const card = block('.tv4-main-card');
  assert.match(card, /--tv4-mc-w:/, '卡片要把自己的宽度暴露成变量供字号取比例');

  for (const sel of ['.tv4-main-card .mrank', '.tv4-main-card .msuit', '.tv4-main-card .mc-suit']) {
    const rule = block(sel);
    const fontSize = rule.match(/font-size:\s*([^;]+);/)?.[1] ?? '';
    assert.ok(fontSize, `${sel} 缺 font-size`);
    assert.ok(
      fontSize.includes('--tv4-mc-w'),
      `${sel} 的字号必须基于卡片宽度，实际是「${fontSize.trim()}」`,
    );
    assert.ok(
      !fontSize.includes('--ut'),
      `${sel} 不能用 --ut：它与 --u 缩放曲线不同，小屏上会把角标顶到中央花色上`,
    );
  }
});

test('角标不能撑满卡宽，否则盒子必然与居中的大花色相交', () => {
  const card = block('.tv4-main-card');
  // flex 默认 align-items:stretch，会让 block 子元素占满整行宽度
  assert.match(
    card,
    /align-items:\s*flex-start/,
    'align-items 必须是 flex-start，默认 stretch 会让角标横跨整张卡',
  );
  assert.match(card, /overflow:\s*hidden/, '卡片要裁掉溢出，避免字飘到卡外');
});

test('中央大花色要偏离正中，进一步和左上角标拉开', () => {
  const big = block('.tv4-main-card .mc-suit');
  const top = Number(big.match(/top:\s*(\d+)%/)?.[1] ?? 50);
  const left = Number(big.match(/left:\s*(\d+)%/)?.[1] ?? 50);
  assert.ok(top >= 52, `大花色应略向下偏，实际 top:${top}%`);
  assert.ok(left >= 52, `大花色应略向右偏，实际 left:${left}%`);
});

test('大花色不能比点数小，仍要是牌面最大的符号', () => {
  const ratio = (sel: string) => {
    const fs = block(sel).match(/font-size:\s*calc\(var\(--tv4-mc-w\)\s*\*\s*([\d.]+)\)/);
    assert.ok(fs, `${sel} 的字号不是「卡宽 × 比例」的形式`);
    return Number(fs![1]);
  };
  const rank = ratio('.tv4-main-card .mrank');
  const suit = ratio('.tv4-main-card .msuit');
  const big = ratio('.tv4-main-card .mc-suit');
  assert.ok(big > rank, `大花色(${big}) 应大于点数(${rank})`);
  assert.ok(rank >= suit, `点数(${rank}) 不应小于角标花色(${suit})`);
  // 比例过大就会重新叠上去；手牌那套是 0.40 左右
  assert.ok(big <= 0.45, `大花色比例 ${big} 偏大，有重新压到角标的风险`);
});

test('叫主牌颜色跟随花色，红桃/方块不能被画成黑色', () => {
  const m = tsx.match(/className=\{`tv4-main-card[^`]*`\}/);
  assert.ok(m, '没找到叫主牌的 className');
  const cls = m![0];
  assert.ok(
    !/tv4-main-card tv4-animate-float tv4-black`/.test(cls),
    '颜色不能写死 tv4-black（叫红桃/方块会变黑牌）',
  );
  assert.match(cls, /tv4-red/, '要能取到红色');
  assert.match(cls, /♥|\\u2665/, '要判断红桃');
  assert.match(cls, /♦|\\u2666/, '要判断方块');

  // 花色符号还要挂 tv4-s-*，四色牌设置才能生效（与手牌一致）
  assert.match(tsx, /msuit tv4-s-\$\{suitClass\(mainSuit\)\}/, '角标花色缺 tv4-s-* 类');
  assert.match(tsx, /mc-suit tv4-s-\$\{suitClass\(mainSuit\)\}/, '中央花色缺 tv4-s-* 类');
});
