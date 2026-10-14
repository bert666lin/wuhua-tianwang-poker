/**
 * 后台管理：在线概况 + 手动发放金币/房卡/会员。
 *
 * ============================================================
 * 认证方式为什么是「环境变量密码」而不是数据库里的管理员账号
 * ------------------------------------------------------------
 * 1. 系统里原本没有任何管理员概念，加一张 admins 表就要连带做
 *    注册/改密/权限分级，工作量远大于当前需要。
 * 2. 密码放环境变量（ADMIN_PASSWORD），改密码 = 改 pm2 环境变量重启，
 *    不会因为数据库被拖走而泄露管理员凭据。
 * 3. 没有「注册管理员」入口 —— 也就不存在被人注册成管理员的风险。
 *
 * ⚠️ ADMIN_PASSWORD 没设时**整个后台直接关闭**（所有接口回 503）。
 *    绝不能默认给一个弱密码：那等于把发币权限公开在公网上。
 *
 * 所有发放动作都写 ledger 流水（reason='admin'），事后查得出
 * 「这 10 万金币是谁在什么时候发的」。
 * ============================================================
 */

import type { Application, Request, Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { matchMaker } from '@colyseus/core';
import { getDb } from './db.js';
import { adjustBalance, toView, getById, listLedger, statsOf } from './accounts.js';
import { listTickets, updateTicket, ticketCounts, type TicketKind, type TicketStatus } from './tickets.js';
import { getAdminRoomParticipants } from '../rooms/adminRoomParticipants.js';

/** 管理员密码；没配置就等于后台不开放。 */
function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? '';
}

/** 后台可发放的余额类型。 */
export type GrantKind = 'coins' | 'stars' | 'roomCards';

const GRANT_KINDS: readonly GrantKind[] = ['coins', 'stars', 'roomCards'];

/**
 * 校验后台发放请求里的 kind。
 *
 * 故意**不做默认值兜底**：漏传或写错字段名时必须报错。
 * 后台发放是不可逆的人工操作，"默认发金币"这种静默行为比直接报错危险得多
 * （运维把 kind 写成 currency，本来想发房卡，结果悄悄发了金币）。
 */
export function parseGrantKind(raw: unknown): { ok: true; kind: GrantKind } | { ok: false; error: string } {
  const value = String(raw ?? '');
  if ((GRANT_KINDS as readonly string[]).includes(value)) {
    return { ok: true, kind: value as GrantKind };
  }
  return {
    ok: false,
    error: `不支持的类型「${value || '(空)'}」，kind 只能是 coins / stars / roomCards`,
  };
}

export type PlayerIdentityFilter = 'all' | 'registered' | 'guest';

export interface PlayerListQuery {
  q: string;
  identity: PlayerIdentityFilter;
  offset: number;
  limit: number;
}

/** 把公网查询参数收敛成有限范围，避免 NaN 或超大分页拖慢后台。 */
export function parsePlayerListQuery(raw: Record<string, unknown>): PlayerListQuery {
  const q = String(raw.q ?? '').trim();
  const identityRaw = String(raw.identity ?? 'all');
  const identity: PlayerIdentityFilter = identityRaw === 'guest'
    ? 'guest'
    : identityRaw === 'registered' || identityRaw === 'phone'
      ? 'registered'
      : 'all';
  const offsetNumber = Number(raw.offset ?? 0);
  const limitNumber = Number(raw.limit ?? 50);
  const offset = Number.isFinite(offsetNumber) ? Math.max(0, Math.floor(offsetNumber)) : 0;
  const limit = Number.isFinite(limitNumber)
    ? Math.min(200, Math.max(1, Math.floor(limitNumber)))
    : 50;
  return { q, identity, offset, limit };
}

/**
 * 登录后发的会话令牌，只存在内存里。
 *
 * 不入库是故意的：后台会话本来就该短命，进程重启（发版）后要求重新登录，
 * 比“令牌永久有效”安全得多。
 */
const sessions = new Map<string, number>();
const SESSION_TTL = 8 * 3_600_000;

/** 后台登录失败频控：5 次失败锁 10 分钟，避免公网暴力试密码。 */
const ADMIN_LOGIN_MAX_FAILURES = 5;
const ADMIN_LOGIN_WINDOW_MS = 10 * 60_000;
const adminLoginFailures = new Map<string, { count: number; resetAt: number }>();

function adminLoginBlocked(ip: string, now = Date.now()): boolean {
  const failure = adminLoginFailures.get(ip);
  if (!failure) return false;
  if (failure.resetAt <= now) {
    adminLoginFailures.delete(ip);
    return false;
  }
  return failure.count >= ADMIN_LOGIN_MAX_FAILURES;
}

function recordAdminLoginFailure(ip: string, now = Date.now()): void {
  if (adminLoginFailures.size > 10_000) {
    for (const [key, failure] of adminLoginFailures) {
      if (failure.resetAt <= now) adminLoginFailures.delete(key);
    }
  }
  const failure = adminLoginFailures.get(ip);
  if (!failure || failure.resetAt <= now) {
    adminLoginFailures.set(ip, { count: 1, resetAt: now + ADMIN_LOGIN_WINDOW_MS });
    return;
  }
  failure.count += 1;
}

function newSession(): string {
  const token = randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}

function validSession(token: string): boolean {
  const expire = sessions.get(token);
  if (!expire) return false;
  if (expire < Date.now()) { sessions.delete(token); return false; }
  return true;
}

/** 定长比较，避免用 === 比密码时因提前返回而泄露长度/前缀信息。 */
function samePassword(input: string): boolean {
  const expect = adminPassword();
  if (!expect) return false;
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(expect).digest();
  return timingSafeEqual(a, b);
}

function bearer(req: Request): string {
  const raw = req.header('authorization') ?? '';
  return raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : '';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 包一层：先看后台是否开放，再看会话是否有效。 */
function requireAdmin(handler: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    if (!adminPassword()) {
      res.status(503).json({ success: false, error: '后台未启用（服务端未配置 ADMIN_PASSWORD）' });
      return;
    }
    if (!validSession(bearer(req))) {
      res.status(401).json({ success: false, error: '未登录或登录已过期' });
      return;
    }
    try {
      handler(req, res);
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : '操作失败' });
    }
  };
}

// ===================== 在线时长 =====================

/**
 * 客户端心跳：累加当日在线秒数。
 *
 * 只累加「距上次心跳的间隔」且**上限 maxGapSec**：不设上限的话，
 * 玩家关掉页面第二天再打开，会被算成在线 20 小时。
 */
export function beatOnline(accountId: string, maxGapSec = 90): void {
  const db = getDb();
  const day = today();
  const now = Date.now();
  const row = db.prepare('SELECT seconds, last_beat FROM online_log WHERE account_id = ? AND day = ?')
    .get(accountId, day) as any;
  if (!row) {
    db.prepare('INSERT INTO online_log (account_id, day, seconds, last_beat) VALUES (?, ?, 0, ?)')
      .run(accountId, day, now);
    return;
  }
  const gapSec = Math.max(0, Math.min(maxGapSec, Math.round((now - row.last_beat) / 1000)));
  db.prepare('UPDATE online_log SET seconds = seconds + ?, last_beat = ? WHERE account_id = ? AND day = ?')
    .run(gapSec, now, accountId, day);
}

/** 某账号当日在线秒数。 */
export function onlineSecondsToday(accountId: string): number {
  const row = getDb().prepare('SELECT seconds FROM online_log WHERE account_id = ? AND day = ?')
    .get(accountId, today()) as any;
  return row?.seconds ?? 0;
}

// ===================== 路由 =====================

export function registerAdminApi(app: Application): void {
  /** 后台是否启用（前端据此显示“未配置”而不是傻等登录失败）。 */
  app.get('/api/admin/status', (_req, res) => {
    res.json({ success: true, enabled: !!adminPassword() });
  });

  /** 登录：密码换会话令牌。 */
  app.post('/api/admin/login', (req, res) => {
    if (!adminPassword()) {
      res.status(503).json({ success: false, error: '后台未启用（服务端未配置 ADMIN_PASSWORD）' });
      return;
    }
    const ip = req.ip || 'unknown';
    if (adminLoginBlocked(ip)) {
      res.status(429).json({ success: false, error: '尝试次数太多，请稍后再试' });
      return;
    }
    const password = String(req.body?.password ?? '');
    if (!samePassword(password)) {
      recordAdminLoginFailure(ip);
      res.status(401).json({ success: false, error: '密码不对' });
      return;
    }
    adminLoginFailures.delete(ip);
    res.json({ success: true, token: newSession() });
  });

  /**
   * 总览：在线人数、今日活跃、房间情况、账号总数。
   *
   * 「在线人数」有两个口径，都给出来免得看的人误判：
   *   - roomHumans：此刻真正坐在牌桌上的真人（来自 Colyseus 房间 metadata）
   *   - activeToday：今天有过心跳的账号数（含在大厅逛的）
   */
  app.get('/api/admin/overview', requireAdmin(async (_req, res) => {
    const db = getDb();
    const day = today();

    let roomHumans = 0, roomCount = 0, playingRooms = 0, cardRooms = 0;
    try {
      const rooms = await matchMaker.query({ name: 'game' });
      roomCount = rooms.length;
      for (const room of rooms as any[]) {
        const meta = room.metadata ?? {};
        roomHumans += typeof meta.humanCount === 'number' ? meta.humanCount : room.clients;
        if ((meta.phase ?? 'waiting') !== 'waiting') playingRooms++;
        if (meta.isCardRoom) cardRooms++;
      }
    } catch { /* 查房间失败不该让整个总览打不开 */ }

    const accounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as any;
    const activeToday = db.prepare('SELECT COUNT(*) AS n FROM online_log WHERE day = ?').get(day) as any;
    const secToday = db.prepare('SELECT COALESCE(SUM(seconds),0) AS s FROM online_log WHERE day = ?').get(day) as any;
    const newToday = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ?')
      .get(new Date(day + 'T00:00:00').getTime()) as any;
    const roundsToday = db.prepare('SELECT COUNT(*) AS n FROM rounds WHERE played_at >= ?')
      .get(new Date(day + 'T00:00:00').getTime()) as any;
    const purse = db.prepare('SELECT COALESCE(SUM(coins),0) AS coins, COALESCE(SUM(room_cards),0) AS cards FROM accounts').get() as any;

    res.json({
      success: true,
      online: { inRooms: roomHumans, activeToday: activeToday.n },
      rooms: { total: roomCount, playing: playingRooms, cardRooms },
      accounts: { total: accounts.n, newToday: newToday.n },
      today: { onlineSeconds: secToday.s, rounds: roundsToday.n },
      economy: { totalCoins: purse.coins, totalRoomCards: purse.cards },
      serverTime: Date.now(),
    });
  }));

  /**
   * 玩家列表 / 搜索。
   *
   * 支持按用户 ID、用户名或手机号模糊搜；默认按最后活跃倒序。
   */
  app.get('/api/admin/players', requireAdmin((req, res) => {
    const db = getDb();
    const { q, identity, offset, limit } = parsePlayerListQuery(req.query as Record<string, unknown>);
    const day = today();

    const clauses: string[] = [];
    const params: any[] = [];
    if (q) {
      clauses.push('(a.id LIKE ? OR a.nickname LIKE ? OR a.phone LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (identity === 'registered') clauses.push("a.auth_method = 'phone'");
    if (identity === 'guest') clauses.push("a.auth_method = 'guest'");
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countRow = db.prepare(`SELECT COUNT(*) AS n FROM accounts a ${where}`)
      .get(...params) as { n: number };

    const rows = db.prepare(`
      SELECT a.id, a.nickname, a.phone, a.auth_method, a.coins, a.stars, a.room_cards,
             a.score, a.vip_until, a.created_at, a.last_seen_at,
             COALESCE(o.seconds, 0) AS online_today
      FROM accounts a
      LEFT JOIN online_log o ON o.account_id = a.id AND o.day = ?
      ${where}
      ORDER BY a.last_seen_at DESC
      LIMIT ? OFFSET ?
    `).all(day, ...params, limit, offset) as any[];

    res.json({
      success: true,
      total: countRow.n,
      offset,
      limit,
      players: rows.map(r => ({
        id: r.id,
        nickname: r.nickname,
        phone: r.phone ?? null,
        authMethod: r.auth_method,
        coins: r.coins,
        stars: r.stars,
        roomCards: r.room_cards ?? 0,
        score: r.score,
        isVip: (r.vip_until ?? 0) > Date.now(),
        vipUntil: r.vip_until ?? 0,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        onlineTodaySec: r.online_today,
      })),
    });
  }));

  /** 单个玩家详情：余额 + 战绩汇总 + 最近流水。 */
  app.get('/api/admin/player/:id', requireAdmin((req, res) => {
    const account = getById(String(req.params.id));
    if (!account) {
      res.status(404).json({ success: false, error: '账号不存在' });
      return;
    }
    res.json({
      success: true,
      account: toView(account),
      stats: statsOf(account.id),
      onlineTodaySec: onlineSecondsToday(account.id),
      ledger: listLedger(account.id, 30),
    });
  }));

  /**
   * 手动发放：金币 / 星币 / 房卡。
   *
   * amount 允许负数（扣回误发的），但**不允许扣成负余额** ——
   * adjustBalance 会抛「不足」，前端拿到 400 提示。
   */
  app.post('/api/admin/grant', requireAdmin((req, res) => {
    const accountId = String(req.body?.accountId ?? '');
    const parsed = parseGrantKind(req.body?.kind);
    const amount = Math.round(Number(req.body?.amount ?? 0));
    const memo = String(req.body?.memo ?? '').trim() || '后台发放';

    if (!parsed.ok) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }
    if (!Number.isFinite(amount) || amount === 0) {
      res.status(400).json({ success: false, error: '数量必须是非 0 整数' });
      return;
    }
    const account = getById(accountId);
    if (!account) {
      res.status(404).json({ success: false, error: '账号不存在' });
      return;
    }
    // reason 固定 'admin'：以后审计只要筛这一个值就能列出全部人工干预
    const updated = adjustBalance(accountId, parsed.kind, amount, 'admin', memo);
    res.json({ success: true, account: toView(updated) });
  }));

  /** 手动发/撤会员天数（days 可为负数来撤回）。 */
  app.post('/api/admin/vip', requireAdmin((req, res) => {
    const accountId = String(req.body?.accountId ?? '');
    const days = Math.round(Number(req.body?.days ?? 0));
    const account = getById(accountId);
    if (!account) {
      res.status(404).json({ success: false, error: '账号不存在' });
      return;
    }
    if (!Number.isFinite(days) || days === 0) {
      res.status(400).json({ success: false, error: '天数必须是非 0 整数' });
      return;
    }
    // 从"现在"或"原到期时间"里取更晚的那个往后加，避免给还没到期的会员续期时反而缩短
    const base = Math.max(Date.now(), account.vipUntil);
    const until = Math.max(0, base + days * 86_400_000);
    getDb().prepare('UPDATE accounts SET vip_until = ? WHERE id = ?').run(until, accountId);
    res.json({ success: true, account: toView(getById(accountId)!) });
  }));

  /** 当前房间列表（后台视角：连私人房和已开局的也要能看到）。 */
  app.get('/api/admin/rooms', requireAdmin(async (_req, res) => {
    try {
      const rooms = await matchMaker.query({ name: 'game' });
      res.json({
        success: true,
        rooms: (rooms as any[]).map(room => {
          const meta = room.metadata ?? {};
          return {
            roomId: room.roomId,
            clients: room.clients,
            maxClients: room.maxClients,
            humanCount: meta.humanCount ?? null,
            phase: meta.phase ?? null,
            modeId: meta.modeId ?? null,
            tierId: meta.tierId ?? null,
            stake: meta.stake ?? null,
            isCardRoom: !!meta.isCardRoom,
            hostName: meta.hostName ?? '',
            participants: getAdminRoomParticipants(room.roomId),
            private: room.private,
            locked: room.locked,
          };
        }),
      });
    } catch {
      res.status(500).json({ success: false, error: '查询房间失败' });
    }
  }));

  /** 今日在线时长排行（看谁是重度用户）。 */
  app.get('/api/admin/online-rank', requireAdmin((req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const rows = getDb().prepare(`
      SELECT o.account_id, o.seconds, a.nickname
      FROM online_log o JOIN accounts a ON a.id = o.account_id
      WHERE o.day = ? ORDER BY o.seconds DESC LIMIT ?
    `).all(today(), limit) as any[];
    res.json({
      success: true,
      list: rows.map(r => ({ id: r.account_id, nickname: r.nickname, seconds: r.seconds })),
    });
  }));

  /**
   * 玩家反馈 / 举报列表。
   *
   * 默认「待处理排前面 + 加急优先」，运营打开就是该干的活。
   */
  app.get('/api/admin/tickets', requireAdmin((req, res) => {
    const kindRaw = String(req.query.kind ?? '');
    const statusRaw = String(req.query.status ?? '');
    const result = listTickets({
      kind: kindRaw === 'feedback' || kindRaw === 'report' ? (kindRaw as TicketKind) : undefined,
      status: ['open', 'doing', 'done'].includes(statusRaw) ? (statusRaw as TicketStatus) : undefined,
      limit: Number(req.query.limit ?? 50),
      offset: Number(req.query.offset ?? 0),
    });
    res.json({ success: true, ...result, counts: ticketCounts() });
  }));

  /** 改工单状态 / 写处理备注。 */
  app.post('/api/admin/ticket', requireAdmin((req, res) => {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id < 1) throw new Error('工单 ID 不正确');
    const ticket = updateTicket(id, {
      status: req.body?.status as TicketStatus | undefined,
      adminNote: req.body?.adminNote,
    });
    res.json({ success: true, ticket });
  }));
}
