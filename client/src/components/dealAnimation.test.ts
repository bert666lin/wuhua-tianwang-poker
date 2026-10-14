import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dealTimeline, DEAL_SORT_MS, DEAL_PHASE_BUDGET_MS } from './dealAnimation.js';

describe('发牌动画时间线', () => {
  it('四个阶段严格递增，不会出现「还没飞完就开始理牌」', () => {
    for (const n of [24, 29, 32, 36, 48]) {
      const t = dealTimeline(n);
      assert.ok(t.flyEnd > 0, `${n} 张 flyEnd=${t.flyEnd}`);
      assert.ok(t.flipStart >= t.flyEnd, `${n} 张：翻面早于落桌`);
      assert.ok(t.flipEnd > t.flipStart, `${n} 张：翻面时长为 0`);
      assert.ok(t.sortStart >= t.flipEnd, `${n} 张：理牌早于翻完`);
      assert.ok(t.total > t.sortStart, `${n} 张：理牌时长为 0`);
    }
  });

  it('总时长恒定在 2~3 秒：牌越多间隔越短，48 张不会拖成 5 秒', () => {
    for (const n of [24, 36, 48]) {
      const { total } = dealTimeline(n);
      assert.ok(total >= 1500 && total <= 3000, `${n} 张总时长 ${total}ms 超出预期区间`);
    }
    assert.ok(dealTimeline(48).total - dealTimeline(24).total < 400);
  });

  it('间隔有上限：牌少时不会一张一张慢慢发', () => {
    assert.ok(dealTimeline(24).stagger <= 34);
    // 张数多时间隔必须被压下来，否则总时长会爆
    assert.ok(dealTimeline(48).stagger < dealTimeline(24).stagger);
  });

  it('单张手牌不会算出负数或 NaN 延迟（扣底后可能只剩几张）', () => {
    const t = dealTimeline(1);
    assert.equal(t.stagger, 0);
    assert.ok(Number.isFinite(t.total) && t.total > 0);
  });

  it('张数为 0 或负数时退化成 1 张，绝不返回 NaN', () => {
    for (const n of [0, -3]) {
      const t = dealTimeline(n);
      assert.equal(t.count, 1);
      assert.ok(Number.isFinite(t.total));
    }
  });

  it('理牌时长与 CSS FLIP 过渡共用同一常量（改一处就会对不上）', () => {
    const t = dealTimeline(24);
    assert.equal(t.total - t.sortStart, DEAL_SORT_MS);
  });

  it('服务端阶段预算 ≥ 最长动画，否则叫主面板会插进动画中间', () => {
    assert.ok(DEAL_PHASE_BUDGET_MS >= dealTimeline(48).total);
  });
});
