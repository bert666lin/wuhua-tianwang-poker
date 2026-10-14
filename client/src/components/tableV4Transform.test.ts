// 数据转换纯函数单测。
// 重点覆盖历史回归：
//  - toV4Players 曾写死 3 个对手，5/6 人局玩家看不到其他人
//  - 用 players.length 而不是模式人数会让等待阶段方位跳动
//  - toTrickPlays 相对座位算错会导致出的牌摆到别人位置
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toHandCard, toV4Players, toTrickPlays, toV4Phase,
  getMainActionText, getMainAction, isMainActionBlocked, symToSuit, suitToSym, suitName,
} from './tableV4Transform';
import type { Player, Card, Suit, GamePhase } from '../types';

function mkPlayer(seatIndex: number, over: Partial<Player> = {}): Player {
  return {
    id: 'p' + seatIndex, name: '玩家' + seatIndex, seatIndex,
    isBanker: false, score: 0, takenScore: 0, handCount: 10,
    isReady: true, isCalling: false, isOffline: false, isAI: true,
    isOwner: false, isAutoPlay: false, isTrusteeByOffline: false,
    // 房间累计战绩：默认 0，需要时用 over 覆盖
    roomLevel: 0, roomBankerCount: 0, roomBankerWins: 0,
    ...over,
  };
}
const card = (suit: Suit, rank: any, id: string): Card => ({ suit, rank, id });
const fullTable = (n: number) => Array.from({ length: n }, (_, i) => mkPlayer(i));

describe('toV4Players', () => {
  it('各人数都渲染出 人数-1 个对手（曾写死 3 个）', () => {
    for (const n of [3, 4, 5, 6]) {
      const out = toV4Players(fullTable(n), 0, n);
      assert.equal(out.length, n - 1, `${n} 人局只渲染了 ${out.length} 个对手`);
    }
  });

  it('对手方位互不重复', () => {
    for (const n of [3, 4, 5, 6]) {
      for (let my = 0; my < n; my++) {
        const pos = toV4Players(fullTable(n), my, n).map(p => p.position);
        assert.equal(new Set(pos).size, pos.length, `n=${n} my=${my} 方位重复: ${pos.join(',')}`);
      }
    }
  });

  it('自己不出现在对手列表里', () => {
    for (const n of [3, 4, 5, 6]) {
      for (let my = 0; my < n; my++) {
        const ids = toV4Players(fullTable(n), my, n).map(p => p.id);
        assert.ok(!ids.includes('p' + my), `n=${n} my=${my} 把自己画成对手了`);
      }
    }
  });

  it('等待阶段人未坐满时，已入座玩家的方位不随人数变化而跳动', () => {
    // 6 人局只坐了 0 和 2：座位 2 的方位应该和坐满时一致
    const partial = toV4Players([mkPlayer(0), mkPlayer(2)], 0, 6);
    const full = toV4Players(fullTable(6), 0, 6);
    const seat2Partial = partial.find(p => p.id === 'p2');
    const seat2Full = full.find(p => p.id === 'p2');
    assert.ok(seat2Partial, '未坐满时座位 2 应该被渲染');
    assert.equal(seat2Partial!.position, seat2Full!.position);
  });

  it('庄家/AI/真人的标签与色阶区分正确', () => {
    const players = [
      mkPlayer(0),
      mkPlayer(1, { isBanker: true, isAI: false }),
      mkPlayer(2, { isAI: true }),
      mkPlayer(3, { isAI: false }),
    ];
    const out = toV4Players(players, 0, 4);
    const byId = Object.fromEntries(out.map(p => [p.id, p]));
    assert.equal(byId.p1.rankLabel, '庄家');
    assert.equal(byId.p1.rankLevel, 'red');
    assert.equal(byId.p2.rankLabel, '电脑');
    assert.equal(byId.p2.rankLevel, 'blue');
    assert.equal(byId.p3.rankLevel, 'green');
  });

  it('AI 当庄时"电脑"身份不能被"庄家"盖掉', () => {
    // AI 现在用中文昵称（老王/阿强…），一旦标签只显示"庄家"，
    // 玩家就会以为坐庄的是真人。两个身份必须同时露出来。
    const out = toV4Players([mkPlayer(0), mkPlayer(1, { isAI: true, isBanker: true })], 0, 4);
    const p1 = out.find(p => p.id === 'p1')!;
    assert.equal(p1.rankLabel, '电脑·庄家');
    assert.equal(p1.rankLevel, 'red', '庄家仍然用红色突出');
  });

  it('handCount 与本局抓分透传，用于显示剩余张数', () => {
    const out = toV4Players([mkPlayer(0), mkPlayer(1, { handCount: 7, takenScore: 45 })], 0, 4);
    const p1 = out.find(p => p.id === 'p1')!;
    assert.equal(p1.handCount, 7);
    assert.equal(p1.coins, 45);
  });
});

describe('主操作按钮是否禁用', () => {
  it('结算面板收起后「下一局」始终可点，不受上一墩 currentTurn 残留值影响', () => {
    assert.equal(isMainActionBlocked('settling', false), false);
    assert.equal(isMainActionBlocked('flow_end', false), false);
  });

  it('真正出牌时仍只有轮到自己才可点', () => {
    assert.equal(isMainActionBlocked('playing', false), true);
    assert.equal(isMainActionBlocked('playing', true), false);
  });
});

describe('toTrickPlays', () => {
  it('自己出的牌相对座位为 0', () => {
    const out = toTrickPlays({ 2: [card('spade', 'A', 'a1')] }, 2, 4);
    assert.equal(out.length, 1);
    assert.equal(out[0].seat, 0);
  });

  it('相对座位随人数正确绕圈，且不越界', () => {
    for (const n of [3, 4, 5, 6]) {
      const plays: Record<number, Card[]> = {};
      for (let s = 0; s < n; s++) plays[s] = [card('heart', 'K', `c${s}`)];
      for (let my = 0; my < n; my++) {
        const seats = toTrickPlays(plays, my, n).map(p => p.seat);
        assert.equal(new Set(seats).size, n, `n=${n} my=${my} 相对座位碰撞`);
        assert.ok(seats.every(s => s >= 0 && s < n), `n=${n} my=${my} 越界: ${seats}`);
      }
    }
  });

  it('空出牌不产生条目，避免画空牌位', () => {
    assert.deepEqual(toTrickPlays({ 0: [], 1: [] }, 0, 4), []);
  });
});

describe('toHandCard', () => {
  it('大小王转成中文角标且标记 isJoker（曾显示英文 JOKER）', () => {
    const big = toHandCard(card('joker', 'big_joker', 'bj'));
    const small = toHandCard(card('joker', 'small_joker', 'sj'));
    assert.equal(big.rank, '大王');
    assert.equal(big.isJoker, true);
    assert.equal(big.jokerType, 'big');
    assert.equal(big.color, 'red');
    assert.equal(small.rank, '小王');
    assert.equal(small.jokerType, 'small');
    assert.equal(small.color, 'black');
    assert.equal(big.suit, '', '大小王不应带花色符号');
  });

  it('红黑配色按花色判定', () => {
    assert.equal(toHandCard(card('heart', 'A', '1')).color, 'red');
    assert.equal(toHandCard(card('diamond', 'A', '2')).color, 'red');
    assert.equal(toHandCard(card('spade', 'A', '3')).color, 'black');
    assert.equal(toHandCard(card('club', 'A', '4')).color, 'black');
  });

  it('id 原样保留（多副牌靠 id 去重，曾用 rank-suit 做 key 撞车）', () => {
    assert.equal(toHandCard(card('spade', '7', 'deck2-s7')).id, 'deck2-s7');
  });

  // 主牌角标：玩家反馈「不知道哪些是主牌」，尤其副花色的 7/2 长得像普通牌
  it('主牌角标覆盖主花色整门 + 所有花色的7和2 + 大小王', () => {
    const main = (c: Card) => toHandCard(c, 'spade').isMain;
    assert.equal(main(card('spade', 'K', '1')), true, '主花色牌是主');
    assert.equal(main(card('diamond', '7', '2')), true, '副花色的7也是主（最容易被误认成副牌）');
    assert.equal(main(card('heart', '2', '3')), true, '副花色的2也是主');
    assert.equal(main(card('joker', 'big_joker', '4')), true, '大王是主');
    assert.equal(main(card('joker', 'small_joker', '5')), true, '小王是主');
    assert.equal(main(card('heart', 'K', '6')), false, '副花色普通牌不是主');
    assert.equal(main(card('diamond', '3', '7')), false, '非主花色的3是普通副牌');
  });

  it('未定主时只有常主(7/2/大小王)算主牌', () => {
    assert.equal(toHandCard(card('spade', 'K', '1'), null).isMain, false);
    assert.equal(toHandCard(card('spade', '7', '2'), null).isMain, true);
    assert.equal(toHandCard(card('joker', 'big_joker', '3'), null).isMain, true);
  });

  it('天王只认主花色3，随主花色变（不是固定方块3）', () => {
    assert.equal(toHandCard(card('spade', '3', '1'), 'spade').isTianWang, true);
    assert.equal(toHandCard(card('diamond', '3', '2'), 'spade').isTianWang, false);
    assert.equal(toHandCard(card('diamond', '3', '3'), 'diamond').isTianWang, true);
    assert.equal(toHandCard(card('spade', '3', '4'), null).isTianWang, false, '未定主时没有天王');
  });

  it('牌阵的牌同样带主牌标记（对手出主还是副决定这墩能不能吃）', () => {
    const out = toTrickPlays({ 1: [card('diamond', '7', 'd7')] }, 0, 4, 'spade');
    assert.equal(out[0].cards[0].isMain, true);
  });
});

describe('toV4Players 的 isTurn（出牌人提示）', () => {
  // 回归：isTurn 字段一直存在但 toV4Players 从没赋值过，
  // 导致对手座位在「等他出牌」时零视觉反馈，玩家反馈「不知道在等谁」。
  it('activeTurn 指向的那家 isTurn 为 true，其余为 false', () => {
    const out = toV4Players(fullTable(4), 0, 4, 2);
    const on = out.filter(p => p.isTurn);
    assert.equal(on.length, 1, `应只有一家亮，实际 ${on.length} 家`);
    assert.equal(on[0].id, 'p2');
  });

  it('activeTurn 为 null 时没人亮（等待/发牌/结算阶段，currentTurn 是残留值）', () => {
    assert.ok(toV4Players(fullTable(4), 0, 4, null).every(p => p.isTurn === false));
  });

  it('轮到自己时对手全不亮（自己不在对手列表里，靠底栏 .tv4-me 提示）', () => {
    assert.ok(toV4Players(fullTable(4), 1, 4, 1).every(p => p.isTurn === false));
  });

  it('各人数下都最多只有一家亮', () => {
    for (const n of [3, 4, 5, 6]) {
      for (let my = 0; my < n; my++) {
        for (let turn = 0; turn < n; turn++) {
          const on = toV4Players(fullTable(n), my, n, turn).filter(p => p.isTurn).length;
          assert.ok(on <= 1, `n=${n} my=${my} turn=${turn} 亮了 ${on} 家`);
        }
      }
    }
  });
});

describe('toV4Players 的 isLeader（本墩首家「先出」标签）', () => {
  // isLeader 和 isTurn 是两回事：首家出完牌后「先出」标签还要留着，
  // 因为后面每一家都得照他的花色/张数跟牌；isTurn 则随轮次移动。
  it('leaderSeat 指向的那家 isLeader 为 true，其余为 false', () => {
    const out = toV4Players(fullTable(4), 0, 4, 3, 2);
    const on = out.filter(p => p.isLeader);
    assert.equal(on.length, 1, `应只有一家亮，实际 ${on.length} 家`);
    assert.equal(on[0].id, 'p2');
  });

  it('leaderSeat 为 null 时没人亮（非对战阶段服务端 trickLeader 是 255 哨兵值）', () => {
    assert.ok(toV4Players(fullTable(4), 0, 4, 1, null).every(p => p.isLeader === false));
  });

  it('本墩由自己领出时对手全不亮（自己在底栏，不进对手列表）', () => {
    assert.ok(toV4Players(fullTable(4), 1, 4, 2, 1).every(p => p.isLeader === false));
  });

  it('isLeader 与 isTurn 互不干扰：可以同时落在不同两家', () => {
    // 回归：两个标签走同一份数据，早期实现里 isLeader 曾被 activeTurn 覆盖，
    // 结果「先出」永远跟着「出牌中」跑，玩家看不出谁定的门。
    const out = toV4Players(fullTable(4), 0, 4, 3, 2);
    assert.equal(out.find(p => p.isTurn)?.id, 'p3');
    assert.equal(out.find(p => p.isLeader)?.id, 'p2');
  });

  it('同一家既是首家又轮到他时两个标记都为 true', () => {
    const out = toV4Players(fullTable(4), 0, 4, 2, 2);
    const p = out.find(x => x.id === 'p2');
    assert.equal(p?.isTurn, true);
    assert.equal(p?.isLeader, true);
  });

  it('不传第 5 个参数时默认没人亮（老调用点不会误亮标签）', () => {
    assert.ok(toV4Players(fullTable(4), 0, 4, 2).every(p => p.isLeader === false));
  });

  it('各人数下都最多只有一家亮', () => {
    for (const n of [3, 4, 5, 6]) {
      for (let my = 0; my < n; my++) {
        for (let leader = 0; leader < n; leader++) {
          const on = toV4Players(fullTable(n), my, n, null, leader).filter(p => p.isLeader).length;
          assert.ok(on <= 1, `n=${n} my=${my} leader=${leader} 亮了 ${on} 家`);
        }
      }
    }
  });
});

describe('toTrickPlays 的牌上标签（先出 / 压）', () => {
  // 用户反馈：标签只挂在头像旁边还要"先找人再对牌"，贴到牌本身上才直观。
  it('leaderSeat 指向的那一组牌 isLeader 为 true', () => {
    const out = toTrickPlays({ 1: [card('spade', 'Q', 'q')], 2: [card('spade', 'A', 'a')] }, 0, 4, null, 1, 2);
    const lead = out.filter(p => p.isLeader);
    assert.equal(lead.length, 1, `应只有一组标先出，实际 ${lead.length} 组`);
    // seat 是相对位置：绝对座位 1、我在 0，相对就是 1
    assert.equal(lead[0].seat, 1);
  });

  it('winnerSeat 指向的那一组牌 isWinner 为 true', () => {
    const out = toTrickPlays({ 1: [card('spade', 'Q', 'q')], 2: [card('spade', 'A', 'a')] }, 0, 4, null, 1, 2);
    const win = out.filter(p => p.isWinner);
    assert.equal(win.length, 1);
    assert.equal(win[0].seat, 2);
  });

  it('首家自己就是最大时不重复标「压」（只标先出）', () => {
    // 关键约定：否则同一组牌上会同时挂「先出」和「压」，
    // 玩家会以为有两家在争这一墩。
    const out = toTrickPlays({ 1: [card('spade', 'A', 'a')] }, 0, 4, null, 1, 1);
    assert.equal(out[0].isLeader, true);
    assert.equal(out[0].isWinner, false, '首家兼最大时不该标「压」');
  });

  it('两个 seat 都传 null 时不打任何标签（非对战阶段）', () => {
    const out = toTrickPlays({ 1: [card('spade', 'A', 'a')] }, 0, 4, null, null, null);
    assert.equal(out[0].isLeader, false);
    assert.equal(out[0].isWinner, false);
  });

  it('不传新参数时行为不变（老调用点不会误亮标签）', () => {
    const out = toTrickPlays({ 1: [card('spade', 'A', 'a')] }, 0, 4);
    assert.equal(out[0].isLeader, false);
    assert.equal(out[0].isWinner, false);
  });

  it('各人数下先出/压各自最多一组', () => {
    for (const n of [3, 4, 5, 6]) {
      for (let my = 0; my < n; my++) {
        const plays: Record<number, ReturnType<typeof card>[]> = {};
        for (let sx = 0; sx < n; sx++) plays[sx] = [card('spade', 'A', 'a' + sx)];
        for (let lead = 0; lead < n; lead++) {
          for (let win = 0; win < n; win++) {
            const out = toTrickPlays(plays, my, n, null, lead, win);
            assert.ok(out.filter(p => p.isLeader).length <= 1, `n=${n} 先出标了多组`);
            assert.ok(out.filter(p => p.isWinner).length <= 1, `n=${n} 压标了多组`);
          }
        }
      }
    }
  });
});

describe('phase 映射', () => {
  it('叫主/叫分都归到 calling', () => {
    assert.equal(toV4Phase('calling_suit'), 'calling');
    assert.equal(toV4Phase('calling_score'), 'calling');
  });

  it('结算阶段保持 playing，让结算 overlay 盖在牌桌上', () => {
    assert.equal(toV4Phase('settling'), 'playing');
    assert.equal(toV4Phase('flow_end'), 'playing');
  });

  it('等待归 waiting，发牌独立成阶段', () => {
    assert.equal(toV4Phase('waiting'), 'waiting');
    assert.equal(toV4Phase('dealing'), 'dealing');
  });

  it('每个阶段都有按钮文案和 action，不出现空串', () => {
    const phases: GamePhase[] = ['waiting', 'dealing', 'calling_suit', 'calling_score', 'discarding', 'playing', 'settling', 'flow_end'];
    for (const p of phases) {
      assert.ok(getMainActionText(p).length > 0, `${p} 缺按钮文案`);
      assert.ok(getMainAction(p).length > 0, `${p} 缺 action`);
    }
    assert.equal(getMainAction('discarding'), 'discard');
    assert.equal(getMainAction('playing'), 'play');
    assert.equal(getMainAction('waiting'), 'ready');
  });
});

describe('花色符号互转', () => {
  it('symToSuit 与 suitToSym 对四门牌互为逆运算', () => {
    for (const s of ['spade', 'heart', 'club', 'diamond'] as Suit[]) {
      assert.equal(symToSuit(suitToSym(s)), s);
    }
  });

  it('非法符号退回 spade 而不是 undefined', () => {
    assert.equal(symToSuit('X'), 'spade');
    assert.equal(symToSuit(''), 'spade');
  });

  it('花色中文名符合 CONTEXT.md 术语（红桃/方块，不是红心/方片）', () => {
    assert.equal(suitName('spade'), '黑桃');
    assert.equal(suitName('heart'), '红桃');
    assert.equal(suitName('diamond'), '方块');
    assert.equal(suitName('club'), '梅花');
    assert.equal(suitName(null), '');
  });
});
