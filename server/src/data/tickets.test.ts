// 反馈 / 举报工单测试。用内存库，互不干扰。
process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount } from './accounts.js';
import {
  createTicket, listMyTickets, listTickets, updateTicket, ticketCounts,
  ticketsToday, TICKET_DAILY_LIMIT,
} from './tickets.js';
import { getDb } from './db.js';

const mk = (nick = '测试') => createAccount({ nickname: nick }).account;

test('反馈能真正落库，而不是只在前端弹个"已提交"', () => {
  const a = mk('反馈哥');
  const t = createTicket(a.id, {
    kind: 'feedback',
    category: 'bug',
    title: '结算分数不对',
    body: '打完最后一墩，结算页显示的闲家得分比实际少了 10 分',
    contact: '13800000000',
    urgent: true,
  });
  assert.equal(t.kind, 'feedback');
  assert.equal(t.status, 'open');
  assert.equal(t.urgent, true);
  assert.equal(t.nickname, '反馈哥', '要冗余存昵称，账号删了后台还得知道是谁提的');
  assert.ok(t.id > 0);

  // 真的在库里
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM tickets WHERE account_id = ?').get(a.id) as any;
  assert.equal(row.n, 1);
});

test('描述太短要拒绝，不能让后台收到一堆"卡""崩了"这种没法查的单', () => {
  const a = mk();
  assert.throws(() => createTicket(a.id, { kind: 'feedback', body: '卡' }), /至少/);
  assert.throws(() => createTicket(a.id, { kind: 'feedback', body: '   ' }), /至少/);
});

test('举报必须写清举报谁，否则后台无从查证', () => {
  const a = mk();
  assert.throws(
    () => createTicket(a.id, { kind: 'report', body: '这个人开挂了，一直知道我手里有什么牌' }),
    /被举报/,
  );
  // 填了 target 就能过
  const t = createTicket(a.id, {
    kind: 'report',
    category: 'cheat',
    target: '阿龙',
    body: '这个人开挂了，一直知道我手里有什么牌',
  });
  assert.equal(t.target, '阿龙');
  assert.equal(t.kind, 'report');
});

test('工单类型只能是反馈或举报', () => {
  const a = mk();
  assert.throws(
    () => createTicket(a.id, { kind: 'xxx' as any, body: '随便写点什么够十个字' }),
    /类型/,
  );
});

test('超长内容被截断而不是报错（玩家粘贴一大段不该失败）', () => {
  const a = mk();
  const t = createTicket(a.id, {
    kind: 'feedback',
    title: '标'.repeat(200),
    body: '正'.repeat(5000),
    contact: 'c'.repeat(200),
  });
  assert.ok(t.title.length <= 60, `标题应截到 60，实际 ${t.title.length}`);
  assert.ok(t.body.length <= 2000, `正文应截到 2000，实际 ${t.body.length}`);
  assert.ok(t.contact.length <= 60);
});

test('每日提交上限：防脚本刷爆工单表', () => {
  const a = mk();
  for (let i = 0; i < TICKET_DAILY_LIMIT; i++) {
    createTicket(a.id, { kind: 'feedback', body: `第 ${i} 条反馈，内容要够十个字才行` });
  }
  assert.equal(ticketsToday(a.id), TICKET_DAILY_LIMIT);
  assert.throws(
    () => createTicket(a.id, { kind: 'feedback', body: '这条应该被上限拦住不让提交' }),
    /上限/,
  );
  // 换个账号不受影响（上限是按账号算的）
  const b = mk('另一个人');
  assert.ok(createTicket(b.id, { kind: 'feedback', body: '换个账号应该还能正常提交' }).id > 0);
});

test('玩家只能看到自己的工单，看不到别人的', () => {
  const a = mk('甲');
  const b = mk('乙');
  createTicket(a.id, { kind: 'feedback', body: '甲提的反馈内容够十个字' });
  createTicket(b.id, { kind: 'feedback', body: '乙提的反馈内容够十个字' });
  createTicket(b.id, { kind: 'report', target: '甲', body: '乙举报甲的内容够十个字' });

  const mineA = listMyTickets(a.id);
  assert.equal(mineA.length, 1);
  assert.equal(mineA[0].nickname, '甲');

  const mineB = listMyTickets(b.id);
  assert.equal(mineB.length, 2);
  // 按类型过滤
  assert.equal(listMyTickets(b.id, 'report').length, 1);
  assert.equal(listMyTickets(b.id, 'feedback').length, 1);
});

test('后台列表把「待处理」和「加急」排在前面', () => {
  // 清干净再测排序
  getDb().exec('DELETE FROM tickets');
  const a = mk();
  const t1 = createTicket(a.id, { kind: 'feedback', body: '第一条：普通的待处理反馈内容' });
  const t2 = createTicket(a.id, { kind: 'feedback', body: '第二条：加急的待处理反馈内容', urgent: true });
  const t3 = createTicket(a.id, { kind: 'feedback', body: '第三条：会被标成已处理的反馈' });
  updateTicket(t3.id, { status: 'done' });

  const { items, total } = listTickets();
  assert.equal(total, 3);
  assert.equal(items[0].id, t2.id, '加急的待处理单要排最前');
  assert.equal(items[1].id, t1.id);
  assert.equal(items[2].id, t3.id, '已处理的排最后');
});

test('后台能改状态和写处理备注', () => {
  const a = mk();
  const t = createTicket(a.id, { kind: 'feedback', body: '这条会被后台处理掉的反馈内容' });
  assert.equal(t.status, 'open');

  const doing = updateTicket(t.id, { status: 'doing', adminNote: '已联系玩家核实' });
  assert.equal(doing.status, 'doing');
  assert.equal(doing.adminNote, '已联系玩家核实');
  assert.ok(doing.updatedAt >= t.updatedAt);

  // 只改状态不该把备注清掉
  const done = updateTicket(t.id, { status: 'done' });
  assert.equal(done.status, 'done');
  assert.equal(done.adminNote, '已联系玩家核实', '只传 status 时备注要保留');

  assert.throws(() => updateTicket(t.id, { status: 'bogus' as any }), /状态/);
  assert.throws(() => updateTicket(999999, { status: 'done' }), /不存在/);
});

test('后台按类型和状态过滤', () => {
  getDb().exec('DELETE FROM tickets');
  const a = mk();
  createTicket(a.id, { kind: 'feedback', body: '反馈一条内容够十个字了吧' });
  createTicket(a.id, { kind: 'report', target: '某人', body: '举报一条内容够十个字了吧' });
  const t = createTicket(a.id, { kind: 'report', target: '另一人', body: '举报二条内容够十个字了' });
  updateTicket(t.id, { status: 'done' });

  assert.equal(listTickets({ kind: 'feedback' }).total, 1);
  assert.equal(listTickets({ kind: 'report' }).total, 2);
  assert.equal(listTickets({ status: 'open' }).total, 2);
  assert.equal(listTickets({ kind: 'report', status: 'done' }).total, 1);

  const c = ticketCounts();
  assert.equal(c.total, 3);
  assert.equal(c.open, 2);
  assert.equal(c.done, 1);
});

test('分页不会越界，limit 有上限', () => {
  getDb().exec('DELETE FROM tickets');
  const a = mk();
  for (let i = 0; i < 5; i++) {
    createTicket(a.id, { kind: 'feedback', body: `分页测试第 ${i} 条内容够十个字` });
  }
  assert.equal(listTickets({ limit: 2 }).items.length, 2);
  assert.equal(listTickets({ limit: 2, offset: 4 }).items.length, 1);
  assert.equal(listTickets({ limit: 2, offset: 99 }).items.length, 0);
  // 恶意超大 limit 被夹住
  assert.ok(listTickets({ limit: 99999 }).items.length <= 200);
  // 负数不该炸
  assert.equal(listTickets({ limit: -5, offset: -3 }).items.length, 1);
});

test('账号被删除后工单仍保留（运营还要能看历史）', () => {
  getDb().exec('DELETE FROM tickets');
  const a = mk('待删除');
  createTicket(a.id, { kind: 'feedback', body: '这个账号之后会被删掉的反馈' });
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(a.id);

  const { items, total } = listTickets();
  assert.equal(total, 1, '账号删了工单不能跟着消失');
  assert.equal(items[0].accountId, null, 'account_id 应被置空（ON DELETE SET NULL）');
  assert.equal(items[0].nickname, '待删除', '冗余昵称让后台仍知道是谁提的');
});

test('不存在的账号不能提交工单', () => {
  assert.throws(
    () => createTicket('no-such-account', { kind: 'feedback', body: '伪造账号提交的反馈内容' }),
    /账号不存在/,
  );
});
