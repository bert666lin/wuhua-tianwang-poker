/**
 * 终局判断单测。
 *
 * 这个信号直接喂给 AI（logic/ai.ts 的 isFinalTrick）：判错会让 AI 一直省着
 * 天王不用、最后烂在手里，闲家白丢挖底、庄家也不知道要在最后一墩保底。
 * 原先它埋在 GameRoom 里读 this.hands，没法单独验。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isFinalTrick } from './trickProgress.js';

describe('isFinalTrick', () => {
  it('还没出牌、手上刚好够这一墩 = 最后一墩', () => {
    assert.equal(isFinalTrick({ handCount: 2, perTrick: 2, alreadyPlayed: false }), true);
    assert.equal(isFinalTrick({ handCount: 1, perTrick: 1, alreadyPlayed: false }), true);
  });

  it('还没出牌、手上还多 = 不是最后一墩', () => {
    assert.equal(isFinalTrick({ handCount: 4, perTrick: 2, alreadyPlayed: false }), false);
    assert.equal(isFinalTrick({ handCount: 3, perTrick: 1, alreadyPlayed: false }), false);
  });

  /**
   * 这条是关键：已经出过牌的人，handCount 已经扣掉本墩那几张，
   * 不能再扣一次 —— 重复扣会把倒数第二墩误判成最后一墩。
   */
  it('已经出过牌：手上空了才是最后一墩', () => {
    assert.equal(isFinalTrick({ handCount: 0, perTrick: 2, alreadyPlayed: true }), true);
    assert.equal(isFinalTrick({ handCount: 2, perTrick: 2, alreadyPlayed: true }), false);
  });

  it('同样的手牌数，出过牌与没出牌的结论必须不同（防重复扣张数）', () => {
    const notYet = isFinalTrick({ handCount: 2, perTrick: 2, alreadyPlayed: false });
    const played = isFinalTrick({ handCount: 2, perTrick: 2, alreadyPlayed: true });
    assert.equal(notYet, true, '还没出牌、手上刚好 2 张 = 最后一墩');
    assert.equal(played, false, '已出过牌还剩 2 张 = 后面还有一墩');
  });

  it('本墩还没人出牌时按单张算（perTrick 缺省）', () => {
    assert.equal(isFinalTrick({ handCount: 1, alreadyPlayed: false }), true);
    assert.equal(isFinalTrick({ handCount: 5, alreadyPlayed: false }), false);
  });

  it('perTrick 异常（0/负数）不做判断，避免把正常局面误判成终局', () => {
    assert.equal(isFinalTrick({ handCount: 10, perTrick: 0, alreadyPlayed: false }), false);
    assert.equal(isFinalTrick({ handCount: 10, perTrick: -3, alreadyPlayed: false }), false);
  });

  /**
   * 这条专门盯着「张数异常」的那道守卫。上一条用的是手上还有 10 张的局面，
   * 就算守卫被删掉，减 0 之后仍然剩 10 张、结论照样是 false，等于没测到。
   * 手牌为 0 时才分得出来：有守卫返回 false（输入不可信，不下结论），
   * 没守卫会直接算成终局，把 AI 的判断带偏。
   */
  it('张数异常且手牌为空时也不下结论（守卫被删就会露出来）', () => {
    assert.equal(isFinalTrick({ handCount: 0, perTrick: 0, alreadyPlayed: false }), false);
    assert.equal(isFinalTrick({ handCount: 0, perTrick: 0, alreadyPlayed: true }), false);
    assert.equal(isFinalTrick({ handCount: 0, perTrick: -2, alreadyPlayed: true }), false);
  });

  it('手牌数被扣成负数也算终局（防御性：不该出现但别卡住流程）', () => {
    assert.equal(isFinalTrick({ handCount: 1, perTrick: 3, alreadyPlayed: false }), true);
  });
});
