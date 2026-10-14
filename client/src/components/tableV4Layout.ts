// ===== 牌桌 v4 布局纯函数 =====
// 从 TableV4.tsx / TableV4Adapter.tsx 抽出，不含 React 与 CSS 依赖，
// 便于用 node:test 直接做单元测试（历史上 5/6 人局只画 3 家、扣底张数写死
// 都是这一层的回归，必须有测试兜住）。

/** 对手座位方位：3人局用 top，6人局要用到全部 5 个方位。 */
export type SeatPosition = 'left' | 'right' | 'top' | 'top-left' | 'top-right' | 'bottom';

/**
 * 各人数下对手的方位排布（不含自己，自己固定 bottom）。
 * 顺序即"我的下一家 → 再下一家 …"，顺时针铺开。
 */
export const OPPONENT_LAYOUT: Record<number, SeatPosition[]> = {
  2: ['top'],
  3: ['right', 'left'],
  4: ['right', 'top', 'left'],
  5: ['right', 'top-right', 'top-left', 'left'],
  6: ['right', 'top-right', 'top', 'top-left', 'left'],
};

/** 取对手方位表；未知人数退回 4 人局布局。 */
export function opponentPositions(playerCount: number): SeatPosition[] {
  return OPPONENT_LAYOUT[playerCount] ?? OPPONENT_LAYOUT[4];
}

/**
 * 绝对座位号 -> 相对座位号（0 = 自己，顺时针递增）。
 * 牌阵摆放和对手方位都依赖它。
 */
export function relativeSeat(seat: number, mySeat: number, playerCount: number): number {
  return ((seat - mySeat) % playerCount + playerCount) % playerCount;
}

/** 相对座位号 -> 方位。0 恒为 bottom，其余查 OPPONENT_LAYOUT。 */
export function seatPositionOf(relative: number, playerCount: number): SeatPosition | null {
  if (relative === 0) return 'bottom';
  return opponentPositions(playerCount)[relative - 1] ?? null;
}

// ===== 手牌堆叠分组 =====

/** 分组只关心点数与花色，与具体是第几副牌无关。 */
export interface GroupableCard {
  id: string;
  rank: string;
  suit: string;
}

export interface HandGroup<T extends GroupableCard> {
  /** React key，用首张牌 id（rank-suit 在多副牌下会重复） */
  key: string;
  /** 组代表牌，仅用于渲染牌面 */
  card: T;
  count: number;
  /** 组内每张牌各自的 id，点击时必须用它定位具体那一张 */
  ids: string[];
}

/**
 * 同点数同花色的牌叠成一组显示。
 *
 * 注意：ids 必须逐张保留。历史缺陷是点击时统一回传组代表牌，
 * 导致同组第二张会重复 toggle 第一张的 id，对子与拖拉机根本选不出来。
 */
export function groupHandCards<T extends GroupableCard>(cards: T[]): HandGroup<T>[] {
  const groups: HandGroup<T>[] = [];
  const index = new Map<string, number>();
  for (const c of cards) {
    const gk = `${c.rank}-${c.suit}`;
    const hit = index.get(gk);
    if (hit !== undefined) {
      groups[hit].count += 1;
      groups[hit].ids.push(c.id);
    } else {
      index.set(gk, groups.length);
      groups.push({ key: c.id, card: c, count: 1, ids: [c.id] });
    }
  }
  return groups;
}
