/**
 * 语音限流单测。
 *
 * 限流是防「改客户端刷流量」的安全边界，边界值必须验：
 * 原先这段内联在 GameRoom 的 onMessage 里，只能靠肉眼读。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceRateLimiter, VOICE_MAX_CHUNKS_PER_SEC, VOICE_MAX_CHUNK_BYTES } from './voiceRate.js';

describe('VoiceRateLimiter', () => {
  it('正常语速（4 片/秒）完全不受影响', () => {
    const rl = new VoiceRateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) {
      assert.equal(rl.allow('a', t0 + i * 250), true, `第 ${i + 1} 片被误拦`);
    }
  });

  it('刚好到上限仍放行，超出第一片就拦', () => {
    const rl = new VoiceRateLimiter();
    const t0 = 5_000;
    for (let i = 0; i < VOICE_MAX_CHUNKS_PER_SEC; i++) {
      assert.equal(rl.allow('a', t0), true, `第 ${i + 1} 片应放行`);
    }
    assert.equal(rl.allow('a', t0), false, '超过上限必须拦下');
  });

  it('跨过 1 秒窗口后重新计数', () => {
    const rl = new VoiceRateLimiter();
    const t0 = 5_000;
    for (let i = 0; i < VOICE_MAX_CHUNKS_PER_SEC; i++) rl.allow('a', t0);
    assert.equal(rl.allow('a', t0), false, '同窗口内应被拦');
    assert.equal(rl.allow('a', t0 + 1000), true, '新窗口应放行');
  });

  /**
   * 窗口长度本身也要钉住，否则把 1000ms 手滑写成 100ms 也测不出来：
   * 窗口一短，额度就变成 12 片/100ms = 120 片/秒，限流形同虚设。
   * 这里验「差 1 毫秒到窗口边界时仍然算同一个窗口」。
   */
  it('窗口长度就是 1 秒：999ms 时还算同窗口（防止窗口被写短、限流失效）', () => {
    const rl = new VoiceRateLimiter();
    const t0 = 5_000;
    for (let i = 0; i < VOICE_MAX_CHUNKS_PER_SEC; i++) rl.allow('a', t0);
    assert.equal(rl.allow('a', t0 + 999), false, '还没满 1 秒，额度不该重置');
    assert.equal(rl.allow('a', t0 + 1000), true, '满 1 秒才重置');
  });

  /**
   * 用客户端真实的分片节奏跑满 3 秒：每片 250ms（client/src/utils/voice.ts
   * 的 CHUNK_MS），正常玩家一路说下去不该被拦掉任何一片。
   */
  it('按客户端 250ms 一片连续说 3 秒，一片都不该被拦', () => {
    const rl = new VoiceRateLimiter();
    const t0 = 100_000;
    for (let i = 0; i < 12; i++) {
      assert.equal(rl.allow('a', t0 + i * 250), true, `第 ${i + 1} 片被误拦`);
    }
  });

  it('不同连接互不影响（一个人刷不能把别人静音）', () => {
    const rl = new VoiceRateLimiter();
    const t0 = 5_000;
    for (let i = 0; i < VOICE_MAX_CHUNKS_PER_SEC; i++) rl.allow('spammer', t0);
    assert.equal(rl.allow('spammer', t0), false);
    assert.equal(rl.allow('innocent', t0), true, '别人的额度被连累了');
  });

  it('forget 之后额度重置（连接断开要清，否则 Map 无限增长）', () => {
    const rl = new VoiceRateLimiter();
    const t0 = 5_000;
    for (let i = 0; i < VOICE_MAX_CHUNKS_PER_SEC; i++) rl.allow('a', t0);
    assert.equal(rl.allow('a', t0), false);
    rl.forget('a');
    assert.equal(rl.allow('a', t0), true);
  });
});

describe('分片体积校验', () => {
  it('空包丢掉', () => {
    assert.equal(VoiceRateLimiter.isValidChunkSize(0), false);
  });

  it('正常 opus 片（~500B）与 iOS 首片（带 ftyp+moov，大一个量级）都放行', () => {
    assert.equal(VoiceRateLimiter.isValidChunkSize(500), true);
    assert.equal(VoiceRateLimiter.isValidChunkSize(8 * 1024), true);
    assert.equal(VoiceRateLimiter.isValidChunkSize(VOICE_MAX_CHUNK_BYTES), true);
  });

  it('超过上限丢掉', () => {
    assert.equal(VoiceRateLimiter.isValidChunkSize(VOICE_MAX_CHUNK_BYTES + 1), false);
  });

  /**
   * 上限必须小于 transport 的 maxPayload（index.ts 设的 32KB）：
   * 否则超限会由 ws 层以 1009 掐断整条连接，而不是在这里被安静丢弃。
   */
  it('上限必须小于 ws 的 maxPayload，否则超限会掐断连接而不是丢包', () => {
    assert.ok(VOICE_MAX_CHUNK_BYTES < 32 * 1024,
      `分片上限 ${VOICE_MAX_CHUNK_BYTES} 必须小于 transport 的 32KB maxPayload`);
  });
});
