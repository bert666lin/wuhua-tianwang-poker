// ===== 牌桌顶栏浮层：菜单 / 记录 / 设置 =====
// 这三个按钮此前只有 title 没有 onClick，属于纯装饰。
// 面板统一外壳，支持点遮罩 / Esc 关闭。

import { useEffect, useState } from 'react';
import { sound, vibrate, isVibrateEnabled, setVibrateEnabled } from '../utils/sound';
import type { BidEventLike } from './TableV4';
import { copyText } from '../utils/share';
import { showToast } from '../utils/toast';
import { getFourColor, setFourColor as setFourColor_ } from '../utils/preferences';
import { CloseIcon } from './icons';
import { formatLevelDelta, type RoundRow, type StandingRow, type RoomSummary } from '../utils/roomRecord';

/** 顶栏浮层种类。null = 全部关闭。 */
export type TablePanel = 'menu' | 'records' | 'settings' | 'leave' | null;

/** 面板外壳：统一标题栏 + 关闭按钮 + 遮罩/Esc 关闭。 */
function PanelShell({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="tv4-panel-backdrop" onClick={onClose}>
      <div className="tv4-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <header className="tv4-panel-head">
          <span className="tv4-panel-title">{title}</span>
          <button className="tv4-panel-close" onClick={onClose} aria-label="关闭"><CloseIcon size={16} /></button>
        </header>
        <div className="tv4-panel-body">{children}</div>
      </div>
    </div>
  );
}

/** 菜单：房间号复制 + 玩法说明 + 收回托管 + 退出房间。 */
export function TableMenuPanel({
  onClose, onRequestLeave, onOpenRules, roomId, isTrustee, onResumeControl,
}: {
  onClose: () => void;
  /**
   * 点了「退出房间」。
   *
   * 注意不叫 onLeave —— 它不直接离开房间，而是打开退房清单。
   * 名字必须说实话，否则下一个人会以为点了就走并据此改逻辑。
   */
  onRequestLeave?: () => void;
  onOpenRules: () => void;
  roomId?: string | null;
  isTrustee?: boolean;
  onResumeControl?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyRoom = async () => {
    if (!roomId) return;
    const ok = await copyText(roomId);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      showToast(`房间号 ${roomId} 已复制`, 'ok');
    } else {
      showToast('复制失败，请手动记下房间号', 'err');
    }
  };

  return (
    <PanelShell title="菜单" onClose={onClose}>
      {/* 牌桌上唯一的分享入口：房间号点一下即复制。
          微信 / QQ / 邀请链接、笑脸表情按钮都已按产品要求移除 —— 桌面要清爽，
          真要叫人就把房间号发出去。 */}
      {roomId && (
        <div className="tv4-panel-row">
          <span className="tv4-panel-label">房间号</span>
          <button className="tv4-panel-code" onClick={copyRoom}>
            {roomId}<span className="tv4-panel-copy">{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
      )}
      <button className="tv4-panel-item" onClick={() => { sound.click(); onOpenRules(); }}>
        <span>玩法说明</span><span className="tv4-panel-arrow">›</span>
      </button>
      {isTrustee && (
        <button className="tv4-panel-item" onClick={() => { sound.click(); onResumeControl?.(); onClose(); }}>
          <span>收回托管</span><span className="tv4-panel-arrow">›</span>
        </button>
      )}
      {/* 退出前先把这桌的战绩摆出来。
          直接 leave 的老做法有两个问题：一是连打十几把之后什么都没留下，
          二是误点就直接掉出房间（还会被按逃跑罚金）。所以这里只负责
          「打开退房清单」，真正的 leave 在那个面板里确认。 */}
      <button className="tv4-panel-item is-danger" onClick={() => { sound.click(); onRequestLeave?.(); }}>
        <span>退出房间</span><span className="tv4-panel-arrow">›</span>
      </button>
    </PanelShell>
  );
}

/** 本局记录：房间累计战绩 + 叫分过程 + 各家抓分 + 底牌分。 */
export function TableRecordsPanel({
  onClose, bidHistory = [], auctionRows = [], players = [], callScore, bankerName, mainSuitName, bottomCount,
  roundsPlayed = 0, standings = [], rounds = [],
}: {
  onClose: () => void;
  bidHistory?: BidEventLike[];
  /**
   * 叫主/抢主/叫分的完整过程（含座位号）。
   *
   * bidHistory 只有叫分、而且不带座位 —— 四家同名（两个「游客」）时
   * 根本分不清是谁叫的。有 auctionRows 就优先用它。
   */
  auctionRows?: { seatIndex: number; playerName: string; text: string; highlight: boolean }[];
  players?: { name: string; takenScore: number; isBanker: boolean; handCount: number }[];
  callScore?: number;
  bankerName?: string;
  mainSuitName?: string;
  bottomCount?: number;
  /** 这张桌子打完几局（房间累计战绩，跨局不清零）。 */
  roundsPlayed?: number;
  /** 各家在这张桌子上的累计成绩。 */
  standings?: StandingRow[];
  /** 逐局战果。 */
  rounds?: RoundRow[];
}) {
  const totalTaken = players.reduce((s, p) => s + (p.isBanker ? 0 : p.takenScore), 0);

  return (
    <PanelShell title="本局记录" onClose={onClose}>
      <div className="tv4-panel-grid">
        <div className="tv4-panel-stat">
          <span className="tv4-panel-stat-label">主牌</span>
          <strong>{mainSuitName || '未定'}</strong>
        </div>
        <div className="tv4-panel-stat">
          <span className="tv4-panel-stat-label">庄家</span>
          <strong>{bankerName || '未定'}</strong>
        </div>
        <div className="tv4-panel-stat">
          <span className="tv4-panel-stat-label">叫分</span>
          <strong>{callScore ?? 0}</strong>
        </div>
        <div className="tv4-panel-stat">
          <span className="tv4-panel-stat-label">闲家已抓</span>
          <strong>{totalTaken}</strong>
        </div>
      </div>

      {/* 房间累计战绩排在最前面：打到第几局、我一共几级，是玩家进这个面板
          最想知道的两件事。本局的叫牌细节排在后面。 */}
      {roundsPlayed > 0 && (
        <>
          <div className="tv4-panel-section">这桌打了 {roundsPlayed} 局</div>
          <StandingsList rows={standings} />
          <div className="tv4-panel-section">逐局战绩</div>
          <RoundRowsList rows={rounds} />
        </>
      )}

      <div className="tv4-panel-section">本局叫主与叫分过程</div>
      {auctionRows.length > 0 ? (
        <ul className="tv4-panel-list">
          {auctionRows.map((row, i) => (
            <li
              key={`${row.seatIndex}-${i}`}
              className={`tv4-panel-list-item ${row.highlight ? '' : 'is-dim'}`}
            >
              <span className="tv4-panel-who">
                {row.seatIndex === 255 ? '系统' : row.playerName}
                {row.seatIndex !== 255 && (
                  <span className="tv4-panel-seat">{row.seatIndex + 1}号位</span>
                )}
              </span>
              <span className="tv4-panel-val">{row.text}</span>
            </li>
          ))}
        </ul>
      ) : bidHistory.length === 0 ? (
        <div className="tv4-panel-empty">本局还没有叫牌记录</div>
      ) : (
        /* 兜底：拿不到完整过程时退回只有叫分的老记录（老服务端 / 状态还没同步）。 */
        <ul className="tv4-panel-list">
          {bidHistory.map((b, i) => (
            <li key={`${b.playerId}-${i}`} className="tv4-panel-list-item">
              <span className="tv4-panel-who">{b.playerName}</span>
              <span className="tv4-panel-val">{b.score > 0 ? `叫 ${b.score}` : '不叫'}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="tv4-panel-section">各家战况</div>
      <ul className="tv4-panel-list">
        {players.map((p, i) => (
          <li key={`${p.name}-${i}`} className="tv4-panel-list-item">
            <span className="tv4-panel-who">
              {p.name}{p.isBanker && <span className="tv4-panel-badge">庄</span>}
            </span>
            <span className="tv4-panel-val">
              抓分 {p.takenScore} · 剩 {p.handCount} 张
            </span>
          </li>
        ))}
      </ul>
      {typeof bottomCount === 'number' && (
        <div className="tv4-panel-note">底牌 {bottomCount} 张，结算时计入挖底判定</div>
      )}
    </PanelShell>
  );
}

/**
 * 各家累计成绩表（记录面板和退房清单共用一份渲染）。
 *
 * 共用是刻意的：同一张桌子的成绩在两个地方长得不一样，玩家会怀疑其中一个是错的。
 */
function StandingsList({ rows }: { rows: StandingRow[] }) {
  if (rows.length === 0) {
    return <div className="tv4-panel-empty">桌上还没有玩家</div>;
  }
  return (
    <ul className="tv4-panel-list">
      {rows.map(r => (
        <li
          key={r.seatIndex}
          className={`tv4-panel-list-item ${r.isMe ? 'is-me' : ''}`}
        >
          <span className="tv4-panel-who">
            {r.name}
            {r.isMe && <span className="tv4-panel-badge is-me">我</span>}
            <span className="tv4-panel-seat">{r.seatIndex + 1}号位</span>
          </span>
          <span className="tv4-panel-val">
            {/* 级数是这张表的主角，单独放大加色；坐庄战绩是配角 */}
            <strong className={`tv4-room-level ${r.roomLevel > 0 ? 'is-up' : r.roomLevel < 0 ? 'is-down' : ''}`}>
              {formatLevelDelta(r.roomLevel)} 级
            </strong>
            {r.bankerCount > 0
              ? <span className="tv4-room-banker">坐庄 {r.bankerCount} 次 · 守住 {r.bankerWins} 次</span>
              /* 没坐过庄就明说，不要显示「成功率 0%」污蔑人家 */
              : <span className="tv4-room-banker">没坐过庄</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 逐局战绩列表（记录面板和退房清单共用）。 */
function RoundRowsList({ rows }: { rows: RoundRow[] }) {
  if (rows.length === 0) {
    return <div className="tv4-panel-empty">这桌还没打完一局</div>;
  }
  /* 倒序：刚打完的那一局最有人关心，让它在最上面，不用滚到底。 */
  const ordered = [...rows].reverse();
  return (
    <ul className="tv4-panel-list">
      {ordered.map(r => (
        <li key={r.roundNo} className="tv4-panel-list-item">
          <span className="tv4-panel-who">
            <span className="tv4-round-no">第{r.roundNo}局</span>
            <span className={`tv4-round-outcome is-${r.outcome}`}>{r.outcomeLabel}</span>
          </span>
          <span className="tv4-panel-val">
            <span className="tv4-round-detail">
              {/* 流局没人叫分，别显示「叫 0 分」这种假信息 */}
              {r.outcome === 'flow_break'
                ? `${r.bankerName} 主牌最多`
                : `${r.bankerName}坐庄 叫${r.callScore} · 闲家${r.opponentScore}分`}
            </span>
            <strong className={`tv4-room-level ${r.myDelta > 0 ? 'is-up' : r.myDelta < 0 ? 'is-down' : ''}`}>
              {formatLevelDelta(r.myDelta)} 级
            </strong>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 退房清单：把这桌打了几局、各家几级、逐局战果摆出来，确认后才真的离开。
 *
 * 为什么要拦一道：
 *  1. 连打十几把之后直接退出，什么都没留下，玩家会问"刚才那些把算哪去了"；
 *  2. 退出房间在对局中会被按逃跑罚金，误点的代价很大 —— 必须有一次确认；
 *  3. 用户明确要求"关闭房间结算才能退出"。
 *
 * 还没打完一局时（summary.isEmpty）不摆空表格，直接问一句就放人走。
 */
export function TableLeavePanel({
  onClose, onConfirmLeave, summary, standings, rounds, inProgress,
}: {
  onClose: () => void;
  onConfirmLeave: () => void;
  summary: RoomSummary;
  standings: StandingRow[];
  rounds: RoundRow[];
  /**
   * 现在是不是牌局进行中。
   * 进行中退出会被罚金，这句警告必须说出来 —— 否则玩家事后才发现被扣了币。
   */
  inProgress?: boolean;
}) {
  return (
    <PanelShell title="房间结算" onClose={onClose}>
      <div className="tv4-leave-headline">{summary.headline}</div>

      {!summary.isEmpty && (
        <>
          <div className="tv4-panel-section">各家累计</div>
          <StandingsList rows={standings} />

          <div className="tv4-panel-section">逐局战绩</div>
          <RoundRowsList rows={rounds} />
        </>
      )}

      {inProgress && (
        <div className="tv4-panel-note is-warn">
          这局还没打完，现在退出算逃跑：判负扣币并加收罚金，桌上其他人也白打一局。
        </div>
      )}

      <div className="tv4-leave-actions">
        <button className="tv4-leave-btn" onClick={() => { sound.click(); onClose(); }}>
          继续打
        </button>
        <button
          className="tv4-leave-btn is-danger"
          onClick={() => { sound.click(); onConfirmLeave(); }}
        >
          确认退出
        </button>
      </div>
    </PanelShell>
  );
}

/** 设置：音效、震动、四色牌开关。持久化到 localStorage。 */
export function TableSettingsPanel({ onClose, onFourColorChange }: {
  onClose: () => void;
  /** 四色牌改完要立刻重画牌面，所以把结果回传给牌桌。 */
  onFourColorChange?: (on: boolean) => void;
}) {
  const [muted, setMuted] = useState(() => sound.isMuted());
  const [vibrateOn, setVibrateOn] = useState(isVibrateEnabled);
  const [fourColor, setFourColor] = useState(getFourColor);

  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    sound.setMuted(next);
    if (!next) sound.click();
  };

  const toggleVibrate = () => {
    const next = !vibrateOn;
    setVibrateOn(next);
    setVibrateEnabled(next);
    if (next) vibrate(20);
  };

  const toggleFourColor = () => {
    const next = !fourColor;
    setFourColor(next);
    setFourColor_(next);
    onFourColorChange?.(next);
  };

  return (
    <PanelShell title="设置" onClose={onClose}>
      <button className="tv4-panel-item" onClick={toggleMuted}>
        <span>音效</span>
        <span className={`tv4-panel-switch ${muted ? '' : 'is-on'}`}>{muted ? '已关闭' : '已开启'}</span>
      </button>
      <button className="tv4-panel-item" onClick={toggleVibrate}>
        <span>震动</span>
        <span className={`tv4-panel-switch ${vibrateOn ? 'is-on' : ''}`}>{vibrateOn ? '已开启' : '已关闭'}</span>
      </button>
      <button className="tv4-panel-item" onClick={toggleFourColor}>
        <span>四色牌<small style={{ display: 'block', opacity: 0.6 }}>把梅花变绿、方块变蓝。默认关闭（传统红黑）</small></span>
        <span className={`tv4-panel-switch ${fourColor ? 'is-on' : ''}`}>{fourColor ? '已开启' : '已关闭'}</span>
      </button>
      <div className="tv4-panel-note">设置保存在本机，换设备需重新设置</div>
    </PanelShell>
  );
}
