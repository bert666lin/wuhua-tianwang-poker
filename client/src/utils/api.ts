/**
 * 服务端 API 客户端。
 *
 * 在这之前，金币/战绩/已购全都存在浏览器 localStorage 里 —— 换个设备就归零，
 * 打开控制台就能把金币改成一百万，排行榜也只能写死假数据。
 * 这个文件是"账号真实化"的唯一出入口：所有余额、战绩、商城购买都走服务端。
 *
 * 认证：注册/登录拿到 token 存本地，后续请求带 Authorization: Bearer <token>。
 * token 一旦失效（换库、服务端重装）会收到 401，这里自动清掉并回到未登录态，
 * 由 useAccount 重新走一次游客登录，避免用户卡在"点什么都失败"的死局。
 */

import { normalizeBase, inferApiBase } from './apiBase.js';

/** 服务端返回的账号视图。 */
export interface AccountView {
  id: string;
  phone: string | null;
  nickname: string;
  authMethod: 'guest' | 'phone';
  coins: number;
  stars: number;
  /** 房卡：建朋友局（不输赢金币）的门票，一张管一整房 */
  roomCards: number;
  score: number;
  vipUntil: number;
  createdAt: number;
  lastSeenAt: number;
  isVip: boolean;
  rankName: string;
  /** 已购买的牌背/道具 id */
  owned: string[];
}

export interface AccountStats {
  totalRounds: number;
  wins: number;
  digs: number;
  totalScore: number;
  bestLevel: number;
  winRate: number;
}

export interface ShopProductView {
  id: string;
  type: 'cardback' | 'item' | 'vip' | 'star' | 'roomcard';
  name: string;
  sub?: string;
  price: number;
  days?: number;
  enabled: boolean;
}

export interface PhysicalGoodView {
  id: string;
  name: string;
  sub: string;
  stars: number;
}

export interface ShopData {
  products: ShopProductView[];
  coinsPerStar: number;
  physical: { enabled: boolean; goods: PhysicalGoodView[] };
  /** 房卡兑换价与每日免费额度 */
  roomCard: { coinsPerCard: number; exchangeMax: number; dailyFree: number };
  account: AccountView | null;
}

/** 场次底分档位，与服务端 economy.ts 的 ROOM_TIERS 一致。 */
export interface RoomTierView {
  id: 'easy' | 'mid' | 'high' | 'master';
  name: string;
  /** 底分：一局一级的基准金额 */
  stake: number;
  /** 入场门槛：金币低于此值进不去 */
  entry: number;
}

export interface ActivityData {
  signin: { streak: number; claimedToday: boolean; rewards: number[] };
  ad: { left: number; coins: number; dailyLimit: number };
  welfare: { nextAt: number | null; coins: number; cooldownHours: number };
  /** 分享送金币（服务端无法验证是否真分享，只有次数上限） */
  share: { left: number; coins: number; dailyLimit: number };
  /** 破产补助：余额低于 threshold 才能领 */
  aid: { left: number; coins: number; dailyLimit: number; threshold: number };
  /** 每日免费房卡：一天一次，一次给足 cards 张 */
  roomCard: { left: number; cards: number; dailyLimit: number; coinsPerCard: number };
  rewards: number[];
  roundReward: {
    bankerMultiplier: number;
    playerMultiplier: number;
    digBonusStakes: number;
    lossRatio: number;
    minAbs: number;
    minHumansForFullReward: number;
    botFarmingRatio: number;
  };
  tiers: RoomTierView[];
  account: AccountView;
}

/** 战绩里的同桌对手（含 AI，AI 名字带「(AI)」后缀）。 */
export interface RoundOpponent {
  name: string;
  rankName: string;
}

/**
 * 一局战绩。字段名必须与 `server/src/data/accounts.ts` 的 listRounds()
 * 返回值逐一对齐 —— 早先这里照抄了旧的本地 RoundRecord（mode / coins /
 * myDelta 这套名字），和服务端的 modeId / coinsDelta 对不上，
 * 结果 Records.tsx 只能写 `as unknown as RoundRow[]` 把类型骗过去，
 * 等于整页战绩没有类型保护。
 */
export interface RoundRow {
  id: string;
  timestamp: number;
  /** 服务端模式 id（camelCase，如 fourPlayerTwoDecks），用 getModeLabel 转中文 */
  modeId: string;
  iAmBanker: boolean;
  iWon: boolean;
  bankerWin: boolean;
  level: number;
  scoreDelta: number;
  callScore: number;
  digSuccess: boolean;
  /** 本局金币变化 */
  coinsDelta: number;
  /** 闲家本局抓到的总分 */
  opponentScore: number;
  durationSec: number;
  /** 本局打了多少墩 */
  trickCount: number;
  opponents: RoundOpponent[];
  /**
   * 是不是房卡局（朋友局）。
   * 房卡局 coinsDelta 永远为 0，战绩页要把金币欄显示成「朋友局」
   * 而不是「0」，否则玩家看到赢了却没给钱会以为是 bug。
   */
  isCardRoom: boolean;
  /**
   * 房间号（哪一桌）。战绩页按它把「同一桌连着打的几局」折叠成一条。
   * 老记录（v6 迁移之前落库的）是 ''，会被归到「早期记录」而不是硬凑成一桌。
   */
  roomId: string;
  /** 这桌的第几局（从 1 开始）。0 表示老记录没有记局号。 */
  roomRoundNo: number;
}

export interface LeaderRow {
  id: string;
  name: string;
  score: number;
  rankName: string;
  metric: number;
  rounds?: number;
  wins?: number;
  coins?: number;
}

export type LeaderKind = 'score' | 'winrate' | 'coins';

// 地址推断与 /api 前缀归一化在 utils/apiBase.ts（那边有单测）。
export const API_BASE: string = normalizeBase(import.meta.env.VITE_API_BASE || inferApiBase());

const TOKEN_KEY = 'tw_token';

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

export function setToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* 隐私模式写不了，本次会话内仍可用 */ }
  memToken = token;
}

export function clearToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* 无所谓 */ }
  memToken = '';
}

// localStorage 被禁用时的兜底：至少让当前这次会话能正常玩。
let memToken = '';
function currentToken(): string {
  return getToken() || memToken;
}

/** 401 回调：由 useAccount 注册，用于自动重新登录。 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = currentToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...(init?.headers as any) } });
  } catch {
    // 断网/服务端没起：给一句人话，别把 TypeError: Failed to fetch 抛给用户
    throw new ApiError('网络连接失败，请检查网络', 0);
  }

  let body: any = null;
  try { body = await res.json(); } catch { /* 非 JSON 响应（网关错误页）下面统一处理 */ }

  if (res.status === 401) {
    clearToken();
    onUnauthorized?.();
    throw new ApiError(body?.error ?? '登录已过期', 401);
  }
  if (!res.ok || body?.success === false) {
    throw new ApiError(body?.error ?? `请求失败(${res.status})`, res.status);
  }
  return body as T;
}

function post<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) });
}

// ===================== 账号 =====================

export async function loginGuest(nickname?: string): Promise<{ token: string; account: AccountView }> {
  const r = await post<{ token: string; account: AccountView }>('/api/auth/guest', { nickname });
  setToken(r.token);
  return r;
}

export async function loginPhone(phone: string, nickname?: string): Promise<{ token: string; account: AccountView }> {
  const r = await post<{ token: string; account: AccountView }>('/api/auth/phone', { phone, nickname });
  setToken(r.token);
  return r;
}

export function fetchMe(): Promise<{ account: AccountView; stats: AccountStats }> {
  return request('/api/me');
}

export function updateNickname(nickname: string): Promise<{ account: AccountView }> {
  return post('/api/me/nickname', { nickname });
}

// ===================== 商城 =====================

export function fetchShop(): Promise<ShopData> {
  return request('/api/shop');
}

export function buyProduct(productId: string): Promise<{ account: AccountView; product: ShopProductView }> {
  return post('/api/shop/buy', { productId });
}

export function exchangeStars(stars: number): Promise<{ account: AccountView }> {
  return post('/api/shop/exchange-star', { stars });
}

export function exchangePhysical(goodId: string): Promise<{ account: AccountView }> {
  return post('/api/shop/exchange-physical', { goodId });
}

// ===================== 活动 =====================

export async function fetchActivity(): Promise<ActivityData> {
  const data = await request<ActivityData>('/api/activity');
  // 兜底：部署时前端可能先上、后端还是旧版本，缺 roomCard 会让整个活动页白屏
  // （UI 里到处都是 activity.roomCard.left 这类直接取值）。这里补一个安全默认值，
  // left=0 会让领取按钮显示"今日已领取"而不是崩掉，等后端跟上就自然恢复。
  if (!data.roomCard) {
    data.roomCard = { left: 0, cards: 5, dailyLimit: 1, coinsPerCard: 200 };
  }
  return data;
}

export function claimSignin(): Promise<{ coins: number; streak: number; account: AccountView }> {
  return post('/api/activity/signin');
}

export function claimAdReward(): Promise<{ coins: number; left: number; account: AccountView }> {
  return post('/api/activity/ad');
}

export function claimWelfare(): Promise<{ coins: number; account: AccountView }> {
  return post('/api/activity/welfare');
}

/**
 * 分享领金币。
 * 注意：服务端**不校验是否真的分享成功**（跳到微信后就看不到结果了），
 * 只靠每日次数上限兜底。
 */
export function claimShareReward(): Promise<{ ok: boolean; coins: number; left: number; message?: string; account: AccountView }> {
  return post('/api/activity/share');
}

/** 破产补助：余额低于门槛才能领，是"输光了还能玩"的安全阀。 */
export function claimBankruptAid(): Promise<{ ok: boolean; coins: number; left: number; message?: string; account: AccountView }> {
  return post('/api/activity/aid');
}

/** 领每日免费房卡（一天一次，一次给足）。 */
export function claimDailyRoomCards(): Promise<{ ok: boolean; cards: number; left: number; message?: string; account: AccountView }> {
  return post('/api/activity/roomcard');
}

/** 金币换房卡（可一次换多张）。 */
export function exchangeRoomCards(count: number): Promise<{ account: AccountView }> {
  return post('/api/shop/exchange-roomcard', { count });
}

/**
 * 在线心跳：累加当日在线时长，供后台管理看「在线多久」。
 * 失败不影响任何玩法，所以调用方直接吞错就行。
 */
export function beatOnline(): Promise<void> {
  return post('/api/me/beat');
}

// ===================== 大厅统计 =====================

/** 在线人数（真人）与可加入房数。大厅模式卡用它替换写死的「3,872人在玩」。 */
export interface LobbyStats {
  online: number;
  waitingRooms: number;
  /** 按副数分组的在玩真人数，键是 '2' / '3' */
  byDeck: Record<string, number>;
}

export function fetchLobbyStats(): Promise<LobbyStats> {
  return request('/api/stats');
}

// ===================== 战绩 / 排行榜 =====================

export function fetchRecords(limit = 50): Promise<{ rounds: RoundRow[]; stats: AccountStats }> {
  return request(`/api/records?limit=${limit}`);
}

export function fetchLeaderboard(kind: LeaderKind): Promise<{
  kind: LeaderKind; list: LeaderRow[]; me: { id: string; rank: number | null } | null;
}> {
  return request(`/api/leaderboard?kind=${kind}`);
}

// ===================== 反馈 / 举报 =====================

/**
 * 工单（反馈或举报）。
 *
 * 这一块之前是**纯假的**：反馈页点「提交」只在前端弹一句"已提交"，
 * 内容直接丢掉，运营侧永远收不到。现在真的发到服务端存库。
 */
export interface TicketView {
  id: number;
  kind: 'feedback' | 'report';
  category: string;
  title: string;
  body: string;
  target: string;
  contact: string;
  urgent: boolean;
  /** open 待处理 / doing 处理中 / done 已处理 */
  status: 'open' | 'doing' | 'done';
  adminNote: string;
  createdAt: number;
  updatedAt: number;
}

export interface SubmitTicketInput {
  kind: 'feedback' | 'report';
  category?: string;
  title?: string;
  body: string;
  /** 举报专用：被举报的玩家昵称或房间号 */
  target?: string;
  contact?: string;
  urgent?: boolean;
}

/**
 * 提交反馈 / 举报。
 *
 * clientInfo 由这里自动带上（型号、分辨率、UA），省得让玩家手填 ——
 * BUG 单最有用的信息恰恰是这些，玩家自己也说不清。
 */
export function submitTicket(input: SubmitTicketInput): Promise<{ ticket: TicketView }> {
  const clientInfo = [
    `${screen.width}x${screen.height}@${devicePixelRatio}`,
    `vw${innerWidth}x${innerHeight}`,
    navigator.userAgent,
  ].join(' | ').slice(0, 300);
  return post('/api/tickets', { ...input, clientInfo });
}

/** 我提过的工单。反馈页的历史列表用它替换写死的假数据。 */
export function fetchMyTickets(kind?: 'feedback' | 'report'): Promise<{
  items: TicketView[]; dailyLimit: number;
}> {
  return request(`/api/tickets${kind ? `?kind=${kind}` : ''}`);
}
