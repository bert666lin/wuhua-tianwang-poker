import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRoomCode,
  sanitizeRoomCodeInput,
  buildRoomInviteUrl,
  buildRoomInviteText,
} from './roomInvite.js';

test('normalizeRoomCode 接受 6 位数字并忽略两边空白与分隔符', () => {
  assert.equal(normalizeRoomCode(' 123456 '), '123456');
  assert.equal(normalizeRoomCode('12-34 56'), '123456');
});

test('normalizeRoomCode 拒绝非 6 位数字的房间号', () => {
  assert.equal(normalizeRoomCode('12345'), null);
  assert.equal(normalizeRoomCode('1234567'), null);
  // 首位 0 会被念成 5 位，不允许
  assert.equal(normalizeRoomCode('012345'), null);
  assert.equal(normalizeRoomCode('AB12CD'), null);
});

test('sanitizeRoomCodeInput 只留数字并截断到 6 位', () => {
  assert.equal(sanitizeRoomCodeInput('a1b2c3d4e5f6g7'), '123456');
  assert.equal(sanitizeRoomCodeInput(''), '');
});

test('buildRoomInviteUrl 生成可直接打开的入房链接', () => {
  assert.equal(
    buildRoomInviteUrl('123456', 'https://example.com/?x=1'),
    'https://example.com/?room=123456',
  );
});

test('buildRoomInviteText 包含房间号和入房链接', () => {
  const text = buildRoomInviteText('123456', 'https://example.com/');
  assert.match(text, /123456/);
  assert.match(text, /https:\/\/example\.com\/\?room=123456/);
});
