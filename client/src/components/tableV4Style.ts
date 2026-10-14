// ===== 牌桌 v4 的缩放单位与样式工具 =====
// 从 TableV4.tsx 抽出（原文件 1755 行）。
// 这些函数决定「设计稿 px 怎么变成屏幕尺寸」，是牌桌所有排版问题的源头，
// 单独放一层便于查证与单测（历史上的重叠/溢出 bug 都跟 --u / --ut 的差异有关）。

import type { SeatPosition } from './tableV4Layout';

/** 设计稿 px -> 等比缩放几何值（对应 CSS 的 --u）。 */
export const u = (px: number) => `calc(${px} * var(--u))`;

/**
 * 设计稿 px -> 文字缩放值。
 *
 * 三段式**故意**如此，别"简化"成一条公式：
 *   ≤11px  角标：不缩放。--u 在手机被 clamp 到 0.55px，11*0.55≈6px 根本看不清。
 *   12~23px 正文：走 --ut（曲线比 --u 平缓、下限更高）。
 *   ≥24px  展示字：走 --u，跟着布局一起缩，否则大字会顶破容器。
 *
 * ⚠ 卡片尺寸走 --u 而字号走 --ut，两者缩放曲线不同 —— 在同一个盒子里混用
 * 就会出现「屏幕越小、字相对卡片越大」，最后角标压到中央花色上
 * （叫主牌重叠的历史 bug 正是这么来的，见 callingCardStyle.test.ts）。
 * 结论：牌面内的字号一律按卡片宽度取比例，不要用这个函数。
 */
export const ut = (px: number) =>
  (px <= 11 ? `${px}px` : `calc(${px} * var(${px >= 24 ? '--u' : '--ut'}))`);

/**
 * 主按钮（.tv4-pass-btn）的尺寸变量。
 *
 * 绝不要给按钮写行内 `width`：宽度写死 + 字号按 --ut 缩放，两者缩放曲线不同，
 * 手机上「确认叫分」「不叫」这类 3~4 字文案就会顶出按钮（原来的溢出 bug）。
 * 这里只给下限宽 / 高 / 字号，实际宽度由 CSS 的 padding + nowrap 自适应撑开。
 */
export const btnVars = (minW: number, h: number, fs: number) => ({
  ['--tv4-btn-minw' as string]: u(minW),
  ['--tv4-btn-h' as string]: u(h),
  ['--tv4-btn-fs' as string]: ut(fs),
}) as React.CSSProperties;

/** 各方位头像底色。 */
export const AVATAR_BG: Record<SeatPosition, string> = {
  left:        'linear-gradient(135deg, #FED7AA, #F97316)',
  right:       'linear-gradient(135deg, #FBCFE8, #F472B6)',
  top:         'linear-gradient(135deg, #DDD6FE, #8B5CF6)',
  'top-left':  'linear-gradient(135deg, #BFDBFE, #3B82F6)',
  'top-right': 'linear-gradient(135deg, #BBF7D0, #22C55E)',
  bottom:      'linear-gradient(135deg, #FEF08A, #EAB308)',
};

/** 各方位头像占位表情。 */
export const AVATAR_EMOJI: Record<SeatPosition, string> = {
  left: '👩', right: '👨', top: '🧑', 'top-left': '🧓', 'top-right': '👱', bottom: '🧔',
};
