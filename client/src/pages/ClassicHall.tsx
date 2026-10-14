// ===== 经典模式场次选择页 =====
// 二级界面：人数切换 + 初/中/高/大师场 + 私人房/快速开始

import { useEffect, useState } from 'react';
import '../styles/classic-hall.css';
import {
  BackIcon,
  SpadeIcon,
  ClubIcon,
  DiamondIcon,
  HeartIcon,
} from '../components/icons';
import { getModeIdForSelection, getModeDealForSelection } from '../utils/modeSelection';
import { showToast } from '../utils/toast';
import { sound } from '../utils/sound';
import { useAccount } from '../hooks/useAccount';

interface ClassicHallProps {
  onBack: () => void;
  /** 快速开始。tier 是场次 id，决定底分与入场门槛。 */
  onQuickStart: (modeId: string, tier: string) => void;
  onCreatePrivate: (modeId: string, tier: string) => void;
  deckCount?: 2 | 3; // 副数：2=两副牌，3=三副牌，不传则是经典模式（按场次分）
  /** 顶栏「反馈」入口。不传时只提示。 */
  onOpenFeedback?: () => void;
}

type PlayerCount = '3' | '4' | '5' | '6';

/**
 * 每个场次的配置。
 *
 * ⚠️ stake/entry 必须与服务端 `server/src/data/economy.ts` 的 ROOM_TIERS 一致，
 * 改一处必须改两处 —— 服务端才是权威（入场门槛与结算都按它算）。
 *
 * 入场门槛 = 底分 × 10，这个比例代表"能连输约 10 把"，
 * 1:1 的话输一把就出局，体验是灾难。
 */
const ROOMS = [
  {
    id: 'easy',
    title: '初级场',
    stake: 100,
    entry: 1_000,
    bg: '/assets/ui/bg-easy.webp',
    cls: 'classic-room-card--easy',
  },
  {
    id: 'mid',
    title: '中级场',
    stake: 500,
    entry: 5_000,
    bg: '/assets/ui/bg-mid.webp',
    cls: 'classic-room-card--mid',
  },
  {
    id: 'high',
    title: '高级场',
    stake: 2_000,
    entry: 20_000,
    bg: '/assets/ui/bg-high.webp',
    cls: 'classic-room-card--high',
  },
  {
    id: 'master',
    title: '大师场',
    stake: 10_000,
    entry: 100_000,
    bg: '/assets/ui/bg-master.webp',
    cls: 'classic-room-card--master',
  },
];

/** 人数选项 */
const PLAYER_OPTIONS = [
  { id: '3' as PlayerCount, label: '三人模式', icon: SpadeIcon },
  { id: '4' as PlayerCount, label: '四人模式', icon: ClubIcon, default: true },
  { id: '5' as PlayerCount, label: '五人模式', icon: DiamondIcon },
  { id: '6' as PlayerCount, label: '六人模式', icon: HeartIcon },
];


export function ClassicHall({
  onBack,
  onQuickStart,
  onCreatePrivate,
  deckCount,
  onOpenFeedback,
}: ClassicHallProps) {
  const [playerCount, setPlayerCount] = useState<PlayerCount>('4');
  // 默认选初级场：新号只有 3000 金币，进不去中级场（门槛 5000），
  // 默认停在进不去的场次会让人一点「快速开始」就被拒，体验很差。
  const [selectedRoom, setSelectedRoom] = useState<string>('easy');
  const { account } = useAccount();
  const myCoins = account?.coins ?? 0;
  /** 金币够不够进这个场次。服务端也会拦，这里只是提前告知，省一次往返。 */
  const canAfford = (roomId: string) => {
    const room = ROOMS.find(r => r.id === roomId);
    return !room || myCoins >= room.entry;
  };
  // 顶栏「经典 / 详细 / 反馈」此前是三个纯装饰 span
  const [headTab, setHeadTab] = useState<'classic' | 'detail'>('classic');

  // 如果指定了副数，所有场次都用这个副数；否则按场次分（经典模式）
  const deckCountForRoom = (roomId: string): 2 | 3 => {
    if (deckCount === 2) return 2;
    if (deckCount === 3) return 3;
    // 经典模式：初级中级2副，高级大师3副
    if (roomId === 'easy' || roomId === 'mid') return 2;
    return 3;
  };

  const selectedDeckCount = deckCountForRoom(selectedRoom);
  // 发牌参数直接取共享表，别在界面上现场算（5人3副取余会算错）
  const deal = getModeDealForSelection(Number(playerCount), selectedDeckCount);

  // 经典模式切到初级/中级（两副牌）时，5/6 人不是合法模式，必须自动回到 4 人。
  useEffect(() => {
    if (!getModeIdForSelection(Number(playerCount), selectedDeckCount)) {
      setPlayerCount('4');
    }
  }, [playerCount, selectedDeckCount]);

  /** 余额不够时挡在前面并说清还差多少，而不是让服务端把人踢出来。 */
  const guardAfford = (): boolean => {
    const room = ROOMS.find(r => r.id === selectedRoom);
    if (!room || myCoins >= room.entry) return true;
    showToast(
      `${room.title}需要 ${room.entry.toLocaleString()} 金币，你还差 ${(room.entry - myCoins).toLocaleString()}`,
      'info',
    );
    return false;
  };

  const handleQuickStart = () => {
    if (!guardAfford()) return;
    const modeId = getModeIdForSelection(Number(playerCount), selectedDeckCount);
    if (modeId) onQuickStart(modeId, selectedRoom);
  };

  const handlePrivateRoom = () => {
    if (!guardAfford()) return;
    const modeId = getModeIdForSelection(Number(playerCount), selectedDeckCount);
    if (modeId) onCreatePrivate(modeId, selectedRoom);
  };

  return (
    <div className="classic-hall">
      {/* 顶部栏 */}
      <header className="classic-hall-header">
        <button className="classic-hall-back" onClick={() => { sound.click(); onBack(); }} aria-label="返回">
          <BackIcon size={18} />
        </button>

        <div className="classic-hall-tabs">
          <button
            type="button"
            className={`classic-hall-tab ${headTab === 'classic' ? 'is-active' : ''}`}
            onClick={() => setHeadTab('classic')}
          >经典</button>
          <button
            type="button"
            className={`classic-hall-tab ${headTab === 'detail' ? 'is-active' : ''}`}
            onClick={() => setHeadTab('detail')}
          >详细</button>
          <button
            type="button"
            className="classic-hall-tab"
            onClick={() => {
              if (onOpenFeedback) onOpenFeedback();
              else showToast('可在「大厅 - 更多 - 客服与反馈」提交反馈', 'info');
            }}
          >反馈</button>
        </div>

      </header>

      {/* 详细：把当前选择的模式参数讲清楚 */}
      {headTab === 'detail' && (
        <div className="classic-hall-detail">
          <div className="classic-hall-detail-title">
            {playerCount} 人 · {selectedDeckCount} 副牌 · {ROOMS.find(r => r.id === selectedRoom)?.title}
          </div>
          <ul className="classic-hall-detail-list">
            <li><span>总牌数</span><strong>{deal?.totalCards ?? '—'} 张</strong></li>
            <li><span>每人手牌</span><strong>{deal?.perPlayer ?? '—'} 张</strong></li>
            <li><span>底牌</span><strong>{deal?.bottomCount ?? '—'} 张</strong></li>
            <li><span>本局总分</span><strong>{deal?.totalScore ?? '—'} 分</strong></li>
            <li><span>底分</span><strong>{(ROOMS.find(r => r.id === selectedRoom)?.stake ?? 0).toLocaleString()} 金币 / 级</strong></li>
            <li><span>入场门槛</span><strong>{(ROOMS.find(r => r.id === selectedRoom)?.entry ?? 0).toLocaleString()} 金币</strong></li>
            <li><span>输赢算法</span><strong>底分 × 升级数（庄家 ×1.5，输家扣 8 折）</strong></li>
            <li><span>挖底</span><strong>闲家用天王/大小王赢下最后一墩即挖底成功</strong></li>
          </ul>
          <div className="classic-hall-detail-note">
            主牌花色由叫分最高者定；常主与大小王恒为主牌，副 2 大于副 A。
          </div>
        </div>
      )}

      {/* 主内容 */}
      <div className="classic-hall-body">
        <div className="classic-hall-content">
          {/* 左：标题 + 人数切换 */}
          <div className="classic-hall-left-col">
            <div className="classic-hall-mode-title">{deckCount === 2 ? '两副牌' : deckCount === 3 ? '三副牌' : '天王升级'}</div>
            <div className="classic-hall-left-hint">选择人数</div>

            <div className="classic-hall-player-tabs">
              {PLAYER_OPTIONS
                .filter(opt => {
                  // 两副牌只有 3/4 人；三副牌和经典高级/大师场才有 5/6 人。
                  if (selectedDeckCount === 2) return opt.id === '3' || opt.id === '4';
                  return true;
                })
                .map(opt => {
                const Icon = opt.icon;
                return (
                  <div
                    key={opt.id}
                    className={`classic-hall-player-tab ${playerCount === opt.id ? 'is-active' : ''}`}
                    onClick={() => { sound.click(); setPlayerCount(opt.id); }}
                  >
                    <span className="classic-hall-player-icon">
                      <Icon size={14} tone={playerCount === opt.id ? 'dark' : 'white'} />
                    </span>
                    <span className="classic-hall-player-label">{opt.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 右：场次卡片 */}
          <div className="classic-hall-right-col">
            <div className="classic-hall-rooms-scroll">
              {ROOMS.map(room => (
                <div
                  key={room.id}
                  className={`classic-room-card ${room.cls} ${selectedRoom === room.id ? 'is-selected' : ''} ${canAfford(room.id) ? '' : 'is-locked'}`}
                  onClick={() => { sound.click(); setSelectedRoom(room.id); }}
                >
                  <div
                    className="classic-room-bg"
                    style={{ backgroundImage: `url(${room.bg})` }}
                  />
                  <div className="classic-room-content">
                    <div className="classic-room-head">
                      <span className="classic-room-title">{room.title}</span>
                      {selectedRoom === room.id && <span className="classic-room-check">已选</span>}
                    </div>
                    <div className="classic-room-stake">
                      <span className="classic-room-stake-label">底分</span>
                      <strong>{formatStake(room.stake)}</strong>
                    </div>
                    {/* 中央留给每个场次自己的底图主视觉，信息统一收到底部。 */}
                    <div className="classic-room-art-space" aria-hidden="true" />
                    <div className="classic-room-meta">
                      <div className="classic-room-meta-row">
                        <span>入场门槛</span>
                        <b>{room.entry.toLocaleString()}</b>
                      </div>
                      <div className="classic-room-meta-row">
                        <span>本局牌型</span>
                        <b>{(() => {
                          const dc = deckCountForRoom(room.id);
                          const d = getModeDealForSelection(Number(playerCount), dc);
                          // 两副牌只支持 3/4 人。5/6 人下这张卡不是"没数据"，
                          // 而是这个人数进不去，直接说清楚而不是显示「—张」。
                          if (!d) return `${dc}副 · 限3/4人`;
                          return `${dc}副 · ${d.perPlayer}张`;
                        })()}</b>
                      </div>
                    </div>
                    <div className="classic-room-footer">
                      {canAfford(room.id)
                        ? <span className="classic-room-people">金币充足 · 可进入</span>
                        : <span className="classic-room-people classic-room-people--locked">
                            还差 {(room.entry - myCoins).toLocaleString()} 金币
                          </span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="classic-hall-actions">
        <button className="classic-hall-btn classic-hall-btn--private" onClick={() => { sound.click(); handlePrivateRoom(); }}>
          私人房
        </button>
        <button className="classic-hall-btn classic-hall-btn--quick" onClick={() => { sound.play(); handleQuickStart(); }}>
          快速开始
        </button>
      </div>
    </div>
  );
}

function formatStake(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString();
}
