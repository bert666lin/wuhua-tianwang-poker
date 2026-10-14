import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { AI_NAMES, aiNameForSeat } from './aiNames.js';

test('aiNameForSeat 按座位给出稳定且不重复的名字', () => {
  const seen = new Set<string>();
  // 最大局是 6 人，座位 0~5 都不能重名（同桌两个"老王"没法喊）
  for (let seat = 0; seat < 6; seat++) {
    const name = aiNameForSeat(seat);
    assert.ok(name.length > 0, `座位 ${seat} 应该有名字`);
    assert.equal(seen.has(name), false, `座位 ${seat} 的名字 ${name} 重复了`);
    seen.add(name);
    // 稳定：同一座位多次调用结果一致
    assert.equal(aiNameForSeat(seat), name);
  }
});

test('座位超出名单长度时退回带序号的名字，不返回 undefined', () => {
  const name = aiNameForSeat(AI_NAMES.length + 3);
  assert.equal(typeof name, 'string');
  assert.ok(name.length > 0);
});

test('前端匹配页的名单必须和服务端一致（顺序也要一致）', () => {
  // 这两份名单分处前后端、无法直接 import，所以用文本比对锁住。
  // 它们一旦不同步，就会重现"匹配页显示翠花、进牌桌变成 AI 2"的问题。
  const here = dirname(fileURLToPath(import.meta.url));
  const mmPath = resolve(here, '../../../client/src/pages/Matchmaking.tsx');
  const src = readFileSync(mmPath, 'utf8');
  const m = src.match(/const OPP_NAMES = \[([^\]]*)\]/);
  assert.ok(m, '没在 Matchmaking.tsx 里找到 OPP_NAMES');
  const frontNames = m[1]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  assert.deepEqual(
    frontNames,
    [...AI_NAMES],
    '前端 OPP_NAMES 与服务端 AI_NAMES 不一致：匹配页和牌桌会显示不同名字',
  );
});
