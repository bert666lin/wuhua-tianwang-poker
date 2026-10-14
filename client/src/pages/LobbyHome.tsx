// ===== 大厅主视图（play 标签页的内容） =====
// 从 Lobby.tsx 抽出（原文件 1503 行）。这一块只吃 props、不碰全局状态，
// 是继两个弹窗之后第二个干净的切割点：顶栏、左入口、中央经典卡、
// 右侧 2x2 模式卡、底部快速开始都在这里，改版式不用动主文件的状态逻辑。

import { useEffect } from 'react';
import {
  BoltIcon, CartIcon, CrownIcon, GiftIcon, HistoryIcon,
  PlusIcon, RedPacketIcon, ShareIcon, TrophyIcon, UserIcon,
} from '../components/icons';
import type { LobbyStats } from '../utils/api';
import { sound } from '../utils/sound';
import { showToast } from '../utils/toast';
import { modeLabelWithDeck, peopleText, type Tab } from './lobbyConfig';

// ============================================================
//  大厅主视图
// ============================================================
export interface LobbyHomeProps {
  loading: boolean;
  /** 浏览器判定当前没有网络：入口按钮要禁掉并说明原因 */
  offline: boolean;
  modeId: string;
  setModeId: (id: string) => void;
  onTab: (tab: Tab) => void;
  onMatch: (modeId?: string) => void;
  initialRoomCode?: string | null;
  onEnterClassic: () => void;
  onEnterDeckMode: (deckCount: 2 | 3) => void;
  onFreeCoin: () => void;
  onWelfare: () => void;
  onActivity: () => void;
  onOpenVip: () => void;
  /** 打开房间列表：本轮把「好友」入口换成了它（放在「加入房间」旁边）。 */
  onOpenRooms: () => void;
  onOpenCreate: () => void;
  onOpenJoin: () => void;
  /** 外部（如房间列表的「自建」）请求打开建房弹窗。 */
  createRequestKey: number;
  /** 真实在线人数/可加入房数；拉不到时为 null（卡上就不显示这行）。 */
  stats: LobbyStats | null;
  /** 底部「分享」圆钮：打开分享面板（分享可领金币）。 */
  onShare: () => void;
}

export function LobbyHome({
  loading, offline, modeId, setModeId, onTab: _onTab, onMatch,
  initialRoomCode,
  onEnterClassic, onEnterDeckMode, onFreeCoin, onWelfare, onActivity,
  onOpenVip, onOpenRooms, onOpenCreate, onOpenJoin, createRequestKey, stats,
  onShare,
}: LobbyHomeProps) {


  // 房间列表点「自建」会 +1，通知父组件弹建房弹窗
  useEffect(() => {
    if (createRequestKey > 0) onOpenCreate();
  }, [createRequestKey, onOpenCreate]);

  // 好友点邀请链接进来时，通知父组件弹加入房间
  useEffect(() => {
    if (initialRoomCode) onOpenJoin();
  }, [initialRoomCode, onOpenJoin]);

  // 带副数的模式名（为什么必须带、为什么不能加「· 经典」见 lobbyConfig）
  const currentModeLabel = modeLabelWithDeck(modeId);

  // 右侧 4 个模式卡
  const rightCards = [
    {
      id: 'three-decks',
      tag: '',
      tagCls: '',
      title: '三副牌',
      sub: '',
      people: peopleText(stats?.byDeck['3']),
      modeId: 'fourPlayerThreeDecks',
      onClick: () => { sound.click(); setModeId('fourPlayerThreeDecks'); onEnterDeckMode(3); },
      topIcon: 'cards',
      layout: 'deck', // 大字大图标居中排版
    },
    {
      id: 'create-room',
      tag: '',
      tagCls: '',
      title: '建房',
      sub: '创建房间 · 邀请好友',
      people: stats ? `${stats.waitingRooms} 个房间可加入` : '',
      onClick: () => onOpenCreate(),
      topIcon: 'avatars-plus',
    },
    {
      id: 'two-decks',
      tag: '',
      tagCls: '',
      title: '两副牌',
      sub: '',
      people: peopleText(stats?.byDeck['2']),
      modeId: 'fourPlayerTwoDecks',
      onClick: () => { sound.click(); setModeId('fourPlayerTwoDecks'); onEnterDeckMode(2); },
      topIcon: 'cards-two',
      layout: 'deck', // 大字大图标居中排版
    },
    {
      id: 'competition',
      // 「即将上线」徽章由 .lobby-mode-card--soon::before 渲染，这里不再重复挂 tag
      tag: '',
      tagCls: '',
      title: '比赛场',
      sub: '每日开赛 · 赢实物',
      people: '',
      soon: true,
      // 比赛场按用户决定「后面做」，这里明确告知而不是点了没反应
      onClick: () => showToast('比赛场还在筹备，先去经典场练手吧', 'info'),
      topIcon: 'treasure',
    },
  ];

  // 底部圆钮。
  // 原来这里有「好友」——但没有好友系统，点开只是个"复制邀请链接"弹窗，
  // 名不副实。好友本轮整体去掉，位置换成「战绩」（真实数据、常用）。
  // 房间列表入口按用户要求放到下方「加入房间」旁边，两个进房动作挨在一起。
  // 「我的」已移到左上角头像（点昵称就进），这里的位置让给「分享」——
  // 分享能领金币，是实际会反复点的入口，比重复放「我的」有用。
  const circleButtons = [
    { label: '商城',   icon: CartIcon,    onClick: () => _onTab('shop'),    chipClass: 'icon-chip--shop' },
    { label: '会员',   icon: CrownIcon,   onClick: onOpenVip,               chipClass: 'icon-chip--vip' },
    { label: '活动',   icon: BoltIcon,    onClick: onActivity,              chipClass: 'icon-chip--event' },
    { label: '排行榜', icon: TrophyIcon,  onClick: () => _onTab('rank'),    chipClass: 'icon-chip--rank' },
    { label: '战绩',   icon: HistoryIcon, onClick: () => _onTab('records'), chipClass: 'icon-chip--friends' },
    { label: '分享',   icon: ShareIcon,   onClick: onShare,                 chipClass: 'icon-chip--share' },
  ];

  return (
    <div className="lobby-view">
      <div className="lobby-content">
        {/* 左侧快捷入口 */}
        <div className="lobby-side-entries">
          <div className="lobby-side-entry" onClick={onFreeCoin}>
            <div className="lobby-side-entry-icon icon-chip icon-chip--gift">
              <GiftIcon size={30} />
            </div>
            <span className="lobby-side-entry-label">免费领豆</span>
          </div>
          <div className="lobby-side-entry" onClick={onWelfare}>
            <div className="lobby-side-entry-icon icon-chip icon-chip--redpacket">
              <RedPacketIcon size={30} />
            </div>
            <span className="lobby-side-entry-label">独家福利</span>
          </div>
        </div>

        {/* 中央主视觉：Logo */}
        <div className="lobby-center-group">
          <div className="lobby-hero">
            <img src="/assets/ui/logo-main.webp" alt="五华天王" className="lobby-hero-logo" />
          </div>
        </div>

        {/* 右侧模式卡：经典卡(跨两行) + 2x2 模式卡 */}
        <div className="lobby-mode-grid">
          {/* 经典卡 — 占两行，与右侧两卡自然对齐 */}
          <div className="lobby-classic-card lobby-classic-card--grid" onClick={() => { sound.play(); onEnterClassic(); }}>
            <img src="/assets/ui/ip-classic-x.webp" alt="经典" className="lobby-classic-card-img" />
            <div className="lobby-classic-card-label">
              <div className="lobby-classic-card-sub">4人 · 三副牌</div>
              <div className="lobby-classic-card-title">经典</div>
            </div>
          </div>
          {rightCards.map(card => (
            <div
              key={card.id}
              className={`lobby-mode-card ${card.soon ? 'lobby-mode-card--soon' : ''} ${card.layout === 'deck' ? 'lobby-mode-card--deck' : ''}`}
              onClick={card.onClick}
            >
              {/* 「即将上线」用真实节点渲染：这张卡的 ::before/::after 已经被
                  卡片底色渐变和禁用蒙层占用，再拿伪元素做徽章会互相覆盖。 */}
              {card.soon && <span className="lobby-mode-soon-badge">即将上线</span>}
              {card.tag && <span className={`lobby-mode-tag ${card.tagCls}`}>{card.tag}</span>}
              <div className="lobby-mode-top-icon">
                {card.topIcon === 'cards' && (
                  <div className="mode-cards-icon">
                    <div className="mode-card mode-card-1" />
                    <div className="mode-card mode-card-2" />
                  </div>
                )}
                {card.topIcon === 'cards-two' && (
                  <div className="mode-cards-icon two-decks">
                    <div className="mode-card mode-card-1" />
                    <div className="mode-card mode-card-2" />
                  </div>
                )}
                {card.topIcon === 'avatars-plus' && (
                  <div className="mode-avatars">
                    <span className="mode-avatar mode-avatar--yellow"><UserIcon size={12} color="#fff" /></span>
                    <span className="mode-avatar mode-avatar--red"><UserIcon size={12} color="#fff" /></span>
                    <span className="mode-avatar mode-avatar--teal mode-avatar--plus"><PlusIcon size={12} color="#fff" /></span>
                  </div>
                )}
                {card.topIcon === 'avatars-3' && (
                  <div className="mode-avatars">
                    <span className="mode-avatar mode-avatar--yellow" />
                    <span className="mode-avatar mode-avatar--red" />
                    <span className="mode-avatar mode-avatar--blue" />
                  </div>
                )}
                {card.topIcon === 'treasure' && (
                  <div className="mode-treasure">
                    <span className="treasure-coin" />
                    <span className="treasure-gem" />
                    <span className="treasure-redpacket" />
                  </div>
                )}
              </div>
              <div className="lobby-mode-title">{card.title}</div>
              <div className="lobby-mode-sub">{card.sub}</div>
              {card.people && <div className="lobby-mode-people">{card.people}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* 底部：左圆钮 + 右快速开始 */}
      <div className="lobby-bottom">
        <div className="lobby-circle-nav">
          {circleButtons.map((item, i) => {
            const Icon = item.icon;
            return (
              <div key={i} className="lobby-circle-btn" onClick={() => { sound.click(); item.onClick(); }}>
                <div className={`lobby-circle-icon icon-chip ${item.chipClass || ''}`}>
                  <Icon size={26} />
                </div>
                <span className="lobby-circle-label">{item.label}</span>
              </div>
            );
          })}
        </div>
        {/* 断网横幅：按钮同时会被禁掉，但必须同时说明「为什么点不动」，
            否则玩家只会觉得是游戏坏了。 */}
        {offline && (
          <div className="lobby-offline-banner" role="status">
            <span className="lobby-offline-dot" aria-hidden="true" />
            当前无网络连接，请检查 Wi-Fi 或移动数据
          </div>
        )}
        <div className="lobby-bottom-actions">
          {/* 房间列表与加入房间是同一类动作（都是进别人的房），放在一起才顺手 */}
          <div className="lobby-friend-actions" role="group" aria-label="好友房">
            <span className="lobby-friend-label">好友房</span>
            <button
              className="lobby-join-btn lobby-join-btn--rooms"
              onClick={() => { sound.click(); onOpenRooms(); }}
              disabled={loading || offline}
            >
              房间列表
            </button>
            <button
              className="lobby-join-btn"
              onClick={() => { sound.click(); onOpenJoin(); }}
              disabled={loading || offline}
            >
              加入房间
            </button>
          </div>
          {/* 三种状态各有各的文案：断网说没网、进行中说正在进入、
              平时才显示模式名 —— 连点的根因就是「点了没有任何变化」。 */}
          <button
            className="lobby-quick-btn lobby-primary-action"
            onClick={() => { sound.play(); onMatch(modeId); }}
            disabled={loading || offline}
            aria-busy={loading}
          >
            {offline ? (
              <span className="quick-btn-main">无网络连接</span>
            ) : loading ? (
              <span className="quick-btn-main">正在进入…</span>
            ) : (
              <>
                <span className="quick-btn-prefix">{currentModeLabel}</span>
                <span className="quick-btn-main">快速开始</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 弹窗 */}

    </div>
  );
}
