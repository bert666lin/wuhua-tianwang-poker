// ===== 牌阵（中央出牌区）几何 =====
// 从 TableV4.tsx 抽出，不含 React / CSS 依赖，便于 node:test 直接断言几何。
//
// 为什么要单独一层：牌阵重叠是反复回归的问题（用户两次反馈「打出来的牌盖在
// 一起」）。老实现把容器写死 `width:320u; height:250u` 并让各方位用固定像素
// 偏移，问题有两个：
//
// 1. **容器垂直居中在牌桌上，但可用空间并不居中。** 顶栏只占 56u，手牌区却占
//    236u，所以中央空档的中心比牌桌中心高 90u。容器按 top:50% 居中后，下沿
//    伸进手牌区 —— 实测自己打出的 3 张牌与手牌行相交 4920px²（基准视口）。
// 2. **一家出多张时槽位会变宽，固定偏移就撞了。** 单张时槽宽 64u 不重叠，
//    甩 3 张涨到 ~120u，实测两两相交 480px²（桌面）/ 218px²（iPhone 横屏）。
//
// 现在的做法：容器用 top/bottom 内缩**贴合真实可用空档**（不再垂直居中），
// 槽位按「三列 × 三行」的格子摆放，同列同行不会同时出现两家（见
// TRICK_PLACEMENT），因此与牌张数无关地天然不重叠。张数很多时再收紧
// 每张的步进，把槽宽压在列宽以内。

import type { SeatPosition } from './tableV4Layout';

/** 牌阵单张牌尺寸（设计稿 px，实际渲染乘 --u）。 */
export const TRICK_CARD_W_U = 64;
export const TRICK_CARD_H_U = 94;

/**
 * 容器上下内缩量（单位 u，相对牌桌顶/底）。
 *
 * 实测各视口（用探针元素量 --u 换算，注意 getPropertyValue('--u') 拿不到值时
 * 会静默退成 1，量出来就是 px 不是 u —— 别再踩这个坑）：
 *   顶栏下沿：桌面/基准 56u，iPhone 横屏 64.9u，小机横屏 66.6u（--ut 下限所致）
 *   手牌行上沿距牌桌底：四种视口一致 236u
 * 所以上内缩取 70（压过最大的 66.6 再留余量），下内缩取 242（留 6u 缝）。
 */
export const TRICK_BAND_TOP_U = 70;
export const TRICK_BAND_BOTTOM_U = 242;

/**
 * 容器宽度。
 *
 * 上限由 `.tv4-player.top` 决定 —— 那家座位是 `right: 220u`，并不在正上方，
 * 而是偏向右侧，实测左边沿在基准视口只到 721.8u（最紧的一档）。
 * 容器居中时右边沿 =(牌桌宽 + W)/2，要小于它：(1024 + W)/2 < 721.8 → W < 419.6。
 * 取 380 留约 20u 余量。左右两侧座位（内沿最多到 131.3u）余量充足。
 */
export const TRICK_WIDTH_U = 380;

/** 列间留白：三列之间的硬间隙，保证相邻列即使都摆满也不会贴上。 */
export const TRICK_COL_GUTTER_U = 12;

/** 单张牌之间的步进上限（露出宽度）。 */
export const TRICK_STEP_MAX_U = 28;

/**
 * 单个槽位的宽度上限 = (容器宽 - 两条列间留白) / 3。
 * 这是「多张牌不重叠」的关键约束：三列各自不超过它，列与列就必然隔着 gutter。
 */
export const TRICK_MAX_SLOT_W_U = (TRICK_WIDTH_U - 2 * TRICK_COL_GUTTER_U) / 3;

/**
 * 牌阵可用高度（u）。
 * 牌桌高按 u 计并非恒定：桌面 1280x720 是 720u，其余视口是 620u。
 * 取最小的 620 这一档做默认值 —— 高度最紧时不重叠，宽松时自然也不重叠。
 */
export const TRICK_BAND_H_U = 620 - TRICK_BAND_TOP_U - TRICK_BAND_BOTTOM_U;

/**
 * 每张牌的步进。张数多到会顶破列宽时按比例收紧 ——
 * 宁可牌叠得密一点，也不能让两家的牌撞在一起。
 */
export function trickCardStep(count: number): number {
  if (count <= 1) return TRICK_STEP_MAX_U;
  const fit = (TRICK_MAX_SLOT_W_U - TRICK_CARD_W_U) / (count - 1);
  return Math.min(TRICK_STEP_MAX_U, Math.max(0, fit));
}

/** 一组 count 张牌摆出来占的宽度。 */
export function trickSlotWidth(count: number): number {
  if (count <= 0) return 0;
  return TRICK_CARD_W_U + (count - 1) * trickCardStep(count);
}

export type TrickColumn = 'left' | 'center' | 'right';
export type TrickRow = 'top' | 'middle' | 'bottom';

/**
 * 各方位落在哪个格子。
 *
 * 关键约束：**同一格不能有两个方位**，且 6 人局要用满 5 个对手方位。
 * 左右两家放中行、上方三家放上行、自己放下行 —— 上/中/下三行各占一张牌高，
 * 可用空档 328u 装得下 3×94u 还余 46u，所以行与行之间必然有缝。
 */
export const TRICK_PLACEMENT: Record<SeatPosition, { col: TrickColumn; row: TrickRow }> = {
  bottom:      { col: 'center', row: 'bottom' },
  top:         { col: 'center', row: 'top' },
  left:        { col: 'left',   row: 'middle' },
  right:       { col: 'right',  row: 'middle' },
  'top-left':  { col: 'left',   row: 'top' },
  'top-right': { col: 'right',  row: 'top' },
};

/** 「先出」/「压」标签挂在牌组上方还是下方。 */
export type TrickTagPos = 'above' | 'below';

/**
 * 上行的标签必须朝下挂：朝上会顶出容器、伸进顶栏。
 * 其余行朝上挂（中/下行上方就是行间空隙，且中列与边列横向不相交，挤不到）。
 */
export function trickTagPos(pos: SeatPosition): TrickTagPos {
  return TRICK_PLACEMENT[pos].row === 'top' ? 'below' : 'above';
}

/** 槽位定位用的 CSS 值（数值单位为设计稿 px，调用方负责乘 --u）。 */
export interface TrickSlotAnchor {
  left?: number | '50%';
  right?: number;
  top?: number | '50%';
  bottom?: number;
  translateX?: boolean;
  translateY?: boolean;
}

/** 方位 -> 槽位锚点。 */
export function trickSlotAnchor(pos: SeatPosition): TrickSlotAnchor {
  const { col, row } = TRICK_PLACEMENT[pos];
  const a: TrickSlotAnchor = {};
  if (col === 'left') a.left = 0;
  else if (col === 'right') a.right = 0;
  else { a.left = '50%'; a.translateX = true; }

  if (row === 'top') a.top = 0;
  else if (row === 'bottom') a.bottom = 0;
  else { a.top = '50%'; a.translateY = true; }
  return a;
}

export interface TrickBox {
  left: number; top: number; right: number; bottom: number;
}

/**
 * 算出槽位在容器内的实际矩形，供测试断言「任意两家不相交」。
 * @param bandH 容器高度（u）；默认取标准牌桌的可用空档
 */
export function trickSlotBox(
  pos: SeatPosition,
  count: number,
  bandH: number = TRICK_BAND_H_U,
  width: number = TRICK_WIDTH_U,
): TrickBox {
  const w = trickSlotWidth(count);
  const h = TRICK_CARD_H_U;
  const { col, row } = TRICK_PLACEMENT[pos];

  let left: number;
  if (col === 'left') left = 0;
  else if (col === 'right') left = width - w;
  else left = width / 2 - w / 2;

  let top: number;
  if (row === 'top') top = 0;
  else if (row === 'bottom') top = bandH - h;
  else top = bandH / 2 - h / 2;

  return { left, top, right: left + w, bottom: top + h };
}

/** 两个矩形的相交面积（0 = 不重叠）。 */
export function overlapArea(a: TrickBox, b: TrickBox): number {
  const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return ox * oy;
}
