/**
 * 玩家反馈 / 举报工单。
 *
 * 背景：反馈页（client/src/pages/Feedback.tsx）原来有 895 行界面但一行都没连
 * 服务器 —— 点「提交」只弹一句"已提交，感谢支持"就把内容丢掉了，运营侧
 * 永远收不到任何反馈。这个模块补上真实的落库与后台查询。
 *
 * 设计取舍：
 *   1. **反馈与举报同表**（kind 区分）。两者字段几乎完全重合，后台也总是
 *      放一个列表里看，拆两张表只会让分页和排序变复杂。
 *   2. **不做附件上传**。原界面的"上传截图"其实是塞随机网图占位，真要做
 *      得引入对象存储和鉴权，这轮先让文字反馈能真正送达；界面上会把
 *      "上传截图"改成引导玩家把关键信息写进描述里。
 *   3. **限流按账号**：防止有人写脚本刷爆工单表。
 */
import { getDb } from './db.js';
import { getById } from './accounts.js';

/** 工单类型。 */
export type TicketKind = 'feedback' | 'report';
/** 处理状态：待处理 / 处理中 / 已处理。 */
export type TicketStatus = 'open' | 'doing' | 'done';

export interface TicketInput {
  kind: TicketKind;
  /** feedback: bug|suggest|complain|other；report: cheat|abuse|passive|other */
  category?: string;
  title?: string;
  body: string;
  /** 举报专用：被举报的玩家昵称或房间号 */
  target?: string;
  contact?: string;
  urgent?: boolean;
  clientInfo?: string;
}

export interface TicketView {
  id: number;
  kind: TicketKind;
  accountId: string | null;
  nickname: string;
  category: string;
  title: string;
  body: string;
  target: string;
  contact: string;
  urgent: boolean;
  status: TicketStatus;
  adminNote: string;
  clientInfo: string;
  createdAt: number;
  updatedAt: number;
}

/** 正文长度限制：太短没信息量，太长多半是灌水。 */
const BODY_MIN = 10;
const BODY_MAX = 2000;
const TITLE_MAX = 60;
const TARGET_MAX = 40;
const CONTACT_MAX = 60;
const CLIENT_INFO_MAX = 300;
/** 同一账号每天最多提交多少单，防脚本刷表。 */
export const TICKET_DAILY_LIMIT = 20;

function clip(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}

function rowToView(row: any): TicketView {
  return {
    id: row.id,
    kind: row.kind,
    accountId: row.account_id ?? null,
    nickname: row.nickname ?? '',
    category: row.category ?? 'other',
    title: row.title ?? '',
    body: row.body ?? '',
    target: row.target ?? '',
    contact: row.contact ?? '',
    urgent: !!row.urgent,
    status: row.status ?? 'open',
    adminNote: row.admin_note ?? '',
    clientInfo: row.client_info ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 某账号今天已提交多少单。 */
export function ticketsToday(accountId: string): number {
  const since = Date.now() - 86400_000;
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tickets WHERE account_id = ? AND created_at >= ?')
    .get(accountId, since) as any;
  return row?.n ?? 0;
}

/**
 * 提交一张工单。
 *
 * 校验失败一律 throw，由 api.ts 的 requireAuth 包装成 400 + 中文提示。
 */
export function createTicket(accountId: string, input: TicketInput): TicketView {
  const account = getById(accountId);
  if (!account) throw new Error('账号不存在');

  if (input.kind !== 'feedback' && input.kind !== 'report') {
    throw new Error('工单类型不正确');
  }
  const body = clip(input.body, BODY_MAX);
  if (body.length < BODY_MIN) throw new Error(`请至少填写 ${BODY_MIN} 个字的描述`);

  // 举报必须说清举报谁，否则后台无从查证
  const target = clip(input.target, TARGET_MAX);
  if (input.kind === 'report' && !target) throw new Error('请填写被举报的玩家或房间号');

  if (ticketsToday(accountId) >= TICKET_DAILY_LIMIT) {
    throw new Error(`今天提交的工单已达上限（${TICKET_DAILY_LIMIT} 条），请明天再试`);
  }

  const now = Date.now();
  const db = getDb();
  db.prepare(`
    INSERT INTO tickets
      (kind, account_id, nickname, category, title, body, target, contact, urgent, status, client_info, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(
    input.kind,
    accountId,
    account.nickname,
    clip(input.category, 20) || 'other',
    clip(input.title, TITLE_MAX),
    body,
    target,
    clip(input.contact, CONTACT_MAX),
    input.urgent ? 1 : 0,
    clip(input.clientInfo, CLIENT_INFO_MAX),
    now,
    now,
  );
  const row = db.prepare('SELECT * FROM tickets WHERE account_id = ? ORDER BY id DESC LIMIT 1').get(accountId);
  return rowToView(row);
}

/** 玩家看自己提过的单（反馈页的「我的反馈」列表）。 */
export function listMyTickets(accountId: string, kind?: TicketKind, limit = 30): TicketView[] {
  const db = getDb();
  const rows = kind
    ? db.prepare('SELECT * FROM tickets WHERE account_id = ? AND kind = ? ORDER BY id DESC LIMIT ?')
        .all(accountId, kind, limit)
    : db.prepare('SELECT * FROM tickets WHERE account_id = ? ORDER BY id DESC LIMIT ?')
        .all(accountId, limit);
  return rows.map(rowToView);
}

/**
 * 后台列表：默认「未处理的排前面，同状态按时间倒序」。
 *
 * 用 CASE 排序而不是简单 ORDER BY status：状态是字符串，
 * 字母序（doing < done < open）恰好把最该处理的 open 排到最后。
 */
export function listTickets(opts: {
  kind?: TicketKind;
  status?: TicketStatus;
  limit?: number;
  offset?: number;
} = {}): { total: number; items: TicketView[] } {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (opts.kind) { where.push('kind = ?'); args.push(opts.kind); }
  if (opts.status) { where.push('status = ?'); args.push(opts.status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM tickets ${clause}`).get(...args) as any)?.n ?? 0;
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = db.prepare(`
    SELECT * FROM tickets ${clause}
    ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'doing' THEN 1 ELSE 2 END,
             urgent DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset);
  return { total, items: rows.map(rowToView) };
}

/** 后台改状态 / 写处理备注。 */
export function updateTicket(id: number, patch: { status?: TicketStatus; adminNote?: string }): TicketView {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!row) throw new Error('工单不存在');
  if (patch.status && !['open', 'doing', 'done'].includes(patch.status)) {
    throw new Error('状态不正确');
  }
  db.prepare('UPDATE tickets SET status = COALESCE(?, status), admin_note = COALESCE(?, admin_note), updated_at = ? WHERE id = ?')
    .run(patch.status ?? null, patch.adminNote === undefined ? null : clip(patch.adminNote, 500), Date.now(), id);
  return rowToView(db.prepare('SELECT * FROM tickets WHERE id = ?').get(id));
}

/** 后台概览用：各状态各有多少单。 */
export function ticketCounts(): { open: number; doing: number; done: number; total: number } {
  const rows = getDb().prepare('SELECT status, COUNT(*) AS n FROM tickets GROUP BY status').all() as any[];
  const out = { open: 0, doing: 0, done: 0, total: 0 };
  for (const r of rows) {
    if (r.status === 'open') out.open = r.n;
    else if (r.status === 'doing') out.doing = r.n;
    else if (r.status === 'done') out.done = r.n;
    out.total += r.n;
  }
  return out;
}
