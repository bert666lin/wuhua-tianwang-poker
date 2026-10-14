/**
 * 发牌动画的时间预算（服务端侧）。
 *
 * 客户端「牌一张张飞进手里 → 翻面 → 自动理牌」的时间线定义在
 * client/src/components/dealAnimation.ts。服务端必须在 Phase.Dealing 上
 * 停留不短于这段时长，否则叫主面板会插进动画中间，动画会被打断。
 *
 * 两边不能互相 import（各自独立 tsconfig / 运行环境），所以这里复刻同一套
 * 常量，并由 dealTiming.test.ts 锁死数值。改动画时长时两个文件都要改。
 */

/** 单张牌飞行时长（ms），对应 DEAL_FLIGHT_MS。 */
const FLIGHT_MS = 260;
/** 发牌错峰总窗口（ms），对应 DEAL_STAGGER_WINDOW_MS。 */
const STAGGER_WINDOW_MS = 820;
/** 单张间隔上限（ms），对应 DEAL_STAGGER_MAX_MS。 */
const STAGGER_MAX_MS = 34;
/** 落桌到翻面的停顿（ms），对应 DEAL_FLIP_GAP_MS。 */
const FLIP_GAP_MS = 70;
/** 翻面时长（ms），对应 DEAL_FLIP_MS。 */
const FLIP_MS = 200;
/** 翻面逐张错峰（ms），对应 DEAL_FLIP_STAGGER_MS。 */
const FLIP_STAGGER_MS = 7;
/** 翻完到理牌的停顿（ms），对应 DEAL_SORT_GAP_MS。 */
const SORT_GAP_MS = 130;
/** 理牌位移时长（ms），对应 DEAL_SORT_MS。 */
const SORT_MS = 320;
/** 网络与渲染余量（ms）：deal 消息到达客户端也要时间。 */
const NETWORK_SLACK_MS = 220;

/**
 * 每人 perPlayer 张牌时，发牌动画需要占用的毫秒数。
 * 张数越多每张间隔越短，总时长基本恒定（24 张 ≈ 2.1s，48 张 ≈ 2.3s）。
 */
export function dealAnimationMs(perPlayer: number): number {
  const n = Math.max(1, Math.floor(perPlayer));
  const stagger = n <= 1 ? 0 : Math.min(STAGGER_MAX_MS, STAGGER_WINDOW_MS / (n - 1));
  const flyEnd = (n - 1) * stagger + FLIGHT_MS;
  const flipEnd = flyEnd + FLIP_GAP_MS + (n - 1) * FLIP_STAGGER_MS + FLIP_MS;
  const total = flipEnd + SORT_GAP_MS + SORT_MS;
  return Math.ceil(total) + NETWORK_SLACK_MS;
}
