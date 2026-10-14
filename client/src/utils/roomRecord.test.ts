/**
 * 房间累计战绩整理的单测。
 *
 * 这份记录的全部价值在于"每次说的都一样、加起来对得上"。
 * 这里重点盯几个真会出错的地方：
 *   - 庄家打完几把就换人了，座位查不到名字时不能显示空白/undefined
 *   - 排序必须稳定，不能让行在两次渲染间乱跳
 *   - 没坐过庄的人成功率是"没有"，不是 0%
 *   - 还没打完一局就退房时，别逼人看一屏空表格
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLevelDelta, outcomeShortLabel, summarizeRoom, toRoundRows, toStandings,
  type StandingRow,
} from './roomRecord';
import type { Player, RoundRecord } from '../types';

const rec = (over: Partial<RoundRecord> = {}): RoundRecord => ({
  roundNo: 1, bankerSeat: 0, callScore: 90, bankerWin: true,
  level: 2, opponentScore: 30, outcome: 'small_bald', deltas: [6, -2, -2, -2],
  ...over,
});

const pl = (seatIndex: number, over: Partial<Player> = {}) => ({
  seatIndex,
  name: '玩家' + seatIndex,
  roomLevel: 0,
  roomBankerCount: 0,
  roomBankerWins: 0,
  ...over,
} as Pick<Player, 'seatIndex' | 'name' | 'roomLevel' | 'roomBankerCount' | 'roomBankerWins'>);

describe('outcomeShortLabel', () => {
  it('每个代号都有中文短名，不会漏出英文', () => {
    const kinds: RoundRecord['outcome'][] = ['bald', 'small_bald', 'hold', 'dig', 'over', 'flow_break'];
    for (const k of kinds) {
      const label = outcomeShortLabel(k);
      assert.ok(label.length > 0, `${k} 没有中文名`);
      assert.ok(!/[a-z_]/.test(label), `${k} 的名字里漏出了代号：${label}`);
    }
  });

  it('流局有自己的名字（不能套用光头那套说法）', () => {
    // 流局没人叫分、闲家也没分，说成「光头」是彻底的谎话。
    assert.equal(outcomeShortLabel('flow_break'), '流局');
    assert.notEqual(outcomeShortLabel('flow_break'), outcomeShortLabel('bald'));
  });
});

describe('toRoundRows', () => {
  const players = [pl(0), pl(1), pl(2), pl(3)];

  it('把座位号翻译成庄家昵称', () => {
    const rows = toRoundRows([rec({ bankerSeat: 2 })], players, 1);
    assert.equal(rows[0].bankerName, '玩家2');
  });

  it('庄家已经离桌时说「已离桌」，不留空白', () => {
    // 连打十几把中间换人是常事，这条一定会遇到。
    const rows = toRoundRows([rec({ bankerSeat: 3 })], [pl(0), pl(1)], 0);
    assert.equal(rows[0].bankerName, '已离桌');
  });

  it('座位号是 255（未知）时说「未知」而不是「已离桌」', () => {
    const rows = toRoundRows([rec({ bankerSeat: 255 })], players, 0);
    assert.equal(rows[0].bankerName, '未知');
  });

  it('myDelta 取我这个座位的级数变化', () => {
    const rows = toRoundRows([rec({ deltas: [6, -2, -2, -2] })], players, 0);
    assert.equal(rows[0].myDelta, 6);
    assert.equal(toRoundRows([rec({ deltas: [6, -2, -2, -2] })], players, 2)[0].myDelta, -2);
  });

  it('不知道我是谁时 myDelta 为 0（不能瞎猜成 0 号位）', () => {
    // 旁观 / 座位还没同步时，把 0 号位的成绩当成"我的"是最糟的错。
    assert.equal(toRoundRows([rec({ deltas: [6, -2, -2, -2] })], players, -1)[0].myDelta, 0);
    assert.equal(toRoundRows([rec({ deltas: [6, -2, -2, -2] })], players)[0].myDelta, 0);
  });

  it('deltas 比人数短时补 0，不产生 undefined', () => {
    const rows = toRoundRows([rec({ deltas: [3] })], players, 3);
    assert.equal(rows[0].myDelta, 0);
  });

  it('顺序保持服务端给的时间顺序', () => {
    const rows = toRoundRows(
      [rec({ roundNo: 1 }), rec({ roundNo: 2 }), rec({ roundNo: 3 })],
      players, 0,
    );
    assert.deepEqual(rows.map(r => r.roundNo), [1, 2, 3]);
  });
});

describe('toStandings', () => {
  it('按级数从高到低排', () => {
    const rows = toStandings([
      pl(0, { roomLevel: -6 }), pl(1, { roomLevel: 4 }), pl(2, { roomLevel: 1 }),
    ], 1);
    assert.deepEqual(rows.map(r => r.seatIndex), [1, 2, 0]);
  });

  it('同级时按座位号，保证顺序稳定（不能让行乱跳）', () => {
    const a = toStandings([pl(2), pl(0), pl(1)], 0).map(r => r.seatIndex);
    const b = toStandings([pl(1), pl(2), pl(0)], 0).map(r => r.seatIndex);
    assert.deepEqual(a, b, '同级时排序结果依赖了输入顺序');
    assert.deepEqual(a, [0, 1, 2]);
  });

  it('标出哪一行是我', () => {
    const rows = toStandings([pl(0), pl(1)], 1);
    assert.equal(rows.find(r => r.seatIndex === 1)!.isMe, true);
    assert.equal(rows.find(r => r.seatIndex === 0)!.isMe, false);
  });

  it('没坐过庄的人成功率是 null，不是 0%', () => {
    // 显示「坐庄成功率 0%」等于污蔑一个从没坐庄的人。
    const rows = toStandings([pl(0)], 0);
    assert.equal(rows[0].bankerWinRate, null);
  });

  it('坐过庄才算百分比，四舍五入到整数', () => {
    const rows = toStandings([pl(0, { roomBankerCount: 3, roomBankerWins: 2 })], 0);
    assert.equal(rows[0].bankerWinRate, 67);
  });

  it('字段缺失（老服务端没同步）时按 0 处理，不产生 NaN', () => {
    const rows = toStandings([{ seatIndex: 0, name: '甲' } as never], 0);
    assert.equal(rows[0].roomLevel, 0);
    assert.equal(rows[0].bankerWinRate, null);
    assert.ok(!Number.isNaN(rows[0].roomLevel));
  });
});

describe('formatLevelDelta', () => {
  it('正数带 +，负数带 -，0 不写成 +0', () => {
    assert.equal(formatLevelDelta(3), '+3');
    assert.equal(formatLevelDelta(-2), '-2');
    assert.equal(formatLevelDelta(0), '0');
  });
});

describe('summarizeRoom', () => {
  const mk = (level: number): StandingRow[] => ([{
    seatIndex: 1, name: '我', isMe: true, roomLevel: level,
    bankerCount: 0, bankerWins: 0, bankerWinRate: null,
  }]);

  it('还没打完一局时标 isEmpty，别逼人看空表格', () => {
    const s = summarizeRoom(0, mk(0));
    assert.equal(s.isEmpty, true);
    assert.match(s.headline, /还没打完/);
  });

  it('赢了说赢几级', () => {
    const s = summarizeRoom(5, mk(3));
    assert.equal(s.isEmpty, false);
    assert.equal(s.headline, '打了 5 局，你赢 3 级');
  });

  it('输了说输几级（不显示负号让人算减法）', () => {
    assert.equal(summarizeRoom(4, mk(-2)).headline, '打了 4 局，你输 2 级');
  });

  it('不输不赢单独一句', () => {
    assert.equal(summarizeRoom(2, mk(0)).headline, '打了 2 局，你不输不赢');
  });

  it('桌上找不到我时按 0 级处理，不崩', () => {
    const s = summarizeRoom(3, []);
    assert.equal(s.myLevel, 0);
    assert.match(s.headline, /不输不赢/);
  });
});
