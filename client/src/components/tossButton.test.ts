/**
 * 甩牌按钮的可点性回归测试。
 *
 * 用户反馈：「甩牌功能不够完善，有时候甩不了牌」。
 * 排查结论是**规则逻辑没问题**（client/src/utils/toss.ts 与服务端
 * server/src/logic/toss.ts 规则一致，各自都有单测），坏的是交互反馈：
 * 按钮当时写的是 `disabled={!canToss}`，不能甩的原因只放在 `title` 属性里。
 * 手机上没有 hover，title 永远看不到 —— 玩家点下去毫无反应，
 * 既不知道是自己选错了牌，也不知道是不是功能坏了。
 *
 * 修法：按钮**始终可点**，不满足条件时点一下用 toast 明确说出原因。
 * 这里用「读源码断言」的方式守住这个约定（本仓库前端测试无 DOM 环境）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsx = readFileSync(path.join(srcDir, 'components/TableV4.tsx'), 'utf8');
const css = readFileSync(path.join(srcDir, 'styles/table-v4.css'), 'utf8');

/** 取出甩牌按钮那一段 JSX（从 data-testid="toss-btn" 往前后各取一段）。 */
function tossButtonJsx(): string {
  const anchor = tsx.indexOf('data-testid="toss-btn"');
  assert.ok(anchor > 0, '找不到甩牌按钮');
  // 往前找到 <button，往后找到该 button 的结束
  const start = tsx.lastIndexOf('<button', anchor);
  const end = tsx.indexOf('</button>', anchor);
  assert.ok(start > 0 && end > anchor, '甩牌按钮 JSX 结构异常');
  // 必须剥掉注释再断言：注释里会解释「为什么不用 disabled / aria-disabled」，
  // 带着注释做正则会把说明文字本身当成代码命中。
  return tsx.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('甩牌按钮', () => {
  it('绝不能用 disabled 关掉：手机看不到 title，会让玩家以为功能坏了', () => {
    const jsx = tossButtonJsx();
    assert.ok(
      !/(?<!aria-)disabled=/.test(jsx),
      '甩牌按钮又被加上了 disabled —— 用户反馈的「甩不了牌」正是这么来的。\n' +
      '请保持按钮可点，并在点击时用 showToast 说明不能甩的原因。',
    );
  });

  it('点击时若不满足条件，必须用 toast 把原因说出来', () => {
    const jsx = tossButtonJsx();
    assert.match(jsx, /onClick=/, '甩牌按钮缺 onClick');
    assert.match(
      jsx, /if\s*\(\s*!canToss\s*\)/,
      'onClick 里必须先判断 !canToss，不能直接把非法请求发给服务端',
    );
    assert.match(
      jsx, /showToast\(/,
      '不能甩时必须 showToast 说明原因（这是本次修复的核心）',
    );
    assert.match(
      jsx, /tossHint/,
      'toast 内容要用 tossHint —— 它才带着「不同门/不是最大/还没轮到你」的具体原因',
    );
  });

  it('仍要有视觉弱化，让「现在还不能甩」一眼可见', () => {
    const jsx = tossButtonJsx();
    assert.match(jsx, /is-muted/, '缺 is-muted 弱化态');
    assert.match(jsx, /data-can-toss=\{canToss\}/, '缺 data-can-toss 状态标记');
    assert.match(css, /\.tv4-action-btn\.is-muted\s*\{/, 'CSS 里缺 .tv4-action-btn.is-muted');
  });

  it('is-muted 不能把指针事件关掉，否则等于又变回不可点', () => {
    const m = css.match(/\.tv4-action-btn\.is-muted\s*\{([\s\S]*?)\}/);
    assert.ok(m, '找不到 .tv4-action-btn.is-muted 样式块');
    assert.ok(
      !/pointer-events\s*:\s*none/.test(m![1]),
      'is-muted 里不许写 pointer-events:none —— 点不动就收不到 toast 提示了',
    );
  });

  it('弱化态要比真 disabled 更显眼，暗示「能点，但先看提示」', () => {
    const muted = css.match(/\.tv4-action-btn\.is-muted\s*\{([\s\S]*?)\}/)![1];
    const disabled = css.match(/\.tv4-action-btn:disabled\s*\{([\s\S]*?)\}/)![1];
    const op = (s: string) => parseFloat(s.match(/opacity:\s*([\d.]+)/)?.[1] ?? '1');
    assert.ok(op(muted) > op(disabled), 'is-muted 的 opacity 应高于 :disabled');
  });

  it('不许用 aria-disabled：辅助技术和自动化都会当成真禁用，等于又点不动', () => {
    const jsx = tossButtonJsx();
    assert.ok(
      !/aria-disabled/.test(jsx),
      'aria-disabled="true" 语义是「不可操作」，与「按了会告诉你原因」矛盾；\n' +
      '实测 Playwright 因此拒绝点击（element is not enabled），读屏也会念成不可用。',
    );
  });
});
