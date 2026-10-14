/**
 * 账号 / 经济相关的 HTTP 接口。
 *
 * 路由统一挂在 /api 下，由 index.ts 调用 registerApi(app) 装载。
 *
 * 认证方式：请求头 `Authorization: Bearer <token>`。
 * token 在注册/登录时下发一次，客户端存起来（localStorage）后续都带上。
 * 需要登录的接口用 requireAuth 包一层，拿不到账号就返回 401。
 */

// 用 Application 而不是 Express：Colyseus 的 express 回调给的是 Application
// （少了 request/response 两个属性），写 Express 会类型不匹配。
import type { Application, Request, Response } from 'express';
import {
  createAccount, loginByPhone, authByToken, renameAccount, toView, getById,
  purchase, exchangeStars, exchangePhysical,
  claimSignin, signinStatus, claimAdReward, adRewardLeft,
  claimWelfare, welfareNextAt,
  claimShareReward, shareRewardLeft, claimBankruptAid, bankruptAidLeft,
  claimDailyRoomCards, dailyRoomCardsLeft, exchangeRoomCards,
  listRounds, statsOf, leaderboard,
} from './accounts.js';
import { registerAdminApi, beatOnline } from './admin.js';
import { createTicket, listMyTickets, TICKET_DAILY_LIMIT, type TicketKind } from './tickets.js';
import {
  SHOP_PRODUCTS, PHYSICAL_GOODS, PHYSICAL_EXCHANGE_ENABLED,
  COINS_PER_STAR, SIGNIN_REWARDS, AD_REWARD, WELFARE, ROUND_REWARD,
  SHARE_REWARD, BANKRUPT_AID, ROOM_TIERS, ROOM_CARD, ROOM_CARD_DAILY,
} from './economy.js';

/** 从 Authorization 头取出 token。 */
function bearer(req: Request): string {
  const raw = req.header('authorization') ?? '';
  return raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : '';
}

/** 包装需要登录的处理器：统一做认证与异常兜底。 */
function requireAuth(
  handler: (accountId: string, req: Request, res: Response) => void,
) {
  return (req: Request, res: Response) => {
    const account = authByToken(bearer(req));
    if (!account) {
      res.status(401).json({ success: false, error: '未登录或登录已过期' });
      return;
    }
    try {
      handler(account.id, req, res);
    } catch (err) {
      // 业务错误（金币不足、已拥有…）用 400 返回文案，前端直接弹给用户
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : '操作失败' });
    }
  };
}

/** 不需要登录的处理器的异常兜底。 */
function guarded(handler: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    try {
      handler(req, res);
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : '操作失败' });
    }
  };
}

export function registerApi(app: Application): void {
  // ===================== 账号 =====================

  /**
   * 游客登录：直接建一个正式账号。
   * 游客也有金币和战绩，只是没绑手机号，换设备就找不回来了。
   */
  app.post('/api/auth/guest', guarded((req, res) => {
    const nickname = String(req.body?.nickname ?? '').trim() || `玩家${Math.floor(Math.random() * 9000 + 1000)}`;
    const { account, token } = createAccount({ nickname, authMethod: 'guest' });
    res.json({ success: true, token, account: toView(account) });
  }));

  /**
   * 手机号登录/注册（号码不存在就注册）。
   *
   * ⚠️ 当前**没有短信验证码校验**：接通道要额外接服务商并做频控，
   * 测试期先用"手机号即身份"。正式对外前必须补验证码，
   * 否则知道手机号就能登进别人账号。
   */
  app.post('/api/auth/phone', guarded((req, res) => {
    const phone = String(req.body?.phone ?? '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      res.status(400).json({ success: false, error: '手机号格式不对' });
      return;
    }
    const { account, token } = loginByPhone(phone, String(req.body?.nickname ?? '').trim() || undefined);
    res.json({ success: true, token, account: toView(account) });
  }));

  /** 用已有 token 恢复登录态（客户端启动时调）。 */
  app.get('/api/me', requireAuth((accountId, _req, res) => {
    res.json({
      success: true,
      account: toView(getById(accountId)!),
      stats: statsOf(accountId),
    });
  }));

  /** 改昵称。 */
  app.post('/api/me/nickname', requireAuth((accountId, req, res) => {
    const account = renameAccount(accountId, String(req.body?.nickname ?? ''));
    res.json({ success: true, account: toView(account!) });
  }));

  /**
   * 在线心跳：客户端每分钟一次，累加当日在线时长。
   *
   * 后台管理的「在线时长」靠它。不用 last_seen_at 算的原因见 admin.ts：
   * 那个只是最后一次出现的时间点，算不出累计时长。
   */
  app.post('/api/me/beat', requireAuth((accountId, _req, res) => {
    beatOnline(accountId);
    res.json({ success: true });
  }));

  // ===================== 反馈 / 举报 =====================

  /**
   * 提交反馈或举报。
   *
   * 这个接口是补一个真实的窟窿：反馈页原来只在前端弹一句"已提交"，
   * 内容直接丢掉，运营侧永远收不到东西。现在真正落库，后台
   * /api/admin/tickets 能看到并改状态。
   */
  app.post('/api/tickets', requireAuth((accountId, req, res) => {
    const kind = String(req.body?.kind ?? 'feedback') as TicketKind;
    const ticket = createTicket(accountId, {
      kind,
      category: req.body?.category,
      title: req.body?.title,
      body: String(req.body?.body ?? ''),
      target: req.body?.target,
      contact: req.body?.contact,
      urgent: !!req.body?.urgent,
      clientInfo: req.body?.clientInfo,
    });
    res.json({ success: true, ticket });
  }));

  /** 我提过的工单（反馈页的历史列表，原来是写死的三条假数据）。 */
  app.get('/api/tickets', requireAuth((accountId, req, res) => {
    const kindRaw = String(req.query?.kind ?? '');
    const kind = kindRaw === 'feedback' || kindRaw === 'report' ? kindRaw : undefined;
    res.json({
      success: true,
      items: listMyTickets(accountId, kind),
      dailyLimit: TICKET_DAILY_LIMIT,
    });
  }));

  // ===================== 商城 =====================

  /** 商品目录 + 我的余额与已购，一次给全，省得前端多跑几趟。 */
  app.get('/api/shop', (req, res) => {
    const account = authByToken(bearer(req));
    res.json({
      success: true,
      // 本项目没有充值：所有商品都是金币价
      products: SHOP_PRODUCTS,
      coinsPerStar: COINS_PER_STAR,
      physical: {
        // 实物兑换做好了但默认锁住，前端据此把入口置灰
        enabled: PHYSICAL_EXCHANGE_ENABLED,
        goods: PHYSICAL_GOODS,
      },
      // 房卡：兑换价与每日免费额度，商城页要显示
      roomCard: {
        coinsPerCard: ROOM_CARD.coinsPerCard,
        exchangeMax: ROOM_CARD.exchangeMax,
        dailyFree: ROOM_CARD_DAILY.cards,
      },
      account: account ? toView(account) : null,
    });
  });

  /** 金币换房卡（可一次换多张，比商品列表里点 N 次方便）。 */
  app.post('/api/shop/exchange-roomcard', requireAuth((accountId, req, res) => {
    const account = exchangeRoomCards(accountId, Number(req.body?.count ?? 1));
    res.json({ success: true, account });
  }));

  /** 买商品（牌背/道具/会员），一律扣金币。 */
  app.post('/api/shop/buy', requireAuth((accountId, req, res) => {
    const { account, product } = purchase(accountId, String(req.body?.productId ?? ''));
    res.json({ success: true, account, product });
  }));

  /** 金币换星币。 */
  app.post('/api/shop/exchange-star', requireAuth((accountId, req, res) => {
    const account = exchangeStars(accountId, Number(req.body?.stars ?? 0));
    res.json({ success: true, account });
  }));

  /** 星币换实物（默认关闭，会返回 400）。 */
  app.post('/api/shop/exchange-physical', requireAuth((accountId, req, res) => {
    const account = exchangePhysical(accountId, String(req.body?.goodId ?? ''));
    res.json({ success: true, account });
  }));

  // ===================== 活动 / 领取 =====================

  /** 活动页要的全部状态：签到进度、广告剩余次数、福利冷却。 */
  app.get('/api/activity', requireAuth((accountId, _req, res) => {
    res.json({
      success: true,
      signin: signinStatus(accountId),
      ad: { left: adRewardLeft(accountId), coins: AD_REWARD.coins, dailyLimit: AD_REWARD.dailyLimit },
      welfare: { nextAt: welfareNextAt(accountId), coins: WELFARE.coins, cooldownHours: WELFARE.cooldownHours },
      share: { left: shareRewardLeft(accountId), coins: SHARE_REWARD.coins, dailyLimit: SHARE_REWARD.dailyLimit },
      aid: {
        left: bankruptAidLeft(accountId),
        coins: BANKRUPT_AID.coins,
        dailyLimit: BANKRUPT_AID.dailyLimit,
        threshold: BANKRUPT_AID.threshold,
      },
      // 房卡：每日免费领取额度，活动页要有一个领取入口
      roomCard: {
        left: dailyRoomCardsLeft(accountId),
        cards: ROOM_CARD_DAILY.cards,
        dailyLimit: ROOM_CARD_DAILY.dailyLimit,
        coinsPerCard: ROOM_CARD.coinsPerCard,
      },
      rewards: SIGNIN_REWARDS,
      roundReward: ROUND_REWARD,
      tiers: ROOM_TIERS,
      account: toView(getById(accountId)!),
    });
  }));

  /** 领每日免费房卡（一天一次，一次给足 5 张）。 */
  app.post('/api/activity/roomcard', requireAuth((accountId, _req, res) => {
    const result = claimDailyRoomCards(accountId);
    if (!result.ok) {
      res.status(400).json({ success: false, error: result.message ?? '领取失败', ...result });
      return;
    }
    res.json({ success: true, ...result, account: toView(getById(accountId)!) });
  }));

  app.post('/api/activity/signin', requireAuth((accountId, _req, res) => {
    const result = claimSignin(accountId);
    res.json({ success: true, ...result, account: toView(getById(accountId)!) });
  }));

  /**
   * 看广告领金币。
   *
   * 这里只做"发奖"，**不校验广告是否真的看完了** —— 真广告要接
   * 广告 SDK 的服务端回调（激励视频的 SSV），那要等接了广告平台再做。
   * 现在的次数上限至少保证了不能无限刷。
   */
  app.post('/api/activity/ad', requireAuth((accountId, _req, res) => {
    const result = claimAdReward(accountId);
    res.json({ success: true, ...result, account: toView(getById(accountId)!) });
  }));

  app.post('/api/activity/welfare', requireAuth((accountId, _req, res) => {
    const result = claimWelfare(accountId);
    res.json({ success: true, ...result, account: toView(getById(accountId)!) });
  }));

  /**
   * 分享领金币。
   *
   * 同看广告：**无法校验用户真的分享成功了** —— 跳到微信之后就不在我们
   * 掌控范围内。只靠每日 10 次上限兜着。
   */
  /* 领取失败（次数用完 / 余额不够门槛）必须回 400 + error。
   * 原来一律回 success:true，前端的 doClaim 只认异常，
   * 于是次数用完时界面照样弹"分享奖励 +0 金币"，看起来像领到了。 */
  app.post('/api/activity/share', requireAuth((accountId, _req, res) => {
    const result = claimShareReward(accountId);
    if (!result.ok) {
      res.status(400).json({ success: false, error: result.message ?? '领取失败', ...result });
      return;
    }
    res.json({ success: true, ...result, account: toView(getById(accountId)!) });
  }));

  /** 破产补助：余额低于门槛才能领，是"输光了还能玩"的安全阀。 */
  app.post('/api/activity/aid', requireAuth((accountId, _req, res) => {
    const result = claimBankruptAid(accountId);
    if (!result.ok) {
      res.status(400).json({ success: false, error: result.message ?? '领取失败', ...result });
      return;
    }
    res.json({ success: true, ...result, account: toView(getById(accountId)!) });
  }));

  // ===================== 战绩 / 排行榜 =====================

  app.get('/api/records', requireAuth((accountId, req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    res.json({ success: true, rounds: listRounds(accountId, limit), stats: statsOf(accountId) });
  }));

  /**
   * 排行榜。不需要登录也能看（但带上 token 时会额外返回"我的名次"）。
   * 好友榜已去掉：没有好友系统，那个 tab 是假的。
   */
  app.get('/api/leaderboard', guarded((req, res) => {
    const kindRaw = String(req.query.kind ?? 'score');
    const kind = (['score', 'winrate', 'coins'] as const).includes(kindRaw as any)
      ? (kindRaw as 'score' | 'winrate' | 'coins')
      : 'score';
    const list = leaderboard(kind, 100);
    const me = authByToken(bearer(req));
    const myIndex = me ? list.findIndex(r => r.id === me.id) : -1;
    res.json({
      success: true,
      kind,
      list,
      me: me ? { id: me.id, rank: myIndex >= 0 ? myIndex + 1 : null } : null,
    });
  }));

  // ===================== 后台管理 =====================
  // 独立一套 /api/admin/* 路由，认证与玩家 token 完全无关（见 admin.ts）。
  registerAdminApi(app);
}
