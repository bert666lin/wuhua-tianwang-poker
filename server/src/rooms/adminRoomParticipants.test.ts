import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAdminRoomParticipants,
  getAdminRoomParticipants,
  setAdminRoomParticipants,
} from './adminRoomParticipants.js';

afterEach(() => clearAdminRoomParticipants());

describe('后台查看房间在座用户', () => {
  it('保留真实用户 ID 和用户名，未登录玩家明确标成临时游客', () => {
    setAdminRoomParticipants('123456', [
      { accountId: 'acct-001', username: '梅州阿明', isAI: false },
      { accountId: null, username: '玩家2', isAI: false },
      { accountId: null, username: '老王', isAI: true },
    ]);

    assert.deepEqual(getAdminRoomParticipants('123456'), [
      { accountId: 'acct-001', username: '梅州阿明', isAI: false },
      { accountId: null, username: '玩家2', isAI: false },
      { accountId: null, username: '老王', isAI: true },
    ]);
  });

  it('对外返回副本，不让后台读取者改坏房间快照', () => {
    setAdminRoomParticipants('654321', [
      { accountId: 'acct-002', username: '阿强', isAI: false },
    ]);
    const first = getAdminRoomParticipants('654321');
    first[0].username = '被篡改';
    assert.equal(getAdminRoomParticipants('654321')[0].username, '阿强');
  });
});
