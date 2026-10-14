// ===== Lobby v6 — 五华天王国潮二次元风格 =====
// 横屏优先，严格按样图排版
// 顶栏 / 左入口 / 中央logo+经典卡 / 右2x2卡 / 底左圆钮+底右快速开始

import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import '../styles/lobby-v6.css';
import { ClassicHall } from './ClassicHall';
import { RulesModal } from '../components/RulesModal';
import { retryImport } from '../utils/lazyWithReload';

/* 二级页面懒加载。
 *
 * 每个 import 都过一层 retryImport：发版会删掉旧 hash 的分包文件，
 * 而挂在后台的 App 手里还是老的 index.html，点开二级页时请求的是一个
 * 已经不存在的文件 → 404 → Suspense 干等（它只管 pending 不管 rejected，
 * 外面也没有 ErrorBoundary）→ 那块区域永远空白，且 React 会缓存这个失败，
 * 再点也没用，只有杀掉 App 重开才恢复。
 * 这就是用户反馈的「打开新画面容易没内容，退出重进又可以」。
 * retryImport 会重试一次，还失败就刷新页面拿新的 index.html。 */
const Shop = lazy(retryImport(() => import('./Shop').then(m => ({ default: m.Shop }))));
const Rank = lazy(retryImport(() => import('./Rank').then(m => ({ default: m.Rank }))));
const Rooms = lazy(retryImport(() => import('./Rooms').then(m => ({ default: m.Rooms }))));
const Profile = lazy(retryImport(() => import('./Profile').then(m => ({ default: m.Profile }))));
const Records = lazy(retryImport(() => import('./Records').then(m => ({ default: m.Records }))));
const Matchmaking = lazy(retryImport(() => import('./Matchmaking').then(m => ({ default: m.Matchmaking }))));
const Auth = lazy(retryImport(() => import('./Auth').then(m => ({ default: m.Auth }))));
const Notifications = lazy(retryImport(() => import('./Notifications').then(m => ({ default: m.Notifications }))));
const NotificationDropdown = lazy(retryImport(() => import('./Notifications').then(m => ({ default: m.NotificationDropdown }))));

const Feedback = lazy(retryImport(() => import('./Feedback').then(m => ({ default: m.Feedback }))));
const VipCenter = lazy(retryImport(() => import('./VipCenter').then(m => ({ default: m.VipCenter }))));

import {
  BellIcon, CoinIcon, UserIcon,
  DoorIcon, CartIcon, TrophyIcon, HistoryIcon,
  FlameIcon, StarIcon,
  CloseIcon, GiftIcon, RedPacketIcon,
  GamepadIcon,
  SettingsIcon, ShareIcon, TicketIcon,
} from '../components/icons';
import {
  claimSignin, claimWelfare, claimShareReward, claimBankruptAid, claimAdReward, fetchActivity, fetchLobbyStats,
  claimDailyRoomCards,
  type ActivityData, type LobbyStats,
} from '../utils/api';
import { useAccount, setAccount } from '../hooks/useAccount';
import { rankOf, rankLevel } from '../utils/rank';
import type { NotifActionEvent } from './Notifications';
import { getModeIdForLabel } from '../utils/modeSelection';
import { showToast } from '../utils/toast';
import { sound } from '../utils/sound';
import { InviteShare } from '../components/InviteShare';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
/* 模式表 / 场次表 / 文案函数搬到 lobbyConfig.ts：
   它们是纯数据与纯函数，跟 800 行 JSX 混在一起既难找也没法单测。 */
import {
  CLASSIC_MODE_ID, seatsOfMode, tierLabel, formatCoins, gameHomeUrl, type Tab,
} from './lobbyConfig';
import { CreateRoomModal, JoinRoomModal } from './LobbyModals';
import { LobbyHome } from './LobbyHome';

interface LobbyProps {
  error: string | null;
  onCreateRoom: (playerName: string, aiCount?: number, customRoomId?: string, modeId?: string, tier?: string, cardRoom?: boolean) => Promise<string>;
  onJoinRoom: (roomCode: string, playerName: string) => Promise<void>;
  onLogout?: () => void;
  /** 邀请链接带来的房间号；打开后直接显示在加入房间弹窗里。 */
  initialRoomCode?: string | null;
}

function TabLoader() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 240, color: '#94A3B8', fontSize: 14,
    }}>加载中…</div>
  );
}

// ============================================================
//  主组件
// ============================================================
export function Lobby({ error, onCreateRoom, onJoinRoom, onLogout, initialRoomCode }: LobbyProps) {
  const [playerName, setPlayerName] = useState(() => {
    try { return localStorage.getItem('tw_name') ?? '玩家'; } catch { return '玩家'; }
  });
  const [localError, setLocalError] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [loading, setLoading] = useState(false);
  /** 断网时禁掉入口按钮：原来点了要等 SDK 超时才报错，玩家会连点。 */
  const offline = !useOnlineStatus();
  const [matchmakingMode, setMatchmakingMode] = useState<string | null>(null);
  /* 「分享送金币」必须先真的分享过才能领。
   * 原来领奖按钮在分享面板里但和分享动作无关，打开面板直接点就能拿钱
   * （用户反馈"没分享就可以领金币"）。每次打开面板重置为 false。 */
  const [hasShared, setHasShared] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [notifView, setNotifView] = useState<'dropdown' | 'full'>('dropdown');
  const [showFeedback, setShowFeedback] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('play');
  const [modeId, setModeId] = useState(CLASSIC_MODE_ID);
  const [showClassicHall, setShowClassicHall] = useState(false);
  const [hallDeckCount, setHallDeckCount] = useState<2 | 3 | null>(null); // null=经典模式
  const [showActivity, setShowActivity] = useState(false);
  const [showInvite, setShowInvite] = useState(false);   // 好友：走房间号+链接邀请
  const [showMore, setShowMore] = useState(false);       // 顶栏「更多」面板
  const [showVip, setShowVip] = useState(false);         // 会员中心
  const [shopCat, setShopCat] = useState<'vip' | 'cardback' | 'item' | 'star' | 'roomcard'>('cardback');
  // 房间列表的「自建」要能打开大厅的建房弹窗（此前直接进匹配，等于忽略了「自建」语义）
  const [createRequestKey, setCreateRequestKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  // 金币 / 星币 / 积分全部来自服务端账号，领奖后接口会回传新余额，顶栏跟着变。
  // 之前是 localStorage 里的数字（换设备归零、控制台可改）。
  const { account, refresh: refreshAccount } = useAccount();
  const coins = account?.coins ?? 0;
  const stars = account?.stars ?? 0;
  const roomCards = account?.roomCards ?? 0;
  const myRank = rankOf(account?.score ?? 0);
  /** 活动页状态（签到进度 / 广告剩余 / 福利冷却），打开活动弹窗时拉。 */
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  /** 当前选中的场次，决定底分与入场门槛。默认初级场（最便宜，新号也进得去）。 */
  const [tier, setTier] = useState<string>('easy');
  /** 福利冷却用的秒表：只在活动弹窗开着且还在冷却时跑，避免大厅常驻定时器。 */
  const [nowTick, setNowTick] = useState(() => Date.now());
  const welfareNextAt = activity?.welfare.nextAt ?? null;
  const welfareWaiting = welfareNextAt !== null && welfareNextAt > nowTick;
  useEffect(() => {
    if (!showActivity || !welfareWaiting) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [showActivity, welfareWaiting]);
  /** 冷却剩余的人话文案；null 表示现在就能领。 */
  const welfareWaitText = useMemo(() => {
    if (welfareNextAt === null || welfareNextAt <= nowTick) return null;
    const sec = Math.ceil((welfareNextAt - nowTick) / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const sc = sec % 60;
    if (h > 0) return `${h} 小时 ${m} 分`;
    if (m > 0) return `${m} 分 ${sc} 秒`;
    return `${sc} 秒`;
  }, [welfareNextAt, nowTick]);

  // 账号是唯一的昵称来源：登录/改名后把本地缓存对齐，
  // 否则大厅显示服务端昵称、建房却用旧的 localStorage 名字，牌桌上会不一致。
  useEffect(() => {
    const nick = account?.nickname?.trim();
    if (nick && nick !== playerName) {
      setPlayerName(nick);
      try { localStorage.setItem('tw_name', nick); } catch { /* 隐私模式下写不了，忽略 */ }
    }
  }, [account?.nickname, playerName]);

  /**
   * 待办条数：现在真的能领的东西。
   * 大厅一进来就拉一次（不用等打开活动弹窗），红点才不会说谎。
   */
  /** 大厅真实统计（在线真人数 / 可加入房数），30 秒刷一次。 */
  const [lobbyStats, setLobbyStats] = useState<LobbyStats | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      fetchLobbyStats().then(v => { if (alive) setLobbyStats(v); }).catch(() => { /* 拉不到就不显示 */ });
    };
    pull();
    const id = window.setInterval(pull, 30_000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  const accountId = account?.id;
  const todoCount = useMemo(() => {
    if (!activity) return 0;
    let n = 0;
    if (!activity.signin.claimedToday) n++;
    if (activity.ad.left > 0) n++;
    if (activity.welfare.nextAt === null || activity.welfare.nextAt <= Date.now()) n++;
    return n;
  }, [activity]);

  // 账号就绪后拉一次活动状态，供顶栏红点使用
  useEffect(() => {
    if (!accountId) return;
    fetchActivity().then(setActivity).catch(() => { /* 拉不到就不显示红点 */ });
  }, [accountId]);

  const updateName = (name: string) => {
    setPlayerName(name);
    try { localStorage.setItem('tw_name', name); } catch { }
    setLocalError('');
  };

  const requireName = (): boolean => {
    if (!playerName.trim()) { setLocalError('请先输入昵称'); return false; }
    /* 断网就地拦住。不拦的话请求要等 SDK/HTTP 超时（数秒）才失败，
     * 这段时间里没有任何反馈，玩家会反复点，攒出一串「创建房间失败」。
     * 注意 onLine=true 不代表连得上服务器，所以这里只拦「确定没网」。 */
    if (!navigator.onLine) { setLocalError('当前无网络连接，请检查 Wi-Fi 或移动数据'); return false; }
    return true;
  };

  const handleMatch = async (targetModeId?: string, targetTier?: string) => {
    if (!requireName()) return;
    if (targetTier) setTier(targetTier);
    setMatchmakingMode(targetModeId ?? modeId);
  };

  const startMatchmaking = async (finalModeId: string) => {
    if (!requireName()) return;
    setLoading(true); setLocalError('');
    try {
      const seats = seatsOfMode(finalModeId);
      await onCreateRoom(playerName.trim(), seats - 1, undefined, finalModeId, tier);
    } catch (e: any) {
      const msg = e?.message || String(e) || '未知错误';
      setLocalError(`创建房间失败: ${msg}`);
      setTimeout(() => setMatchmakingMode(null), 1500);
      return;
    } finally { setLoading(false); }
  };

  const handleCreateFromLobby = async (
    customRoomId: string | undefined,
    aiCount: number,
    targetModeId: string,
    cardRoom = false,
    targetTier?: string,
  ) => {
    if (!requireName()) return;
    setLoading(true); setLocalError('');
    try {
      await onCreateRoom(playerName.trim(), aiCount, customRoomId, targetModeId, targetTier ?? tier, cardRoom);
      // 房卡局扣了卡，余额要立即刷新，否则大厅还显示旧数字
      if (cardRoom) refreshAccount();
    } catch (e: any) {
      const msg = e?.message || String(e) || '未知错误';
      setLocalError(`创建房间失败: ${msg}`);
    } finally { setLoading(false); }
  };

  const handleJoinFromLobby = async (code: string) => {
    if (!requireName()) return;
    setLoading(true); setLocalError('');
    try { await onJoinRoom(code.replace(/\D/g, ''), playerName.trim()); }
    catch { } finally { setLoading(false); }
  };

  const handleJoinFromRooms = async (code: string) => {
    if (!requireName()) return;
    setLoading(true); setLocalError('');
    try { await onJoinRoom(code.replace(/\D/g, ''), playerName.trim()); }
    catch (e: any) {
      setLocalError(`加入房间失败: ${e?.message || String(e) || '房间不存在或已开局'}`);
    }
    finally { setLoading(false); }
  };

  // 经典场次页 -> 快速开始
  const handleClassicQuick = (classicModeId: string, classicTier: string) => {
    setModeId(classicModeId);
    setTier(classicTier);
    setShowClassicHall(false);
    handleMatch(classicModeId, classicTier);
  };

  // 消息中心的行动按钮：真正跳转 / 发奖，而不是只关个弹窗
  const handleNotifAction = (e: NotifActionEvent) => {
    switch (e.kind) {
      case 'claim':
        // 消息里的奖励实际由活动接口发放，这里只把余额拉最新 + 引导去活动页
        void refreshAccount();
        setShowNotif(false); setNotifView('dropdown'); setShowActivity(true);
        break;
      case 'checkin':
        handleFreeCoin();
        break;
      case 'records':
        setShowNotif(false); setNotifView('dropdown'); setActiveTab('records');
        break;
      case 'rooms':
        setShowNotif(false); setNotifView('dropdown'); setActiveTab('rooms');
        break;
      case 'vip':
        setShowNotif(false); setNotifView('dropdown'); setShowVip(true);
        break;
      case 'activity':
        setShowNotif(false); setNotifView('dropdown'); setShowActivity(true);
        break;
      case 'ack':
        break;
    }
  };

  // 顶栏刷新：重算本地战绩/金币，给出明确反馈
  const handleRefresh = () => {
    void refreshAccount();
    showToast('已刷新', 'ok');
  };

  // 活动中心：打开时顺手拉一次真实状态（签到到第几天 / 广告还剩几次 / 福利冷却）
  const loadActivity = () => {
    fetchActivity().then(setActivity).catch(() => { /* 拉不到就沿用上次的数据，不弹错 */ });
  };
  const handleActivity = () => {
    setShowActivity(true);
    loadActivity();
  };

  /** 领奖统一走这里：防连点 + 成功刷新余额 + 失败展示服务端文案。 */
  const doClaim = async (
    key: string,
    fn: () => Promise<{
      ok?: boolean;
      coins: number;
      message?: string;
      account: import('../utils/api').AccountView;
    }>,
    label: string,
  ) => {
    if (claiming) return;
    setClaiming(key);
    try {
      const r = await fn();
      /* 服务端把"次数用完/没到门槛"也可能表达成 ok:false（而不是抛错），
       * 这里必须自己挡一道，否则会弹出"+0 金币"的假成功提示。 */
      if (r.ok === false || !(r.coins > 0)) {
        showToast(r.message || `${label}领取失败`, 'info');
        loadActivity();
        return;
      }
      if (r.account) setAccount(r.account);
      showToast(`${label} +${r.coins} 金币`, 'ok');
      loadActivity();
    } catch (e: any) {
      showToast(e?.message || '领取失败，稍后再试', 'info');
      loadActivity();
    } finally {
      setClaiming(null);
    }
  };

  // 每日签到：连续天数越多领得越多（服务端 SIGNIN_REWARDS 那套）
  const handleFreeCoin = () => { void doClaim('signin', claimSignin, '每日签到'); };

  // 独家福利：每 6 小时一次
  const handleWelfare = () => { void doClaim('welfare', claimWelfare, '独家福利'); };

  // 看广告领金币（广告本体还没接，先按每日次数上限发）
  const handleAdReward = () => { void doClaim('ad', claimAdReward, '看广告'); };

  /**
   * 分享领金币。
   * 先弹分享面板，再发奖 —— 服务端无法验证是否真的分享成功（跳出去就看不到了），
   * 所以这里至少保证用户真的看到过分享入口，其余靠每日 10 次上限兜着。
   */
  const handleShareReward = () => {
    if (!hasShared) {
      showToast('请先点上面的「分享到微信 / QQ / 复制链接」，分享后才能领奖', 'info');
      return;
    }
    void doClaim('share', claimShareReward, '分享奖励');
    // 领完这次就重新上锁，想再领必须再分享一次
    setHasShared(false);
  };

  // 破产补助：余额低于门槛才能领，输光了也能继续玩
  const handleBankruptAid = () => { void doClaim('aid', claimBankruptAid, '破产补助'); };

  /**
   * 领每日免费房卡。
   *
   * 不能复用 doClaim：那个写死了只看 `r.coins`（金币），
   * 房卡接口返回的是 `r.cards`，拿 doClaim 会因为 coins 为 undefined
   * 而一律弹“领取失败”——实际卡已经到账了。
   */
  const handleRoomCardClaim = async () => {
    if (claiming) return;
    setClaiming('roomcard');
    try {
      const r = await claimDailyRoomCards();
      if (r.ok === false || !(r.cards > 0)) {
        showToast(r.message || '房卡领取失败', 'info');
        loadActivity();
        return;
      }
      if (r.account) setAccount(r.account);
      showToast(`每日房卡 +${r.cards} 张`, 'ok');
      loadActivity();
    } catch (e: any) {
      showToast(e?.message || '领取失败，稍后再试', 'info');
      loadActivity();
    } finally {
      setClaiming(null);
    }
  };

  // 经典场次页 -> 私人房
  const handleClassicPrivate = (classicModeId: string, classicTier: string) => {
    setModeId(classicModeId);
    setTier(classicTier);
    setShowClassicHall(false);
    // 经典场次进的是金币局（cardRoom=false）：场次本身就是按底分输赢金币的
    handleCreateFromLobby(undefined, 0, classicModeId, false, classicTier);
  };

  return (
    <div className="lobby-root">
      {/* 错误提示 */}
      {(localError || error) && (
        <div className="lobby-toast" role="alert" onClick={() => setLocalError('')}>
          {localError || error}
        </div>
      )}

      {/* 顶 HUD */}
      <header className="lobby-hud">
        {/* 头像 + 昵称就是「我的」入口：以前这块是纯展示，点了没反应，
            用户会本能地点头像找个人中心。底部那个重复的「我的」圆钮已去掉。 */}
        <button
          type="button"
          className="lobby-hud-user"
          onClick={() => { sound.click(); setActiveTab('me'); }}
          title="个人中心"
          aria-label="打开个人中心"
        >
          <div className="lobby-hud-avatar">
            <UserIcon size={20} />
          </div>
          <div className="lobby-hud-user-info">
            <span className="lobby-hud-nick">{account?.nickname || playerName}</span>
            <span className="lobby-hud-level">{myRank.name} Lv.{rankLevel(account?.score ?? 0)}</span>
          </div>
        </button>

        <div className="lobby-hud-resources">
          {/* 金币「+」不再是充值：没有充值系统，只能去活动页赚 */}
          <div className="lobby-resource" onClick={handleActivity} title="去活动页赚金币">
            <span className="lobby-resource-icon lobby-resource-icon--coin">
              <CoinIcon size={12} />
            </span>
            <span>{formatCoins(coins)}</span>
            <span className="lobby-resource-add">+</span>
          </div>
          <div className="lobby-resource" onClick={() => { setShopCat('star'); setActiveTab('shop'); }} title="金币可兑换星币">
            <span className="lobby-resource-icon lobby-resource-icon--star">
              <StarIcon size={12} />
            </span>
            <span>{formatCoins(stars)}</span>
            <span className="lobby-resource-add">+</span>
          </div>
          {/* 房卡：建"朋友局"用的，不输赢金币。点进商城房卡类目可换。
              放在星币右边是因为它也是一种可兑换资源，和金币/星币同级。 */}
          <div
            className="lobby-resource"
            onClick={() => { setShopCat('roomcard'); setActiveTab('shop'); }}
            title="房卡：开朋友局用，一张管整桌，不输赢金币"
          >
            <span className="lobby-resource-icon lobby-resource-icon--card">
              <TicketIcon size={12} />
            </span>
            <span>{roomCards}</span>
            <span className="lobby-resource-add">+</span>
          </div>
        </div>

        <div className="lobby-hud-actions">
          <button className="lobby-hud-icon-btn" onClick={() => setShowNotif(true)} title="通知" aria-label="通知">
            <BellIcon size={16} />
            {/* 红点数 = 真的有几件事能做（签到/广告/福利），
                之前写死 3，点进去只有一条能领，是在骗点击 */}
            {todoCount > 0 && <span className="lobby-hud-badge">{todoCount}</span>}
          </button>
          <button
            className="lobby-hud-icon-btn lobby-hud-icon-btn--more"
            title="更多"
            aria-label="更多"
            onClick={() => setShowMore(true)}
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </header>

      {/* 主区：play tab 显示大厅 */}
      <main className="lobby-main">
        <Suspense fallback={<TabLoader />}>
          {activeTab === 'play' && !showClassicHall && (
            <LobbyHome
              loading={loading} offline={offline} modeId={modeId} setModeId={setModeId}
              onTab={setActiveTab}
              onMatch={handleMatch}
              initialRoomCode={initialRoomCode}
              onEnterClassic={() => handleMatch(CLASSIC_MODE_ID)}
              onFreeCoin={handleFreeCoin}
              onWelfare={handleWelfare}
              onActivity={handleActivity}
              createRequestKey={createRequestKey}
              stats={lobbyStats}
              onOpenVip={() => setShowVip(true)}
              onOpenRooms={() => setActiveTab('rooms')}
              onOpenCreate={() => setShowCreate(true)}
              onOpenJoin={() => setShowJoin(true)}
              onEnterDeckMode={(n) => { setHallDeckCount(n); setShowClassicHall(true); }}
              onShare={() => { setHasShared(false); setShowInvite(true); }}
            />
          )}
        </Suspense>
      </main>

          {activeTab === 'play' && showClassicHall && (
            <ClassicHall
              onBack={() => setShowClassicHall(false)}
              onQuickStart={handleClassicQuick}
              onCreatePrivate={handleClassicPrivate}
              deckCount={hallDeckCount ?? undefined}
              onOpenFeedback={() => setShowFeedback(true)}
            />
          )}

      {/* 非play页：全屏浮层 + 底部tabbar */}
      {activeTab !== 'play' && (
        <div className="lobby-subpage-overlay">
          <div className="lobby-subpage-content">
            <Suspense fallback={<TabLoader />}>
              {activeTab === 'rooms' && (
                <Rooms
                  onClose={() => setActiveTab('play')}
                  onJoinRoom={handleJoinFromRooms}
                  onCreateRoom={() => { setActiveTab('play'); setCreateRequestKey(k => k + 1); }}
                />
              )}
              {activeTab === 'shop' && (
                <Shop
                  onClose={() => setActiveTab('play')}
                  initialCat={shopCat}
                  onEarnCoins={() => { setActiveTab('play'); handleActivity(); }}
                />
              )}
              {activeTab === 'rank' && <Rank playerName={playerName} onClose={() => setActiveTab('play')} />}
              {activeTab === 'records' && (
                <Records
                  playerName={playerName}
                  onClose={() => setActiveTab('play')}
                  onPlayAgain={(modeLabel) => {
                    // 按原局的人数/副数重开；解析不出来就用当前模式
                    const target = getModeIdForLabel(modeLabel) ?? modeId;
                    setActiveTab('play');
                    setModeId(target);
                    handleMatch(target);
                  }}
                />
              )}
              {activeTab === 'me' && (
                <Profile
                  playerName={playerName}
                  onChangeName={updateName}
                  onLogout={() => onLogout?.()}
                  onOpenRules={() => setShowRules(true)}
                  onEarnCoins={() => { setActiveTab('play'); handleActivity(); }}
                />
              )}
            </Suspense>
          </div>
          <nav className="lobby-tabbar--sub">
            {[
              { id: 'play',    label: '开始', icon: GamepadIcon },
              { id: 'rooms',   label: '房间', icon: DoorIcon },
              { id: 'shop',    label: '商城', icon: CartIcon },
              { id: 'rank',    label: '排行', icon: TrophyIcon },
              { id: 'records', label: '战绩', icon: HistoryIcon },
              { id: 'me',      label: '我的', icon: UserIcon },
            ].map(t => {
              const Icon = t.icon;
              return (
                <button key={t.id}
                  className={`lobby-tabbar-item ${activeTab === t.id ? 'is-active' : ''}`}
                  onClick={() => { sound.click(); setActiveTab(t.id as Tab); }}
                >
                  <Icon size={18} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      )}




      {/* 浮层 */}
      <Suspense fallback={null}>
      {matchmakingMode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
          <Matchmaking playerName={playerName} modeId={matchmakingMode} onClose={() => setMatchmakingMode(null)}
            onMatched={() => { startMatchmaking(matchmakingMode); setMatchmakingMode(null); }} />
        </div>
      )}

      {/* 建房/加入房间弹窗（顶层，避免被 HUD 遮挡） */}
      <CreateRoomModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreateFromLobby}
        modeId={modeId}
        roomCards={account?.roomCards ?? 0}
        tierName={tierLabel(tier).name}
        tierEntry={tierLabel(tier).entry}
      />
      <JoinRoomModal
        open={showJoin}
        onClose={() => setShowJoin(false)}
        onJoin={handleJoinFromLobby}
        defaultRoomCode={initialRoomCode}
      />
      {showAuth && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
          <Auth defaultName={playerName} onClose={() => setShowAuth(false)}
            onAuth={(info) => { updateName(info.name); setShowAuth(false); }} />
        </div>
      )}
      {showNotif && notifView === 'dropdown' && (
        <NotificationDropdown onClose={() => setShowNotif(false)} onOpenFull={() => { setNotifView('full'); }} />
      )}
      {showNotif && notifView === 'full' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
          <Notifications onClose={() => { setNotifView('dropdown'); }} onAction={handleNotifAction} />
        </div>
      )}
      {showFeedback && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
          <Feedback playerName={playerName} onClose={() => setShowFeedback(false)} />
        </div>
      )}
      </Suspense>
      {showActivity && (
        <div className="lobby-modal-mask" onClick={() => setShowActivity(false)}>
          <div className="lobby-modal lobby-modal--wide" onClick={e => e.stopPropagation()}>
            <button className="lobby-modal-close" onClick={() => setShowActivity(false)} aria-label="关闭"><CloseIcon size={16} /></button>
            <div className="lobby-modal-title">活动中心</div>
            <div className="lobby-modal-hint">
              这里是唯一的金币来源（没有充值）：签到、看广告、打牌赢。金币可以在商城换牌背、道具、会员，也能换星币。
            </div>

            {/* 每日签到：7 天一轮，连续天数越多领得越多 */}
            <section className="lobby-act-block">
              <div className="lobby-act-head">
                <span className="lobby-act-name"><GiftIcon size={14} /> 每日签到</span>
                <span className="lobby-act-meta">
                  {activity ? `已连续 ${activity.signin.streak} 天` : '加载中…'}
                </span>
              </div>
              <div className="lobby-act-signin">
                {(activity?.signin.rewards ?? [0, 0, 0, 0, 0, 0, 0]).map((amount, idx) => {
                  const streak = activity?.signin.streak ?? 0;
                  const claimedToday = activity?.signin.claimedToday ?? false;
                  // 已领天数 = 连续天数在本轮内的位置；今天没签到时当前格是"待领"
                  const doneCount = claimedToday ? ((streak - 1) % 7) + 1 : streak % 7;
                  const done = idx < doneCount;
                  const isToday = !claimedToday && idx === doneCount;
                  return (
                    <div
                      key={idx}
                      className={`lobby-act-day ${done ? 'is-done' : ''} ${isToday ? 'is-today' : ''}`}
                    >
                      <span className="lobby-act-day-label">第{idx + 1}天</span>
                      <span className="lobby-act-day-coin"><CoinIcon size={11} />{amount}</span>
                      {done && <span className="lobby-act-day-tick">✓</span>}
                    </div>
                  );
                })}
              </div>
              <button
                className="lobby-modal-btn lobby-modal-btn--primary lobby-act-btn"
                disabled={!activity || activity.signin.claimedToday || claiming === 'signin'}
                onClick={handleFreeCoin}
              >
                {!activity ? '加载中…'
                  : activity.signin.claimedToday ? '今天已签到，明天再来'
                  : claiming === 'signin' ? '领取中…'
                  : `签到领 ${activity.signin.rewards[activity.signin.streak % 7] ?? 0} 金币`}
              </button>
            </section>

            <div className="lobby-act-row">
              {/* 看广告领金币 */}
              <section className="lobby-act-block lobby-act-block--half">
                <div className="lobby-act-head">
                  <span className="lobby-act-name"><RedPacketIcon size={14} /> 看广告领金币</span>
                  <span className="lobby-act-meta">
                    {activity ? `今日还剩 ${activity.ad.left}/${activity.ad.dailyLimit} 次` : '—'}
                  </span>
                </div>
                <div className="lobby-act-desc">
                  每次 +{activity?.ad.coins ?? 100} 金币。广告位还在接，测试期直接发。
                </div>
                <button
                  className="lobby-modal-btn lobby-modal-btn--primary lobby-act-btn"
                  disabled={!activity || activity.ad.left <= 0 || claiming === 'ad'}
                  onClick={handleAdReward}
                >
                  {!activity ? '加载中…'
                    : activity.ad.left <= 0 ? '今日次数已用完'
                    : claiming === 'ad' ? '领取中…'
                    : `领 ${activity.ad.coins} 金币`}
                </button>
              </section>

              {/* 独家福利：冷却制 */}
              <section className="lobby-act-block lobby-act-block--half">
                <div className="lobby-act-head">
                  <span className="lobby-act-name"><FlameIcon size={14} /> 独家福利</span>
                  <span className="lobby-act-meta">每 {activity?.welfare.cooldownHours ?? 6} 小时一次</span>
                </div>
                <div className="lobby-act-desc">
                  金币见底也不会卡住：冷却好了就能再领 +{activity?.welfare.coins ?? 300}。
                </div>
                <button
                  className="lobby-modal-btn lobby-modal-btn--primary lobby-act-btn"
                  disabled={!activity || welfareWaitText !== null || claiming === 'welfare'}
                  onClick={handleWelfare}
                >
                  {!activity ? '加载中…'
                    : welfareWaitText !== null ? `${welfareWaitText}后可领`
                    : claiming === 'welfare' ? '领取中…'
                    : `领 ${activity.welfare.coins} 金币`}
                </button>
              </section>
            </div>

            <div className="lobby-act-row">
              {/* 分享送金币 */}
              <section className="lobby-act-block lobby-act-block--half">
                <div className="lobby-act-head">
                  <span className="lobby-act-name"><ShareIcon size={14} /> 分享送金币</span>
                  <span className="lobby-act-meta">
                    {activity ? `今日还剩 ${activity.share.left}/${activity.share.dailyLimit} 次` : '—'}
                  </span>
                </div>
                <div className="lobby-act-desc">
                  分享给好友，每次 +{activity?.share.coins ?? 300} 金币。
                </div>
                <button
                  className="lobby-modal-btn lobby-modal-btn--primary lobby-act-btn"
                  disabled={!activity || activity.share.left <= 0}
                  onClick={() => { setShowActivity(false); setHasShared(false); setShowInvite(true); }}
                >
                  {!activity ? '加载中…'
                    : activity.share.left <= 0 ? '今日次数已用完'
                    : '去分享领金币'}
                </button>
              </section>

              {/* 破产补助：输光了还能继续玩的安全阀 */}
              <section className="lobby-act-block lobby-act-block--half">
                <div className="lobby-act-head">
                  <span className="lobby-act-name"><CoinIcon size={14} /> 破产补助</span>
                  <span className="lobby-act-meta">
                    {activity ? `今日还剩 ${activity.aid.left}/${activity.aid.dailyLimit} 次` : '—'}
                  </span>
                </div>
                <div className="lobby-act-desc">
                  金币不足 {activity?.aid.threshold ?? 500} 时可领 +{activity?.aid.coins ?? 1000}，输光也能接着玩。
                </div>
                <button
                  className="lobby-modal-btn lobby-modal-btn--primary lobby-act-btn"
                  disabled={
                    !activity || activity.aid.left <= 0 || claiming === 'aid'
                    || (account?.coins ?? 0) >= activity.aid.threshold
                  }
                  onClick={handleBankruptAid}
                >
                  {!activity ? '加载中…'
                    : activity.aid.left <= 0 ? '今日次数已用完'
                    : (account?.coins ?? 0) >= activity.aid.threshold
                      ? `金币低于 ${activity.aid.threshold} 才能领`
                    : claiming === 'aid' ? '领取中…'
                    : `领 ${activity.aid.coins} 金币`}
                </button>
              </section>
            </div>

            <div className="lobby-act-row">
              {/* 每日免费房卡：没金币也能天天和朋友开局 */}
              <section className="lobby-act-block lobby-act-block--half">
                <div className="lobby-act-head">
                  <span className="lobby-act-name"><TicketIcon size={14} /> 每日免费房卡</span>
                  <span className="lobby-act-meta">
                    {activity ? `今日还剩 ${activity.roomCard.left}/${activity.roomCard.dailyLimit} 次` : '—'}
                  </span>
                </div>
                <div className="lobby-act-desc">
                  一天领一次，直接给 {activity?.roomCard.cards ?? 5} 张。
                  房卡局全桌<b>不输赢金币</b>，但级别和战绩照算。
                  当前拥有 {account?.roomCards ?? 0} 张。
                </div>
                <button
                  className="lobby-modal-btn lobby-modal-btn--primary lobby-act-btn"
                  disabled={!activity || activity.roomCard.left <= 0 || claiming === 'roomcard'}
                  onClick={() => void handleRoomCardClaim()}
                >
                  {!activity ? '加载中…'
                    : activity.roomCard.left <= 0 ? '今日已领取'
                    : claiming === 'roomcard' ? '领取中…'
                    : `领 ${activity.roomCard.cards} 张房卡`}
                </button>
              </section>

              {/* 房卡不够的话可以用金币换，入口直接指到商城房卡类目 */}
              <section className="lobby-act-block lobby-act-block--half">
                <div className="lobby-act-head">
                  <span className="lobby-act-name"><TicketIcon size={14} /> 金币换房卡</span>
                  <span className="lobby-act-meta">
                    {activity ? `${activity.roomCard.coinsPerCard} 金币 / 张` : '—'}
                  </span>
                </div>
                <div className="lobby-act-desc">
                  免费额度领完了还想开朋友局，可以用金币换，一次能换多张。
                </div>
                <button
                  className="lobby-modal-btn lobby-modal-btn--ghost lobby-act-btn"
                  onClick={() => { setShowActivity(false); setShopCat('roomcard'); setActiveTab('shop'); }}
                >
                  去商城换房卡
                </button>
              </section>
            </div>

            {/* 打牌赚金币：把结算发币规则摊开写，别让人猜 */}
            <section className="lobby-act-block lobby-act-block--info">
              <div className="lobby-act-head">
                <span className="lobby-act-name"><TrophyIcon size={14} /> 打牌赚金币（主要来源）</span>
              </div>
              <ul className="lobby-act-rules">
                <li>输赢 = <b>场次底分 × 升的级数</b>（初级场底分 100，越高的场底分越大）</li>
                <li>庄家 <b>×{activity?.roundReward.bankerMultiplier ?? 1.5}</b>：坐庄赢多拿，输也多掏</li>
                <li>闲家挖底成功：额外 <b>+{activity?.roundReward.digBonusStakes ?? 1} 倍底分</b></li>
                <li>输了要<b>扣金币</b>，扣的是赢家额度的 <b>{Math.round((activity?.roundReward.lossRatio ?? 0.8) * 10)} 折</b></li>
                <li>同桌真人不足 <b>{activity?.roundReward.minHumansForFullReward ?? 2}</b> 人时奖励打
                  <b>{Math.round((activity?.roundReward.botFarmingRatio ?? 0.5) * 10)} 折</b>（防带 AI 刷金币）</li>
                <li>中途退出算<b>逃跑，要罚金</b>，别人白等一局</li>
              </ul>
              {/* 各场次底分一览：让人一眼看出该去哪个场，而不是进去才知道扣多少 */}
              {activity?.tiers && (
                <div className="lobby-act-tiers">
                  {activity.tiers.map(t => (
                    <div key={t.id} className="lobby-act-tier">
                      <span className="lobby-act-tier-name">{t.name}</span>
                      <span className="lobby-act-tier-num">底分 {t.stake.toLocaleString()}</span>
                      <span className="lobby-act-tier-num">入场 {t.entry.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="lobby-modal-btn lobby-modal-btn--ghost lobby-act-btn"
                onClick={() => { setShowActivity(false); handleMatch(modeId); }}
              >去打一局</button>
            </section>
          </div>
        </div>
      )}
      {/* 好友邀请：好友系统按用户决定后面做，先用房间号 + 链接把人拉进来 */}
      {showInvite && (
        <div className="lobby-modal-mask" onClick={() => setShowInvite(false)}>
          <div className="lobby-modal" onClick={e => e.stopPropagation()}>
            <button className="lobby-modal-close" onClick={() => setShowInvite(false)} aria-label="关闭">
              <CloseIcon size={16} />
            </button>
            <div className="lobby-modal-title">分享给好友</div>
            <div className="lobby-modal-hint" style={{ marginBottom: 'calc(14 * var(--u))' }}>
              把链接发给好友，他点开就能直接进你的房间。还没建房的话先「建房」再分享房间号。
              {activity && activity.share.left > 0 && (
                <> 分享后可领 <b style={{ color: '#FBBF24' }}>+{activity.share.coins}</b> 金币，
                今日还剩 {activity.share.left}/{activity.share.dailyLimit} 次。</>
              )}
            </div>
            <InviteShare
              text={`来打梅州五华天王升级！我在这里等你：${gameHomeUrl()}`}
              url={gameHomeUrl()}
              title="来打梅州五华天王升级！"
              summary="三副牌 / 两副牌，3-6 人都能开，点开就能玩。"
              copyHint="已复制邀请链接，发给好友即可"
              onShared={() => setHasShared(true)}
            />
            <div className="lobby-modal-actions" style={{ marginTop: 'calc(16 * var(--u))' }}>
              <button className="lobby-modal-btn lobby-modal-btn--ghost" onClick={() => setShowInvite(false)}>关闭</button>
              {/* 分享奖励：服务端拦不住"假分享"（跳出去就看不到结果了），
                  所以按钮放在分享面板里，至少保证用户真的看到过分享入口。 */}
              <button
                className="lobby-modal-btn lobby-modal-btn--primary"
                disabled={!activity || activity.share.left <= 0 || claiming === 'share' || !hasShared}
                onClick={handleShareReward}
              >
                {!activity ? '加载中…'
                  : activity.share.left <= 0 ? '今日分享奖励已领完'
                  : claiming === 'share' ? '领取中…'
                  : !hasShared ? '先分享才能领'
                  : `领 ${activity.share.coins} 金币`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 顶栏「更多」：把散落的入口收在一处 */}
      {showMore && (
        <div className="lobby-modal-mask" onClick={() => setShowMore(false)}>
          <div className="lobby-modal" onClick={e => e.stopPropagation()}>
            <button className="lobby-modal-close" onClick={() => setShowMore(false)} aria-label="关闭">
              <CloseIcon size={16} />
            </button>
            <div className="lobby-modal-title">更多</div>
            <div className="lobby-more-list">
              {[
                { label: '背包', onClick: () => { setShowMore(false); setShopCat('item'); setActiveTab('shop'); } },
                { label: '刷新', onClick: () => { setShowMore(false); handleRefresh(); } },
                { label: '玩法说明', onClick: () => { setShowMore(false); setShowRules(true); } },
                { label: '邀请一起玩', onClick: () => { setShowMore(false); setShowInvite(true); } },
                { label: '个人中心 / 设置', onClick: () => { setShowMore(false); setActiveTab('me'); } },
                { label: '会员中心', onClick: () => { setShowMore(false); setShowVip(true); } },
                { label: '消息中心', onClick: () => { setShowMore(false); setNotifView('full'); setShowNotif(true); } },
                { label: '客服与反馈', onClick: () => { setShowMore(false); setShowFeedback(true); } },
                { label: '账号 / 登录', onClick: () => { setShowMore(false); setShowAuth(true); } },
                { label: '我的战绩', onClick: () => { setShowMore(false); setActiveTab('records'); } },
              ].map(item => (
                <button key={item.label} className="lobby-more-item" onClick={item.onClick}>
                  <span>{item.label}</span>
                  <span className="lobby-more-arrow">›</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        {showVip && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, overflow: 'auto' }}>
            <VipCenter
              onClose={() => { setShowVip(false); void refreshAccount(); }}
              onEarnCoins={() => { setShowVip(false); handleActivity(); }}
            />
          </div>
        )}
      </Suspense>

      <RulesModal open={showRules} onClose={() => setShowRules(false)} />
    </div>
  );
}




