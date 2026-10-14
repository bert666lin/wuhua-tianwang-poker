// ===== 房间累计战绩的整理（纯函数） =====
//
// 一桌人往往连打十几把，最常问的三句话是：
//   「我们打了几把了？」「我一共赢了几级？」「刚那把谁坐庄、几级？」
// 这些答案必须每次都一致 —— 牌桌顶栏、记录面板、退房清单三处显示的数字
// 只要有一处对不上，玩家就再也不信这份记录了。所以口径全部收在这里。
//
// 只放"事实"，不放 className / 动画时长这类渲染细节。

import type { Player, RoundRecord } from '../types';

// ===== 逐局一行 =====

export interface RoundRow {
  roundNo: number;
  /** 庄家昵称；查不到座位时给「已离桌」而不是空字符串。 */
  bankerName: string;
  bankerSeat: number;
  /** 战果中文名，如「光头」「保底成功」「流局」。 */
  outcomeLabel: string;
  /** 战果代号，用来选样式。文案会改，代号不会。 */
  outcome: RoundRecord['outcome'];
  /** 庄家是否赢。流局按「庄家输」算（背锅的那位就是输的）。 */
  bankerWin: boolean;
  level: number;
  callScore: number;
  opponentScore: number;
  /** 「我」这一局的级数增减；没有我（旁观/座位未知）时为 0。 */
  myDelta: number;
}

/**
 * 战果代号 -> 中文。
 *
 * 和 utils/outcome.ts 的 describeOutcome 有意分开：那边是结算页要的
 * 「大字 + 一句解释 + 动效强度」，这边是列表里要的一个短词。
 * 强行共用会让列表里出现「闲家用天王赢下最后一墩，保底 3 级」这种长句。
 */
const OUTCOME_LABELS: Record<RoundRecord['outcome'], string> = {
  bald: '光头',
  small_bald: '小光',
  hold: '保底成功',
  dig: '挖底成功',
  over: '闲家过庄',
  flow_break: '流局',
};

export function outcomeShortLabel(outcome: RoundRecord['outcome']): string {
  return OUTCOME_LABELS[outcome] ?? '未知';
}

/**
 * 把服务端的逐局记录翻译成能直接渲染的行。
 *
 * @param mySeat 我的座位号；传 -1 / undefined 表示"不知道我是谁"，myDelta 一律 0。
 */
export function toRoundRows(
  history: RoundRecord[],
  players: Pick<Player, 'seatIndex' | 'name'>[],
  mySeat?: number,
): RoundRow[] {
  const nameBySeat = new Map(players.map(p => [p.seatIndex, p.name]));
  return history.map(r => ({
    roundNo: r.roundNo,
    /* 打完几把之后换人是常事，所以庄家可能已经不在桌上了。
     * 这时候显示「已离桌」比显示空白或 undefined 诚实。 */
    bankerName: nameBySeat.get(r.bankerSeat) ?? (r.bankerSeat === 255 ? '未知' : '已离桌'),
    bankerSeat: r.bankerSeat,
    outcome: r.outcome,
    outcomeLabel: outcomeShortLabel(r.outcome),
    bankerWin: r.bankerWin,
    level: r.level,
    callScore: r.callScore,
    opponentScore: r.opponentScore,
    myDelta: mySeat === undefined || mySeat < 0 ? 0 : (r.deltas[mySeat] ?? 0),
  }));
}

// ===== 各家累计 =====

export interface StandingRow {
  seatIndex: number;
  name: string;
  isMe: boolean;
  /** 本房间累计级数（可负）。 */
  roomLevel: number;
  bankerCount: number;
  bankerWins: number;
  /** 坐庄成功率的整数百分比；没坐过庄时为 null（而不是 0%，那是在污蔑人家）。 */
  bankerWinRate: number | null;
}

/**
 * 各家在这张桌子上的累计成绩，按级数从高到低排。
 *
 * 级数直接用服务端同步的 `roomLevel`，不用 history 现算：
 * 服务端那份是唯一真相，客户端再算一遍只会多一个出错的地方
 * （比如某局记录还没同步完，就会短暂显示一个错的总数）。
 */
export function toStandings(
  players: Pick<Player, 'seatIndex' | 'name' | 'roomLevel' | 'roomBankerCount' | 'roomBankerWins'>[],
  mySeat?: number,
): StandingRow[] {
  return players
    .map(p => ({
      seatIndex: p.seatIndex,
      name: p.name,
      isMe: p.seatIndex === mySeat,
      roomLevel: p.roomLevel ?? 0,
      bankerCount: p.roomBankerCount ?? 0,
      bankerWins: p.roomBankerWins ?? 0,
      bankerWinRate: (p.roomBankerCount ?? 0) > 0
        ? Math.round(((p.roomBankerWins ?? 0) / (p.roomBankerCount ?? 1)) * 100)
        : null,
    }))
    // 级数高的在前；同级按座位号，保证每次渲染顺序稳定（不能让行乱跳）。
    .sort((a, b) => (b.roomLevel - a.roomLevel) || (a.seatIndex - b.seatIndex));
}

/** 带正负号的级数，如 `+3` / `-2` / `0`。0 不写成 `+0`。 */
export function formatLevelDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

// ===== 退房清单的一句话总结 =====

export interface RoomSummary {
  /** 打完几局。 */
  roundsPlayed: number;
  /** 我的累计级数。 */
  myLevel: number;
  /** 一句话总结，如「打了 5 局，你赢 3 级」。 */
  headline: string;
  /**
   * 是不是"还没打就走"。
   * true 时退房清单没什么可看的，应该直接放人走而不是逼他看一屏空表格。
   */
  isEmpty: boolean;
}

export function summarizeRoom(
  roundsPlayed: number,
  standings: StandingRow[],
): RoomSummary {
  const me = standings.find(s => s.isMe);
  const myLevel = me?.roomLevel ?? 0;
  if (roundsPlayed <= 0) {
    return {
      roundsPlayed: 0,
      myLevel: 0,
      headline: '这桌还没打完一局',
      isEmpty: true,
    };
  }
  // 说"赢/输 N 级"而不是"净 +N 级"：牌桌上没人用"净"这个字。
  const tail = myLevel > 0
    ? `你赢 ${myLevel} 级`
    : myLevel < 0
      ? `你输 ${-myLevel} 级`
      : '你不输不赢';
  return {
    roundsPlayed,
    myLevel,
    headline: `打了 ${roundsPlayed} 局，${tail}`,
    isEmpty: false,
  };
}
