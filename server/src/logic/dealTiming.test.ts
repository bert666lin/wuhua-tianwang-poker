import { describe, it } from 'node:test';
import assert from 'node:assert';
import { dealAnimationMs } from './dealTiming.js';
import { GAME_MODES } from './config.js';

describe('发牌动画时间预算', () => {
  it('每个模式的窗口都在 2~3 秒之间（太短会切断动画，太长玩家等得烦）', () => {
    for (const mode of Object.values(GAME_MODES)) {
      const ms = dealAnimationMs(mode.perPlayer);
      assert.ok(ms >= 2000, `${mode.id} 窗口 ${ms}ms 太短`);
      assert.ok(ms <= 3000, `${mode.id} 窗口 ${ms}ms 太长`);
    }
  });

  it('牌越多窗口不会线性膨胀：48 张比 24 张多不到 400ms', () => {
    const short = dealAnimationMs(24);
    const long = dealAnimationMs(48);
    assert.ok(long > short, '48 张应当略长于 24 张');
    assert.ok(long - short < 400, `差值 ${long - short}ms 过大，说明间隔没有随张数压缩`);
  });

  it('张数异常（0 / 负数 / 小数）也返回有限正数，不会让房间永久卡在发牌阶段', () => {
    for (const n of [0, -5, 1, 1.7]) {
      const ms = dealAnimationMs(n);
      assert.ok(Number.isFinite(ms) && ms > 0, `perPlayer=${n} 得到 ${ms}`);
      assert.ok(ms <= 3000, `perPlayer=${n} 得到 ${ms}ms`);
    }
  });
});
