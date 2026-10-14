import test from 'node:test';
import assert from 'node:assert/strict';
import { isJoinableRoom, type RoomListRow } from './roomList.js';

const base: RoomListRow = {
  private: false, phase: 'waiting', clients: 1,
  playerCount: 4, maxClients: 4, humanCount: 1,
};

test('等待中、有空位、有真人的房可以加入', () => {
  assert.equal(isJoinableRoom(base), true);
});

test('metadata 还没同步（phase=null）时按等待中处理', () => {
  assert.equal(isJoinableRoom({ ...base, phase: null }), true);
});

test('私人房不出现在公开列表', () => {
  assert.equal(isJoinableRoom({ ...base, private: true }), false);
});

test('已开局的房不能加入（服务端不支持中途进/观战）', () => {
  for (const phase of ['dealing', 'calling_suit', 'calling_score', 'discarding', 'playing', 'settling']) {
    assert.equal(isJoinableRoom({ ...base, phase }), false, `${phase} 不该可加入`);
  }
});

test('满员的房不能加入', () => {
  assert.equal(isJoinableRoom({ ...base, clients: 4 }), false);
  // 座位数按模式的 playerCount 算，不是 maxClients
  assert.equal(isJoinableRoom({ ...base, clients: 3, playerCount: 3, maxClients: 6 }), false);
});

test('只剩 AI 的空房不列（进去没人陪你打）', () => {
  assert.equal(isJoinableRoom({ ...base, clients: 3, humanCount: 0 }), false);
});

test('没上报真人数时不据此过滤，避免把正常房误杀', () => {
  assert.equal(isJoinableRoom({ ...base, humanCount: null }), true);
  assert.equal(isJoinableRoom({ ...base, humanCount: undefined }), true);
});
