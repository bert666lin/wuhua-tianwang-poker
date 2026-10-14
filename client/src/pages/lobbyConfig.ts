// ===== 大厅静态配置与纯函数 =====
// 从 Lobby.tsx 抽出（原文件 1503 行，模式表/场次表/文案函数和 800 行 JSX 混在一起，
// 改一句文案要在长文件里翻半天，且这些纯逻辑没法单测）。
// 这一层不含 React 与 CSS，可以直接用 node:test 断言。

import {
  SpadeIcon, HeartIcon, DiamondIcon, ClubIcon, StarIcon, FlameIcon,
} from '../components/icons';

export type Tab = 'play' | 'rooms' | 'shop' | 'rank' | 'records' | 'me';

export interface LobbyMode {
  id: string;
  label: string;
  deck: string;
  sub: string;
  players: number;
  bottom: number;
  icon: typeof SpadeIcon;
  hot: boolean;
}

/**
 * 玩法模式表。
 *
 * label 跟经典大厅（ClassicHall）统一成「三人模式」这套中文写法；
 * 副数放到 deck 字段单独展示，避免「3人 2副」这种一行塞两个维度、
 * 在窄横屏的模式按钮里挤成两行。
 *
 * ❗ id / players / bottom 必须与服务端 server/src/logic/config.ts 的
 * GAME_MODES 对齐 —— 服务端才是权威，这里对不上会让玩家看到的张数与实发不符。
 */
export const MODES: LobbyMode[] = [
  { id: 'threePlayerTwoDecks',   label: '三人模式', deck: '2副', sub: '32张/人', players: 3, bottom: 12, icon: SpadeIcon,   hot: false },
  { id: 'threePlayerThreeDecks', label: '三人模式', deck: '3副', sub: '48张/人', players: 3, bottom: 18, icon: HeartIcon,   hot: true  },
  { id: 'fourPlayerTwoDecks',    label: '四人模式', deck: '2副', sub: '24张/人', players: 4, bottom: 12, icon: DiamondIcon, hot: false },
  { id: 'fourPlayerThreeDecks',  label: '四人模式', deck: '3副', sub: '36张/人', players: 4, bottom: 18, icon: ClubIcon,    hot: false },
  { id: 'fivePlayerThreeDecks',  label: '五人模式', deck: '3副', sub: '29张/人', players: 5, bottom: 17, icon: StarIcon,    hot: false },
  { id: 'sixPlayerThreeDecks',   label: '六人模式', deck: '3副', sub: '24张/人', players: 6, bottom: 18, icon: FlameIcon,   hot: false },
];

export const CLASSIC_MODE_ID = 'fourPlayerThreeDecks';

/**
 * 场次名与入场门槛，仅用于建房弹窗里说清「金币局 vs 房卡局」的区别。
 *
 * ❗ 必须与服务端 `server/src/data/economy.ts` 的 ROOM_TIERS 一致。
 * 服务端才是权威（真正的入场校验在那边），这里只是文案。
 */
export const TIER_LABELS: Record<string, { name: string; entry: number }> = {
  easy:   { name: '初级场', entry: 1_000 },
  mid:    { name: '中级场', entry: 5_000 },
  high:   { name: '高级场', entry: 20_000 },
  master: { name: '大师场', entry: 100_000 },
};

/** 按 id 取模式，认不出时回落到经典场（绝不返回 undefined，调用方不必处理空）。 */
export function modeById(id: string): LobbyMode {
  return MODES.find(m => m.id === id)
    ?? MODES.find(m => m.id === CLASSIC_MODE_ID)
    ?? MODES[0];
}

/** 某模式的座位数，用于匹配页显示「1/3 位玩家」。认不出按 4 人算。 */
export function seatsOfMode(id: string): number {
  return MODES.find(m => m.id === id)?.players ?? 4;
}

/**
 * 快速开始按钮上的模式名。
 *
 * 必须带副数：label 现在不含副数（「三人模式」），但 3 人有 2 副/3 副两档，
 * 不带副数两个玩法会显示成同一个名字分不出来。
 * 也不能再加「· 经典」——那是冗余的（快速开始只走经典场），加上后小字在
 * 手机横屏（--u≈0.63px、字号 ~9px）下会超过按钮左侧可用宽度而折成两行。
 */
export function modeLabelWithDeck(id: string): string {
  const m = modeById(id);
  return `${m.label} ${m.deck}`;
}

/** 场次文案，认不出回落初级场（与服务端 tierOf 的回落口径一致）。 */
export function tierLabel(tier: string): { name: string; entry: number } {
  return TIER_LABELS[tier] ?? { name: '初级场', entry: 1_000 };
}

/**
 * 在玩人数文案。0 人时不吹牛，直接说"可以自己开局带 AI"，
 * 免得玩家点进去发现空场以为坏了。
 *
 * 文案必须短：模式卡在手机端只有 127px 宽，去掉左右内边距和状态圆点后
 * 只剩 ~94px 可用。原文案「暂无人在玩 · 可带 AI 开局」实测要 121px，
 * 会被 ellipsis 截成「…可带 AI…」，反而把最关键的"能开局"吞掉了。
 */
export function peopleText(n: number | undefined): string {
  if (n === undefined) return '';
  if (n === 0) return '可带 AI 开局';
  return `${n} 人正在玩`;
}

/** 顶栏金币显示：过万折成「1.2万」，否则千分位。 */
export function formatCoins(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString();
}

/**
 * 当前页面的「干净」首页地址，用于分享链接。
 * 必须剥掉 search 与 hash：邀请链接自带 ?room=123456，
 * 不剥的话分享出去的是「带着别人房间号」的链接。
 */
export function gameHomeUrl(): string {
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'https://wuhua.example.com/';
  }
}
