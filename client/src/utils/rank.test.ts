// ===== 段位换算单测 =====
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RANK_TIERS, rankOf, rankIndex, isRankUp, isRankDown, rankProgress, rankLevel,
  nextRankName,
} from './rank';

describe('rankOf 档位边界', () => {
  it('0 分与负分都是青铜', () => {
    assert.equal(rankOf(0).name, '青铜');
    assert.equal(rankOf(-500).name, '青铜');
  });
  it('499 青铜 / 500 白银', () => {
    assert.equal(rankOf(499).name, '青铜');
    assert.equal(rankOf(500).name, '白银');
  });
  it('999 白银 / 1000 黄金', () => {
    assert.equal(rankOf(999).name, '白银');
    assert.equal(rankOf(1000).name, '黄金');
  });
  it('1999 黄金 / 2000 钻石', () => {
    assert.equal(rankOf(1999).name, '黄金');
    assert.equal(rankOf(2000).name, '钻石');
  });
  it('顶档 next 为 null，不再有虚构门槛', () => {
    assert.equal(rankOf(99999).next, null);
  });
  it('阶梯 min 严格递增，档位不重叠', () => {
    for (let i = 1; i < RANK_TIERS.length; i++) {
      assert.ok(RANK_TIERS[i].min > RANK_TIERS[i - 1].min);
    }
  });
  it('每档 next 等于下一档 min，不留缝隙', () => {
    for (let i = 0; i < RANK_TIERS.length - 1; i++) {
      assert.equal(RANK_TIERS[i].next, RANK_TIERS[i + 1].min);
    }
  });
});

describe('升降段判定', () => {
  it('青铜 -> 白银 算升段', () => {
    assert.equal(isRankUp(400, 600), true);
  });
  it('黄金 -> 钻石 算升段（此前用 cls 比较会漏判，两者都是金色系）', () => {
    assert.equal(isRankUp(1500, 2100), true);
    assert.notEqual(rankOf(1500).id, rankOf(2100).id);
  });
  it('同档内涨分不算升段', () => {
    assert.equal(isRankUp(1000, 1900), false);
  });
  it('掉档算降段', () => {
    assert.equal(isRankDown(1100, 800), true);
    assert.equal(isRankUp(1100, 800), false);
  });
  it('rankIndex 随分数单调不减', () => {
    let prev = -1;
    for (const s of [0, 499, 500, 999, 1000, 1999, 2000, 5000]) {
      const idx = rankIndex(s);
      assert.ok(idx >= prev);
      prev = idx;
    }
  });
});

describe('rankProgress 进度', () => {
  it('刚进本档为 0', () => {
    assert.equal(rankProgress(500), 0);
    assert.equal(rankProgress(1000), 0);
  });
  it('档位中点约 50', () => {
    assert.equal(Math.round(rankProgress(750)), 50);
  });
  it('顶档恒为 100，不会算出超过 100 的进度', () => {
    assert.equal(rankProgress(2000), 100);
    assert.equal(rankProgress(999999), 100);
  });
  it('负分不会算出负进度', () => {
    assert.equal(rankProgress(-200), 0);
  });
});

describe('rankLevel 段内小等级', () => {
  it('0 分为 1 级', () => assert.equal(rankLevel(0), 1));
  it('每 100 分升 1 级', () => {
    assert.equal(rankLevel(100), 2);
    assert.equal(rankLevel(250), 3);
  });
  it('负分不会算出 0 级或负级', () => {
    assert.equal(rankLevel(-50), 1);
  });
});

describe('nextRankName 下一段位', () => {
  it('青铜的下一档是白银', () => assert.equal(nextRankName(0), '白银'));
  it('黄金的下一档是钻石', () => assert.equal(nextRankName(1200), '钻石'));
  it('顶档返回 null，不再硬编码不存在的「王者」', () => {
    assert.equal(nextRankName(3000), null);
  });
});
