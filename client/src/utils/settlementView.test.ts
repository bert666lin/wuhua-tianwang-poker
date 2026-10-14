import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AuctionEntry, Card } from '../types';
import {
  describeBottomFate, summarizeAuction, buildLastTrickColumns, buildHeadline,
  auctionSuitGlyph,
} from './settlementView.js';

const clientSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settlementSource = readFileSync(path.join(clientSrc, 'components/Settlement.tsx'), 'utf8');
const settlementCss = readFileSync(path.join(clientSrc, 'styles/settlement.css'), 'utf8');

test('结算首屏直接显示本局金币，不再埋在折叠明细里', () => {
  assert.match(settlementSource, /className="settle-hero-reward"/);
  assert.match(settlementSource, /本局金币/);
  assert.match(settlementSource, /coinsDelta === undefined/);
  assert.match(settlementCss, /\.settle-hero-reward\s*\{/);
});

test('下一局仍是固定操作区的主按钮', () => {
  assert.match(settlementSource, /settle-actions[\s\S]*settle-btn settle-btn-primary/);
  assert.match(settlementCss, /\.settle-actions\s*\{[\s\S]*position:\s*relative/);
});

const card = (id: string): Card => ({ id, suit: 'spade', rank: 'A' });

// ===== 底牌归属 =====

test('庄家守住最后一墩：底牌分不计入闲家', () => {
  const fate = describeBottomFate({
    bottomScore: 25, bottomCards: [card('a'), card('b')],
    bottomTaken: false, digSuccess: false, digGuaranteeLevel: 0,
  });
  assert.equal(fate.toOpponent, false);
  assert.equal(fate.badge, '庄家守住');
  assert.match(fate.reason, /不计入闲家/);
  assert.equal(fate.score, 25);
  assert.equal(fate.count, 2);
});

test('闲家用普通牌赢最后一墩：底牌分照样归闲家，但没有保底级', () => {
  const fate = describeBottomFate({
    bottomScore: 20, bottomCards: [card('a')],
    bottomTaken: true, digSuccess: false, digGuaranteeLevel: 0,
  });
  assert.equal(fate.toOpponent, true);
  assert.equal(fate.badge, '归闲家');
  // 这条最容易被误解成"没挖底所以底牌分不算"，文案必须说清
  assert.match(fate.reason, /没有保底级/);
});

test('闲家用天王赢最后一墩：挖底成功，底牌分 + 保底级', () => {
  const fate = describeBottomFate({
    bottomScore: 20, bottomCards: [card('a')],
    bottomTaken: true, digSuccess: true, digGuaranteeLevel: 3,
  });
  assert.equal(fate.badge, '挖底成功');
  assert.match(fate.reason, /保底 3 级/);
});

// ===== 叫主 / 抢主 / 叫分 =====

const entry = (e: Partial<AuctionEntry>): AuctionEntry => ({
  kind: 'pass_suit', seatIndex: 255, playerName: '', suit: 255, sevenCount: 0, score: 0, ...e,
});

test('抢主之后，定主的人是抢主的那个，不是最先叫的那个', () => {
  const s = summarizeAuction([
    entry({ kind: 'call_suit', seatIndex: 0, playerName: '老王', suit: 0, sevenCount: 1 }),
    entry({ kind: 'steal_suit', seatIndex: 2, playerName: '阿强', suit: 1, sevenCount: 2 }),
    entry({ kind: 'pass_suit', seatIndex: 3, playerName: '翠花' }),
  ]);
  assert.equal(s.suitOwner?.playerName, '阿强');
  assert.equal(s.suitOwner?.sevenCount, 2);
  assert.equal(s.suit, 1);
  assert.equal(s.stealCount, 1);
  assert.equal(s.fromBottom, false);
});

test('叫分往下叫，最后一个叫的人坐庄', () => {
  const s = summarizeAuction([
    entry({ kind: 'bid', seatIndex: 0, playerName: '老王', score: 125 }),
    entry({ kind: 'bid', seatIndex: 1, playerName: '我', score: 120 }),
    entry({ kind: 'pass_bid', seatIndex: 2, playerName: '阿强' }),
    entry({ kind: 'bid', seatIndex: 3, playerName: '翠花', score: 115 }),
  ]);
  assert.equal(s.banker?.playerName, '翠花');
  assert.equal(s.banker?.score, 115);
});

test('无人叫主翻底定主：suitOwner 是 null 但主花色仍然确定', () => {
  const s = summarizeAuction([
    entry({ kind: 'pass_suit', seatIndex: 0, playerName: '老王' }),
    entry({ kind: 'bottom_suit', suit: 2 }),
    entry({ kind: 'bid', seatIndex: 0, playerName: '老王', score: 125 }),
  ]);
  assert.equal(s.fromBottom, true);
  assert.equal(s.suitOwner, null);
  assert.equal(s.suit, 2);
  assert.equal(s.banker?.playerName, '老王');
});

test('每条记录都带座位号（四家同名时靠名字分不清是谁）', () => {
  const s = summarizeAuction([
    entry({ kind: 'call_suit', seatIndex: 1, playerName: '游客', suit: 0, sevenCount: 1 }),
    entry({ kind: 'pass_suit', seatIndex: 2, playerName: '游客' }),
  ]);
  assert.deepEqual(s.rows.map(r => r.seatIndex), [1, 2]);
  assert.match(s.rows[0].text, /叫主 ♠/);
  assert.equal(s.rows[0].highlight, true);
  assert.equal(s.rows[1].highlight, false, '不叫的记录不该被强调');
});

test('花色符号：0-3 对应 ♠♥♦♣，255 给空串（不能画出个 undefined）', () => {
  assert.deepEqual([0, 1, 2, 3].map(auctionSuitGlyph), ['♠', '♥', '♦', '♣']);
  assert.equal(auctionSuitGlyph(255), '');
});

// ===== 最后一墩每家一列 =====

const players = [
  { seatIndex: 0, name: '老王' },
  { seatIndex: 1, name: '我' },
  { seatIndex: 2, name: '阿强' },
  { seatIndex: 3, name: '翠花' },
];

test('最后一墩从我开始按座位顺时针排（对得上牌桌方位）', () => {
  const cols = buildLastTrickColumns({
    lastTrickPlays: [
      { seat: 0, cards: [card('c0')] },
      { seat: 1, cards: [card('c1')] },
      { seat: 2, cards: [card('c2')] },
      { seat: 3, cards: [card('c3')] },
    ],
    players, mySeat: 2, bankerSeat: 0, lastTrickWinner: 3, playerCount: 4,
  });
  assert.deepEqual(cols.map(c => c.seatIndex), [2, 3, 0, 1]);
  assert.equal(cols[0].isMe, true);
  assert.equal(cols.find(c => c.seatIndex === 0)?.isBanker, true);
  assert.equal(cols.find(c => c.seatIndex === 3)?.isWinner, true);
});

test('没有最后一墩数据（老服务端/流局）时返回空数组，让调用方退回旧显示', () => {
  assert.deepEqual(buildLastTrickColumns({
    lastTrickPlays: [], players, mySeat: 0, bankerSeat: 0, lastTrickWinner: 0, playerCount: 4,
  }), []);
});

test('某家没出牌（数据不全）时跳过那一列，不画空壳', () => {
  const cols = buildLastTrickColumns({
    lastTrickPlays: [{ seat: 0, cards: [card('c0')] }, { seat: 2, cards: [card('c2')] }],
    players, mySeat: 0, bankerSeat: 0, lastTrickWinner: 0, playerCount: 4,
  });
  assert.deepEqual(cols.map(c => c.seatIndex), [0, 2]);
});

// ===== 顶部大字 =====

test('闲家赢：标题是「赢 N 级」，N 取我自己的级数变化', () => {
  const h = buildHeadline({
    result: {
      bankerWin: false, level: 3, levelDeltas: [-9, 3, 3, 3],
      callScore: 115, opponentScore: 150, bankerScore: 50,
    },
    mySeat: 1, bankerSeat: 0,
  });
  assert.equal(h.iWon, true);
  assert.equal(h.levelAbs, 3);
  assert.equal(h.title, '赢 3 级');
  assert.equal(h.gap, 35);
  assert.match(h.gapText, /超出叫分 35 分/);
});

test('庄家视角同一局：标题是「输 9 级」（庄家一人赔三家）', () => {
  const h = buildHeadline({
    result: {
      bankerWin: false, level: 3, levelDeltas: [-9, 3, 3, 3],
      callScore: 115, opponentScore: 150, bankerScore: 50,
    },
    mySeat: 0, bankerSeat: 0,
  });
  assert.equal(h.iWon, false);
  assert.equal(h.title, '输 9 级');
});

test('庄家赢：文案说的是「还差多少分」而不是「超出」', () => {
  const h = buildHeadline({
    result: {
      bankerWin: true, level: 2, levelDeltas: [6, -2, -2, -2],
      callScore: 120, opponentScore: 35, bankerScore: 165,
    },
    mySeat: 0, bankerSeat: 0,
  });
  assert.equal(h.title, '赢 6 级');
  assert.match(h.gapText, /还差 85 分/);
  assert.equal(h.bankerScore, 165);
});

test('庄家实得分不会显示成负数（异常数据也不能画出 -20 分）', () => {
  const h = buildHeadline({
    result: {
      bankerWin: false, level: 4, levelDeltas: [-12, 4, 4, 4],
      callScore: 115, opponentScore: 220, bankerScore: -20,
    },
    mySeat: 1, bankerSeat: 0,
  });
  assert.equal(h.bankerScore, 0);
});
