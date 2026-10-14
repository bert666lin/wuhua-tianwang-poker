// ===== 牌桌 v4 数据转换纯函数 =====
// 从 TableV4Adapter.tsx 抽出。这里只做「服务端状态 -> v4 UI 数据」的映射，
// 不 import React / CSS，因此可以用 node:test 直接跑单测。
// 历史回归（5/6 人局只画 3 家、相对座位算错）都在这一层，务必保持测试覆盖。

import type { HandCardData, TableV4Player, TrickPlay } from './TableV4';
import { opponentPositions, relativeSeat } from './tableV4Layout';
import type { Player, Card, Suit, GamePhase, ActionType } from '../types';
import { getSuitSymbol, getRankLabel, isMainCard } from '../utils/cardUtils';

/**
 * 单张牌 -> v4 牌面数据。
 *
 * mainSuit 必传（可为 null，表示还没定主）：主牌角标要按它算。
 * 没定主时只有大小王和 7/2 是主牌，isMainCard 已处理这种情况。
 */
export function toHandCard(c: Card, mainSuit: Suit | null = null): HandCardData {
  const isJoker = c.suit === 'joker';
  const isRed = c.suit === 'heart' || c.suit === 'diamond' || (c.suit === 'joker' && c.rank === 'big_joker');
  return {
    id: c.id,
    rank: getRankLabel(c.rank),
    suit: isJoker ? '' : getSuitSymbol(c.suit),
    color: isRed ? 'red' : 'black',
    isJoker,
    jokerType: c.rank === 'big_joker' ? 'big' : c.rank === 'small_joker' ? 'small' : undefined,
    isMain: isMainCard(c, mainSuit),
    isTianWang: Boolean(mainSuit && c.suit === mainSuit && c.rank === '3'),
  };
}

/**
 * 座位方位转换：mySeat 固定在底部，其余玩家按人数顺时针铺开。
 * 用 playerLimit（模式人数）而不是 players.length —— 等待阶段人还没坐满，
 * 用实际人数会让方位在有人加入时整体跳动。
 *
 * activeTurn：当前该谁操作的绝对座位号，用于给对手座位打 isTurn 高亮。
 * 传 null 表示「此刻没人需要操作」（等待/发牌/结算阶段）——
 * 服务端的 currentTurn 在这些阶段是上一轮的残留值，直接用会让某家一直亮着。
 * 调用方负责按 phase 决定传号还是传 null，这一层不猜。
 *
 * leaderSeat：本墩首家（领出的人）的绝对座位号，用于打「先出」标签。
 * 同样传 null 表示不显示。服务端在非对战阶段会把 trickLeader 置成 255，
 * 那个值不对应任何座位，调用方要先过滤掉再传进来。
 */
export function toV4Players(
  players: Player[],
  mySeat: number,
  playerCount: number,
  activeTurn: number | null = null,
  leaderSeat: number | null = null,
  /**
   * 这桌打完几局。0 表示一局都还没打完，此时不给任何座位挂累计级数标签
   * —— 显示「0级」会被读成"打了但不输不赢"。
   */
  roundsPlayed = 0,
): TableV4Player[] {
  const layout = opponentPositions(playerCount);
  const result: TableV4Player[] = [];

  for (let i = 1; i < playerCount; i++) {
    const seat = (mySeat + i) % playerCount;
    const p = players.find(pl => pl.seatIndex === seat);
    if (!p) continue;
    const pos = layout[i - 1];
    if (!pos) continue;
    result.push({
      id: p.id,
      name: p.name,
      // AI 现在用中文昵称（老王/阿强…），身份必须靠这个标签说清楚，
      // 否则玩家会以为在跟真人打。AI 当庄时两个身份都要显示 ——
      // 原来 isBanker 优先级更高，AI 一坐庄标签就变"庄家"，AI 身份被盖掉了。
      rankLabel: p.isAI ? (p.isBanker ? '电脑·庄家' : '电脑') : (p.isBanker ? '庄家' : '普通III'),
      rankLevel: p.isBanker ? 'red' : p.isAI ? 'blue' : 'green',
      coins: p.takenScore,
      position: pos,
      handCount: p.handCount,
      // 轮到这家出牌。以前这个字段从来没被赋值过，导致「等谁出牌」在对手
      // 座位上零视觉反馈，玩家只能靠中央牌阵猜，反馈是「不知道在等谁」。
      isTurn: activeTurn !== null && seat === activeTurn,
      // 本墩首家。跟 isTurn 分开：首家出完牌后这个标签还要留着，
      // 因为后面每一家都得照他的花色/张数跟牌。
      isLeader: leaderSeat !== null && seat === leaderSeat,
      /* 累计级数：级数是这游戏唯一的输赢单位，"谁领先几级"该常驻在座位上，
       * 而不是藏在记录面板里。没打完一局就传 undefined（不渲染）。 */
      roomLevel: roundsPlayed > 0 ? (p.roomLevel ?? 0) : undefined,
    });
  }
  return result;
}

/**
 * 牌阵：seat 用相对位置（0=底, 1=右, 2=上, 3=左）
 *
 * leaderSeat / winnerSeat 是**绝对**座位号，用来在牌上打标签：
 *  - isLeader：这一墩是他领出的，后面每家都得照他的花色/张数跟牌
 *  - isWinner：他的牌目前压着全场（服务端的 currentWinnerSeat）
 * 用户反馈「出牌人不明显」，标签贴在玩家头像旁边还是要先找人再对牌，
 * 贴到牌本身上才够直观。两个都传 null 表示不打标签。
 * 非对战阶段服务端把这两个字段置成 255 哨兵值，调用方要先过滤再传进来。
 */
export function toTrickPlays(
  currentPlays: Record<number, Card[]>,
  mySeat: number,
  playerCount: number,
  mainSuit: Suit | null = null,
  leaderSeat: number | null = null,
  winnerSeat: number | null = null,
): TrickPlay[] {
  const result: TrickPlay[] = [];
  for (const seatStr of Object.keys(currentPlays)) {
    const seat = Number(seatStr);
    const cards = currentPlays[seat];
    if (!cards || cards.length === 0) continue;
    result.push({
      seat: relativeSeat(seat, mySeat, playerCount),
      cards: cards.map(card => toHandCard(card, mainSuit)),
      isLeader: leaderSeat !== null && seat === leaderSeat,
      /* 首家自己也可能一直是「压最大的那个」（没人压得过他）。
         这种情况下不重复打「压」标签 —— 「先出」已经说明他定的门，
         再挂一个「压」会让人以为有两家在争。只有别人压过来才显示。 */
      isWinner: winnerSeat !== null && seat === winnerSeat && seat !== leaderSeat,
    });
  }
  return result;
}

// phase -> v4 phase
export function toV4Phase(phase: GamePhase): 'calling' | 'discarding' | 'playing' | 'waiting' | 'dealing' {
  switch (phase) {
    case 'calling_suit':
    case 'calling_score':
      return 'calling';
    case 'discarding':
      return 'discarding';
    case 'playing':
      return 'playing';
    case 'settling':
    case 'flow_end':
      return 'playing'; // 结算 overlay 显示
    // 发牌阶段独立成一档：以前归到 waiting，导致发牌动画播放时
    // 中央那个大大的「准备」按钮盖在牌上，非常突兀。
    case 'dealing':
      return 'dealing';
    case 'waiting':
    default:
      return 'waiting';
  }
}

// 主按钮文字
export function getMainActionText(phase: GamePhase): string {
  switch (phase) {
    case 'waiting': return '准备';
    case 'calling_suit': return '不叫';
    case 'calling_score': return '不叫';
    case 'discarding': return '放入底牌'; // 分批扣牌：一次放几张，凑够自动结算
    case 'playing': return '出牌';
    case 'settling': return '下一局';
    case 'flow_end': return '返回';
    case 'dealing': return '发牌中...';
    default: return '确定';
  }
}

// 主按钮对应的 action
export function getMainAction(phase: GamePhase): ActionType {
  switch (phase) {
    case 'waiting': return 'ready';
    case 'calling_suit': return 'pass';
    case 'calling_score': return 'pass';
    case 'discarding': return 'discard';
    case 'playing': return 'play';
    case 'settling': return 'next';
    case 'flow_end': return 'next';
    default: return 'pass';
  }
}

/** 结算阶段的 currentTurn 是上一墩残留值，不能用它禁用「下一局」。 */
export function isMainActionBlocked(phase: GamePhase, isMyTurn: boolean): boolean {
  return phase === 'playing' && !isMyTurn;
}

// 副牌花色符号 -> Suit
export function symToSuit(sym: string): Suit {
  return ({ '♠': 'spade', '♥': 'heart', '♣': 'club', '♦': 'diamond' } as Record<string, Suit>)[sym] ?? 'spade';
}

// Suit -> 花色符号
export function suitToSym(s: Suit): string {
  return ({ spade: '♠', heart: '♥', club: '♣', diamond: '♦', joker: '' } as Record<Suit, string>)[s] ?? '';
}

// 主花色名称
export function suitName(s: Suit | null): string {
  if (!s) return '';
  return { spade: '黑桃', heart: '红桃', diamond: '方块', club: '梅花', joker: '' }[s] ?? '';
}
