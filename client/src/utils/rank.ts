// ===== 段位换算（全局唯一口径） =====
// 此前 Settlement / Records / Profile 各写了一份，档位与下一档门槛互相矛盾
// （钻石的 next 分别写成 5000 / 3000 / 不存在），升段判断也因此失准。
// 所有段位相关展示统一走这里。

export type RankId = 'bronze' | 'silver' | 'gold' | 'diamond';

export interface RankTier {
  id: RankId;
  /** 中文段位名 */
  name: string;
  /** CSS 类名。注意黄金与钻石都偏金色，但类名不同，不能用它判断升段。 */
  cls: string;
  /** 本档最低分 */
  min: number;
  /** 进入下一档所需分数；顶档为 null */
  next: number | null;
}

/** 段位阶梯，从低到高。与 Matchmaking 的筛选区间保持一致。 */
export const RANK_TIERS: readonly RankTier[] = [
  { id: 'bronze',  name: '青铜', cls: 'bronze',    min: 0,    next: 500 },
  { id: 'silver',  name: '白银', cls: 'silver',    min: 500,  next: 1000 },
  { id: 'gold',    name: '黄金', cls: 'gold',      min: 1000, next: 2000 },
  { id: 'diamond', name: '钻石', cls: 'gold-deep', min: 2000, next: null },
] as const;

/** 按累计总分取段位。负分按最低档处理。 */
export function rankOf(score: number): RankTier {
  let tier = RANK_TIERS[0];
  for (const t of RANK_TIERS) {
    if (score >= t.min) tier = t;
  }
  return tier;
}

/**
 * 是否升段。必须比较 id：黄金和钻石的视觉都偏金色，
 * 早先用 cls 比较会漏判「黄金 -> 钻石」。
 */
export function isRankUp(oldScore: number, newScore: number): boolean {
  return rankIndex(newScore) > rankIndex(oldScore);
}

/** 是否降段。 */
export function isRankDown(oldScore: number, newScore: number): boolean {
  return rankIndex(newScore) < rankIndex(oldScore);
}

/** 段位在阶梯中的序号，越大越高。 */
export function rankIndex(score: number): number {
  return RANK_TIERS.findIndex(t => t.id === rankOf(score).id);
}

/** 当前段位内的升级进度 0-100。顶档恒为 100。 */
export function rankProgress(score: number): number {
  const tier = rankOf(score);
  if (tier.next === null) return 100;
  const span = tier.next - tier.min;
  const done = Math.max(0, score - tier.min);
  return Math.max(0, Math.min(100, (done / span) * 100));
}

/** 段位内小等级，每 100 分一级，用于「青铜 3」这类展示。 */
export function rankLevel(score: number): number {
  return Math.floor(Math.max(0, score) / 100) + 1;
}

/** 下一段位的中文名，顶档返回 null（此前 Records 里硬编码了并不存在的「王者」档）。 */
export function nextRankName(score: number): string | null {
  const idx = rankIndex(score);
  const next = RANK_TIERS[idx + 1];
  return next ? next.name : null;
}
