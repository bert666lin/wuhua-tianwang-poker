// ===== 房间列表 v3 =====
// 模式筛选 + 状态筛选 + 房间卡列表

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  CloseIcon, RefreshIcon, SearchIcon, FilterIcon, DoorIcon,
  UserIcon, CoinIcon, GamepadIcon, SpadeIcon,
} from '../components/icons';
import { rankOf } from '../utils/rank';
// 地址口径统一走 utils/api（那里已处理线上 /api 前缀与 vite dev 的 :2567 回退），
// 之前这里自己复制了一份 inferApiBase，两边一改一漏就会连错后端。
import { API_BASE } from '../utils/api';
import '../styles/rooms.css';

interface RoomsProps {
  onClose: () => void;
  onJoinRoom: (roomCode: string) => void;
  onCreateRoom: () => void;
}

type ModeFilter = 'all' | '3-2' | '3-3' | '4-2' | '4-3' | '5-3' | '6-3';
type StatusFilter = 'all' | 'waiting' | 'playing';

const MODES = [
  { id: 'all' as ModeFilter, label: '全部' },
  { id: '3-2' as ModeFilter, label: '3人 2副' },
  { id: '3-3' as ModeFilter, label: '3人 3副' },
  { id: '4-2' as ModeFilter, label: '4人 2副' },
  { id: '4-3' as ModeFilter, label: '4人 3副' },
  { id: '5-3' as ModeFilter, label: '5人 3副' },
  { id: '6-3' as ModeFilter, label: '6人 3副' },
];

/** 服务端 modeId -> 筛选键 / 展示文案 */
const MODE_META: Record<string, { filter: ModeFilter; label: string }> = {
  threePlayerTwoDecks:   { filter: '3-2', label: '3人 2副' },
  threePlayerThreeDecks: { filter: '3-3', label: '3人 3副' },
  fourPlayerTwoDecks:    { filter: '4-2', label: '4人 2副' },
  fourPlayerThreeDecks:  { filter: '4-3', label: '4人 3副' },
  fivePlayerThreeDecks:  { filter: '5-3', label: '5人 3副' },
  sixPlayerThreeDecks:   { filter: '6-3', label: '6人 3副' },
};

/** 后端 /rooms 返回的原始房间 */
interface ApiRoom {
  roomId: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  modeId: string | null;
  playerCount: number | null;
  phase: string | null;
  hostName: string;
  hostScore: number;
  deckCount: number | null;
  /** 房内真人数（服务端已过滤掉纯 AI 空房，这里只用于展示）。 */
  humanCount: number | null;
  /** 是不是房卡局（朋友局，不输赢金币）。 */
  isCardRoom?: boolean;
}

const STATUSES = [
  { id: 'all' as StatusFilter, label: '全部' },
  { id: 'waiting' as StatusFilter, label: '空闲中' },
  { id: 'playing' as StatusFilter, label: '对战中' },
];

interface Room {
  id: string; code: string; mode: string; modeId: string;
  status: 'waiting' | 'playing';
  players: number; total: number; humans: number | null;
  host: string; hostRank: string; hostRankCls: string;
  decks: number | null; fast: boolean; joinable: boolean;
  /**
   * 房卡局标记。
   *
   * 必须在列表上就标出来：玩家选房时最关心的就是「进去会不会输钱」，
   * 进去才发现是哪种局就太晚了。
   */
  isCardRoom: boolean;
}

/** API 房间 -> 列表卡片数据 */
function toRoom(api: ApiRoom): Room {
  const meta = api.modeId ? MODE_META[api.modeId] : undefined;
  const total = api.playerCount ?? api.maxClients;
  const waiting = api.phase === 'waiting' || api.phase === null;
  return {
    id: api.roomId,
    code: api.roomId,
    mode: meta?.label ?? `${total}人`,
    modeId: meta?.filter ?? 'all',
    status: waiting ? 'waiting' : 'playing',
    players: api.clients,
    total,
    humans: api.humanCount,
    host: api.hostName || '房主',
    // 段位按房主真实积分换算（服务端 metadata.hostScore）
    hostRank: rankOf(api.hostScore ?? 0).name,
    hostRankCls: rankOf(api.hostScore ?? 0).cls,
    // 服务端没有「倍数」概念，改显示真实副数
    decks: api.deckCount,
    fast: waiting && api.clients < total,
    // 只有「未开局 且 未满」才真的能进：
    // 开局后中途加入和满员都会被服务端直接 leave(4000)。
    joinable: waiting && api.clients < total,
    isCardRoom: !!api.isCardRoom,
  };
}

export function Rooms({ onClose, onJoinRoom, onCreateRoom }: RoomsProps) {
  const [mode, setMode] = useState<ModeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadError, setLoadError] = useState('');

  const loadRooms = useCallback(async () => {
    setRefreshing(true);
    setLoadError('');
    try {
      const resp = await fetch(`${API_BASE}/api/rooms`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data?.success) throw new Error(data?.error || '接口返回失败');
      setRooms((data.rooms as ApiRoom[]).map(toRoom));
    } catch (e: any) {
      setRooms([]);
      setLoadError(`房间列表加载失败：${e?.message || String(e)}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // 首次进入拉一次，之后每 5 秒自动刷新
  useEffect(() => {
    loadRooms();
    const id = setInterval(loadRooms, 5000);
    return () => clearInterval(id);
  }, [loadRooms]);

  const filtered = useMemo(() => {
    return rooms.filter(r => {
      if (mode !== 'all' && r.modeId !== mode) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (search && !r.code.toLowerCase().includes(search.toLowerCase()) && !r.host.includes(search)) return false;
      return true;
    });
  }, [rooms, mode, status, search]);

  const handleRefresh = () => { loadRooms(); };

  return (
    <div className="rooms-root">
      {/* 顶 HUD */}
      <header className="rooms-hud">
        <button className="rooms-back" onClick={onClose} aria-label="返回">
          <CloseIcon size={18} tone="gold" />
        </button>
        <h1 className="rooms-title">房间列表</h1>
        <button className="rooms-refresh" onClick={handleRefresh} aria-label="刷新">
          <RefreshIcon size={18} color={refreshing ? 'var(--c-gold-300)' : 'var(--c-text-mute)'} className={refreshing ? 'is-spin' : ''} />
        </button>
      </header>

      {/* 搜索 + 创建 */}
      <div className="rooms-toolbar">
        <div className="rooms-search">
          <SearchIcon size={16} tone="mute" />
          <input
            placeholder="搜索房间号或房主"
            value={search}
            inputMode="numeric"
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button className="rooms-create-btn" onClick={onCreateRoom}>
          <GamepadIcon size={16} tone="dark" />
          <span>自建</span>
        </button>
      </div>

      {/* 筛选：模式 */}
      <div className="rooms-filter-row">
        <span className="rooms-filter-label"><FilterIcon size={12} /> 模式</span>
        <div className="rooms-filter-list">
          {MODES.map(m => (
            <button
              key={m.id}
              className={`rooms-chip ${mode === m.id ? 'is-active' : ''}`}
              onClick={() => setMode(m.id)}
            >{m.label}</button>
          ))}
        </div>
      </div>

      {/* 筛选：状态 */}
      <div className="rooms-filter-row">
        <span className="rooms-filter-label">状态</span>
        <div className="rooms-filter-list">
          {STATUSES.map(s => (
            <button
              key={s.id}
              className={`rooms-chip ${status === s.id ? 'is-active' : ''}`}
              onClick={() => setStatus(s.id)}
            >{s.label}</button>
          ))}
        </div>
      </div>

      {/* 房间列表 */}
      <div className="rooms-list">
        {filtered.length === 0 ? (
          <div className="rooms-empty">
            <DoorIcon size={48} tone="mute" />
            <div>{loadError || (refreshing ? '正在加载房间…' : '现在没有可加入的房间')}</div>
            {!loadError && !refreshing && (
              <div className="rooms-empty-hint">
                列表只显示「还没开局、还有空位」的房；已开局和满员的房进不去，就不摆在这里了。
              </div>
            )}
            <button className="rooms-empty-btn" onClick={onCreateRoom}>自建一个房间</button>
          </div>
        ) : (
          filtered.map(r => {
            const isFull = r.players >= r.total;
            return (
              <div key={r.id} className={`rooms-card ${r.status === 'playing' ? 'is-playing' : ''} ${isFull ? 'is-full' : ''}`}>
                <div className="rooms-card-left">
                  <div className="rooms-card-code">{r.code}</div>
                  <div className="rooms-card-mode">
                    <SpadeIcon size={11} tone="gold" />
                    <span>{r.mode}</span>
                  </div>
                  <div className="rooms-card-host">
                    <UserIcon size={11} tone="mute" />
                    <span>{r.host}</span>
                    <span className={`rooms-card-rank ${r.hostRankCls}`}>{r.hostRank}</span>
                    {/* 真人数：桌上有几个活人，比「3/4」更能决定要不要进 */}
                    {r.humans !== null && (
                      <span className="rooms-card-humans">真人 {r.humans}</span>
                    )}
                  </div>
                </div>

                <div className="rooms-card-mid">
                  <div className="rooms-card-seats">
                    {Array.from({ length: r.total }).map((_, i) => (
                      <span key={i} className={`rooms-card-seat ${i < r.players ? 'is-on' : ''}`} />
                    ))}
                  </div>
                  <div className="rooms-card-count">
                    {r.players}<span style={{ opacity: 0.5 }}>/{r.total}</span>
                  </div>
                  {r.decks !== null && (
                    <div className="rooms-card-stake">
                      <CoinIcon size={11} tone="gold" />
                      <span className="text-gold">{r.decks}副</span>
                    </div>
                  )}
                </div>

                <div className="rooms-card-right">
                  {/* 房卡局标签：比「快」更重要（关系到会不会输钱），所以排在前面 */}
                  {r.isCardRoom && <div className="rooms-card-tag is-friend" title="房卡局：不输赢金币，只算级别和战绩">朋友局</div>}
                  {r.fast && <div className="rooms-card-tag is-fast">快</div>}
                  <div className={`rooms-card-status ${r.status}`}>{r.status === 'waiting' ? '空闲' : '对战中'}</div>
                  {/* 服务端不支持观战，中途加入和满员都会被直接 leave(4000)，
                      所以这两种房间一律禁用按钮，不给用户一个点了没反应的入口。 */}
                  <button
                    className={`rooms-card-btn ${r.status === 'playing' ? 'is-spectate' : ''}`}
                    onClick={() => { if (r.joinable) onJoinRoom(r.code); }}
                    disabled={!r.joinable}
                    title={
                      r.joinable ? '加入这个房间'
                        : r.status === 'playing' ? '牌局已开始，暂不支持观战'
                          : '房间已满'
                    }
                  >
                    {r.joinable ? '加入' : r.status === 'playing' ? '对战中' : '已满'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
