import test from 'node:test';
import assert from 'node:assert/strict';
import { corsMiddleware, isAllowedCorsOrigin } from './cors.js';

test('CORS 白名单：线上域名、本机开发和局域网调试可用', () => {
  assert.equal(isAllowedCorsOrigin('https://tianwang.geju8.cn'), true);
  assert.equal(isAllowedCorsOrigin('http://localhost:5180'), true);
  assert.equal(isAllowedCorsOrigin('http://127.0.0.1:5180'), true);
  assert.equal(isAllowedCorsOrigin('http://192.168.10.15:5180'), true);
});

test('CORS 白名单：外站和公网 IP 上的 5180 不放行', () => {
  assert.equal(isAllowedCorsOrigin('https://evil.example'), false);
  assert.equal(isAllowedCorsOrigin('http://8.8.8.8:5180'), false);
  assert.equal(isAllowedCorsOrigin(undefined), true);
});

test('CORS 白名单：可加入自己的部署域名', () => {
  const previous = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = 'https://my-game.example, https://second.example';
  try {
    assert.equal(isAllowedCorsOrigin('https://my-game.example'), true);
    assert.equal(isAllowedCorsOrigin('https://second.example'), true);
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previous;
  }
});

type CorsTestResult = { status: number; ended: boolean; headers: Record<string, string> };

function callCorsMiddleware(method: string, origin?: string): CorsTestResult {
  const headers: Record<string, string> = {};
  let status = 200;
  let ended = false;
  const req = { method, headers: origin ? { origin } : {} };
  const res = {
    setHeader: (key: string, value: string) => { headers[key.toLowerCase()] = value; },
    status: (code: number) => { status = code; return res; },
    end: () => { ended = true; },
  };
  corsMiddleware(req as never, res as never, () => {});
  return { status, ended, headers };
}

test('CORS 中间件：允许的开发来源能通过预检，外站拿不到 Allow-Origin', () => {
  const allowed = callCorsMiddleware('OPTIONS', 'http://localhost:5180');
  assert.equal(allowed.status, 204);
  assert.equal(allowed.ended, true);
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5180');

  const denied = callCorsMiddleware('GET', 'https://evil.example');
  assert.equal(denied.ended, false);
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});
