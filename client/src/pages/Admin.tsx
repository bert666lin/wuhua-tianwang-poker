/**
 * 后台管理页（/admin）。
 *
 * ============================================================
 * 这个页面是给运营/自己用的，不是给玩家看的，所以刻意不复用游戏那套
 * 紫金国潮皮肤 —— 后台要的是"一眼看清数字"，深色朴素表格比装饰性 UI 更合适。
 *
 * 响应式：用户明确要求手机能打开。做法是所有区块都用
 * `grid-template-columns: repeat(auto-fill, minmax(...))`，
 * 玩家表格在窄屏改成「卡片流」而不是横向滚动的表 ——
 * 手机上左右拖表格找一列是最难用的交互。
 * ============================================================
 */

import { useCallback, useEffect, useState } from 'react';
import {
  fetchAdminStatus, adminLogin, getAdminToken, clearAdminToken,
  setAdminUnauthorizedHandler,
  fetchOverview, fetchPlayers, fetchPlayerDetail, grant, grantVip,
  fetchAdminRooms, fetchOnlineRank,
  fetchTickets, updateTicket,
  type AdminOverview, type AdminPlayer, type AdminRoom, type GrantKind,
  type AdminLedgerRow, type AdminTicket, type TicketCounts,
} from '../utils/adminApi';
import { showToast } from '../utils/toast';
import '../styles/admin.css';

type Tab = 'overview' | 'players' | 'rooms' | 'tickets';

/** 秒 -> "1小时23分" / "5分" / "—" */
function fmtDuration(sec: number): string {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分`;
  return `${sec}秒`;
}

function fmtTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => n.toString().padStart(2, '0');
  const sameDay = d.toDateString() === new Date().toDateString();
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** 流水的 reason 转中文，纯英文枚举对运营不友好。 */
const REASON_LABEL: Record<string, string> = {
  round: '对局结算', daily: '每日签到', welfare: '独家福利', ad: '看广告',
  shop: '商城消费', exchange: '兑换', vip: '会员', admin: '后台发放',
  signup: '注册赠送', share: '分享奖励', aid: '破产补助', escape: '逃跑罚金',
  roomcard: '房卡',
};

const CURRENCY_LABEL: Record<string, string> = {
  coins: '金币', stars: '星币', roomCards: '房卡',
};

const PHASE_LABEL: Record<string, string> = {
  waiting: '等待中', dealing: '发牌', calling: '叫主/叫分',
  calling_suit: '叫主', calling_score: '叫分',
  discarding: '扣底', playing: '对战中', settling: '结算中',
};

// ============================================================
//  登录
// ============================================================
function LoginPanel({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!password) { setErr('请输入管理员密码'); return; }
    setBusy(true); setErr('');
    try {
      await adminLogin(password);
      onDone();
    } catch (e: any) {
      setErr(e?.message || '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-login">
      <div className="adm-login-card">
        <div className="adm-login-title">天王扑克 · 后台管理</div>
        <div className="adm-login-sub">请输入管理员密码</div>
        <input
          className="adm-input"
          type="password"
          value={password}
          autoComplete="current-password"
          placeholder="管理员密码"
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
        />
        {err && <div className="adm-err">{err}</div>}
        <button className="adm-btn adm-btn--primary adm-btn--block" disabled={busy} onClick={() => void submit()}>
          {busy ? '登录中…' : '登录'}
        </button>
        <div className="adm-login-note">
          密码由服务端环境变量 ADMIN_PASSWORD 配置，不存在数据库里，也没有注册入口。
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  总览
// ============================================================
function OverviewPanel() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [rank, setRank] = useState<{ id: string; nickname: string; seconds: number }[]>([]);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [o, r] = await Promise.all([fetchOverview(), fetchOnlineRank(10)]);
      setData(o); setRank(r.list); setErr('');
    } catch (e: any) {
      setErr(e?.message || '加载失败');
    }
  }, []);

  // 30 秒自动刷新：后台开着当监控看，手动点刷新太麻烦
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (err) return <div className="adm-err adm-err--block">{err}</div>;
  if (!data) return <div className="adm-loading">正在读取…</div>;

  const cards = [
    { label: '牌桌上的真人', value: data.online.inRooms, sub: '此刻坐在房间里的' },
    { label: '今日活跃账号', value: data.online.activeToday, sub: '今天有过心跳的（含逛大厅）' },
    { label: '房间数', value: data.rooms.total, sub: `对战中 ${data.rooms.playing} · 房卡局 ${data.rooms.cardRooms}` },
    { label: '账号总数', value: data.accounts.total, sub: `今日新增 ${data.accounts.newToday}` },
    { label: '今日总在线', value: fmtDuration(data.today.onlineSeconds), sub: '所有人累计' },
    { label: '今日对局数', value: data.today.rounds, sub: '按玩家条数计（一桌 4 人算 4 条）' },
    { label: '全服金币存量', value: data.economy.totalCoins.toLocaleString(), sub: '所有账号余额之和' },
    { label: '全服房卡存量', value: data.economy.totalRoomCards.toLocaleString(), sub: '所有账号余额之和' },
  ];

  return (
    <>
      <div className="adm-cards">
        {cards.map(c => (
          <div key={c.label} className="adm-card">
            <div className="adm-card-label">{c.label}</div>
            <div className="adm-card-value">{c.value}</div>
            <div className="adm-card-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="adm-section-title">今日在线时长 Top 10</div>
      {rank.length === 0 ? (
        <div className="adm-empty">今天还没有人上线</div>
      ) : (
        <div className="adm-list">
          {rank.map((r, i) => (
            <div key={r.id} className="adm-list-row">
              <span className="adm-list-idx">{i + 1}</span>
              <span className="adm-list-main">{r.nickname}</span>
              <span className="adm-list-val">{fmtDuration(r.seconds)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="adm-note">数据每 30 秒自动刷新。服务器时间：{fmtTime(data.serverTime)}</div>
    </>
  );
}

// ============================================================
//  发放弹窗
// ============================================================
function GrantModal({
  player, onClose, onDone,
}: {
  player: AdminPlayer;
  onClose: () => void;
  onDone: (updated: AdminPlayer) => void;
}) {
  const [kind, setKind] = useState<GrantKind>('coins');
  const [amount, setAmount] = useState('1000');
  const [memo, setMemo] = useState('');
  const [vipDays, setVipDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submitGrant = async () => {
    const n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n === 0) { setErr('数量必须是非 0 整数（负数为扣回）'); return; }
    setBusy(true); setErr('');
    try {
      const r = await grant(player.id, kind, n, memo.trim() || '后台发放');
      showToast(`已给「${player.nickname}」${n > 0 ? '发放' : '扣回'} ${Math.abs(n)} ${CURRENCY_LABEL[kind]}`, 'ok');
      onDone(r.account);
    } catch (e: any) {
      setErr(e?.message || '发放失败');
    } finally {
      setBusy(false);
    }
  };

  const submitVip = async () => {
    const d = Math.round(Number(vipDays));
    if (!Number.isFinite(d) || d === 0) { setErr('天数必须是非 0 整数（负数为撤回）'); return; }
    setBusy(true); setErr('');
    try {
      const r = await grantVip(player.id, d);
      showToast(`已给「${player.nickname}」${d > 0 ? '增加' : '减少'} ${Math.abs(d)} 天会员`, 'ok');
      onDone(r.account);
    } catch (e: any) {
      setErr(e?.message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-mask" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()}>
        <div className="adm-modal-head">
          <div>
            <div className="adm-modal-title">手动发放</div>
            <div className="adm-modal-sub">
              {player.nickname}
              {player.phone ? ` · ${player.phone}` : ' · 游客'}
            </div>
          </div>
          <button className="adm-modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="adm-modal-balance">
          <span>金币 <b>{player.coins.toLocaleString()}</b></span>
          <span>星币 <b>{player.stars.toLocaleString()}</b></span>
          <span>房卡 <b>{player.roomCards.toLocaleString()}</b></span>
          <span>会员 <b>{player.isVip ? '有效' : '无'}</b></span>
        </div>

        <div className="adm-field">
          <label className="adm-label">类型</label>
          <div className="adm-seg">
            {(['coins', 'stars', 'roomCards'] as GrantKind[]).map(k => (
              <button
                key={k}
                className={`adm-seg-btn ${kind === k ? 'is-active' : ''}`}
                onClick={() => setKind(k)}
              >{CURRENCY_LABEL[k]}</button>
            ))}
          </div>
        </div>

        <div className="adm-field">
          <label className="adm-label">数量（负数 = 扣回误发的）</label>
          <input
            className="adm-input"
            value={amount}
            inputMode="numeric"
            onChange={e => setAmount(e.target.value.replace(/[^\d-]/g, ''))}
          />
          <div className="adm-quick">
            {[100, 1000, 10000, 100000].map(v => (
              <button key={v} className="adm-quick-btn" onClick={() => setAmount(String(v))}>
                +{v.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        <div className="adm-field">
          <label className="adm-label">备注（会写进流水，便于日后对账）</label>
          <input
            className="adm-input"
            value={memo}
            placeholder="如：补偿掉线损失"
            onChange={e => setMemo(e.target.value)}
          />
        </div>

        {err && <div className="adm-err">{err}</div>}

        <button className="adm-btn adm-btn--primary adm-btn--block" disabled={busy} onClick={() => void submitGrant()}>
          {busy ? '处理中…' : `确认发放 ${CURRENCY_LABEL[kind]}`}
        </button>

        <div className="adm-divider">会员天数</div>
        <div className="adm-field adm-field--row">
          <input
            className="adm-input"
            value={vipDays}
            inputMode="numeric"
            placeholder="天数，负数为撤回"
            onChange={e => setVipDays(e.target.value.replace(/[^\d-]/g, ''))}
          />
          <button className="adm-btn" disabled={busy} onClick={() => void submitVip()}>确认</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  玩家详情弹窗（含流水）
// ============================================================
function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [ledger, setLedger] = useState<AdminLedgerRow[] | null>(null);
  const [stats, setStats] = useState<{ totalRounds: number; wins: number; winRate: number; digs: number } | null>(null);
  const [online, setOnline] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetchPlayerDetail(id);
        setLedger(r.ledger); setStats(r.stats); setOnline(r.onlineTodaySec);
      } catch (e: any) {
        setErr(e?.message || '加载失败');
      }
    })();
  }, [id]);

  return (
    <div className="adm-mask" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()}>
        <div className="adm-modal-head">
          <div className="adm-modal-title">账号明细</div>
          <button className="adm-modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {err && <div className="adm-err">{err}</div>}
        {stats && (
          <div className="adm-modal-balance">
            <span>对局 <b>{stats.totalRounds}</b></span>
            <span>胜 <b>{stats.wins}</b></span>
            <span>胜率 <b>{stats.winRate}%</b></span>
            <span>今日在线 <b>{fmtDuration(online)}</b></span>
          </div>
        )}
        <div className="adm-section-title">最近流水</div>
        {!ledger ? <div className="adm-loading">读取中…</div>
          : ledger.length === 0 ? <div className="adm-empty">还没有任何余额变动</div>
            : (
              <div className="adm-list">
                {ledger.map(row => (
                  <div key={row.id} className="adm-list-row">
                    <span className="adm-list-main">
                      {REASON_LABEL[row.reason] ?? row.reason}
                      {row.memo ? <em className="adm-list-memo">{row.memo}</em> : null}
                      <em className="adm-list-time">{fmtTime(row.at)}</em>
                    </span>
                    <span className={`adm-list-val ${row.delta > 0 ? 'is-up' : 'is-down'}`}>
                      {row.delta > 0 ? '+' : ''}{row.delta.toLocaleString()} {CURRENCY_LABEL[row.currency] ?? row.currency}
                    </span>
                  </div>
                ))}
              </div>
            )}
      </div>
    </div>
  );
}

// ============================================================
//  玩家列表
// ============================================================
function PlayersPanel() {
  const PAGE_SIZE = 50;
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [q, setQ] = useState('');
  const [identity, setIdentity] = useState<'all' | 'registered' | 'guest'>('all');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [granting, setGranting] = useState<AdminPlayer | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async (
    keyword: string,
    nextIdentity: 'all' | 'registered' | 'guest',
    nextOffset: number,
  ) => {
    setLoading(true);
    try {
      const r = await fetchPlayers({
        q: keyword,
        identity: nextIdentity,
        offset: nextOffset,
        limit: PAGE_SIZE,
      });
      setPlayers(r.players);
      setTotal(r.total);
      setOffset(r.offset);
      setErr('');
    } catch (e: any) {
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load('', 'all', 0); }, [load]);

  return (
    <>
      <div className="adm-toolbar">
        <input
          className="adm-input"
          value={q}
          placeholder="搜用户名、用户 ID 或手机号"
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void load(q, identity, 0); }}
        />
        <select
          className="adm-select"
          value={identity}
          aria-label="用户身份"
          onChange={e => {
            const next = e.target.value as 'all' | 'registered' | 'guest';
            setIdentity(next);
            void load(q, next, 0);
          }}
        >
          <option value="all">全部身份</option>
          <option value="registered">注册用户</option>
          <option value="guest">游客</option>
        </select>
        <button className="adm-btn" onClick={() => void load(q, identity, 0)}>搜索</button>
        <button className="adm-btn" onClick={() => {
          setQ(''); setIdentity('all'); void load('', 'all', 0);
        }}>重置</button>
      </div>

      {err && <div className="adm-err adm-err--block">{err}</div>}
      {loading ? <div className="adm-loading">正在读取…</div>
        : players.length === 0 ? <div className="adm-empty">没有找到账号</div>
          : (
            <div className="adm-players">
              {players.map(p => (
                <div key={p.id} className="adm-player">
                  <div className="adm-player-head">
                    <span className="adm-player-name">
                      用户名 {p.nickname}
                      {p.isVip && <span className="adm-badge adm-badge--vip">会员</span>}
                      {p.authMethod === 'guest'
                        ? <span className="adm-badge">游客</span>
                        : <span className="adm-badge adm-badge--registered">注册用户</span>}
                    </span>
                    <span className="adm-player-phone">{p.phone ?? '未绑手机'}</span>
                  </div>
                  <div className="adm-player-id">用户 ID {p.id}</div>
                  <div className="adm-player-nums">
                    <span>金币 <b>{p.coins.toLocaleString()}</b></span>
                    <span>星币 <b>{p.stars.toLocaleString()}</b></span>
                    <span>房卡 <b>{p.roomCards.toLocaleString()}</b></span>
                    <span>积分 <b>{p.score.toLocaleString()}</b></span>
                  </div>
                  <div className="adm-player-meta">
                    <span>今日在线 {fmtDuration(p.onlineTodaySec)}</span>
                    <span>最后活跃 {fmtTime(p.lastSeenAt)}</span>
                  </div>
                  <div className="adm-player-acts">
                    <button className="adm-btn adm-btn--primary" onClick={() => setGranting(p)}>发放</button>
                    <button className="adm-btn" onClick={() => setDetailId(p.id)}>明细</button>
                  </div>
                </div>
              ))}
            </div>
          )}

      {!loading && total > 0 && (
        <div className="adm-pagination">
          <span>共 {total} 位 · 第 {Math.floor(offset / PAGE_SIZE) + 1}/{Math.max(1, Math.ceil(total / PAGE_SIZE))} 页</span>
          <div>
            <button
              className="adm-btn"
              disabled={offset === 0}
              onClick={() => void load(q, identity, Math.max(0, offset - PAGE_SIZE))}
            >上一页</button>
            <button
              className="adm-btn"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => void load(q, identity, offset + PAGE_SIZE)}
            >下一页</button>
          </div>
        </div>
      )}

      {granting && (
        <GrantModal
          player={granting}
          onClose={() => setGranting(null)}
          onDone={updated => {
            // 就地更新那一行，不用整表重拉（搜索条件和滚动位置都保住）
            setPlayers(list => list.map(x => (x.id === updated.id ? { ...x, ...updated } : x)));
            setGranting(null);
          }}
        />
      )}
      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </>
  );
}

// ============================================================
//  房间列表
// ============================================================
function RoomsPanel() {
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetchAdminRooms();
      setRooms(r.rooms); setErr('');
    } catch (e: any) {
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (err) return <div className="adm-err adm-err--block">{err}</div>;
  if (loading) return <div className="adm-loading">正在读取…</div>;
  if (rooms.length === 0) return <div className="adm-empty">当前没有房间</div>;

  return (
    <>
      <div className="adm-players">
        {rooms.map(r => (
          <div key={r.roomId} className="adm-player">
            <div className="adm-player-head">
              <span className="adm-player-name">
                房号 {r.roomId}
                {r.isCardRoom && <span className="adm-badge adm-badge--friend">房卡局</span>}
                {r.private && <span className="adm-badge">私人</span>}
              </span>
              <span className="adm-player-phone">{PHASE_LABEL[r.phase ?? ''] ?? r.phase ?? '—'}</span>
            </div>
            <div className="adm-player-nums">
              <span>在座 <b>{r.clients}/{r.maxClients}</b></span>
              <span>真人 <b>{r.humanCount ?? '—'}</b></span>
              <span>底分 <b>{r.isCardRoom ? '不计' : (r.stake?.toLocaleString() ?? '—')}</b></span>
            </div>
            <div className="adm-player-meta">
              <span>房主 {r.hostName || '—'}</span>
              <span>模式 {r.modeId ?? '—'}</span>
            </div>
            <div className="adm-room-users">
              {r.participants.length === 0 ? <span>暂无在座用户</span> : r.participants.map((p, index) => (
                <div key={`${p.accountId ?? 'guest'}-${index}`} className="adm-room-user">
                  <b>{p.isAI ? 'AI' : '用户名'} {p.username}</b>
                  <span>{p.isAI ? '电脑玩家' : (p.accountId ? `用户 ID ${p.accountId}` : '临时游客')}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="adm-note">每 15 秒自动刷新。</div>
    </>
  );
}

// ============================================================
//  反馈 / 举报
//  ------------------------------------------------------------
//  这一屏是补一个真实的窟窿：玩家的反馈和举报以前压根没落库，
//  界面上弹一句"已提交"就丢了。运营在这里能看到真实工单并改状态，
//  写的处理备注会显示回玩家自己的反馈记录里。
// ============================================================

const TICKET_KIND_LABEL: Record<string, string> = { feedback: '反馈', report: '举报' };
/** feedback 与 report 的 category 合在一起映射，两边的取值不会重名。 */
const TICKET_CAT_LABEL: Record<string, string> = {
  bug: 'BUG', suggest: '建议', complain: '投诉', cooperate: '合作', other: '其他',
  cheat: '作弊/外挂', abuse: '辱骂', idle: '消极比赛', leak: '信息泄露',
};
const TICKET_STATUS_LABEL: Record<string, string> = { open: '待处理', doing: '处理中', done: '已处理' };

function TicketsPanel() {
  const [items, setItems] = useState<AdminTicket[]>([]);
  const [counts, setCounts] = useState<TicketCounts | null>(null);
  const [kind, setKind] = useState<'' | 'feedback' | 'report'>('');
  const [status, setStatus] = useState<'' | 'open' | 'doing' | 'done'>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  /** 正在编辑备注的工单 id -> 草稿内容 */
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchTickets({ kind: kind || undefined, status: status || undefined, limit: 100 });
      setItems(r.items); setCounts(r.counts); setErr('');
    } catch (e: any) {
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [kind, status]);

  useEffect(() => { void load(); }, [load]);

  const apply = async (t: AdminTicket, patch: { status?: 'open' | 'doing' | 'done'; adminNote?: string }) => {
    try {
      const r = await updateTicket(t.id, patch);
      // 就地替换，避免整页重载把滚动位置和其他人的编辑草稿冲掉
      setItems(list => list.map(x => (x.id === t.id ? r.ticket : x)));
      showToast('已更新', 'ok');
    } catch (e: any) {
      showToast(e?.message || '更新失败', 'err');
    }
  };

  return (
    <>
      {counts && (
        <div className="adm-cards">
          {[
            { label: '待处理', value: counts.open, sub: '玩家还在等回复' },
            { label: '处理中', value: counts.doing, sub: '已认领' },
            { label: '已处理', value: counts.done, sub: '' },
            { label: '总计', value: counts.total, sub: '' },
          ].map(c => (
            <div key={c.label} className="adm-card">
              <div className="adm-card-label">{c.label}</div>
              <div className="adm-card-value">{c.value}</div>
              {c.sub && <div className="adm-card-sub">{c.sub}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="adm-filters">
        <div className="adm-filter-group">
          {([['', '全部'], ['feedback', '反馈'], ['report', '举报']] as const).map(([v, label]) => (
            <button
              key={v}
              className={`adm-chip ${kind === v ? 'is-active' : ''}`}
              onClick={() => setKind(v as any)}
            >{label}</button>
          ))}
        </div>
        <div className="adm-filter-group">
          {([['', '全部状态'], ['open', '待处理'], ['doing', '处理中'], ['done', '已处理']] as const).map(([v, label]) => (
            <button
              key={v}
              className={`adm-chip ${status === v ? 'is-active' : ''}`}
              onClick={() => setStatus(v as any)}
            >{label}</button>
          ))}
        </div>
        <button className="adm-btn" onClick={() => void load()}>刷新</button>
      </div>

      {err && <div className="adm-err adm-err--block">{err}</div>}
      {loading && <div className="adm-loading">正在读取…</div>}
      {!loading && !err && items.length === 0 && (
        <div className="adm-empty">没有符合条件的工单</div>
      )}

      <div className="adm-tickets">
        {items.map(t => (
          <div key={t.id} className={`adm-ticket adm-ticket--${t.status}`}>
            <div className="adm-ticket-head">
              <span className="adm-ticket-id">#{t.id}</span>
              <span className={`adm-badge adm-badge--${t.kind}`}>{TICKET_KIND_LABEL[t.kind] ?? t.kind}</span>
              <span className="adm-badge">{TICKET_CAT_LABEL[t.category] ?? t.category}</span>
              {t.urgent && <span className="adm-badge adm-badge--urgent">加急</span>}
              <span className={`adm-badge adm-badge--st-${t.status}`}>{TICKET_STATUS_LABEL[t.status]}</span>
              <span className="adm-ticket-time">{fmtTime(t.createdAt)}</span>
            </div>

            <div className="adm-ticket-title">{t.title || '(无标题)'}</div>
            {t.target && <div className="adm-ticket-target">举报对象：{t.target}</div>}
            <div className="adm-ticket-body">{t.body}</div>

            <div className="adm-ticket-meta">
              <span>提交人 <b>{t.nickname || '(已注销)'}</b></span>
              {t.contact && <span>联系方式 <b>{t.contact}</b></span>}
              {/* 账号还在就给出 id，方便去「玩家」页搜 */}
              {t.accountId && <span className="adm-ticket-aid">{t.accountId.slice(0, 8)}…</span>}
            </div>
            {t.clientInfo && <div className="adm-ticket-env">{t.clientInfo}</div>}

            <div className="adm-ticket-actions">
              {(['open', 'doing', 'done'] as const).map(st => (
                <button
                  key={st}
                  className={`adm-chip ${t.status === st ? 'is-active' : ''}`}
                  onClick={() => void apply(t, { status: st })}
                  disabled={t.status === st}
                >{TICKET_STATUS_LABEL[st]}</button>
              ))}
            </div>

            <div className="adm-ticket-note">
              <input
                className="adm-input"
                placeholder="处理备注（玩家能看到）"
                value={noteDraft[t.id] ?? t.adminNote}
                onChange={e => setNoteDraft(d => ({ ...d, [t.id]: e.target.value }))}
              />
              <button
                className="adm-btn"
                onClick={() => void apply(t, { adminNote: noteDraft[t.id] ?? t.adminNote })}
              >保存备注</button>
            </div>
          </div>
        ))}
      </div>

      <div className="adm-note">
        处理备注会显示在玩家的「我的反馈 / 我的举报」列表里，让玩家知道有人看了。
      </div>
    </>
  );
}

// ============================================================
//  外壳
// ============================================================
export function Admin() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [logged, setLogged] = useState(!!getAdminToken());
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    setAdminUnauthorizedHandler(() => setLogged(false));
    void fetchAdminStatus().then(r => setEnabled(r.enabled)).catch(() => setEnabled(false));
  }, []);

  if (enabled === null) return <div className="adm-root"><div className="adm-loading">正在检查后台状态…</div></div>;

  if (!enabled) {
    return (
      <div className="adm-root">
        <div className="adm-login">
          <div className="adm-login-card">
            <div className="adm-login-title">后台未启用</div>
            <div className="adm-login-sub">
              服务端没有配置 <code>ADMIN_PASSWORD</code>，后台所有接口都处于关闭状态。
            </div>
            <div className="adm-login-note">
              这是刻意的安全默认值：没有密码就不给一个弱默认密码，
              否则等于把发币权限公开在公网上。<br /><br />
              启用方式：在服务端环境变量里设置 <code>ADMIN_PASSWORD=你的密码</code> 后重启服务。
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!logged) {
    return <div className="adm-root"><LoginPanel onDone={() => setLogged(true)} /></div>;
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: '总览' },
    { id: 'players', label: '玩家' },
    { id: 'rooms', label: '房间' },
    { id: 'tickets', label: '反馈举报' },
  ];

  return (
    <div className="adm-root">
      <header className="adm-top">
        <div className="adm-top-title">天王扑克 · 后台</div>
        <nav className="adm-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`adm-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </nav>
        <button
          className="adm-btn"
          onClick={() => { clearAdminToken(); setLogged(false); }}
        >退出</button>
      </header>

      <main className="adm-body">
        {tab === 'overview' && <OverviewPanel />}
        {tab === 'players' && <PlayersPanel />}
        {tab === 'rooms' && <RoomsPanel />}
        {tab === 'tickets' && <TicketsPanel />}
      </main>
    </div>
  );
}
