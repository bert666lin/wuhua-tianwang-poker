// ===== 战绩页的「开房记录」分组（纯函数） =====
//
// 为什么要有这一层：战绩页原来只有一条平铺的单局列表。但玩家记事情的单位
// 不是"单局"而是"一桌"——「昨晚在 6821 房打了 12 局，输 5 级」，
// 没人会说「我第 47 条记录赢了 2 级」。所以要按房间把连着打的几局收成一条。
//
// 分组只能靠服务端落库的 room_id，不能靠时间间隔猜（"20 分钟内算一桌"这种
// 规则在中途离开又回来、或者两桌交替打的时候必然分错）。
// v6 迁移之前的老记录没有房间号，一律归到「早期记录」——
// 把不同桌的局硬凑成一桌，比不分组更糟。

/** 分组只用得到这几个字段，所以不绑死 Records.tsx 里的 RichRound。 */
export interface GroupableRound {
  id: string;
  timestamp: number;
  /** 模式中文名，如「4人 3副」。 */
  mode: string;
  iWon: boolean;
  iAmBanker: boolean;
  /** 本局级数（正数）。 */
  level: number;
  /** 我这局的级数增减（可负）。累计就是把它加起来。 */
  scoreDelta: number;
  /** 本局金币变化。房卡局恒为 0。 */
  coins: number;
  isCardRoom: boolean;
  /** 房间号；'' 表示老记录没记。 */
  roomId: string;
  /** 这桌第几局；0 表示老记录没记。 */
  roomRoundNo: number;
}

export interface RoomGroup<T extends GroupableRound = GroupableRound> {
  /** React key。老记录组固定为 `legacy`。 */
  key: string;
  roomId: string;
  /** 是不是「早期记录」那一组（没有房间号的历史数据）。 */
  isLegacy: boolean;
  /** 房号短显示：`6821`。老记录组给「早期记录」。 */
  roomLabel: string;
  /** 这桌的模式；同桌换模式的情况取局数最多的那个。 */
  mode: string;
  /** 最早/最晚一局的时间。 */
  startedAt: number;
  endedAt: number;
  /** 这桌我打了几局。 */
  roundCount: number;
  wins: number;
  losses: number;
  /** 整数百分比；0 局时为 0（调用方会先判 roundCount）。 */
  winRate: number;
  /** 这桌我累计输赢几级（可负）。 */
  levelDelta: number;
  /** 这桌金币累计变化。 */
  coinsDelta: number;
  /** 我坐了几次庄。 */
  bankerCount: number;
  /** 单局最大赢级（没赢过为 0）。 */
  bestLevel: number;
  /** 房卡局（朋友局）：整桌不结金币。 */
  isCardRoom: boolean;
  /** 一句话总结，如「12 局 · 赢 5 级」。 */
  headline: string;
  /** 组内各局，最新的在前。 */
  rounds: T[];
}

/** 带正负号的级数，`0` 不写成 `+0`。 */
function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * 房号短显示。
 *
 * Colyseus 自动分配的 roomId 是 9 位随机串（如 `xK3mQp7Zt`），
 * 自定义房号是 6 位数字。都直接显示原文即可，但过长的截断 ——
 * 列表里一行放不下一串乱码，玩家也不会去核对它。
 */
function labelOf(roomId: string): string {
  if (!roomId) return '早期记录';
  return roomId.length > 8 ? `${roomId.slice(0, 8)}…` : roomId;
}

/**
 * 把单局记录按房间收成「一桌」。
 *
 * @param rounds 单局列表，顺序随意（内部会自己排）
 * @returns 各桌，最近打的那桌在前
 */
export function groupByRoom<T extends GroupableRound>(rounds: T[]): RoomGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const r of rounds) {
    // 老记录全部塞进同一个 legacy 桶，而不是各自成为"一桌一局"——
    // 那样列表会被一堆只有 1 局的假房间刷满。
    const key = r.roomId ? `room:${r.roomId}` : 'legacy';
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }

  const groups: RoomGroup<T>[] = [];
  for (const [key, list] of buckets) {
    const isLegacy = key === 'legacy';
    const roomId = isLegacy ? '' : list[0].roomId;

    /* 组内排序：有局号就按局号倒序（第 12 局在最上面），没有就按时间倒序。
     * 不能只按时间：同桌两局可能在同一毫秒落库，那样顺序每次刷新都会变，
     * 玩家会以为记录乱了。 */
    const sorted = [...list].sort((a, b) => (
      (b.roomRoundNo - a.roomRoundNo) || (b.timestamp - a.timestamp)
    ));

    let wins = 0;
    let levelDelta = 0;
    let coinsDelta = 0;
    let bankerCount = 0;
    let bestLevel = 0;
    let startedAt = Number.POSITIVE_INFINITY;
    let endedAt = 0;
    let isCardRoom = false;
    // 同一桌理论上模式不变，但房主可以解散重开复用房号，所以按局数投票取众数
    const modeVotes = new Map<string, number>();

    for (const r of list) {
      if (r.iWon) wins++;
      levelDelta += r.scoreDelta;
      coinsDelta += r.coins;
      if (r.iAmBanker) bankerCount++;
      if (r.iWon) bestLevel = Math.max(bestLevel, r.level);
      if (r.timestamp < startedAt) startedAt = r.timestamp;
      if (r.timestamp > endedAt) endedAt = r.timestamp;
      // 一桌里只要有房卡局的记录，这桌就是朋友局
      if (r.isCardRoom) isCardRoom = true;
      modeVotes.set(r.mode, (modeVotes.get(r.mode) ?? 0) + 1);
    }

    let mode = '';
    let topVotes = -1;
    for (const [m, n] of modeVotes) {
      if (n > topVotes) { mode = m; topVotes = n; }
    }

    const roundCount = list.length;
    // 说「赢/输 N 级」而不是「净 +N 级」：牌桌上没人用"净"这个字
    const tail = levelDelta > 0
      ? `赢 ${levelDelta} 级`
      : levelDelta < 0
        ? `输 ${-levelDelta} 级`
        : '不输不赢';

    groups.push({
      key,
      roomId,
      isLegacy,
      roomLabel: labelOf(roomId),
      mode,
      startedAt: startedAt === Number.POSITIVE_INFINITY ? endedAt : startedAt,
      endedAt,
      roundCount,
      wins,
      losses: roundCount - wins,
      winRate: roundCount > 0 ? Math.round((wins / roundCount) * 100) : 0,
      levelDelta,
      coinsDelta,
      bankerCount,
      bestLevel,
      isCardRoom,
      headline: `${roundCount} 局 · ${tail}`,
      rounds: sorted,
    });
  }

  /* 最近打的桌在最前面。
   * 「早期记录」永远垫底：它是一坨没有房间概念的历史数据，
   * 混在正常的桌子中间会打断"最近打了哪几桌"的阅读节奏。 */
  return groups.sort((a, b) => {
    if (a.isLegacy !== b.isLegacy) return a.isLegacy ? 1 : -1;
    return b.endedAt - a.endedAt;
  });
}

/** 开房记录的总览（战绩页那一行小字用）。 */
export function summarizeRooms(groups: RoomGroup[]): {
  roomCount: number;
  roundCount: number;
  /** 一句话，如「近期 3 桌 · 共 17 局」。0 桌时给空串，调用方就不渲染。 */
  text: string;
} {
  const roomCount = groups.length;
  const roundCount = groups.reduce((n, g) => n + g.roundCount, 0);
  return {
    roomCount,
    roundCount,
    text: roomCount > 0 ? `${roomCount} 桌 · 共 ${roundCount} 局` : '',
  };
}

export { signed as formatSignedLevel };
