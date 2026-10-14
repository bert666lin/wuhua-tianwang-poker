// ===== 战绩页 v3 =====
// 结构：顶部 HUD / Player Hero / 4 大指标 / 14 日趋势 / 模式分布 / 筛选 tab / 战绩列表 / 详情弹窗
// 风格：深蓝 + 金棕 玻璃态，参考商业掼蛋/斗地主
// 数据：全部来自服务端 /api/records（此前混入了 82 局假战绩，看着饱满但全是编的）

import { useEffect, useMemo, useState, useCallback } from 'react';
import { rankOf as baseRankOf, rankLevel, rankProgress, nextRankName } from '../utils/rank';
import '../styles/records.css';
import {
  BackIcon, CloseIcon, CrownIcon, TrophyIcon, CoinIcon, BoltIcon,
  TrendDownIcon, ArrowUpIcon, ArrowDownIcon,
  LineChartIcon, BarChartIcon, PieChartIcon,
  HistoryIcon, SparkIcon, StarIcon, DigIcon, TargetIcon, FlagIcon, FlameIcon,
  WinHandIcon, RefreshIcon, FilterIcon, DiamondIcon, HouseIcon, ChevronRightIcon,
} from '../components/icons';
import { fetchRecords, type RoundRow } from '../utils/api';
import { groupByRoom, summarizeRooms, type RoomGroup } from '../utils/recordGroups';
import { getModeLabel } from '../utils/modeSelection';
import { showToast } from '../utils/toast';

interface RecordsProps {
  playerName: string;
  onClose: () => void;
  /** 「再来一局」用：回大厅并发起匹配。不传时只提示。 */
  onPlayAgain?: (mode: string) => void;
}

type Period = 'all' | 'today' | 'week' | 'month';
type ResultFilter = 'all' | 'win' | 'lose';
/**
 * 战绩列表的两种看法。
 *
 * 'round'（按局）是原来唯一的视图；'room'（按桌）是玩家真正的记忆单位——
 * 「昨晚在 6821 房打了 12 局输 5 级」，而不是「第 47 条记录赢 2 级」。
 */
type ListView = 'round' | 'room';

/**
 * 战绩页用的一局记录。
 *
 * 服务端字段（RoundRow）里 mode 是 modeId，对手/时长/墩数都是真实值；
 * 这里只做展示层的整形（modeId -> 「4人 3副」这种中文标签）。
 */
interface RichRound {
  id: string;
  timestamp: number;
  mode: string;
  iWon: boolean;
  iAmBanker: boolean;
  bankerWin: boolean;
  level: number;
  scoreDelta: number;
  callScore: number;
  opponentScore: number;
  digSuccess: boolean;
  coins: number;
  opponents: string[];
  opponentRanks: string[];
  duration: number;
  trickCount: number;
  /** 房卡局（朋友局）：金币永远为 0，要显示成「朋友局」而不是「—」 */
  isCardRoom: boolean;
  /** 哪一桌。按桌视图靠它分组；'' 是 v6 之前的老记录。 */
  roomId: string;
  /** 这桌第几局；0 表示老记录没记局号。 */
  roomRoundNo: number;
}

/** 服务端记录 -> 页面用的一行。 */
function toRichRound(r: RoundRow): RichRound {
  const opponents = Array.isArray(r.opponents) ? r.opponents : [];
  return {
    id: String(r.id),
    timestamp: Number(r.timestamp ?? 0),
    mode: getModeLabel(String(r.modeId ?? '')) ?? '未知模式',
    iWon: Boolean(r.iWon),
    iAmBanker: Boolean(r.iAmBanker),
    bankerWin: Boolean(r.bankerWin),
    level: Number(r.level ?? 0),
    scoreDelta: Number(r.scoreDelta ?? 0),
    callScore: Number(r.callScore ?? 0),
    opponentScore: Number(r.opponentScore ?? 0),
    digSuccess: Boolean(r.digSuccess),
    coins: Number(r.coinsDelta ?? 0),
    opponents: opponents.map(o => o.name),
    opponentRanks: opponents.map(o => o.rankName),
    duration: Number(r.durationSec ?? 0),
    trickCount: Number(r.trickCount ?? 0),
    isCardRoom: Boolean(r.isCardRoom),
    roomId: String(r.roomId ?? ''),
    roomRoundNo: Number(r.roomRoundNo ?? 0),
  };
}

/** 筛选栏里的模式按钮。 */
const MODE_FILTERS = ['3人 2副', '3人 3副', '4人 2副', '4人 3副', '5人 3副', '6人 3副'];

// === 时间格式化 ===
function fmtDate(ts: number, period: Period): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86400_000).toDateString() === d.toDateString();
  const hm = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  if (period === 'today' || sameDay) return `今天 ${hm}`;
  if (yesterday) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** 只要 HH:MM。 */
function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function sameDayTs(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function fmtDuration(s: number): string {
  // 0 表示没记到时长（v2 之前的老记录），别显示成「0分00秒」让人以为秒结束
  if (!s) return '—';
  const m = Math.floor(s / 60);
  return `${m}分${(s % 60).toString().padStart(2, '0')}秒`;
}

/** 各段位在本页使用的图标，段位口径本身统一走 utils/rank。 */
const RANK_ICON = {
  bronze: FlameIcon,
  silver: StarIcon,
  gold: CrownIcon,
  diamond: DiamondIcon,
} as const;

/** 段位 + 本页专属图标。 */
function rankView(score: number) {
  const tier = baseRankOf(score);
  return {
    ...tier,
    icon: RANK_ICON[tier.id],
    level: rankLevel(score),
    progress: rankProgress(score),
    /** 下一段位名，顶档为 null */
    nextName: nextRankName(score),
  };
}

function inPeriod(ts: number, period: Period): boolean {
  const now = Date.now();
  const diff = now - ts;
  if (period === 'today') return diff < 86400_000;
  if (period === 'week')  return diff < 7 * 86400_000;
  if (period === 'month') return diff < 30 * 86400_000;
  return true;
}

function useAnimatedNumber(target: number, duration = 800): number {
  const [val, setVal] = useState(target);
  useEffect(() => {
    const start = val;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(start + (target - start) * e);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return val;
}

export function Records({ playerName, onClose, onPlayAgain }: RecordsProps) {
  const [period, setPeriod] = useState<Period>('week');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [modeFilter, setModeFilter] = useState<string>('all');
  /* 默认「按桌」：一桌十几局的时候，平铺的单局列表根本读不出"昨晚整体怎么样"。
   * 想核对某一局的人切到「按局」，或者点开某一桌展开看。 */
  const [listView, setListView] = useState<ListView>('room');
  /** 展开了哪几桌（按 group.key）。默认全部收起，第一桌除外（见下）。 */
  const [openRooms, setOpenRooms] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<RichRound | null>(null);
  const [allRounds, setAllRounds] = useState<RichRound[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * 加载失败的原因；null 表示这次加载是成功的。
   *
   * 为什么必须单独存一个错误态：原来 load() 里 catch 完只弹一个 toast 就算了，
   * allRounds 保持空数组 —— 而空数组在下面被渲染成「还没有战绩 / 打完一局就会
   * 记录在这里」。于是"网络抖了一下没加载到"和"这个人真的没打过牌"
   * 长得一模一样。用户反馈「刚打完退出，点查看战绩是空的，
   * 退出重进又可以」就是这个：数据明明在服务器上，页面却说你没战绩，
   * 而那个 toast 3 秒就消失了，只剩一屏"没有战绩"在误导人。
   *
   * 错误态要能重试，且**绝不能**说成"没有数据"。
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 累计总积分：以服务端账号积分为准，而不是"最近 50 局之和" */
  const [lifetimeScore, setLifetimeScore] = useState(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetchRecords(200);
      setAllRounds(r.rounds.map(toRichRound));
      setLifetimeScore(r.stats.totalScore);
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '战绩加载失败';
      /* 记下失败原因，让列表区显示"加载失败 + 重试"而不是"还没有战绩"。
       * silent 刷新（用户主动点刷新）失败时也要标记：不然页面停在旧数据上
       * 却没人告诉用户"这次没刷成功"。 */
      setLoadError(msg);
      showToast(msg, 'err');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => allRounds.filter(r => {
    if (!inPeriod(r.timestamp, period)) return false;
    if (resultFilter === 'win' && !r.iWon) return false;
    if (resultFilter === 'lose' && r.iWon) return false;
    if (modeFilter !== 'all' && r.mode !== modeFilter) return false;
    return true;
  }), [allRounds, period, resultFilter, modeFilter]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const wins = filtered.filter(r => r.iWon).length;
    const winRate = total ? Math.round(wins / total * 100) : 0;
    const totalScore = filtered.reduce((s, r) => s + r.scoreDelta, 0);
    const bestLevel = filtered.reduce((m, r) => Math.max(m, Math.abs(r.scoreDelta)), 0);
    const digCount = filtered.filter(r => r.digSuccess).length;
    const avgDuration = total ? Math.round(filtered.reduce((s, r) => s + r.duration, 0) / total) : 0;
    return { total, wins, winRate, totalScore, bestLevel, digCount, avgDuration };
  }, [filtered]);

  // 段位看账号累计积分（跨全部历史），不受上方"本周/本月"筛选影响
  const rank = rankView(lifetimeScore);

  const trendData = useMemo(() => {
    const days = period === 'today' ? 1 : period === 'week' ? 7 : period === 'month' ? 14 : 14;
    const buckets: { date: string; score: number; wins: number; total: number }[] = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(now.getTime() - i * 86400_000);
      const dayStart = day.getTime();
      const dayEnd = dayStart + 86400_000;
      const list = allRounds.filter(r => r.timestamp >= dayStart && r.timestamp < dayEnd);
      const score = list.reduce((s, r) => s + r.scoreDelta, 0);
      const wins = list.filter(r => r.iWon).length;
      buckets.push({
        date: `${day.getMonth() + 1}/${day.getDate()}`,
        score, wins,
        total: list.length,
      });
    }
    return buckets;
  }, [allRounds, period]);

  const modeStats = useMemo(() => {
    const m: Record<string, { total: number; wins: number; score: number }> = {};
    filtered.forEach(r => {
      if (!m[r.mode]) m[r.mode] = { total: 0, wins: 0, score: 0 };
      m[r.mode].total++;
      if (r.iWon) m[r.mode].wins++;
      m[r.mode].score += r.scoreDelta;
    });
    return Object.entries(m)
      .map(([mode, v]) => ({ mode, ...v, winRate: v.total ? Math.round(v.wins / v.total * 100) : 0 }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  const streaks = useMemo(() => {
    let win = 0, lose = 0;
    for (const r of filtered) {
      if (r.iWon) { win++; if (lose) break; } else { lose++; if (win) break; }
    }
    return { win, lose };
  }, [filtered]);

  /* 开房记录：把筛选后的单局按房间收成「一桌」。
   * 跟着 filtered 走而不是 allRounds —— 上面选了「本周/胜利/4人3副」，
   * 下面的桌子列表当然要是同一批局，否则两处数字对不上。 */
  const roomGroups = useMemo(() => groupByRoom(filtered), [filtered]);
  const roomOverview = useMemo(() => summarizeRooms(roomGroups), [roomGroups]);

  /* 最近那一桌默认展开：进页面就能直接看到昨晚打的几局，
   * 不用先点一下。切换筛选后"最近一桌"会变，所以跟着 key 重算。 */
  const firstRoomKey = roomGroups[0]?.key;
  useEffect(() => {
    if (firstRoomKey) setOpenRooms(new Set([firstRoomKey]));
  }, [firstRoomKey]);

  const toggleRoom = useCallback((key: string) => {
    setOpenRooms(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const aWinRate = useAnimatedNumber(stats.winRate);
  const aTotalScore = useAnimatedNumber(stats.totalScore);
  const aTotal = useAnimatedNumber(stats.total);
  const aBestLevel = useAnimatedNumber(stats.bestLevel);

  return (
    <div className="records-root">
      <header className="records-hud">
        <button className="records-back" onClick={onClose} aria-label="返回">
          <BackIcon size={20} tone="gold" />
        </button>
        <h1 className="records-title">战绩</h1>
        <div className="records-hud-spacer" />
        <div className="records-hud-tabs">
          <button className={`records-hud-tab ${period === 'today' ? 'is-active' : ''}`} onClick={() => setPeriod('today')}>今日</button>
          <button className={`records-hud-tab ${period === 'week' ? 'is-active' : ''}`} onClick={() => setPeriod('week')}>本周</button>
          <button className={`records-hud-tab ${period === 'month' ? 'is-active' : ''}`} onClick={() => setPeriod('month')}>本月</button>
          <button className={`records-hud-tab ${period === 'all' ? 'is-active' : ''}`} onClick={() => setPeriod('all')}>全部</button>
        </div>
        <button
          className="records-hud-icon"
          aria-label="刷新"
          onClick={() => { void load(); showToast('战绩已刷新', 'ok'); }}
        ><RefreshIcon size={16} /></button>
      </header>

      <div className="records-body">
        <section className="records-hero">
          <div className="records-hero-bg" />
          <div className="records-hero-content">
            <div className="records-hero-avatar-wrap">
              <div className={`avatar-circle xl ${rank.cls}`} style={{ background: `linear-gradient(135deg, hsl(${(playerName.length * 73) % 360}, 50%, 32%), hsl(${((playerName.length * 73) + 40) % 360}, 60%, 22%))` }}>
                {(playerName || '客').charAt(0).toUpperCase()}
              </div>
              <div className={`records-hero-rank ${rank.cls}`}>
                <rank.icon size={14} />
                <span>{rank.name}</span>
                <span className="records-hero-lv">Lv.{rank.level}</span>
              </div>
            </div>
            <div className="records-hero-info">
              <div className="records-hero-name">{playerName || '游客'}</div>
              <div className="records-hero-sub">梅州五华 · 战绩档案</div>
              <div className="records-hero-bar">
                <div className="records-hero-bar-fill" style={{ width: `${rank.progress}%` }} />
                <div className="records-hero-bar-text">
                  <span>{lifetimeScore}</span>
                  {rank.next === null
                    ? <span style={{ opacity: 0.5 }}>已达最高段位</span>
                    : <span style={{ opacity: 0.5 }}>/ {rank.next} → {rank.nextName}</span>}
                </div>
              </div>
            </div>
            <div className="records-hero-streaks">
              <div className="records-hero-streak is-win">
                <FlameIcon size={20} tone="gold" />
                <div>
                  <div className="records-hero-streak-num">{streaks.win}</div>
                  <div className="records-hero-streak-label">连胜</div>
                </div>
              </div>
              <div className="records-hero-streak is-lose">
                <TrendDownIcon size={20} tone="red" />
                <div>
                  <div className="records-hero-streak-num">{streaks.lose}</div>
                  <div className="records-hero-streak-label">连败</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="records-kpis">
          <div className="records-kpi">
            <div className="records-kpi-icon is-blue">
              <HistoryIcon size={20} />
            </div>
            <div className="records-kpi-num">{aTotal.toFixed(0)}</div>
            <div className="records-kpi-label">总场次</div>
          </div>
          <div className="records-kpi">
            <div className="records-kpi-icon is-gold">
              <TargetIcon size={20} />
            </div>
            <div className="records-kpi-num">{aTotal > 0 ? `${aWinRate.toFixed(0)}%` : '—'}</div>
            <div className="records-kpi-label">胜率</div>
            {/* 一局没打时不显示"比 50% 基准低多少"——那会写出「-50%」这种看不懂的数 */}
            {aTotal > 0 && (
              <div className={`records-kpi-trend ${aWinRate >= 50 ? 'up' : 'down'}`}>
                {aWinRate >= 50 ? <ArrowUpIcon size={10} tone="green" /> : <ArrowDownIcon size={10} tone="red" />}
                <span>{aWinRate >= 50 ? '高于' : '低于'}五成 {Math.abs(aWinRate - 50).toFixed(0)}%</span>
              </div>
            )}
          </div>
          <div className="records-kpi">
            <div className="records-kpi-icon is-gold-2">
              <CoinIcon size={20} />
            </div>
            <div className="records-kpi-num">{aTotalScore > 0 ? '+' : ''}{aTotalScore.toFixed(0)}</div>
            <div className="records-kpi-label">净分</div>
            {aTotal > 0 && (
              <div className={`records-kpi-trend ${aTotalScore >= 0 ? 'up' : 'down'}`}>
                {aTotalScore >= 0 ? <ArrowUpIcon size={10} tone="green" /> : <ArrowDownIcon size={10} tone="red" />}
                <span>{aTotalScore >= 0 ? '净赢' : '净输'}</span>
              </div>
            )}
          </div>
          <div className="records-kpi">
            <div className="records-kpi-icon is-red">
              <SparkIcon size={20} />
            </div>
            <div className="records-kpi-num">{aBestLevel > 0 ? aBestLevel.toFixed(0) : '—'}</div>
            <div className="records-kpi-label">最高级别</div>
            {aBestLevel > 0 && (
              <div className="records-kpi-trend up">
                <ArrowUpIcon size={10} tone="green" />
                <span>历史最佳</span>
              </div>
            )}
          </div>
        </section>

        <section className="records-card">
          <div className="records-card-head">
            <div className="records-card-title">
              <LineChartIcon size={16} tone="gold" />
              <span>得分趋势</span>
            </div>
            <div className="records-card-legend">
              <span className="records-card-legend-dot" style={{ background: 'var(--c-gold-300)' }} /> 净分
              <span className="records-card-legend-dot" style={{ background: 'var(--c-green-400)', marginLeft: 12 }} /> 胜场
            </div>
          </div>
          <TrendChart data={trendData} />
        </section>

        <section className="records-card records-card-row">
          <div className="records-card-half">
            <div className="records-card-head">
              <div className="records-card-title">
                <PieChartIcon size={16} tone="gold" />
                <span>模式分布</span>
              </div>
            </div>
            <ModeDonut data={modeStats} />
          </div>
          <div className="records-card-half">
            <div className="records-card-head">
              <div className="records-card-title">
                <BarChartIcon size={16} tone="gold" />
                <span>各模式战绩</span>
              </div>
            </div>
            <ModeBars data={modeStats} />
          </div>
        </section>

        <section className="records-filters">
          <div className="records-filter-group">
            <button className={`records-filter ${resultFilter === 'all' ? 'is-active' : ''}`} onClick={() => setResultFilter('all')}>
              全部
              <span className="records-filter-num">{filtered.length}</span>
            </button>
            <button className={`records-filter ${resultFilter === 'win' ? 'is-active' : ''}`} onClick={() => setResultFilter('win')}>
              <WinHandIcon size={14} tone="green" /> 胜利
              <span className="records-filter-num">{filtered.filter(r => r.iWon).length}</span>
            </button>
            <button className={`records-filter ${resultFilter === 'lose' ? 'is-active' : ''}`} onClick={() => setResultFilter('lose')}>
              <TrendDownIcon size={14} tone="red" /> 失败
              <span className="records-filter-num">{filtered.filter(r => !r.iWon).length}</span>
            </button>
          </div>
          {/* 按桌 / 按局：默认按桌，因为玩家问的是「昨晚那桌怎么样」 */}
          <div className="records-filter-group records-view-toggle">
            <button
              className={`records-filter ${listView === 'room' ? 'is-active' : ''}`}
              onClick={() => setListView('room')}
            >
              <HouseIcon size={13} tone={listView === 'room' ? 'gold' : 'mute'} /> 按桌
              <span className="records-filter-num">{roomOverview.roomCount}</span>
            </button>
            <button
              className={`records-filter ${listView === 'round' ? 'is-active' : ''}`}
              onClick={() => setListView('round')}
            >
              <HistoryIcon size={13} tone={listView === 'round' ? 'gold' : 'mute'} /> 按局
              <span className="records-filter-num">{filtered.length}</span>
            </button>
          </div>
          <div className="records-filter-group records-filter-group-right">
            <button className={`records-filter records-filter-mode ${modeFilter === 'all' ? 'is-active' : ''}`} onClick={() => setModeFilter('all')}>
              <FilterIcon size={12} /> 全部模式
            </button>
            {MODE_FILTERS.map(m => (
              <button key={m} className={`records-filter records-filter-mode ${modeFilter === m ? 'is-active' : ''}`} onClick={() => setModeFilter(m)}>
                {m}
              </button>
            ))}
          </div>
        </section>

        <section className="records-list">
          {loading ? (
            <div className="records-empty">
              <HistoryIcon size={48} tone="mute" />
              <div>正在读取战绩…</div>
            </div>
          ) : loadError ? (
            /* 加载失败 ≠ 没有战绩。
               这两种情况以前长得一模一样，导致"网络抖一下"被显示成
               "你还没打过牌"，用户以为战绩丢了。必须说清是加载失败，
               并给一个当场能点的重试按钮（否则只能退出应用重进）。 */
            <div className="records-empty">
              <TrendDownIcon size={48} tone="red" />
              <div>战绩没加载出来</div>
              <div style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{loadError}</div>
              <button
                className="records-retry"
                onClick={() => { void load(); }}
              >
                <RefreshIcon size={14} tone="gold" />
                <span>重新加载</span>
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="records-empty">
              <TrophyIcon size={48} tone="mute" />
              <div>{allRounds.length === 0 ? '还没有战绩' : '该筛选下暂无战绩'}</div>
              <div style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
                {allRounds.length === 0 ? '打完一局就会记录在这里' : '切换筛选或打几局再来'}
              </div>
            </div>
          ) : listView === 'room' ? (
            roomGroups.map(g => (
              <RoomGroupCard
                key={g.key}
                g={g}
                open={openRooms.has(g.key)}
                onToggle={() => toggleRoom(g.key)}
                onPickRound={setSelected}
              />
            ))
          ) : (
            filtered.map(r => (
              <RecordRow key={r.id} r={r} onClick={() => setSelected(r)} />
            ))
          )}
        </section>
      </div>

      {selected && (
        <RecordDetail
          r={selected}
          onClose={() => setSelected(null)}
          onPlayAgain={() => {
            const mode = selected.mode;
            setSelected(null);
            if (onPlayAgain) onPlayAgain(mode);
            else showToast('回到大厅点「快速开始」即可再来一局', 'info');
          }}
        />
      )}
    </div>
  );
}

/**
 * 开房记录的一张卡：一桌 = 一张卡，点开看这桌的逐局。
 *
 * 折叠而不是平铺：一桌十几局全铺开会把页面撑到几屏长，
 * 「昨晚打了哪几桌」这个问题反而更难回答了。
 */
function RoomGroupCard({ g, open, onToggle, onPickRound }: {
  g: RoomGroup<RichRound>;
  open: boolean;
  onToggle: () => void;
  onPickRound: (r: RichRound) => void;
}) {
  const up = g.levelDelta > 0;
  const flat = g.levelDelta === 0;
  return (
    <div className={`records-room ${open ? 'is-open' : ''} ${up ? 'is-win' : flat ? '' : 'is-lose'}`}>
      <button className="records-room-head" onClick={onToggle}>
        <div className="records-room-id">
          <HouseIcon size={14} tone="gold" />
          {/* 老记录那组没有房号，标题就直接写「早期记录」而不是硬造一个房号 */}
          <span className="records-room-id-text">{g.isLegacy ? g.roomLabel : `${g.roomLabel} 房`}</span>
        </div>
        <div className="records-room-main">
          <div className="records-room-line1">
            <span className="records-room-mode">{g.mode}</span>
            {g.isCardRoom && <span className="records-room-tag">朋友局</span>}
            {g.bankerCount > 0 && (
              <span className="records-room-tag"><FlagIcon size={9} tone="gold" /> 坐庄 {g.bankerCount}</span>
            )}
          </div>
          <div className="records-room-line2">
            <span>{g.headline}</span>
            <span className="records-row-dot">·</span>
            <span>胜率 {g.winRate}%</span>
            {g.bestLevel > 0 && (
              <>
                <span className="records-row-dot">·</span>
                <span>最高赢 {g.bestLevel} 级</span>
              </>
            )}
          </div>
          <div className="records-room-line3">
            {/* 同一天打完的桌只写一次日期；跨天的桌两头都写，否则看不出打到几点 */}
            {sameDayTs(g.startedAt, g.endedAt)
              ? `${fmtDate(g.endedAt, 'week')} 起 · ${fmtClock(g.endedAt)} 结束`
              : `${fmtDate(g.startedAt, 'week')} → ${fmtDate(g.endedAt, 'week')}`}
          </div>
        </div>
        <div className="records-room-right">
          <div className={`records-room-level ${up ? 'win' : flat ? '' : 'lose'}`}>
            {up ? '+' : ''}{g.levelDelta}
            <em>级</em>
          </div>
          {/* 朋友局金币恒为 0，写「0」会让人以为赢了没给钱 */}
          <div className="records-room-coins">
            {g.isCardRoom ? '不计金币' : g.coinsDelta > 0 ? `+${g.coinsDelta}` : String(g.coinsDelta)}
          </div>
          <div className={`records-room-caret ${open ? 'is-open' : ''}`}>
            <ChevronRightIcon size={14} tone="mute" />
          </div>
        </div>
      </button>

      {open && (
        <div className="records-room-rounds">
          {g.rounds.map(r => (
            <button key={r.id} className="records-room-round" onClick={() => onPickRound(r)}>
              {/* 有局号就显示「第N局」；老记录没有局号，显示时间代替，
                  绝不显示「第0局」那种明显是坏数据的东西 */}
              <span className="records-room-round-no">
                {r.roomRoundNo > 0 ? `第${r.roomRoundNo}局` : fmtClock(r.timestamp)}
              </span>
              <span className={`records-room-round-res ${r.iWon ? 'win' : 'lose'}`}>
                {r.iWon ? '胜' : '负'}
              </span>
              <span className="records-room-round-tags">
                {r.iAmBanker && <em className="records-room-minitag">庄</em>}
                {r.digSuccess && <em className="records-room-minitag">挖底</em>}
              </span>
              <span className="records-room-round-score">
                {r.callScore} 分 / 闲家 {r.opponentScore}
              </span>
              <span className={`records-room-round-delta ${r.scoreDelta > 0 ? 'win' : r.scoreDelta < 0 ? 'lose' : ''}`}>
                {r.scoreDelta > 0 ? '+' : ''}{r.scoreDelta} 级
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RecordRow({ r, onClick }: { r: RichRound; onClick: () => void }) {
  const rank = rankView(r.scoreDelta);
  return (
    <button className={`records-row ${r.iWon ? 'is-win' : 'is-lose'}`} onClick={onClick}>
      <div className="records-row-result">
        {r.iWon ? <WinHandIcon size={22} tone="gold" /> : <TrendDownIcon size={22} tone="red" />}
        <div className={`records-row-delta ${r.iWon ? 'win' : 'lose'}`}>
          {r.scoreDelta > 0 ? '+' : ''}{r.scoreDelta}
        </div>
      </div>
      <div className="records-row-main">
        <div className="records-row-line1">
          <span className="records-row-mode">{r.mode}</span>
          {r.iAmBanker && <span className="records-row-bank"><FlagIcon size={10} tone="gold" /> 庄</span>}
          {r.digSuccess && <span className="records-row-dig"><DigIcon size={10} tone="gold" /> 挖底</span>}
          {r.scoreDelta >= 4 && <span className="records-row-mvp"><SparkIcon size={10} tone="gold" /> MVP</span>}
        </div>
        <div className="records-row-line2">
          <span>对手 · {r.opponents.slice(0, 2).join('、')}{r.opponents.length > 2 ? '…' : ''}</span>
          <span className="records-row-dot">·</span>
          <span>吃 {r.trickCount} 墩</span>
        </div>
        <div className="records-row-line3">{fmtDate(r.timestamp, 'week')}</div>
      </div>
      <div className="records-row-rank">
        <div className={`records-row-rank-tag ${rank.cls}`}>
          <rank.icon size={10} />
          <span>{r.iWon ? '+' : ''}{r.level}级</span>
        </div>
        <div className="records-row-dur">{fmtDuration(r.duration)}</div>
      </div>
    </button>
  );
}

function RecordDetail({ r, onClose, onPlayAgain }: { r: RichRound; onClose: () => void; onPlayAgain: () => void }) {
  return (
    <div className="records-modal-backdrop" onClick={onClose}>
      <div className="records-modal" onClick={e => e.stopPropagation()}>
        <button className="records-modal-close" onClick={onClose}><CloseIcon size={18} tone="gold" /></button>
        <div className="records-modal-head">
          <div className={`records-modal-badge ${r.iWon ? 'win' : 'lose'}`}>
            {r.iWon ? <WinHandIcon size={28} tone="gold" /> : <TrendDownIcon size={28} tone="red" />}
          </div>
          <div>
            <div className="records-modal-title">{r.iWon ? '胜利' : '失败'}</div>
            <div className="records-modal-sub">
              {r.mode} · {fmtDate(r.timestamp, 'week')} · {r.bankerWin ? '庄家守住' : '闲家翻盘'}
            </div>
          </div>
        </div>

        <div className="records-modal-hero">
          <div className="records-modal-score">
            <div className="records-modal-score-num" style={{ color: r.iWon ? 'var(--c-gold-200)' : 'var(--c-red-400)' }}>
              {r.scoreDelta > 0 ? '+' : ''}{r.scoreDelta}
            </div>
            <div className="records-modal-score-label">本局得分</div>
          </div>
          <div className="records-modal-divider" />
          <div className="records-modal-stats">
            <div className="records-modal-stat">
              <div className="records-modal-stat-num">{r.level}</div>
              <div className="records-modal-stat-label">级别</div>
            </div>
            <div className="records-modal-stat">
              <div className="records-modal-stat-num">{r.trickCount}</div>
              <div className="records-modal-stat-label">吃墩</div>
            </div>
            <div className="records-modal-stat">
              <div className="records-modal-stat-num">{fmtDuration(r.duration)}</div>
              <div className="records-modal-stat-label">时长</div>
            </div>
          </div>
        </div>

        <div className="records-modal-section">
          <div className="records-modal-section-title">对手</div>
          <div className="records-modal-opponents">
            {r.opponents.map((name, i) => (
              <div key={i} className="records-modal-opp">
                <div className="avatar-circle sm silver" style={{ background: `linear-gradient(135deg, hsl(${(name.length * 73) % 360}, 50%, 32%), hsl(${((name.length * 73) + 40) % 360}, 60%, 22%))` }}>
                  {name.charAt(0)}
                </div>
                <div className="records-modal-opp-name">{name}</div>
                <div className={`chip chip-${r.opponentRanks[i] === '黄金' ? 'gold' : r.opponentRanks[i] === '白银' ? 'silver' : 'bronze'}`}>{r.opponentRanks[i]}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="records-modal-section">
          <div className="records-modal-section-title">本局要点</div>
          <div className="records-modal-grid">
            <div className="records-modal-cell">
              <BoltIcon size={14} tone="gold" />
              <span className="records-modal-cell-label">本局金币</span>
              {/* 房卡局的金币本来就是 0，直接显示「—」会让玩家以为是 bug（赢了没给钱），
                  所以单独标出原因。 */}
              <span className={`records-modal-cell-val ${r.isCardRoom ? 'muted' : r.coins > 0 ? 'win' : ''}`}>
                {r.isCardRoom ? '朋友局·不计金币'
                  : r.coins > 0 ? `+${r.coins}` : r.coins || '—'}
              </span>
            </div>
            <div className="records-modal-cell">
              <CoinIcon size={14} tone="gold" />
              <span className="records-modal-cell-label">叫分</span>
              <span className="records-modal-cell-val">{r.callScore}</span>
            </div>
            <div className="records-modal-cell">
              <TrophyIcon size={14} tone="gold" />
              <span className="records-modal-cell-label">对手得分</span>
              <span className="records-modal-cell-val">{r.opponentScore}</span>
            </div>
            <div className="records-modal-cell">
              {r.digSuccess
                ? <><DigIcon size={14} tone="gold" /><span className="records-modal-cell-label">挖底</span><span className="records-modal-cell-val win">成功</span></>
                : <><DigIcon size={14} tone="mute" /><span className="records-modal-cell-label">挖底</span><span className="records-modal-cell-val">-</span></>}
            </div>
          </div>
        </div>

        <div className="records-modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>关闭</button>
          <button className="btn btn-primary" onClick={onPlayAgain}>再来一局</button>
        </div>
      </div>
    </div>
  );
}

function TrendChart({ data }: { data: { date: string; score: number; wins: number; total: number }[] }) {
  if (!data.length) return null;
  const W = 600, H = 160, P = 24;
  const maxScore = Math.max(50, ...data.map(d => Math.abs(d.score))) * 1.15;
  const maxWins = Math.max(1, ...data.map(d => d.wins));
  const xStep = (W - P * 2) / (data.length - 1 || 1);

  const linePath = data.map((d, i) => {
    const x = P + i * xStep;
    const y = H / 2 - (d.score / maxScore) * (H / 2 - 12);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  const areaPath = `${linePath} L ${P + (data.length - 1) * xStep} ${H / 2} L ${P} ${H / 2} Z`;

  return (
    <div className="records-trend">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="records-trend-svg">
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(232, 211, 168, 0.4)" />
            <stop offset="100%" stopColor="rgba(232, 211, 168, 0)" />
          </linearGradient>
        </defs>
        <line x1={P} y1={H / 2} x2={W - P} y2={H / 2} stroke="rgba(143, 160, 200, 0.25)" strokeDasharray="4 4" />
        <path d={areaPath} fill="url(#trend-fill)" />
        <path d={linePath} fill="none" stroke="var(--c-gold-300)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => {
          const x = P + i * xStep;
          const y = H / 2 - (d.score / maxScore) * (H / 2 - 12);
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="3" fill="var(--c-gold-200)" stroke="var(--c-blue-800)" strokeWidth="1.5" />
              {/* 首尾两个日期改成靠边对齐：svg 是 preserveAspectRatio="none" 横向拉伸的，
                  文字却不会跟着缩放，居中对齐时最后一天会有一半跑到 svg 右边界外被切掉
                  （实测 1280 宽下 "8/31" 右边缘 1179px > 画布 1134px）。 */}
              <text
                x={x}
                y={H - 4}
                textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
                fontSize="9"
                fill="rgba(181, 194, 220, 0.7)"
                fontFamily="var(--font-mono)"
              >{d.date}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          if (d.wins === 0) return null;
          const x = P + i * xStep - 3;
          const h = (d.wins / maxWins) * 18;
          return <rect key={`w${i}`} x={x} y={H - 14 - h} width="6" height={h} rx="1" fill="var(--c-green-400)" fillOpacity="0.7" />;
        })}
      </svg>
    </div>
  );
}

function ModeDonut({ data }: { data: { mode: string; total: number }[] }) {
  const total = data.reduce((s, d) => s + d.total, 0);
  // 分母用 span（至少 1）避免除零；中间显示的数字必须是真实 total，
  // 早先两处都写 `|| 1`，一局没打时圆环中间会显示「1 总场次」。
  const span = total || 1;
  const C = 2 * Math.PI * 28;
  let acc = 0;
  const colors = ['#E8D3A8', '#C5A578', '#6E83B5', '#7DCC97', '#E55A4E', '#5BADB0'];
  return (
    <div className="records-donut">
      <svg viewBox="0 0 80 80" className="records-donut-svg">
        <circle cx="40" cy="40" r="28" fill="none" stroke="rgba(143, 160, 200, 0.15)" strokeWidth="10" />
        {data.map((d, i) => {
          const len = (d.total / span) * C;
          const offset = C - acc;
          acc += len;
          return (
            <circle
              key={i}
              cx="40" cy="40" r="28"
              fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth="10"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={offset}
              transform="rotate(-90 40 40)"
              strokeLinecap="butt"
            />
          );
        })}
        <text x="40" y="38" textAnchor="middle" fontSize="14" fontWeight="900" fill="#FAF8F2" fontFamily="var(--font-sans)">{total}</text>
        <text x="40" y="50" textAnchor="middle" fontSize="8" fill="rgba(181, 194, 220, 0.7)" fontFamily="var(--font-sans)">总场次</text>
      </svg>
      <ul className="records-donut-legend">
        {data.length === 0 ? (
          <li className="records-chart-empty">还没有数据</li>
        ) : data.slice(0, 4).map((d, i) => (
          <li key={d.mode}>
            <span className="records-donut-dot" style={{ background: colors[i % colors.length] }} />
            <span className="records-donut-mode">{d.mode}</span>
            <span className="records-donut-val">{d.total}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModeBars({ data }: { data: { mode: string; winRate: number; total: number; score: number }[] }) {
  return (
    <div className="records-bars">
      {data.length === 0 && <div className="records-chart-empty">还没有数据</div>}
      {data.slice(0, 4).map(d => (
        <div key={d.mode} className="records-bar-row">
          <div className="records-bar-label">{d.mode}</div>
          <div className="records-bar-track">
            <div className="records-bar-fill-win" style={{ width: `${d.winRate}%` }} />
            <div className="records-bar-fill-lose" style={{ width: `${100 - d.winRate}%` }} />
            <div className="records-bar-text">{d.winRate}%</div>
          </div>
          <div className="records-bar-meta">
            <span className={`records-bar-score ${d.score >= 0 ? 'pos' : 'neg'}`}>
              {d.score >= 0 ? '+' : ''}{d.score}
            </span>
            <span className="records-bar-count">{d.total}局</span>
          </div>
        </div>
      ))}
    </div>
  );
}
