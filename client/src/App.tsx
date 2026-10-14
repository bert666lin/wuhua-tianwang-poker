// ===== App 路由 =====
// 根据Colyseus连接状态切换大厅/游戏页面
// dev 路由：?dev=settle / ?dev=mockv4 / ?dev=shop / ?dev=rank / ?dev=rooms / ?dev=profile / ?dev=activity
// 完整清单见下方 DEV_ROUTES；未知路由会渲染 UnknownDevRoute 提示页。

import { Suspense, lazy } from 'react';
import { useColyseus } from './hooks/useColyseus';
import { Lobby } from './pages/Lobby';
import { ToastHost } from './components/Toast';
import { showToast } from './utils/toast';
import { resetToGuest } from './hooks/useAccount';

// 游戏页（含 Pixi 渲染器）— 体量最大，单独拆包
const Game = lazy(retryImport(() => import('./pages/Game').then(m => ({ default: m.Game }))));

// dev 预览页 & 二级页面 — 按需加载
const SettlementPreview = lazy(retryImport(() => import('./pages/SettlementPreview').then(m => ({ default: m.SettlementPreview }))));
const TableV4 = lazy(retryImport(() => import('./components/TableV4').then(m => ({ default: m.TableV4 }))));
const GameMockPreviewV4 = lazy(retryImport(() => import('./pages/GameMockPreviewV4').then(m => ({ default: m.GameMockPreviewV4 }))));
const GameV4Real = lazy(retryImport(() => import('./pages/GameV4Real').then(m => ({ default: m.GameV4Real }))));
const Shop = lazy(retryImport(() => import('./pages/Shop').then(m => ({ default: m.Shop }))));
const Rank = lazy(retryImport(() => import('./pages/Rank').then(m => ({ default: m.Rank }))));
const Rooms = lazy(retryImport(() => import('./pages/Rooms').then(m => ({ default: m.Rooms }))));
const Profile = lazy(retryImport(() => import('./pages/Profile').then(m => ({ default: m.Profile }))));
const Records = lazy(retryImport(() => import('./pages/Records').then(m => ({ default: m.Records }))));
const Matchmaking = lazy(retryImport(() => import('./pages/Matchmaking').then(m => ({ default: m.Matchmaking }))));
const Auth = lazy(retryImport(() => import('./pages/Auth').then(m => ({ default: m.Auth }))));
const Notifications = lazy(retryImport(() => import('./pages/Notifications').then(m => ({ default: m.Notifications }))));
const Feedback = lazy(retryImport(() => import('./pages/Feedback').then(m => ({ default: m.Feedback }))));
const VipCenter = lazy(retryImport(() => import('./pages/VipCenter').then(m => ({ default: m.VipCenter }))));
/* 后台管理（/admin）。必须惰加载：玩家永远不会打开它，
   打进主包只会让每个玩家多下载一堆用不到的代码。 */
const Admin = lazy(retryImport(() => import('./pages/Admin').then(m => ({ default: m.Admin }))));
import { ClassicHall } from './pages/ClassicHall';
/* 懒加载分包加载失败的恢复：发版会删掉旧 hash 的分包，挂在后台的 App
 * 请求旧文件会 404，Suspense 只管 pending 不管 rejected，那块区域就永久空白。
 * 详见 utils/lazyWithReload.ts。 */
import { retryImport } from './utils/lazyWithReload';

// 懒加载 loading 占位
function PageLoader() {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--c-text-mute)', fontSize: 14,
      background: 'var(--grad-page)',
    }}>加载中…</div>
  );
}

const __searchParams = new URLSearchParams(window.location.search);
const __devFlag = __searchParams.get('dev');
const __initialRoomCode = __searchParams.get('room');
/**
 * 后台管理走**路径**（/admin）而不是 ?dev= 参数。
 *
 * 两个原因：
 * 1. dev 路由是给自己走查 UI 的，跟“真实可用的后台”不是一回事；
 * 2. 用户要在手机上打开，/admin 比 ?dev=admin 好输得多。
 * 服务端的 SPA 兑底会把 /admin 回成 index.html，所以前端自己认这个路径。
 */
const __isAdmin = /^\/admin\/?$/.test(window.location.pathname);

// 简单包壳：让子页可以独立 dev 预览
function ShopDev() {
  return <div style={{ position: 'fixed', inset: 0 }}><Shop onClose={() => window.history.back()} /></div>;
}
function RankDev() {
  return <div style={{ position: 'fixed', inset: 0 }}><Rank playerName="我" onClose={() => window.history.back()} /></div>;
}
function RoomsDev() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Rooms
        onClose={() => window.history.back()}
        onJoinRoom={(code) => showToast('dev 预览：加入 ' + code, 'info')}
        onCreateRoom={() => showToast('dev 预览：自建房间', 'info')}
      />
    </div>
  );
}
function ProfileDev() {
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'auto' }}>
      <Profile
        /* ?name=... 可覆盖：走查超长昵称的省略号表现 */
        playerName={__searchParams.get('name') || '玩家'}
        onChangeName={(n) => console.log('改名为', n)}
        onLogout={() => console.log('退出')}
        onOpenRules={() => console.log('打开规则')}
      />
    </div>
  );
}

function RecordsDev() {
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      {/* ?name=... 可覆盖：走查超长昵称的省略号表现 */}
      <Records playerName={__searchParams.get('name') || '玩家'} onClose={() => window.history.back()} />
    </div>
  );
}

function MatchmakingDev() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <Matchmaking
        playerName="玩家"
        modeId="fourPlayerTwoDecks"
        onClose={() => window.history.back()}
        onMatched={(roomId) => console.log('matched', roomId)}
      />
    </div>
  );
}

function AuthDev() {
  return (
    <div style={{ position: 'relative', width: '100%', minHeight: '100vh' }}>
      <Auth
        onClose={() => window.history.back()}
        onAuth={(info) => { console.log('auth', info); window.history.back(); }}
      />
    </div>
  );
}

function NotifDev() {
  return (
    <div style={{ position: 'relative', width: '100%', minHeight: '100vh' }}>
      <Notifications onClose={() => window.history.back()} />
    </div>
  );
}

function FeedbackDev() {
  return (
    <div style={{ position: 'relative', width: '100%', minHeight: '100vh' }}>
      <Feedback playerName="玩家" onClose={() => window.history.back()} />
    </div>
  );
}

function ClassicHallDev() {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <ClassicHall
        onBack={() => window.history.back()}
        onQuickStart={(id, tier) => showToast('dev 预览：快速开始 ' + id + ' / ' + tier, 'info')}
        onCreatePrivate={(id, tier) => showToast('dev 预览：私人房 ' + id + ' / ' + tier, 'info')}
      />
    </div>
  );
}
function VipDev() {
  return <div style={{ position: 'fixed', inset: 0, overflow: 'auto' }}><VipCenter onClose={() => window.history.back()} /></div>;
}

/**
 * dev 预览路由。单独抽出来是为了让 App 里的 useColyseus 无条件调用 ——
 * 之前这些 early return 排在 Hook 之前，违反 React Hooks 规则。
 */
function renderDevRoute(flag: string) {
  switch (flag) {
    case 'settle':      return <Suspense fallback={<PageLoader />}><SettlementPreview /></Suspense>;
    case 'tablev4':     return <div style={{ position: 'fixed', inset: 0, background: '#111' }}><TableV4 /></div>;
    case 'gamev4':      return <Suspense fallback={<PageLoader />}><GameMockPreviewV4 /></Suspense>;
    case 'gamev4real':  return <Suspense fallback={<PageLoader />}><GameV4Real /></Suspense>;
    case 'shop':        return <Suspense fallback={<PageLoader />}><ShopDev /></Suspense>;
    case 'rank':        return <Suspense fallback={<PageLoader />}><RankDev /></Suspense>;
    case 'rooms':       return <Suspense fallback={<PageLoader />}><RoomsDev /></Suspense>;
    case 'profile':     return <Suspense fallback={<PageLoader />}><ProfileDev /></Suspense>;
    case 'records':     return <Suspense fallback={<PageLoader />}><RecordsDev /></Suspense>;
    case 'match':       return <Suspense fallback={<PageLoader />}><MatchmakingDev /></Suspense>;
    case 'auth':        return <Suspense fallback={<PageLoader />}><AuthDev /></Suspense>;
    case 'notif':       return <Suspense fallback={<PageLoader />}><NotifDev /></Suspense>;
    case 'feedback':    return <Suspense fallback={<PageLoader />}><FeedbackDev /></Suspense>;
    case 'vip':         return <Suspense fallback={<PageLoader />}><VipDev /></Suspense>;
    case 'classichall': return <Suspense fallback={<PageLoader />}><ClassicHallDev /></Suspense>;
    // 后台正式入口是 /admin，这个别名只为本地走查方便
    case 'admin':       return <Suspense fallback={<PageLoader />}><Admin /></Suspense>;
    // ?dev=lobby 是 scripts/start-all.sh 公告的默认入口，必须能进大厅（不连 Colyseus）
    case 'lobby':       return <LobbyDev />;
    // ?dev=mockv4 与 ?dev=gamev4 同为牌桌 v4 Mock 预览的别名
    case 'mockv4':      return <Suspense fallback={<PageLoader />}><GameMockPreviewV4 /></Suspense>;
    // 未知 flag 不再静默白屏，列出全部可用路由方便排查
    default:            return <UnknownDevRoute flag={flag} />;
  }
}

/** dev 大厅：不连服务端，创建/加入房间走空实现，仅用于 UI 走查。 */
function LobbyDev() {
  return (
    <Lobby
      error={null}
      onCreateRoom={async () => { showToast('dev 预览：未连服务端', 'info'); return ''; }}
      onJoinRoom={async () => { showToast('dev 预览：未连服务端', 'info'); }}
    />
  );
}

/** 未知 dev flag 的提示页，避免白屏难以定位。 */
function UnknownDevRoute({ flag }: { flag: string }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, padding: 24, overflow: 'auto',
      background: 'var(--grad-page, #14171f)', color: '#e8e8ea',
      font: '14px/1.7 -apple-system, system-ui, sans-serif',
    }}>
      <h2 style={{ color: '#ffb648', marginBottom: 8 }}>未知的 dev 路由：?dev={flag}</h2>
      <p style={{ opacity: 0.75, marginBottom: 12 }}>可用路由：</p>
      <ul style={{ paddingLeft: 20, columns: 2 }}>
        {DEV_ROUTES.map(r => (
          <li key={r}><a style={{ color: '#6cc0ff' }} href={`?dev=${r}`}>?dev={r}</a></li>
        ))}
      </ul>
      <p style={{ marginTop: 16 }}><a style={{ color: '#6cc0ff' }} href="/">← 回到正式入口（连服务端）</a></p>
    </div>
  );
}

/** 全部可用 dev 路由，供 UnknownDevRoute 展示；新增 case 时同步这里。 */
const DEV_ROUTES = [
  'lobby', 'settle', 'gamev4', 'mockv4', 'tablev4', 'gamev4real',
  'shop', 'rank', 'rooms', 'profile', 'records', 'match',
  'auth', 'notif', 'feedback', 'vip', 'classichall', 'admin',
];

/** dev 预览壳：不连 Colyseus，直接渲染目标页。 */
function DevApp({ flag }: { flag: string }) {
  return renderDevRoute(flag);
}

/** 正式入口：连 Colyseus，按连接状态切大厅/牌桌。 */
function LiveApp() {
  const {
    roomState,
    myPlayerId,
    myHand,
    dealKey,
    bottomCards,
    settlementResult,
    bidHistory,
    roomId,
    error,
    turnDeadline,
    hintCardIds,
    hintInfo,
    lastTrickPlays,
    autoPlaySeat,
    scorePopup,
    chatMessages,
    discardHintIds,
    stagedDiscards,
    isReconnecting,
    reconnectDeadline,
    isTrustee,
    tossNotice,
    voiceSupported,
    voiceMuted,
    isTalking,
    micLevel,
    speakingIds,
    actions,
  } = useColyseus();

  if (roomState && myPlayerId) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Game
          roomState={roomState}
        myPlayerId={myPlayerId}
        myHand={myHand}
        dealKey={dealKey}
        bottomCards={bottomCards}
        settlementResult={settlementResult}
        bidHistory={bidHistory}
        roomId={roomId}
        error={error}
        turnDeadline={turnDeadline}
        hintCardIds={hintCardIds}
        hintInfo={hintInfo}
        lastTrickPlays={lastTrickPlays}
        autoPlaySeat={autoPlaySeat}
        scorePopup={scorePopup}
        chatMessages={chatMessages}
        stagedDiscards={stagedDiscards}
        discardHintIds={discardHintIds}
        isReconnecting={isReconnecting}
        reconnectDeadline={reconnectDeadline}
        isTrustee={isTrustee}
        tossNotice={tossNotice}
        voiceSupported={voiceSupported}
        isTalking={isTalking}
        micLevel={micLevel}
        speakingIds={speakingIds}
        voiceMuted={voiceMuted}
          actions={actions}
        />
      </Suspense>
    );
  }

  return (
    <Lobby
      error={error}
      onCreateRoom={actions.createRoom}
      onJoinRoom={actions.joinRoom}
      initialRoomCode={__initialRoomCode}
      // 退出登录 = 丢掉当前 token 并重新开一个游客号，
      // 否则点了"退出"其实还挂在原账号上。
      onLogout={() => { void resetToGuest(); }}
    />
  );
}

export default function App() {
  // dev flag / 路径都从 URL 读取，整个会话内不变，因此这里的分支不会改变 Hook 顺序
  return (
    <>
      {__isAdmin
        ? <Suspense fallback={<PageLoader />}><Admin /></Suspense>
        : __devFlag ? <DevApp flag={__devFlag} /> : <LiveApp />}
      {/* 全局轻提示：所有页面的按钮反馈都走这里 */}
      <ToastHost />
    </>
  );
}
