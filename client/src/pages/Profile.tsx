// ===== 个人中心 v3 =====

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CrownIcon, TrophyIcon, BoltIcon, CoinIcon,
  SettingsIcon, InfoIcon, CloseIcon,
  DoorIcon, RankIcon, FlameIcon, StarIcon,
} from '../components/icons';
import { fetchRecords, updateNickname, type RoundRow, type AccountStats } from '../utils/api';
import { useAccount, setAccount } from '../hooks/useAccount';
import { getModeLabel } from '../utils/modeSelection';
import { sound, vibrate, isVibrateEnabled, setVibrateEnabled } from '../utils/sound';
import {
  getCardBack, setCardBack as setCardBack_, nextCardBack,
  getFourColor, setFourColor as setFourColor_,
} from '../utils/preferences';
import { showToast } from '../utils/toast';
import { LegalDocModal, type LegalDocId } from '../components/LegalDocModal';
import { rankOf, rankProgress, rankLevel, nextRankName } from '../utils/rank';
import '../styles/profile.css';

interface ProfileProps {
  playerName: string;
  onChangeName: (n: string) => void;
  onLogout: () => void;
  onOpenRules: () => void;
  /** 「赚金币」按钮：跳活动页。不传时只给一句提示。 */
  onEarnCoins?: () => void;
}

/**
 * 成就。原来 done 是写死的（前 3 个永远"已达成"，后 3 个永远锁着），
 * 现在按账号真实数据算。
 */
interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  done: boolean;
}

function buildAchievements(input: {
  stats: AccountStats | null;
  coins: number;
  isVip: boolean;
  streak: number;
}): Achievement[] {
  const st = input.stats;
  return [
    { id: 'first-win', name: '初战告捷', desc: '赢得第一局',   icon: <BoltIcon size={18} tone="gold" />, done: (st?.wins ?? 0) >= 1 },
    { id: 'streak-3',  name: '三连胜',   desc: '连续赢得 3 局', icon: <FlameIcon size={18} />,            done: input.streak >= 3 },
    { id: 'comeback',  name: '绝地翻盘', desc: '挖底成功翻盘',  icon: <RankIcon size={18} tone="gold" />, done: (st?.digs ?? 0) >= 1 },
    { id: 'rich',      name: '财大气粗', desc: '金币超过 5000', icon: <CoinIcon size={18} />,             done: input.coins >= 5000 },
    { id: 'vip',       name: 'VIP 玩家', desc: '开通会员',      icon: <CrownIcon size={18} tone="gold" />, done: input.isVip },
    { id: 'master',    name: '天王大师', desc: '单局赢 4 级',    icon: <TrophyIcon size={18} />,           done: (st?.bestLevel ?? 0) >= 4 },
  ];
}

/** 版本号：关于弹窗用。改版本时同步这里。 */
const APP_VERSION = 'v1.3.0';

function timeAgo(t: number): string {
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  return `${Math.floor(diff / 86400_000)}天前`;
}

export function Profile({ playerName, onChangeName, onLogout, onOpenRules, onEarnCoins }: ProfileProps) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(playerName);
  const [showSettings, setShowSettings] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocId | null>(null);
  // 声音 / 震动复用牌桌那套全局开关，改完在牌桌也生效
  const [soundOn, setSoundOn] = useState(() => !sound.isMuted());
  const [vibrateOn, setVibrateOn] = useState(isVibrateEnabled);
  const [cardBack, setCardBack] = useState(getCardBack);
  const [fourColor, setFourColor] = useState(getFourColor);
  // 账号（金币/星币/会员/积分）与战绩都读服务端，不再是 localStorage 里的本地数字
  const { account, stats: accountStats } = useAccount();
  const [history, setHistory] = useState<RoundRow[]>([]);
  const [stats, setStats] = useState<AccountStats | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetchRecords(20);
        if (!alive) return;
        setHistory(r.rounds.slice(0, 8));
        setStats(r.stats);
      } catch { /* 拉不到就显示空战绩，不弹错打扰 */ }
    })();
    return () => { alive = false; };
  }, []);

  // /api/me 也带 stats，先用它兜底，避免首屏四个 0 一闪
  const effectiveStats = stats ?? accountStats;
  const totalRounds = effectiveStats?.totalRounds ?? 0;
  const wins = effectiveStats?.wins ?? 0;
  const digs = effectiveStats?.digs ?? 0;
  // 积分以账号字段为准（跨全部历史），战绩接口只返回最近若干局
  const totalScore = account?.score ?? 0;
  const coins = account?.coins ?? 0;
  const stars = account?.stars ?? 0;

  /** 当前连胜：从最近一局往前数。 */
  const streak = useMemo(() => {
    let n = 0;
    for (const r of history) { if (!r.iWon) break; n++; }
    return n;
  }, [history]);

  const achievements = useMemo(
    () => buildAchievements({ stats: effectiveStats, coins, isVip: Boolean(account?.isVip), streak }),
    [effectiveStats, coins, account?.isVip, streak],
  );

  // 段位口径统一走 utils/rank（此前这里缺钻石档，2000+ 仍显示黄金）
  const rank = rankOf(totalScore);
  const progress = rankProgress(totalScore);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    sound.setMuted(!next);
    if (next) sound.click();
  };

  const toggleVibrate = () => {
    const next = !vibrateOn;
    setVibrateOn(next);
    setVibrateEnabled(next);
    if (next) vibrate(20);
  };

  /** 四色牌：小屏上区分花色主要靠颜色，所以做成显式开关而不是藏在牌背里。 */
  const toggleFourColor = () => {
    const next = !fourColor;
    setFourColor(next);
    setFourColor_(next);
    showToast(next ? '已开启四色牌：梅花绿、方块蓝' : '已切回传统红黑两色（方块红、梅花黑）', 'ok');
  };

  /** 牌背：在可选样式里循环切换并持久化。 */
  const cycleCardBack = () => {
    const next = nextCardBack(cardBack);
    setCardBack(next);
    setCardBack_(next);
    showToast(`牌背已切换为「${next}」`, 'ok');
  };

  /** 改昵称：先写服务端（牌桌上显示的名字以账号为准），成功后再同步本地。 */
  const submitName = useCallback(async () => {
    const next = nameInput.trim();
    setEditingName(false);
    if (!next || next === playerName) return;
    try {
      const r = await updateNickname(next);
      setAccount(r.account);
      onChangeName(r.account.nickname);
      showToast('昵称已更新', 'ok');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '改名失败', 'err');
      setNameInput(playerName);
    }
  }, [nameInput, playerName, onChangeName]);

  return (
    <div className="profile-root">
      {/* 顶部个人 hero
        * 布局：左头像 + 右信息（名字 / ID / 段位徽章），经验条独占一行。
        * 原来是所有元素纵向居中堆叠，头像下方紧跟名字、ID、经验条四行，
        * 顶部一大片空、信息又挤在中轴线上，比例很散。
        * 段位徽章必须是头像的兄弟节点，不能放进 .avatar-circle 里 ——
        * 那个圆有 overflow:hidden（为了裁剪头像图），徽章塞进去会被裁掉一半，
        * 于是「玩」和被裁的「青铜」看着就是黏在一起的「玩青铜」。 */}
      <section className="profile-hero">
        <div className="profile-hero-main">
          <div className="profile-avatar-wrap">
            <div className={`avatar-circle xl ${rank.cls}`} style={{ background: `linear-gradient(135deg, hsl(${(playerName.length * 73) % 360}, 50%, 32%), hsl(${((playerName.length * 73) + 40) % 360}, 60%, 22%))` }}>
              {(playerName || '客').charAt(0).toUpperCase()}
            </div>
            <span className={`profile-rank-badge ${rank.cls}`}>{rank.name}</span>
          </div>

          <div className="profile-hero-info">
            {editingName ? (
              <div className="profile-name-edit">
                <input
                  autoFocus
                  value={nameInput}
                  maxLength={10}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void submitName(); if (e.key === 'Escape') setEditingName(false); }}
                  className="profile-name-input"
                />
                <button className="btn btn-primary profile-name-save" onClick={() => void submitName()}>保存</button>
              </div>
            ) : (
              <h2 className="profile-name" onClick={() => setEditingName(true)}>
                <span className="profile-name-text">{playerName || '游客'}</span>
                <span className="profile-edit-icon" aria-hidden>✎</span>
              </h2>
            )}
            {/* ID 用账号 id 的尾段，原来是拿昵称哈希出来的假号（改个名 ID 就变了） */}
            <div className="profile-id">ID: {account ? account.id.replace(/-/g, '').slice(-8).toUpperCase() : '——'}</div>
            <div className="profile-hero-tags">
              <span className="profile-lv-chip">Lv.{rankLevel(totalScore)}</span>
              <span className="profile-score-chip">{totalScore} 分</span>
              {account?.isVip && <span className="profile-vip-chip"><CrownIcon size={11} /> 会员</span>}
            </div>
          </div>
        </div>

        {/* 经验条：段位名不再重复出现在这里（徽章已经写了），
            改成写「还差多少分升下一段」，这才是玩家真正想看的信息。 */}
        <div className="profile-exp">
          <div className="profile-exp-info">
            <span className="profile-exp-label">
              {rank.next === null ? '已达最高段位' : `距 ${nextRankName(totalScore)} 还需 ${rank.next - totalScore} 分`}
            </span>
            <span className="profile-exp-score">
              {rank.next === null ? `${totalScore} 分` : `${totalScore} / ${rank.next}`}
            </span>
          </div>
          <div className="profile-exp-bar">
            <div className="profile-exp-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </section>

      {/* 战绩统计卡 */}
      <section className="profile-stats">
        <div className="profile-stat">
          <div className="profile-stat-num">{totalRounds}</div>
          <div className="profile-stat-label">总局</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-num">{wins}</div>
          <div className="profile-stat-label">胜场</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-num">
            {totalRounds > 0 ? Math.round((wins / totalRounds) * 100) : 0}<span style={{ fontSize: 14 }}>%</span>
          </div>
          <div className="profile-stat-label">胜率</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-num" style={{ color: 'var(--c-gold-300)' }}>{digs}</div>
          <div className="profile-stat-label">挖底</div>
        </div>
      </section>

      {/* 资产卡：金币 + 星币。
          本项目不做充值，所以原来的「+ 充值」换成「赚金币」（去活动页签到/看广告）。 */}
      <section className="profile-assets">
        <div className="profile-asset">
          <div className="profile-asset-icon"><CoinIcon size={20} /></div>
          <div className="profile-asset-num">{coins.toLocaleString()}</div>
          <div className="profile-asset-label">金币</div>
        </div>
        <div className="profile-asset">
          <div className="profile-asset-icon"><StarIcon size={20} /></div>
          <div className="profile-asset-num">{stars.toLocaleString()}</div>
          <div className="profile-asset-label">星币</div>
        </div>
        <button
          className="profile-asset-recharge"
          onClick={() => {
            if (onEarnCoins) onEarnCoins();
            else showToast('去「活动」签到、看广告都能领金币', 'info');
          }}
        >赚金币</button>
      </section>

      {/* 快捷功能 */}
      <section className="profile-quick-grid">
        <button className="profile-quick-btn" onClick={() => setShowAchievements(true)}>
          <span className="profile-quick-icon"><TrophyIcon size={22} tone="gold" /></span>
          <span className="profile-quick-label">成就</span>
          <span className="profile-quick-badge">{achievements.filter(a => a.done).length}/{achievements.length}</span>
        </button>
        <button className="profile-quick-btn" onClick={() => setShowSettings(true)}>
          <span className="profile-quick-icon"><SettingsIcon size={22} tone="gold" /></span>
          <span className="profile-quick-label">设置</span>
        </button>
        <button className="profile-quick-btn" onClick={onOpenRules}>
          <span className="profile-quick-icon"><InfoIcon size={22} tone="gold" /></span>
          <span className="profile-quick-label">规则</span>
        </button>
        <button className="profile-quick-btn" onClick={onLogout}>
          <span className="profile-quick-icon"><DoorIcon size={22} tone="red" /></span>
          <span className="profile-quick-label">退出</span>
        </button>
      </section>

      {/* 最近战绩 */}
      <section className="profile-section">
        <div className="profile-section-title">最近战绩</div>
        {history.length === 0 ? (
          <div className="profile-empty">
            <TrophyIcon size={36} tone="mute" />
            <div>暂无战绩</div>
            <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>打完几局自动记录</div>
          </div>
        ) : (
          <ul className="profile-history">
            {history.map(r => (
              <li key={r.id}>
                <span className={`profile-history-result ${r.iWon ? 'win' : 'lose'}`}>
                  {r.iWon ? `+${r.scoreDelta}` : r.scoreDelta}
                </span>
                <span className="profile-history-mode">{getModeLabel(r.modeId) ?? '未知模式'}</span>
                <span className="profile-history-level">{r.level}级</span>
                <span className="profile-history-time">{timeAgo(r.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 设置抽屉：此前所有开关/条目都是纯装饰，点了没反应 */}
      {showSettings && (
        <div className="profile-modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="profile-modal" onClick={e => e.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>设置</h3>
              <button onClick={() => setShowSettings(false)}><CloseIcon size={18} /></button>
            </div>
            <ul className="profile-settings">
              <li onClick={toggleSound} style={{ cursor: 'pointer' }}>
                <span>声音</span>
                <span className={`toggle ${soundOn ? 'on' : ''}`}>
                  <span className="toggle-knob" />
                </span>
              </li>
              <li onClick={toggleVibrate} style={{ cursor: 'pointer' }}>
                <span>震动反馈</span>
                <span className={`toggle ${vibrateOn ? 'on' : ''}`}>
                  <span className="toggle-knob" />
                </span>
              </li>
              <li onClick={toggleFourColor} style={{ cursor: 'pointer' }}>
                <span>四色牌<small style={{ display: 'block', color: 'var(--c-text-dim)', fontSize: 11 }}>把梅花变绿、方块变蓝。默认关闭（传统红黑）</small></span>
                <span className={`toggle ${fourColor ? 'on' : ''}`}>
                  <span className="toggle-knob" />
                </span>
              </li>
              <li onClick={cycleCardBack} style={{ cursor: 'pointer' }}>
                <span>牌背样式</span>
                <span className="select">{cardBack} <span style={{ color: 'var(--c-text-dim)' }}>▸</span></span>
              </li>
              <li onClick={() => showToast('目前仅支持简体中文', 'info')} style={{ cursor: 'pointer' }}>
                <span>语言</span>
                <span className="select">简体中文 <span style={{ color: 'var(--c-text-dim)' }}>▸</span></span>
              </li>
              <li onClick={() => { setShowSettings(false); onOpenRules(); }} style={{ cursor: 'pointer' }}>
                <span>玩法说明</span>
                <span style={{ color: 'var(--c-text-dim)' }}>▸</span>
              </li>
              <li onClick={() => setShowAbout(true)} style={{ cursor: 'pointer' }}>
                <span>关于</span>
                <span className="select">{APP_VERSION} <span style={{ color: 'var(--c-text-dim)' }}>▸</span></span>
              </li>
              <li onClick={() => { setShowSettings(false); onLogout(); }} style={{ cursor: 'pointer' }}>
                <span className="is-danger">退出登录</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* 关于 */}
      {showAbout && (
        <div className="profile-modal-backdrop" onClick={() => setShowAbout(false)}>
          <div className="profile-modal" onClick={e => e.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>关于</h3>
              <button onClick={() => setShowAbout(false)}><CloseIcon size={18} /></button>
            </div>
            <ul className="profile-settings">
              <li><span>游戏名称</span><span className="select">梅州五华天王升级</span></li>
              <li><span>版本</span><span className="select">{APP_VERSION}</span></li>
              <li><span>支持模式</span><span className="select">3-6 人 · 两副 / 三副</span></li>
              <li onClick={() => setLegalDoc('terms')} style={{ cursor: 'pointer' }}>
                <span>用户协议</span><span style={{ color: 'var(--c-text-dim)' }}>▸</span>
              </li>
              <li onClick={() => setLegalDoc('privacy')} style={{ cursor: 'pointer' }}>
                <span>隐私政策</span><span style={{ color: 'var(--c-text-dim)' }}>▸</span>
              </li>
            </ul>
            <div style={{ padding: '10px 4px 0', fontSize: 12, color: 'var(--c-text-dim)', lineHeight: 1.7 }}>
              本游戏仅供娱乐，不涉及任何形式的赌博或现金交易。
            </div>
          </div>
        </div>
      )}

      {legalDoc && <LegalDocModal doc={legalDoc} onClose={() => setLegalDoc(null)} />}

      {/* 成就抽屉 */}
      {showAchievements && (
        <div className="profile-modal-backdrop" onClick={() => setShowAchievements(false)}>
          <div className="profile-modal" onClick={e => e.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>成就墙</h3>
              <button onClick={() => setShowAchievements(false)}><CloseIcon size={18} /></button>
            </div>
            <div className="profile-achievements">
              {achievements.map(a => (
                <div key={a.id} className={`profile-achievement ${a.done ? 'is-done' : 'is-locked'}`}>
                  <div className="profile-achievement-icon">{a.icon}</div>
                  <div className="profile-achievement-text">
                    <div className="profile-achievement-name">{a.name}</div>
                    <div className="profile-achievement-desc">{a.desc}</div>
                  </div>
                  {a.done && <span className="chip chip-gold">已达成</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
