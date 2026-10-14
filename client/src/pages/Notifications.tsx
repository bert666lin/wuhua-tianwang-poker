// ===== 消息中心 v3 =====
// 结构：HUD / 6 tab 筛 / 分组列表 / 9 种类型 / 未读小红点 / 详情弹窗 / 设置抽屉
// 风格：深蓝 + 金棕 + 玻璃态
// 配套：NotificationDropdown（顶 bell 下拉）

import { useEffect, useMemo, useState } from 'react';
import '../styles/notifications.css';
import {
  BackIcon, CloseIcon, BellIcon,
  CheckAllIcon, TrashIcon, PinIcon,
  MailIcon, MailOpenIcon, DoNotDisturbIcon,
  TrophyIcon, GiftIcon, CrownIcon, BoltIcon, CoinIcon,
  InfoIcon, FlameIcon,
  ChevronRightIcon, SettingsIcon,
} from '../components/icons';
import { showToast } from '../utils/toast';
import {
  fetchActivity, fetchRecords,
  type AccountView, type ActivityData, type RoundRow,
} from '../utils/api';
import { useAccount } from '../hooks/useAccount';
import { getModeLabel } from '../utils/modeSelection';
import { sound, vibrate, isVibrateEnabled, setVibrateEnabled } from '../utils/sound';

interface NotificationsProps {
  playerName?: string;
  onClose: () => void;
  onOpenSettings?: () => void;
  /** 通知里的行动按钮点击。外层（大厅）负责真正跳转/发奖。 */
  onAction?: (event: NotifActionEvent) => void;
}

// === 通知类型 ===
type NType = 'system' | 'activity' | 'battle' | 'reward' | 'vip' | 'tournament' | 'checkin' | 'mail';

/**
 * 通知里「行动按钮」的语义。此前这些按钮只有文案，点了什么都不发生。
 * claim=领奖励到金币；records=看战绩；rooms=去房间列表；vip=开会员；
 * activity=去活动；checkin=每日领豆；ack=知道了（标已读并关闭）。
 */
export type NotifActionKind = 'claim' | 'records' | 'rooms' | 'vip' | 'activity' | 'checkin' | 'ack';

/** 通知行动按钮触发时抛给外层（大厅）的事件。 */
export interface NotifActionEvent {
  kind: NotifActionKind;
  /** 奖励金币数量，claim / checkin 用 */
  coins?: number;
  title: string;
}

interface Notification {
  id: string;
  type: NType;
  title: string;
  content: string;
  time: number;          // ms
  unread: boolean;
  pinned?: boolean;
  action?: { label: string; tone?: 'primary' | 'secondary'; kind?: NotifActionKind };
  reward?: { icon: any; label: string; value: string };
  meta?: string;         // 例如「新手礼包」「活动通知」
  href?: string;
}

const TYPE_META: Record<NType, { label: string; color: string; icon: any }> = {
  system:     { label: '系统',   color: '#6E83B5', icon: InfoIcon },
  activity:   { label: '活动',   color: '#E8D3A8', icon: GiftIcon },
  battle:     { label: '对战',   color: '#E55A4E', icon: BoltIcon },
  reward:     { label: '奖励',   color: '#7DCC97', icon: CoinIcon },
  vip:        { label: 'VIP',   color: '#F5E6C4', icon: CrownIcon },
  tournament: { label: '比赛',   color: '#D9BD92', icon: TrophyIcon },
  checkin:    { label: '签到',   color: '#5BAE7A', icon: FlameIcon },
  mail:       { label: '邮件',   color: '#5BADB0', icon: MailIcon },
};

const TABS: { id: NType | 'all' | 'unread'; label: string; }[] = [
  { id: 'all',        label: '全部' },
  { id: 'unread',     label: '未读' },
  { id: 'system',     label: '系统' },
  { id: 'activity',   label: '活动' },
  { id: 'battle',     label: '对战' },
  { id: 'tournament', label: '比赛' },
];

/**
 * 消息内容。
 *
 * 之前这里是 40 条写死的假消息（「新春杯第 3 名 +5000 金币」「VIP 年卡 5 折
 * 立省 ¥298」「首充双倍」…），既发不出奖，也和"不做充值系统"的口径冲突。
 * 现在改成**按真实账号状态生成**：
 *   · 签到没签 → 提醒去签到（点了真的领）
 *   · 广告次数没用完 → 提醒去领
 *   · 打过牌 → 用最近一局的真实结果做一条对战消息
 *   · 会员快到期 → 提醒续
 * 生成不出内容时列表就是空的，空态文案会如实说明。
 */
function buildNotifications(input: {
  account: AccountView | null;
  activity: ActivityData | null;
  lastRound: RoundRow | null;
  totalRounds: number;
}): Notification[] {
  const { account, activity, lastRound, totalRounds } = input;
  const now = Date.now();
  const list: Notification[] = [];

  if (activity && !activity.signin.claimedToday) {
    const amount = activity.signin.rewards[activity.signin.streak % 7] ?? 0;
    list.push({
      id: 'n-signin',
      type: 'checkin',
      title: '今天还没签到',
      content: activity.signin.streak > 0
        ? `已连续签到 ${activity.signin.streak} 天，今天签到可领 ${amount} 金币。断签会从第 1 天重新算。`
        : `每日签到可领金币，连续签到越多领得越多（第 7 天 ${activity.signin.rewards[6] ?? 0} 金币）。`,
      time: now - 5 * 60_000,
      unread: true,
      pinned: true,
      reward: { icon: CoinIcon, label: '金币', value: `+${amount}` },
      action: { label: '去签到', tone: 'primary', kind: 'checkin' },
    });
  }

  if (activity && activity.ad.left > 0) {
    list.push({
      id: 'n-ad',
      type: 'activity',
      title: '看广告领金币',
      content: `今天还能领 ${activity.ad.left} 次，每次 ${activity.ad.coins} 金币。金币可以在商城换牌背、道具、会员。`,
      time: now - 30 * 60_000,
      unread: true,
      reward: { icon: CoinIcon, label: '金币', value: `+${activity.ad.coins}` },
      action: { label: '去活动页', tone: 'primary', kind: 'activity' },
    });
  }

  if (activity && (activity.welfare.nextAt === null || activity.welfare.nextAt <= now)) {
    list.push({
      id: 'n-welfare',
      type: 'reward',
      title: '独家福利可以领了',
      content: `每 ${activity.welfare.cooldownHours} 小时能领一次 ${activity.welfare.coins} 金币，金币见底也不会卡住。`,
      time: now - 45 * 60_000,
      unread: true,
      reward: { icon: CoinIcon, label: '金币', value: `+${activity.welfare.coins}` },
      action: { label: '去领取', tone: 'primary', kind: 'activity' },
    });
  }

  if (lastRound) {
    const mode = getModeLabel(lastRound.modeId ?? '') ?? '牌局';
    const role = lastRound.iAmBanker ? '庄家' : '闲家';
    const detail = lastRound.iWon
      ? `你做${role}赢了 ${lastRound.level} 级${lastRound.digSuccess ? '，还挖底成功' : ''}，本局 +${lastRound.coinsDelta} 金币。`
      : `你做${role}输了 ${lastRound.level} 级，输了不扣金币，下一局再来。`;
    list.push({
      id: `n-round-${lastRound.id}`,
      type: 'battle',
      title: lastRound.iWon ? '上一局赢了' : '上一局的结算',
      content: `${mode}·闲家抓 ${lastRound.opponentScore} 分（叫分 ${lastRound.callScore}）。${detail}`,
      time: lastRound.timestamp,
      unread: false,
      action: { label: '查看战绩', tone: 'secondary', kind: 'records' },
    });
  }

  if (account?.vipUntil && account.vipUntil > now) {
    const daysLeft = Math.ceil((account.vipUntil - now) / 86400_000);
    if (daysLeft <= 7) {
      list.push({
        id: 'n-vip-expire',
        type: 'vip',
        title: `会员还剩 ${daysLeft} 天`,
        content: '会员到期后不会自动扣金币，想继续用就手动再开一次；期内再开天数直接累加。',
        time: now - 2 * 3600_000,
        unread: true,
        action: { label: '去会员中心', tone: 'primary', kind: 'vip' },
      });
    }
  }

  if (totalRounds === 0) {
    list.push({
      id: 'n-welcome',
      type: 'system',
      title: '欢迎来打五华天王',
      content: '新号已送 2000 金币。打牌赢金币是主要来源：赢一局按升级数发，输了不扣。'
        + '房间号是 6 位数字，报给朋友就能一起玩。',
      time: now - 3 * 3600_000,
      unread: true,
      action: { label: '我知道了', tone: 'secondary', kind: 'ack' },
    });
  } else {
    list.push({
      id: 'n-tips',
      type: 'system',
      title: '当前是测试阶段',
      content: '实物兑换（大米、油）功能已做好但还没开放，需要先办发货与资质；'
        + '短信验证码和微信登录也还没接通。攒下的金币和星币都会保留。',
      time: now - 6 * 3600_000,
      unread: false,
      action: { label: '我知道了', tone: 'secondary', kind: 'ack' },
    });
  }

  return list.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.time - a.time;
  });
}

/** 拉一次消息所需的真实数据（账号 / 活动状态 / 最近一局）。 */
function useNotifData(): { list: Notification[]; loading: boolean } {
  const { account } = useAccount();
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [lastRound, setLastRound] = useState<RoundRow | null>(null);
  const [totalRounds, setTotalRounds] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([fetchActivity(), fetchRecords(1)]).then(([a, r]) => {
      if (!alive) return;
      if (a.status === 'fulfilled') setActivity(a.value);
      if (r.status === 'fulfilled') {
        setLastRound(r.value.rounds[0] ?? null);
        setTotalRounds(r.value.stats.totalRounds);
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const list = useMemo(
    () => buildNotifications({ account, activity, lastRound, totalRounds }),
    [account, activity, lastRound, totalRounds],
  );
  return { list, loading };
}

/** 一天的毫秒数，时间分组与相对时间文案都用它。 */
const D = 86400_000;

// === 时间分组 ===
type Group = { key: string; label: string; list: Notification[] };
function groupByTime(list: Notification[]): Group[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayStart = now.getTime();
  const yesterdayStart = todayStart - D;
  const weekStart = todayStart - 7 * D;

  const today: Notification[] = [];
  const yesterday: Notification[] = [];
  const week: Notification[] = [];
  const earlier: Notification[] = [];

  list.forEach(n => {
    if (n.time >= todayStart) today.push(n);
    else if (n.time >= yesterdayStart) yesterday.push(n);
    else if (n.time >= weekStart) week.push(n);
    else earlier.push(n);
  });

  const groups: Group[] = [];
  if (today.length)     groups.push({ key: 'today',     label: '今天',  list: today });
  if (yesterday.length) groups.push({ key: 'yesterday', label: '昨天',  list: yesterday });
  if (week.length)      groups.push({ key: 'week',      label: '本周',  list: week });
  if (earlier.length)   groups.push({ key: 'earlier',   label: '更早',  list: earlier });
  return groups;
}

function fmtTime(ts: number, inGroup: boolean): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const diff = Math.floor((now.getTime() - ts) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (sameDay) return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  const yesterday = new Date(now.getTime() - D);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  if (inGroup) return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/** 从通知的奖励文案里解析金币数量，例如「+5000」-> 5000。解析不出来返回 undefined。 */
function parseRewardCoins(n: Notification): number | undefined {
  if (!n.reward || n.reward.label !== '金币') return undefined;
  const m = /(\d+)/.exec(n.reward.value.replace(/,/g, ''));
  return m ? Number(m[1]) : undefined;
}

// === 主页面 ===
export function Notifications({ onClose, onOpenSettings: _onOpenSettings, onAction }: NotificationsProps) {
  const [tab, setTab] = useState<NType | 'all' | 'unread'>('all');
  const { list: source, loading } = useNotifData();
  // 本地覆盖层：已读/删除/置顶只在本次会话内生效（服务端还没有消息表）
  const [list, setList] = useState<Notification[]>([]);
  useEffect(() => { setList(source); }, [source]);
  const [selected, setSelected] = useState<Notification | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [justMarked, setJustMarked] = useState<string | null>(null);

  const unreadCount = list.filter(n => n.unread).length;

  const filtered = useMemo(() => {
    if (tab === 'all') return list;
    if (tab === 'unread') return list.filter(n => n.unread);
    return list.filter(n => n.type === tab);
  }, [list, tab]);

  const groups = useMemo(() => groupByTime(filtered), [filtered]);

  const markRead = (id: string) => {
    setList(prev => prev.map(n => n.id === id ? { ...n, unread: false } : n));
    setJustMarked(id);
    setTimeout(() => setJustMarked(null), 800);
  };
  const markAllRead = () => {
    setList(prev => prev.map(n => ({ ...n, unread: false })));
  };
  const removeNotif = (id: string) => {
    setList(prev => prev.filter(n => n.id !== id));
    if (selected?.id === id) setSelected(null);
  };
  const togglePin = (id: string) => {
    setList(prev => prev.map(n => n.id === id ? { ...n, pinned: !n.pinned } : n));
  };

  /** 行动按钮：标已读 + 交给外层处理；claim 类的领完就把按钮收掉。 */
  const runAction = (n: Notification) => {
    if (!n.action?.kind) return;
    markRead(n.id);
    const coins = parseRewardCoins(n);
    onAction?.({ kind: n.action.kind, coins, title: n.title });
    if (n.action.kind === 'claim') {
      setList(prev => prev.map(x => x.id === n.id ? { ...x, action: undefined } : x));
      showToast(coins ? `已领取 ${coins} 金币` : '已领取', 'ok');
    }
    if (n.action.kind === 'ack') {
      showToast('已标记为已读', 'ok');
    }
    setSelected(null);
  };

  return (
    <div className="notif-root">
      <header className="notif-hud">
        <button className="notif-back" onClick={onClose} aria-label="返回">
          <BackIcon size={20} tone="gold" />
        </button>
        <h1 className="notif-title">
          <BellIcon size={18} tone="gold" />
          <span>消息中心</span>
          {unreadCount > 0 && <span className="notif-hud-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </h1>
        <div className="notif-hud-spacer" />
        <button className="notif-hud-action" onClick={markAllRead} disabled={unreadCount === 0}>
          <CheckAllIcon size={14} />
          <span>全部已读</span>
        </button>
        <button className="notif-hud-icon" onClick={() => setShowSettings(true)} aria-label="设置">
          <SettingsIcon size={16} />
        </button>
      </header>

      <div className="notif-body">
        {/* 类型横滑 tab */}
        <div className="notif-tabs-wrap">
          <div className="notif-tabs">
            {TABS.map(t => {
              const count = t.id === 'all' ? list.length
                : t.id === 'unread' ? unreadCount
                : list.filter(n => n.type === t.id).length;
              return (
                <button
                  key={t.id}
                  className={`notif-tab ${tab === t.id ? 'is-active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  <span>{t.label}</span>
                  {count > 0 && <span className="notif-tab-num">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* 通知列表 */}
        {loading ? (
          <div className="notif-loading">正在加载消息…</div>
        ) : filtered.length === 0 ? (
          <NotifEmpty tab={tab} />
        ) : (
          <div className="notif-groups">
            {groups.map(g => (
              <section key={g.key} className="notif-group">
                <div className="notif-group-head">
                  <span className="notif-group-label">{g.label}</span>
                  <span className="notif-group-line" />
                  <span className="notif-group-count">{g.list.length} 条</span>
                </div>
                <ul className="notif-list">
                  {g.list.map(n => (
                    <NotifItem
                      key={n.id}
                      n={n}
                      onClick={() => { markRead(n.id); setSelected(n); }}
                      onAction={() => runAction(n)}
                      onTogglePin={() => togglePin(n.id)}
                      onDelete={() => removeNotif(n.id)}
                      justMarked={justMarked === n.id}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <NotifDetail
          n={selected}
          onClose={() => setSelected(null)}
          onDelete={() => removeNotif(selected.id)}
          onTogglePin={() => togglePin(selected.id)}
          onAction={() => runAction(selected)}
        />
      )}

      {showSettings && <NotifSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// === 单条通知 ===
function NotifItem({ n, onClick, onAction, onTogglePin, onDelete, justMarked }: { n: Notification; onClick: () => void; onAction: () => void; onTogglePin: () => void; onDelete: () => void; justMarked: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = TYPE_META[n.type];
  const Icon = meta.icon;
  return (
    <li
      className={`notif-item ${n.unread ? 'is-unread' : ''} ${n.pinned ? 'is-pinned' : ''} ${justMarked ? 'is-just-marked' : ''}`}
      style={{ '--type-color': meta.color } as React.CSSProperties}
      onClick={onClick}
    >
      <div className="notif-item-icon" style={{ ['--icon-bg' as string]: `linear-gradient(135deg, ${meta.color}, ${meta.color}88)` }}>
        <Icon size={20} tone="dark" />
        {n.unread && <span className="notif-item-dot" />}
      </div>

      <div className="notif-item-main">
        <div className="notif-item-line1">
          <span className="notif-item-title">{n.title}</span>
          {n.pinned && <span className="notif-item-pin"><PinIcon size={10} tone="gold" /></span>}
          <span className="notif-item-time">{fmtTime(n.time, true)}</span>
        </div>
        <div className="notif-item-content">{n.content}</div>
        {(n.reward || n.action) && (
          <div className="notif-item-foot" onClick={e => e.stopPropagation()}>
            {n.reward && (
              <div className="notif-item-reward">
                <n.reward.icon size={12} tone="gold" />
                <span>{n.reward.label} <strong>{n.reward.value}</strong></span>
              </div>
            )}
            {n.action && (
              <button
                className={`notif-item-action ${n.action.tone === 'primary' ? 'is-primary' : ''}`}
                onClick={(e) => { e.stopPropagation(); if (n.action?.kind) onAction(); else onClick(); }}
              >
                {n.action.label} <ChevronRightIcon size={10} tone={n.action.tone === 'primary' ? 'dark' : 'gold'} />
              </button>
            )}
          </div>
        )}
      </div>

      <button
        className="notif-item-menu-btn"
        onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
        aria-label="更多"
      >
        ⋯
      </button>
      {menuOpen && (
        <>
          <div className="notif-item-menu-backdrop" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
          <div className="notif-item-menu" onClick={e => e.stopPropagation()}>
            <button onClick={() => { onTogglePin(); setMenuOpen(false); }}>
              <PinIcon size={12} tone="gold" />
              {n.pinned ? '取消置顶' : '置顶'}
            </button>
            <button onClick={() => { onClick(); setMenuOpen(false); }}>
              <MailOpenIcon size={12} tone="gold" />
              {n.unread ? '标为已读' : '标为未读'}
            </button>
            <button className="is-danger" onClick={() => { onDelete(); setMenuOpen(false); }}>
              <TrashIcon size={12} tone="red" />
              删除
            </button>
          </div>
        </>
      )}
    </li>
  );
}

// === 空态 ===
function NotifEmpty({ tab }: { tab: string }) {
  const messages: Record<string, { title: string; sub: string }> = {
    all:    { title: '暂无消息',     sub: '您当前没有任何消息通知' },
    unread: { title: '没有未读消息', sub: '所有消息都已读完了' },
    system: { title: '没有系统消息', sub: '系统通知会在这里显示' },
  };
  const m = messages[tab] ?? { title: '暂无消息', sub: '当前分类下还没有消息' };
  return (
    <div className="notif-empty">
      <MailOpenIcon size={48} tone="mute" />
      <div className="notif-empty-title">{m.title}</div>
      <div className="notif-empty-sub">{m.sub}</div>
    </div>
  );
}

// === 详情弹窗 ===
function NotifDetail({ n, onClose, onDelete, onTogglePin, onAction }: { n: Notification; onClose: () => void; onDelete: () => void; onTogglePin: () => void; onAction: () => void }) {
  const meta = TYPE_META[n.type];
  const Icon = meta.icon;
  return (
    <div className="notif-modal-backdrop" onClick={onClose}>
      <div className="notif-modal" onClick={e => e.stopPropagation()} style={{ '--type-color': meta.color } as React.CSSProperties}>
        <button className="notif-modal-close" onClick={onClose}><CloseIcon size={18} tone="gold" /></button>
        <div className="notif-modal-head">
          <div className="notif-modal-icon" style={{ ['--icon-bg' as string]: `linear-gradient(135deg, ${meta.color}, ${meta.color}88)` }}>
            <Icon size={28} tone="dark" />
          </div>
          <div className="notif-modal-meta">
            <span className="notif-modal-type">{meta.label}</span>
            <span className="notif-modal-time">{fmtTime(n.time, false)}</span>
          </div>
        </div>
        <h2 className="notif-modal-title">{n.title}</h2>
        <div className="notif-modal-content">{n.content}</div>

        {n.reward && (
          <div className="notif-modal-reward">
            <div className="notif-modal-reward-label">奖励内容</div>
            <div className="notif-modal-reward-card">
              <n.reward.icon size={24} tone="gold" />
              <div>
                <div className="notif-modal-reward-name">{n.reward.label}</div>
                <div className="notif-modal-reward-value">{n.reward.value}</div>
              </div>
            </div>
          </div>
        )}

        <div className="notif-modal-actions">
          <button className="notif-modal-btn secondary" onClick={onTogglePin}>
            <PinIcon size={14} />
            {n.pinned ? '取消置顶' : '置顶'}
          </button>
          <button className="notif-modal-btn danger" onClick={onDelete}>
            <TrashIcon size={14} />
            删除
          </button>
          {n.action && (
            <button className="notif-modal-btn primary" onClick={onAction}>
              {n.action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// === 设置抽屉 ===
function NotifSettings({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    system: true, activity: true, friend: true, battle: true, reward: true, vip: true, tournament: true, checkin: true, mail: true,
  });
  const [quietStart] = useState('22:00');
  const [quietEnd] = useState('08:00');
  const [quietEnabled, setQuietEnabled] = useState(false);
  // 震动 / 声音复用牌桌那套开关，改了在牌桌也生效
  const [vibrateOn, setVibrateOn] = useState(isVibrateEnabled);
  const [soundOn, setSoundOn] = useState(() => !sound.isMuted());

  const togglePref = (key: string) => setPrefs(p => ({ ...p, [key]: !p[key] }));

  return (
    <div className="notif-settings-backdrop" onClick={onClose}>
      <div className="notif-settings" onClick={e => e.stopPropagation()}>
        <div className="notif-settings-head">
          <h3>
            <DoNotDisturbIcon size={18} tone="gold" />
            通知设置
          </h3>
          <button onClick={onClose}><CloseIcon size={18} tone="gold" /></button>
        </div>

        <div className="notif-settings-section">
          <div className="notif-settings-label">通知类别</div>
          <ul className="notif-settings-list">
            {Object.entries(TYPE_META).map(([key, m]) => (
              <li key={key}>
                <span className="notif-settings-cat-icon" style={{ background: `linear-gradient(135deg, ${m.color}, ${m.color}88)` }}>
                  <m.icon size={14} tone="dark" />
                </span>
                <div className="notif-settings-cat-text">
                  <div className="notif-settings-cat-name">{m.label}通知</div>
                  <div className="notif-settings-cat-sub">接收{m.label}相关的消息推送</div>
                </div>
                <span className={`notif-toggle ${prefs[key] ? 'is-on' : ''}`} onClick={() => togglePref(key)}>
                  <span className="notif-toggle-knob" />
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="notif-settings-section">
          <div className="notif-settings-label">免打扰时段</div>
          <div className="notif-settings-quiet">
            <span className={`notif-toggle ${quietEnabled ? 'is-on' : ''}`} onClick={() => setQuietEnabled(!quietEnabled)}>
              <span className="notif-toggle-knob" />
            </span>
            <div className="notif-settings-quiet-text">
              <div className="notif-settings-quiet-title">{quietEnabled ? '已开启' : '已关闭'}</div>
              <div className="notif-settings-quiet-sub">{quietStart} - {quietEnd} 期间不推送</div>
            </div>
          </div>
        </div>

        <div className="notif-settings-section">
          <div className="notif-settings-label">其他</div>
          <ul className="notif-settings-list">
            <li>
              <span className="notif-settings-cat-icon" style={{ ['--icon-bg' as string]: 'linear-gradient(135deg, #6E83B5, #2E3D6B)' }}>
                <BellIcon size={14} />
              </span>
              <div className="notif-settings-cat-text">
                <div className="notif-settings-cat-name">震动反馈</div>
                <div className="notif-settings-cat-sub">收到通知时震动</div>
              </div>
              <span
                className={`notif-toggle ${vibrateOn ? 'is-on' : ''}`}
                onClick={() => { const next = !vibrateOn; setVibrateOn(next); setVibrateEnabled(next); if (next) vibrate(20); }}
              >
                <span className="notif-toggle-knob" />
              </span>
            </li>
            <li>
              <span className="notif-settings-cat-icon" style={{ ['--icon-bg' as string]: 'linear-gradient(135deg, #6E83B5, #2E3D6B)' }}>
                <BellIcon size={14} />
              </span>
              <div className="notif-settings-cat-text">
                <div className="notif-settings-cat-name">声音提示</div>
                <div className="notif-settings-cat-sub">收到通知时播放声音</div>
              </div>
              <span
                className={`notif-toggle ${soundOn ? 'is-on' : ''}`}
                onClick={() => { const next = !soundOn; setSoundOn(next); sound.setMuted(!next); if (next) sound.click(); }}
              >
                <span className="notif-toggle-knob" />
              </span>
            </li>
          </ul>
        </div>

        <div className="notif-settings-foot">
          <button className="notif-settings-btn" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}

// === 顶 bell 下拉 ===
export function NotificationDropdown({ onOpenFull, onClose }: { onOpenFull: () => void; onClose: () => void }) {
  const { list: source, loading } = useNotifData();
  const [list, setList] = useState<Notification[]>([]);
  useEffect(() => { setList(source); }, [source]);
  const recent = list.slice(0, 5);
  const unreadCount = list.filter(n => n.unread).length;

  const markAllRead = () => setList(p => p.map(n => ({ ...n, unread: false })));
  const markRead = (id: string) => setList(p => p.map(n => n.id === id ? { ...n, unread: false } : n));

  return (
    <div className="notif-dropdown-backdrop" onClick={onClose}>
      <div className="notif-dropdown" onClick={e => e.stopPropagation()}>
        <div className="notif-dropdown-head">
          <h3>
            <BellIcon size={16} tone="gold" />
            消息
            {unreadCount > 0 && <span className="notif-dropdown-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </h3>
          <button
            className="notif-dropdown-mark"
            onClick={markAllRead}
            disabled={unreadCount === 0}
          >
            <CheckAllIcon size={12} /> 全部已读
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="notif-dropdown-empty">{loading ? '加载中…' : '暂无消息'}</div>
        ) : (
          <ul className="notif-dropdown-list">
            {recent.map(n => {
              const meta = TYPE_META[n.type];
              const Icon = meta.icon;
              return (
                <li
                  key={n.id}
                  className={`notif-dropdown-item ${n.unread ? 'is-unread' : ''}`}
                  style={{ '--type-color': meta.color } as React.CSSProperties}
                  onClick={() => markRead(n.id)}
                >
                  <div className="notif-dropdown-icon" style={{ ['--icon-bg' as string]: `linear-gradient(135deg, ${meta.color}, ${meta.color}88)` }}>
                    <Icon size={14} tone="dark" />
                  </div>
                  <div className="notif-dropdown-main">
                    <div className="notif-dropdown-line1">
                      <span className="notif-dropdown-title">{n.title}</span>
                      {n.unread && <span className="notif-dropdown-dot" />}
                    </div>
                    <div className="notif-dropdown-content">{n.content}</div>
                    <div className="notif-dropdown-time">{fmtTime(n.time, true)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="notif-dropdown-foot">
          <button onClick={onOpenFull}>
            查看全部 <ChevronRightIcon size={12} tone="gold" />
          </button>
        </div>
      </div>
    </div>
  );
}
