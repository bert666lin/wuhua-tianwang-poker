import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMatchWaitHint } from './matchmakingView';

describe('getMatchWaitHint', () => {
  it('刚开始就如实说明正在安排电脑对手，并允许直接开局', () => {
    assert.deepEqual(getMatchWaitHint(0, 0, 3), {
      text: '正在安排电脑对手，可以立即开局',
      canStartWithAi: true,
    });
  });

  it('等待过程中始终允许直接开局', () => {
    const hint = getMatchWaitHint(10, 1, 3);
    assert.equal(hint.canStartWithAi, true);
    assert.match(hint.text, /电脑对手/);
  });

  it('等待较久时明确不用继续等待动画', () => {
    const hint = getMatchWaitHint(20, 0, 5);
    assert.equal(hint.canStartWithAi, true);
    assert.match(hint.text, /立即开局/);
  });

  it('已经找齐时不再显示补位建议', () => {
    assert.deepEqual(getMatchWaitHint(30, 3, 3), {
      text: '对手已就位，正在准备牌桌',
      canStartWithAi: false,
    });
  });
});
