/**
 * 账号与经济的业务逻辑层。
 *
 * 所有"改余额"的动作都必须走这里的函数，不要在别处直接 UPDATE accounts —
 * 这里会同时写 ledger 流水，绕过去就查不出账了。
 */

import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { getDb } from './db.js';
import {
  NEW_ACCOUNT_COINS, COINS_PER_STAR, SHOP_PRODUCTS, SIGNIN_REWARDS,
  AD_REWARD, WELFARE, VIP_SIGNIN_MULTIPLIER, STAR_EXCHANGE_MIN, STAR_EXCHANGE_MAX,
  SHARE_REWARD, BANKRUPT_AID, ROOM_CARD, ROOM_CARD_DAILY,
  PHYSICAL_EXCHANGE_ENABLED, PHYSICAL_GOODS, rankNameOf,
} from './economy.js';

export interface Account {
  id: string;
  phone: string | null;
  nickname: string;
  authMethod: 'phone' | 'guest';
  coins: number;
  stars: number;
  /** 房卡：建房卡局的门票。一张管一整个房间，只扣房主。 */
  roomCards: number;
  score: number;
  vipUntil: number;
  createdAt: number;
  lastSeenAt: number;
}

/** 对外返回的账号视图（永远不含 token，token 只在登录/注册时单独给一次）。 */
export interface AccountView extends Account {
  isVip: boolean;
  rankName: string;
  owned: string[];
}

/**
 * 可变动的资产种类。
 *
 * roomCards 与 coins/stars 并列，而不是单独弄一套函数：
 * 这样房卡的每次增减也自动进 ledger 流水，
 * 玩家问「我房卡怎么少了」时查得出来。
 */
type Currency = 'coins' | 'stars' | 'roomCards';
type LedgerReason = 'round' | 'daily' | 'welfare' | 'ad' | 'shop' | 'exchange' | 'vip' | 'admin' | 'signup'
  | 'share' | 'aid' | 'escape' | 'roomcard';

/** 货币 -> accounts 表列名。写成表而不是三元运算，以后再加资产不容易漏改。 */
const CURRENCY_COLUMN: Record<Currency, 'coins' | 'stars' | 'room_cards'> = {
  coins: 'coins',
  stars: 'stars',
  roomCards: 'room_cards',
};

const CURRENCY_LABEL: Record<Currency, string> = {
  coins: '金币',
  stars: '星币',
  roomCards: '房卡',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** token 只存哈希：库被拖走也不能直接拿去登录。 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function rowToAccount(row: any): Account {
  return {
    id: row.id,
    phone: row.phone ?? null,
    nickname: row.nickname,
    authMethod: row.auth_method,
    coins: row.coins,
    stars: row.stars,
    roomCards: row.room_cards ?? 0,
    score: row.score,
    vipUntil: row.vip_until,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** 把账号包装成对外视图：补上会员状态、段位名、已购清单。 */
export function toView(account: Account): AccountView {
  return {
    ...account,
    isVip: account.vipUntil > Date.now(),
    rankName: rankNameOf(account.score),
    owned: listOwned(account.id),
  };
}

// ===================== 注册 / 登录 =====================

/**
 * 创建账号。
 *
 * 游客与手机号走同一张表：游客也要能存金币和战绩，
 * 差别只是 phone 为 NULL、authMethod 为 'guest'。
 * @returns 账号与一次性返回的 token（客户端保存后即可免登录）
 */
export function createAccount(input: {
  nickname: string;
  phone?: string | null;
  authMethod?: 'phone' | 'guest';
}): { account: Account; token: string } {
  const db = getDb();
  const now = Date.now();
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  const phone = input.phone?.trim() || null;
  const method = input.authMethod ?? (phone ? 'phone' : 'guest');

  if (phone && findByPhone(phone)) {
    throw new Error('该手机号已注册');
  }

  db.prepare(`
    INSERT INTO accounts (id, phone, nickname, auth_method, token, coins, stars, score, vip_until, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
  `).run(id, phone, input.nickname.trim() || '玩家', method, hashToken(token), NEW_ACCOUNT_COINS, now, now);

  // 开局赠币也要留流水，否则对不上账
  db.prepare(`
    INSERT INTO ledger (account_id, at, currency, delta, balance, reason, memo)
    VALUES (?, ?, 'coins', ?, ?, 'signup', '新账号赠送')
  `).run(id, now, NEW_ACCOUNT_COINS, NEW_ACCOUNT_COINS);

  return { account: getById(id)!, token };
}

export function getById(id: string): Account | null {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  return row ? rowToAccount(row) : null;
}

export function findByPhone(phone: string): Account | null {
  const row = getDb().prepare('SELECT * FROM accounts WHERE phone = ?').get(phone.trim());
  return row ? rowToAccount(row) : null;
}

/** 用 token 认证。顺带刷新 last_seen_at，用于统计活跃。 */
export function authByToken(token: string): Account | null {
  if (!token) return null;
  const row = getDb().prepare('SELECT * FROM accounts WHERE token = ?').get(hashToken(token));
  if (!row) return null;
  const account = rowToAccount(row);
  getDb().prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').run(Date.now(), account.id);
  return account;
}

/**
 * 手机号登录。
 *
 * 注意：这里**没有做短信验证码校验** —— 短信通道要单独接服务商（阿里云/腾讯云）
 * 并做频控。当前实现是"手机号存在即登录，不存在即注册"，
 * 属于测试期的简化口径，正式对外前必须补验证码，否则知道手机号就能登进别人账号。
 */
export function loginByPhone(phone: string, nickname?: string): { account: Account; token: string } {
  const existing = findByPhone(phone);
  if (existing) {
    // 换新 token：等于"这台设备的登录态"，老设备的 token 自然失效
    const token = randomBytes(32).toString('hex');
    getDb().prepare('UPDATE accounts SET token = ?, last_seen_at = ? WHERE id = ?')
      .run(hashToken(token), Date.now(), existing.id);
    return { account: getById(existing.id)!, token };
  }
  return createAccount({ nickname: nickname || `玩家${phone.slice(-4)}`, phone, authMethod: 'phone' });
}

/** 改昵称。 */
export function renameAccount(id: string, nickname: string): Account | null {
  const name = nickname.trim().slice(0, 12);
  if (!name) throw new Error('昵称不能为空');
  getDb().prepare('UPDATE accounts SET nickname = ? WHERE id = ?').run(name, id);
  return getById(id);
}

// ===================== 余额变动 =====================

/** 读某种资产的当前余额。 */
function balanceOf(account: Account, currency: Currency): number {
  if (currency === 'coins') return account.coins;
  if (currency === 'stars') return account.stars;
  return account.roomCards;
}

/**
 * 给账号加/减货币，并写流水。
 *
 * 余额不允许变成负数：不足时抛错而不是悄悄扣成 0，
 * 否则"金币不足还买成了"这种 bug 会很难查。
 */
export function adjustBalance(
  accountId: string,
  currency: Currency,
  delta: number,
  reason: LedgerReason,
  memo?: string,
): Account {
  const db = getDb();
  const account = getById(accountId);
  if (!account) throw new Error('账号不存在');

  const current = balanceOf(account, currency);
  const next = current + delta;
  if (next < 0) throw new Error(`${CURRENCY_LABEL[currency]}不足`);

  const column = CURRENCY_COLUMN[currency];
  db.prepare(`UPDATE accounts SET ${column} = ? WHERE id = ?`).run(next, accountId);
  db.prepare(`
    INSERT INTO ledger (account_id, at, currency, delta, balance, reason, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(accountId, Date.now(), currency, delta, next, reason, memo ?? null);

  return getById(accountId)!;
}

/**
 * 扣钱专用：余额不够时**扣到 0 为止**，不抛错。
 *
 * 对局结算扣输家的币必须用这个 —— 用 adjustBalance 会因"金币不足"抛错，
 * 导致这局的战绩、积分全都写不进去（等于白打一局，比少扣钱严重得多）。
 * 返回实际扣掉的金额（负数），供战绩如实记录。
 */
export function adjustBalanceClamped(
  accountId: string,
  currency: Currency,
  delta: number,
  reason: LedgerReason,
  memo?: string,
): number {
  const account = getById(accountId);
  if (!account) throw new Error('账号不存在');
  const current = balanceOf(account, currency);
  const applied = delta < 0 ? -Math.min(current, Math.abs(delta)) : delta;
  if (applied === 0) return 0;
  adjustBalance(accountId, currency, applied, reason, memo);
  return applied;
}

/** 累计积分变动（决定段位），不走流水。 */
export function addScore(accountId: string, delta: number): Account | null {
  getDb().prepare('UPDATE accounts SET score = MAX(0, score + ?) WHERE id = ?').run(delta, accountId);
  return getById(accountId);
}

/**
 * 读账号的资产流水（最新在前）。
 *
 * 后台管理的「手动充值记录」和客成排查「我金币怎么少了」都靠它。
 */
export function listLedger(accountId: string, limit = 50): any[] {
  return getDb().prepare(
    'SELECT * FROM ledger WHERE account_id = ? ORDER BY at DESC LIMIT ?'
  ).all(accountId, limit);
}

// ===================== 已购商品 =====================

export function listOwned(accountId: string): string[] {
  return getDb().prepare('SELECT item_id FROM owned_items WHERE account_id = ?')
    .all(accountId).map((r: any) => r.item_id);
}

export function hasItem(accountId: string, itemId: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM owned_items WHERE account_id = ? AND item_id = ?')
    .get(accountId, itemId);
}

/**
 * 购买商城商品。
 *
 * 牌背/道具：一次性拥有，重复买直接拒绝（而不是白扣钱）。
 * 会员：可重复买，天数**累加**到现有到期时间之后（不是覆盖，
 *      否则会员还没到期又买一次就亏了）。
 */
export function purchase(accountId: string, productId: string): { account: AccountView; product: typeof SHOP_PRODUCTS[number] } {
  const product = SHOP_PRODUCTS.find(p => p.id === productId);
  if (!product) throw new Error('商品不存在');
  if (!product.enabled) throw new Error('该商品暂未开放');

  const account = getById(accountId);
  if (!account) throw new Error('账号不存在');

  /* 房卡是可堆叠消耗品，要能反复买，所以不进这个「已拥有」判断。
   * （owned_items 主键是 (account_id, item_id)，房卡写进去只能存一条，
   *   买第二张就会被这里抦住。） */
  if (product.type !== 'vip' && product.type !== 'roomcard' && hasItem(accountId, productId)) {
    throw new Error('已经拥有这件商品了');
  }
  if (account.coins < product.price) {
    throw new Error(`金币不足，还差 ${product.price - account.coins}`);
  }

  if (product.price > 0) {
    adjustBalance(accountId, 'coins', -product.price, 'shop', product.name);
  }

  if (product.type === 'roomcard') {
    // 直接加余额，走 adjustBalance 才有流水
    adjustBalance(accountId, 'roomCards', 1, 'roomcard', `商城兑换（${product.price} 金币）`);
  } else if (product.type === 'vip') {
    const now = Date.now();
    const base = Math.max(now, account.vipUntil);
    const until = base + (product.days ?? 0) * 86_400_000;
    getDb().prepare('UPDATE accounts SET vip_until = ? WHERE id = ?').run(until, accountId);
  } else {
    getDb().prepare('INSERT OR IGNORE INTO owned_items (account_id, item_id, acquired_at) VALUES (?, ?, ?)')
      .run(accountId, productId, Date.now());
  }

  return { account: toView(getById(accountId)!), product };
}

// ===================== 金币 -> 星币 =====================

/** 金币换星币。单向，星币不能换回金币（换回去就能刷汇率了）。 */
export function exchangeStars(accountId: string, stars: number): AccountView {
  const count = Math.floor(stars);
  if (!Number.isFinite(count) || count < STAR_EXCHANGE_MIN) {
    throw new Error(`一次至少兑换 ${STAR_EXCHANGE_MIN} 星币`);
  }
  if (count > STAR_EXCHANGE_MAX) {
    throw new Error(`一次最多兑换 ${STAR_EXCHANGE_MAX} 星币`);
  }
  const cost = count * COINS_PER_STAR;
  const account = getById(accountId);
  if (!account) throw new Error('账号不存在');
  if (account.coins < cost) throw new Error(`金币不足，需要 ${cost}`);

  adjustBalance(accountId, 'coins', -cost, 'exchange', `兑换 ${count} 星币`);
  adjustBalance(accountId, 'stars', count, 'exchange', `消耗 ${cost} 金币`);
  return toView(getById(accountId)!);
}

/**
 * 星币兑换实物。
 *
 * 整块功能由 PHYSICAL_EXCHANGE_ENABLED 控制，默认关闭：
 * 实物兑换涉及资质与履约，开放前必须先确认合规。
 */
export function exchangePhysical(accountId: string, goodId: string): AccountView {
  if (!PHYSICAL_EXCHANGE_ENABLED) throw new Error('实物兑换暂未开放');
  const good = PHYSICAL_GOODS.find(g => g.id === goodId);
  if (!good) throw new Error('商品不存在');
  const account = getById(accountId);
  if (!account) throw new Error('账号不存在');
  if (account.stars < good.stars) throw new Error(`星币不足，需要 ${good.stars}`);
  adjustBalance(accountId, 'stars', -good.stars, 'exchange', `兑换 ${good.name}`);
  return toView(getById(accountId)!);
}

// ===================== 领取类 =====================

/**
 * 每日签到。连签越多给越多，断签回到第 1 档。
 * 会员翻倍（VIP_SIGNIN_MULTIPLIER）。
 */
export function claimSignin(accountId: string): { ok: boolean; coins: number; streak: number; message?: string } {
  const db = getDb();
  const day = today();
  const row = db.prepare('SELECT * FROM signin WHERE account_id = ?').get(accountId) as any;

  if (row?.last_day === day) {
    return { ok: false, coins: 0, streak: row.streak, message: '今天已经签过了，明天再来' };
  }

  // 断签判定：昨天没签就从 1 重新开始
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const streak = row?.last_day === yesterday ? Math.min(row.streak + 1, SIGNIN_REWARDS.length) : 1;

  const account = getById(accountId);
  const base = SIGNIN_REWARDS[streak - 1];
  const coins = account && account.vipUntil > Date.now() ? base * VIP_SIGNIN_MULTIPLIER : base;

  db.prepare(`
    INSERT INTO signin (account_id, last_day, streak) VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET last_day = excluded.last_day, streak = excluded.streak
  `).run(accountId, day, streak);
  adjustBalance(accountId, 'coins', coins, 'daily', `连签第 ${streak} 天`);

  return { ok: true, coins, streak };
}

/** 签到状态（前端画 7 格进度用）。 */
export function signinStatus(accountId: string): { streak: number; claimedToday: boolean; rewards: readonly number[] } {
  const row = getDb().prepare('SELECT * FROM signin WHERE account_id = ?').get(accountId) as any;
  return {
    streak: row?.streak ?? 0,
    claimedToday: row?.last_day === today(),
    rewards: SIGNIN_REWARDS,
  };
}

/** 看广告领金币，每天有次数上限。 */
export function claimAdReward(accountId: string): { ok: boolean; coins: number; left: number; message?: string } {
  const db = getDb();
  const day = today();
  const row = db.prepare('SELECT count FROM claims WHERE account_id = ? AND kind = ? AND day = ?')
    .get(accountId, 'ad', day) as any;
  const used = row?.count ?? 0;
  if (used >= AD_REWARD.dailyLimit) {
    return { ok: false, coins: 0, left: 0, message: '今天的次数用完了，明天再来' };
  }
  db.prepare(`
    INSERT INTO claims (account_id, kind, day, count, last_at) VALUES (?, 'ad', ?, 1, ?)
    ON CONFLICT(account_id, kind, day) DO UPDATE SET count = count + 1, last_at = excluded.last_at
  `).run(accountId, day, Date.now());
  adjustBalance(accountId, 'coins', AD_REWARD.coins, 'ad', '观看广告');
  return { ok: true, coins: AD_REWARD.coins, left: AD_REWARD.dailyLimit - used - 1 };
}

/** 今天还能看几次广告。 */
export function adRewardLeft(accountId: string): number {
  const row = getDb().prepare('SELECT count FROM claims WHERE account_id = ? AND kind = ? AND day = ?')
    .get(accountId, 'ad', today()) as any;
  return Math.max(0, AD_REWARD.dailyLimit - (row?.count ?? 0));
}

/** 独家福利：按小时冷却。 */
export function claimWelfare(accountId: string): { ok: boolean; coins: number; message?: string; nextAt?: number } {
  const db = getDb();
  const row = db.prepare('SELECT last_at FROM claims WHERE account_id = ? AND kind = ? AND day = ?')
    .get(accountId, 'welfare', 'rolling') as any;
  const cooldown = WELFARE.cooldownHours * 3_600_000;
  const now = Date.now();
  if (row && now - row.last_at < cooldown) {
    const nextAt = row.last_at + cooldown;
    const mins = Math.ceil((nextAt - now) / 60_000);
    const text = mins >= 60 ? `${Math.floor(mins / 60)} 小时后可领` : `${mins} 分钟后可领`;
    return { ok: false, coins: 0, message: text, nextAt };
  }
  db.prepare(`
    INSERT INTO claims (account_id, kind, day, count, last_at) VALUES (?, 'welfare', 'rolling', 1, ?)
    ON CONFLICT(account_id, kind, day) DO UPDATE SET count = count + 1, last_at = excluded.last_at
  `).run(accountId, now);
  adjustBalance(accountId, 'coins', WELFARE.coins, 'welfare', '独家福利');
  return { ok: true, coins: WELFARE.coins };
}

/** 福利下次可领时间；null 表示现在就能领。 */
export function welfareNextAt(accountId: string): number | null {
  const row = getDb().prepare('SELECT last_at FROM claims WHERE account_id = ? AND kind = ? AND day = ?')
    .get(accountId, 'welfare', 'rolling') as any;
  if (!row) return null;
  const nextAt = row.last_at + WELFARE.cooldownHours * 3_600_000;
  return nextAt > Date.now() ? nextAt : null;
}

/**
 * 分享送金币。
 *
 * ⚠️ 不校验用户是否真的分享成功 —— 跳到微信之后我们看不到结果。
 * 和看广告同款限制：只靠每日次数上限兜底。
 */
export function claimShareReward(accountId: string): { ok: boolean; coins: number; left: number; message?: string } {
  const db = getDb();
  const day = today();
  const row = db.prepare('SELECT count FROM claims WHERE account_id = ? AND kind = ? AND day = ?')
    .get(accountId, 'share', day) as any;
  const used = row?.count ?? 0;
  if (used >= SHARE_REWARD.dailyLimit) {
    return { ok: false, coins: 0, left: 0, message: '今天的分享奖励领完了，明天再来' };
  }
  db.prepare(`
    INSERT INTO claims (account_id, kind, day, count, last_at) VALUES (?, 'share', ?, 1, ?)
    ON CONFLICT(account_id, kind, day) DO UPDATE SET count = count + 1, last_at = excluded.last_at
  `).run(accountId, day, Date.now());
  adjustBalance(accountId, 'coins', SHARE_REWARD.coins, 'share', '分享奖励');
  return { ok: true, coins: SHARE_REWARD.coins, left: SHARE_REWARD.dailyLimit - used - 1 };
}

/** 今天还能领几次分享奖励。 */
export function shareRewardLeft(accountId: string): number {
  const row = getDb().prepare('SELECT count FROM claims WHERE account_id = ? AND kind = ? AND day = ?')
    .get(accountId, 'share', today()) as any;
  return Math.max(0, SHARE_REWARD.dailyLimit - (row?.count ?? 0));
}

/**
 * 破产补助 —— 输光了也能继续玩的安全阀。
 *
 * 只有余额低于门槛才能领，防止有钱人也来白拿。
 */
export function claimBankruptAid(accountId: string): { ok: boolean; coins: number; left: number; message?: string } {
  const db = getDb();
  const account = getById(accountId);
  if (!account) throw new Error('账号不存在');
  if (account.coins >= BANKRUPT_AID.threshold) {
    return { ok: false, coins: 0, left: bankruptAidLeft(accountId), message: `金币低于 ${BANKRUPT_AID.threshold} 才能领补助` };
  }
  const day = today();
  const row = db.prepare('SELECT count FROM claims WHERE account_id = ? AND kind = ? AND day = ?')
    .get(accountId, 'aid', day) as any;
  const used = row?.count ?? 0;
  if (used >= BANKRUPT_AID.dailyLimit) {
    return { ok: false, coins: 0, left: 0, message: '今天的补助领完了，明天再来' };
  }
  db.prepare(`
    INSERT INTO claims (account_id, kind, day, count, last_at) VALUES (?, 'aid', ?, 1, ?)
    ON CONFLICT(account_id, kind, day) DO UPDATE SET count = count + 1, last_at = excluded.last_at
  `).run(accountId, day, Date.now());
  adjustBalance(accountId, 'coins', BANKRUPT_AID.coins, 'aid', '破产补助');
  return { ok: true, coins: BANKRUPT_AID.coins, left: BANKRUPT_AID.dailyLimit - used - 1 };
}

// ===================== 房卡 =====================

/**
 * 每日免费领房卡。
 *
 * 不看余额、不看金币：房卡局就是给没钱也想和朋友玩的人准备的。
 * 一天只能领一次，一次直接给足 ROOM_CARD_DAILY.cards 张。
 */
export function claimDailyRoomCards(
  accountId: string,
): { ok: boolean; cards: number; left: number; message?: string } {
  const db = getDb();
  const day = today();
  const row = db.prepare('SELECT count FROM claims WHERE account_id = ? AND kind = ? AND day = ?')
    .get(accountId, 'roomcard', day) as any;
  const used = row?.count ?? 0;
  if (used >= ROOM_CARD_DAILY.dailyLimit) {
    return { ok: false, cards: 0, left: 0, message: '今天的免费房卡已经领过了，明天再来' };
  }
  db.prepare(`
    INSERT INTO claims (account_id, kind, day, count, last_at) VALUES (?, 'roomcard', ?, 1, ?)
    ON CONFLICT(account_id, kind, day) DO UPDATE SET count = count + 1, last_at = excluded.last_at
  `).run(accountId, day, Date.now());
  adjustBalance(accountId, 'roomCards', ROOM_CARD_DAILY.cards, 'roomcard', '每日免费房卡');
  return { ok: true, cards: ROOM_CARD_DAILY.cards, left: ROOM_CARD_DAILY.dailyLimit - used - 1 };
}

/** 今天还能领几次免费房卡。 */
export function dailyRoomCardsLeft(accountId: string): number {
  const row = getDb().prepare('SELECT count FROM claims WHERE account_id = ? AND kind = ? AND day = ?')
    .get(accountId, 'roomcard', today()) as any;
  return Math.max(0, ROOM_CARD_DAILY.dailyLimit - (row?.count ?? 0));
}

/**
 * 用金币兑换房卡（可一次换多张）。
 *
 * 与商城里的「房卡 ×1」商品同价，只是这个接口允许一次换多张，
 * 不用点 10 下。
 */
export function exchangeRoomCards(accountId: string, count: number): AccountView {
  const n = Math.floor(count);
  if (!Number.isFinite(n) || n < 1) throw new Error('至少兑换 1 张房卡');
  if (n > ROOM_CARD.exchangeMax) throw new Error(`一次最多兑换 ${ROOM_CARD.exchangeMax} 张`);

  const cost = n * ROOM_CARD.coinsPerCard;
  const account = getById(accountId);
  if (!account) throw new Error('账号不存在');
  if (account.coins < cost) throw new Error(`金币不足，需要 ${cost}`);

  adjustBalance(accountId, 'coins', -cost, 'exchange', `兑换 ${n} 张房卡`);
  adjustBalance(accountId, 'roomCards', n, 'exchange', `消耗 ${cost} 金币`);
  return toView(getById(accountId)!);
}

/**
 * 建房卡局时扣房卡。
 *
 * 返回是否扣成功；不够时**不报错而是返回 false**，
 * 由调用方（建房流程）给出友好提示。
 */
export function spendRoomCard(accountId: string, memo = '建房消耗'): boolean {
  const account = getById(accountId);
  if (!account) return false;
  if (account.roomCards < ROOM_CARD.costPerRoom) return false;
  adjustBalance(accountId, 'roomCards', -ROOM_CARD.costPerRoom, 'roomcard', memo);
  return true;
}

/** 今天还能领几次破产补助。 */
export function bankruptAidLeft(accountId: string): number {
  const row = getDb().prepare('SELECT count FROM claims WHERE account_id = ? AND kind = ? AND day = ?')
    .get(accountId, 'aid', today()) as any;
  return Math.max(0, BANKRUPT_AID.dailyLimit - (row?.count ?? 0));
}

// ===================== 战绩 =====================

/** 同桌其他人，只为战绩页展示。 */
export interface RoundOpponent { name: string; rankName: string; }

export interface RoundInput {
  accountId: string;
  modeId: string;
  iAmBanker: boolean;
  iWon: boolean;
  level: number;
  scoreDelta: number;
  callScore: number;
  digSuccess: boolean;
  coinsDelta: number;
  // 下面这些是"战绩页展示用"的细节，可选：缺了只是详情里少几行，
  // 不影响胜负统计，所以不强制每个调用点都填。
  /** 庄家阵营是否赢，用于战绩页显示"守庄成功 / 闲家翻盘" */
  bankerWin?: boolean;
  /** 闲家总抓分 */
  opponentScore?: number;
  /** 本局耗时（秒），从发牌到结算 */
  durationSec?: number;
  /** 本局一共打了几墩 */
  trickCount?: number;
  opponents?: RoundOpponent[];
  /**
   * 是不是房卡局（朋友局）。
   *
   * 房卡局的 coinsDelta 永远是 0，但这条战绩仍然要计入胜率。
   * 存这个标记是为了让战绩页把金币欄显示成「朋友局」而不是「0」，
   * 否则玩家看到赢了却没给钱会以为是 bug。
   */
  isCardRoom?: boolean;
  /**
   * 房间号（Colyseus roomId / 自定义房号）。
   *
   * 战绩页要按「一桌」把连着打的几局折叠成一条，靠的就是这个字段。
   * 缺省 '' 表示"不知道哪一桌"（老记录），会被归到「早期记录」。
   */
  roomId?: string;
  /** 这桌的第几局（从 1 开始）。和牌桌顶栏显示的局号是同一个数。 */
  roomRoundNo?: number;
}

export function recordRound(input: RoundInput): void {
  getDb().prepare(`
    INSERT INTO rounds (
      account_id, played_at, mode_id, i_am_banker, i_won, level, score_delta,
      call_score, dig_success, coins_delta,
      banker_win, opponent_score, duration_sec, trick_count, opponents,
      is_card_room, room_id, room_round_no
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.accountId, Date.now(), input.modeId,
    input.iAmBanker ? 1 : 0, input.iWon ? 1 : 0,
    input.level, input.scoreDelta, input.callScore,
    input.digSuccess ? 1 : 0, input.coinsDelta,
    input.bankerWin ? 1 : 0, input.opponentScore ?? 0,
    input.durationSec ?? 0, input.trickCount ?? 0,
    JSON.stringify(input.opponents ?? []),
    input.isCardRoom ? 1 : 0,
    input.roomId ?? '', input.roomRoundNo ?? 0,
  );
}

export function listRounds(accountId: string, limit = 50): any[] {
  return getDb().prepare(
    'SELECT * FROM rounds WHERE account_id = ? ORDER BY played_at DESC LIMIT ?'
  ).all(accountId, limit).map((r: any) => {
    let opponents: RoundOpponent[] = [];
    // 坏 JSON 不能让整页战绩打不开
    try { opponents = JSON.parse(String(r.opponents ?? '[]')); } catch { opponents = []; }
    return {
      id: String(r.id),
      timestamp: r.played_at,
      modeId: r.mode_id,
      iAmBanker: !!r.i_am_banker,
      iWon: !!r.i_won,
      bankerWin: !!r.banker_win,
      level: r.level,
      scoreDelta: r.score_delta,
      callScore: r.call_score,
      digSuccess: !!r.dig_success,
      coinsDelta: r.coins_delta,
      opponentScore: r.opponent_score ?? 0,
      durationSec: r.duration_sec ?? 0,
      trickCount: r.trick_count ?? 0,
      opponents,
      isCardRoom: !!r.is_card_room,
      roomId: String(r.room_id ?? ''),
      roomRoundNo: r.room_round_no ?? 0,
    };
  });
}

/** 战绩汇总（我的页面 / 战绩页顶部用）。 */
export function statsOf(accountId: string) {
  const row = getDb().prepare(`
    SELECT
      COUNT(*)                          AS total,
      COALESCE(SUM(i_won), 0)           AS wins,
      COALESCE(SUM(dig_success), 0)     AS digs,
      COALESCE(SUM(score_delta), 0)     AS totalScore,
      COALESCE(MAX(CASE WHEN i_won THEN level ELSE 0 END), 0) AS bestLevel
    FROM rounds WHERE account_id = ?
  `).get(accountId) as any;
  const total = row?.total ?? 0;
  return {
    totalRounds: total,
    wins: row?.wins ?? 0,
    digs: row?.digs ?? 0,
    totalScore: row?.totalScore ?? 0,
    bestLevel: row?.bestLevel ?? 0,
    winRate: total ? Math.round((row.wins / total) * 100) : 0,
  };
}

// ===================== 排行榜 =====================

/**
 * 排行榜。原来前端是一整页写死的假数据（"天王老子 18920 分"），
 * 现在按真实账号数据出榜。
 *
 * 只统计打过至少 1 局的账号：不然一堆 0 局新号会把榜刷满。
 */
export function leaderboard(kind: 'score' | 'winrate' | 'coins', limit = 100): any[] {
  const db = getDb();
  if (kind === 'coins') {
    return db.prepare(`
      SELECT a.id, a.nickname, a.score, a.coins, a.coins AS metric,
             COUNT(r.id) AS rounds, COALESCE(SUM(r.i_won), 0) AS wins
      FROM accounts a JOIN rounds r ON r.account_id = a.id
      GROUP BY a.id
      ORDER BY a.coins DESC LIMIT ?
    `).all(limit).map(mapRankRow);
  }
  if (kind === 'winrate') {
    // 至少 5 局才上胜率榜，否则打 1 局赢 1 局就是 100%
    return db.prepare(`
      SELECT a.id, a.nickname, a.score, a.coins,
             CAST(ROUND(100.0 * SUM(r.i_won) / COUNT(r.id)) AS INTEGER) AS metric,
             COUNT(r.id) AS rounds, SUM(r.i_won) AS wins
      FROM accounts a JOIN rounds r ON r.account_id = a.id
      GROUP BY a.id HAVING COUNT(r.id) >= 5
      ORDER BY metric DESC, COUNT(r.id) DESC LIMIT ?
    `).all(limit).map(mapRankRow);
  }
  return db.prepare(`
    SELECT a.id, a.nickname, a.score, a.coins, a.score AS metric,
           COUNT(r.id) AS rounds, COALESCE(SUM(r.i_won), 0) AS wins
    FROM accounts a JOIN rounds r ON r.account_id = a.id
    GROUP BY a.id
    ORDER BY a.score DESC LIMIT ?
  `).all(limit).map(mapRankRow);
}

function mapRankRow(row: any) {
  return {
    id: row.id,
    name: row.nickname,
    score: row.score,
    rankName: rankNameOf(row.score),
    metric: row.metric,
    // 榜单行上要显示"打了多少局 / 赢了几局"，光有一个数字看不出含金量
    rounds: row.rounds ?? 0,
    wins: row.wins ?? 0,
    coins: row.coins ?? 0,
  };
}
