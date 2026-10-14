/**
 * 局终结算单测。
 *
 * 为什么这个文件最要紧：computeSettlement 的输出直接换成玩家的金币和段位。
 * 算错一级，四家的账全错，而且是「悄悄错」——没人会在牌桌上按计算器复核。
 * 原先这段埋在 GameRoom.settleGame 里，跟清计时器、改 phase、写数据库混在
 * 一起，只能靠真人开一整局才能验；现在拆成纯函数，这里把各种边界一次钉死。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSettlement, type SettlementInput } from './settlement.js';
import { GAME_MODES, Rank, Suit, type CardData } from './config.js';
import { calcTrickScore } from './score.js';

/** 造一张牌。id 只要唯一即可，结算不看 id。 */
let cardSeq = 0;
function card(suit: number, rank: number): CardData {
  cardSeq += 1;
  return { id: `c${cardSeq}`, suit, rank };
}

const MAIN = Suit.Spade;
/** 天王 = 主花色的 3。双天王赢最后一墩 → 保底 4 级。 */
const tianWang = () => card(MAIN, Rank.Three);
const bigJoker = () => card(Suit.BigJoker, Rank.BigJoker);
const smallJoker = () => card(Suit.SmallJoker, Rank.SmallJoker);
/** 普通无分牌：赢了最后一墩也拿不到保底级。 */
const plain = () => card(Suit.Heart, Rank.Nine);
/** 分牌：5=5分，10/K=10分。 */
const five = () => card(Suit.Heart, Rank.Five);
const ten = () => card(Suit.Heart, Rank.Ten);
const king = () => card(Suit.Club, Rank.King);

const FOUR_TWO = GAME_MODES.fourPlayerTwoDecks;

/**
 * 4人两副牌的默认输入：庄家坐 0 号位，闲家 1/2/3。
 * 每个用例只覆盖自己关心的字段，其余走这份默认值。
 */
function baseInput(over: Partial<SettlementInput> = {}): SettlementInput {
  return {
    lastTrickWinner: 1,
    winningCards: [plain()],
    bankerSeat: 0,
    mainSuit: MAIN,
    bankerRemainingCards: [],
    bottomCards: [],
    trickScores: [0, 0, 0, 0],
    isBankerBySeat: [true, false, false, false],
    callScore: 100,
    deckCount: FOUR_TWO.deckCount,
    playerCount: FOUR_TWO.playerCount,
    totalScore: FOUR_TWO.totalScore,
    ...over,
  };
}

describe('computeSettlement / 闲家抓分只算闲家', () => {
  it('庄家自己抓的分不计入闲家总分', () => {
    const s = computeSettlement(baseInput({
      // 庄家(座位0)抓了 80 分，闲家们只抓了 20
      trickScores: [80, 10, 5, 5],
      lastTrickWinner: 0, // 庄家赢最后一墩，不涉及挖底/底牌
      callScore: 100,
    }));
    assert.equal(s.trickScore, 20, '闲家抓分 = 10+5+5，庄家那 80 分不算');
    assert.equal(s.opponentScore, 20);
    assert.equal(s.bankerScore, FOUR_TWO.totalScore - 20, '庄家得分 = 总分 - 闲家分');
  });

  it('闲家分 + 庄家分 恒等于本模式总分（守恒，不能凭空多分）', () => {
    for (const opponent of [0, 5, 45, 100, 145, 200]) {
      const s = computeSettlement(baseInput({
        trickScores: [0, opponent, 0, 0],
        lastTrickWinner: 0,
      }));
      assert.equal(
        s.opponentScore + s.bankerScore,
        FOUR_TWO.totalScore,
        `闲家 ${opponent} 分时两边加起来必须还是 ${FOUR_TWO.totalScore}`,
      );
    }
  });
});

describe('computeSettlement / 底牌分归属', () => {
  it('闲家赢最后一墩：底牌分算给闲家，普通牌赢也算', () => {
    const bottom = [ten(), king(), five()]; // 25 分
    const s = computeSettlement(baseInput({
      lastTrickWinner: 2,          // 闲家
      winningCards: [plain()],     // 普通牌，没有保底级
      bottomCards: bottom,
      trickScores: [0, 40, 40, 0], // 闲家抓 80
      callScore: 100,
    }));
    assert.equal(s.bottomScore, 25);
    assert.equal(s.bottomTaken, true);
    assert.equal(s.opponentScore, 105, '80 抓分 + 25 底牌分');
    assert.equal(s.digSuccess, false, '普通牌赢没有挖底保底级');
    assert.equal(s.bankerWin, false, '105 ≥ 叫分 100，闲家赢');
  });

  it('庄家赢最后一墩：底牌分归庄家，闲家一分不加', () => {
    const s = computeSettlement(baseInput({
      lastTrickWinner: 0,          // 庄家
      winningCards: [tianWang()],
      bottomCards: [ten(), king(), five()],
      trickScores: [0, 40, 40, 0],
    }));
    assert.equal(s.bottomTaken, false);
    assert.equal(s.opponentScore, 80, '底牌那 25 分不给闲家');
    assert.equal(s.digSuccess, false, '庄家赢最后一墩不算挖底');
  });

  it('底牌全是无分牌时，闲家赢最后一墩也加 0 分', () => {
    const s = computeSettlement(baseInput({
      lastTrickWinner: 1,
      bottomCards: [plain(), plain()],
      trickScores: [0, 30, 0, 0],
    }));
    assert.equal(s.bottomScore, 0);
    assert.equal(s.bottomTaken, true, '归属仍然成立，只是这次底牌没分');
    assert.equal(s.opponentScore, 30);
  });
});

describe('computeSettlement / 挖底保底级', () => {
  it('双天王赢最后一墩：保底 4 级，哪怕闲家几乎没抓分也赢', () => {
    const s = computeSettlement(baseInput({
      lastTrickWinner: 3,
      winningCards: [tianWang(), tianWang()],
      trickScores: [0, 0, 0, 5],
      callScore: 125,
    }));
    assert.equal(s.digTianWangCount, 2);
    assert.equal(s.digGuaranteeLevel, 4);
    assert.equal(s.digSuccess, true);
    assert.equal(s.bankerWin, false);
    assert.equal(s.level, 4, '分数不够也照样 4 级，保底级说话');
    assert.equal(s.scoreLevel, 0, '分数级确实是 0');
  });

  it('单天王 = 3 级；大小王 = 1 级', () => {
    const one = computeSettlement(baseInput({
      lastTrickWinner: 1, winningCards: [tianWang(), plain()], callScore: 125,
    }));
    assert.equal(one.digGuaranteeLevel, 3);
    assert.equal(one.level, 3);

    const joker = computeSettlement(baseInput({
      lastTrickWinner: 1, winningCards: [bigJoker(), smallJoker()], callScore: 125,
    }));
    assert.equal(joker.digGuaranteeLevel, 1);
    assert.equal(joker.digBigJokerCount, 1);
    assert.equal(joker.digSmallJokerCount, 1);
    assert.equal(joker.level, 1);
  });

  it('保底级和分数级取高，不叠加', () => {
    // 闲家抓满分：分数级 4；同时大小王挖底：保底级 1。结果取 4 不是 5。
    const s = computeSettlement(baseInput({
      lastTrickWinner: 1,
      winningCards: [bigJoker()],
      trickScores: [0, 200, 0, 0],
      callScore: 40,
    }));
    assert.equal(s.scoreLevel, 4);
    assert.equal(s.digLevel, 1);
    assert.equal(s.level, 4, '取高，不是 4+1');
  });
});

describe('computeSettlement / 胜负与级数', () => {
  it('闲家分数正好够叫分 = 赢 1 级；差 1 分 = 输', () => {
    const win = computeSettlement(baseInput({
      lastTrickWinner: 0, trickScores: [0, 100, 0, 0], callScore: 100,
    }));
    assert.equal(win.bankerWin, false);
    assert.equal(win.level, 1);

    const lose = computeSettlement(baseInput({
      lastTrickWinner: 0, trickScores: [0, 95, 0, 0], callScore: 100,
    }));
    assert.equal(lose.bankerWin, true, '95 < 100，庄家赢');
  });

  it('庄家赢的级数按闲家得分分档：0 分→4 级，1~40→2 级，>40→1 级', () => {
    const zero = computeSettlement(baseInput({ lastTrickWinner: 0, trickScores: [0, 0, 0, 0], callScore: 100 }));
    assert.equal(zero.level, 4, '闲家一分未得 = 光头，庄家赢 4 级');

    const low = computeSettlement(baseInput({ lastTrickWinner: 0, trickScores: [0, 40, 0, 0], callScore: 100 }));
    assert.equal(low.level, 2);

    const high = computeSettlement(baseInput({ lastTrickWinner: 0, trickScores: [0, 45, 0, 0], callScore: 100 }));
    assert.equal(high.level, 1);
  });

  it('超出叫分每 45 分加一级，封顶 4 级', () => {
    const at = (score: number) => computeSettlement(baseInput({
      lastTrickWinner: 0, trickScores: [0, score, 0, 0], callScore: 40,
    })).level;
    assert.equal(at(40), 1, '刚够叫分');
    assert.equal(at(84), 1, '超出 44 分，还没到下一级');
    assert.equal(at(85), 2, '超出 45 分，进 2 级');
    assert.equal(at(130), 3);
    assert.equal(at(175), 4);
    assert.equal(at(200), 4, '封顶 4 级，不会到 5');
  });
});

describe('computeSettlement / 级数增减是零和', () => {
  it('四家级数增减加起来必须是 0（谁多赢一级就有人多输一级）', () => {
    const cases: Array<Partial<SettlementInput>> = [
      { lastTrickWinner: 0, trickScores: [0, 0, 0, 0], callScore: 100 },       // 庄家 4 级
      { lastTrickWinner: 0, trickScores: [0, 45, 0, 0], callScore: 100 },      // 庄家 1 级
      { lastTrickWinner: 1, trickScores: [0, 120, 0, 0], callScore: 100 },     // 闲家赢
      { lastTrickWinner: 2, winningCards: [tianWang(), tianWang()], callScore: 125 }, // 挖底 4 级
    ];
    for (const over of cases) {
      const s = computeSettlement(baseInput(over));
      const sum = s.deltas.reduce((a, b) => a + b, 0);
      assert.equal(sum, 0, `级数增减必须零和，实际 ${JSON.stringify(s.deltas)}`);
      assert.equal(s.deltas.length, FOUR_TWO.playerCount);
    }
  });

  it('庄家赢：庄家 +3级，三个闲家各 -1级（4人局）', () => {
    const s = computeSettlement(baseInput({
      lastTrickWinner: 0, trickScores: [0, 45, 0, 0], callScore: 100,
    }));
    assert.equal(s.bankerWin, true);
    assert.equal(s.level, 1);
    assert.deepEqual(s.deltas, [3, -1, -1, -1]);
  });

  it('闲家赢：庄家 -3×级数，闲家各 +级数', () => {
    const s = computeSettlement(baseInput({
      lastTrickWinner: 1, winningCards: [tianWang(), tianWang()], callScore: 125,
    }));
    assert.equal(s.level, 4);
    assert.deepEqual(s.deltas, [-12, 4, 4, 4]);
  });

  it('庄家不在 0 号位时，负号也跟着庄家走', () => {
    const s = computeSettlement(baseInput({
      bankerSeat: 2,
      isBankerBySeat: [false, false, true, false],
      lastTrickWinner: 2,
      winningCards: [tianWang()],
      trickScores: [0, 0, 60, 0], // 60 分是庄家抓的，不算闲家
      callScore: 100,
    }));
    assert.equal(s.trickScore, 0, '座位 2 是庄家，它的 60 分不计入闲家');
    assert.equal(s.bankerWin, true);
    assert.deepEqual(s.deltas, [-4, -4, 12, -4], '庄家在 2 号位拿正数');
  });
});

describe('computeSettlement / 庄家剩牌（中途异常结束）', () => {
  it('闲家赢最后一墩时，庄家手上没打出的分牌归闲家', () => {
    const s = computeSettlement(baseInput({
      lastTrickWinner: 1,
      bankerRemainingCards: [ten(), five()], // 15 分
      trickScores: [0, 90, 0, 0],
      callScore: 100,
    }));
    assert.equal(s.remainingScore, 15);
    assert.equal(s.opponentScore, 105, '90 + 15');
    assert.equal(s.bankerWin, false, '靠剩牌分刚好过线');
  });

  it('庄家赢最后一墩时，庄家剩牌分留在庄家这边', () => {
    const s = computeSettlement(baseInput({
      lastTrickWinner: 0,
      bankerRemainingCards: [ten(), five()],
      trickScores: [0, 90, 0, 0],
      callScore: 100,
    }));
    assert.equal(s.remainingScore, 15, '分数照样算出来（要给结算面板显示）');
    assert.equal(s.opponentScore, 90, '但不加给闲家');
    assert.equal(s.bankerWin, true);
  });

  it('正常打完最后一墩：庄家无剩牌，剩牌分为 0', () => {
    const s = computeSettlement(baseInput({ bankerRemainingCards: [] }));
    assert.equal(s.remainingScore, 0);
  });
});

describe('computeSettlement / 跨模式一致（交叉读 config.ts）', () => {
  it('每种模式的总分守恒都成立，人数对得上 deltas 长度', () => {
    for (const mode of Object.values(GAME_MODES)) {
      const isBankerBySeat = Array.from({ length: mode.playerCount }, (_, i) => i === 0);
      const s = computeSettlement(baseInput({
        bankerSeat: 0,
        isBankerBySeat,
        playerCount: mode.playerCount,
        deckCount: mode.deckCount,
        totalScore: mode.totalScore,
        callScore: mode.fullLevelScore,
        trickScores: Array.from({ length: mode.playerCount }, (_, i) => (i === 1 ? 50 : 0)),
        lastTrickWinner: 0,
      }));
      assert.equal(
        s.opponentScore + s.bankerScore, mode.totalScore,
        `${mode.id} 的总分必须守恒`,
      );
      assert.equal(s.deltas.length, mode.playerCount, `${mode.id} 的 deltas 长度要等于人数`);
      assert.equal(s.deltas.reduce((a, b) => a + b, 0), 0, `${mode.id} 的级数必须零和`);
    }
  });

  it('三副牌局叫分上限 145 也能正常判赢（不是写死 125）', () => {
    const mode = GAME_MODES.fourPlayerThreeDecks;
    const s = computeSettlement(baseInput({
      deckCount: mode.deckCount,
      totalScore: mode.totalScore,
      callScore: mode.fullLevelScore, // 145
      lastTrickWinner: 1,
      trickScores: [0, 145, 0, 0],
    }));
    assert.equal(s.bankerWin, false);
    assert.equal(s.level, 1, '刚好到 145 = 赢一级');
  });
});

describe('computeSettlement / 纯函数性质', () => {
  it('同样的输入调两次，结果完全一样（不依赖外部状态）', () => {
    const input = baseInput({
      lastTrickWinner: 1,
      winningCards: [tianWang(), bigJoker()],
      bottomCards: [ten(), five()],
      bankerRemainingCards: [king()],
      trickScores: [10, 20, 30, 40],
      callScore: 100,
    });
    assert.deepEqual(computeSettlement(input), computeSettlement(input));
  });

  it('不修改传进来的数组（房间那边还要用同一批牌做广播）', () => {
    const bottom = [ten(), five()];
    const winning = [tianWang()];
    const trickScores = [0, 30, 0, 0];
    computeSettlement(baseInput({
      lastTrickWinner: 1, bottomCards: bottom, winningCards: winning, trickScores,
    }));
    assert.equal(bottom.length, 2);
    assert.equal(winning.length, 1);
    assert.deepEqual(trickScores, [0, 30, 0, 0]);
  });

  it('底牌分与 score.ts 的算法一致（不自己另算一套）', () => {
    const bottom = [ten(), king(), five(), plain()];
    const s = computeSettlement(baseInput({ lastTrickWinner: 1, bottomCards: bottom }));
    assert.equal(s.bottomScore, calcTrickScore(bottom), '必须复用 calcTrickScore');
    assert.equal(s.bottomScore, 25);
  });
});
