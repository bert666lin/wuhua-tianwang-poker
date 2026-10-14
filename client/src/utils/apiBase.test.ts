import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBase, inferApiBase } from './apiBase.js';

test('结尾多写的 /api 会被去掉（各接口路径自带 /api 前缀）', () => {
  // 这正是线上挂过的坑：拼出 /api/api/auth/guest，账号接口全 404
  assert.equal(normalizeBase('https://tianwang.geju8.cn/api'), 'https://tianwang.geju8.cn');
  assert.equal(normalizeBase('https://tianwang.geju8.cn/api/'), 'https://tianwang.geju8.cn');
  assert.equal(normalizeBase('https://tianwang.geju8.cn/API'), 'https://tianwang.geju8.cn');
});

test('写成站点根地址时保持原样', () => {
  assert.equal(normalizeBase('https://tianwang.geju8.cn'), 'https://tianwang.geju8.cn');
  assert.equal(normalizeBase('https://tianwang.geju8.cn/'), 'https://tianwang.geju8.cn');
  assert.equal(normalizeBase('http://127.0.0.1:2567'), 'http://127.0.0.1:2567');
});

test('两边空白与重复斜杠都能容错', () => {
  assert.equal(normalizeBase('  http://127.0.0.1:2567///  '), 'http://127.0.0.1:2567');
});

test('路径里带 api 但不在结尾时不误删', () => {
  assert.equal(normalizeBase('https://x.com/apiary'), 'https://x.com/apiary');
});

test('单端口部署（同源或 2567）直接用 origin', () => {
  assert.equal(
    inferApiBase({ protocol: 'https:', hostname: 'tianwang.geju8.cn', port: '', origin: 'https://tianwang.geju8.cn' }),
    'https://tianwang.geju8.cn',
  );
  assert.equal(
    inferApiBase({ protocol: 'http:', hostname: '127.0.0.1', port: '2567', origin: 'http://127.0.0.1:2567' }),
    'http://127.0.0.1:2567',
  );
});

test('vite dev（5180）时把接口打到 2567', () => {
  assert.equal(
    inferApiBase({ protocol: 'http:', hostname: 'localhost', port: '5180', origin: 'http://localhost:5180' }),
    'http://localhost:2567',
  );
});
