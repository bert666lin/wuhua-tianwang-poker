// ===== 匹配页 v5 — 五华天王清新棋牌风格 =====
// 与大厅视觉统一：蓝紫渐变背景 + IP角色 + 毛玻璃卡片 + 金色按钮
// 状态：searching → matched → starting

import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/matchmaking.css';
import {
  CrownIcon,
  SpadeIcon, HeartIcon, DiamondIcon, ClubIcon,
  StarIcon, BackIcon,
} from '../components/icons';
import { getMatchWaitHint } from './matchmakingView';

interface MatchmakingProps {
  playerName: string;
  modeId?: string;
  onClose: () => void;
  onMatched?: (roomId: string) => void;
}

const MODES = [
  { id: 'threePlayerTwoDecks',   label: '3人 · 两副牌', players: 3 },
  { id: 'threePlayerThreeDecks', label: '3人 · 三副牌', players: 3 },
  { id: 'fourPlayerTwoDecks',    label: '4人 · 两副牌', players: 4 },
  { id: 'fourPlayerThreeDecks',  label: '4人 · 三副牌', players: 4 },
  { id: 'fivePlayerThreeDecks',  label: '5人 · 三副牌', players: 5 },
  { id: 'sixPlayerThreeDecks',   label: '6人 · 三副牌', players: 6 },
];

/**
 * 匹配动画里显示的陪玩名字。
 *
 * ⚠ 必须和服务端 server/src/logic/aiNames.ts 的 AI_NAMES 保持一致，
 * 且**按座位顺序取**（不能随机挑）——
 * 之前这里是随机 pick，服务端却叫 "AI 1/AI 2"，于是匹配页显示"翠花已加入"、
 * 进牌桌变成"AI 2"，玩家一脸问号。现在两边同一份名单同一个顺序。
 *
 * 现阶段真人少，匹配到的基本都是 AI，牌桌上会给它们标"电脑"，不伪装真人。
 */
const OPP_NAMES = ['老王', '阿强', '翠花', '大宝', '阿龙', '小梅', '老李', '阿凤', '细妹', '阿辉', '老陈', '阿珍'];
const OPP_AVATAR_COLORS = [
  ['#FCD34D', '#F59E0B'],
  ['#FCA5A5', '#EF4444'],
  ['#86EFAC', '#22C55E'],
  ['#93C5FD', '#3B82F6'],
  ['#C4B5FD', '#8B5CF6'],
  ['#FDBA74', '#F97316'],
];

function makeRng(seed: number) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
function pick<T>(arr: T[], rng: () => number): T { return arr[Math.floor(rng() * arr.length)]; }

interface Opponent {
  id: string;
  name: string;
  level: number;
  avatarColors: [string, string];
  delay: number;
}

function generateOpponents(count: number, seed: number): Opponent[] {
  const rng = makeRng(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: `opp-${i}`,
    // 按座位取，和服务端 aiNameForSeat(seatIndex) 对齐。
    // 我坐 0 号座，对手从 1 号座开始，所以是 OPP_NAMES[i + 1]。
    name: OPP_NAMES[i + 1] ?? `电脑${i + 2}`,
    level: 1 + Math.floor(rng() * 8),
    avatarColors: OPP_AVATAR_COLORS[i % OPP_AVATAR_COLORS.length] as [string, string],
    delay: 1200 + i * 1100 + Math.floor(rng() * 500),
  }));
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

// === 主组件 ===
export function Matchmaking({ playerName, modeId = 'fourPlayerThreeDecks', onClose, onMatched }: MatchmakingProps) {
  const mode = MODES.find(m => m.id === modeId) ?? MODES[3];
  const totalSlots = mode.players;

  const opponents = useMemo(() => generateOpponents(totalSlots - 1, Date.now() % 10000), [totalSlots]);
  const [foundCount, setFoundCount] = useState(0);
  const [phase, setPhase] = useState<'searching' | 'matched' | 'starting'>('searching');
  const [elapsed, setElapsed] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false); // 取消匹配二次确认
  const [countdown, setCountdown] = useState(5);
  const waitHint = getMatchWaitHint(elapsed, foundCount, opponents.length);

  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    opponents.forEach((opp) => {
      const t = window.setTimeout(() => {
        setFoundCount(c => {
          const next = c + 1;
          if (next >= opponents.length) {
            setTimeout(() => setPhase('matched'), 600);
          }
          return next;
        });
      }, opp.delay);
      timers.push(t);
    });
    return () => timers.forEach(t => clearTimeout(t));
  }, [opponents]);

  /* 进入牌桌只允许触发一次：倒计时结束和手动点「立即开始」是两条路径，
     不去重会连着建两个房间。 */
  const startedRef = useRef(false);
  const onMatchedRef = useRef(onMatched);
  useEffect(() => { onMatchedRef.current = onMatched; }, [onMatched]);

  const fire = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    /* 房号由服务端在建房时分配，这里传空串。
       原来写死 'room-123' 是个假值，调用方（Lobby）其实并不使用它，
       但留着会让人误以为这里真拿到了房号。 */
    onMatchedRef.current?.('');
  };

  useEffect(() => {
    if (phase !== 'matched') return;
    setCountdown(5);
    const id = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(id);
          setPhase('starting');
          setTimeout(fire, 800);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  /**
   * 点「立即开始」= 跳过剩余倒计时，立刻进牌桌。
   *
   * 这里原来只写了 setPhase('starting')，**没有调 onMatched** ——
   * 而真正去创建/加入房间的逻辑全在 onMatched 里。于是按钮一按就
   * 永远卡在"进入中…"，反而不点、等倒计时走完才能进去
   * （倒计时那条路径里有 onMatched）。这是用户反馈的卡死原因。
   *
   * 另外用 startedRef 去重：倒计时和手动点击是两条路径，
   * 都会调 onMatched，不去重会创建两个房间。
   */
  const handleStart = () => {
    if (phase !== 'matched' && !(phase === 'searching' && waitHint.canStartWithAi)) return;
    setPhase('starting');
    fire();
  };

  return (
    <div className="mm-root">
      {/* 背景 — 与大厅一致 */}
      <div className="mm-bg" aria-hidden>
        <div className="mm-bg-glow mm-bg-glow--1" />
        <div className="mm-bg-glow mm-bg-glow--2" />
        <div className="mm-bg-stars" />
      </div>

      {/* 顶栏 */}
      <header className="mm-header">
        <button className="mm-back" onClick={() => {
            if (confirmClose) onClose();
            else setConfirmClose(true);
          }} aria-label="返回">
          <BackIcon size={20} />
        </button>
        <div className="mm-mode-badge">
          <StarIcon size={14} />
          <span>{mode.label}</span>
        </div>
        <div className="mm-timer">
          <span className="mm-timer-label">准备用时</span>
          <span className="mm-timer-value">{fmtTime(elapsed)}</span>
        </div>
      </header>

      {/* 主体 */}
      <div className="mm-body">
        {/* 左侧 IP 角色 */}
        <div className="mm-ip" aria-hidden>
          <div className="mm-ip-glow" />
          <img src="/assets/ui/ip-fullbody.webp" alt="" className="mm-ip-img" />
        </div>

        {/* 右侧内容区 */}
        <div className="mm-content">
          {/* 中央匹配卡片 */}
          <div className={`mm-card ${phase !== 'searching' ? 'is-matched' : ''}`}>
            {/* 牌花浮动动画 */}
            <div className="mm-floaters" aria-hidden>
              <div className="mm-floater mm-floater--1"><SpadeIcon size={28} color="#1E40AF" /></div>
              <div className="mm-floater mm-floater--2"><HeartIcon size={24} color="#DC2626" /></div>
              <div className="mm-floater mm-floater--3"><DiamondIcon size={26} color="#F59E0B" /></div>
              <div className="mm-floater mm-floater--4"><ClubIcon size={22} color="#6D28D9" /></div>
              <div className="mm-floater mm-floater--5"><SpadeIcon size={20} color="#3B82F6" /></div>
              <div className="mm-floater mm-floater--6"><HeartIcon size={18} color="#F87171" /></div>
            </div>

            {/* 中央光环 */}
            <div className="mm-ring">
              <div className="mm-ring-outer" />
              <div className="mm-ring-inner" />
              <div className="mm-core">
                {phase === 'searching' && (
                  <div className="mm-core-icon">
                    <CrownIcon size={48} color="#fff" />
                  </div>
                )}
                {phase !== 'searching' && (
                  <div className="mm-core-check">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </div>
            </div>

            {/* 状态文字 */}
            <div className="mm-status">
              {phase === 'searching' && (
                <>
                  <div className="mm-status-title">正在准备牌桌</div>
                  <div className="mm-status-sub">
                    <span className="mm-status-dots">
                      <span /><span /><span />
                    </span>
                    已安排 <strong>{foundCount}</strong> / {totalSlots - 1} 位电脑对手
                  </div>
                  <div className="mm-wait-hint">{waitHint.text}</div>
                </>
              )}
              {phase === 'matched' && (
                <>
                  <div className="mm-status-title mm-status-title--win">匹配成功！</div>
                  <div className="mm-status-sub">
                    <span className="mm-countdown">{countdown}</span> 秒后自动进入牌桌
                  </div>
                </>
              )}
              {phase === 'starting' && (
                <>
                  <div className="mm-status-title mm-status-title--win">进入牌桌…</div>
                  <div className="mm-status-sub">准备好你的牌运</div>
                </>
              )}
            </div>

            {/* 进度条 */}
            <div className="mm-progress">
              <div
                className="mm-progress-bar"
                style={{ width: `${(foundCount / (totalSlots - 1)) * 100}%` }}
              />
            </div>
          </div>

          {/* 玩家列表 */}
          <div className="mm-players" data-slots={totalSlots} style={{ '--slot-count': totalSlots } as React.CSSProperties}>
            {/* 自己 */}
            <div className="mm-player mm-player--self">
              <div className="mm-avatar mm-avatar--self">
                <CrownIcon size={22} color="#fff" />
              </div>
              <div className="mm-player-info">
                <div className="mm-player-name">{playerName}</div>
                <div className="mm-player-tag mm-player-tag--self">我</div>
              </div>
            </div>

            {/* 对手 */}
            {opponents.map((opp, i) => (
              <div
                key={opp.id}
                className={`mm-player ${i < foundCount ? 'is-found' : ''}`}
                style={{ animationDelay: `${opp.delay}ms` }}
              >
                {i < foundCount ? (
                  <>
                    <div
                      className="mm-avatar"
                      style={{ background: `linear-gradient(135deg, ${opp.avatarColors[0]} 0%, ${opp.avatarColors[1]} 100%)` }}
                    >
                      <StarIcon size={18} color="#fff" />
                    </div>
                    <div className="mm-player-info">
                      <div className="mm-player-name">{opp.name}</div>
                      <div className="mm-player-tag">电脑 · Lv.{opp.level}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mm-avatar mm-avatar--empty">
                      <div className="mm-avatar-spinner" />
                    </div>
                    <div className="mm-player-info">
                      <div className="mm-player-name mm-player-name--empty">等待中…</div>
                      <div className="mm-player-tag mm-player-tag--empty">安排中</div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 底部按钮 */}
      <footer className="mm-footer">
        <button className={`mm-btn mm-btn--ghost ${confirmClose ? 'is-confirm' : ''}`} onClick={() => {
            if (confirmClose) onClose();
            else setConfirmClose(true);
            // 3 秒后自动恢复
            setTimeout(() => setConfirmClose(false), 3000);
          }}>
          {confirmClose ? '确定退出？' : '取消准备'}
        </button>
        <button
          className={`mm-btn mm-btn--gold ${phase === 'searching' && !waitHint.canStartWithAi ? 'is-loading' : ''}`}
          disabled={phase === 'searching' && !waitHint.canStartWithAi}
          onClick={handleStart}
        >
          {phase === 'searching' && (waitHint.canStartWithAi ? '立即开局' : '准备中…')}
          {phase === 'matched' && '立即开始'}
          {phase === 'starting' && '进入中…'}
        </button>
      </footer>

      {/* 匹配成功爆发特效 */}
      {phase !== 'searching' && <MatchBurst />}
    </div>
  );
}

// === 爆发特效 ===
function MatchBurst() {
  const particles = useMemo(() => {
    const rng = makeRng(77);
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      angle: (i / 20) * 360,
      dist: 100 + rng() * 180,
      size: 6 + rng() * 10,
      delay: rng() * 0.15,
      duration: 0.9 + rng() * 0.5,
      suit: pick(['spade', 'heart', 'diamond', 'club'] as const, rng),
    }));
  }, []);

  const SUIT = { spade: SpadeIcon, heart: HeartIcon, diamond: DiamondIcon, club: ClubIcon };

  return (
    <div className="mm-burst" aria-hidden>
      {particles.map(p => {
        const I = SUIT[p.suit];
        return (
          <div
            key={p.id}
            className="mm-burst-particle"
            style={{
              '--angle': `${p.angle}deg`,
              '--dist': `${p.dist}px`,
              '--size': `${p.size}px`,
              '--delay': `${p.delay}s`,
              '--duration': `${p.duration}s`,
            } as React.CSSProperties}
          >
            <I size={p.size} color="#F59E0B" />
          </div>
        );
      })}
      <div className="mm-burst-ring" />
      <div className="mm-burst-ring mm-burst-ring--2" />
    </div>
  );
}
