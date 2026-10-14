/**
 * 房间列表的可加入判定。
 *
 * 单独抽出来是为了能测：这段逻辑写错的后果是大厅列表里摆一堆
 * 点进去就被 leave(4000) 踢掉的房间，玩家会以为游戏坏了。
 */

/** /rooms 接口里一行房间的最小形状（只列出判定用到的字段）。 */
export interface RoomListRow {
  /** 私人房：只能凭房号进，不该出现在公开列表里 */
  private?: boolean;
  /** 房间阶段；null 视为等待中（metadata 还没同步上来） */
  phase: string | null;
  /** 当前连接数（含 AI） */
  clients: number;
  /** 这个模式的总座位数 */
  playerCount?: number | null;
  maxClients: number;
  /** 房内真人数；null 表示服务端没上报（旧房间），此时不据此过滤 */
  humanCount?: number | null;
}

/**
 * 这个房现在能不能直接点进去。
 *
 * 排除四种：私人房、已开局（不支持中途加入/观战）、满员、
 * 以及"只剩 AI 的空房"（进去也没人陪你打）。
 */
export function isJoinableRoom(room: RoomListRow): boolean {
  if (room.private) return false;
  if (room.phase !== null && room.phase !== 'waiting') return false;
  const seats = room.playerCount ?? room.maxClients;
  if (room.clients >= seats) return false;
  if (typeof room.humanCount === 'number' && room.humanCount < 1) return false;
  return true;
}
