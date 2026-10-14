// ===== 大厅弹窗：自建房 / 加入房间 =====
// 从 Lobby.tsx 抽出（原文件 1503 行）。这两个弹窗自成闭环、只靠 props 通信，
// 是最干净的切割点：搬出来后 Lobby.tsx 少了 220 多行，
// 改建房选项时也不用在主文件里翻。

import { useState, useEffect } from 'react';
import { CloseIcon } from '../components/icons';
import {
  normalizeRoomCode, sanitizeRoomCodeInput, ROOM_CODE_LENGTH, ROOM_CODE_HINT,
} from '../utils/roomInvite';
import { MODES } from './lobbyConfig';

// ============================================================
//  自建房弹窗
// ============================================================
export function CreateRoomModal({
  open, onClose, onCreate, modeId, roomCards, tierName, tierEntry,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (customRoomId: string | undefined, aiCount: number, modeId: string, cardRoom: boolean) => void;
  modeId: string;
  /** 我手里的房卡数，为 0 时把房卡局选项置灰 */
  roomCards: number;
  /** 当前场次名与入场门槛，用于说清两种局的区别 */
  tierName: string;
  tierEntry: number;
}) {
  const [roomId, setRoomId] = useState('');
  const [err, setErr] = useState('');
  const [selectedModeId, setSelectedModeId] = useState(modeId);
  const currentMode = MODES.find(m => m.id === selectedModeId) ?? MODES[0];
  const [aiCount, setAiCount] = useState(0);
  /** 房卡局（朋友局）：扣房主一张房卡，整桌不输赢金币，只算级别与战绩。 */
  const [cardRoom, setCardRoom] = useState(false);

  // 每次打开都同步大厅当前模式；默认 0 个 AI，先留给好友进房。
  useEffect(() => {
    if (open) {
      setSelectedModeId(modeId);
      setAiCount(0);
      // 默认不勾房卡局：扣卡是花钱的动作，不能默认帮用户花
      setCardRoom(false);
      setErr('');
    }
  }, [open, modeId]);

  if (!open) return null;

  const handleSubmit = () => {
    const normalized = normalizeRoomCode(roomId);
    if (roomId.trim() && !normalized) {
      setErr(`房间号需 ${ROOM_CODE_HINT}（首位不能是 0）`);
      return;
    }
    if (cardRoom && roomCards < 1) {
      setErr('房卡不足，去商城用金币兑换或到活动页领每日免费房卡');
      return;
    }
    setErr('');
    onCreate(normalized ?? undefined, Math.min(aiCount, currentMode.players - 1), selectedModeId, cardRoom);
    onClose();
  };

  return (
    <div className="lobby-modal-mask" onClick={onClose}>
      <div className="lobby-modal lobby-modal--create" onClick={e => e.stopPropagation()}>
        <button className="lobby-modal-close" onClick={onClose} aria-label="关闭">
          <CloseIcon size={16} />
        </button>
        <div className="lobby-modal-title">创建房间</div>

        {/* 表单体单独包一层：手机横屏可用高只有 ~390px，竖着排三组表单必然
            顶满屏。这一层在横屏下变成两列 grid（左：模式 / 右：AI+房间号），
            高度立刻砍掉近一半，标题和底部按钮仍横跨整宽。 */}
        <div className="lobby-modal-body">
        <div className="lobby-modal-field">
          <label className="lobby-modal-label">房间模式</label>
          <div className="lobby-mode-selector">
            {MODES.map(mode => (
              <button
                key={mode.id}
                type="button"
                className={`lobby-mode-option ${selectedModeId === mode.id ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedModeId(mode.id);
                  setAiCount(0);
                }}
              >
                <span className="lobby-mode-option-name">{mode.label}</span>
                <span className="lobby-mode-option-deck">{mode.deck}</span>
              </button>
            ))}
          </div>
          <div className="lobby-modal-hint">当前选择：{currentMode.label} {currentMode.deck} · {currentMode.sub}</div>
        </div>

        <div className="lobby-modal-field">
          <label className="lobby-modal-label">AI 数量（可选，好友进来前可先占座）</label>
          <div className="lobby-ai-selector">
            {Array.from({ length: currentMode.players }).map((_, i) => (
              <button
                key={i}
                className={`lobby-ai-chip ${aiCount === i ? 'is-active' : ''}`}
                onClick={() => setAiCount(i)}
              >{i}个</button>
            ))}
          </div>
        </div>

        <div className="lobby-modal-field">
          <label className="lobby-modal-label">房间号（自定义，可选）</label>
          <input
            className="lobby-modal-input"
            value={roomId}
            placeholder="留空随机分配"
            inputMode="numeric"
            onChange={e => setRoomId(sanitizeRoomCodeInput(e.target.value))}
            maxLength={ROOM_CODE_LENGTH}
          />
          <div className="lobby-modal-hint">{ROOM_CODE_HINT}，首位不能是 0；报给朋友好念</div>
        </div>

        {/* 房卡局（朋友局）开关。
            为什么要把区别写清楚：两种局的钱包后果完全不同，
            玩家必须在点“创建”之前就知道自己选的是哪种。 */}
        <div className="lobby-modal-field lobby-modal-field--full">
          <label className="lobby-modal-label">房间类型</label>
          <div className="lobby-roomtype">
            <button
              type="button"
              className={`lobby-roomtype-option ${!cardRoom ? 'is-active' : ''}`}
              onClick={() => setCardRoom(false)}
            >
              <span className="lobby-roomtype-name">金币局</span>
              <span className="lobby-roomtype-sub">{tierName} · 入场 {tierEntry} 金币，输赢真金币</span>
            </button>
            <button
              type="button"
              className={`lobby-roomtype-option ${cardRoom ? 'is-active' : ''} ${roomCards < 1 ? 'is-lack' : ''}`}
              onClick={() => setCardRoom(true)}
            >
              <span className="lobby-roomtype-name">
                房卡局
                <span className="lobby-roomtype-badge">我有 {roomCards} 张</span>
              </span>
              <span className="lobby-roomtype-sub">
                {roomCards < 1
                  ? '房卡不足，去商城兑换或活动页领免费房卡'
                  : '扣你 1 张房卡，全桌不输赢金币，只算级别和战绩'}
              </span>
            </button>
          </div>
        </div>
        </div>

        {err && <div className="lobby-modal-err">{err}</div>}

        <div className="lobby-modal-actions">
          <button className="lobby-modal-btn lobby-modal-btn--ghost" onClick={onClose}>取消</button>
          <button className="lobby-modal-btn lobby-modal-btn--primary" onClick={handleSubmit}>
            {cardRoom ? '用 1 张房卡开房' : '创建并邀请好友'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  加入房间弹窗
// ============================================================
export function JoinRoomModal({
  open, onClose, onJoin, defaultRoomCode,
}: {
  open: boolean;
  onClose: () => void;
  onJoin: (code: string) => void;
  defaultRoomCode?: string | null;
}) {
  const [roomCode, setRoomCode] = useState(defaultRoomCode ?? '');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) {
      setRoomCode(defaultRoomCode ?? '');
      setErr('');
    }
  }, [open, defaultRoomCode]);

  if (!open) return null;

  const handleSubmit = () => {
    const code = normalizeRoomCode(roomCode);
    if (!code) {
      setErr(roomCode.trim() ? `房间号是 ${ROOM_CODE_HINT}，请检查` : '请输入房间号');
      return;
    }
    setErr('');
    onJoin(code);
    onClose();
  };

  return (
    <div className="lobby-modal-mask" onClick={onClose}>
      <div className="lobby-modal" onClick={e => e.stopPropagation()}>
        <button className="lobby-modal-close" onClick={onClose} aria-label="关闭">
          <CloseIcon size={16} />
        </button>
        <div className="lobby-modal-title">加入房间</div>

        <div className="lobby-modal-field">
          <label className="lobby-modal-label">房间号</label>
          <input
            className="lobby-modal-input"
            value={roomCode}
            placeholder={`请输入 ${ROOM_CODE_LENGTH} 位房间号`}
            inputMode="numeric"
            onChange={e => setRoomCode(sanitizeRoomCodeInput(e.target.value))}
            maxLength={ROOM_CODE_LENGTH}
            autoFocus
          />
          <div className="lobby-modal-hint">房间号是 {ROOM_CODE_HINT}，向房主问一下就能进</div>
        </div>

        {err && <div className="lobby-modal-err">{err}</div>}

        <div className="lobby-modal-actions">
          <button className="lobby-modal-btn lobby-modal-btn--ghost" onClick={onClose}>取消</button>
          <button className="lobby-modal-btn lobby-modal-btn--primary" onClick={handleSubmit}>加入房间</button>
        </div>
      </div>
    </div>
  );
}
