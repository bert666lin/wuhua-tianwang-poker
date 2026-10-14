// 战绩页「开房记录」分组的测试。
// 分组规则里每一条判断都有明确对错（老记录怎么归、同毫秒怎么排、
// 累计怎么算），埋在页面 JSX 里就没法测，所以先抽成纯函数再测这里。

import test from 'node:test';
import assert from 'node:assert/strict';
import { groupByRoom, summarizeRooms, type GroupableRound } from './recordGroups.js';

/** 造一局记录，只写关心的字段。 */
function rd(over: Partial<GroupableRound> & { id: string }): GroupableRound {
  return {
    timestamp: 1_700_000_000_000,
    mode: '4人 3副',
    iWon: true,
    iAmBanker: false,
    level: 1,
    scoreDelta: 1,
    coins: 0,
    isCardRoom: false,
    roomId: 'R1',
    roomRoundNo: 1,
    ...over,
  };
}

test('同一房间的多局收成一桌，累计级数是各局之和', () => {
  const groups = groupByRoom([
    rd({ id: 'a', roomId: 'R1', roomRoundNo: 1, scoreDelta: 3, level: 3, iWon: true, iAmBanker: true }),
    rd({ id: 'b', roomId: 'R1', roomRoundNo: 2, scoreDelta: -2, level: 2, iWon: false }),
    rd({ id: 'c', roomId: 'R1', roomRoundNo: 3, scoreDelta: 1, level: 1, iWon: true }),
  ]);
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.roundCount, 3);
  assert.equal(g.wins, 2);
  assert.equal(g.losses, 1);
  assert.equal(g.winRate, 67);
  assert.equal(g.levelDelta, 2, '3 - 2 + 1 = 2');
  assert.equal(g.bankerCount, 1);
  assert.equal(g.bestLevel, 3, '最大赢级只看赢的那几局');
  assert.equal(g.headline, '3 局 · 赢 2 级');
});

test('输的那桌 headline 说「输 N 级」而不是负号', () => {
  const [g] = groupByRoom([
    rd({ id: 'a', scoreDelta: -3, iWon: false }),
    rd({ id: 'b', roomRoundNo: 2, scoreDelta: -1, iWon: false }),
  ]);
  assert.equal(g.levelDelta, -4);
  assert.equal(g.headline, '2 局 · 输 4 级');
});

test('不输不赢的桌子不写成「赢 0 级」', () => {
  const [g] = groupByRoom([
    rd({ id: 'a', scoreDelta: 2, iWon: true }),
    rd({ id: 'b', roomRoundNo: 2, scoreDelta: -2, iWon: false }),
  ]);
  assert.equal(g.headline, '2 局 · 不输不赢');
});

test('输赢只看级数不看胜负标记：赢一局大的照样能盖住输两局小的', () => {
  const [g] = groupByRoom([
    rd({ id: 'a', scoreDelta: 4, iWon: true, level: 4 }),
    rd({ id: 'b', roomRoundNo: 2, scoreDelta: -1, iWon: false, level: 1 }),
    rd({ id: 'c', roomRoundNo: 3, scoreDelta: -1, iWon: false, level: 1 }),
  ]);
  assert.equal(g.wins, 1, '胜率是 1/3');
  assert.equal(g.winRate, 33);
  assert.equal(g.levelDelta, 2, '但级数是赢的');
});

test('不同房间分成不同桌，最近打完的桌在最前面', () => {
  const groups = groupByRoom([
    rd({ id: 'a', roomId: 'OLD', timestamp: 1000 }),
    rd({ id: 'b', roomId: 'NEW', timestamp: 9000 }),
    rd({ id: 'c', roomId: 'MID', timestamp: 5000 }),
  ]);
  assert.deepEqual(groups.map(g => g.roomId), ['NEW', 'MID', 'OLD']);
});

test('没有房间号的老记录全归一组「早期记录」，且永远垫底', () => {
  const groups = groupByRoom([
    // 老记录时间最新，但仍要排在有房号的桌子后面
    rd({ id: 'x', roomId: '', roomRoundNo: 0, timestamp: 9_999_999 }),
    rd({ id: 'y', roomId: '', roomRoundNo: 0, timestamp: 9_999_998 }),
    rd({ id: 'a', roomId: 'R1', timestamp: 1000 }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].roomId, 'R1', '有房号的桌子在前');
  const legacy = groups[1];
  assert.ok(legacy.isLegacy);
  assert.equal(legacy.roomLabel, '早期记录');
  assert.equal(legacy.roundCount, 2, '老记录不能各自算成"一桌一局"');
});

test('组内按局号倒序，同毫秒落库也不会顺序乱跳', () => {
  const ts = 1_700_000_000_000;
  const [g] = groupByRoom([
    rd({ id: 'r2', roomRoundNo: 2, timestamp: ts }),
    rd({ id: 'r5', roomRoundNo: 5, timestamp: ts }),
    rd({ id: 'r1', roomRoundNo: 1, timestamp: ts }),
    rd({ id: 'r3', roomRoundNo: 3, timestamp: ts }),
  ]);
  assert.deepEqual(g.rounds.map(r => r.roomRoundNo), [5, 3, 2, 1]);
});

test('老记录组内没有局号时退回按时间倒序', () => {
  const [g] = groupByRoom([
    rd({ id: 'a', roomId: '', roomRoundNo: 0, timestamp: 100 }),
    rd({ id: 'b', roomId: '', roomRoundNo: 0, timestamp: 300 }),
    rd({ id: 'c', roomId: '', roomRoundNo: 0, timestamp: 200 }),
  ]);
  assert.deepEqual(g.rounds.map(r => r.id), ['b', 'c', 'a']);
});

test('起止时间取组内最早和最晚，不受输入顺序影响', () => {
  const [g] = groupByRoom([
    rd({ id: 'b', roomRoundNo: 2, timestamp: 5000 }),
    rd({ id: 'a', roomRoundNo: 1, timestamp: 1000 }),
    rd({ id: 'c', roomRoundNo: 3, timestamp: 3000 }),
  ]);
  assert.equal(g.startedAt, 1000);
  assert.equal(g.endedAt, 5000);
});

test('一桌里有房卡局记录就整桌算朋友局（金币栏要显示原因而不是 0）', () => {
  const [g] = groupByRoom([
    rd({ id: 'a', isCardRoom: true, coins: 0 }),
    rd({ id: 'b', roomRoundNo: 2, isCardRoom: true, coins: 0 }),
  ]);
  assert.equal(g.isCardRoom, true);
  assert.equal(g.coinsDelta, 0);
});

test('金币按桌累加，输的局是负数要能抵掉赢的', () => {
  const [g] = groupByRoom([
    rd({ id: 'a', coins: 410 }),
    rd({ id: 'b', roomRoundNo: 2, coins: -200, iWon: false, scoreDelta: -2 }),
  ]);
  assert.equal(g.coinsDelta, 210);
});

test('同一房号跨模式时取局数最多的那个模式（房主解散重开会复用房号）', () => {
  const [g] = groupByRoom([
    rd({ id: 'a', mode: '4人 3副' }),
    rd({ id: 'b', roomRoundNo: 2, mode: '4人 3副' }),
    rd({ id: 'c', roomRoundNo: 3, mode: '3人 2副' }),
  ]);
  assert.equal(g.mode, '4人 3副');
});

test('长房号截断显示，短房号原样显示', () => {
  const [long] = groupByRoom([rd({ id: 'a', roomId: 'xK3mQp7Ztabc' })]);
  assert.equal(long.roomLabel, 'xK3mQp7Z…');
  const [short] = groupByRoom([rd({ id: 'b', roomId: '682134' })]);
  assert.equal(short.roomLabel, '682134');
});

test('空列表不炸，总览给空串让调用方跳过渲染', () => {
  const groups = groupByRoom([]);
  assert.deepEqual(groups, []);
  const s = summarizeRooms(groups);
  assert.equal(s.roomCount, 0);
  assert.equal(s.text, '');
});

test('总览统计桌数和总局数', () => {
  const groups = groupByRoom([
    rd({ id: 'a', roomId: 'R1', roomRoundNo: 1 }),
    rd({ id: 'b', roomId: 'R1', roomRoundNo: 2 }),
    rd({ id: 'c', roomId: 'R2', roomRoundNo: 1 }),
  ]);
  const s = summarizeRooms(groups);
  assert.equal(s.roomCount, 2);
  assert.equal(s.roundCount, 3);
  assert.equal(s.text, '2 桌 · 共 3 局');
});
