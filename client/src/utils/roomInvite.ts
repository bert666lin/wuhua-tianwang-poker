/**
 * 房间号统一成 6 位纯数字（首位非 0）。
 *
 * 之前是 4-12 位字母数字混排，玩家要口头/微信报房号，0 和 O、1 和 I
 * 念起来分不清；纯数字还能用九宫格键盘直接敲。服务端 GameRoom 用的是
 * 同一条正则，两边必须一起改。
 */
const ROOM_CODE_PATTERN = /^[1-9]\d{5}$/;

/** 房间号长度，给输入框 maxLength 用。 */
export const ROOM_CODE_LENGTH = 6;

/** 房间号规则的用户可读文案，避免各处自己编一套。 */
export const ROOM_CODE_HINT = '6 位数字';

/** 房间号统一口径：只保留数字，非法输入返回 null。 */
export function normalizeRoomCode(input: string): string | null {
  const code = input.replace(/\D/g, '');
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

/** 输入框实时过滤：只留数字并截断到 6 位（不做合法性判断）。 */
export function sanitizeRoomCodeInput(input: string): string {
  return input.replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
}

/** 由当前页面地址生成 `?room=房间号` 邀请链接。 */
export function buildRoomInviteUrl(roomId: string, pageUrl: string): string {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', roomId);
  return url.toString();
}

/** 生成给好友直接复制的邀请文案。 */
export function buildRoomInviteText(roomId: string, pageUrl: string): string {
  return `来打五华天王！房间号：${roomId}，打开链接直接进房：${buildRoomInviteUrl(roomId, pageUrl)}`;
}
