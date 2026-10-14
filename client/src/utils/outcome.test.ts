/**
 * 战果名称的边界测试。
 *
 * 这套名字（光头/小光/保底成功/挖底成功/过庄）是产品逐条确认过的，
 * 而且 1~40 这个边界和服务端 getBankerWinLevel 的分档是同一套。
 * 边界写错不会报错、不会崩，只会在结算页显示一个错名字 —— 玩家会以为算错了分。
 * 所以每个档位的**上下边界各锁一个值**。
 */
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { describeOutcome, outcomeBannerMs } from './outcome';

describe('describeOutcome — 庄家赢', () => {
  it('闲家 0 分 = 光头，最高情绪档', () => {
    const o = describeOutcome({ bankerWin: true, opponentScore: 0, digSuccess: false });
    assert.equal(o.kind, 'bald');
    assert.equal(o.label, '光头');
    assert.equal(o.intensity, 2);
    assert.equal(o.bankerWin, true);
  });

  it('闲家 1 分就不再是光头，落到小光', () => {
    const o = describeOutcome({ bankerWin: true, opponentScore: 1, digSuccess: false });
    assert.equal(o.kind, 'small_bald');
    assert.equal(o.label, '小光');
  });

  it('闲家 40 分仍是小光（上边界）', () => {
    const o = describeOutcome({ bankerWin: true, opponentScore: 40, digSuccess: false });
    assert.equal(o.kind, 'small_bald');
  });

  it('闲家 41 分变成保底成功（下边界）', () => {
    const o = describeOutcome({ bankerWin: true, opponentScore: 41, digSuccess: false });
    assert.equal(o.kind, 'hold');
    assert.equal(o.label, '保底成功');
    assert.equal(o.intensity, 0, '守住庄不该有夸张动效');
  });

  it('保底成功的解释里带上叫分，让玩家看懂为什么没被打倒', () => {
    const o = describeOutcome({
      bankerWin: true, opponentScore: 100, digSuccess: false, callScore: 115,
    });
    assert.match(o.detail, /100/);
    assert.match(o.detail, /115/);
  });

  it('庄家赢时不论 digSuccess 传什么都不会算成挖底', () => {
    // 防御性：庄家赢下最后一墩时服务端的 digSuccess 一定是 false，
    // 但万一上游传脏数据，也不能把战果显示成「挖底成功」。
    const o = describeOutcome({ bankerWin: true, opponentScore: 0, digSuccess: true });
    assert.equal(o.kind, 'bald');
  });
});

describe('describeOutcome — 闲家赢', () => {
  it('挖底成功要写出保底级数，最高情绪档', () => {
    const o = describeOutcome({
      bankerWin: false, opponentScore: 150, digSuccess: true, digGuaranteeLevel: 3,
    });
    assert.equal(o.kind, 'dig');
    assert.equal(o.label, '挖底成功');
    assert.equal(o.intensity, 2);
    assert.match(o.detail, /3 级/);
  });

  it('挖底但没传保底级数时，文案不能出现「保底 undefined 级」', () => {
    const o = describeOutcome({ bankerWin: false, opponentScore: 150, digSuccess: true });
    assert.equal(o.kind, 'dig');
    assert.doesNotMatch(o.detail, /undefined|NaN/);
  });

  it('闲家赢但没挖底 = 过庄，动效克制', () => {
    const o = describeOutcome({ bankerWin: false, opponentScore: 130, digSuccess: false });
    assert.equal(o.kind, 'over');
    assert.equal(o.label, '闲家过庄');
    assert.equal(o.intensity, 0);
    assert.match(o.detail, /130/);
  });
});

describe('describeOutcome — 五种战果互不重叠', () => {
  it('同一组输入只会得到一个 kind，且五种都可达', () => {
    const kinds = new Set([
      describeOutcome({ bankerWin: true,  opponentScore: 0,   digSuccess: false }).kind,
      describeOutcome({ bankerWin: true,  opponentScore: 20,  digSuccess: false }).kind,
      describeOutcome({ bankerWin: true,  opponentScore: 80,  digSuccess: false }).kind,
      describeOutcome({ bankerWin: false, opponentScore: 150, digSuccess: true  }).kind,
      describeOutcome({ bankerWin: false, opponentScore: 130, digSuccess: false }).kind,
    ]);
    assert.equal(kinds.size, 5, '五种战果都必须可达且互不重叠');
  });

  it('光头/小光只在庄家赢时出现', () => {
    // 闲家赢的路径无论分数多低都不能落到光头/小光
    for (const score of [0, 1, 40, 41]) {
      const o = describeOutcome({ bankerWin: false, opponentScore: score, digSuccess: false });
      assert.ok(o.kind !== 'bald' && o.kind !== 'small_bald',
        `闲家赢时不该出现光头/小光，score=${score} 得到 ${o.kind}`);
    }
  });
});

test('横幅时长按战果强度分档，且都在可接受区间内', () => {
  assert.equal(outcomeBannerMs(2), 2200, '光头/挖底停久一点');
  assert.equal(outcomeBannerMs(1), 1600);
  assert.equal(outcomeBannerMs(0), 1000, '普通胜负一闪而过');
  // 上下限守卫：横幅期间看不到结算数据，太长会挡路，太短看不清
  for (const i of [0, 1, 2] as const) {
    const ms = outcomeBannerMs(i);
    assert.ok(ms >= 800 && ms <= 2500, `${i} 档时长 ${ms}ms 超出 800~2500 区间`);
  }
  // 强度越高停留越久，不能反过来
  assert.ok(outcomeBannerMs(2) > outcomeBannerMs(1));
  assert.ok(outcomeBannerMs(1) > outcomeBannerMs(0));
});
