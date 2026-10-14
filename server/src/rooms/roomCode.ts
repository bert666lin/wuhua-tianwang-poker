/**
 * 房间号规则（服务端唯一口径）。
 *
 * 改成 6 位纯数字的原因：玩家要口头或在微信里报房号，字母数字混排时
 * 0/O、1/I/l 念不清；纯数字还能用九宫格键盘直接敲。
 * 前端同一套规则在 `client/src/utils/roomInvite.ts`，两边必须一起改。
 */

/** 6 位数字，首位不为 0（否则「012345」会被念成 5 位）。 */
export const ROOM_CODE_PATTERN = /^[1-9]\d{5}$/;

export const ROOM_CODE_LENGTH = 6;

/** 输入是否是合法房间号。 */
export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

/** 只保留数字，供宽松输入（带空格/横线的粘贴）归一化。 */
export function normalizeRoomCode(input: string): string | null {
  const code = String(input ?? '').replace(/\D/g, '');
  return isValidRoomCode(code) ? code : null;
}

/**
 * 随机分配一个未被占用的房号。
 *
 * @param taken 判断某个房号是否已被占用
 * @param tries 最多尝试几次；试不出来返回 null，由调用方决定退路
 *              （现在是退回 Colyseus 默认 roomId，房间照样能开）
 */
export function allocRoomCode(taken: (code: string) => boolean, tries = 50): string | null {
  for (let i = 0; i < tries; i++) {
    const code = String(100000 + Math.floor(Math.random() * 900000));
    if (!taken(code)) return code;
  }
  return null;
}
