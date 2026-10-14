/**
 * 牌阵（中央出牌区）几何回归测试。
 *
 * 防的是用户**两次**反馈的同一类问题：「打牌出来几家打在一起，容易盖住，
 * 重叠在一起」。历史实现把容器写死 320x250u、各方位用固定偏移，于是：
 *   - 一家甩多张时槽位变宽，实测两两相交 480px²（桌面）/218px²（iPhone 横屏）；
 *   - 容器 top:50% 垂直居中，但可用空档并不居中（顶栏 ~56-67u vs 手牌 236u），
 *     自己打出的牌与手牌行实测相交 4920px²，牌被手牌盖住。
 *
 * 这里用纯几何断言覆盖**所有人数 × 所有可能张数**（真实站点只能抽查 4 人局），
 * 真实像素已用 Playwright 在 1280/1024/844/667 四种横屏量过，全部为 0 重叠。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TRICK_PLACEMENT, TRICK_WIDTH_U, TRICK_BAND_H_U, TRICK_BAND_TOP_U, TRICK_BAND_BOTTOM_U,
  TRICK_CARD_W_U, TRICK_CARD_H_U, TRICK_MAX_SLOT_W_U, TRICK_COL_GUTTER_U,
  trickCardStep, trickSlotWidth, trickSlotBox, overlapArea, trickTagPos, trickSlotAnchor,
} from './trickLayout';
import { opponentPositions, type SeatPosition } from './tableV4Layout';

/** 某人数下同时在场的所有方位（含自己 bottom）。 */
function seatsInPlay(playerCount: number): SeatPosition[] {
  return ['bottom', ...opponentPositions(playerCount)];
}

/** 单副牌最多同门张数：3 副牌时主牌门最多也就 ~30 张，取 12 足够覆盖甩牌实战。 */
const COUNTS = [1, 2, 3, 4, 5, 6, 8, 10, 12];

describe('牌阵槽位互不重叠', () => {
  it('任意人数 × 任意张数，两家的牌都不相交', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const seats = seatsInPlay(n);
      for (const count of COUNTS) {
        for (let i = 0; i < seats.length; i++) {
          for (let j = i + 1; j < seats.length; j++) {
            const a = trickSlotBox(seats[i], count);
            const b = trickSlotBox(seats[j], count);
            assert.equal(
              overlapArea(a, b), 0,
              `${n}人局 每家${count}张：${seats[i]} 与 ${seats[j]} 重叠 ` +
              `${overlapArea(a, b)}u²（${JSON.stringify(a)} vs ${JSON.stringify(b)}）`,
            );
          }
        }
      }
    }
  });

  it('张数不同的两家也不相交（实战里各家张数一定相等，但别依赖这个）', () => {
    const seats = seatsInPlay(6);
    for (const ca of COUNTS) {
      for (const cb of COUNTS) {
        for (let i = 0; i < seats.length; i++) {
          for (let j = i + 1; j < seats.length; j++) {
            const a = trickSlotBox(seats[i], ca);
            const b = trickSlotBox(seats[j], cb);
            assert.equal(overlapArea(a, b), 0,
              `${seats[i]}(${ca}张) 与 ${seats[j]}(${cb}张) 重叠`);
          }
        }
      }
    }
  });
});

describe('槽位不溢出容器', () => {
  it('任意张数下槽宽都压在列宽以内（这才是列与列不撞的根据）', () => {
    for (const count of COUNTS) {
      assert.ok(
        trickSlotWidth(count) <= TRICK_MAX_SLOT_W_U + 1e-9,
        `${count} 张宽 ${trickSlotWidth(count)}u 超过列宽上限 ${TRICK_MAX_SLOT_W_U}u`,
      );
    }
  });

  it('三列 + 两条列间留白正好等于容器宽，容器不会被顶破', () => {
    assert.equal(TRICK_MAX_SLOT_W_U * 3 + TRICK_COL_GUTTER_U * 2, TRICK_WIDTH_U);
  });

  it('槽位左右都在容器内', () => {
    for (const count of COUNTS) {
      for (const pos of Object.keys(TRICK_PLACEMENT) as SeatPosition[]) {
        const b = trickSlotBox(pos, count);
        assert.ok(b.left >= -1e-9, `${pos} ${count}张 左溢出 ${b.left}`);
        assert.ok(b.right <= TRICK_WIDTH_U + 1e-9, `${pos} ${count}张 右溢出到 ${b.right}`);
      }
    }
  });

  it('三行牌高装得进可用空档（否则上下两行会叠）', () => {
    assert.ok(
      TRICK_CARD_H_U * 3 <= TRICK_BAND_H_U,
      `3 行牌高 ${TRICK_CARD_H_U * 3}u 装不进空档 ${TRICK_BAND_H_U}u`,
    );
  });
});

describe('容器贴合真实可用空档', () => {
  it('容器不能垂直居中：上下内缩必须不相等，否则下沿会伸进手牌区', () => {
    // 顶栏实测 56~66.6u，手牌行上沿距底 236u —— 天生不对称。
    // 一旦有人把它改回 top:50%/translateY(-50%)，这条就会挂。
    assert.notEqual(
      TRICK_BAND_TOP_U, TRICK_BAND_BOTTOM_U,
      '上下内缩相等等于垂直居中，会让自己打出的牌被手牌盖住',
    );
    assert.ok(TRICK_BAND_BOTTOM_U > TRICK_BAND_TOP_U, '手牌区在下方，下内缩必须更大');
  });

  it('下内缩要盖住手牌行（实测手牌上沿距牌桌底 236u）', () => {
    assert.ok(TRICK_BAND_BOTTOM_U >= 236, `下内缩 ${TRICK_BAND_BOTTOM_U}u 会压到手牌`);
  });

  it('上内缩要盖住最高的那档顶栏（小机横屏实测下沿 66.6u）', () => {
    assert.ok(TRICK_BAND_TOP_U >= 66.6, `上内缩 ${TRICK_BAND_TOP_U}u 会压到顶栏比分板`);
  });

  it('容器宽度不能撞到偏右的 top 座位（基准视口其左沿仅 721.8u）', () => {
    // .tv4-player.top 是 right:220u，并不在正上方。容器居中后右沿 = (1024+W)/2
    assert.ok((1024 + TRICK_WIDTH_U) / 2 < 721.8, `容器宽 ${TRICK_WIDTH_U}u 会压到 top 座位`);
  });
});

describe('每张牌的露出量', () => {
  it('张数少时露满，看得清点数花色', () => {
    assert.equal(trickCardStep(1), 28);
    assert.equal(trickCardStep(2), 28);
  });

  it('张数多时自动收紧，且永不为负（负值会让牌反向叠出槽位）', () => {
    for (const count of COUNTS) {
      const s = trickCardStep(count);
      assert.ok(s >= 0, `${count} 张步进为负: ${s}`);
      assert.ok(s <= 28, `${count} 张步进超上限: ${s}`);
    }
  });

  it('步进随张数单调不增（越多牌只会越紧，不会忽然又松开）', () => {
    for (let i = 1; i < COUNTS.length; i++) {
      assert.ok(
        trickCardStep(COUNTS[i]) <= trickCardStep(COUNTS[i - 1]) + 1e-9,
        `${COUNTS[i]} 张的步进反而比 ${COUNTS[i - 1]} 张大`,
      );
    }
  });

  it('单张时槽宽就是一张牌宽', () => {
    assert.equal(trickSlotWidth(1), TRICK_CARD_W_U);
  });
});

describe('格子分配', () => {
  it('同一人数下不存在两家占同一格（占同格必然重叠）', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const cells = seatsInPlay(n).map(p => {
        const { col, row } = TRICK_PLACEMENT[p];
        return `${col}/${row}`;
      });
      assert.equal(new Set(cells).size, cells.length, `${n}人局有两家占同一格: ${cells.join(',')}`);
    }
  });

  it('自己固定在下方中列（贴着自己手牌，符合直觉）', () => {
    assert.deepEqual(TRICK_PLACEMENT.bottom, { col: 'center', row: 'bottom' });
  });

  it('每个方位都有格子（漏一个就会渲染到左上角叠成一团）', () => {
    for (const pos of ['left','right','top','top-left','top-right','bottom'] as SeatPosition[]) {
      assert.ok(TRICK_PLACEMENT[pos], `${pos} 没有分配格子`);
      assert.ok(trickSlotAnchor(pos), `${pos} 算不出锚点`);
    }
  });
});

describe('「先出」/「压」标签', () => {
  it('牌阵上不再渲染用户名小字，只在点开大图后显示身份', () => {
    const tableSource = readFileSync(new URL('./TableV4.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(tableSource, /tv4-trick-owner/);
  });

  it('顶部一行的标签必须朝下挂，否则会伸出容器压进顶栏', () => {
    for (const pos of ['top', 'top-left', 'top-right'] as SeatPosition[]) {
      assert.equal(trickTagPos(pos), 'below', `${pos} 的标签朝上会顶进顶栏`);
    }
  });

  it('中/下行的标签朝上挂', () => {
    for (const pos of ['left', 'right', 'bottom'] as SeatPosition[]) {
      assert.equal(trickTagPos(pos), 'above');
    }
  });
});
