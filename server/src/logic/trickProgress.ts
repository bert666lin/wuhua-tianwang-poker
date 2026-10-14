// ===== 本墩/终局进度判断 =====
// 从 GameRoom.ts 抽出（原文件 2279 行）。这里是纯算术，不碰房间状态，
// 因此可以直接单测 —— 而它的正确性对打法影响很大：
// isFinalTrick 是喂给 AI 的关键信号（见 logic/ai.ts），判错会让 AI
// 把天王一直省着、最后烂在手里，闲家白丢挖底。

/** 判断「这一墩是不是本局最后一墩」所需的信息。 */
export interface FinalTrickInput {
  /** 我当前手牌数。 */
  handCount: number;
  /** 本墩每人要出几张（领出者已定就用它的张数；本墩还没人出牌时传 undefined）。 */
  perTrick?: number;
  /** 我本墩是否已经出过牌。 */
  alreadyPlayed: boolean;
}

/**
 * 这一墩是不是本局最后一墩（打完这墩手上就空了）。
 *
 * 用剩余手牌数判断：还没出牌的人手上剩几张，就代表还要打几墩
 * （每墩每人出的张数相同）。
 *
 * 注意 alreadyPlayed 的区别：我已经出过牌时 handCount 已经扣掉了本墩这几张，
 * 不能再扣一次 —— 否则会把倒数第二墩误判成最后一墩。
 */
export function isFinalTrick(input: FinalTrickInput): boolean {
  const perTrick = input.perTrick ?? 1;
  // 张数异常（0 或负）时不做判断，避免把正常局面误判成终局
  if (perTrick <= 0) return false;
  const remaining = input.alreadyPlayed
    ? input.handCount
    : input.handCount - perTrick;
  return remaining <= 0;
}
