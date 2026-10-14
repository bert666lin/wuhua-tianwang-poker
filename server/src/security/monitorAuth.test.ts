import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { basicAuthPassword, monitorAuth } from './monitorAuth.js';

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

type Result = { status: number; headers: Record<string, string>; passed: boolean };

function callMonitorAuth(authorization?: string): Result {
  const headers: Record<string, string> = {};
  let status = 200;
  let passed = false;
  const req = { header: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : undefined) } as unknown as Request;
  const res = {
    setHeader(key: string, value: string) { headers[key.toLowerCase()] = value; },
    status(code: number) { status = code; return this; },
    json() { return this; },
  } as unknown as Response;
  monitorAuth(req, res, () => { passed = true; });
  return { status, headers, passed };
}

test('Basic 认证解析：密码里带冒号不会被截断', () => {
  assert.equal(basicAuthPassword(basic('admin', 'a:b:c')), 'a:b:c');
  assert.equal(basicAuthPassword(basic('', 'only-pass')), 'only-pass');
  assert.equal(basicAuthPassword('Bearer token'), null);
  assert.equal(basicAuthPassword(undefined), null);
});

test('监控面板：密码正确才放行，错误回 401 且带 WWW-Authenticate', () => {
  const prev = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'monitor-secret';
  try {
    assert.equal(callMonitorAuth(basic('admin', 'monitor-secret')).passed, true);

    const wrong = callMonitorAuth(basic('admin', 'nope'));
    assert.equal(wrong.passed, false);
    assert.equal(wrong.status, 401);
    assert.match(wrong.headers['www-authenticate'] ?? '', /^Basic realm=/);

    const missing = callMonitorAuth(undefined);
    assert.equal(missing.passed, false);
    assert.equal(missing.status, 401);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prev;
  }
});

test('未配置 ADMIN_PASSWORD 时面板整体隐藏（404 而不是 401）', () => {
  const prev = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  try {
    const result = callMonitorAuth(basic('admin', 'whatever'));
    assert.equal(result.passed, false);
    assert.equal(result.status, 404);
  } finally {
    if (prev !== undefined) process.env.ADMIN_PASSWORD = prev;
  }
});
