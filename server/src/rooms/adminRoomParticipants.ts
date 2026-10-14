/** 只供后台读取的房间在座快照，不放进公开 matchmaker metadata。 */
export interface AdminRoomParticipant {
  accountId: string | null;
  username: string;
  isAI: boolean;
}

const snapshots = new Map<string, AdminRoomParticipant[]>();

const clone = (rows: AdminRoomParticipant[]) => rows.map(row => ({ ...row }));

export function setAdminRoomParticipants(roomId: string, rows: AdminRoomParticipant[]): void {
  snapshots.set(roomId, clone(rows));
}

export function getAdminRoomParticipants(roomId: string): AdminRoomParticipant[] {
  return clone(snapshots.get(roomId) ?? []);
}

export function removeAdminRoomParticipants(roomId: string): void {
  snapshots.delete(roomId);
}

export function clearAdminRoomParticipants(): void {
  snapshots.clear();
}
