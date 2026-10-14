process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Application, Request, Response } from 'express';
import { parsePlayerListQuery, registerAdminApi } from './admin.js';
import { createAccount } from './accounts.js';

type Handler = (req: Request, res: Response) => void;

function captureRoutes(): { app: Application; get: Record<string, Handler>; post: Record<string, Handler> } {
  const get: Record<string, Handler> = {};
  const post: Record<string, Handler> = {};
  const app = {
    get: (path: string, handler: Handler) => { get[path] = handler; return app; },
    post: (path: string, handler: Handler) => { post[path] = handler; return app; },
  } as unknown as Application;
  return { app, get, post };
}

function callLogin(handler: Handler, password: string, ip = '203.0.113.10') {
  let status = 0;
  let body: unknown = null;
  const req = { ip, body: { password } } as unknown as Request;
  const res = {
    status(code: number) { status = code; return this; },
    json(payload: unknown) { body = payload; return this; },
  } as unknown as Response;
  handler(req, res);
  return { status, body };
}

test('后台密码连续打错会触发频控，不继续比对密码', () => {
  const prevPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'test-admin-password';
  try {
    const { app, post } = captureRoutes();
    registerAdminApi(app);
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;

    for (let i = 0; i < 5; i++) {
      assert.equal(callLogin(post['/api/admin/login'], `wrong-${i}`, ip).status, 401);
    }
    const blocked = callLogin(post['/api/admin/login'], 'test-admin-password', ip);

    assert.equal(blocked.status, 429);
    assert.equal((blocked.body as { error?: string }).error, '尝试次数太多，请稍后再试');
  } finally {
    if (prevPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevPassword;
  }
});

test('玩家列表参数限制身份、分页偏移和每页数量', () => {
  assert.deepEqual(parsePlayerListQuery({
    q: ' 小梅 ', identity: 'phone', offset: '20', limit: '25',
  }), { q: '小梅', identity: 'registered', offset: 20, limit: 25 });
  assert.deepEqual(parsePlayerListQuery({
    identity: 'guest', offset: '-9', limit: '9999',
  }), { q: '', identity: 'guest', offset: 0, limit: 200 });
  assert.deepEqual(parsePlayerListQuery({ identity: 'unknown', offset: 'x', limit: 'x' }), {
    q: '', identity: 'all', offset: 0, limit: 50,
  });
});

test('玩家列表接口真实执行筛选、计数和 OFFSET 查询', () => {
  const prevPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'pagination-test-password';
  try {
    createAccount({ nickname: '注册甲', phone: '13800009001' });
    createAccount({ nickname: '注册乙', phone: '13800009002' });
    createAccount({ nickname: '游客甲' });
    const { app, get, post } = captureRoutes();
    registerAdminApi(app);
    const login = callLogin(post['/api/admin/login'], 'pagination-test-password', '203.0.113.240');
    const token = (login.body as { token: string }).token;
    let payload: any;
    const req = {
      query: { identity: 'registered', offset: '1', limit: '1' },
      header: (name: string) => name.toLowerCase() === 'authorization' ? `Bearer ${token}` : '',
    } as unknown as Request;
    const res = { json(body: unknown) { payload = body; return this; } } as unknown as Response;
    get['/api/admin/players'](req, res);

    assert.equal(payload.success, true);
    assert.equal(payload.total, 2);
    assert.equal(payload.offset, 1);
    assert.equal(payload.limit, 1);
    assert.equal(payload.players.length, 1);
    assert.equal(payload.players[0].authMethod, 'phone');
  } finally {
    if (prevPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevPassword;
  }
});
