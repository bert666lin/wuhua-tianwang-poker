// ===== 发牌 / 理牌动画时间线 =====
// 客户端「牌一张张飞进手里 → 翻面 → 自动理牌」三段动画的唯一时间来源。
//
// 为什么单独抽一个模块：
// 1) TableV4（画面）和 TableV4Adapter（决定手牌用原始顺序还是排序后顺序）
//    必须严格对齐同一套时刻，写在两边各自的常量里迟早对不上；
// 2) 服务端的发牌阶段窗口（Phase.Dealing 停留多久）必须 ≥ 这里的总时长，
//    否则叫主面板会插进动画中间；
// 3) 纯函数，可以直接 node:test 覆盖（牌数从 24 到 48 时长都要可控）。

/** 单张牌的飞行时长（ms）。 */
export const DEAL_FLIGHT_MS = 260;
/** 全部牌的发牌错峰总窗口（ms）：牌越多每张间隔越短，总时长基本恒定。 */
export const DEAL_STAGGER_WINDOW_MS = 820;
/** 单张牌间隔上限（ms）：牌少时不要发得太慢。 */
export const DEAL_STAGGER_MAX_MS = 34;
/** 落桌到开始翻面之间的停顿（ms）。 */
export const DEAL_FLIP_GAP_MS = 70;
/** 翻面时长（ms）。 */
export const DEAL_FLIP_MS = 200;
/** 翻面的逐张错峰（ms），做出一道波浪感。 */
export const DEAL_FLIP_STAGGER_MS = 7;
/** 翻完到开始理牌之间的停顿（ms）：让人看清自己抓到什么牌。 */
export const DEAL_SORT_GAP_MS = 130;
/** 理牌（重排位移）时长（ms）。与 CSS 里的 FLIP 过渡时长保持一致。 */
export const DEAL_SORT_MS = 320;

export interface DealTimeline {
  /** 牌数 */
  count: number;
  /** 每张牌的发牌间隔 */
  stagger: number;
  /** 单张飞行时长 */
  flight: number;
  /** 最后一张落桌的时刻 */
  flyEnd: number;
  /** 开始翻面的时刻 */
  flipStart: number;
  /** 全部翻完的时刻 */
  flipEnd: number;
  /** 开始理牌（切换成排序后顺序）的时刻 */
  sortStart: number;
  /** 动画彻底结束、恢复交互的时刻 */
  total: number;
}

/**
 * 按手牌张数算出整条时间线。
 *
 * 张数差异很大（4人2副=24张，3人3副=48张），所以间隔用「固定总窗口 / 张数」
 * 反算并设上限，保证 24 张不会慢吞吞、48 张也不会拖到三秒开不了局。
 */
export function dealTimeline(count: number): DealTimeline {
  const n = Math.max(1, Math.floor(count));
  const stagger = n <= 1
    ? 0
    : Math.min(DEAL_STAGGER_MAX_MS, DEAL_STAGGER_WINDOW_MS / (n - 1));
  const flyEnd = (n - 1) * stagger + DEAL_FLIGHT_MS;
  const flipStart = flyEnd + DEAL_FLIP_GAP_MS;
  const flipEnd = flipStart + (n - 1) * DEAL_FLIP_STAGGER_MS + DEAL_FLIP_MS;
  const sortStart = flipEnd + DEAL_SORT_GAP_MS;
  return {
    count: n,
    stagger,
    flight: DEAL_FLIGHT_MS,
    flyEnd,
    flipStart,
    flipEnd,
    sortStart,
    total: sortStart + DEAL_SORT_MS,
  };
}

/**
 * 服务端发牌阶段应当停留的时长上界（ms）。
 * 取各模式里牌最多的情况（48 张）再留一点网络余量。
 */
export const DEAL_PHASE_BUDGET_MS = Math.ceil(dealTimeline(48).total) + 220;
