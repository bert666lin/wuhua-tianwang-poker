import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ADMIN = readFileSync(new URL('./Admin.tsx', import.meta.url), 'utf8');
const API = readFileSync(new URL('../utils/adminApi.ts', import.meta.url), 'utf8');
const SERVER = readFileSync(new URL('../../../server/src/data/admin.ts', import.meta.url), 'utf8');

test('玩家列表明确展示用户名和用户 ID，搜索也支持 ID', () => {
  assert.match(ADMIN, /用户名\s*\{p\.nickname\}/);
  assert.match(ADMIN, /用户 ID\s*\{p\.id\}/);
  assert.match(ADMIN, /搜用户名、用户 ID 或手机号/);
  assert.match(SERVER, /a\.id LIKE \?/,
    '服务端查询必须真的搜索 ID，不能只改输入框文案');
});

test('房间监控列出每位在座用户的用户名和 ID', () => {
  assert.match(API, /participants: AdminRoomParticipant\[\]/);
  assert.match(ADMIN, /r\.participants\.map/);
  assert.match(ADMIN, /p\.username/);
  assert.match(ADMIN, /p\.accountId \? `用户 ID \$\{p\.accountId\}` : '临时游客'/);
});

test('玩家列表支持身份筛选、总数和分页', () => {
  assert.match(API, /identity\?: 'all' \| 'registered' \| 'guest'/);
  assert.match(API, /total: number/);
  assert.match(API, /offset: number/);
  assert.match(ADMIN, /setIdentity/);
  assert.match(ADMIN, /上一页/);
  assert.match(ADMIN, /下一页/);
  assert.match(SERVER, /COUNT\(\*\) AS n/);
  assert.match(SERVER, /OFFSET \?/);
});
