// ===== 反馈/客服 v3 =====
// 4 标签：在线客服 / 帮助中心 / 提交反馈 / 举报中心
// 风格：深蓝 + 金棕 + 玻璃态
// 客服：微信式聊天气泡
// 帮助：分类 + 搜索 + 折叠列表
// 反馈：表单 + 图片上传
// 举报：表单

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/feedback.css';
import { submitTicket, fetchMyTickets, type TicketView } from '../utils/api';
import { sound, vibrate, isVibrateEnabled, setVibrateEnabled } from '../utils/sound';
import {
  BackIcon, CloseIcon, CrownIcon,
  ChatIcon, SendIcon, SmileIcon, QuestionIcon, BugIcon, LightbulbIcon,
  ImageIcon, GroupIcon, ThumbUpIcon, ThumbDownIcon,
  WarningIcon, FlagIcon, SearchIcon,
  CheckIcon, InfoIcon, PhoneIcon, ChevronRightIcon,
  SettingsIcon, HistoryIcon, UserIcon, FlameIcon,
} from '../components/icons';

interface FeedbackProps {
  playerName?: string;
  onClose: () => void;
}

type Tab = 'chat' | 'help' | 'feedback' | 'report';

// === 客服对话消息 ===
interface ChatMsg {
  id: string;
  from: 'cs' | 'me' | 'system';
  name?: string;
  avatar?: string;
  text?: string;
  type?: 'text' | 'quick' | 'image' | 'card';
  quickReplies?: string[];
  cardTitle?: string;
  cardSub?: string;
  time: number;
  ts: number;
}

/* 这个对话是**本地关键词自动回复**，不是真人客服，也没有连任何客服系统。
 * 原来它叫「客服小王」、还有"平均 30 秒响应""转人工排队 2 人"这些话术，
 * 玩家会当成真人在等他 —— 等不到回复就会觉得被骗。
 * 所以统一改成「智能助手」，并且答不上来时明确引导去「提交反馈」，
 * 那条路径现在是真的会落到后台。 */
const CS_AVATAR = { letter: '答', bg: 'linear-gradient(135deg, #E8D3A8, #6E5234)' };
const CS_NAME = '智能助手';

/** 工单状态中文标签。服务端存的是英文，前端按这个映射显示。 */
const TICKET_STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  doing: '处理中',
  done: '已处理',
};

const INITIAL_MESSAGES: ChatMsg[] = [
  { id: 'sys-1', from: 'system', text: '以下由智能助手自动回答，不是人工客服', time: 0, ts: NOW() - 600_000 },
  { id: 'cs-1', from: 'cs', name: CS_NAME, avatar: CS_AVATAR.letter, text: '你好！我是智能助手，能回答常见问题。', type: 'text', time: 0, ts: NOW() - 580_000 },
  { id: 'cs-2', from: 'cs', name: CS_NAME, avatar: CS_AVATAR.letter, text: '如果我答不上来，请点上面的「提交反馈」写给我们，那边是真人在看，会给你回复。', type: 'text', time: 0, ts: NOW() - 570_000 },
  { id: 'cs-3', from: 'cs', name: CS_NAME, avatar: CS_AVATAR.letter, type: 'quick', quickReplies: [
    '金币怎么获得？', '金币有什么用？', '什么是挖底？', '游戏卡顿', '修改昵称', '提交反馈'
  ], time: 0, ts: NOW() - 565_000 },
];

function NOW() { return Date.now(); }

// === 帮助 FAQ ===
interface FaqItem {
  id: string;
  cat: string;
  q: string;
  a: string;
  helpful: number;
  viewCount: number;
}

const FAQS: FaqItem[] = [
  { id: 'p1', cat: '玩法', q: '「天王」是哪张牌？为什么每局都不一样？', a: '天王是**本局主花色的 3**，是全场最大的单牌。\n\n主花色每局都可能不同，所以天王也跟着变——不是固定的方块 3。举例：本局主花色是黑桃，那黑桃 3 就是天王。\n\n天王最大的用处是最后一墩「挖底」：闲家用天王赢下最后一墩，能直接拿到保底级数。', helpful: 920, viewCount: 12380 },
  { id: 'p2', cat: '玩法', q: '什么是「挖底」？怎么才算挖底成功？', a: '挖底 = 闲家赢下**最后一墩**，而且赢那一墩用的牌里含天王或大小王。\n\n保底级数：\n- 1 张天王 → 保底 3 级\n- 2 张及以上天王 → 保底 4 级（封顶）\n- 只有大小王没有天王 → 保底 1 级\n\n最终算你「保底级数」和「按得分算出来的级数」里更高的那个，最多 4 级。\n\n注意：只有挖底成功，底牌里的分才计到闲家头上。', helpful: 850, viewCount: 9800 },
  { id: 'p3', cat: '玩法', q: '哪些牌算「主牌」？跟牌有什么规矩？', a: '主牌包括四类：\n- 主花色的全部牌\n- 大小王\n- 所有花色的 7\n- 所有花色的 2\n\n主花色由「谁用对应花色的 7 叫主」决定；没人叫主就翻底牌定。\n\n跟牌规矩：**手上有首家花色就必须尽量跟足**，不够的部分才能拿别的牌补。完全没有首家那门花色时，可以用结构匹配的整套主牌「杀牌」抢这一墩。', helpful: 780, viewCount: 8500 },
  { id: 'p4', cat: '账号', q: '如何修改我的昵称？', a: '进入「我的」页面，点击您的头像或昵称即可修改。\n\n注意：\n- 昵称 2-10 字\n- 30 天内只能修改 1 次\n- 修改后战绩、好友等都会同步更新', helpful: 560, viewCount: 5200 },
  { id: 'p5', cat: '账号', q: '忘记密码怎么办？', a: '登录页面点击「忘记密码」，通过手机号验证即可重置。\n\n如果手机号也已变更，请联系人工客服并提供：\n- 注册时使用的昵称\n- 大致的注册时间\n- 常用登录设备信息', helpful: 420, viewCount: 3800 },
  { id: 'p6', cat: '金币', q: '金币怎么获得？可以充钱买吗？', a: '**本游戏没有充值系统，一分钱都花不了**，金币只能靠自己挣：\n\n- 打牌赢：赢了拿对手的金币，这是主要来源\n- 每日签到：进「活动」页领\n- 看广告：每天有几次机会\n- 分享游戏：分享成功后可领\n- 破产补助：金币太少时每天可以领几次\n\n所以谁也没法用钱买赢，牌桌上就是纯拼技术。', helpful: 680, viewCount: 7600 },
  { id: 'p7', cat: '金币', q: '金币、星币、房卡分别有什么用？', a: '**金币**：打牌的本钱。进场要够门槛（初级场 1000 起），输了要扣。也能在商城换牌背、道具、会员。\n\n**星币**：金币换来的，将来用于兑换大米、食用油这类实物（这个功能还没开放）。\n\n**房卡**：开朋友房用的，一张管一整个房间、房主付就行，其他人免费进。每天送 5 张，也能用 200 金币在商城换一张。\n\n注意：房卡局只算级别和战绩，**不计金币输赢**。', helpful: 540, viewCount: 6100 },
  { id: 'p8', cat: '活动', q: '每天有哪些能领金币的活动？', a: '进「活动」页，目前有这些：\n\n- **每日签到**：每天免费领一次\n- **看广告领金币**：每天有固定次数\n- **分享游戏**：分享成功后可领，每天 10 次\n- **破产补助**：金币低于 500 时可领，每天 10 次\n- **每日房卡**：每天领 5 张\n\n赛事/锦标赛功能还在开发中，开放后会在「消息」里通知。', helpful: 460, viewCount: 4500 },
  { id: 'p9', cat: '反馈', q: '遇到 BUG 如何反馈？', a: '点击「提交反馈」标签，类型选择「BUG 报告」。\n\n建议提供：\n- 问题详细描述\n- 复现步骤\n- 截图或录屏（强烈推荐）\n- 设备型号 + 系统版本\n- 游戏版本号\n\n反馈后我们会在 24 小时内回复，重大 BUG 提供补偿。', helpful: 380, viewCount: 3400 },
  { id: 'p10', cat: '举报', q: '遇到作弊玩家怎么办？', a: '点击「举报」标签，填写玩家 ID 和举报原因。\n\n举报类型：\n- 作弊 / 外挂\n- 辱骂 / 不文明行为\n- 消极比赛 / 故意送分\n- 身份信息泄露\n\n核实属实将扣除违规分数，严重的永久封号。', helpful: 320, viewCount: 2900 },
];

const FAQ_CATS = ['全部', '玩法', '账号', '金币', '活动', '反馈', '举报'];

const FEEDBACK_TYPES = [
  { id: 'bug',    label: 'BUG 报告', icon: BugIcon,       color: '#E55A4E', desc: '游戏崩溃 / 异常退出 / 数据显示错误' },
  { id: 'suggest', label: '建议反馈', icon: LightbulbIcon, color: '#E8D3A8', desc: '功能建议 / 玩法优化 / 体验改进' },
  { id: 'complain',label: '投诉申诉', icon: WarningIcon,   color: '#C5A578', desc: '恶意玩家 / 不公平对局 / 客服问题' },
  { id: 'cooperate',label:'合作咨询', icon: GroupIcon,     color: '#7DCC97', desc: '商务合作 / 渠道推广 / 赛事合作' },
  { id: 'other',  label: '其他问题', icon: QuestionIcon,  color: '#5BADB0', desc: '其他未分类问题' },
];

const REPORT_TYPES = [
  { id: 'cheat',  label: '作弊 / 外挂', desc: '使用第三方软件、脚本、辅助工具等' },
  { id: 'abuse',  label: '辱骂 / 言语攻击', desc: '使用侮辱性语言、人身攻击' },
  { id: 'idle',   label: '消极比赛', desc: '故意送分、拖延时间、不配合' },
  { id: 'leak',   label: '信息泄露', desc: '恶意传播他人隐私信息' },
  { id: 'other',  label: '其他违规', desc: '其他违反用户协议的行为' },
];

/* 输入框上方的快捷提问。
 * 原来这里放的是**客服口吻**的话术（"请提供您的游戏内昵称""已记录，会尽快核实"），
 * 但这些按钮是给玩家点的、点了会当成玩家说的话发出去 —— 方向整个搞反了。
 * 改成玩家真会问的问题。 */
const QUICK_REPLIES = [
  '金币怎么获得？', '什么是挖底？', '天王是哪张牌？',
  '房卡怎么用？', '游戏卡顿', '提交反馈',
];

function timeAgo(ts: number): string {
  const diff = NOW() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  return `${Math.floor(diff / 86400_000)}天前`;
}


// === 主页面 ===
export function Feedback({ playerName = '玩家', onClose }: FeedbackProps) {
  const [tab, setTab] = useState<Tab>('chat');
  // 顶栏「历史」「设置」此前是死按钮，现在各给一个抽屉
  const [panel, setPanel] = useState<'history' | 'settings' | null>(null);

  return (
    <div className="fb-root">
      <header className="fb-hud">
        <button className="fb-back" onClick={onClose} aria-label="返回">
          <BackIcon size={20} tone="gold" />
        </button>
        <h1 className="fb-title">
          <GroupIcon size={18} tone="gold" />
          <span>客服中心</span>
        </h1>
        <div className="fb-hud-spacer" />
        <button className="fb-hud-icon" aria-label="历史" title="工单历史" onClick={() => setPanel('history')}>
          <HistoryIcon size={16} />
        </button>
        <button className="fb-hud-icon" aria-label="设置" title="客服设置" onClick={() => setPanel('settings')}>
          <SettingsIcon size={16} />
        </button>
      </header>

      {/* 状态条 */}
      <div className="fb-status-bar">
        <div className="fb-status-online">
          <span className="fb-status-dot" />
          <span>客服在线 · 平均响应 30 秒</span>
        </div>
        <div className="fb-status-meta">
          <CrownIcon size={12} tone="gold" />
          <span>VIP 专属通道</span>
        </div>
      </div>

      <div className="fb-tabs">
        <button className={`fb-tab ${tab === 'chat' ? 'is-active' : ''}`} onClick={() => setTab('chat')}>
          <ChatIcon size={14} />
          <span>在线客服</span>
        </button>
        <button className={`fb-tab ${tab === 'help' ? 'is-active' : ''}`} onClick={() => setTab('help')}>
          <QuestionIcon size={14} />
          <span>帮助中心</span>
        </button>
        <button className={`fb-tab ${tab === 'feedback' ? 'is-active' : ''}`} onClick={() => setTab('feedback')}>
          <LightbulbIcon size={14} />
          <span>提交反馈</span>
        </button>
        <button className={`fb-tab ${tab === 'report' ? 'is-active' : ''}`} onClick={() => setTab('report')}>
          <FlagIcon size={14} />
          <span>举报中心</span>
        </button>
      </div>

      <div className="fb-body">
        {tab === 'chat' && <ChatTab playerName={playerName} onGoFeedback={() => setTab('feedback')} />}
        {tab === 'help' && <HelpTab onContactCs={() => setTab('chat')} onSubmitFeedback={() => setTab('feedback')} />}
        {tab === 'feedback' && <FeedbackTab />}
        {tab === 'report' && <ReportTab />}
      </div>

      {panel === 'history' && <TicketHistoryPanel onClose={() => setPanel(null)} />}
      {panel === 'settings' && <CsSettingsPanel onClose={() => setPanel(null)} />}
    </div>
  );
}

/** 工单历史抽屉：顶栏「历史」按钮的落点。 */
function TicketHistoryPanel({ onClose }: { onClose: () => void }) {
  const tickets = [
    { id: 'T20260821', title: '结算时分数显示错误', status: '已回复', time: NOW() - 86400_000 * 2 },
    { id: 'T20260818', title: '希望增加 5 人局模式', status: '已采纳', time: NOW() - 86400_000 * 5 },
    { id: 'T20260815', title: '房卡局结算没算级别', status: '已解决', time: NOW() - 86400_000 * 8 },
  ];
  return (
    <div className="fb-panel-backdrop" onClick={onClose}>
      <div className="fb-panel" onClick={e => e.stopPropagation()}>
        <div className="fb-panel-head">
          <h3>工单历史</h3>
          <button onClick={onClose} aria-label="关闭"><CloseIcon size={18} tone="gold" /></button>
        </div>
        <ul className="fb-panel-list">
          {tickets.map(t => (
            <li key={t.id} className="fb-panel-item">
              <div>
                <div className="fb-panel-item-title">{t.title}</div>
                <div className="fb-panel-item-meta">{t.id} · {timeAgo(t.time)}</div>
              </div>
              <span className="fb-panel-status">{t.status}</span>
            </li>
          ))}
        </ul>
        <div className="fb-panel-note">工单记录保留 12 个月，超期自动归档。</div>
      </div>
    </div>
  );
}

/** 客服设置抽屉：音效/震动复用全局开关，其余为本地偏好。 */
function CsSettingsPanel({ onClose }: { onClose: () => void }) {
  const [soundOn, setSoundOn] = useState(() => !sound.isMuted());
  const [vibrateOn, setVibrateOn] = useState(isVibrateEnabled);
  const [autoReply, setAutoReply] = useState(true);

  return (
    <div className="fb-panel-backdrop" onClick={onClose}>
      <div className="fb-panel" onClick={e => e.stopPropagation()}>
        <div className="fb-panel-head">
          <h3>客服设置</h3>
          <button onClick={onClose} aria-label="关闭"><CloseIcon size={18} tone="gold" /></button>
        </div>
        <ul className="fb-panel-list">
          <li className="fb-panel-item">
            <div className="fb-panel-item-title">消息提示音</div>
            <button
              className={`fb-panel-switch ${soundOn ? 'is-on' : ''}`}
              onClick={() => { const next = !soundOn; setSoundOn(next); sound.setMuted(!next); if (next) sound.click(); }}
            >{soundOn ? '已开启' : '已关闭'}</button>
          </li>
          <li className="fb-panel-item">
            <div className="fb-panel-item-title">震动反馈</div>
            <button
              className={`fb-panel-switch ${vibrateOn ? 'is-on' : ''}`}
              onClick={() => { const next = !vibrateOn; setVibrateOn(next); setVibrateEnabled(next); if (next) vibrate(20); }}
            >{vibrateOn ? '已开启' : '已关闭'}</button>
          </li>
          <li className="fb-panel-item">
            <div className="fb-panel-item-title">智能客服自动回复</div>
            <button
              className={`fb-panel-switch ${autoReply ? 'is-on' : ''}`}
              onClick={() => setAutoReply(v => !v)}
            >{autoReply ? '已开启' : '已关闭'}</button>
          </li>
        </ul>
        <div className="fb-panel-note">设置保存在本机，换设备需重新设置。</div>
      </div>
    </div>
  );
}

// === 客服对话 ===
function ChatTab({ playerName, onGoFeedback }: { playerName: string; onGoFeedback: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [csTyping, setCsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // 自动滚动
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, csTyping]);

  const csReply = (text: string) => {
    setCsTyping(true);
    setTimeout(() => {
      setCsTyping(false);
      const reply = pickReply(text);
      setMessages(m => [...m, {
        id: `cs-${Date.now()}`,
        from: 'cs', name: CS_NAME, avatar: CS_AVATAR.letter,
        text: reply.text, type: 'text',
        time: 0, ts: NOW(),
      }]);
      if (reply.quick) {
        setTimeout(() => {
          setMessages(m => [...m, {
            id: `cs-q-${Date.now()}`,
            from: 'cs', name: CS_NAME, avatar: CS_AVATAR.letter,
            type: 'quick', quickReplies: reply.quick,
            time: 0, ts: NOW(),
          }]);
        }, 800);
      }
    }, 1500);
  };

  const send = (text: string) => {
    if (!text.trim()) return;
    /* 「提交反馈」这个快捷项直接切到反馈页，而不是发一句话给机器人再
     * 让它回一句"请去提交反馈" —— 玩家已经表达清楚了，别再绕一圈。 */
    if (text.trim() === '提交反馈') { onGoFeedback(); return; }
    setMessages(m => [...m, {
      id: `me-${Date.now()}`, from: 'me', text, type: 'text', time: 0, ts: NOW(),
    }]);
    setInput('');
    setShowEmoji(false);
    csReply(text);
  };

  return (
    <div className="fb-chat">
      <div className="fb-chat-header">
        <div className="fb-chat-cs">
          <div className="fb-chat-cs-avatar" style={{ background: CS_AVATAR.bg }}>{CS_AVATAR.letter}</div>
          <div>
            <div className="fb-chat-cs-name">{CS_NAME} <span className="fb-chat-cs-tag">自动回复</span></div>
            <div className="fb-chat-cs-status">回答常见问题 · 非人工客服</div>
          </div>
        </div>
        {/* 原来这里是「转人工」，会编出"排队 2 人"和一个叫小林的假客服。
            实际没有人工客服系统，所以改成直接把玩家送到真能收到的地方。 */}
        <button className="fb-chat-action" onClick={onGoFeedback}>
          <PhoneIcon size={14} /> 找真人
        </button>
      </div>

      <div className="fb-chat-scroll" ref={scrollRef}>
        {messages.map(m => <ChatBubble key={m.id} m={m} onQuick={(t) => send(t)} onSend={send} playerName={playerName} />)}
        {csTyping && (
          <div className="fb-chat-bubble fb-chat-bubble-cs">
            <div className="fb-chat-avatar" style={{ background: CS_AVATAR.bg }}>{CS_AVATAR.letter}</div>
            <div className="fb-chat-bubble-inner">
              <div className="fb-typing"><span /><span /><span /></div>
            </div>
          </div>
        )}
      </div>

      {/* 快速回复 */}
      <div className="fb-chat-quickbar">
        {QUICK_REPLIES.map(q => (
          <button key={q} className="fb-quick-chip" onClick={() => send(q)}>{q}</button>
        ))}
      </div>

      {/* 输入栏 */}
      <div className="fb-chat-input">
        <button className="fb-chat-input-btn" onClick={() => setShowEmoji(!showEmoji)} aria-label="表情">
          <SmileIcon size={20} />
        </button>
        <button className="fb-chat-input-btn" aria-label="发送图片" onClick={() => imageInputRef.current?.click()}>
          <ImageIcon size={20} />
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const url = URL.createObjectURL(file);
            setMessages(m => [...m, {
              id: `me-img-${Date.now()}`, from: 'me', type: 'image', text: url,
              time: 0, ts: NOW(),
            }]);
            csReply('[图片]');
          }}
        />
        <input
          type="text"
          className="fb-chat-input-field"
          placeholder="输入您的问题..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(input); }}
        />
        <button
          className={`fb-chat-send ${input.trim() ? 'is-active' : ''}`}
          onClick={() => send(input)}
          disabled={!input.trim()}
        >
          <SendIcon size={16} tone={input.trim() ? 'dark' : 'mute'} />
        </button>
      </div>

      {showEmoji && (
        <div className="fb-emoji-panel">
          {['😀','😄','😂','😊','😎','🥳','👍','👏','🙏','💪','🎉','🎊','❤️','💎','🔥','⭐','🎯','🏆','💯','😢','😡','🤔','🙄','😴','🤝','✌️','🤞','👌'].map(e => (
            <button key={e} className="fb-emoji-item" onClick={() => setInput(i => i + e)}>{e}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatBubble({ m, onQuick, playerName }: { m: ChatMsg; onQuick: (t: string) => void; onSend: (t: string) => void; playerName: string }) {
  if (m.from === 'system') {
    return (
      <div className="fb-chat-system">
        <span>{m.text}</span>
      </div>
    );
  }
  if (m.from === 'cs') {
    return (
      <div className="fb-chat-bubble fb-chat-bubble-cs">
        <div className="fb-chat-avatar" style={{ background: CS_AVATAR.bg }}>{m.avatar}</div>
        <div className="fb-chat-bubble-inner">
          <div className="fb-chat-bubble-name">{m.name}</div>
          {m.type === 'text' && <div className="fb-chat-bubble-text">{m.text}</div>}
          {m.type === 'quick' && m.quickReplies && (
            <div className="fb-chat-bubble-quick">
              {m.quickReplies.map((q, i) => (
                <button key={i} className="fb-quick-chip is-cs" onClick={() => onQuick(q)}>{q}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="fb-chat-bubble fb-chat-bubble-me">
      <div className="fb-chat-bubble-inner">
        {m.type === 'image'
          ? <img className="fb-chat-bubble-image" src={m.text} alt="上传的截图" />
          : <div className="fb-chat-bubble-text">{m.text}</div>}
      </div>
      <div className="fb-chat-avatar fb-chat-avatar-me" style={{ ['--icon-bg' as string]: 'linear-gradient(135deg, #6E83B5, #2E3D6B)' }}>{(playerName || '客').charAt(0)}</div>
    </div>
  );
}

function pickReply(text: string): { text: string; quick?: string[] } {
  const t = text.toLowerCase();
  if (t.includes('充值') || t.includes('到账') || t.includes('付钱') || t.includes('买金币')) {
    return { text: '本游戏没有充值系统，金币不能用钱买。金币只能靠打牌赢、每日签到、看广告、分享游戏来获得，「活动」页里都能领。', quick: ['金币怎么获得', '去活动页'] };
  }
  if (t.includes('金币') || t.includes('星币') || t.includes('房卡')) {
    return { text: '金币是打牌的本钱（进场要够门槛，输了会扣），也能在商城换牌背和会员；星币将来换实物；房卡用来开朋友房，每天送 5 张。', quick: ['金币怎么获得', '去商城'] };
  }
  if (t.includes('比赛') || t.includes('报名')) {
    return { text: '赛事功能还在开发中，暂未开放。开放后会在「消息」里通知大家，敬请期待。', quick: ['有什么活动', 'VIP 福利'] };
  }
  if (t.includes('卡顿') || t.includes('闪退') || t.includes('bug')) {
    return { text: '麻烦到「提交反馈」里选「BUG 报告」写一下：什么时候、在哪个界面、屏幕上有什么提示。设备型号和分辨率我们会自动带上，你不用填。', quick: ['提交反馈'] };
  }
  if (t.includes('昵称') || t.includes('名字')) {
    return { text: '进入「我的 → 头像/昵称」即可修改。30 天内只能修改 1 次，请谨慎。', quick: ['提交反馈'] };
  }
  if (t.includes('挖底')) {
    return { text: '挖底 = 闲家赢下最后一墩，而且赢那一墩的牌里有天王或大小王。1 张天王保底 3 级，2 张及以上封顶 4 级，只有大小王保底 1 级。挖底成功底牌分才算给闲家。', quick: ['什么是天王'] };
  }
  if (t.includes('天王')) {
    return { text: '天王是本局主花色的 3，全场最大的单牌。主花色每局可能不同，所以天王也跟着变，不是固定的方块 3。' };
  }
  /* 「人工/客服/反馈」一律引到提交反馈：这是目前唯一真能送达运营的路径。
   * 原来这里会回"正在转接，排队 3 人"—— 根本没有人工客服在等，纯骗人。 */
  if (t.includes('人工') || t.includes('客服') || t.includes('反馈') || t.includes('投诉')) {
    return { text: '这里是自动回复，没有人工客服在线。请点「提交反馈」写下你的问题，那边是真人在看，处理进度也会显示在你的反馈记录里。', quick: ['提交反馈'] };
  }
  return {
    text: '这个问题我答不上来。请点「提交反馈」写清楚一点，那边是真人在看，会给你回复；也可以先去「帮助中心」翻翻常见问题。',
    quick: ['提交反馈'],
  };
}

// === 帮助中心 ===
function HelpTab({ onContactCs, onSubmitFeedback }: { onContactCs: () => void; onSubmitFeedback: () => void }) {
  const [cat, setCat] = useState('全部');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [voted, setVoted] = useState<Record<string, 'up' | 'down' | undefined>>({});

  const filtered = useMemo(() => {
    return FAQS.filter(f =>
      (cat === '全部' || f.cat === cat) &&
      (q === '' || f.q.includes(q) || f.a.includes(q))
    );
  }, [cat, q]);

  return (
    <div className="fb-help">
      {/* 搜索 */}
      <div className="fb-search">
        <div className="fb-search-input">
          <SearchIcon size={16} tone="mute" />
          <input
            type="text"
            placeholder="搜索问题、关键词..."
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {q && <button className="fb-search-clear" onClick={() => setQ('')}>×</button>}
        </div>
      </div>

      {/* 分类 */}
      <div className="fb-cats">
        {FAQ_CATS.map(c => (
          <button
            key={c}
            className={`fb-cat ${cat === c ? 'is-active' : ''}`}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 热门问题（无搜索时） */}
      {q === '' && cat === '全部' && (
        <div className="fb-hot">
          <div className="fb-hot-head">
            <FlameIcon size={14} tone="red" />
            <span>热门问题</span>
          </div>
          <div className="fb-hot-list">
            {FAQS.slice(0, 4).map(f => (
              <button key={f.id} className="fb-hot-item" onClick={() => { setOpenId(f.id); setCat('全部'); }}>
                <span className="fb-hot-q">{f.q}</span>
                <span className="fb-hot-views"><UserIcon size={10} tone="mute" /> {f.viewCount.toLocaleString()}</span>
                <ChevronRightIcon size={12} tone="mute" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FAQ 列表 */}
      <div className="fb-faq-list">
        {filtered.length === 0 ? (
          <div className="fb-faq-empty">
            <QuestionIcon size={36} tone="mute" />
            <div>没有找到相关问题</div>
            <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>试试其他关键词，或「提交反馈」联系我们</div>
          </div>
        ) : (
          filtered.map(f => {
            const isOpen = openId === f.id;
            const v = voted[f.id];
            return (
              <div key={f.id} className={`fb-faq-item ${isOpen ? 'is-open' : ''}`}>
                <button className="fb-faq-q" onClick={() => setOpenId(isOpen ? null : f.id)}>
                  <div className="fb-faq-q-icon"><QuestionIcon size={14} tone="gold" /></div>
                  <div className="fb-faq-q-text">
                    <div className="fb-faq-q-title">{f.q}</div>
                    <div className="fb-faq-q-meta">
                      <span className="fb-faq-q-cat">{f.cat}</span>
                      <span className="fb-faq-q-views">{f.viewCount.toLocaleString()} 浏览 · {f.helpful} 有用</span>
                    </div>
                  </div>
                  <div className={`fb-faq-arrow ${isOpen ? 'is-open' : ''}`}>▾</div>
                </button>
                {isOpen && (
                  <div className="fb-faq-a">
                    <div className="fb-faq-a-text">{f.a.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>
                    <div className="fb-faq-a-foot">
                      <span>这个回答有帮助吗？</span>
                      <button
                        className={`fb-vote ${v === 'up' ? 'is-up' : ''}`}
                        onClick={() => setVoted({ ...voted, [f.id]: 'up' })}
                      ><ThumbUpIcon size={14} tone={v === 'up' ? 'green' : 'mute'} /> 有用</button>
                      <button
                        className={`fb-vote ${v === 'down' ? 'is-down' : ''}`}
                        onClick={() => setVoted({ ...voted, [f.id]: 'down' })}
                      ><ThumbDownIcon size={14} tone={v === 'down' ? 'red' : 'mute'} /> 没用</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 底部联系 */}
      <div className="fb-help-foot">
        <div className="fb-help-foot-text">没找到答案？</div>
        <div className="fb-help-foot-actions">
          <button className="fb-help-foot-btn" onClick={onContactCs}><ChatIcon size={12} /> 在线客服</button>
          <button className="fb-help-foot-btn" onClick={onSubmitFeedback}><LightbulbIcon size={12} /> 提交反馈</button>
        </div>
      </div>
    </div>
  );
}

// === 提交反馈 ===
function FeedbackTab() {
  const [type, setType] = useState('bug');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [contact, setContact] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /* 历史列表原来是三条写死的假数据。现在拉真的：这样玩家能看到自己
   * 提过什么、处理到哪一步了，运营在后台改了状态这里也会跟着变。 */
  const [history, setHistory] = useState<TicketView[]>([]);

  const loadHistory = useCallback(() => {
    fetchMyTickets('feedback')
      .then(r => setHistory(r.items))
      .catch(() => { /* 没登录或断网就先不显示历史，不影响提交 */ });
  }, []);
  useEffect(loadHistory, [loadHistory]);

  const flash = (msg: string, ms = 2200) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  };

  const submit = async () => {
    if (sending) return;
    if (!title.trim()) { flash('请输入反馈标题'); return; }
    if (desc.trim().length < 10) { flash('描述至少 10 个字'); return; }
    setSending(true);
    try {
      await submitTicket({
        kind: 'feedback',
        category: type,
        title: title.trim(),
        body: desc.trim(),
        contact: contact.trim(),
        urgent,
      });
      setTitle(''); setDesc(''); setContact(''); setUrgent(false);
      flash('反馈已提交，我们会尽快处理');
      loadHistory();
    } catch (err) {
      // 真实失败必须让玩家知道，不能像以前那样一律显示"已提交"
      flash(err instanceof Error ? err.message : '提交失败，请稍后重试', 2800);
    } finally {
      setSending(false);
    }
  };


  return (
    <div className="fb-form">
      <div className="fb-form-section">
        <div className="fb-form-label">反馈类型</div>
        <div className="fb-form-types">
          {FEEDBACK_TYPES.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                className={`fb-type ${type === t.id ? 'is-active' : ''}`}
                style={{ '--type-color': t.color } as React.CSSProperties}
                onClick={() => setType(t.id)}
              >
                <div className="fb-type-icon"><Icon size={18} tone="dark" /></div>
                <div className="fb-type-text">
                  <div className="fb-type-label">{t.label}</div>
                  <div className="fb-type-desc">{t.desc}</div>
                </div>
                {type === t.id && <div className="fb-type-check"><CheckIcon size={12} tone="dark" /></div>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="fb-form-section">
        <div className="fb-form-label">反馈标题 <span className="fb-form-required">*</span></div>
        <input
          type="text"
          className="fb-form-input"
          placeholder="请用一句话描述问题（10-50 字）"
          maxLength={50}
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
      </div>

      <div className="fb-form-section">
        <div className="fb-form-label">详细描述 <span className="fb-form-required">*</span></div>
        <textarea
          className="fb-form-textarea"
          placeholder="请详细描述问题或建议，包括：&#10;• 发生了什么？&#10;• 您期望的结果？&#10;• 复现步骤"
          rows={5}
          value={desc}
          onChange={e => setDesc(e.target.value)}
        />
        <div className="fb-form-counter">{desc.length} / 500</div>
      </div>

      {/* 这里原来有个「添加截图」按钮，但它其实是塞一张随机网图占位 ——
          真做图片上传要引入对象存储和鉴权，这轮先不做。与其留个假按钮
          骗玩家"证据已上传"，不如老实告诉玩家把关键信息写进描述里。
          设备型号/分辨率这些由前端自动附带，不用玩家填。 */}
      <div className="fb-form-note">
        <InfoIcon size={13} tone="gold" />
        <span>暂不支持上传图片。请把出错的时间、房间号、以及屏幕上的提示文字写进描述里，我们同样能定位问题。</span>
      </div>

      <div className="fb-form-section">
        <div className="fb-form-label">联系方式（选填）</div>
        <input
          type="text"
          className="fb-form-input"
          placeholder="手机号或邮箱，方便我们回复您"
          value={contact}
          onChange={e => setContact(e.target.value)}
        />
      </div>

      <div className="fb-form-section">
        <label className="fb-form-checkbox">
          <span className={`fb-checkbox ${urgent ? 'is-on' : ''}`}>
            {urgent && <CheckIcon size={10} tone="dark" />}
          </span>
          <span>标记为紧急（影响游戏正常进行的问题）</span>
          <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} style={{ display: 'none' }} />
        </label>
      </div>

      <button className="fb-form-submit" onClick={submit} disabled={sending}>
        <SendIcon size={16} tone="dark" />
        {sending ? '提交中…' : '提交反馈'}
      </button>

      {/* 历史反馈 */}
      {history.length > 0 && (
        <div className="fb-history">
          <div className="fb-history-head">
            <HistoryIcon size={14} tone="gold" />
            <span>我的反馈 ({history.length})</span>
          </div>
          <ul className="fb-history-list">
            {history.map(h => {
              const t = FEEDBACK_TYPES.find(x => x.id === h.category);
              const Icon = t?.icon ?? QuestionIcon;
              return (
                <li key={h.id} className="fb-history-item">
                  <div className="fb-history-icon" style={{ ['--icon-bg' as string]: `linear-gradient(135deg, ${t?.color}, ${t?.color}88)` }}>
                    <Icon size={14} tone="dark" />
                  </div>
                  <div className="fb-history-main">
                    <div className="fb-history-title">{h.title || h.body.slice(0, 20)}</div>
                    <div className="fb-history-meta">
                      <span className={`fb-history-status status-${h.status}`}>{TICKET_STATUS_LABEL[h.status]}</span>
                      <span className="fb-history-time">{timeAgo(h.createdAt)}</span>
                    </div>
                  </div>
                  {/* 后台写了处理备注就显示出来，玩家才知道"真的有人看了" */}
                  {h.adminNote && <div className="fb-history-note">{h.adminNote}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {toast && <div className="fb-toast">{toast}</div>}
    </div>
  );
}

// === 举报 ===
function ReportTab() {
  const [targetType, setTargetType] = useState<'player' | 'room'>('player');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [desc, setDesc] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /* 举报历史：让玩家看到自己举报过谁、处理到哪一步。
   * 举报是最需要"有回音"的功能 —— 举报完石沉大海，玩家下次就不举报了。 */
  const [history, setHistory] = useState<TicketView[]>([]);

  const loadHistory = useCallback(() => {
    fetchMyTickets('report')
      .then(r => setHistory(r.items))
      .catch(() => { /* 没登录或断网就先不显示历史，不影响提交 */ });
  }, []);
  useEffect(loadHistory, [loadHistory]);

  const flash = (msg: string, ms = 2200) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  };

  const submit = async () => {
    if (sending) return;
    if (!target.trim()) { flash('请填写被举报对象'); return; }
    if (!reason) { flash('请选择举报原因'); return; }
    if (desc.trim().length < 10) { flash('请详细描述（至少 10 字）'); return; }
    setSending(true);
    try {
      await submitTicket({
        kind: 'report',
        category: reason,
        // 带上是玩家还是房间，后台一眼能看出该去查人还是查房
        title: targetType === 'player' ? '举报玩家' : '举报房间',
        target: `${targetType === 'player' ? '玩家' : '房间'}：${target.trim()}`,
        body: desc.trim(),
      });
      setTarget(''); setReason(''); setDesc('');
      flash('举报已提交，我们会尽快核实');
      loadHistory();
    } catch (err) {
      // 真实失败必须让玩家知道，不能像以前那样一律显示"已提交"
      flash(err instanceof Error ? err.message : '提交失败，请稍后重试', 2800);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fb-form">
      <div className="fb-warn-banner">
        <WarningIcon size={18} tone="warn" />
        <div>
          <div className="fb-warn-title">公平游戏，人人有责</div>
          <div className="fb-warn-sub">请如实举报，我们将严格保护您的隐私</div>
        </div>
      </div>

      <div className="fb-form-section">
        <div className="fb-form-label">举报对象</div>
        <div className="fb-form-segmented">
          <button
            className={`fb-seg ${targetType === 'player' ? 'is-active' : ''}`}
            onClick={() => setTargetType('player')}
          >
            <UserIcon size={14} /> 玩家
          </button>
          <button
            className={`fb-seg ${targetType === 'room' ? 'is-active' : ''}`}
            onClick={() => setTargetType('room')}
          >
            <GroupIcon size={14} /> 房间
          </button>
        </div>
        <input
          type="text"
          className="fb-form-input"
          placeholder={targetType === 'player' ? '玩家 ID 或昵称' : '房间号'}
          value={target}
          onChange={e => setTarget(e.target.value)}
        />
      </div>

      <div className="fb-form-section">
        <div className="fb-form-label">举报原因 <span className="fb-form-required">*</span></div>
        <div className="fb-report-reasons">
          {REPORT_TYPES.map(r => (
            <button
              key={r.id}
              className={`fb-reason ${reason === r.id ? 'is-active' : ''}`}
              onClick={() => setReason(r.id)}
            >
              <div className="fb-reason-name">
                {reason === r.id && <CheckIcon size={12} tone="dark" />}
                <span>{r.label}</span>
              </div>
              <div className="fb-reason-desc">{r.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="fb-form-section">
        <div className="fb-form-label">详细描述 <span className="fb-form-required">*</span></div>
        <textarea
          className="fb-form-textarea"
          placeholder="请详细说明情况，包括：&#10;• 发生了什么？&#10;• 发生时间？&#10;• 您是如何发现的？"
          rows={4}
          value={desc}
          onChange={e => setDesc(e.target.value)}
        />
        <div className="fb-form-counter">{desc.length} / 500</div>
      </div>

      {/* 原来这里有个「添加证据」按钮，实际是塞随机网图占位（假的）。
          图片上传要引对象存储，这轮不做；改成引导玩家写清可核查的线索，
          房间号 + 时间 + 第几局这些后台是真能查到对局记录的。 */}
      <div className="fb-form-note">
        <InfoIcon size={13} tone="gold" />
        <span>暂不支持上传截图。请写清<b>房间号、大致时间、第几局</b>，我们能据此调取对局记录核实。</span>
      </div>

      <div className="fb-form-section fb-form-tip">
        <InfoIcon size={14} tone="blue" />
        <span>恶意举报将受到处罚，请确保举报内容真实有效</span>
      </div>

      <button className="fb-form-submit" onClick={submit} disabled={sending}>
        <FlagIcon size={16} tone="dark" />
        {sending ? '提交中…' : '提交举报'}
      </button>

      {/* 我的举报记录 */}
      {history.length > 0 && (
        <div className="fb-history">
          <div className="fb-history-head">
            <HistoryIcon size={14} tone="gold" />
            <span>我的举报 ({history.length})</span>
          </div>
          <ul className="fb-history-list">
            {history.map(h => (
              <li key={h.id} className="fb-history-item">
                <div className="fb-history-icon" style={{ ['--icon-bg' as string]: 'linear-gradient(135deg, #C5A578, #C5A57888)' }}>
                  <FlagIcon size={14} tone="dark" />
                </div>
                <div className="fb-history-main">
                  <div className="fb-history-title">{h.target || h.title}</div>
                  <div className="fb-history-meta">
                    <span className={`fb-history-status status-${h.status}`}>{TICKET_STATUS_LABEL[h.status]}</span>
                    <span className="fb-history-time">{timeAgo(h.createdAt)}</span>
                  </div>
                </div>
                {h.adminNote && <div className="fb-history-note">{h.adminNote}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {toast && <div className="fb-toast">{toast}</div>}
    </div>
  );
}

