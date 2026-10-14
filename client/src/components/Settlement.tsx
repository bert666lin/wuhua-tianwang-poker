// ===== 结算面板 v4：大字战果 + 牌面证据 + 折叠明细 =====
//
// 为什么重做（v3 的问题）：9 个平级区块平铺 —— 4 人等级卡、段位条、挖底 banner、
// 比分、4 个统计格、等级计算、分数明细、底牌、最后赢墩。什么都有，
// 什么都不突出。用户反馈「结算页不太直观」。
//
// v4 采用牌类游戏通用的结算范式，三层递进：
//   1. **大字战果**：一眼看到"赢/输几级"和这局叫什么名字（光头/小光/保底成功/
//      挖底成功/闲家过庄）。名称口径统一由 utils/outcome.ts 给，
//      牌桌横幅和这里用的是同一份，不会两处说法不一致。
//   2. **牌面证据**：底牌是什么、多少分、归了谁；最后一墩每家打了什么。
//      这是玩家复盘时真正会看的东西 —— 「我为什么输」要能自己看出来，
//      而不是只给一个结论。
//   3. **折叠明细**：级数公式、分数明细、各家等级/段位/金币，默认收起。
//      想核对的人点开，不想看的人不被淹没。
//
// 计算全在 utils/settlementView.ts + utils/outcome.ts（纯函数、有单测）。
// 这个文件只负责摆放和动效。

import { useEffect, useMemo, useState, useRef } from 'react';
import type { Card as CardType, Player, SettlementResult, Suit } from '../types';
import { Card } from './Card';
import {
  CloseIcon, BoltIcon, CrownIcon, FlameIcon, TrophyIcon, CoinIcon,
  ShareIcon, CopyIcon, RefreshIcon, HouseIcon, ChevronRightIcon,
} from './icons';
import { rankOf, isRankUp } from '../utils/rank';
import { fetchRecords } from '../utils/api';
import { buildSettlementShareText } from '../utils/share';
import { renderShareCard, downloadDataUrl, shareCardFileName } from '../utils/shareCard';
import { describeOutcome } from '../utils/outcome';
import { formatLevelDelta, type StandingRow } from '../utils/roomRecord';
import {
  describeBottomFate, summarizeAuction, buildLastTrickColumns, buildHeadline, SUIT_LABEL,
} from '../utils/settlementView';
import { InviteShare } from './InviteShare';
import { showToast } from '../utils/toast';
import '../styles/settlement.css';

/** 分享落地页：去掉 query/hash 的当前地址。 */
function landingUrl(): string {
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'https://wuhua.example.com/';
  }
}

interface SettlementProps {
  result: SettlementResult;
  players: Player[];
  mySeat: number;
  bankerSeat: number;
  mainSuit: Suit | null;
  onNext: () => void;
  /**
   * 真正离开房间回大厅。
   *
   * ⚠️ 这个回调本身**不该**直接绑在任何按钮上：退房前必须先让玩家看一眼
   * 房间结算清单（这桌打了几局、各家几级）。底部「大厅」按钮走的是
   * onRequestLeave，由牌桌弹清单、确认后才调到这里。
   * 保留这个 prop 是给没有清单的调用方（dev 预览页）兜底用。
   */
  onReturnLobby: () => void;
  /**
   * 请求退房：弹出房间结算清单。
   *
   * 用户反馈「退出房间我还没看到结算单」—— 根因就是结算面板底部的「大厅」
   * 按钮直接调 onReturnLobby 把人踢回大厅了，而顶栏 ✕ 那条路径是有清单的。
   * 一个功能两条路径、只有一条对，就等于没做。
   */
  onRequestLeave?: () => void;
  /**
   * 关掉结算面板、回到牌桌看牌（不退房）。
   *
   * 右上角 ✕ 绑的是这个。以前 ✕ 绑的是 onReturnLobby —— 点一下人就被踢回大厅了，
   * 既不符合「✕ = 关弹窗」的直觉，还绕过了退房前的房间结算清单。
   * 想退房请走底部「大厅」按钮。
   */
  onClose?: () => void;
  /** 模式名，分享/截图卡上要写。 */
  modeName?: string;
  /**
   * 这桌一共打了几局 + 各家累计战绩。
   *
   * 结算这一刻恰恰是最想问「我们打了几把了、我总共输赢几级」的时候，
   * 但结算面板是全屏遮罩，玩家点不到顶栏的「记录」按钮，
   * 所以把累计战绩直接搬进来一份。
   */
  roundsPlayed?: number;
  standings?: StandingRow[];
}

interface ScoreRow {
  label: string;
  value: number;
  muted?: boolean;
  note?: string;
}

interface ParticleSpec {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  delay: number;
  lifetime: number;
  rot: number;
}

function CardRow({ cards, mainSuit, empty, digHighlight }: { cards: CardType[]; mainSuit: Suit | null; empty: string; digHighlight?: boolean }) {
  if (cards.length === 0) return <div className="settle-cards-empty">{empty}</div>;
  return (
    <div className={`settle-card-row ${digHighlight ? 'is-dig' : ''}`}>
      {cards.map(card => (
        <Card key={card.id} card={card} mainSuit={mainSuit} small disabled />
      ))}
    </div>
  );
}

/** 计数器：value 从 0 滚动到 target */
function AnimatedNumber({ value, duration = 800, prefix = '', suffix = '', className }: { value: number; duration?: number; prefix?: string; suffix?: string; className?: string }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      // ease-out-cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);
  return <span className={className}>{prefix}{display}{suffix}</span>;
}

function makeParticles(count: number, baseColor: string, palette: string[]): ParticleSpec[] {
  const out: ParticleSpec[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const dist = 0.25 + Math.random() * 0.22;
    out.push({
      id: i,
      x: 0.5,
      y: 0.5,
      vx: Math.cos(angle) * dist,
      vy: Math.sin(angle) * dist - 0.06,
      size: 4 + Math.random() * 5,
      color: Math.random() < 0.4 ? baseColor : palette[Math.floor(Math.random() * palette.length)],
      delay: Math.random() * 300,
      lifetime: 900 + Math.random() * 700,
      rot: Math.random() * 720 - 360,
    });
  }
  return out;
}

/**
 * 可折叠的明细块。
 *
 * 用原生 <details>/<summary> 而不是自己写 useState：
 * 键盘可达、辅助技术能读出展开状态、不写一行 JS 就有默认行为。
 * 自己实现这些要多几十行且很容易漏掉无障碍。
 */
function Fold({ title, note, children, defaultOpen = false }: {
  title: string;
  note?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="settle-fold" open={defaultOpen}>
      <summary className="settle-fold-head">
        <span className="settle-fold-arrow"><ChevronRightIcon size={12} tone="gold-soft" /></span>
        <span className="settle-fold-title">{title}</span>
        {note && <span className="settle-fold-note">{note}</span>}
      </summary>
      <div className="settle-fold-body">{children}</div>
    </details>
  );
}

export function Settlement({
  result, players, mySeat, bankerSeat, mainSuit,
  onNext, onReturnLobby, onRequestLeave, onClose, modeName,
  roundsPlayed = 0, standings = [],
}: SettlementProps) {
  const iAmBanker = mySeat === bankerSeat;
  const iWon = result.bankerWin === iAmBanker;
  const myDelta = result.levelDeltas?.[mySeat] ?? 0;
  const [showParticles, setShowParticles] = useState(false);
  const [stage, setStage] = useState(0); // 0=enter, 1=hero, 2=content
  // 分享 / 截图此前都是死按钮
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 80);
    const t2 = setTimeout(() => setStage(2), 400);
    const t3 = setTimeout(() => setShowParticles(true), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  /* 这一局叫什么名字。口径与牌桌上那条战果横幅完全一致
   * （同一个 describeOutcome），不会出现「牌桌说光头、结算说保底成功」。 */
  const outcome = useMemo(() => describeOutcome({
    bankerWin: result.bankerWin,
    opponentScore: result.opponentScore,
    digSuccess: result.digSuccess,
    digGuaranteeLevel: result.digGuaranteeLevel,
    callScore: result.callScore,
  }), [result]);

  const headline = useMemo(
    () => buildHeadline({ result, mySeat, bankerSeat }),
    [result, mySeat, bankerSeat],
  );

  const bottomFate = useMemo(() => describeBottomFate(result), [result]);

  const auction = useMemo(
    () => summarizeAuction(result.auctionLog ?? []),
    [result.auctionLog],
  );

  const lastTrickColumns = useMemo(() => buildLastTrickColumns({
    lastTrickPlays: result.lastTrickPlays ?? [],
    players: players.map(p => ({ seatIndex: p.seatIndex, name: p.name })),
    mySeat,
    bankerSeat,
    lastTrickWinner: result.lastTrickWinner,
    playerCount: players.length,
  }), [result.lastTrickPlays, result.lastTrickWinner, players, mySeat, bankerSeat]);

  const scoreRows: ScoreRow[] = [{ label: '各墩抓分', value: result.trickScore }];
  if (result.remainingScore > 0) {
    scoreRows.push({ label: '庄家剩牌分', value: result.remainingScore, note: '对局异常中断，庄家手上剩牌的分归闲家' });
  }
  scoreRows.push(
    bottomFate.toOpponent
      ? { label: '底牌分（计入闲家）', value: bottomFate.score, note: bottomFate.reason }
      : { label: '底牌分（庄家守住）', value: 0, muted: true, note: bottomFate.reason },
  );

  const rankedPlayers = useMemo(() => {
    return [...players]
      .map(p => ({
        ...p,
        delta: result.levelDeltas?.[p.seatIndex] ?? 0,
      }))
      .sort((a, b) => {
        if (b.delta !== a.delta) return b.delta - a.delta;
        return a.seatIndex - b.seatIndex;
      });
  }, [players, result.levelDeltas]);

  // 玩家段位：用服务端同步的真实累计积分算。
  // p.score 是「本局结算后」的累计分，所以本局前的分 = score - delta。
  const totalScores = useMemo(() => {
    return rankedPlayers.map((p) => {
      const newScore = Math.max(0, p.score ?? 0);
      const oldScore = Math.max(0, newScore - p.delta);
      return { ...p, oldScore, newScore, oldRank: rankOf(oldScore), newRank: rankOf(newScore) };
    });
  }, [rankedPlayers]);

  /* 粒子密度跟着战果强度走（outcome.intensity）。
   * 光头/挖底这种"值得吹一晚上"的战果给足量粒子，
   * 保底成功/闲家过庄给克制的量 —— 每局都放同样的礼花，礼花就不值钱了。 */
  const winParticles = useMemo(
    () => (iWon ? makeParticles(16 + outcome.intensity * 10, '232, 211, 168', ['255, 220, 130', '197, 165, 120', '255, 200, 100']) : []),
    [iWon, outcome.intensity],
  );
  const loseParticles = useMemo(() => (!iWon ? makeParticles(20, '110, 110, 130', ['80, 80, 100', '60, 60, 80']) : []), [iWon]);

  // 我的段位变化
  const myProfile = totalScores.find(p => p.seatIndex === mySeat);
  const rankUp = myProfile ? isRankUp(myProfile.oldScore, myProfile.newScore) : false;

  // 本局金币：服务端结算时按 economy.ts 算好随 game_settled 下发。
  const coinsDelta = result.coinRewards?.[mySeat];

  // 连胜和累计胜率来自服务端战绩（服务端在广播前已落库，所以含本局）。
  const [myStats, setMyStats] = useState<{ streak: number; winRateText: string }>(
    { streak: 0, winRateText: '—' },
  );
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetchRecords(50);
        if (!alive) return;
        let streak = 0;
        for (const round of r.rounds) {
          if (!round.iWon) break;
          streak++;
        }
        setMyStats({
          streak,
          winRateText: r.stats.totalRounds > 0 ? `${r.stats.winRate}%` : '—',
        });
      } catch {
        // 战绩拉不到就保持「—」，不影响看结算
      }
    })();
    return () => { alive = false; };
  }, [result]);

  const myName = players.find(p => p.seatIndex === mySeat)?.name || '我';
  const modeLabel = modeName || `${players.length}人 局`;
  const nameOfSeat = (seat: number) => players.find(p => p.seatIndex === seat)?.name ?? `座位 ${seat + 1}`;

  const shareCardInput = {
    playerName: myName,
    mode: modeLabel,
    iWon,
    levelDelta: myDelta,
    mainSuitName: mainSuit ? SUIT_LABEL[mainSuit] : undefined,
    callScore: result.callScore,
    trickScore: result.trickScore,
    opponentScore: result.opponentScore,
    bottomScore: result.bottomScore,
    digSuccess: result.digSuccess,
    /* 战果名字要进战绩图：分享出去的图上只写「赢3级」看不出这局有多精彩，
     * 「光头」「挖底成功」才是可以拿出去说的东西。 */
    outcomeLabel: outcome.label,
  };

  const shareText = buildSettlementShareText({
    playerName: myName,
    mode: modeLabel,
    iWon,
    scoreDelta: myDelta,
    callScore: result.callScore,
    mainSuitName: mainSuit ? SUIT_LABEL[mainSuit] : undefined,
    pageUrl: landingUrl(),
    outcomeLabel: outcome.label,
  });

  /** 截图：Canvas 画一张战绩卡下载，不引三方库。 */
  const saveShareCard = () => {
    const dataUrl = renderShareCard(shareCardInput);
    if (!dataUrl) { showToast('当前环境不支持截图', 'err'); return; }
    downloadDataUrl(dataUrl, shareCardFileName());
    showToast('战绩图已保存到下载目录', 'ok');
  };

  return (
    <div className="settle-backdrop" onClick={(e) => e.stopPropagation()}>
      <section
        className={`settle-panel ${iWon ? 'settle-win' : 'settle-lose'} ${stage >= 1 ? 'is-hero' : ''} ${stage >= 2 ? 'is-content' : ''}`}
        aria-label="本局结算"
      >
        <div className="settle-hero-rays" aria-hidden="true">
          <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <radialGradient id="rayGrad" cx="50%" cy="0%" r="80%">
                <stop offset="0%" stopColor="var(--c-gold-300)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--c-gold-300)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <polygon fill="url(#rayGrad)" points="50,0 60,30 50,15 40,30" />
            <polygon fill="url(#rayGrad)" points="50,0 70,40 50,20 30,40" opacity="0.7" />
            <polygon fill="url(#rayGrad)" points="50,0 80,55 50,25 20,55" opacity="0.5" />
          </svg>
        </div>

        {/* ✕ = 关掉结算回牌桌看牌，不是退房。退房走底部「大厅」。
            没传 onClose 的老调用点就不显示这个按钮，绝不退回"点了就走人"。 */}
        {onClose && (
          <button className="settle-close" onClick={onClose} aria-label="关闭结算，回到牌桌">
            <CloseIcon size={18} tone="gold-soft" />
          </button>
        )}

        {/* ================= 第一层：大字战果 ================= */}
        <header className="settle-hero">
          {/* 战果徽章：这局叫什么名字。data-kind 决定配色/动效强度 */}
          <div className={`settle-outcome-badge intensity-${outcome.intensity}`} data-kind={outcome.kind}>
            <span className="settle-outcome-badge-icon">
              {outcome.kind === 'dig'
                ? <BoltIcon size={15} tone="gold" />
                : outcome.bankerWin
                ? <CrownIcon size={15} tone="gold" />
                : <TrophyIcon size={15} tone="gold" />}
            </span>
            <span className="settle-outcome-badge-text">{outcome.label}</span>
          </div>

          {/* 主角：赢/输几级。这是结算页唯一的大字 */}
          <div className="settle-headline">
            <span className={`settle-headline-verb ${iWon ? 'is-win' : 'is-lose'}`}>{iWon ? '赢' : '输'}</span>
            <AnimatedNumber value={headline.levelAbs} className="settle-headline-num" duration={900} />
            <span className="settle-headline-unit">级</span>
          </div>
          <div className="settle-outcome-detail">{outcome.detail}</div>

          {/* 分数三联：闲家得分 / 叫分 / 庄家实得。中间那格是判胜负的标尺 */}
          <div className="settle-scoreline">
            <div className={`settle-scoreline-cell ${result.bankerWin ? '' : 'is-hit'}`}>
              <span className="settle-scoreline-label">闲家得分</span>
              <AnimatedNumber value={headline.opponentScore} className="settle-scoreline-value" />
            </div>
            <div className="settle-scoreline-cell is-target">
              <span className="settle-scoreline-label">叫分（门槛）</span>
              <span className="settle-scoreline-value">{headline.callScore}</span>
            </div>
            <div className={`settle-scoreline-cell ${result.bankerWin ? 'is-hit' : ''}`}>
              <span className="settle-scoreline-label">庄家实得</span>
              <AnimatedNumber value={headline.bankerScore} className="settle-scoreline-value" />
            </div>
          </div>
          <div className={`settle-gap-text ${headline.opponentScore >= headline.callScore ? 'is-over' : 'is-under'}`}>
            {headline.gapText}
          </div>
          <div className="settle-hero-reward">
            <CoinIcon size={15} tone={coinsDelta && coinsDelta > 0 ? 'gold' : 'mute'} />
            <span>本局金币</span>
            <strong className={coinsDelta && coinsDelta > 0 ? 'is-up' : coinsDelta && coinsDelta < 0 ? 'is-down' : ''}>
              {coinsDelta === undefined ? '—' : `${coinsDelta > 0 ? '+' : ''}${coinsDelta}`}
            </strong>
          </div>
        </header>

        {/* ================= 第二、三层：牌面证据 + 折叠明细 ================= */}
        <div className="settle-scroll">
          {/* ---- 底牌：是什么、多少分、归了谁 ---- */}
          <section className="settle-evidence">
            <div className="settle-evidence-head">
              <span className="settle-evidence-title">庄家埋的底牌</span>
              <span className="settle-evidence-meta">{bottomFate.count} 张 · {bottomFate.score} 分</span>
              <span className={`settle-fate-badge ${bottomFate.toOpponent ? 'is-taken' : 'is-held'}`}>
                {bottomFate.badge}
              </span>
            </div>
            <CardRow cards={result.bottomCards} mainSuit={mainSuit} empty="无底牌" digHighlight={bottomFate.toOpponent} />
            <div className="settle-evidence-note">{bottomFate.reason}</div>
          </section>

          {/* ---- 最后一墩：每家打了什么 ---- */}
          <section className="settle-evidence">
            <div className="settle-evidence-head">
              <span className="settle-evidence-title">最后一手牌</span>
              <span className="settle-evidence-meta">
                {nameOfSeat(result.lastTrickWinner)} 赢下这一墩
              </span>
            </div>
            {lastTrickColumns.length > 0 ? (
              <div className="settle-lasttrick">
                {lastTrickColumns.map(col => (
                  <div
                    key={col.seatIndex}
                    className={[
                      'settle-lasttrick-col',
                      col.isWinner ? 'is-winner' : '',
                      col.isMe ? 'is-me' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <div className="settle-lasttrick-who">
                      <span className="settle-lasttrick-name">{col.playerName}</span>
                      {col.isBanker && <em className="settle-mini-tag is-banker">庄</em>}
                      {col.isMe && <em className="settle-mini-tag is-me">我</em>}
                      {col.isWinner && <em className="settle-mini-tag is-win">赢</em>}
                    </div>
                    <CardRow cards={col.cards} mainSuit={mainSuit} empty="未出牌" />
                  </div>
                ))}
              </div>
            ) : (
              /* 老服务端 / 流局拿不到每家的牌，退回只显示赢家那一手 —— 
                 有一半证据也比一片空白好。 */
              <>
                <CardRow cards={result.finalCards} mainSuit={mainSuit} empty="无记录" />
                <div className="settle-evidence-note">这局没有记到各家的最后一手（旧版本对局）</div>
              </>
            )}
          </section>

          {/* ---- 叫牌过程：主是谁叫的、庄是谁叫的 ---- */}
          <section className="settle-evidence">
            <div className="settle-evidence-head">
              <span className="settle-evidence-title">叫主与定庄</span>
            </div>
            <div className="settle-auction-summary">
              <div className="settle-auction-fact">
                <span className="settle-auction-fact-label">主牌</span>
                <strong>
                  {mainSuit ? SUIT_LABEL[mainSuit] : '未定'}
                  {auction.fromBottom
                    ? <span className="settle-auction-fact-by">无人叫主，翻底定主</span>
                    : auction.suitOwner
                    ? (
                      <span className="settle-auction-fact-by">
                        {auction.suitOwner.playerName} 亮 {auction.suitOwner.sevenCount} 张 7
                        {auction.stealCount > 0 && `（经 ${auction.stealCount} 次抢主）`}
                      </span>
                    )
                    : null}
                </strong>
              </div>
              <div className="settle-auction-fact">
                <span className="settle-auction-fact-label">庄家</span>
                <strong>
                  {auction.banker?.playerName ?? nameOfSeat(bankerSeat)}
                  <span className="settle-auction-fact-by">叫 {result.callScore} 分</span>
                </strong>
              </div>
            </div>
            {auction.rows.length > 0 && (
              <Fold title="完整叫牌过程" note={`${auction.rows.length} 条`}>
                <ul className="settle-auction-list">
                  {auction.rows.map((row, i) => (
                    <li key={`${row.seatIndex}-${i}`} className={row.highlight ? 'is-key' : 'is-pass'}>
                      <span className="settle-auction-who">
                        {row.seatIndex === 255 ? '系统' : row.playerName}
                        {row.seatIndex !== 255 && <em className="settle-auction-seat">{row.seatIndex + 1}号位</em>}
                      </span>
                      <span className="settle-auction-what">{row.text}</span>
                    </li>
                  ))}
                </ul>
              </Fold>
            )}
          </section>

          {/* ---- 本桌累计：打了几局、各家总共赢输几级 ----
               结算是全屏遮罩，玩家点不到顶栏的「记录」按钮，
               而这一刻恰恰最想知道「我们打了几把、我一共输赢多少」。
               口径与顶栏/退房清单同源（utils/roomRecord 的 standings）。 */}
          {roundsPlayed > 0 && standings.length > 0 && (
            <section className="settle-evidence settle-roomtally">
              <div className="settle-evidence-head">
                <span className="settle-evidence-title">本桌累计</span>
                <span className="settle-evidence-meta">已打 {roundsPlayed} 局</span>
              </div>
              <ul className="settle-roomtally-list">
                {standings.map((row, i) => (
                  <li
                    key={row.seatIndex}
                    className={`settle-roomtally-row ${row.isMe ? 'is-me' : ''}`}
                  >
                    <span className="settle-roomtally-rank">{i + 1}</span>
                    <span className="settle-roomtally-name">
                      {row.name}
                      {row.isMe && <em className="settle-mini-tag is-me">我</em>}
                    </span>
                    {/* 坐过庄才显示成功率：没坐过庄显示「0%」是在污蔑人家 */}
                    <span className="settle-roomtally-banker">
                      {row.bankerCount > 0
                        ? `坐庄 ${row.bankerCount} 次 · 成 ${row.bankerWins}`
                        : '未坐庄'}
                    </span>
                    <span className={`settle-roomtally-level ${row.roomLevel > 0 ? 'is-up' : row.roomLevel < 0 ? 'is-down' : ''}`}>
                      {formatLevelDelta(row.roomLevel)} 级
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ---- 折叠：级数怎么算出来的 ---- */}
          <Fold title="这几级是怎么算的" note={`本局 ${result.level} 级`}>
            <ul className="settle-calc-list">
              <li><span>庄家叫分</span><strong>{result.callScore}</strong></li>
              {!result.bankerWin && (
                <>
                  <li><span>闲家得分</span><strong className="is-hit">{result.opponentScore}</strong></li>
                  <li className="settle-calc-formula">
                    <span>分数等级</span>
                    <span className="settle-calc-expr">
                      1 + ⌊({result.opponentScore} − {result.callScore}) ÷ 45⌋ = {result.scoreLevel}
                    </span>
                  </li>
                  {result.digLevel > 0 && (
                    <li className="settle-calc-formula">
                      <span>挖底保底</span>
                      <span className="settle-calc-expr">{result.digLevel} 级</span>
                    </li>
                  )}
                  <li className="settle-calc-total">
                    <span>最终等级 = max(分数, 挖底)</span>
                    <strong>{result.level} 级</strong>
                  </li>
                </>
              )}
              {result.bankerWin && (
                <>
                  <li className="settle-calc-formula">
                    <span>庄家赢级</span>
                    <span className="settle-calc-expr">
                      闲家 {result.opponentScore} 分 → 庄家赢 {result.level} 级
                    </span>
                  </li>
                  <li className="settle-calc-formula">
                    <span>分档</span>
                    <span className="settle-calc-expr">0 分=4级（光头）· 1~40 分=2级（小光）· 41 分以上=1级</span>
                  </li>
                </>
              )}
              <li className="settle-calc-total">
                <span>我的级数变化（庄家一人对全场）</span>
                <strong className={myDelta > 0 ? 'is-up' : myDelta < 0 ? 'is-down' : ''}>
                  {myDelta > 0 ? '+' : ''}{myDelta} 级
                </strong>
              </li>
            </ul>
          </Fold>

          {/* ---- 折叠：闲家这些分从哪来 ---- */}
          <Fold title="闲家的分从哪来" note={`合计 ${result.opponentScore} 分`}>
            <ul className="settle-score-list">
              {scoreRows.map(row => (
                <li key={row.label} className={row.muted ? 'is-muted' : ''}>
                  <span className="settle-row-label">{row.label}</span>
                  <span className="settle-row-value">{row.value > 0 ? `+${row.value}` : row.value}</span>
                  {row.note && <span className="settle-row-note">{row.note}</span>}
                </li>
              ))}
              <li className="settle-score-total">
                <span className="settle-row-label">闲家合计</span>
                <span className="settle-row-value">{result.opponentScore}</span>
              </li>
            </ul>
            {result.bankerRemainingCards.length > 0 && (
              <>
                <div className="settle-evidence-head">
                  <span className="settle-evidence-title">庄家剩牌</span>
                  <span className="settle-evidence-meta">
                    {result.bankerRemainingCards.length} 张 · 计入 {result.remainingScore} 分
                  </span>
                </div>
                <CardRow cards={result.bankerRemainingCards} mainSuit={mainSuit} empty="无剩牌" />
              </>
            )}
          </Fold>

          {/* ---- 折叠：各家等级 / 段位 / 金币 ---- */}
          <Fold
            title="各家等级与我的收益"
            note={coinsDelta === undefined ? undefined : `${coinsDelta > 0 ? '+' : ''}${coinsDelta} 金币`}
          >
            <div className={`settle-players-grid players-${rankedPlayers.length}`}>
              {totalScores.map((p, idx) => {
                const isMe = p.seatIndex === mySeat;
                const isBankerPlayer = p.seatIndex === bankerSeat;
                const deltaUp = p.delta > 0;
                const rankPromoted = isRankUp(p.oldScore, p.newScore);
                return (
                  <div
                    key={p.id}
                    className={[
                      'settle-player-card',
                      isMe ? 'is-me' : '',
                      deltaUp ? 'is-winner' : 'is-loser',
                      rankPromoted ? 'is-promoted' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {idx === 0 && <div className="settle-player-crown"><CrownIcon size={14} tone="gold" /></div>}
                    <div className="settle-player-avatar" style={{ background: `linear-gradient(135deg, hsl(${(p.name.length * 73) % 360}, 50%, 32%), hsl(${((p.name.length * 73) + 40) % 360}, 60%, 22%))` }}>
                      {(p.name || '客').charAt(0).toUpperCase()}
                      {isBankerPlayer && <span className="settle-player-banker-mark">庄</span>}
                    </div>
                    <div className="settle-player-name">
                      {p.name || '玩家'}
                      {isMe && <em className="settle-tag-me">我</em>}
                    </div>
                    <div className="settle-player-level">
                      <span className="settle-player-level-num">{p.newScore}</span>
                      <span className="settle-player-level-rank">
                        <span className={`rank-dot ${p.newRank.cls}`} />
                        {p.newRank.name}
                      </span>
                    </div>
                    <div className={`settle-player-delta ${deltaUp ? 'delta-up' : p.delta < 0 ? 'delta-down' : 'delta-zero'}`}>
                      {deltaUp ? '+' : ''}{p.delta}级
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="settle-stats-row">
              <div className="settle-stat-cell">
                <span className="settle-stat-icon"><FlameIcon size={18} tone={iWon ? 'red' : 'mute'} /></span>
                <span className="settle-stat-num">{myStats.streak}</span>
                <span className="settle-stat-label">{myStats.streak > 0 ? '连胜' : '连胜中断'}</span>
              </div>
              <div className="settle-stat-cell">
                <span className="settle-stat-icon"><CoinIcon size={18} tone={coinsDelta ? 'gold' : 'mute'} /></span>
                <span className={`settle-stat-num ${iWon && coinsDelta ? 'is-up' : ''}`}>
                  {coinsDelta === undefined ? '—' : coinsDelta > 0 ? `+${coinsDelta}` : coinsDelta}
                </span>
                <span className="settle-stat-label">本局金币</span>
              </div>
              <div className="settle-stat-cell">
                <span className="settle-stat-icon"><TrophyIcon size={18} tone={iWon ? 'gold' : 'mute'} /></span>
                <span className="settle-stat-num">{myStats.winRateText}</span>
                <span className="settle-stat-label">累计胜率</span>
              </div>
            </div>
            {myProfile && (
              <div className="settle-rank-strip">
                <div className="settle-rank-cell">
                  <span className="settle-rank-cell-label">原段位</span>
                  <span className={`settle-rank-cell-badge ${myProfile.oldRank.cls}`}>{myProfile.oldRank.name}</span>
                  <span className="settle-rank-cell-score">{myProfile.oldScore}</span>
                </div>
                <div className="settle-rank-arrow">
                  {rankUp ? <FlameIcon size={18} tone="gold" /> : <div className="settle-rank-arrow-line" />}
                </div>
                <div className="settle-rank-cell">
                  <span className="settle-rank-cell-label">{rankUp ? '新段位' : '本段位'}</span>
                  <span className={`settle-rank-cell-badge ${myProfile.newRank.cls} ${rankUp ? 'is-pulsing' : ''}`}>
                    {myProfile.newRank.name}
                  </span>
                  <span className="settle-rank-cell-score">{myProfile.newScore}</span>
                </div>
              </div>
            )}
          </Fold>
        </div>

        {/* ====== 底部 4 按钮 ====== */}
        <div className="settle-actions">
          {/* 走 onRequestLeave（弹房间结算清单），不直接 onReturnLobby。
              没传 onRequestLeave 的调用方（dev 预览）才退回直接走。 */}
          <button
            className="settle-btn settle-btn-ghost"
            onClick={onRequestLeave ?? onReturnLobby}
            aria-label="返回大厅"
          >
            <HouseIcon size={14} tone="gold" />
            <span>大厅</span>
          </button>
          <button
            className="settle-btn settle-btn-secondary"
            aria-label="分享"
            onClick={() => setShareOpen(v => !v)}
          >
            <ShareIcon size={14} tone="gold-soft" />
            <span>分享</span>
          </button>
          <button
            className="settle-btn settle-btn-secondary"
            aria-label="截图"
            onClick={saveShareCard}
          >
            <CopyIcon size={14} tone="gold-soft" />
            <span>截图</span>
          </button>
          <button className="settle-btn settle-btn-primary" onClick={onNext} aria-label="再来一局">
            <RefreshIcon size={14} tone="dark" />
            <span>{iWon ? '下一局' : '再来一局'}</span>
            <span className="settle-btn-arrow">→</span>
          </button>
        </div>

        {/* 分享面板：居中浮层（结算面板本身要滚动，插在按钮下面会被推出视口）。 */}
        {shareOpen && (
          <div
            className="settle-share-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="分享战绩"
            onClick={() => setShareOpen(false)}
          >
            <div className="settle-share-panel" onClick={(e) => e.stopPropagation()}>
              <div className="settle-share-head">
                <span>分享战绩</span>
                <button
                  type="button"
                  className="settle-share-close"
                  aria-label="关闭"
                  onClick={() => setShareOpen(false)}
                >
                  ×
                </button>
              </div>
              <InviteShare
                text={shareText}
                url={landingUrl()}
                title="来打梅州五华天王升级！"
                summary={`我刚打完一局 ${modeLabel}，${outcome.label}，${iWon ? '赢了' : '输了'} ${Math.abs(myDelta)} 级。`}
                copyHint="已复制战绩，发给好友即可"
              />
            </div>
          </div>
        )}

        {/* ====== 粒子层（赢家金粉 / 输家灰屑） ====== */}
        {showParticles && (
          <div className="settle-particles" aria-hidden="true">
            {[...winParticles, ...loseParticles].map((p, i) => (
              <span
                key={i}
                className="settle-particle"
                style={{
                  left: `${p.x * 100}%`,
                  top: `${p.y * 100}%`,
                  width: `${p.size}px`,
                  height: `${p.size}px`,
                  background: `rgba(${p.color}, 1)`,
                  boxShadow: `0 0 ${p.size * 2.2}px rgba(${p.color}, 0.6)`,
                  '--vx': `${p.vx * 100}vw`,
                  '--vy': `${p.vy * 100}vh`,
                  '--rot': `${p.rot}deg`,
                  animation: `settle-burst-${p.id % 4} ${p.lifetime}ms ${p.delay}ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards`,
                } as React.CSSProperties}
              />
            ))}
          </div>
        )}

        {/* 段位提升的爆光效果 */}
        {rankUp && showParticles && (
          <div className="settle-rankup-flash" aria-hidden="true">
            <div className="settle-rankup-ring settle-rankup-ring-1" />
            <div className="settle-rankup-ring settle-rankup-ring-2" />
            <div className="settle-rankup-ring settle-rankup-ring-3" />
          </div>
        )}
      </section>
    </div>
  );
}
