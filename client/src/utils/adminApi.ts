/**
 * 后台管理接口封装。
 *
 * 与玩家侧的 utils/api.ts 刻意分开：
 *   - 认证令牌不同（后台用管理员密码换的会话 token，存 sessionStorage）
 *   - 401 处理不同：玩家侧会自动开游客号，后台必须退回登录页
 *
 * 为什么用 sessionStorage 而不是 localStorage：
 * 关掉标签页就失效，比"下次打开还登着"安全。后台不是天天用的东西。
 */

import { API_BASE } from './api';

const ADMIN_TOKEN_KEY = 'tw_admin_token';

export function getAdminToken(): string {
  try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? ''; } catch { return ''; }
}

export function setAdminToken(token: string): void {
  try { sessionStorage.setItem(ADMIN_TOKEN_KEY, token); } catch { /* 隐私模式下写不进也不影响本次会话 */ }
}

export function clearAdminToken(): void {
  try { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* 同上 */ }
}

/** 401 时通知界面退回登录页。 */
let onUnauthorized: (() => void) | null = null;
export function setAdminUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  let body: any = null;
  // 后台没启用时服务端回 503，body 仍是 JSON；解析失败也要给出可读信息
  try { body = await res.json(); } catch { /* 下面按状态码兜底 */ }

  if (res.status === 401) {
    clearAdminToken();
    onUnauthorized?.();
    throw new Error(body?.error ?? '登录已过期，请重新登录');
  }
  if (!res.ok || body?.success === false) {
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  return body as T;
}

function post<T>(path: string, payload?: unknown): Promise<T> {
  return call<T>(path, { method: 'POST', body: JSON.stringify(payload ?? {}) });
}

// ===================== 类型 =====================

export interface AdminOverview {
  online: { inRooms: number; activeToday: number };
  rooms: { total: number; playing: number; cardRooms: number };
  accounts: { total: number; newToday: number };
  today: { onlineSeconds: number; rounds: number };
  economy: { totalCoins: number; totalRoomCards: number };
  serverTime: number;
}

export interface AdminPlayer {
  id: string;
  nickname: string;
  phone: string | null;
  authMethod: 'guest' | 'phone';
  coins: number;
  stars: number;
  roomCards: number;
  score: number;
  isVip: boolean;
  vipUntil: number;
  createdAt: number;
  lastSeenAt: number;
  onlineTodaySec: number;
}

export interface AdminLedgerRow {
  id: number;
  at: number;
  currency: 'coins' | 'stars' | 'roomCards';
  delta: number;
  balance: number;
  reason: string;
  memo: string | null;
}

export interface AdminRoom {
  roomId: string;
  clients: number;
  maxClients: number;
  humanCount: number | null;
  phase: string | null;
  modeId: string | null;
  tierId: string | null;
  stake: number | null;
  isCardRoom: boolean;
  hostName: string;
  participants: AdminRoomParticipant[];
  private: boolean;
  locked: boolean;
}

export interface AdminRoomParticipant {
  accountId: string | null;
  username: string;
  isAI: boolean;
}

export type GrantKind = 'coins' | 'stars' | 'roomCards';

// ===================== 接口 =====================

/** 后台是否启用（服务端配了 ADMIN_PASSWORD 才算）。不需要登录。 */
export async function fetchAdminStatus(): Promise<{ enabled: boolean }> {
  const res = await fetch(`${API_BASE}/api/admin/status`);
  const body = await res.json().catch(() => ({ enabled: false }));
  return { enabled: !!body?.enabled };
}

export async function adminLogin(password: string): Promise<void> {
  const r = await post<{ token: string }>('/api/admin/login', { password });
  setAdminToken(r.token);
}

export function fetchOverview(): Promise<{ } & AdminOverview> {
  return call('/api/admin/overview');
}

export interface AdminPlayerListOptions {
  q?: string;
  identity?: 'all' | 'registered' | 'guest';
  offset?: number;
  limit?: number;
}

export function fetchPlayers(opts: AdminPlayerListOptions = {}): Promise<{
  players: AdminPlayer[];
  total: number;
  offset: number;
  limit: number;
}> {
  const qs = new URLSearchParams({
    q: opts.q ?? '',
    identity: opts.identity ?? 'all',
    offset: String(opts.offset ?? 0),
    limit: String(opts.limit ?? 50),
  });
  return call(`/api/admin/players?${qs.toString()}`);
}

export function fetchPlayerDetail(id: string): Promise<{
  account: AdminPlayer & { owned: string[]; rankName: string };
  stats: {
    totalRounds: number;
    wins: number;
    /** 已经是百分数（75 表示 75%），渲染时别再 ×100。 */
    winRate: number;
    digs: number;
    totalScore: number;
    bestLevel: number;
  };
  onlineTodaySec: number;
  ledger: AdminLedgerRow[];
}> {
  return call(`/api/admin/player/${encodeURIComponent(id)}`);
}

/** 手动发放金币/星币/房卡。amount 可为负数（撤回误发）。 */
export function grant(accountId: string, kind: GrantKind, amount: number, memo: string): Promise<{ account: AdminPlayer }> {
  return post('/api/admin/grant', { accountId, kind, amount, memo });
}

/** 手动发/撤会员天数。 */
export function grantVip(accountId: string, days: number): Promise<{ account: AdminPlayer }> {
  return post('/api/admin/vip', { accountId, days });
}

export function fetchAdminRooms(): Promise<{ rooms: AdminRoom[] }> {
  return call('/api/admin/rooms');
}

export function fetchOnlineRank(limit = 20): Promise<{
  list: { id: string; nickname: string; seconds: number }[];
}> {
  return call(`/api/admin/online-rank?limit=${limit}`);
}

// ===================== 反馈 / 举报工单 =====================

/**
 * 玩家提交的反馈或举报。
 *
 * 这块之前完全不存在 —— 反馈页只在前端弹"已提交"就把内容丢了，
 * 运营侧收不到任何东西。现在真的入库，后台在这里处理。
 */
export interface AdminTicket {
  id: number;
  kind: 'feedback' | 'report';
  accountId: string | null;
  nickname: string;
  category: string;
  title: string;
  body: string;
  /** 举报专用：被举报的玩家或房间 */
  target: string;
  contact: string;
  urgent: boolean;
  status: 'open' | 'doing' | 'done';
  adminNote: string;
  /** 客户端环境（分辨率 + UA），排查 BUG 用 */
  clientInfo: string;
  createdAt: number;
  updatedAt: number;
}

export interface TicketCounts {
  open: number;
  doing: number;
  done: number;
  total: number;
}

export function fetchTickets(opts: {
  kind?: 'feedback' | 'report';
  status?: 'open' | 'doing' | 'done';
  limit?: number;
  offset?: number;
} = {}): Promise<{ total: number; items: AdminTicket[]; counts: TicketCounts }> {
  const qs = new URLSearchParams();
  if (opts.kind) qs.set('kind', opts.kind);
  if (opts.status) qs.set('status', opts.status);
  qs.set('limit', String(opts.limit ?? 50));
  qs.set('offset', String(opts.offset ?? 0));
  return call(`/api/admin/tickets?${qs.toString()}`);
}

/** 改状态 / 写处理备注。备注会显示给提交的玩家看。 */
export function updateTicket(
  id: number,
  patch: { status?: 'open' | 'doing' | 'done'; adminNote?: string },
): Promise<{ ticket: AdminTicket }> {
  return post('/api/admin/ticket', { id, ...patch });
}
