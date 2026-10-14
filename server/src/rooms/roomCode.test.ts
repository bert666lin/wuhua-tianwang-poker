import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidRoomCode, normalizeRoomCode, allocRoomCode, ROOM_CODE_LENGTH } from './roomCode.js';

test('合法房间号是 6 位数字且首位非 0', () => {
  assert.equal(isValidRoomCode('123456'), true);
  assert.equal(isValidRoomCode('900000'), true);
  assert.equal(isValidRoomCode('012345'), false, '首位 0 会被念成 5 位');
  assert.equal(isValidRoomCode('12345'), false);
  assert.equal(isValidRoomCode('1234567'), false);
  assert.equal(isValidRoomCode('AB12CD'), false, '不再收字母');
  assert.equal(isValidRoomCode(''), false);
});

test('normalizeRoomCode 会剥掉空格与分隔符', () => {
  assert.equal(normalizeRoomCode(' 123 456 '), '123456');
  assert.equal(normalizeRoomCode('123-456'), '123456');
  assert.equal(normalizeRoomCode('12345'), null);
  assert.equal(normalizeRoomCode('abc'), null);
});

test('allocRoomCode 只发未被占用的号，且长度固定', () => {
  const used = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const code = allocRoomCode(c => used.has(c));
    assert.ok(code, '号段远没满，不该分配失败');
    assert.equal(code!.length, ROOM_CODE_LENGTH);
    assert.equal(isValidRoomCode(code!), true);
    assert.equal(used.has(code!), false, '不能发重复房号');
    used.add(code!);
  }
});

test('号段被占满时返回 null 而不是死循环或发重号', () => {
  // 让 taken 永远为 true，模拟"全占满"
  assert.equal(allocRoomCode(() => true, 10), null);
});
