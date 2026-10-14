// 账号与经济逻辑测试。用内存库，互不干扰。
process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccount, getById, authByToken, loginByPhone, renameAccount,
  adjustBalance, addScore, purchase, hasItem, exchangeStars, exchangePhysical,
  claimSignin, signinStatus, claimAdReward, adRewardLeft, claimWelfare,
  recordRound, listRounds, statsOf, leaderboard, toView,
  claimShareReward, shareRewardLeft, claimBankruptAid, adjustBalanceClamped,
  claimDailyRoomCards, dailyRoomCardsLeft, exchangeRoomCards, spendRoomCard, listLedger,
} from './accounts.js';
import { beatOnline, onlineSecondsToday, parseGrantKind } from './admin.js';
import { getDb } from './db.js';
import {
  NEW_ACCOUNT_COINS, COINS_PER_STAR, AD_REWARD, SIGNIN_REWARDS,
  calcRoundCoins, calcEscapePenalty, ROOM_TIERS, SHARE_REWARD, BANKRUPT_AID,
  ROOM_CARD, ROOM_CARD_DAILY,
} from './economy.js';

const mk = (nick = '测试') => createAccount({ nickname: nick }).account;

test('新账号有开局赠币，且游客也是正式账号', () => {
  const { account, token } = createAccount({ nickname: '游客甲' });
  assert.equal(account.coins, NEW_ACCOUNT_COINS);
  assert.equal(account.authMethod, 'guest');
  assert.equal(account.phone, null);
  // token 能换回账号，说明登录态可用
  assert.equal(authByToken(token)?.id, account.id);
});

test('token 认证失败时返回 null，不会误放行', () => {
  assert.equal(authByToken('乱填的token'), null);
  assert.equal(authByToken(''), null);
});

test('同一手机号第二次登录是登录而不是重复注册', () => {
  const first = loginByPhone('13800001111', '阿强');
  const second = loginByPhone('13800001111');
  assert.equal(second.account.id, first.account.id, '应该是同一个账号');
  // 换了新 token：等于新设备登录，老 token 失效
  assert.notEqual(second.token, first.token);
  assert.equal(authByToken(first.token), null, '老 token 必须失效');
});

test('手机号重复注册被拒绝', () => {
  // 用本测试专属号段，避免和别的用例抢同一个手机号
  createAccount({ nickname: 'A', phone: '13900003333' });
  assert.throws(() => createAccount({ nickname: 'B', phone: '13900003333' }), /已注册/);
});

test('余额不足时拒绝扣款，不会扣成负数', () => {
  const a = mk();
  assert.throws(() => adjustBalance(a.id, 'coins', -(NEW_ACCOUNT_COINS + 1), 'admin'), /金币不足/);
  assert.equal(getById(a.id)!.coins, NEW_ACCOUNT_COINS, '失败后余额不能变');
});

test('买牌背会真扣金币并记入已拥有，重复买被拒绝', () => {
  const a = mk();
  const before = getById(a.id)!.coins;
  const { account } = purchase(a.id, 'back_green');   // 800
  assert.equal(account.coins, before - 800);
  assert.ok(hasItem(a.id, 'back_green'));
  assert.ok(account.owned.includes('back_green'));
  assert.throws(() => purchase(a.id, 'back_green'), /已经拥有/);
});

test('金币不够买不动，且余额保持原样', () => {
  const a = mk();
  assert.throws(() => purchase(a.id, 'back_gold'), /金币不足/);   // 5000 > 2000
  assert.equal(getById(a.id)!.coins, NEW_ACCOUNT_COINS);
  assert.equal(hasItem(a.id, 'back_gold'), false);
});

test('会员天数是累加而不是覆盖（没到期又买一次不该亏）', () => {
  const a = mk();
  adjustBalance(a.id, 'coins', 100_000, 'admin');
  purchase(a.id, 'vip_month');                       // +30 天
  const first = getById(a.id)!.vipUntil;
  purchase(a.id, 'vip_month');                       // 再 +30 天
  const second = getById(a.id)!.vipUntil;
  const diffDays = Math.round((second - first) / 86_400_000);
  assert.equal(diffDays, 30, '第二次应该在第一次到期后再加 30 天');
  assert.ok(toView(getById(a.id)!).isVip);
});

test('金币换星币：扣对金币、加对星币，且不能反向换回', () => {
  const a = mk();
  adjustBalance(a.id, 'coins', 10_000, 'admin');
  const before = getById(a.id)!.coins;
  const v = exchangeStars(a.id, 3);
  assert.equal(v.stars, 3);
  assert.equal(v.coins, before - 3 * COINS_PER_STAR);
  // 负数/零/超上限都要挡住
  assert.throws(() => exchangeStars(a.id, 0), /至少/);
  assert.throws(() => exchangeStars(a.id, 9999), /最多/);
});

test('星币不够换不了，金币不够也换不了星币', () => {
  const a = mk();   // 2000 金币 = 2 星币
  assert.throws(() => exchangeStars(a.id, 5), /金币不足/);
});

test('实物兑换默认关闭，接口必须拒绝', () => {
  const a = mk();
  adjustBalance(a.id, 'stars', 999, 'admin');
  assert.throws(() => exchangePhysical(a.id, 'rice_5kg'), /暂未开放/);
});

test('每日签到一天只能签一次，连签递增', () => {
  const a = mk();
  const first = claimSignin(a.id);
  assert.equal(first.ok, true);
  assert.equal(first.streak, 1);
  assert.equal(first.coins, SIGNIN_REWARDS[0]);

  const again = claimSignin(a.id);
  assert.equal(again.ok, false, '同一天不能签两次');
  assert.match(again.message!, /已经签过/);

  const status = signinStatus(a.id);
  assert.equal(status.claimedToday, true);
  assert.equal(status.streak, 1);
});

test('看广告领币有每日上限，超了就拒绝', () => {
  const a = mk();
  for (let i = 0; i < AD_REWARD.dailyLimit; i++) {
    const r = claimAdReward(a.id);
    assert.equal(r.ok, true, `第 ${i + 1} 次应该成功`);
  }
  assert.equal(adRewardLeft(a.id), 0);
  const over = claimAdReward(a.id);
  assert.equal(over.ok, false);
  assert.match(over.message!, /次数用完/);
});

test('独家福利有冷却，连领两次第二次被拒', () => {
  const a = mk();
  assert.equal(claimWelfare(a.id).ok, true);
  const second = claimWelfare(a.id);
  assert.equal(second.ok, false);
  assert.match(second.message!, /后可领/);
});

test('战绩能入库并正确汇总', () => {
  const a = mk();
  recordRound({ accountId: a.id, modeId: 'fourPlayerTwoDecks', iAmBanker: true,  iWon: true,  level: 3, scoreDelta: 30,  callScore: 80, digSuccess: false, coinsDelta: 410 });
  recordRound({ accountId: a.id, modeId: 'fourPlayerTwoDecks', iAmBanker: false, iWon: false, level: 2, scoreDelta: -20, callScore: 75, digSuccess: false, coinsDelta: 0 });
  recordRound({ accountId: a.id, modeId: 'fourPlayerTwoDecks', iAmBanker: false, iWon: true,  level: 1, scoreDelta: 10,  callScore: 90, digSuccess: true,  coinsDelta: 220 });

  const s = statsOf(a.id);
  assert.equal(s.totalRounds, 3);
  assert.equal(s.wins, 2);
  assert.equal(s.digs, 1);
  assert.equal(s.totalScore, 20);
  assert.equal(s.winRate, 67);
  assert.equal(s.bestLevel, 3);

  const list = listRounds(a.id);
  assert.equal(list.length, 3);
  assert.equal(list[0].iWon, true, '最新一局在最前');
});

test('战绩会记下「哪一桌、这桌第几局」，老记录缺这两个字段也不报错', () => {
  const a = mk('房间战绩');
  // 同一桌连打 3 局
  for (let i = 1; i <= 3; i++) {
    recordRound({
      accountId: a.id, modeId: 'fourPlayerThreeDecks', iAmBanker: i === 1,
      iWon: i !== 2, level: i, scoreDelta: i * 5, callScore: 100,
      digSuccess: false, coinsDelta: 0, roomId: 'ROOM_A', roomRoundNo: i,
    });
  }
  // 换一桌打 1 局
  recordRound({
    accountId: a.id, modeId: 'fourPlayerThreeDecks', iAmBanker: false, iWon: true,
    level: 1, scoreDelta: 5, callScore: 90, digSuccess: false, coinsDelta: 0,
    roomId: 'ROOM_B', roomRoundNo: 1,
  });
  // 不传房间号（老调用点/老记录的等价情形）
  recordRound({
    accountId: a.id, modeId: 'fourPlayerThreeDecks', iAmBanker: false, iWon: false,
    level: 1, scoreDelta: -5, callScore: 90, digSuccess: false, coinsDelta: 0,
  });

  const list = listRounds(a.id);
  assert.equal(list.length, 5);
  /* 不传房间号的那条必须落成 '' / 0，而不是 undefined ——
   * 前端要靠 `roomId === ''` 把老记录归到「早期记录」，
   * undefined 会让那段判断静默失效。
   * 这里按字段找而不是按 list[0]：5 条是同一毫秒写进去的，
   * ORDER BY played_at 分不出先后（这也正是要单独存局号的原因）。 */
  const legacy = list.filter(r => r.roomId === '');
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].roomRoundNo, 0);

  const roomA = list.filter(r => r.roomId === 'ROOM_A');
  assert.equal(roomA.length, 3, '同一桌的 3 局要能按房间号捞出来');
  // 局号要如实存，不能靠时间倒推（同一秒落库时时间分不出先后）
  assert.deepEqual(roomA.map(r => r.roomRoundNo).sort(), [1, 2, 3]);
  assert.equal(list.filter(r => r.roomId === 'ROOM_B').length, 1);
});

test('排行榜只收录打过牌的账号，胜率榜要求至少 5 局', () => {
  // 干净起见用新昵称，靠"有没有战绩"来断言
  const played = createAccount({ nickname: '打过牌的' }).account;
  const idle   = createAccount({ nickname: '没打过的' }).account;
  addScore(played.id, 3000);
  for (let i = 0; i < 6; i++) {
    recordRound({ accountId: played.id, modeId: 'm', iAmBanker: false, iWon: true, level: 1, scoreDelta: 5, callScore: 80, digSuccess: false, coinsDelta: 100 });
  }

  const scoreBoard = leaderboard('score');
  assert.ok(scoreBoard.some(r => r.id === played.id), '打过牌的要上榜');
  assert.ok(!scoreBoard.some(r => r.id === idle.id), '0 局的不该上榜');

  const wr = leaderboard('winrate');
  assert.ok(wr.some(r => r.id === played.id), '打满 5 局应上胜率榜');
  assert.equal(wr.find(r => r.id === played.id)!.metric, 100);

  // 段位名要跟着积分走
  assert.equal(scoreBoard.find(r => r.id === played.id)!.rankName, '钻石');
});

test('胜率榜挡掉局数太少的账号（打1局赢1局不该是榜一）', () => {
  const rookie = createAccount({ nickname: '只打了一局' }).account;
  recordRound({ accountId: rookie.id, modeId: 'm', iAmBanker: false, iWon: true, level: 1, scoreDelta: 5, callScore: 80, digSuccess: false, coinsDelta: 100 });
  assert.ok(!leaderboard('winrate').some(r => r.id === rookie.id));
});

test('改昵称有长度上限且不能为空', () => {
  const a = mk();
  assert.equal(renameAccount(a.id, '新名字')!.nickname, '新名字');
  assert.equal(renameAccount(a.id, '一二三四五六七八九十十一十二')!.nickname.length, 12);
  assert.throws(() => renameAccount(a.id, '   '), /不能为空/);
});

test('对局奖励算法：底分 × 级数 × 身份系数', () => {
  // 初级场底分 100
  assert.equal(calcRoundCoins(true, 1, false, false, 'easy'), 100, '闲家赢 1 级 = 100×1×1');
  assert.equal(calcRoundCoins(true, 3, false, false, 'easy'), 300, '闲家赢 3 级');
  assert.equal(calcRoundCoins(true, 2, true,  false, 'easy'), 300, '庄家 ×1.5');
  assert.equal(calcRoundCoins(true, 2, false, true,  'easy'), 300, '闲家挖底 +1 倍底分');
  assert.equal(calcRoundCoins(true, 2, true,  true,  'easy'), 300, '庄家没有挖底加成');
  // 场次越高底分越大
  assert.equal(calcRoundCoins(true, 2, false, false, 'mid'),    1_000);
  assert.equal(calcRoundCoins(true, 2, false, false, 'master'), 20_000);
  // 认不出的场次回落到初级场，防止客户端传乱值按大师场扣钱
  assert.equal(calcRoundCoins(true, 2, false, false, '乱写'), 200);
});

test('输家要扣币，但只扣 0.8 倍（不是完全零和）', () => {
  assert.equal(calcRoundCoins(false, 2, false, false, 'easy'), -160, '100×2×1×0.8');
  assert.equal(calcRoundCoins(false, 2, true,  false, 'easy'), -240, '庄家输得更多 ×1.5');
  // 50% 胜率的人应当小幅赚，否则只能靠签到过活
  const win = calcRoundCoins(true, 2, false, false, 'easy');
  const loss = calcRoundCoins(false, 2, false, false, 'easy');
  assert.ok(win + loss > 0, '一赢一输应为正收益');
});

test('防挂机刷币：真人不足 2 人时输赢都打折', () => {
  assert.equal(calcRoundCoins(true, 2, false, false, 'easy', 1), 100, '赢的打 5 折');
  // 输的也必须打折，否则带 AI 故意送分反而划算
  assert.equal(calcRoundCoins(false, 2, false, false, 'easy', 1), -80);
  assert.equal(calcRoundCoins(true, 2, false, false, 'easy', 2), 200, '够 2 个真人就全额');
});

test('逃跑罚金比认输更亏，且有最低额', () => {
  const loss = Math.abs(calcRoundCoins(false, 1, false, false, 'mid'));
  const escape = Math.abs(calcEscapePenalty(1, false, 'mid'));
  assert.ok(escape > loss, '逃跑必须比认输亏得多，否则眼看要输就关页面');
  // 初级场 1 级判负只有 80，罚金要兜到最低 200，免得开局立刻跑没成本
  assert.equal(calcEscapePenalty(1, false, 'easy'), -200);
});

test('场次入场门槛 = 底分 ×10，保证能连输约 10 把', () => {
  for (const tier of ROOM_TIERS) {
    assert.equal(tier.entry, tier.stake * 10, `${tier.name} 门槛应是底分 10 倍`);
    // 拿着入场费进场，闲家连输 2 级要能撑住好几把
    const perLoss = Math.abs(calcRoundCoins(false, 2, false, false, tier.id));
    assert.ok(tier.entry / perLoss >= 4, `${tier.name} 至少能连输 4 把`);
  }
});

test('分享奖励有每日次数上限', () => {
  const a = mk();
  const before = getById(a.id)!.coins;
  let got = 0;
  for (let i = 0; i < SHARE_REWARD.dailyLimit; i++) {
    const r = claimShareReward(a.id);
    assert.equal(r.ok, true, `第 ${i + 1} 次该成功`);
    got += r.coins;
  }
  assert.equal(shareRewardLeft(a.id), 0);
  const over = claimShareReward(a.id);
  assert.equal(over.ok, false, '超出上限要拒绝');
  assert.equal(getById(a.id)!.coins, before + got, '被拒的那次不能加钱');
});

test('破产补助只有余额低于门槛才能领', () => {
  const a = mk();
  // 新号有 3000，远高于门槛，不该给领
  const rich = claimBankruptAid(a.id);
  assert.equal(rich.ok, false, '有钱人不能领补助');
  assert.match(rich.message!, /才能领/);

  // 花到门槛以下再领
  adjustBalance(a.id, 'coins', -(getById(a.id)!.coins - 100), 'admin');
  assert.equal(getById(a.id)!.coins, 100);
  const poor = claimBankruptAid(a.id);
  assert.equal(poor.ok, true, '输光了必须能领，否则新人只能卸载');
  assert.equal(getById(a.id)!.coins, 100 + BANKRUPT_AID.coins);
});

test('扣钱扣不穿：余额不足时扣到 0 为止而不是抛错', () => {
  const a = mk();
  const have = getById(a.id)!.coins;
  // 对局结算若抛错，整局的战绩和积分都会写不进去，比少扣币严重得多
  const applied = adjustBalanceClamped(a.id, 'coins', -(have + 99_999), 'round');
  assert.equal(applied, -have, '实际只能扣掉现有的');
  assert.equal(getById(a.id)!.coins, 0);
  // 已经是 0 了再扣，什么都不该发生
  assert.equal(adjustBalanceClamped(a.id, 'coins', -500, 'round'), 0);
  assert.equal(getById(a.id)!.coins, 0);
});

// ===================== 房卡 =====================

test('新账号房卡为 0，每日可领一次领足 5 张', () => {
  const a = mk();
  assert.equal(getById(a.id)!.roomCards, 0, '新账号不白送房卡，要自己领');
  assert.equal(dailyRoomCardsLeft(a.id), ROOM_CARD_DAILY.dailyLimit);

  const got = claimDailyRoomCards(a.id);
  assert.equal(got.ok, true);
  assert.equal(got.cards, ROOM_CARD_DAILY.cards);
  assert.equal(getById(a.id)!.roomCards, ROOM_CARD_DAILY.cards);

  // 同一天再领必须失败，且不能偷偷加卡
  const again = claimDailyRoomCards(a.id);
  assert.equal(again.ok, false, '一天只能领一次');
  assert.ok(again.message, '失败必须给文案，否则前端会弹“+0”假成功');
  assert.equal(getById(a.id)!.roomCards, ROOM_CARD_DAILY.cards, '重复领不能加卡');
});

test('金币换房卡：按价扣币、不够不换、有上限', () => {
  const a = mk();
  const before = getById(a.id)!.coins;

  const after = exchangeRoomCards(a.id, 3);
  assert.equal(after.roomCards, 3);
  assert.equal(after.coins, before - 3 * ROOM_CARD.coinsPerCard);

  // 超上限 / 非法数量一律报错（而不是默默换 0 张还扣钱）
  assert.throws(() => exchangeRoomCards(a.id, 0), /至少/);
  assert.throws(() => exchangeRoomCards(a.id, ROOM_CARD.exchangeMax + 1), /最多/);

  // 金币花光后不能再换
  adjustBalance(a.id, 'coins', -getById(a.id)!.coins, 'admin');
  assert.throws(() => exchangeRoomCards(a.id, 1), /金币不足/);
  assert.equal(getById(a.id)!.roomCards, 3, '换失败不能凭空多出卡');
});

test('建房扣卡：一张管一房，没卡时返回 false 而不抢错', () => {
  const a = mk();
  // 没卡时不能抢（调用方要拿到 false 才能给友好提示）
  assert.equal(spendRoomCard(a.id), false);

  claimDailyRoomCards(a.id);
  const have = getById(a.id)!.roomCards;
  assert.equal(spendRoomCard(a.id), true);
  assert.equal(getById(a.id)!.roomCards, have - ROOM_CARD.costPerRoom, '一次只扣一张');
});

test('房卡可重复买（堆叠消耗品，不走“已拥有”判断）', () => {
  const a = mk();
  purchase(a.id, 'roomcard_1');
  purchase(a.id, 'roomcard_1');
  assert.equal(getById(a.id)!.roomCards, 2, '第二张必须也能买到');
  // 牌背才是一次性的，重复买要报错而不是白扣钱
  purchase(a.id, 'back_green');
  assert.throws(() => purchase(a.id, 'back_green'), /已经拥有/);
});

test('房卡变动进流水（“我房卡怎么少了”查得出来）', () => {
  const a = mk();
  claimDailyRoomCards(a.id);
  spendRoomCard(a.id, '建房消耗（4 人场）');
  const rows = listLedger(a.id);
  const cardRows = rows.filter((r: any) => r.currency === 'roomCards');
  assert.ok(cardRows.length >= 2, '领取和消耗都要留痕');
  assert.ok(cardRows.some((r: any) => r.delta > 0), '有入账记录');
  assert.ok(cardRows.some((r: any) => r.delta < 0), '有扣减记录');
});

test('房卡局战绩：金币为 0 但仍计入胜率统计', () => {
  const a = mk();
  recordRound({
    accountId: a.id, modeId: 'fourPlayerTwoDecks', iAmBanker: true, iWon: true,
    level: 2, scoreDelta: 20, callScore: 105, digSuccess: false,
    coinsDelta: 0, isCardRoom: true,
  });
  const rounds = listRounds(a.id);
  assert.equal(rounds[0].isCardRoom, true, '标记要能读回来（战绩页靠它把金币欄显示成“朋友局”）');
  assert.equal(rounds[0].coinsDelta, 0);
  // 关键：胜率必须算进去（用户明确要求）
  const stats = statsOf(a.id);
  assert.equal(stats.totalRounds, 1);
  assert.equal(stats.wins, 1);
});

// ===================== 后台：在线时长 =====================

test('在线心跳：首次只建记录不计时，后续累加间隔', async () => {
  const a = mk();
  beatOnline(a.id);
  assert.equal(onlineSecondsToday(a.id), 0, '第一下心跳只能当起点，不能凭空计时');

  await new Promise(r => setTimeout(r, 1100));
  beatOnline(a.id);
  const sec = onlineSecondsToday(a.id);
  assert.ok(sec >= 1, `第二下心跳应该累加上间隔，实际 ${sec}`);
});

test('在线时长有单次上限：关掉页面隔很久再回来不会被算成一直在线', () => {
  const a = mk();
  beatOnline(a.id);
  // 把 last_beat 改到 10 小时前，模拟“关页面很久才回来”
  getDb().prepare('UPDATE online_log SET last_beat = ? WHERE account_id = ?')
    .run(Date.now() - 10 * 3_600_000, a.id);
  beatOnline(a.id, 90);
  const sec = onlineSecondsToday(a.id);
  assert.ok(sec <= 90, `单次最多只能加 90 秒，实际加了 ${sec}`);
});

test('后台发放：kind 漏传或写错必须报错，不能默认发金币', () => {
  // 三种合法类型都要认
  for (const kind of ['coins', 'stars', 'roomCards'] as const) {
    const r = parseGrantKind(kind);
    assert.equal(r.ok, true, `${kind} 应该是合法类型`);
    if (r.ok) assert.equal(r.kind, kind);
  }
  // 漏传：绝不能兜底成 coins，否则运维少写一个字段就白发金币
  for (const bad of [undefined, null, '', 'currency', 'COINS', 'gold', 'roomcards']) {
    const r = parseGrantKind(bad);
    assert.equal(r.ok, false, `${String(bad)} 必须被拒绝，不能静默发金币`);
    if (!r.ok) assert.ok(r.error.includes('kind'), '报错要点明是 kind 字段的问题');
  }
});
