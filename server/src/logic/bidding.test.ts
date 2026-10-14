/**
 * 叫主 / 叫分规则单测。
 *
 * 这些门槛原先在「真人操作」和「AI 代打」两条路径里各写了一遍，
 * 改规则漏改一边就会出现「AI 能抢主但真人不能」这类偏差 —— 而且在牌桌上
 * 只表现为「我明明有 7 却抢不了主」，玩家只会觉得是 bug 说不清。
 * 现在两条路径共用这里的函数，规则钉在这个文件里。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkScoreBid,
  checkSuitCall,
  currentBidCeiling,
  isAiBidUsable,
  isBiddingDone,
  requiredSevens,
  rotateFrom,
  suitFromFlippedCard,
} from './bidding.js';
import { GAME_CONFIG, GAME_MODES, Rank, Suit, type CardData } from './config.js';

let seq = 0;
function card(suit: number, rank: number): CardData {
  seq += 1;
  return { id: `c${seq}`, suit, rank };
}
/** n 张某花色的 7（叫主的门票）。 */
function sevens(suit: number, n: number): CardData[] {
  return Array.from({ length: n }, () => card(suit, Rank.Seven));
}

const NO_MAIN = 255;
const TWO_DECK_MAX = GAME_MODES.fourPlayerTwoDecks.fullLevelScore;   // 125
const THREE_DECK_MAX = GAME_MODES.fourPlayerThreeDecks.fullLevelScore; // 145

describe('rotateFrom / 轮流顺序', () => {
  it('从指定位置开始轮一圈，人数不变、顺序不乱', () => {
    assert.deepEqual(rotateFrom(['a', 'b', 'c', 'd'], 2), ['c', 'd', 'a', 'b']);
    assert.deepEqual(rotateFrom(['a', 'b', 'c', 'd'], 0), ['a', 'b', 'c', 'd']);
  });

  /**
   * 上一局庄家已离桌时 findIndex 会给 -1，越界也可能出现。
   * 这时必须原样返回整个队列 —— 顺序错乱或返回空数组都会让叫主乱掉/卡死。
   * 负数这条是真会踩的（slice(-1) 只取最后一个）；超长下标那条属于兜底，
   * 就算守卫删掉行为也一样，这里一并钉住以防将来换实现。
   */
  it('起点越界（上一局庄家已离桌）时原样返回，绝不返回空队列', () => {
    for (const bad of [-1, -5, 4, 99]) {
      assert.deepEqual(
        rotateFrom(['a', 'b', 'c', 'd'], bad), ['a', 'b', 'c', 'd'],
        `起点 ${bad} 不该把队列弄丢`,
      );
    }
  });

  it('不改动原数组（房间还要拿原队列做别的事）', () => {
    const src = ['a', 'b', 'c'];
    rotateFrom(src, 1);
    assert.deepEqual(src, ['a', 'b', 'c']);
  });
});

describe('requiredSevens / 亮牌门槛', () => {
  it('还没人叫主：1 张 7 就能叫', () => {
    assert.equal(requiredSevens(NO_MAIN, 0), 1);
  });

  it('已有人叫主：必须比他亮的更多', () => {
    assert.equal(requiredSevens(Suit.Spade, 1), 2);
    assert.equal(requiredSevens(Suit.Spade, 2), 3);
    assert.equal(requiredSevens(Suit.Spade, 3), 4);
  });
});

describe('checkSuitCall / 叫主与抢主', () => {
  it('手上没有对应花色的 7 不能叫', () => {
    const r = checkSuitCall({
      suit: Suit.Spade,
      hand: [...sevens(Suit.Heart, 3), card(Suit.Spade, Rank.Ace)],
      mainSuit: NO_MAIN,
      mainSuitCallCount: 0,
    });
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.message : '', /必须持有/);
  });

  it('首叫：1 张 7 就够，且只亮 1 张（手上有 3 张也不全亮）', () => {
    const r = checkSuitCall({
      suit: Suit.Club, hand: sevens(Suit.Club, 3),
      mainSuit: NO_MAIN, mainSuitCallCount: 0,
    });
    assert.equal(r.ok, true);
    assert.equal(r.ok === true ? r.sevenCount : -1, 1,
      '多余的 7 要留着不亮：既给后面的人留抢主空间，也不暴露牌力');
  });

  it('抢主：张数不够时拒绝，并把差多少说清楚', () => {
    const r = checkSuitCall({
      suit: Suit.Heart, hand: sevens(Suit.Heart, 1),
      mainSuit: Suit.Spade, mainSuitCallCount: 2,
    });
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.message : '', /需要3张7.*只有1张/);
  });

  it('抢主：张数刚好够就放行，只亮到门槛那么多', () => {
    const r = checkSuitCall({
      suit: Suit.Heart, hand: sevens(Suit.Heart, 4),
      mainSuit: Suit.Spade, mainSuitCallCount: 2,
    });
    assert.equal(r.ok, true);
    assert.equal(r.ok === true ? r.sevenCount : -1, 3, '门槛 3 张就亮 3 张，第 4 张留着');
  });

  it('同花色再叫也要比自己上次亮得更多（不能白抢）', () => {
    const two = checkSuitCall({
      suit: Suit.Spade, hand: sevens(Suit.Spade, 2),
      mainSuit: Suit.Spade, mainSuitCallCount: 2,
    });
    assert.equal(two.ok, false, '和当前一样多不算抢主');
    const three = checkSuitCall({
      suit: Suit.Spade, hand: sevens(Suit.Spade, 3),
      mainSuit: Suit.Spade, mainSuitCallCount: 2,
    });
    assert.equal(three.ok, true);
  });

  it('大小王不是花色，不能拿来当主', () => {
    for (const bad of [Suit.SmallJoker, Suit.BigJoker, -1, 6, 255]) {
      const r = checkSuitCall({
        suit: bad, hand: sevens(bad, 3), mainSuit: NO_MAIN, mainSuitCallCount: 0,
      });
      assert.equal(r.ok, false, `花色 ${bad} 不该能叫主`);
      assert.match(r.ok === false ? r.message : '', /无效主花色/);
    }
  });

  it('四个正常花色都能叫（黑桃/红桃/方块/梅花）', () => {
    for (const suit of [Suit.Spade, Suit.Heart, Suit.Diamond, Suit.Club]) {
      const r = checkSuitCall({
        suit, hand: sevens(suit, 1), mainSuit: NO_MAIN, mainSuitCallCount: 0,
      });
      assert.equal(r.ok, true, `花色 ${suit} 应该能叫主`);
    }
  });
});

describe('suitFromFlippedCard / 无人叫主翻底定主', () => {
  it('翻到大王算红桃，小王算黑桃', () => {
    assert.equal(suitFromFlippedCard(card(Suit.BigJoker, Rank.BigJoker)), Suit.Heart);
    assert.equal(suitFromFlippedCard(card(Suit.SmallJoker, Rank.SmallJoker)), Suit.Spade);
  });

  it('翻到普通牌就按它的花色', () => {
    for (const suit of [Suit.Spade, Suit.Heart, Suit.Diamond, Suit.Club]) {
      assert.equal(suitFromFlippedCard(card(suit, Rank.Nine)), suit);
    }
  });

  /** 定出来的主必须是能打的花色，不能是 4/5（大小王）或 255（未定）。 */
  it('结果一定落在四个正常花色内', () => {
    const all = [Suit.Spade, Suit.Heart, Suit.Diamond, Suit.Club, Suit.SmallJoker, Suit.BigJoker];
    for (const suit of all) {
      const got = suitFromFlippedCard(card(suit, Rank.Three));
      assert.ok(got >= Suit.Spade && got <= Suit.Club, `翻 ${suit} 定出了不能打的主 ${got}`);
    }
  });
});

describe('currentBidCeiling / 当前能叫的最高分', () => {
  it('还没人叫：上限就是基准分', () => {
    assert.equal(currentBidCeiling({ hasBidder: false, currentBid: 125, bidMax: TWO_DECK_MAX }), 125);
    assert.equal(currentBidCeiling({ hasBidder: false, currentBid: 145, bidMax: THREE_DECK_MAX }), 145);
  });

  it('已有人叫：必须比他低一个步长', () => {
    assert.equal(
      currentBidCeiling({ hasBidder: true, currentBid: 100, bidMax: TWO_DECK_MAX }),
      100 - GAME_CONFIG.callScoreStep,
    );
  });
});

describe('checkScoreBid / 叫分校验', () => {
  const base = { bidMax: TWO_DECK_MAX, currentBid: TWO_DECK_MAX, hasBidder: false };

  it('低于下限或高于基准分都拒', () => {
    assert.equal(checkScoreBid({ ...base, score: GAME_CONFIG.callScoreMin - 5 }).ok, false);
    assert.equal(checkScoreBid({ ...base, score: TWO_DECK_MAX + 5 }).ok, false);
  });

  it('下限和基准分本身是可以叫的（边界包含）', () => {
    assert.equal(checkScoreBid({ ...base, score: GAME_CONFIG.callScoreMin }).ok, true);
    assert.equal(checkScoreBid({ ...base, score: TWO_DECK_MAX }).ok, true);
  });

  it('必须是步长的倍数', () => {
    assert.equal(checkScoreBid({ ...base, score: 101 }).ok, false);
    assert.equal(checkScoreBid({ ...base, score: 100 }).ok, true);
  });

  it('后叫必须严格低于当前最低价', () => {
    const withBidder = { bidMax: TWO_DECK_MAX, currentBid: 100, hasBidder: true };
    assert.equal(checkScoreBid({ ...withBidder, score: 100 }).ok, false, '同价不算压价');
    assert.equal(checkScoreBid({ ...withBidder, score: 105 }).ok, false, '更高更不行');
    assert.equal(checkScoreBid({ ...withBidder, score: 95 }).ok, true);
  });

  /**
   * 三副牌局基准分是 145，不是 125。写死 125 会让三副牌局叫不到 130~145。
   */
  it('三副牌局能叫到 145（上限不是写死的 125）', () => {
    const three = { bidMax: THREE_DECK_MAX, currentBid: THREE_DECK_MAX, hasBidder: false };
    assert.equal(checkScoreBid({ ...three, score: 145 }).ok, true);
    assert.equal(checkScoreBid({ ...three, score: 130 }).ok, true);
    // 同样的 130 在两副牌局也合法（125 上限？不，130 > 125 应被拒）
    assert.equal(checkScoreBid({ ...base, score: 130 }).ok, false,
      '两副牌局基准分 125，130 必须拒掉');
  });
});

describe('isAiBidUsable / AI 算出的分能不能叫', () => {
  const bidMax = TWO_DECK_MAX;

  it('比当前最低价更低就能叫', () => {
    assert.equal(isAiBidUsable({ score: 95, currentBid: 100, hasBidder: true, bidMax }), true);
  });

  it('同价或更高不能叫', () => {
    assert.equal(isAiBidUsable({ score: 100, currentBid: 100, hasBidder: true, bidMax }), false);
    assert.equal(isAiBidUsable({ score: 110, currentBid: 100, hasBidder: true, bidMax }), false);
  });

  /**
   * 这条最容易漏：还没人叫时 currentBid 初始化成基准分，AI 想按基准分开叫，
   * score === currentBid 不满足「更低」，得单独放行。漏了这条 AI 就永远
   * 不会第一个按 125 开叫，头家 AI 总是过牌。
   */
  it('还没人叫、AI 按基准分开叫要放行（否则头家 AI 永远不开口）', () => {
    assert.equal(isAiBidUsable({ score: bidMax, currentBid: bidMax, hasBidder: false, bidMax }), true);
  });

  it('已有人叫时，基准分那条特例不生效', () => {
    assert.equal(isAiBidUsable({ score: bidMax, currentBid: bidMax, hasBidder: true, bidMax }), false);
  });

  it('低于叫分下限的分（AI 表示放弃）不能叫', () => {
    assert.equal(isAiBidUsable({
      score: GAME_CONFIG.callScoreMin - 5, currentBid: 100, hasBidder: true, bidMax,
    }), false);
    assert.equal(isAiBidUsable({ score: 0, currentBid: 100, hasBidder: true, bidMax }), false);
  });

  it('下限本身能叫（叫到底了）', () => {
    assert.equal(isAiBidUsable({
      score: GAME_CONFIG.callScoreMin, currentBid: 100, hasBidder: true, bidMax,
    }), true);
  });
});

describe('isBiddingDone / 叫分何时收尾', () => {
  it('轮完一圈就收尾', () => {
    assert.equal(isBiddingDone({ nextIndex: 4, orderLength: 4, currentBid: 100 }), true);
    assert.equal(isBiddingDone({ nextIndex: 3, orderLength: 4, currentBid: 100 }), false);
  });

  /** 有人叫到下限时不可能再被压价，继续轮只是白等 15 秒×N。 */
  it('已有人叫到下限就提前收尾，不用再轮一圈白等', () => {
    assert.equal(isBiddingDone({
      nextIndex: 1, orderLength: 4, currentBid: GAME_CONFIG.callScoreMin,
    }), true);
  });

  it('还差一分到下限时不能收尾（后面的人还有机会压）', () => {
    assert.equal(isBiddingDone({
      nextIndex: 1, orderLength: 4, currentBid: GAME_CONFIG.callScoreMin + GAME_CONFIG.callScoreStep,
    }), false);
  });
});

describe('两条路径共用同一份规则（防止真人与 AI 判定分叉）', () => {
  /**
   * 直接读 GameRoom.ts 源码确认：真人路径调 checkSuitCall/checkScoreBid，
   * AI 路径调 isAiBidUsable/currentBidCeiling，没有谁自己另写一套门槛。
   */
  it('GameRoom.ts 不再自己内联叫主/叫分门槛', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../rooms/GameRoom.ts', import.meta.url), 'utf-8');
    for (const fn of ['checkSuitCall', 'checkScoreBid', 'currentBidCeiling', 'isAiBidUsable']) {
      assert.ok(src.includes(fn), `GameRoom 应该调用 ${fn}`);
    }
    assert.ok(
      !src.includes("message: '无效主花色'"),
      '叫主花色校验不该在 GameRoom 里再写一份',
    );
    assert.ok(
      !src.includes("message: '叫分超出范围'"),
      '叫分范围校验不该在 GameRoom 里再写一份',
    );
  });
});
