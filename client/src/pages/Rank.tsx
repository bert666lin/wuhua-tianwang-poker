// ===== 排行榜 v4 =====
// 三个榜：积分榜 / 胜率榜 / 金币榜，数据全部来自服务端 /api/leaderboard。
//
// v3 是一整页写死的假人（「天王老子」「无敌风火轮」这种），还有一个没有好友系统
// 支撑的「好友榜」。这一版换成真实账号数据，好友榜去掉。
// 榜单只收录打过至少 1 局的账号；胜率榜额外要求 ≥5 局，否则「打 1 局赢 1 局 = 100%」
// 会永远霸榜。

import { useCallback, useEffect, useState } from 'react';
import { CrownIcon, CloseIcon, TrophyIcon, FlameIcon, CoinIcon, RefreshIcon } from '../components/icons';
import { fetchLeaderboard, type LeaderKind, type LeaderRow } from '../utils/api';
import { useAccount } from '../hooks/useAccount';
import { showToast } from '../utils/toast';
import '../styles/rank.css';

interface RankProps {
  playerName: string;
  onClose: () => void;
}

const TABS: { id: LeaderKind; label: string; icon: any; hint: string }[] = [
  { id: 'score',   label: '积分榜', icon: TrophyIcon, hint: '累计积分前 100 名' },
  { id: 'winrate', label: '胜率榜', icon: FlameIcon,  hint: '满 5 局才上榜' },
  { id: 'coins',   label: '金币榜', icon: CoinIcon,   hint: '当前金币前 100 名' },
];

const RANK_CLS: Record<string, string> = {
  '钻石': 'gold', '黄金': 'gold', '白银': 'silver', '青铜': 'bronze',
};

// 领奖台配色：金/银/铜的深色版，保证上面的浅色文字对比度足够。
const PODIUM_BG: Record<number, string> = {
  1: 'linear-gradient(180deg, #B98A3C 0%, #6B4E23 100%)',
  2: 'linear-gradient(180deg, #7C8AA8 0%, #4A5570 100%)',
  3: 'linear-gradient(180deg, #9A6A45 0%, #533C24 100%)',
};

/** 该榜的数值单位。 */
function suffixOf(kind: LeaderKind): string {
  return kind === 'winrate' ? '%' : kind === 'coins' ? '币' : '分';
}

/** 头像底色：按昵称做哈希，同一个人每次进来颜色一致。 */
function avatarBg(name: string): string {
  const h = (name.length * 73 + (name.charCodeAt(0) || 0) * 11) % 360;
  return `linear-gradient(135deg, hsl(${h}, 50%, 32%), hsl(${(h + 40) % 360}, 60%, 22%))`;
}

function initial(name: string): string {
  return (name || '客').charAt(0).toUpperCase();
}

/** 一行的副标题：把「打了几局、赢了几局」摊开，让名次有说服力。 */
function subtitleOf(row: LeaderRow, kind: LeaderKind): string {
  const rounds = row.rounds ?? 0;
  if (!rounds) return '暂无对局';
  if (kind === 'coins') return `${rounds} 局 · 积分 ${row.score}`;
  if (kind === 'winrate') return `${rounds} 局 · 胜 ${row.wins ?? 0}`;
  return `${rounds} 局 · 胜率 ${Math.round(((row.wins ?? 0) / rounds) * 100)}%`;
}

export function Rank({ playerName, onClose }: RankProps) {
  const [tab, setTab] = useState<LeaderKind>('score');
  const [list, setList] = useState<LeaderRow[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { account } = useAccount();
  const myId = account?.id ?? '';

  const load = useCallback(async (kind: LeaderKind) => {
    setLoading(true);
    try {
      const r = await fetchLeaderboard(kind);
      setList(r.list);
      setMyRank(r.me?.rank ?? null);
    } catch (err) {
      setList([]);
      showToast(err instanceof Error ? err.message : '排行榜加载失败', 'err');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(tab); }, [tab, load]);

  const activeTab = TABS.find(t => t.id === tab)!;
  const podium = list.slice(0, 3);
  const rest = list.slice(3);

  return (
    <div className="rank-root">
      <header className="rank-hud">
        <button className="rank-back" onClick={onClose} aria-label="返回">
          <CloseIcon size={18} tone="gold" />
        </button>
        <h1 className="rank-title">排行榜</h1>
        <div className="rank-hud-spacer" />
        {/* 我的名次：没上榜就说明还没打够局数，直接讲清楚 */}
        <div className="rank-hud-me">
          {myRank ? <>我的名次 <b>{myRank}</b></> : <span className="rank-hud-me-none">我暂未上榜</span>}
        </div>
        <button className="rank-hud-icon" aria-label="刷新" onClick={() => void load(tab)}>
          <RefreshIcon size={16} />
        </button>
      </header>

      <nav className="rank-tabs">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={`rank-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="rank-tab-icon"><Icon size={16} /></span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="rank-tab-hint">{activeTab.hint}</div>

      {loading ? (
        <div className="rank-empty">
          <TrophyIcon size={44} tone="mute" />
          <div>正在读取榜单…</div>
        </div>
      ) : list.length === 0 ? (
        <div className="rank-empty">
          <TrophyIcon size={44} tone="mute" />
          <div>榜单还空着</div>
          <div className="rank-empty-sub">
            {tab === 'winrate' ? '打满 5 局才会出现在胜率榜' : '打完一局就会出现在这里'}
          </div>
        </div>
      ) : (
        <>
          {/* 三强领奖台：不足 3 人时只显示已有的，不再摆空台子 */}
          <div className="rank-podium">
            {[1, 0, 2].map(idx => {
              const p = podium[idx];
              if (!p) return null;
              const pos = idx + 1;
              return (
                <div key={p.id} className={`rank-podium-cell rank-podium-cell-${pos}`}>
                  {pos === 1 && (
                    <div className="rank-podium-crown"><CrownIcon size={22} tone="gold" goldColor="#A38E84" /></div>
                  )}
                  <div className="rank-podium-avatar" style={{ background: PODIUM_BG[pos] }}>
                    {initial(p.name)}
                  </div>
                  <div className="rank-podium-name">{p.name}</div>
                  <div className="rank-podium-metric">
                    {p.metric.toLocaleString()}<span className="rank-podium-suffix">{suffixOf(tab)}</span>
                  </div>
                  <div className={`rank-podium-bar rank-podium-bar-${pos}`}>
                    <div className="rank-podium-num">{pos}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rank-list">
            <div className="rank-list-head">
              <span>排名</span>
              <span>玩家</span>
              <span>段位</span>
              <span>成绩</span>
            </div>
            {rest.map((p, i) => {
              const pos = i + 4;
              const isMe = p.id === myId || p.name === playerName;
              return (
                <div key={p.id} className={`rank-list-row ${isMe ? 'is-me' : ''}`}>
                  <span className="rank-list-pos">{pos}</span>
                  <span className="rank-list-player">
                    <span className="rank-list-avatar" style={{ background: avatarBg(p.name) }}>
                      {initial(p.name)}
                    </span>
                    <span className="rank-list-namecol">
                      <span className="rank-list-name">
                        {p.name}{isMe && <span className="rank-list-mine">我</span>}
                      </span>
                      <span className="rank-list-sub">{subtitleOf(p, tab)}</span>
                    </span>
                  </span>
                  <span className={`rank-list-rank ${RANK_CLS[p.rankName] || 'bronze'}`}>{p.rankName}</span>
                  <span className="rank-list-metric">
                    {p.metric.toLocaleString()}<span className="rank-list-suffix">{suffixOf(tab)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
