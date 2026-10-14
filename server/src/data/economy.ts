/**
 * 经济系统数值配置 —— 全站唯一口径。
 *
 * 本项目**没有充值**：金币只能靠赢牌、签到、看广告、分享获得。
 * 因此这里的数字直接决定"玩多久能换到东西"，调整时请连带看兑换价。
 *
 * ── 核心公式 ──────────────────────────────────────────
 *   一局输赢 = 场次底分 × 升的级数 × 身份系数
 *   闲家系数 1.0，庄家 1.5（坐庄风险大，赢多拿、输也多掏，对称）
 *   闲家挖底成功额外 +1 倍底分
 *   输家按同样公式的 LOSS_RATIO(0.8) 倍扣除
 *
 * ── 为什么底分是 100 而不是 1000 ────────────────────────
 *   关键比例是「入场门槛 ÷ 底分」，它代表**能连输几把才被踢出场**。
 *   底分 1000 + 入场 1000 = 1:1，输一把就出局，体验是灾难。
 *   这里统一做成 10:1（入场 = 底分 × 10），约等于能连输 10 把。
 *   把底分降下来而不是把每日赠币抬上去，是为了保住商城的存在意义：
 *   若每天送 10 万，第一天就能买空商城（最贵的年卡 55000），
 *   之后金币再无用处、赢牌也失去意义。
 *
 * ── 设计基准（每天赢 5 输 5、10 局初级场）──────────────
 *   赢 5 局 ≈ 5 × 100 × 2级 = 1000；输 5 局 ≈ -800 → 打牌净 +200
 *   签到 200 + 广告 5×100 + 福利 2×300 + 分享 10×300 = 4300
 *   合计一天约 4500 金币。
 *   → 中档牌背（1200）当天可得，顶级牌背（5000）约 1~2 天，
 *     会员月卡（6000）约 2 天，年卡（55000）约两周。
 *
 * ⚠️ 已知口子（实物兑换开放前必须处理）：
 *   金币可自由换星币（1000:1），而 5kg 大米 = 50 星币 = 5 万金币。
 *   按每天白送 4300 算，不打牌一个月也能白拿一袋米 —— 这是真金白银的成本。
 *   开放实物前应改成「星币只能靠周赛/排行榜名次获得」，
 *   让实物成本和活跃度绑定。当前 PHYSICAL_EXCHANGE_ENABLED=false 兜着。
 */

/**
 * 场次底分表。
 *
 * `stake` 是底分（一局一级的基准金额），`entry` 是入场门槛（金币不够进不去）。
 * entry 恒等于 stake × ENTRY_MULTIPLIER，保证"能连输约 10 把"的手感一致。
 *
 * id 必须与 client/src/pages/ClassicHall.tsx 的 ROOMS[].id 一一对应。
 */
export const ENTRY_MULTIPLIER = 10;

export interface RoomTier {
  id: 'easy' | 'mid' | 'high' | 'master';
  name: string;
  /** 底分：一局一级的基准金额 */
  stake: number;
  /** 入场门槛：金币低于此值不能进 */
  entry: number;
}

export const ROOM_TIERS: readonly RoomTier[] = [
  { id: 'easy',   name: '初级场', stake: 100,    entry: 100 * ENTRY_MULTIPLIER },
  { id: 'mid',    name: '中级场', stake: 500,    entry: 500 * ENTRY_MULTIPLIER },
  { id: 'high',   name: '高级场', stake: 2_000,  entry: 2_000 * ENTRY_MULTIPLIER },
  { id: 'master', name: '大师场', stake: 10_000, entry: 10_000 * ENTRY_MULTIPLIER },
] as const;

export type RoomTierId = RoomTier['id'];

/** 默认场次：没传 tier 时按初级场算（最宽松，不会误扣大钱）。 */
export const DEFAULT_TIER: RoomTierId = 'easy';

/** 按 id 取场次配置，认不出的一律回落到初级场。 */
export function tierOf(id: string | undefined | null): RoomTier {
  return ROOM_TIERS.find(t => t.id === id) ?? ROOM_TIERS[0];
}

/** 金币 -> 星币 汇率：多少金币换 1 星币。 */
export const COINS_PER_STAR = 1000;

/** 一次兑换星币的最小/最大数量（防手滑一次换空，也防刷接口）。 */
export const STAR_EXCHANGE_MIN = 1;
export const STAR_EXCHANGE_MAX = 100;

/** 对局奖励系数。金额本身由场次底分决定，这里只放"乘几倍"。 */
export const ROUND_REWARD = {
  /** 庄家身份系数：坐庄赢多拿、输也多掏（对称，不偏袒任何一方）。 */
  bankerMultiplier: 1.5,
  /** 闲家系数。 */
  playerMultiplier: 1,
  /** 闲家挖底成功额外奖励 = 底分 × 此值。 */
  digBonusStakes: 1,
  /** 输家扣币比例：按赢家同公式算出的额度 × 0.8。
   *  刻意不是 1.0（完全零和）：没有充值渠道，若严格零和，
   *  水平中等的玩家会长期阴跌，只能靠签到过活，容易流失。
   *  0.8 让 50% 胜率的玩家维持小幅正收益，手感松快。
   *  代价是金币总量缓慢增长，靠商城消耗回收。 */
  lossRatio: 0.8,
  /** 一局最少结算这么多（防止 0 级的边界情况白打一局）。 */
  minAbs: 50,
  /**
   * 防挂机刷币：同桌真人不足此数时，金币结算打折。
   * 不设的话玩家可以建私人房带 3 个 AI 反复赢，大师场是 3 万/局。
   */
  minHumansForFullReward: 2,
  /** 真人不足时的奖励折扣（输赢都打折，不能只折赢的）。 */
  botFarmingRatio: 0.5,
} as const;

/**
 * 逃跑惩罚：有了真金币输赢，输家会掉线逃单，必须让逃跑比认输更亏。
 * 中途退出按当前级数判负扣币，并额外扣此比例作为罚金。
 */
export const ESCAPE_PENALTY = {
  /** 罚金 = 判负额度 × 此值（1.5 = 比正常认输多亏 50%）。 */
  ratio: 1.5,
  /** 至少扣这么多，防止开局立刻跑没有成本。 */
  minCoins: 200,
} as const;

/** 每日签到：连签 7 天递增，第 8 天回到第 1 档循环。 */
export const SIGNIN_REWARDS = [200, 250, 300, 350, 400, 500, 800] as const;

/** 看广告领金币。 */
export const AD_REWARD = {
  coins: 100,
  /** 每天最多看几次。 */
  dailyLimit: 5,
} as const;

/** 独家福利：每 N 小时可领一次。 */
export const WELFARE = {
  coins: 300,
  cooldownHours: 6,
} as const;

/**
 * 分享送金币。
 *
 * ⚠️ 技术上**无法验证用户真的分享成功了** —— 跳到微信之后就不在我们掌控范围内。
 * 和看广告一样，只能靠每日次数上限兜着，不能当成"确认分享"的奖励。
 */
export const SHARE_REWARD = {
  coins: 300,
  dailyLimit: 10,
} as const;

/**
 * 破产补助 —— 没有充值渠道时最关键的安全阀。
 *
 * 一旦开始扣输家的钱，就必须保证玩家不会被永久卡死：
 * 新人连输几把归零后若无法继续，只能卸载。
 * 门槛设在「不够初级场入场费」的位置，领一次刚好能再买入。
 */
export const BANKRUPT_AID = {
  /** 金币低于此值才能领（= 初级场入场门槛）。 */
  threshold: 500,
  coins: 1_000,
  dailyLimit: 10,
} as const;

/** 新账号开局赠送 = 3 个初级场买入，一进来就能玩，还够买个中档牌背。 */
export const NEW_ACCOUNT_COINS = 3000;

/* ============================================================
   房卡（朋友局）
   ------------------------------------------------------------
   为什么要有房卡局：金币局有输赢，朋友之间开房娱乐并不想赔钱。
   房卡局 = 房主花一张卡买下整个房间，桌上所有人都不输赢金币。

   三个关键决策（用户明确确认过）：
   1. **一张管一整个房间**，只扣房主，其他人免费进。
      所以建房时扣一次，不是每局扣、也不是每人扣。
   2. **不算金币输赢**，但**算级别结算**（战绩/胜率/积分照旧记）。
      否则朋友局打再多也不上分，没有目标感。
   3. 房卡局**不收入场费也不看余额**：金币为 0 的人也能被朋友拉进来玩。
   ============================================================ */
export const ROOM_CARD = {
  /** 商城兑换价：多少金币换 1 张房卡。 */
  coinsPerCard: 200,
  /** 一次兑换的数量上限（防手滑一次换空）。 */
  exchangeMax: 50,
  /** 建一个房卡局消耗几张（一张管整房）。 */
  costPerRoom: 1,
} as const;

/** 每日免费领房卡：没金币也能天天和朋友开局。 */
export const ROOM_CARD_DAILY = {
  cards: 5,
  /** 每天只能领一次（一次领足 5 张）。 */
  dailyLimit: 1,
} as const;

/**
 * 商品目录。价格一律是**金币**（本项目无人民币计价）。
 *
 * 会员（vip）按天数算，购买后累加到 vip_until。
 * 牌背（cardback）和道具（item）是一次性拥有。
 */
export interface ShopProduct {
  id: string;
  type: 'cardback' | 'item' | 'vip' | 'star' | 'roomcard';
  name: string;
  sub?: string;
  /** 金币价 */
  price: number;
  /** vip 专用：赠送天数 */
  days?: number;
  /** 上架开关：false 时接口拒绝购买（用于"做好但暂不开放"）。 */
  enabled: boolean;
}

export const SHOP_PRODUCTS: readonly ShopProduct[] = [
  // ---- 牌背：与 client/src/utils/preferences.ts 的 CARD_BACKS 一一对应 ----
  { id: 'back_blue',    type: 'cardback', name: '默认蓝金', price: 0,    enabled: true },
  { id: 'back_green',   type: 'cardback', name: '墨绿丝绸', price: 800,  enabled: true },
  { id: 'back_red',     type: 'cardback', name: '红木龙纹', price: 1200, enabled: true },
  { id: 'back_purple',  type: 'cardback', name: '紫金星空', price: 1800, enabled: true },
  { id: 'back_festive', type: 'cardback', name: '喜庆红',   price: 2000, enabled: true },
  { id: 'back_gold',    type: 'cardback', name: '黄金 VIP', price: 5000, enabled: true },

  // ---- 道具 ----
  { id: 'item_rename',  type: 'item', name: '改名卡', sub: '更改一次昵称',   price: 500,  enabled: true },
  { id: 'item_counter', type: 'item', name: '记牌器', sub: '牌桌显示剩余牌', price: 800,  enabled: true },

  /* ---- 房卡 ----
     和牌背/道具不同，房卡是**可堆叠的消耗品**，不能走 owned_items
     （那张表同一商品只能一条，买第二张会报「已拥有」）。
     所以它在 buyProduct 里走单独分支，直接加 room_cards 余额。 */
  { id: 'roomcard_1', type: 'roomcard', name: '房卡 ×1', sub: '开一个朋友局，整桌不输赢金币', price: ROOM_CARD.coinsPerCard, enabled: true },

  // ---- 会员：改成金币计价（原来是 ¥30/¥88/¥298 的假支付） ----
  { id: 'vip_month',   type: 'vip', name: '会员月卡', sub: '30 天',  price: 6000,  days: 30,  enabled: true },
  { id: 'vip_quarter', type: 'vip', name: '会员季卡', sub: '90 天',  price: 16000, days: 90,  enabled: true },
  { id: 'vip_year',    type: 'vip', name: '会员年卡', sub: '365 天', price: 55000, days: 365, enabled: true },
] as const;

/** 会员权益：每日签到额外倍率。 */
export const VIP_SIGNIN_MULTIPLIER = 2;

/**
 * 星币实物兑换目录。
 *
 * **整块功能默认关闭**（enabled: false）：实物兑换涉及资质与履约，
 * 上线开放前必须先确认合规。接口在 enabled=false 时一律拒绝，
 * 前端也据此把入口置灰显示「即将开放」。
 */
export const PHYSICAL_EXCHANGE_ENABLED = false;

export interface PhysicalGood {
  id: string;
  name: string;
  sub: string;
  /** 星币价 */
  stars: number;
}

export const PHYSICAL_GOODS: readonly PhysicalGood[] = [
  { id: 'rice_5kg',  name: '大米 5kg',    sub: '东北长粒香',   stars: 50 },
  { id: 'oil_5l',    name: '食用油 5L',   sub: '一级大豆油',   stars: 60 },
  { id: 'noodle',    name: '挂面 5 斤',   sub: '手工细面',     stars: 25 },
  { id: 'salt_box',  name: '食盐 10 包',  sub: '加碘精制盐',   stars: 15 },
  { id: 'soy_2l',    name: '酱油 2L',     sub: '特级酿造',     stars: 20 },
  { id: 'gift_box',  name: '粮油礼盒',    sub: '米+油+面组合', stars: 120 },
] as const;

/** 段位阶梯，与前端 utils/rank.ts 保持一致（改一处必须改两处）。 */
export const RANK_TIERS = [
  { id: 'bronze',  name: '青铜', min: 0 },
  { id: 'silver',  name: '白银', min: 500 },
  { id: 'gold',    name: '黄金', min: 1000 },
  { id: 'diamond', name: '钻石', min: 2000 },
] as const;

/** 按累计积分取段位名。 */
export function rankNameOf(score: number): string {
  let name: string = RANK_TIERS[0].name;
  for (const tier of RANK_TIERS) if (score >= tier.min) name = tier.name;
  return name;
}

/**
 * 算一局该发多少金币（正数=进账，负数=扣钱）。
 *
 * 公式：底分 × 级数 × 身份系数（+ 挖底奖励），输家再乘 lossRatio。
 * 真人不足时整体打折，防止带 AI 刷币。
 *
 * @param won        我这局赢了没
 * @param level      级数（结算的 level）
 * @param isBanker   我是庄家吗
 * @param digSuccess 我方挖底成功吗（只对闲家生效）
 * @param tierId     场次 id，决定底分；不传按初级场
 * @param humanCount 同桌真人数，不足 2 人时奖励打折；不传视为达标
 */
export function calcRoundCoins(
  won: boolean,
  level: number,
  isBanker: boolean,
  digSuccess: boolean,
  tierId: string = DEFAULT_TIER,
  humanCount?: number,
): number {
  const stake = tierOf(tierId).stake;
  const levels = Math.max(1, level);
  const roleMul = isBanker ? ROUND_REWARD.bankerMultiplier : ROUND_REWARD.playerMultiplier;

  let amount = stake * levels * roleMul;
  // 挖底只归闲家：庄家不存在"挖自己的底"
  if (digSuccess && !isBanker) amount += stake * ROUND_REWARD.digBonusStakes;
  // 输家按比例扣，不是完全零和（见 ROUND_REWARD.lossRatio 注释）
  if (!won) amount *= ROUND_REWARD.lossRatio;

  // 防挂机刷币：输赢都打折，不能只折赢的（否则带 AI 送分反而划算）
  if (humanCount !== undefined && humanCount < ROUND_REWARD.minHumansForFullReward) {
    amount *= ROUND_REWARD.botFarmingRatio;
  }

  const abs = Math.max(ROUND_REWARD.minAbs, Math.round(amount));
  // `|| 0` 归一化 -0：它会一路带到 JSON 和流水里显示成 "-0"，看着像 bug
  return (won ? abs : -abs) || 0;
}

/**
 * 算逃跑该扣多少金币。中途退出按判负处理，再加罚金。
 */
export function calcEscapePenalty(
  level: number,
  isBanker: boolean,
  tierId: string = DEFAULT_TIER,
  humanCount?: number,
): number {
  const base = Math.abs(calcRoundCoins(false, level, isBanker, false, tierId, humanCount));
  return -Math.max(ESCAPE_PENALTY.minCoins, Math.round(base * ESCAPE_PENALTY.ratio));
}
