// ===== 牌桌 v4 — 五华天王扑克 新UI =====
// 支持多个阶段：叫主 / 扣底 / 对战出牌
import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { opponentPositions as calcOpponentPositions, groupHandCards, type SeatPosition } from './tableV4Layout';
import {
  TRICK_BAND_TOP_U, TRICK_BAND_BOTTOM_U, TRICK_WIDTH_U,
  TRICK_CARD_W_U, TRICK_CARD_H_U, trickCardStep, trickSlotAnchor, trickTagPos,
} from './trickLayout';
import {
  TableMenuPanel, TableRecordsPanel, TableSettingsPanel, TableLeavePanel, type TablePanel,
} from './TableV4Menus';
import { summarizeRoom, type RoundRow, type StandingRow } from '../utils/roomRecord';
import { RulesModal } from './RulesModal';
import { sound } from '../utils/sound';
import { copyText } from '../utils/share';
import { showToast } from '../utils/toast';
import { getCardBack, cardBackTheme, getFourColor, suitClass, suitGlyph, hasSeenVoiceTip, markVoiceTipSeen } from '../utils/preferences';
import type {
  GamePhase, TableV4Player, HandCardData, TrickPlay,
  RecordPlayer, BidEventLike, ChatMessageLike,
} from './tableV4Types';
import { u, ut, btnVars, AVATAR_BG, AVATAR_EMOJI } from './tableV4Style';
import { CardFace } from './CardFace';
import { dealTimeline, DEAL_SORT_MS, DEAL_FLIP_STAGGER_MS } from './dealAnimation';
import '../styles/table-v4.css';

/**
 * 类型与样式工具已分别搬到 tableV4Types.ts / tableV4Style.ts。
 * 这里继续 re-export，老的 `from './TableV4'` 写法不受影响
 * （re-export 类型是安全的；re-export 运行时值会破坏 react-refresh 的组件文件约定，
 * 所以 u/ut/btnVars 这些**不**在这里转出，需要的模块直接从 tableV4Style 引）。
 */
export type { SeatPosition } from './tableV4Layout';
export type {
  GamePhase, TableV4Player, HandCardData, TrickPlay,
  RecordPlayer, BidEventLike, ChatMessageLike,
} from './tableV4Types';

interface TableV4Props {
  phase?: GamePhase;
  mainSuit?: string;         // 主花色 '♠' '♥' '♣' '♦'
  mainRank?: string;         // 主牌点数，如 '7'
  /** 闲家阵营抓分合计（判断能否打倒庄家的依据）。 */
  catchScore?: number;
  /** 庄家杀分合计。 */
  bankerScore?: number;
  callScore?: number;

  players?: TableV4Player[];
  handCards?: HandCardData[];
  selectedIds?: Set<string>;
  onCardToggle?: (card: HandCardData) => void;
  /**
   * 批量改选中集合（框选 / 刷选 / 双击整组 / 清空 都走这里）。
   * 不传时退化为对差集逐张调用 onCardToggle，老调用方不会坏。
   */
  onSelectionChange?: (ids: Set<string>) => void;

  /** 总人数，决定对手方位布局与牌阵位置。 */
  playerCount?: number;

  // 叫主阶段
  bubbleText?: string;
  antiHintText?: string;
  onPass?: () => void;
  onAntiSuit?: (suit: string) => void;

  /** calling 细分：叫主还是叫分。两者操作完全不同，不能共用一套按钮。 */
  callingStage?: 'suit' | 'score';
  /** 我手里有 7、因此可以叫的花色，如 ['♠','♥'] */
  availableSuits?: string[];
  /** 抢主门槛：叫主需要的同花色7张数（1=首家叫主，>1=抢主）。 */
  minSevens?: number;

  // 叫分阶段：需要真正能提交分数，不能只有“不叫”
  bidMin?: number;
  bidMax?: number;
  bidStep?: number;
  /** 是否轮到我叫分/叫主 */
  canBid?: boolean;
  onCallScore?: (score: number) => void;

  // 出牌阶段
  trickCards?: TrickPlay[];   // 当前牌阵中各方向出的牌
  isMyTurn?: boolean;
  mainActionBlocked?: boolean;
  currentTurnSeat?: number;

  // 扣底阶段
  bottomCards?: HandCardData[];
  discardCount?: number;      // 需要扣的张数
  /** 分批扣牌：已放进底牌区的张数 + 取回回调（点底牌区的牌可取回）。 */
  stagedCount?: number;
  onUnstageDiscard?: (cards?: any[]) => void;
  /**
   * 底牌区已经凑够张数，可以确认开打了。
   *
   * 以前凑够就自动开打，庄家误点最后一张牌就永久失去调整机会 ——
   * 底牌决定一整局的缺门布局，扣错一张可能直接输掉。
   * 现在必须显式确认一遍。
   */
  canConfirmDiscard?: boolean;
  onConfirmDiscard?: () => void;
  /**
   * 这一批选多了几张（超出还能扣的数量）。
   * >0 时「放入底牌」放不进去，必须当场说清楚多选了几张 ——
   * 以前这种情况是静默无反应，庄家会以为按钮坏了。
   */
  discardOverflow?: number;

  // 底部
  bottomScore?: number;
  multiplier?: number;
  myName?: string;
  myCoins?: number;
  myRankLabel?: string;

  // 操作
  actionText?: string;
  onAction?: () => void;
  onPassAction?: () => void;
  hintCardIds?: string[];
  /** 提示轮转信息：现在看的是第几套 / 共几套，用于在按钮上给出"还能换"的暗示。 */
  hintInfo?: { seq: number; index: number; total: number } | null;

  /** 出牌提示 / 扣底推荐 */
  onHint?: () => void;
  onDiscardHint?: () => void;
  /** 本回合剩余思考时间的截止时间戳（ms） */
  turnDeadline?: number | null;
  /** 托管状态与收回托管 */
  isTrustee?: boolean;
  onResumeControl?: () => void;
  /** 服务端错误提示 */
  errorText?: string | null;
  /**
   * 掉线重连中：盖一层遮罩告诉玩家「别动，系统在自救」。
   *
   * 没有这层提示时，玩家看到的是牌桌完全静止（牌不动、倒计时不动），
   * 分不清是自己断网、别人在思考、还是游戏卡死 —— 多数人会去杀进程重进，
   * 而重进算主动退出（code 4000），服务端立刻按逃跑罚金。
   * 服务端留了 120 秒重连窗口，这层遮罩就是让玩家愿意把这 120 秒等完。
   */
  isReconnecting?: boolean;
  /**
   * 重连窗口截止时间戳（ms）。用来在遮罩上倒计时：
   * 让玩家知道「还有多久必须回来」，有明确等待预期才愿意把窗口等完。
   */
  reconnectDeadline?: number | null;
  /** 退出房间 */
  onLeave?: () => void;
  /** 聊天 */
  chatMessages?: ChatMessageLike[];
  onChat?: (text: string) => void;

  /**
   * 自己麦克风的实时电平 0~1，用于「按住说话」的音量条。
   * 用真实电平而不是假动画：见 utils/voice.ts 里的说明 ——
   * 假动画证明不了麦克风真的在收音，用户白说一句也看不出来。
   */
  micLevel?: number;

  /** ===== 实时语音（按住说话）=====
   * voiceSupported=false 时整个按钮不渲染（而不是渲染一个点了没反应的按钮）。
   * onVoiceStart 返回 false 表示没能开始（拒授权/无麦克风），UI 据此提示。 */
  voiceSupported?: boolean;
  isTalking?: boolean;
  onVoiceStart?: () => Promise<boolean> | boolean;
  onVoiceStop?: () => void;
  /** 正在说话的玩家 id，座位上显示声波标。 */
  speakingIds?: string[];
  /** 听筒开关：关掉后听不到别人说话（音效不受影响，自己仍能说）。 */
  voiceMuted?: boolean;
  onToggleVoiceMuted?: () => void;
  /** 等待阶段的房主座位管理 */
  isOwner?: boolean;
  seatedCount?: number;
  /** 桌上 AI 数量，决定 −AI 是否可用（真人不该被 −AI 挤掉）。 */
  aiCount?: number;
  onAddAi?: () => void;
  onRemoveAi?: () => void;
  /**
   * 结算面板由外部注入，避免本组件依赖结算数据结构。
   *
   * 可以传节点，也可以传一个函数拿到牌桌的能力（目前只有 requestLeave）。
   * 为什么需要函数式：结算面板底部的「大厅」按钮必须先弹**房间结算清单**，
   * 而清单是牌桌的内部面板（activePanel）—— 外部注入的节点碰不到它。
   * 以前那个按钮就是因为碰不到，才直接调了"离开房间"，
   * 于是「退房要先看结算单」这件事在结算页那条路径上等于没做。
   */
  settlementSlot?: React.ReactNode | ((api: { requestLeave: () => void }) => React.ReactNode);

  /**
   * 发牌动画阶段（来自 useDealAnimation）。
   * 'fly' 牌正飞进手里、'flip' 正在翻开、'sort' 正在理牌位移、'idle' 无动画。
   */
  dealStage?: 'idle' | 'fly' | 'flip' | 'sort';
  /** 动画期间锁住手牌交互，避免动画中途选牌导致选中集合与画面错位。 */
  dealLocked?: boolean;

  /** 甩牌：仅首家可用，服务端做最终判定 */
  onToss?: () => void;
  canToss?: boolean;
  tossHint?: string | null;
  tossNotice?: string | null;

  /**
   * 当前选中牌的牌型标签（'对子' / '拖拉机×3' / '4 张'…）。
   * 由 utils/pattern.ts 的 describeSelection 算，那套判定是服务端
   * identifyCardType 的镜像 —— 客户端标签必须和服务端判定一致，
   * 标得比服务端宽松会让玩家照标签出牌然后被打回，比不标更糟。
   */
  selectedPattern?: string;
  /**
   * 选中的牌是否构成一个「有名字的」牌型（单张/对子/三张/拖拉机/连三张/王组合）。
   * 单独一个布尔而不是在 UI 里正则猜标签文案：文案以后改字就会把判断带崩。
   */
  selectedPatternNamed?: boolean;

  /**
   * 主牌是谁叫的 / 抢的。牌桌顶栏要直接标出来。
   *
   * 之前顶栏只画一个花色符号，玩家打到一半想不起「这主是谁叫的」——
   * 而这直接影响该不该给他喂分。用户明确要求「叫主、抢主、叫分 谁叫 要标明」。
   */
  suitCallerName?: string;
  /** 定主亮了几张 7；0 表示翻底定主。 */
  suitCallerSevens?: number;
  /** 主是不是翻底牌翻出来的（没人叫主）。 */
  suitFromBottom?: boolean;
  /** 经过几次抢主。 */
  suitStealCount?: number;

  /** 顶栏「记录」面板数据 */
  roomId?: string | null;
  bidHistory?: BidEventLike[];
  /** 叫主/抢主/叫分的完整过程（记录面板用，比只有叫分的 bidHistory 完整）。 */
  auctionRows?: { seatIndex: number; playerName: string; text: string; highlight: boolean }[];
  recordPlayers?: RecordPlayer[];
  bankerName?: string;
  mainSuitName?: string;
  bottomCount?: number;

  /** ===== 房间累计战绩 =====
   * 一桌人常连打十几把，"打了几局 / 我几级 / 刚那局谁坐庄"必须随时能查。
   * 数据来自服务端 state（不是广播累积），所以重连和中途加入的人也看得到。 */
  roundsPlayed?: number;
  /** 各家在这张桌子上的累计成绩（已排好序）。 */
  standings?: StandingRow[];
  /** 逐局战果（时间顺序，渲染时倒序显示）。 */
  roundRows?: RoundRow[];
  /**
   * 现在退出会不会被判逃跑（判负扣币 + 罚金）。
   *
   * 为什么不在本组件里用 phase 判断：v4 的 phase 把 settling 也映射成
   * 'playing'（结算面板是盖在牌桌上的 overlay），这里分不出"还在打"和
   * "已经结算完"。结算完退出不该罚，弹罚金警告纯属吓人 ——
   * 所以由拿得到真实阶段的适配器直接告诉牌桌。
   */
  leaveIsEscape?: boolean;
}

/**
 * 按总人数给出对手方位顺序（顺时针，从我的右手边开始）。
 * 索引 = 相对座位 - 1，相对座位 = (绝对座位 - 我的座位 + 人数) % 人数。
 * 人数不在表中时退化为 4 人局布局。
 */
/**
 * 牌阵中各方位打出的牌摆放位置。
 *
 * 几何全部来自 trickLayout.ts（纯函数，有单测保证任意张数下两两不相交）。
 * 这里只把锚点翻译成 CSS —— 千万别再改回写死偏移：一家甩多张时槽位会变宽，
 * 固定偏移必然重叠（用户两次反馈「打出来的牌盖在一起」都是这个原因）。
 */
function trickSlotStyle(pos: SeatPosition): React.CSSProperties {
  const a = trickSlotAnchor(pos);
  const tx = a.translateX ? 'translateX(-50%)' : '';
  const ty = a.translateY ? 'translateY(-50%)' : '';
  const transform = [tx, ty].filter(Boolean).join(' ');
  return {
    left:   a.left === '50%' ? '50%' : a.left !== undefined ? u(a.left) : undefined,
    right:  a.right !== undefined ? u(a.right) : undefined,
    top:    a.top === '50%' ? '50%' : a.top !== undefined ? u(a.top) : undefined,
    bottom: a.bottom !== undefined ? u(a.bottom) : undefined,
    ...(transform ? { transform } : {}),
  };
}

// 默认 mock
const DEFAULT_PLAYERS: TableV4Player[] = [
  { id: 'p-left',  name: 'vid_**1',   rankLabel: '◆ 大师II', rankLevel: 'red',   coins: 6706, position: 'left',  handCount: 25, isTurn: false },
  { id: 'p-right', name: '默认帐号..', rankLabel: '◆ 大师I',  rankLevel: 'red',   coins: 7478, position: 'right', handCount: 25, isTurn: false },
  { id: 'p-top',   name: '游客1250..', rankLabel: '普通III',   rankLevel: 'green', coins: 8945, position: 'top',   handCount: 25, isTurn: false },
];

export function TableV4(props: TableV4Props) {
  const {
    phase = 'calling',
    mainSuit = '♠',
    mainRank = '7',
    catchScore = 0,
    bankerScore = 0,
    players = DEFAULT_PLAYERS,
    handCards = [],
    bubbleText = '很抱歉，本轮没有牌可以抢主',
    antiHintText = '当前主牌花色黑桃7',
    bottomScore = 1200,
    multiplier = 1,
    myName = '飞龙洪泽..',
    myCoins = 5700,
    myRankLabel = '新人I',
    trickCards = [],
    isMyTurn = false,
    mainActionBlocked,
    bottomCards = [],
    discardCount = 0,
    stagedCount = 0,
    canConfirmDiscard = false,
    discardOverflow = 0,
    actionText,
    hintCardIds = [],
    hintInfo = null,
    playerCount = players.length + 1,
    callingStage = 'suit',
    availableSuits = [],
    minSevens = 1,
    bidMin = 40,
    bidMax = 105,
    bidStep = 5,
    canBid = false,
    isTrustee = false,
    errorText = null,
    isReconnecting = false,
    reconnectDeadline = null,
    chatMessages = [],
    voiceSupported = false,
    isTalking = false,
    speakingIds = [],
    voiceMuted = false,
    isOwner = false,
    seatedCount = players.length + 1,
    aiCount = 0,
    settlementSlot = null,
    dealStage = 'idle',
    dealLocked = false,
    turnDeadline = null,
    callScore = 0,
    micLevel = 0,
    canToss = false,
    tossHint = null,
    tossNotice = null,
    selectedPattern = '',
    selectedPatternNamed = false,
    roomId = null,
    bidHistory = [],
    auctionRows = [],
    suitCallerName,
    suitCallerSevens = 0,
    suitFromBottom = false,
    suitStealCount = 0,
    recordPlayers = [],
    bankerName,
    mainSuitName,
    bottomCount,
    roundsPlayed = 0,
    standings = [],
    roundRows = [],
    leaveIsEscape = false,
  } = props;
  const [inspectTrickSeat, setInspectTrickSeat] = useState<number | null>(null);
  useEffect(() => {
    if (inspectTrickSeat !== null && !trickCards.some(play => play.seat === inspectTrickSeat)) {
      setInspectTrickSeat(null);
    }
  }, [inspectTrickSeat, trickCards]);

  /** 人是否已坐满：坐满后补/减 AI 一律无意义，整块隐藏。 */
  const isTableFull = seatedCount >= playerCount;

  // 牌背样式：个人中心/商城里选的牌背在这里生效（此前设置里那个开关纯装饰）
  const [cardBack, setCardBack] = useState(getCardBack);
  // 四色牌：小尺寸下 ♠/♣、♥/♦ 的形状差别已经小于像素网格，靠颜色区分
  const [fourColor, setFourColor] = useState(getFourColor);
  useEffect(() => {
    // 牌桌打开期间用户可能在菜单里改牌背/四色，聚焦回来时重新读一次
    const onFocus = () => { setCardBack(getCardBack()); setFourColor(getFourColor()); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  /* 房间累计战绩的两个派生值。
   * summarizeRoom 是纯函数（有单测），这里只负责把结果接到 UI 上 ——
   * 顶栏那行小字和退房清单的大标题必须是同一句话，不能各写一份。 */
  const roomSummary = useMemo(
    () => summarizeRoom(roundsPlayed, standings),
    [roundsPlayed, standings],
  );
  const myRoomLevel = roomSummary.myLevel;

  // 顶栏浮层：菜单 / 记录 / 设置 / 退房清单（此前这几个按钮无 onClick）
  const [activePanel, setActivePanel] = useState<TablePanel>(null);
  const [showRules, setShowRules] = useState(false);
  const togglePanel = (p: Exclude<TablePanel, null>) => {
    sound.click();
    setActivePanel(cur => (cur === p ? null : p));
  };

  const [internalSel, setInternalSel] = useState<Set<string>>(new Set());
  const selected = props.selectedIds ?? internalSel;

  // 叫分滑杆：每次可叫上限变化时重置到上限（后叫必须更低，取上限最有利）
  const [bidScore, setBidScore] = useState(bidMax);
  useEffect(() => { setBidScore(bidMax); }, [bidMax]);

  // 回合倒计时：从 turnDeadline 推算剩余秒数
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!turnDeadline) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [turnDeadline]);

  /**
   * 重连剩余秒数。
   *
   * 单独一个计时器而不是复用上面的 secondsLeft：那个跟的是回合倒计时
   * （turnDeadline），断线期间回合数据本身就停更了，不能混用。
   */
  const [reconnectLeft, setReconnectLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!isReconnecting || !reconnectDeadline) { setReconnectLeft(null); return; }
    const tick = () => setReconnectLeft(Math.max(0, Math.ceil((reconnectDeadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [isReconnecting, reconnectDeadline]);

  const [chatDraft, setChatDraft] = useState('');
  const [chatOpen, setChatOpen] = useState(false);

  // 等待区的房间号「点击复制」。这是牌桌上唯一保留的分享方式
  // （微信 / QQ / 邀请链接按钮已按要求移除）。
  const [roomCopied, setRoomCopied] = useState(false);
  const copyRoomCode = useCallback(async () => {
    if (!roomId) return;
    sound.click();
    const ok = await copyText(roomId);
    showToast(ok ? `房间号 ${roomId} 已复制` : `复制失败，请手动记下房间号：${roomId}`, ok ? 'ok' : 'err');
    if (!ok) return;
    setRoomCopied(true);
    setTimeout(() => setRoomCopied(false), 1500);
  }, [roomId]);

  /**
   * 按住说话的手势。
   *
   * 用 pointer 事件而不是 mouse/touch：一套代码同时覆盖鼠标、触屏、手写笔。
   * 关键点：
   * 1) 必须 setPointerCapture —— 手指按住后往按钮外面滑（横屏很容易），
   *    pointerup 会派发到别的元素上，不捕获就收不到"松手"，麦克风一直开着。
   * 2) pointercancel 也要停：来电、切后台、系统手势都会走这条路。
   * 3) 阻止 contextmenu / 长按选中：安卓长按会弹菜单，iOS 会弹"拷贝"气泡。
   */
  const talkPointerRef = useRef<number | null>(null);
  const { onVoiceStart, onVoiceStop, onToggleVoiceMuted } = props;
  const { onSelectionChange, onCardToggle, selectedIds } = props;

  const beginTalk = useCallback(async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (talkPointerRef.current !== null) return;
    talkPointerRef.current = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 不支持就算了 */ }
    const ok = await onVoiceStart?.();
    if (ok === false) {
      talkPointerRef.current = null;
      showToast('无法使用麦克风：请在浏览器里允许麦克风权限', 'err');
      return;
    }
    // 第一次用先说清楚是"对讲"不是"发语音消息"，看过一次就不再打扰。
    if (!hasSeenVoiceTip()) {
      markVoiceTipSeen();
      showToast('实时对讲：按住时同桌就能听到，松手结束，不会留下语音消息', 'ok');
    }
  }, [onVoiceStart]);

  const endTalk = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (talkPointerRef.current !== e.pointerId) return;
    talkPointerRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
    onVoiceStop?.();
  }, [onVoiceStop]);

  const groups = useMemo(() => groupHandCards(handCards), [handCards]);


  /**
   * 平铺后的手牌：一张牌一个格子，不再叠。
   * 仍然保留分组信息 —— groupIds 供双击选整组用，isGroupStart 让 CSS 在
   * 每一组的第一张前面留一点空隙，视觉上还能看出「这里有三张一样的」。
   */
  const flatHand = useMemo(() => {
    const out: { id: string; card: HandCardData; groupIds: string[]; isGroupStart: boolean }[] = [];
    for (const g of groups) {
      g.ids.forEach((id, idx) => {
        out.push({ id, card: g.card, groupIds: g.ids, isGroupStart: idx === 0 });
      });
    }
    return out;
  }, [groups]);

  /** 需要额外留缝的位置数 = 组数 - 1（第一组前面不留） */
  const groupGapCount = Math.max(0, groups.length - 1);

  // ===== 发牌动画派生量 =====
  /** 正在播飞牌/翻面：这两个阶段才需要给卡面挂动画和错峰延迟。 */
  const isDealing = dealStage === 'fly' || dealStage === 'flip';
  /** 飞行途中全程背面朝上，进入 flip 阶段才翻开。 */
  const faceDown = dealStage === 'fly';
  /** 错峰间隔要按实际张数算：24 张和 48 张的节奏不同。 */
  const timeline = useMemo(() => dealTimeline(flatHand.length), [flatHand.length]);

  /**
   * 切换某一张牌的选中态。
   * 必须按 cardId 而不是按「组代表牌」操作：多副牌里同点同花色会有多张，
   * 之前统一传 g.card 导致点第二张时又 toggle 了第一张的 id，
   * 结果对子/拖拉机永远选不出来。
   */
  const toggleCard = (cardId: string) => {
    if (props.onCardToggle) {
      const target = handCards.find(c => c.id === cardId);
      if (target) props.onCardToggle(target);
    } else {
      setInternalSel(prev => {
        const next = new Set(prev);
        if (next.has(cardId)) next.delete(cardId);
        else next.add(cardId);
        return next;
      });
    }
  };

  /**
   * 一次性把选中集合替换为 next。
   * 上层给了 onSelectionChange 就直接用；否则退化成「只对差集逐张 toggle」，
   * 这样框选在旧调用方（只传 onCardToggle）里也能正常工作。
   */
  const applySelection = useCallback((next: Set<string>) => {
    if (onSelectionChange) { onSelectionChange(next); return; }
    if (onCardToggle) {
      const cur = selectedIds ?? new Set<string>();
      for (const c of handCards) {
        const was = cur.has(c.id);
        const now = next.has(c.id);
        if (was !== now) onCardToggle(c);
      }
      return;
    }
    setInternalSel(next);
  }, [onSelectionChange, onCardToggle, selectedIds, handCards]);

  // ===== 框选 / 刷选 =====
  // 手牌平铺后每张都能直接点，但一次要选 6 张拖拉机还是很累。
  // 这里在手牌区做一个「按下拖动 = 刷过谁选谁」的手势：
  //   - 起手落在牌上：按这张牌当前状态决定本次是「刷选」还是「刷消」，
  //     途经的牌全部统一成这个状态（不是 toggle，来回拖不会抖）。
  //   - 起手落在空白：画矩形框，松手时框内的牌整批加入选中。
  const handRowRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<null | {
    mode: 'paint' | 'marquee';
    /** paint 模式下本次统一设置成的目标态 */
    turnOn: boolean;
    /** 起手时的选中快照，marquee 在其之上叠加 */
    base: Set<string>;
    startX: number; startY: number;
    moved: boolean;
    pointerId: number;
  }>(null);
  const [marquee, setMarquee] = useState<null | { x: number; y: number; w: number; h: number }>(null);

  // ===== 理牌动画（FLIP） =====
  // 发完牌后手牌顺序会从「乱序」切到「整理好的顺序」，也就是每张牌的槽位
  // 都要横向挪一段距离。纯 CSS transition 做不到：槽位是 flex 项，宽度和
  // 次序一变就是重排，浏览器直接跳到新位置。
  // 所以用 FLIP：重排前记下每张牌的旧坐标 → 重排后测新坐标 → 先用 transform
  // 把牌拉回旧位置 → 下一帧清掉 transform，让 transition 自己滑过去。
  // transform 挂在【槽位】上（不是卡面）：卡面的 transform 被选中态/hover 占用了。
  const flipRectsRef = useRef<Map<string, number> | null>(null);
  const handOrderKey = useMemo(() => handCards.map(c => c.id).join(','), [handCards]);

  useLayoutEffect(() => {
    const row = handRowRef.current;
    if (!row) return;
    const slots = Array.from(row.querySelectorAll<HTMLElement>('[data-card-id]'));
    const next = new Map<string, number>();
    for (const el of slots) next.set(el.dataset.cardId!, el.getBoundingClientRect().left);

    const prev = flipRectsRef.current;
    flipRectsRef.current = next;
    // 第一次渲染没有旧坐标可比，直接记录基线
    if (!prev) return;

    let moved = false;
    for (const el of slots) {
      const id = el.dataset.cardId!;
      const before = prev.get(id);
      if (before === undefined) continue;
      const delta = before - next.get(id)!;
      // 半像素以内的抖动不值得动画，否则每次 re-render 都在微微颤
      if (Math.abs(delta) < 0.5) continue;
      moved = true;
      el.style.transition = 'none';
      el.style.transform = `translateX(${delta}px)`;
    }
    if (!moved) return;

    // 必须等一帧再清 transform，否则和上面的赋值合并成一次样式计算、看不到过渡
    const raf = requestAnimationFrame(() => {
      for (const el of slots) {
        el.style.transition = `transform ${DEAL_SORT_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
        el.style.transform = '';
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [handOrderKey]);

  /**
   * 计算每张牌飞入动画的起点偏移。
   *
   * 为什么不能只用 CSS：keyframes 里的 translate 是相对【这张牌自己的终点】算的，
   * 写死一个偏移量会让右边的牌从更右边出发（实测最右那张起点 x≈1078，
   * 844 宽的手机横屏上直接飞出屏幕外），看起来不是「从牌堆发出来」而是各自乱飞。
   * 所以这里量出每张牌到中央牌堆的实际距离，逐张写成 CSS 变量，
   * 所有牌就都从同一个点散开。
   */
  useLayoutEffect(() => {
    const row = handRowRef.current;
    if (!row || dealStage !== 'fly') return;
    const table = row.closest('.tv4-table') as HTMLElement | null;
    if (!table) return;
    const tableBox = table.getBoundingClientRect();
    // 牌堆位置：牌桌中央略偏上，和 .tv4-deal-stack 的视觉位置一致
    const originX = tableBox.left + tableBox.width / 2;
    const originY = tableBox.top + tableBox.height * 0.42;

    for (const el of row.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const card = el.querySelector<HTMLElement>('.tv4-hand-card--flat');
      if (!card) continue;
      const b = card.getBoundingClientRect();
      card.style.setProperty('--tv4-fly-x', `${Math.round(originX - b.left - b.width / 2)}px`);
      card.style.setProperty('--tv4-fly-y', `${Math.round(originY - b.top - b.height / 2)}px`);
    }
  }, [dealStage, handOrderKey]);

  /** 命中测试：返回 rect 覆盖到的手牌 id（用 DOM 实际位置，兼容任意缩放） */
  const cardsInRect = useCallback((rect: { x: number; y: number; w: number; h: number }) => {
    const row = handRowRef.current;
    if (!row) return [] as string[];
    const rowBox = row.getBoundingClientRect();
    const hit: string[] = [];
    row.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
      const b = el.getBoundingClientRect();
      const x = b.left - rowBox.left, y = b.top - rowBox.top;
      const overlap = x < rect.x + rect.w && x + b.width > rect.x
                   && y < rect.y + rect.h && y + b.height > rect.y;
      if (overlap) hit.push(el.dataset.cardId!);
    });
    return hit;
  }, []);

  /** 指针位置 -> 手牌区内的相对坐标 */
  const localPoint = (e: React.PointerEvent | PointerEvent) => {
    const row = handRowRef.current;
    if (!row) return { x: 0, y: 0 };
    const b = row.getBoundingClientRect();
    return { x: (e as PointerEvent).clientX - b.left, y: (e as PointerEvent).clientY - b.top };
  };

  const onHandPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const target = (e.target as HTMLElement).closest('[data-card-id]') as HTMLElement | null;
    const cur = new Set(selected);
    const p = localPoint(e);
    if (target) {
      const id = target.dataset.cardId!;
      dragRef.current = {
        mode: 'paint', turnOn: !cur.has(id), base: cur,
        startX: p.x, startY: p.y, moved: false, pointerId: e.pointerId,
      };
    } else {
      dragRef.current = {
        mode: 'marquee', turnOn: true, base: cur,
        startX: p.x, startY: p.y, moved: false, pointerId: e.pointerId,
      };
    }
    // 注意：这里【不能】立刻 setPointerCapture。
    // 一捕获，pointerup 的 target 就变成整行，click 的目标随之上移到行，
    // 挂在单张牌上的 onClick 再也不会触发（实测「单击选牌」直接失效）。
    // 所以捕获推迟到真正确认为拖动之后再做。
  };

  const onHandPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = localPoint(e);
    const dx = p.x - d.startX, dy = p.y - d.startY;
    // 3px 抖动阈值：手机上轻点很难做到零位移，否则每次点击都会被当成拖动
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (!d.moved) {
      // 确认是拖动，这时才捕获指针：后续 move/up 不会因为划出手牌区而丢事件
      d.moved = true;
      try { handRowRef.current?.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    }
    const rect = {
      x: Math.min(d.startX, p.x), y: Math.min(d.startY, p.y),
      w: Math.abs(dx), h: Math.abs(dy),
    };
    if (d.mode === 'marquee') {
      setMarquee(rect);
      const next = new Set(d.base);
      for (const id of cardsInRect(rect)) next.add(id);
      applySelection(next);
    } else {
      // 刷选：把路径矩形覆盖到的牌统一设成 turnOn
      const next = new Set(d.base);
      for (const id of cardsInRect(rect)) {
        if (d.turnOn) next.add(id); else next.delete(id);
      }
      // 起手那张牌也算在内（位移还没覆盖到它时）
      const startHit = cardsInRect({ x: d.startX - 1, y: d.startY - 1, w: 2, h: 2 });
      for (const id of startHit) { if (d.turnOn) next.add(id); else next.delete(id); }
      applySelection(next);
    }
  };

  const endHandDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setMarquee(null);
    if (d.moved) {
      try { handRowRef.current?.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
      sound.click();
      // 拖动刚结束时浏览器还会补发一个 click，必须让 onClick 里的
      // `!dragRef.current` 判断继续为真，否则会把刚刷好的选择又 toggle 掉一张。
      // 下一个宏任务再清空即可（click 在同一轮派发）。
      setTimeout(() => { dragRef.current = null; }, 0);
    } else {
      // 没位移 = 普通点击，立刻放行，交给 onClick 处理单张 toggle
      dragRef.current = null;
    }
  };

  /** 双击一张牌 = 选中/取消同点同花色的整组（对子、炸弹一次到手） */
  const toggleWholeGroup = (ids: string[]) => {
    const cur = new Set(selected);
    const allOn = ids.every(id => cur.has(id));
    const next = new Set(cur);
    for (const id of ids) { if (allOn) next.delete(id); else next.add(id); }
    applySelection(next);
    sound.click();
  };

  // 牌阵区（中间出牌区）
  const renderTrick = () => {
    if (phase !== 'playing' || trickCards.length === 0) return null;

    // 找到四个方位的牌
    const bySeat: Record<number, HandCardData[]> = {};
    trickCards.forEach(t => { bySeat[t.seat] = t.cards; });

    // 牌阵位置按人数解析：相对座位 0 是自己，其余按 opponentPositions 顺时针排布。
    const layout = calcOpponentPositions(playerCount);
    /* 标记也要按座位取出来：bySeat 只存了牌，标签得单独查一遍 */
    const flagBySeat: Record<number, { isLeader?: boolean; isWinner?: boolean }> = {};
    trickCards.forEach(t => { flagBySeat[t.seat] = { isLeader: t.isLeader, isWinner: t.isWinner }; });
    const positions = [
      { seat: 0, pos: 'bottom' as SeatPosition, ...(flagBySeat[0] ?? {}) },
      ...layout.map((pos, i) => ({ seat: i + 1, pos, ...(flagBySeat[i + 1] ?? {}) })),
    ];

    const inspected = inspectTrickSeat === null
      ? null
      : trickCards.find(t => t.seat === inspectTrickSeat) ?? null;
    const ownerOf = (seat: number, pos: SeatPosition) => {
      if (seat === 0) return { name: myName, role: myRankLabel.includes('庄家') ? '庄家' : '闲家' };
      const player = players.find(item => item.position === pos);
      return { name: player?.name ?? `玩家${seat + 1}`, role: player?.rankLabel.includes('庄家') ? '庄家' : '闲家' };
    };

    return (
      <>
      {/* 容器**不能**垂直居中：顶栏只占 56u，手牌区占 236u，中央空档的中心
         比牌桌中心高 90u。top:50% 居中时下沿会伸进手牌行 —— 实测自己打出的
         3 张牌与手牌相交 4920px²，牌直接被手牌盖住。所以用 top/bottom 双向
         内缩贴合真实空档（数值见 trickLayout.ts，改前先量）。 */}
      <div className="tv4-trick" data-seats={trickCards.length} style={{
        position: 'absolute',
        top: u(TRICK_BAND_TOP_U), bottom: u(TRICK_BAND_BOTTOM_U),
        left: '50%', transform: 'translateX(-50%)',
        width: u(TRICK_WIDTH_U), zIndex: 5,
      }}>
        {positions.map(p => {
          const cards = bySeat[p.seat] || [];
          if (cards.length === 0) return null;
          const owner = ownerOf(p.seat, p.pos);
          return (
            /* gap 必须是 0：槽位宽度由 trickLayout 的 trickSlotWidth 精确算出，
               这里多出任何间隙都会让实际宽度超过算好的列宽，多张牌时又撞上。
               每张的露出量改成按张数动态收紧（trickCardStep）。 */
            <div
              key={p.seat}
              className="tv4-trick-slot"
              data-seat={p.seat}
              role="button"
              tabIndex={0}
              aria-label={`查看${owner.name}打出的 ${cards.length} 张牌`}
              onClick={() => setInspectTrickSeat(p.seat)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setInspectTrickSeat(p.seat); }}
              style={{ position: 'absolute', ...trickSlotStyle(p.pos), display: 'flex', gap: 0 }}
            >
              {/* 「先出」/「压」标签贴在这一组牌上方（顶部三家朝下挂，
                  否则会顶出容器伸进顶栏 —— 见 trickTagPos）。
                  用户反馈：标签只挂在玩家头像旁边，还得先找人再对牌，
                  不够直观；贴在牌本身上一眼就知道这墩是谁定的门、现在谁压着。
                  两个标签互斥（见 toTrickPlays：首家自己压着时不标「压」），
                  所以同一组牌上永远只出现一个，不会互相挤。 */}
              {(p.isLeader || p.isWinner) && (
                <span
                  className={`tv4-trick-tag${p.isWinner ? ' is-winner' : ''}`}
                  data-tag-pos={trickTagPos(p.pos)}
                >
                  {p.isLeader ? '先出' : '压'}
                </span>
              )}
              {cards.map((c, i) => (
                <div
                  key={c.id}
                  /* --trick 修饰类必须加：牌阵的牌只有 64x94（比手牌 78x116 小一号），
                   * 但字号原来是写在 .tv4-hc-* 上的固定值，不跟着卡片缩。
                   * 结果左上角标和中央大花色实测重叠 5x17px —— 屏幕上就是
                   * 「两个♠糊在一起」，看不出对方出了什么。 */
                  className={[
                    'tv4-hand-card', 'tv4-hand-card--trick',
                    c.color === 'red' ? 'tv4-red' : 'tv4-black',
                    // 牌阵也标主牌：新手看不出对手甩的是主还是副，就判断不了这墩能不能吃
                    c.isMain ? 'is-main' : '',
                    c.isTianWang ? 'is-tianwang' : '',
                  ].filter(Boolean).join(' ')}
                  /* 每张露出 trickCardStep(n)：张数少时露满 28u（点数花色都看得清），
                   * 张数多到会顶破列宽时按比例收紧 —— 宁可叠密一点，
                   * 也不能让两家的牌撞在一起。 */
                  style={{
                    position: 'relative',
                    width: u(TRICK_CARD_W_U), height: u(TRICK_CARD_H_U),
                    marginLeft: i > 0 ? u(-(TRICK_CARD_W_U - trickCardStep(cards.length))) : 0,
                    boxShadow: '0 3px 10px rgba(0,0,0,0.35)',
                    zIndex: i,
                  }}
                >
                  <CardFace card={c} showFull />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {inspected && (() => {
        const position = positions.find(p => p.seat === inspected.seat);
        const owner = ownerOf(inspected.seat, position?.pos ?? 'bottom');
        return (
          <div className="tv4-trick-inspect" role="dialog" aria-modal="true" aria-label="查看出牌" onClick={() => setInspectTrickSeat(null)}>
            <div className="tv4-trick-inspect-panel" onClick={e => e.stopPropagation()}>
              <div className="tv4-trick-inspect-head">
                <strong>{owner.name}</strong><span>{owner.role}·打出 {inspected.cards.length} 张</span>
                <button type="button" onClick={() => setInspectTrickSeat(null)} aria-label="关闭出牌大图">×</button>
              </div>
              <div className="tv4-trick-inspect-cards">
                {inspected.cards.map(c => (
                  <div key={c.id} className={`tv4-hand-card ${c.color === 'red' ? 'tv4-red' : 'tv4-black'}${c.isMain ? ' is-main' : ''}${c.isTianWang ? ' is-tianwang' : ''}`}>
                    <CardFace card={c} showFull />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
      </>
    );
  };

  // 叫主阶段 - 中央叫主牌
  const renderCallingCenter = () => {
    if (phase !== 'calling') return null;
    return (
      <div className="tv4-center">
        <div style={{ position: 'relative' }}>
          {/* 颜色不能写死 tv4-black：叫红桃/方块时整张牌会画成黑的。
              点数跟红/黑两色（保留"这是红牌还是黑牌"的直觉），
              花色符号额外挂 tv4-s-*，好让四色牌设置也能生效 —— 与手牌一致。 */}
          <div className={`tv4-main-card tv4-animate-float ${mainSuit === '♥' || mainSuit === '♦' ? 'tv4-red' : 'tv4-black'}`}>
            <div className="mrank">{mainRank}</div>
            <div className={`msuit tv4-s-${suitClass(mainSuit)}`}>{suitGlyph(mainSuit)}</div>
            <div className={`mc-suit tv4-s-${suitClass(mainSuit)}`}>{suitGlyph(mainSuit)}</div>
          </div>
          <div className="tv4-declare">叫主</div>
        </div>
      </div>
    );
  };

  /**
   * 扣底阶段 —— 中央底牌区。
   *
   * 支持分批扣牌：选中的牌点「放入底牌」后就落到这里，凑够张数服务端自动结算。
   * 放错了可以点这一区里的牌取回（或用「全部取回」），所以这里必须显示
   * 真实的暂存内容，而不只是一个占位框。
   */
  const renderDiscardingCenter = () => {
    if (phase !== 'discarding') return null;
    const total = stagedCount + discardCount;
    return (
      <div className="tv4-discard-zone">
        <div className="tv4-discard-title">
          扣底
          <span className="tv4-discard-progress">
            {stagedCount} / {total > 0 ? total : stagedCount}
          </span>
          {/* 扣底也有服务端兜底（60秒），到点会自动按推荐扣掉，必须让庄家看见 */}
          {secondsLeft !== null && (
            <span className={`tv4-call-timer ${secondsLeft <= 10 ? 'is-urgent' : ''}`} role="timer">
              {secondsLeft}
            </span>
          )}
          {/* 选多了要最先说 —— 这是唯一一种"点了没反应"的情形 */}
          {discardOverflow > 0
            ? <span className="tv4-discard-over">多选了 {discardOverflow} 张，取消几张再放</span>
            : discardCount > 0
            ? <span className="tv4-discard-need">还需 {discardCount} 张</span>
            : canConfirmDiscard
            ? <span className="tv4-discard-ok">张数已够，确认后开打</span>
            : <span className="tv4-discard-need">把选中的牌放进底牌区</span>}
        </div>
        <div className="tv4-discard-cards">
          {bottomCards.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={[
                'tv4-hand-card', 'tv4-discard-card',
                c.color === 'red' ? 'tv4-red' : 'tv4-black',
                c.isMain ? 'is-main' : '',
                c.isTianWang ? 'is-tianwang' : '',
              ].filter(Boolean).join(' ')}
              title="点击取回这张牌"
              aria-label={`取回 ${c.rank}${c.suit}`}
              onClick={(e) => { e.stopPropagation(); sound.click(); props.onUnstageDiscard?.([c]); }}
              style={{ marginLeft: i > 0 ? `calc(-34 * var(--u))` : 0 }}
            >
              <CardFace card={c} showFull />
            </button>
          ))}
          {bottomCards.length === 0 && (
            <div className="tv4-discard-empty">选牌后点「放入底牌」</div>
          )}
        </div>
        <div className="tv4-discard-ops">
          {stagedCount > 0 && (
            <button
              type="button"
              className="tv4-discard-clear"
              onClick={(e) => { e.stopPropagation(); sound.click(); props.onUnstageDiscard?.(); }}
            >
              全部取回
            </button>
          )}
          {/* 确认埋底：凑够张数才出现。放在底牌区里而不是只放在底部按钮条，
              是因为庄家此刻的视线就在这一堆底牌上 —— 让他在看着牌的地方确认。 */}
          {canConfirmDiscard && (
            <button
              type="button"
              className="tv4-discard-confirm"
              onClick={(e) => { e.stopPropagation(); sound.click(); props.onConfirmDiscard?.(); }}
            >
              确认埋底，开始出牌
            </button>
          )}
        </div>
      </div>
    );
  };

  /**
   * 叫主 / 叫分弹窗。
   *
   * 两个子阶段共用一层外壳 .tv4-call-dialog（标题 + 内容 + 按钮行），
   * 之前是各写一套（花色条一套、叫分面板一套），标题用绝对定位的"横幅"
   * 压在容器外面，按钮宽度写死，手机上标题和内容会互相盖、按钮里的
   * 「确认叫分」还会被裁字。现在统一成正常的纵向流式布局：
   *   [标题胶囊] -> [主体] -> [提示文案] -> [按钮行]
   * 按钮宽度一律由 .tv4-pass-btn 的 min-width + padding 自适应，不写死。
   */
  /**
   * 叫主/叫分弹窗里的倒计时。
   *
   * 服务端在这两个阶段有 15 秒兜底（超时自动"不叫"并可能进托管），
   * 原来界面上完全没显示，玩家会突然发现自己被跳过了。
   * 只在轮到自己（canBid）且拿到 deadline 时显示，别人的回合不闪数字。
   */
  const renderCallTimer = () => {
    if (secondsLeft === null || !canBid) return null;
    return (
      <div
        className={`tv4-call-timer ${secondsLeft <= 5 ? 'is-urgent' : ''}`}
        role="timer"
        aria-label={`还剩 ${secondsLeft} 秒`}
      >
        {secondsLeft}
      </div>
    );
  };

  const renderAntiBar = () => {
    if (phase !== 'calling') return null;

    // ---- 叫分：加减器 + 滑杆 + 确认/不叫 ----
    if (callingStage === 'score') {
      const canDown = bidScore - bidStep >= bidMin;
      const canUp = bidScore + bidStep <= bidMax;
      return (
        <div className="tv4-anti-wrap">
          <div className="tv4-call-dialog" data-stage="score">
            <div className="tv4-call-head">
              <div className="tv4-call-title">叫分定庄</div>
              {renderCallTimer()}
            </div>
            <div className="tv4-call-body">
              <div className="tv4-bid-stepper">
                <button
                  type="button"
                  className="tv4-bid-step"
                  disabled={!canBid || !canDown}
                  onClick={() => { sound.click(); setBidScore(v => Math.max(bidMin, v - bidStep)); }}
                  aria-label={`减少${bidStep}分`}
                >−</button>
                <div className="tv4-bid-value"><strong>{bidScore}</strong><span>分</span></div>
                <button
                  type="button"
                  className="tv4-bid-step"
                  disabled={!canBid || !canUp}
                  onClick={() => { sound.click(); setBidScore(v => Math.min(bidMax, v + bidStep)); }}
                  aria-label={`增加${bidStep}分`}
                >+</button>
              </div>
              <input
                className="tv4-bid-range"
                type="range"
                min={bidMin}
                max={bidMax}
                step={bidStep}
                value={bidScore}
                disabled={!canBid}
                onChange={e => setBidScore(Number(e.target.value))}
                aria-label="拖动选择叫分"
              />
              {/* 可叫区间写清楚：规则是"后叫必须更低"，不写玩家只能试 */}
              <div className="tv4-call-hint">可叫 {bidMin}–{bidMax} 分，后叫必须更低</div>
            </div>
            <div className="tv4-call-actions">
              <button
                className="tv4-pass-btn tv4-pass-btn--ghost"
                disabled={!canBid}
                onClick={(e) => { e.stopPropagation(); props.onAction?.(); }}
              >
                不叫
              </button>
              <button
                className="tv4-pass-btn"
                disabled={!canBid}
                onClick={(e) => { e.stopPropagation(); props.onCallScore?.(bidScore); }}
              >
                叫 {bidScore} 分
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ---- 叫主：只放开手里真有 7 的花色 ----
    const SUITS: Array<{ sym: string; cls: 'red' | 'black'; name: string }> = [
      { sym: '♠', cls: 'black', name: '黑桃' }, { sym: '♥', cls: 'red', name: '红桃' },
      { sym: '♣', cls: 'black', name: '梅花' }, { sym: '♦', cls: 'red', name: '方块' },
    ];
    return (
      <div className="tv4-anti-wrap">
        <div className="tv4-call-dialog" data-stage="suit">
          <div className="tv4-call-head">
            <div className="tv4-call-title">
              {minSevens > 1 ? `抢主 · 需 ${minSevens} 张 7` : '叫主'}
            </div>
            {renderCallTimer()}
          </div>
          <div className="tv4-call-body">
            <div className="tv4-anti-bar">
              {SUITS.map(({ sym, cls, name }) => {
                const enabled = canBid && availableSuits.includes(sym);
                // 抢主要更多张 7，禁用原因要说清是「没有」还是「张数不够」
                const why = minSevens > 1
                  ? `抢主需要 ${minSevens} 张${name}7`
                  : `手里没有${name}7`;
                return (
                  <button
                    key={sym}
                    className={`tv4-anti-btn ${cls} tv4-s-${suitClass(sym)}`}
                    disabled={!enabled}
                    title={enabled
                      ? (minSevens > 1 ? `用 ${minSevens} 张${name}7 抢主` : `叫${name}7为主`)
                      : why}
                    onClick={() => props.onAntiSuit?.(sym)}
                  >
                    <span className="tv4-anti-suit">{suitGlyph(sym)}</span>
                    {/* 花色名一起给出：小屏上只看符号容易把 ♠/♣、♥/♦ 认错 */}
                    <span className="tv4-anti-name">{name}</span>
                  </button>
                );
              })}
            </div>
            <div className="tv4-call-hint">{antiHintText}</div>
          </div>
          <div className="tv4-call-actions">
            <button
              className="tv4-pass-btn tv4-pass-btn--ghost"
              disabled={!canBid}
              onClick={(e) => { e.stopPropagation(); props.onAction?.(); }}
            >
              {actionText || '不叫'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 对战阶段的操作按钮
  const renderPlayAction = () => {
    if (phase === 'calling' || phase === 'waiting' || phase === 'dealing') return null;
    const isDiscarding = phase === 'discarding';
    const blocked = mainActionBlocked ?? (!isMyTurn && phase === 'playing');
    // 只有出牌阶段、且真的有多套方案时才显示轮转角标（扣底推荐只有一套）。
    const showHintCycle = !isDiscarding && hintInfo !== null && hintInfo.total > 1
      && hintCardIds.length > 0;
    return (
      <div className="tv4-play-actions">
        {/* 提示：出牌阶段给一手推荐，扣底阶段给最弱的 N 张。
            出牌阶段可以反复按，在多套合规方案之间轮转，按钮上用 2/5 这种
            角标告诉玩家"还有别的打法可以换"。 */}
        <button
          className="tv4-pass-btn tv4-pass-btn--ghost tv4-hint-btn"
          style={btnVars(88, 52, 18)}
          title={showHintCycle
            ? `第 ${hintInfo!.index + 1} / ${hintInfo!.total} 套打法，再按换下一套`
            : '推荐一手合规的牌'}
          onClick={(e) => {
            e.stopPropagation();
            if (isDiscarding) props.onDiscardHint?.();
            else props.onHint?.();
          }}
          disabled={isDiscarding ? false : blocked}
        >
          提示
          {showHintCycle && (
            <span className="tv4-hint-cycle">{hintInfo!.index + 1}/{hintInfo!.total}</span>
          )}
        </button>
        <button
          className={`tv4-pass-btn ${isDiscarding && canConfirmDiscard ? 'is-confirm' : ''}`}
          style={btnVars(isDiscarding && canConfirmDiscard ? 156 : 132, 52, 21)}
          onClick={(e) => {
            e.stopPropagation();
            /* 扣底阶段凑够张数后，主按钮的含义从「放入底牌」变成「确认埋底」。
             * 不这样切的话按钮会一直写着"放入底牌"却什么也放不进去（已经满了），
             * 庄家会以为卡住了。 */
            if (isDiscarding && canConfirmDiscard) props.onConfirmDiscard?.();
            else props.onAction?.();
          }}
          /* 选多了就禁用：让按钮"按不下去"比按下去没反应清楚得多，
             具体多选几张由底牌区那行红字说明。 */
          disabled={blocked || (isDiscarding && discardOverflow > 0)}
        >
          {isDiscarding && canConfirmDiscard ? '确认埋底' : (actionText || '出牌')}
        </button>
        {/* 回合倒计时 */}
        {secondsLeft !== null && (isMyTurn || isDiscarding) && (
          <div className={`tv4-turn-timer ${secondsLeft <= 5 ? 'is-urgent' : ''}`}>
            {secondsLeft}s
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="tv4-table"
      data-players={playerCount}
      data-card-back={cardBackTheme(cardBack)}
      data-four-color={fourColor ? 'on' : 'off'}
      /* 叫主 / 叫分两个子阶段中央面板高度差一倍，手机横屏（可用高只有 ~200px）
         必须分别排版，CSS 里没有父选择器，只能靠这个属性区分。 */
      data-calling-stage={phase === 'calling' ? callingStage : undefined}
    >
      <div className="tv4-frame" />

      {/* 中央背景文字 */}
      <div className="tv4-bg-text">
        <div className="l1">健康游戏，禁止赌博</div>
        <div className="l2">经典玩法</div>
        <div className="l3">初级场</div>
      </div>

      {/* 顶部栏 */}
      <div className="tv4-topbar">
        <button className="tv4-icon-btn" title="菜单" onClick={() => togglePanel('menu')}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>

        <div className="tv4-scoreboard">
          <div className="tv4-score-main">
            <span className="label">主</span>
            <span className="suit">{suitGlyph(mainSuit)}</span>
            {/* 主是谁叫的 / 抢的。打到中局想不起来时不用翻记录面板。 */}
            {(suitFromBottom || suitCallerName) && (
              <span className="tv4-score-main-by" title={
                suitFromBottom
                  ? '无人叫主，翻底牌第 6 张定主'
                  : `${suitCallerName} 亮 ${suitCallerSevens} 张 7 定主`
              }>
                {suitFromBottom
                  ? '翻底定主'
                  : `${suitStealCount > 0 ? '抢' : '叫'}·${suitCallerName}`}
              </span>
            )}
          </div>
          {/* 这桌打到第几局 + 我的累计级数。
              一桌人连打十几把，这两个数字是最常被问起的；本来只能靠记忆，
              现在常驻顶栏，点开记录面板还能看逐局明细。
              还没打完一局时整块不渲染（顶栏本来就挤，别放一个「第0局」占位）。 */}
          {roundsPlayed > 0 && (
            <button
              className="tv4-score-rounds"
              onClick={() => togglePanel('records')}
              title={`${roomSummary.headline}，点开看逐局战绩`}
            >
              {/* 写「已打 N 局」而不是「第 N+1 局」：
                  结算面板上写着「赢 3 级」，旁边顶栏显示「第 2 局」，
                  玩家会以为刚打完的是第 2 局（其实是第 1 局，第 2 局还没开始）。
                  「已打」是既成事实，任何时刻读都不会歧义。 */}
              <span className="label">已打{roundsPlayed}局</span>
              <span className={`value ${myRoomLevel > 0 ? 'is-up' : myRoomLevel < 0 ? 'is-down' : ''}`}>
                {myRoomLevel > 0 ? `+${myRoomLevel}` : String(myRoomLevel)}级
              </span>
            </button>
          )}
          {/* 庄家杀分 / 闲家抓分分开显示：这两个数字才是判断胜负的依据，
              原来只显示「我自己抓了多少分」，看不出全局形势。 */}
          <div className="tv4-score-catch tv4-score-banker">
            <span className="label tv4-score-label-full">庄家杀分</span>
            <span className="label tv4-score-label-compact" aria-hidden="true">庄分</span>
            <span className="value">{bankerScore}</span>
          </div>
          <div className="tv4-score-catch">
            <span className="label tv4-score-label-full">闲家抓分</span>
            <span className="label tv4-score-label-compact" aria-hidden="true">闲分</span>
            <span className="value">{catchScore}</span>
          </div>
        </div>

        <div className="tv4-topbar-right">
          <button className="tv4-icon-btn" title="记录" onClick={() => togglePanel('records')}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <path d="M8 6h8M8 10h8M8 14h5M8 18h5" />
            </svg>
          </button>
          <button className="tv4-icon-btn" title="设置" onClick={() => togglePanel('settings')}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          {/* 退出房间：先开退房清单（这桌打了几局、各家几级），确认后才真的走。
              以前点这个图标直接离开，误点一下就掉出房间，对局中还要被罚金。 */}
          <button className="tv4-icon-btn" title="退出房间" onClick={() => togglePanel('leave')}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </button>
        </div>
      </div>

      {/* 玩家座位 */}
      {players.map(p => (
        <div
          key={p.position}
          /* is-turn：轮到这家操作。以前 isTurn 字段虽然存在但从没被赋值过，
             对手座位在「等他出牌」时完全没有视觉变化，玩家反馈「不知道在等谁」。 */
          className={[
            'tv4-player', p.position,
            speakingIds.includes(p.id) ? 'is-speaking' : '',
            p.isTurn ? 'is-turn' : '',
          ].filter(Boolean).join(' ')}
        >
          <div className="tv4-avatar" style={{ background: AVATAR_BG[p.position] ?? AVATAR_BG.top }}>
            {AVATAR_EMOJI[p.position] ?? AVATAR_EMOJI.top}
          </div>
          <div className="tv4-pname">{p.name}</div>
          <div className={`tv4-rank ${p.rankLevel}`}>{p.rankLabel}</div>
          <div className="tv4-coins">
            <span className="dot">●</span>
            <span className="val">{p.coins.toLocaleString()}</span>
          </div>
          {p.handCount !== undefined && (
            <div style={{ marginTop: u(4), color: 'rgba(255,255,255,0.6)', fontSize: ut(11) }}>
              {p.handCount} 张
            </div>
          )}
          {/* 这一桌的累计级数。
              级数是本游戏唯一的输赢单位，「谁领先、我落后几级」是每手牌都在
              权衡的事（决定要不要冒险抢庄），原来只有顶栏显示"我"的累计，
              别人的要点开记录面板才看到 —— 等于把最该常驻的数字藏进二级菜单。
              还没打完一局时 roomLevel 是 undefined，整块不渲染。 */}
          {p.roomLevel !== undefined && (
            <div
              className={`tv4-seat-level ${p.roomLevel > 0 ? 'is-up' : p.roomLevel < 0 ? 'is-down' : ''}`}
              aria-label={`${p.name} 本桌累计 ${p.roomLevel} 级`}
            >
              {p.roomLevel > 0 ? `+${p.roomLevel}` : String(p.roomLevel)}级
            </div>
          )}
          {/* 「首家」常驻标签：本墩由谁领出。
              和下面的「轮到谁」是两件事 —— 首家出完牌后标签还在（要靠它知道
              该跟什么门），而 is-turn 会移到下一家。两个标签可以同时出现在
              同一个人身上（他刚领出、还没轮完一圈时轮次已经走了，所以实际
              很少同时亮，但布局上必须能并存）。 */}
          {p.isLeader && (
            <div className="tv4-leader-tag" aria-label={`${p.name} 本墩先出牌`}>
              先出
            </div>
          )}
          {/* 轮到他出牌：头像下方挂一条标签。
              只靠头像描边不够 —— 描边和「正在说话」的金边容易混，必须有文字。
              文案分两种：他是首家就写「出牌中」（他决定这墩打什么），
              否则写「跟牌中」，玩家一眼就知道现在是"定门"还是"应门"。 */}
          {p.isTurn && (
            <div className="tv4-turn-tag" aria-label={`轮到 ${p.name} 出牌`}>
              <i className="tv4-turn-dot" />
              {p.isLeader ? '出牌中' : '跟牌中'}
            </div>
          )}
          {/* 正在说话：三条跳动的声波。收到语音分片就亮，700ms 无新分片自动熄灭 */}
          {speakingIds.includes(p.id) && (
            <div className="tv4-speaking" aria-label={`${p.name} 正在说话`}>
              <i /><i /><i />
            </div>
          )}
        </div>
      ))}

      {/* 中央区域 */}
      {renderCallingCenter()}
      {renderDiscardingCenter()}
      {renderTrick()}

      {/* 气泡 */}
      {phase === 'calling' && (
        <div className="tv4-bubble">
          <span>{bubbleText}</span>
        </div>
      )}

      {/* 操作区 */}
      {renderAntiBar()}

      {/* 发牌阶段：中央显示牌堆 + 提示，替代原来那个盖在动画上的大「准备」按钮 */}
      {phase === 'dealing' && (
        <div className="tv4-deal-banner">
          <div className="tv4-deal-stack"><i /><i /><i /></div>
          <div className="tv4-deal-title">正在发牌</div>
          <div className="tv4-deal-sub">
            {dealStage === 'sort' ? '自动理牌…' : '请稍候'}
          </div>
        </div>
      )}

      {/* waiting 阶段的准备按钮（更大更醒目） */}
      {phase === 'waiting' && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 25,
          textAlign: 'center',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: ut(18), marginBottom: u(8), fontWeight: 600 }}>
            {isTableFull ? '人齐了，可以开始' : '等待其他玩家'}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: ut(14), marginBottom: u(10) }}>
            {seatedCount}/{playerCount} 人已入座{isTableFull ? '' : '，可补 AI 立即开局'}
          </div>
          {/* 房间号点一下即复制。微信 / QQ / 邀请链接按钮已移除（产品要求），
              需要叫人时把房间号发出去即可；菜单里也有同一个入口。 */}
          {roomId && (
            <div className="tv4-room-invite">
              <button
                type="button"
                className="tv4-room-code"
                title="点击复制房间号"
                onClick={(e) => { e.stopPropagation(); copyRoomCode(); }}
              >
                {roomId}
                <span className="tv4-room-code-hint">{roomCopied ? '已复制' : '点击复制'}</span>
              </button>
            </div>
          )}
          {/* 补/减 AI 只在缺人时才有意义：匹配成功进来人已经齐了，
              再显示一个禁用的 +AI 和一个会把真人挤掉的 −AI 只会让人困惑。 */}
          {isOwner && !isTableFull && (
            <div className="tv4-seat-admin">
              <button
                className="tv4-pass-btn tv4-pass-btn--ghost"
                onClick={(e) => { e.stopPropagation(); props.onRemoveAi?.(); }}
                disabled={aiCount <= 0}
              >− AI</button>
              <button
                className="tv4-pass-btn tv4-pass-btn--ghost"
                onClick={(e) => { e.stopPropagation(); props.onAddAi?.(); }}
              >+ AI</button>
            </div>
          )}
          <button
            className="tv4-pass-btn"
            style={btnVars(170, 60, 23)}
            onClick={(e) => { e.stopPropagation(); props.onAction?.(); }}
          >
            {actionText || '准备'}
          </button>
        </div>
      )}

      {/* 底部手牌
        * 同点同花色不再上下叠！以前叠起来只露 24px，第二张往后既看不清也
        * 极难点准（尤其手机横屏），选对子/拖拉机全靠运气。现在一张一张平铺，
        * --tv4-cards 是总张数，横向步进按可用宽度反算，48 张也不出界。
        * 选牌手势：单击切换 / 双击整组 / 在牌上按住横扫刷选 / 空白处拖矩形框选。 */}
      <div className="tv4-hand-wrap">
        <div
          ref={handRowRef}
          className={
            `tv4-hand-row${marquee ? ' is-marquee' : ''}`
            + (dealLocked ? ' is-dealing' : '')
          }
          data-deal-stage={dealStage}
          style={{
            ['--tv4-cards' as string]: String(Math.max(1, flatHand.length)),
            /* 组间缝隙也占宽度，不告诉 CSS 的话步进会算大、两头顶出屏幕 */
            ['--tv4-gaps' as string]: String(groupGapCount),
          } as React.CSSProperties}
          /* 发牌动画期间不接手势：动画里选牌会让选中集合和画面对不上 */
          onPointerDown={dealLocked ? undefined : onHandPointerDown}
          onPointerMove={dealLocked ? undefined : onHandPointerMove}
          onPointerUp={dealLocked ? undefined : endHandDrag}
          onPointerCancel={dealLocked ? undefined : endHandDrag}
        >
          {flatHand.map((item, i) => {
            const { card, id, groupIds, isGroupStart } = item;
            const isSel = selected.has(id);
            const isHint = hintCardIds.includes(id);
            const isLast = i === flatHand.length - 1;
            return (
              /* 槽位负责「占多宽」，卡片在槽位里绝对定位。
               * 不用负 margin：那样在 flex 里算不出正确步进（实测 36 张会全挤成一堆）。 */
              /* data-card-id 挂在【槽位】而不是卡面上：牌是互相压叠的，
               * 卡面会伸到右边邻牌下方，点卡面中心会被邻牌截走点击
               * （实测 Playwright 报 "intercepts pointer events"，真人也一样点不中）。
               * 槽位刚好等于这张牌「露出来的那一条」，所见即可点，绝不歧义。 */
              <div
                key={id}
                data-card-id={id}
                className={
                  'tv4-hand-slot'
                  + (isLast ? ' is-last' : '')
                  + (isGroupStart && i > 0 ? ' is-group-start' : '')
                  + (isSel ? ' is-selected' : '')
                }
                style={{ zIndex: isSel ? 500 + i : i + 1 }}
                onClick={dealLocked ? undefined : () => { if (!dragRef.current) toggleCard(id); }}
                onDoubleClick={dealLocked ? undefined : (e) => { e.stopPropagation(); toggleWholeGroup(groupIds); }}
              >
                <div
                  className={
                    'tv4-hand-card tv4-hand-card--flat'
                    + (card.color === 'red' ? ' tv4-red' : ' tv4-black')
                    /* is-main：整条可见竖条染成暖金底。手牌是排好序的（主牌在前），
                       所以主牌会连成一整块金色，一眼就能看出「我有多少主」。
                       只靠左下那个小「主」字在 39px 宽的牌上还是要凑近看。 */
                    + (card.isMain ? ' is-main' : '')
                    + (card.isTianWang ? ' is-tianwang' : '')
                    + (isSel ? ' is-selected' : '')
                    + (isHint ? ' is-hint' : '')
                    + (isDealing ? ' is-dealing' : '')
                    + (faceDown ? ' is-facedown' : '')
                  }
                  /* 逐张错峰：飞入按发牌次序，翻面再走一遍波浪。
                   * 延迟必须写成行内变量 —— 张数是运行时才知道的，CSS 里算不出来。 */
                  style={isDealing ? ({
                    ['--tv4-deal-delay']: `${(i * timeline.stagger).toFixed(1)}ms`,
                    ['--tv4-flip-delay']: `${(i * DEAL_FLIP_STAGGER_MS).toFixed(1)}ms`,
                  } as React.CSSProperties) : undefined}
                >
                  {/* 背面：飞行途中盖在正面之上，翻面动画把它转走。
                    * 不能用「先渲染背面、再整个换成正面」——DOM 一换就没有翻转过程了。 */}
                  <div className="tv4-hand-card-back" aria-hidden="true" />
                  <div className="tv4-hand-card-face">
                    <CardFace card={card} showFull />
                  </div>
                </div>
              </div>
            );
          })}
          {/* 框选矩形 */}
          {marquee && (
            <div
              className="tv4-marquee"
              style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
            />
          )}
        </div>

        {/* 选牌工具条：选中张数 + 一键全清（多选后逐张取消太痛苦） */}
        {selected.size > 0 && (
          <div className="tv4-sel-bar">
            <span className="tv4-sel-count">已选 {selected.size} 张</span>
            {/* 牌型标签。
             * 为什么要有：本游戏支持拖拉机/连三张/王组合，成立条件很绕
             * （同花色 + 主副归属一致 + 点数连续，允许 K-A-2-3 跨接），
             * 玩家选完牌根本不知道自己凑的算不算拖拉机。
             * 放在选牌条里而不是右侧操作区：这里就在手牌正上方居中，选牌时
             * 视线本来就在这，而底栏最右那行手机横屏已经挤到没余量了。
             * 认不出牌型时只报张数（可能是甩牌、也可能压根不合规），不编牌型名 ——
             * 标得比服务端宽松会让玩家照标签出牌然后被打回，比不标更糟。 */}
            {selectedPattern && (
              <span
                className={`tv4-pattern-tag${selectedPatternNamed ? ' is-named' : ''}`}
                aria-live="polite"
                title={selectedPatternNamed ? '这是一个合法牌型' : '不是标准牌型，可能只能当甩牌出（服务端最终判定）'}
              >
                {selectedPattern}
              </span>
            )}
            <button
              className="tv4-sel-clear"
              title="把选中的牌放回手里；出牌阶段可以再按「提示」换一套打法"
              onClick={(e) => { e.stopPropagation(); applySelection(new Set()); sound.click(); }}
            >
              撤回
            </button>
          </div>
        )}
      </div>

      {/* 底部信息栏 */}
      <div className="tv4-bottombar">
        {/* is-turn 同时给自己用：手机横屏下操作按钮在右侧，玩家常盯着手牌，
            光靠「出牌」按钮变可点击察觉不到轮到自己了。 */}
        <div className={`tv4-me${isMyTurn && phase === 'playing' ? ' is-turn' : ''}`}>
          <div className="tv4-me-avatar">🧔</div>
          <div className="tv4-me-info">
            <span className="tv4-me-name">{myName}</span>
            <div className="tv4-me-coins">
              <span className="dot">●</span>
              <span className="val">{myCoins.toLocaleString()}</span>
            </div>
          </div>
          <div className="tv4-rank blue" style={{ marginLeft: 8 }}>{myRankLabel}</div>
          {/* 我的累计级数：和对手座位同款，摆在一起才好比较谁领先。
              顶栏那个「已打N局 +X级」是全桌进度 + 我的累计，这里是座位维度，
              两处数字同源（都来自服务端 roomLevel），不会打架。 */}
          {roundsPlayed > 0 && (
            <div
              className={`tv4-seat-level ${myRoomLevel > 0 ? 'is-up' : myRoomLevel < 0 ? 'is-down' : ''}`}
              style={{ marginLeft: u(6) }}
              aria-label={`我本桌累计 ${myRoomLevel} 级`}
            >
              {myRoomLevel > 0 ? `+${myRoomLevel}` : String(myRoomLevel)}级
            </div>
          )}
        </div>

        <div className="tv4-bottom-center">
          {/* 甩牌按钮**不能用 disabled**。
              用户反馈「甩牌功能不完善，有时候甩不了牌」，根因就在这里：
              按钮置灰后原因只写在 title 里，而手机没有 hover —— 玩家点下去
              毫无反应，也不知道是自己选错了牌还是功能坏了。
              改成始终可点：不满足条件时用 toast 明确说出原因（选的牌不同门 /
              还没轮到你领出 / 至少选 2 张）。
              仍保留 is-muted 的视觉弱化，让「现在还不能甩」一眼可见。 */}
          <button
            className={`tv4-action-btn${canToss ? '' : ' is-muted'}`}
            data-testid="toss-btn"
            /* 用 data-can-toss 而**不是** aria-disabled 表达状态。
               aria-disabled="true" 的语义是「这个控件不可操作」，可这按钮恰恰
               是要被按的（按了才会告诉你为什么不能甩）；而且辅助技术与
               自动化工具（Playwright 就是）都把 aria-disabled 当真禁用，
               等于又回到「点不动」的老问题。原因本身放在 title / toast 里。 */
            data-can-toss={canToss}
            onClick={() => {
              sound.click();
              if (!canToss) {
                showToast(tossHint ?? '甩牌要选同一门里的 2 张以上，且本墩由你先出', 'err');
                return;
              }
              props.onToss?.();
            }}
            title={tossHint ?? '同门 2 张以上一起打出；只要没人压得住就甩牌成功'}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7l9-4 9 4-9 4-9-4z" />
              <path d="M3 12l9 4 9-4" />
              <path d="M3 17l9 4 9-4" />
            </svg>
            甩牌
          </button>

          <div className="tv4-score-pill di">
            <span className="icon di">底</span>
            <span className="val">{bottomScore.toLocaleString()}</span>
          </div>

          <div className="tv4-score-pill bei">
            <span className="icon bei">倍</span>
            <span className="val">{multiplier}</span>
          </div>
        </div>

        {/* 出牌操作区（提示 / 出牌 / 倒计时）。
            必须和语音、聊天按钮在同一个 flex 行里，让浏览器去算间距 ——
            之前它是 absolute + 手写 right: max(70u,68px)，那个数字要人工
            追着语音/聊天按钮的宽度变，实测已经对不上：「出牌」右沿 776px
            压到语音按钮左沿 765px，语音按钮 34 列里有 10 列点不到。 */}
        {renderPlayAction()}

        {/* 按住说话：桌面上的实时语音入口。
            不支持录音的环境（http 非 localhost、老浏览器）整个按钮不渲染，
            避免出现一个点了没反应的装饰按钮。 */}
        {voiceSupported && (
          <button
            className={`tv4-voice-btn${isTalking ? ' is-talking' : ''}`}
            /* 用途必须写清楚：这是对讲机（按住的同时同桌就听得到，松手即止、
               不留语音消息），不是微信那种"发一条能回听的语音"。 */
            title="按住和同桌实时说话（对讲，松手结束，不会留下语音消息）"
            aria-label="按住和同桌实时说话"
            aria-pressed={isTalking}
            onPointerDown={beginTalk}
            onPointerUp={endTalk}
            onPointerCancel={endTalk}
            onContextMenu={(e) => e.preventDefault()}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <line x1="12" y1="18" x2="12" y2="22" />
            </svg>
            {/* 电平条：5 格，跟着真实麦克风音量点亮。
              * 这是整个反馈里最关键的一层 —— 用户反馈「不知道有没有在发送语音」，
              * 而按钮变色/文字只能说明"按下了"，格子跟着说话声跳才说明麦克风
              * 真的在收音。手机端 .tv4-voice-label 是 display:none（放不下 4 个字），
              * 所以在手机上这个条子是**唯一**的可见反馈，不能省。
              * 用 CSS 变量传值而不是每格一个 style：只改一个自定义属性，
              * 避免 60ms 一次的高频更新去动 5 个 DOM 节点的内联样式。 */}
            {isTalking && (
              <span
                className="tv4-voice-meter"
                style={{ ['--lv']: micLevel } as React.CSSProperties}
                aria-hidden="true"
              >
                <i /><i /><i /><i /><i />
              </span>
            )}
            <span className="tv4-voice-label">{isTalking ? '对方在听…' : '按住说话'}</span>
          </button>
        )}

        {/* 听筒开关：只关别人的语音，不影响出牌音效。
            单独一个按钮是因为需求是"不想听人说话但要听音效"，
            以前跟音效总静音绑在一起做不到这件事。 */}
        {voiceSupported && (
          <button
            className={`tv4-voice-mute-btn${voiceMuted ? ' is-off' : ''}`}
            title={voiceMuted ? '当前听不到同桌语音，点一下重新收听' : '关闭同桌语音（不影响出牌音效）'}
            aria-label={voiceMuted ? '打开同桌语音' : '关闭同桌语音'}
            aria-pressed={voiceMuted}
            onClick={onToggleVoiceMuted}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H3v6h3l5 4V5z" />
              {voiceMuted
                ? <><line x1="17" y1="9" x2="22" y2="14" /><line x1="22" y1="9" x2="17" y2="14" /></>
                : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>}
            </svg>
          </button>
        )}

        <button className="tv4-chat-btn" title="聊天" onClick={() => setChatOpen(v => !v)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>

      {/* 聊天面板 */}
      {chatOpen && (
        <div className="tv4-chat-panel">
          <div className="tv4-chat-log">
            {chatMessages.length === 0
              ? <div className="tv4-chat-empty">还没有人说话</div>
              : chatMessages.slice(-30).map((m, i) => (
                  <div className="tv4-chat-line" key={`${m.playerId ?? m.playerName}-${i}`}>
                    <span className="tv4-chat-who">{m.playerName}</span>
                    <span className="tv4-chat-text">{m.text}</span>
                  </div>
                ))}
          </div>
          <form
            className="tv4-chat-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              const text = chatDraft.trim();
              if (!text) return;
              props.onChat?.(text);
              setChatDraft('');
            }}
          >
            <input
              className="tv4-chat-input"
              value={chatDraft}
              onChange={e => setChatDraft(e.target.value)}
              placeholder="说点什么…"
              maxLength={100}
            />
            <button className="tv4-chat-send" type="submit">发送</button>
          </form>
        </div>
      )}

      {/* 托管提示条：玩家可随时收回 */}
      {isTrustee && (
        <div className="tv4-trustee-bar">
          <span>已进入托管，由系统代打</span>
          <button onClick={() => props.onResumeControl?.()}>收回托管</button>
        </div>
      )}

      {/* 甩牌结果提示（全场可见） */}
      {tossNotice && <div className="tv4-toss-toast">{tossNotice}</div>}

      {/* 服务端错误提示。重连遮罩已经在说明情况了，别再叠一个红条制造双重焦虑。 */}
      {errorText && !isReconnecting && <div className="tv4-error-toast">{errorText}</div>}

      {/* 掉线重连遮罩：盖住整桌，避免玩家以为游戏卡死而杀进程（会被判逃跑罚金） */}
      {isReconnecting && (
        <div className="tv4-reconnect-mask" role="alert" aria-live="assertive">
          <div className="tv4-reconnect-card">
            <div className="tv4-reconnect-spinner" aria-hidden="true" />
            <div className="tv4-reconnect-title">网络不稳，正在重连…</div>
            <div className="tv4-reconnect-tip">牌局已由系统托管，请勿退出游戏</div>
            {/* 倒计时给的是明确等待预期：没有数字时玩家不知道该等 5 秒还是 5 分钟。
                归零后不改文案说"失败"——判定权在服务端，这里只说明已超时。 */}
            {reconnectLeft !== null && (
              <div className={`tv4-reconnect-count ${reconnectLeft <= 15 ? 'is-urgent' : ''}`} role="timer">
                {reconnectLeft > 0
                  ? <>座位保留 <b>{reconnectLeft}</b> 秒</>
                  : <>保留时间已到，正在确认…</>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 顶栏浮层：菜单 / 记录 / 设置 */}
      {activePanel === 'menu' && (
        <TableMenuPanel
          onClose={() => setActivePanel(null)}
          onRequestLeave={() => setActivePanel('leave')}
          onOpenRules={() => { setActivePanel(null); setShowRules(true); }}
          roomId={roomId}
          isTrustee={isTrustee}
          onResumeControl={() => props.onResumeControl?.()}
        />
      )}
      {activePanel === 'records' && (
        <TableRecordsPanel
          onClose={() => setActivePanel(null)}
          bidHistory={bidHistory}
          auctionRows={auctionRows}
          players={recordPlayers}
          callScore={callScore}
          bankerName={bankerName}
          mainSuitName={mainSuitName}
          bottomCount={bottomCount}
          roundsPlayed={roundsPlayed}
          standings={standings}
          rounds={roundRows}
        />
      )}
      {activePanel === 'leave' && (
        <TableLeavePanel
          onClose={() => setActivePanel(null)}
          onConfirmLeave={() => { setActivePanel(null); props.onLeave?.(); }}
          summary={roomSummary}
          standings={standings}
          rounds={roundRows}
          inProgress={leaveIsEscape}
        />
      )}
      {activePanel === 'settings' && (
        <TableSettingsPanel
          onClose={() => setActivePanel(null)}
          onFourColorChange={setFourColor}
        />
      )}
      <RulesModal open={showRules} onClose={() => setShowRules(false)} />

      {/* 结算面板（由外部注入）。
          传函数时把「弹退房清单」的能力交给它，这样结算页的「大厅」按钮
          也能走和顶栏 ✕ 完全相同的那条路径（先看清单，确认才走）。 */}
      {typeof settlementSlot === 'function'
        ? settlementSlot({ requestLeave: () => setActivePanel('leave') })
        : settlementSlot}
    </div>
  );
}
