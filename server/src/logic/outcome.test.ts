/**
 * 战果代号判定测试。
 *
 * 这个文件除了测分档，还负责一件类型系统管不了的事：
 * **确认客户端那份 outcome.ts 的分档边界和这里是同一个数字**。
 * 两边各写一个 40，谁改了一边都不会报错，但玩家会看到
 * 「牌桌横幅说光头、战绩列表记小光」这种自相矛盾的画面。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveOutcomeKind, SMALL_BALD_MAX, type OutcomeKind } from './outcome.js';
import { getBankerWinLevel } from './levels.js';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');

describe('resolveOutcomeKind', () => {
  it('庄家赢且闲家 0 分 = 光头', () => {
    assert.equal(
      resolveOutcomeKind({ bankerWin: true, opponentScore: 0, digSuccess: false }),
      'bald',
    );
  });

  it('庄家赢且闲家 1~40 分 = 小光', () => {
    for (const score of [1, 5, 20, 39, 40]) {
      assert.equal(
        resolveOutcomeKind({ bankerWin: true, opponentScore: score, digSuccess: false }),
        'small_bald',
        `闲家 ${score} 分该是小光`,
      );
    }
  });

  it('庄家赢且闲家 41 分以上 = 保底成功', () => {
    for (const score of [41, 80, 120]) {
      assert.equal(
        resolveOutcomeKind({ bankerWin: true, opponentScore: score, digSuccess: false }),
        'hold',
        `闲家 ${score} 分该是保底成功`,
      );
    }
  });

  it('闲家赢且挖底 = 挖底成功；没挖底 = 闲家过庄', () => {
    assert.equal(
      resolveOutcomeKind({ bankerWin: false, opponentScore: 130, digSuccess: true }),
      'dig',
    );
    assert.equal(
      resolveOutcomeKind({ bankerWin: false, opponentScore: 130, digSuccess: false }),
      'over',
    );
  });

  it('闲家赢时不看分数，digSuccess 才是唯一分岔', () => {
    // 防回归：曾经有过"闲家赢就一定是挖底"的直觉错误。
    // 用普通牌赢最后一墩、分够了照样赢，但那不叫挖底。
    assert.equal(
      resolveOutcomeKind({ bankerWin: false, opponentScore: 0, digSuccess: true }),
      'dig',
    );
    assert.equal(
      resolveOutcomeKind({ bankerWin: false, opponentScore: 200, digSuccess: false }),
      'over',
    );
  });
});

describe('SMALL_BALD_MAX 与级数分档同源', () => {
  it('等于 getBankerWinLevel 里"小光档"的最后一分', () => {
    assert.equal(getBankerWinLevel(SMALL_BALD_MAX), getBankerWinLevel(1));
    assert.notEqual(getBankerWinLevel(SMALL_BALD_MAX + 1), getBankerWinLevel(1));
  });

  it('不是硬编码：真的从分档函数推出来的', () => {
    // 40 是当前值。这条断言写死 40 是故意的 —— 它是产品口径
    // （用户 2026-09 明确"1~40 分算小光"），改动必须是有意识的。
    assert.equal(SMALL_BALD_MAX, 40);
  });
});

describe('与客户端 outcome.ts 的口径一致', () => {
  const CLIENT = read('../../../client/src/utils/outcome.ts');

  it('客户端的 SMALL_BALD_MAX 与服务端相同', () => {
    const m = CLIENT.match(/const SMALL_BALD_MAX\s*=\s*(\d+)/);
    assert.ok(m, '客户端 outcome.ts 里找不到 SMALL_BALD_MAX，是不是改名了？');
    assert.equal(
      Number(m![1]),
      SMALL_BALD_MAX,
      '客户端和服务端的小光上限不一致：牌桌横幅会和战绩列表说不同的话',
    );
  });

  it('服务端每个战果代号客户端都认', () => {
    // 流局不进客户端 OutcomeKind（结算面不显示流局，走另一条广播），单独排除。
    const serverKinds: OutcomeKind[] = ['bald', 'small_bald', 'hold', 'dig', 'over'];
    for (const kind of serverKinds) {
      assert.match(
        CLIENT,
        new RegExp(`'${kind}'`),
        `客户端 outcome.ts 不认识代号 ${kind}`,
      );
    }
  });
});
