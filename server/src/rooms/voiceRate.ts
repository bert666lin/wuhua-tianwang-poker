// ===== 语音分片限流 =====
// 从 GameRoom.ts 抽出（原文件 2279 行）。限流是防刷流量的安全边界，
// 独立出来才能单测「刚好卡在阈值」「跨窗口重置」这些边界情况。

/** 正常 4 片/秒（250ms 一片），给到 3 倍余量。 */
export const VOICE_MAX_CHUNKS_PER_SEC = 12;

/**
 * 单片体积上限。必须和客户端 voice.ts 的 MAX_CHUNK_BYTES 保持一致。
 * 不按 opus 的 500B 来定：iOS Safari 录的是 mp4/aac，每次按住的第一片带
 * ftyp+moov 初始化段，比后续片大一个量级。这个值再往下调会把 iOS 首片
 * 丢掉，同桌就完全听不到对方说话。
 * 另外它必须小于 transport 的 maxPayload（index.ts 里设的 32KB），
 * 否则超限是由 ws 层以 1009 掐断连接，而不是在这里被安静丢弃。
 */
export const VOICE_MAX_CHUNK_BYTES = 24 * 1024;

interface Bucket { since: number; count: number }

/**
 * 每个连接一个 1 秒滚动窗口的计数器。
 *
 * 故意用「整窗重置」而不是滑动窗口：实现简单、状态只有两个数字，
 * 且对正常玩家（4 片/秒）完全没有影响 —— 这里只要拦住明显的刷量。
 */
export class VoiceRateLimiter {
  private buckets = new Map<string, Bucket>();

  /**
   * 记一次分片，返回是否放行。
   * @param now 传入时间便于测试；生产调用方传 Date.now()
   */
  allow(sessionId: string, now: number = Date.now()): boolean {
    const bucket = this.buckets.get(sessionId);
    if (!bucket || now - bucket.since >= 1000) {
      this.buckets.set(sessionId, { since: now, count: 1 });
      return true;
    }
    if (bucket.count >= VOICE_MAX_CHUNKS_PER_SEC) return false;
    bucket.count++;
    return true;
  }

  /** 连接断开时清掉，避免 Map 无限增长。 */
  forget(sessionId: string): void {
    this.buckets.delete(sessionId);
  }

  /** 分片体积是否合法（空包和超大包都丢）。 */
  static isValidChunkSize(size: number): boolean {
    return size > 0 && size <= VOICE_MAX_CHUNK_BYTES;
  }
}
