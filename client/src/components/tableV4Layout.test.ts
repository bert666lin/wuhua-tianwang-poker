// 座位布局纯函数单测。
// 背景：曾经 toV4Players 写死 for(i=1;i<=3;i++)，导致 5/6 人局只渲染 3 个对手；
// 6 人局 top 与 top-right 还撞过位置。这些都是布局层能测出来的问题。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { OPPONENT_LAYOUT, opponentPositions, relativeSeat, seatPositionOf,
  type SeatPosition, groupHandCards } from './tableV4Layout';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tableSource = readFileSync(path.join(srcDir, 'components/TableV4.tsx'), 'utf8');
const tableCss = readFileSync(path.join(srcDir, 'styles/table-v4.css'), 'utf8');

describe('手机横屏比分栏', () => {
  it('庄闲分同时有完整标签和紧凑标签，不能靠模糊缩写替换所有屏幕', () => {
    assert.match(tableSource, /tv4-score-label-full[^>]*>庄家杀分</);
    assert.match(tableSource, /tv4-score-label-compact[^>]*>庄分</);
    assert.match(tableSource, /tv4-score-label-full[^>]*>闲家抓分</);
    assert.match(tableSource, /tv4-score-label-compact[^>]*>闲分</);
  });

  it('只在手机横屏切换紧凑标签，桌面仍显示完整含义', () => {
    assert.match(tableCss, /\.tv4-score-label-compact\s*\{\s*display:\s*none/);
    const compactMedia = tableCss.match(/@media \(pointer: coarse\), \(max-height: 480px\) \{([\s\S]*?)\/\* ===== 手机端一律只留左上角标/);
    assert.ok(compactMedia, '找不到手机横屏适配区');
    assert.match(compactMedia![1], /\.tv4-score-label-full\s*\{\s*display:\s*none/);
    assert.match(compactMedia![1], /\.tv4-score-label-compact\s*\{\s*display:\s*inline/);
  });
});

describe('opponentPositions', () => {
  it('每种人数的对手数 = 人数 - 1', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      assert.equal(opponentPositions(n).length, n - 1, `${n} 人局对手数不对`);
    }
  });

  it('同一局内方位不重复（重复即代表座位会重叠）', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const pos = opponentPositions(n);
      assert.equal(new Set(pos).size, pos.length, `${n} 人局方位有重复: ${pos.join(',')}`);
    }
  });

  it('对手方位不含 bottom（bottom 恒为自己）', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      assert.ok(!opponentPositions(n).includes('bottom'), `${n} 人局占用了 bottom`);
    }
  });

  it('未知人数退回 4 人局布局，不返回空数组', () => {
    for (const n of [0, 1, 7, 99, -3, NaN]) {
      assert.deepEqual(opponentPositions(n as number), OPPONENT_LAYOUT[4]);
    }
  });

  it('6 人局用满 5 个方位', () => {
    assert.deepEqual(
      [...opponentPositions(6)].sort(),
      (['left', 'right', 'top', 'top-left', 'top-right'] as SeatPosition[]).sort(),
    );
  });
});

describe('relativeSeat', () => {
  it('自己的相对座位恒为 0', () => {
    for (const n of [3, 4, 5, 6]) {
      for (let my = 0; my < n; my++) assert.equal(relativeSeat(my, my, n), 0);
    }
  });

  it('绕圈取模正确，且不出现负数', () => {
    // 4 人局，我在 2 号位：3->1, 0->2, 1->3
    assert.equal(relativeSeat(3, 2, 4), 1);
    assert.equal(relativeSeat(0, 2, 4), 2);
    assert.equal(relativeSeat(1, 2, 4), 3);
    for (const n of [3, 4, 5, 6]) {
      for (let my = 0; my < n; my++) {
        for (let s = 0; s < n; s++) {
          const r = relativeSeat(s, my, n);
          assert.ok(r >= 0 && r < n, `relativeSeat(${s},${my},${n})=${r} 越界`);
        }
      }
    }
  });

  it('一局内所有座位的相对座位互不相同', () => {
    for (const n of [3, 4, 5, 6]) {
      for (let my = 0; my < n; my++) {
        const rs = Array.from({ length: n }, (_, s) => relativeSeat(s, my, n));
        assert.equal(new Set(rs).size, n, `n=${n} my=${my} 相对座位有碰撞`);
      }
    }
  });
});

describe('seatPositionOf', () => {
  it('相对座位 0 是 bottom', () => {
    for (const n of [3, 4, 5, 6]) assert.equal(seatPositionOf(0, n), 'bottom');
  });

  it('每个座位都能映射到唯一方位，无 null', () => {
    for (const n of [3, 4, 5, 6]) {
      const posList = Array.from({ length: n }, (_, r) => seatPositionOf(r, n));
      assert.ok(posList.every(p => p !== null), `n=${n} 有座位映射不到方位`);
      assert.equal(new Set(posList).size, n, `n=${n} 方位有重复`);
    }
  });

  it('超出人数的相对座位返回 null 而不是错方位', () => {
    assert.equal(seatPositionOf(4, 4), null);
    assert.equal(seatPositionOf(6, 6), null);
  });
});

describe('groupHandCards — 手牌堆叠分组', () => {
  const C = (id: string, rank: string, suit: string) => ({ id, rank, suit });

  it('同点同花色叠成一组，count 累加', () => {
    const gs = groupHandCards([C('0-1-10', '10', 'heart'), C('1-1-10', '10', 'heart')]);
    assert.equal(gs.length, 1);
    assert.equal(gs[0].count, 2);
  });

  it('组内保留每一张的独立 id（对子/拖拉机能否选出的关键）', () => {
    const gs = groupHandCards([C('0-1-10', '10', 'heart'), C('1-1-10', '10', 'heart')]);
    assert.deepEqual(gs[0].ids, ['0-1-10', '1-1-10']);
    // 两个 id 必须不同，否则点第二张会把第一张取消掉
    assert.notEqual(gs[0].ids[0], gs[0].ids[1]);
  });

  it('同点不同花色分属不同组', () => {
    const gs = groupHandCards([C('a', '10', 'heart'), C('b', '10', 'spade')]);
    assert.equal(gs.length, 2);
  });

  it('不同点同花色分属不同组', () => {
    const gs = groupHandCards([C('a', '9', 'heart'), C('b', '10', 'heart')]);
    assert.equal(gs.length, 2);
  });

  it('三副牌里同一张出现 3 次，ids 有 3 个且互不相同', () => {
    const gs = groupHandCards([C('0-1-14', 'A', 'heart'), C('1-1-14', 'A', 'heart'), C('2-1-14', 'A', 'heart')]);
    assert.equal(gs[0].count, 3);
    assert.equal(new Set(gs[0].ids).size, 3);
  });

  it('key 取首张 id，多副牌下不会出现重复 React key', () => {
    const gs = groupHandCards([
      C('0-1-10', '10', 'heart'), C('1-1-10', '10', 'heart'),
      C('0-2-10', '10', 'spade'), C('1-2-10', '10', 'spade'),
    ]);
    assert.equal(new Set(gs.map(g => g.key)).size, gs.length);
  });

  it('保持入参顺序，不打乱排序结果', () => {
    const gs = groupHandCards([C('a', 'K', 'spade'), C('b', '3', 'heart'), C('c', 'K', 'spade')]);
    assert.deepEqual(gs.map(g => g.card.rank), ['K', '3']);
  });

  it('空手牌返回空数组', () => {
    assert.deepEqual(groupHandCards([]), []);
  });

  it('所有组的 ids 合起来等于原手牌总数，不丢牌不重复', () => {
    const cards = [
      C('0-1-10', '10', 'heart'), C('1-1-10', '10', 'heart'),
      C('0-2-14', 'A', 'spade'), C('0-3-7', '7', 'club'),
    ];
    const gs = groupHandCards(cards);
    const flat = gs.flatMap(g => g.ids);
    assert.equal(flat.length, cards.length);
    assert.equal(new Set(flat).size, cards.length);
  });
});
