// ===== 牌桌 v4 Mock 预览 =====
// 4 个场景：叫主中 / 扣底中 / 对战出牌 / 对方出牌中

import { useState, useMemo } from 'react';
import { VoiceRecorder, isVoiceSupported } from '../utils/voice';
import { TableV4, type HandCardData, type TableV4Player, type TrickPlay } from '../components/TableV4';
import { OrientationLock } from '../components/OrientationLock';
import { showToast } from '../utils/toast';

/** mock 全局固定主花色黑桃（下面 TableV4 的 mainSuit="♠" 必须与此一致）。 */
const MOCK_MAIN_SUIT = '♠';

/**
 * mock 里也要算主牌归属，否则走查看不到主牌角标。
 * 主牌 = 主花色整门 + 所有花色的 7 和 2 + 大小王（副花色的 7/2 也是主，这点最反直觉）。
 * 这份判定必须跟 utils/cardUtils.isMainCard 保持同一套规则 —— mock 用的是
 * 花色符号而不是 Suit 枚举，没法直接复用那个函数，所以在这里重写一遍。
 */
function mockIsMain(rank: string, suit: string, isJoker: boolean): boolean {
  if (isJoker) return true;
  if (rank === '7' || rank === '2') return true;
  return suit === MOCK_MAIN_SUIT;
}

// 工具：造一张牌
function c(rank: string, suit: string, color: 'red' | 'black', i: number, isJoker = false, jokerType?: 'big'|'small'): HandCardData {
  return {
    id: `${rank}-${suit}-${i}`, rank, suit, color, isJoker, jokerType,
    isMain: mockIsMain(rank, suit, isJoker),
    isTianWang: !isJoker && suit === MOCK_MAIN_SUIT && rank === '3',
  };
}

// 叫主阶段的手牌（按大小+同花色排列，主7黑桃）
const HAND_CALLING: HandCardData[] = [
  // 主牌
  /* rank 必须写中文「大王」：真实链路上 toHandCard 给的就是中文
     （tableV4Transform.test.ts 里专门锁了「曾显示英文 JOKER」这个回归）。
     mock 里留着 'JOKER' 会让走查看到一个真实游戏里不存在的形态 ——
     5 个字母在 23px 宽的可见竖条里换行撑满整张牌，实测把主牌角标压掉 212px²。 */
  { id: 'bj-1', rank: '大王', suit: '', color: 'red', isJoker: true, jokerType: 'big', isMain: true },
  c('3', '♠', 'black', 1),   // 天王（主花色3），走查「王」标注
  c('7', '♠', 'black', 1),
  c('7', '♦', 'red', 1),
  c('7', '♦', 'red', 2),
  // 黑桃
  c('K', '♠', 'black', 1),
  c('J', '♠', 'black', 1),
  c('J', '♠', 'black', 2),
  c('10', '♠', 'black', 1),
  c('9', '♠', 'black', 1),
  c('6', '♠', 'black', 1),
  // 红桃
  c('A', '♥', 'red', 1),
  c('K', '♥', 'red', 1),
  c('Q', '♥', 'red', 1),
  c('J', '♥', 'red', 1),
  c('10', '♥', 'red', 1),
  c('10', '♥', 'red', 2),
  c('8', '♥', 'red', 1),
  c('5', '♥', 'red', 1),
  c('4', '♥', 'red', 1),
  c('3', '♥', 'red', 1),
  // 梅花
  c('A', '♣', 'black', 1),
  c('10', '♣', 'black', 1),
  c('9', '♣', 'black', 1),
  c('6', '♣', 'black', 1),
  c('5', '♣', 'black', 1),
  c('4', '♣', 'black', 1),
  // 方块
  c('Q', '♦', 'red', 1),
];

// 手牌张数：单副 24 张到三副 48 张都要能排得下，走查时用切换器压极限。
// （规则里每人手牌最多 48 张 —— 三人三副牌）
const HAND_SIZES = [27, 32, 48] as const;
const SUIT_POOL: Array<[string, 'red' | 'black']> = [['♠', 'black'], ['♥', 'red'], ['♣', 'black'], ['♦', 'red']];
const RANK_POOL = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

/** 造 n 张手牌：先用 mock 里那手真实牌，不够的按「花色成组」补齐，
 *  这样补出来的牌仍然是按花色聚在一起的，能真实反映挤压情况。 */
function buildHand(n: number): HandCardData[] {
  if (n <= HAND_CALLING.length) return HAND_CALLING.slice(0, n);
  const out = [...HAND_CALLING];
  let i = 0;
  while (out.length < n) {
    const [suit, color] = SUIT_POOL[Math.floor(i / RANK_POOL.length) % SUIT_POOL.length];
    const rank = RANK_POOL[i % RANK_POOL.length];
    out.push(c(rank, suit, color, 900 + i));
    i++;
  }
  return out;
}

// 玩家
const PLAYERS: TableV4Player[] = [
  { id: 'p-left',  name: 'vid_**1',   rankLabel: '◆ 大师II', rankLevel: 'red',   coins: 6706, position: 'left',  handCount: 25, isTurn: false },
  { id: 'p-right', name: '默认帐号..', rankLabel: '◆ 大师I',  rankLevel: 'red',   coins: 7478, position: 'right', handCount: 25, isTurn: false },
  { id: 'p-top',   name: '游客1250..', rankLabel: '普通III',   rankLevel: 'green', coins: 8945, position: 'top',   handCount: 25, isTurn: false },
];

// 场景定义
type ScenarioKey = 'waiting' | 'calling' | 'bidding' | 'discarding' | 'playing' | 'playing_multi' | 'waiting_turn';

// callingStage 决定中央放「花色按钮」还是「叫分加减器」，两者高度差很多，
// 手机端排版必须分别验证，所以 mock 里各给一个场景。
const SCENARIOS: Record<ScenarioKey, { label: string; phase: any; callingStage?: 'suit' | 'score' }> = {
  waiting:       { label: '准备阶段', phase: 'waiting' },
  calling:       { label: '叫主中',   phase: 'calling', callingStage: 'suit' },
  bidding:       { label: '叫分中',   phase: 'calling', callingStage: 'score' },
  discarding:    { label: '扣底中',   phase: 'discarding' },
  playing:       { label: '对战出牌', phase: 'playing' },
  // 甩牌/拖拉机场景：每家一次出多张，是牌阵最容易挤在一起的形态，必须单独验
  playing_multi: { label: '多张甩牌', phase: 'playing' },
  waiting_turn:  { label: '对方回合', phase: 'playing' },
};

/** mock 预览用的录音器：只验证「按住能否真的开麦」，采到的分片直接丢掉。 */
const mockRecorder = new VoiceRecorder();

export function GameMockPreviewV4() {
  const [scenario, setScenario] = useState<ScenarioKey>('calling');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [handSize, setHandSize] = useState<number>(27);
  // 语音按钮在 mock 里也走真实的麦克风授权流程，方便单独验证交互与样式
  const [isTalking, setIsTalking] = useState(false);
  /* 麦克风实时电平（0~1）：驱动按钮上方那条音量格。mock 里也接真实电平，
     因为「按住说话没反馈」这个问题只有拿真麦克风才走查得出来。 */
  const [micLevel, setMicLevel] = useState(0);
  /** 听筒开关：mock 里只切 UI，用来走查按钮的两种形态。 */
  const [voiceMuted, setVoiceMuted] = useState(false);

  const sc = SCENARIOS[scenario];
  const hand = buildHand(handSize);
  /* mock 里给一个真实的截止时间，用来走查叫主/叫分/扣底的倒计时。
     叫主叫分服务端给 15 秒，扣底 60 秒，这里按阶段取对应值。 */
  const [deadlineBase] = useState(() => Date.now());
  const turnDeadline = useMemo(() => {
    const secs = scenario === 'discarding' ? 60 : 15;
    return deadlineBase + secs * 1000;
  }, [deadlineBase, scenario]);

  // 牌阵
  /* 牌阵。isLeader/isWinner 要落在**不同**座位才走查得出两个标签的区别：
     左家先出（定门），右家用更大的 A 压过去 —— 这正是实战最常见的形态。 */
  const trickCards: TrickPlay[] = scenario === 'playing' ? [
    { seat: 1, cards: [ c('A', '♠', 'black', 1) ], isWinner: true },  // 右家 A 压着
    { seat: 2, cards: [ c('K', '♠', 'black', 2) ] },                  // 对家
    { seat: 3, cards: [ c('Q', '♠', 'black', 3) ], isLeader: true },  // 左家领出
  ] : scenario === 'playing_multi' ? [
    /* 每家甩 3 张（拖拉机/甩牌）。这是牌阵最挤的真实形态：
       各方位的牌组一变宽就会横向撞在一起，单张场景量不出这个问题。
       必须**含 seat 0（自己打出的牌）**：底部那一组最靠近手牌行，
       只放对手的牌量不出「自己的牌被手牌盖住」这个问题。 */
    { seat: 0, cards: [ c('8', '♣', 'black', 1), c('8', '♣', 'black', 2), c('7', '♣', 'black', 3) ] },
    { seat: 1, cards: [ c('A', '♠', 'black', 1), c('A', '♠', 'black', 2), c('K', '♠', 'black', 3) ], isWinner: true },
    { seat: 2, cards: [ c('10', '♥', 'red', 1), c('10', '♥', 'red', 2), c('9', '♥', 'red', 3) ] },
    { seat: 3, cards: [ c('Q', '♦', 'red', 1), c('Q', '♦', 'red', 2), c('J', '♦', 'red', 3) ], isLeader: true },
  ] : scenario === 'waiting_turn' ? [
    // 只有一家出牌时，首家自己就是最大的 —— 按约定只标「先出」，不标「压」
    { seat: 1, cards: [ c('10', '♥', 'red', 1) ], isLeader: true },
  ] : [];

  const isMyTurn = scenario === 'playing' || scenario === 'playing_multi' || scenario === 'calling'
    || scenario === 'bidding' || scenario === 'discarding';

  // 扣底底牌
  const bottomCards: HandCardData[] = scenario === 'discarding' ? [
    c('5', '♠', 'black', 101),
    c('10', '♠', 'black', 102),
    c('K', '♠', 'black', 103),
    c('Q', '♠', 'black', 104),
    c('A', '♠', 'black', 105),
    c('2', '♠', 'black', 106),
    c('10', '♥', 'red', 107),
    c('10', '♦', 'red', 108),
  ] : [];

  const handleToggle = (card: HandCardData) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      return next;
    });
  };

  /* isTurn 只该给对手座位（自己在底栏，用 .tv4-me.is-turn 那套）。
     原来 playing 场景把 isTurn 给了 position:'bottom'，但 PLAYERS 里压根没有
     bottom 这一项 —— 等于永远没人亮，「对方回合」高亮走查不到。
     现在 waiting_turn 场景给右家亮，正好对应它出的那张♥10。 */
  /* isLeader = 这一墩是谁先出的（定门的人），出完牌也仍然亮着，
     和 isTurn（现在轮到谁动作）是两回事 —— 走查时必须让两者落在不同座位，
     才能看出「先出」金标 + 「跟牌中」青标的区分；否则两个标签叠在同一家，
     看起来像是重复渲染。这里固定给左家，右家拿 isTurn。 */
  const players = PLAYERS.map(p => ({
    ...p,
    isTurn: scenario === 'waiting_turn' && p.position === 'right',
    isLeader: sc.phase === 'playing' && p.position === 'left',
  }));

  return (
    <div style={{ width: '100%', height: '100vh', background: '#111', overflow: 'hidden' }}>
      <OrientationLock />

      {/* 场景切换器 */}
      <div style={{
        position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 6, zIndex: 100,
        padding: '6px 10px', background: 'rgba(0,0,0,0.5)', borderRadius: 8,
        backdropFilter: 'blur(8px)',
      }}>
        {(Object.keys(SCENARIOS) as ScenarioKey[]).map(k => (
          <button
            key={k}
            onClick={() => { setScenario(k); setSelectedIds(new Set()); }}
            style={{
              padding: '5px 12px', fontSize: 12, borderRadius: 6,
              border: '1px solid ' + (k === scenario ? '#FCD34D' : 'rgba(255,255,255,0.15)'),
              background: k === scenario ? 'rgba(252,211,77,0.2)' : 'rgba(255,255,255,0.05)',
              color: k === scenario ? '#FDE68A' : 'rgba(255,255,255,0.7)',
              cursor: 'pointer', fontWeight: k === scenario ? 700 : 500,
            }}
          >
            {SCENARIOS[k].label}
          </button>
        ))}
        <div style={{ width: 1, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
        {HAND_SIZES.map(n => (
          <button
            key={n}
            onClick={() => { setHandSize(n); setSelectedIds(new Set()); }}
            style={{
              padding: '5px 10px', fontSize: 12, borderRadius: 6,
              border: '1px solid ' + (n === handSize ? '#7DD3FC' : 'rgba(255,255,255,0.15)'),
              background: n === handSize ? 'rgba(125,211,252,0.2)' : 'rgba(255,255,255,0.05)',
              color: n === handSize ? '#BAE6FD' : 'rgba(255,255,255,0.7)',
              cursor: 'pointer', fontWeight: n === handSize ? 700 : 500,
            }}
          >{n}张</button>
        ))}
        <div style={{ width: 1, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
        <button
          onClick={() => window.history.back()}
          style={{
            padding: '5px 12px', fontSize: 12, borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer',
          }}
        >返回</button>
      </div>

      {/* 牌桌 */}
      <div style={{ width: '100%', height: '100%' }}>
        <TableV4
          phase={sc.phase as any}
          callingStage={sc.callingStage}
          canBid={scenario === 'bidding' || scenario === 'calling'}
          availableSuits={['♠', '♦']}
          mainSuit="♠"
          mainRank="7"
          catchScore={scenario === 'calling' ? 0 : 45}
          players={players}
          handCards={scenario === 'discarding' ? hand.slice(0, hand.length - 8) : hand}
          selectedIds={selectedIds}
          onCardToggle={handleToggle}
          turnDeadline={turnDeadline}
          bubbleText="很抱歉，本轮没有牌可以抢主"
          antiHintText="当前主牌花色黑桃7"
          trickCards={trickCards}
          isMyTurn={isMyTurn}
          bottomCards={bottomCards}
          discardCount={scenario === 'discarding' ? Math.max(0, 8 - bottomCards.length) : 0}
          stagedCount={scenario === 'discarding' ? bottomCards.length : 0}
          onUnstageDiscard={(cards?: any[]) => {
            showToast(cards?.length ? '取回 1 张（mock 预览）' : '全部取回（mock 预览）', 'info');
          }}
          bottomScore={1200}
          multiplier={1}
          myName="飞龙洪泽.."
          myCoins={5700}
          myRankLabel="新人I"
          /* 牌型标签：mock 里按选中张数给个示意值（真实判定在 utils/pattern.ts，
             走查这里只为验证标签的排版不会把「撤回」按钮挤出选牌条）。 */
          selectedPattern={
            selectedIds.size === 0 ? ''
            : selectedIds.size === 1 ? '单张'
            : selectedIds.size === 2 ? '对子'
            : selectedIds.size === 4 ? '拖拉机×2'
            : `${selectedIds.size} 张`
          }
          selectedPatternNamed={selectedIds.size === 1 || selectedIds.size === 2 || selectedIds.size === 4}
          hintCardIds={scenario === 'playing' ? ['A-♠-1', 'K-♠-1'] : []}
          /* 提示轮转角标：mock 里固定展示"第 2 / 5 套"，方便走查它不会溢出/被裁 */
          hintInfo={scenario === 'playing' ? { seq: 1, index: 1, total: 5 } : null}
          onAction={() => {
            let btn = '确定';
            if (scenario === 'waiting') btn = '准备';
            else if (scenario === 'calling') btn = '不叫';
            else if (scenario === 'discarding') btn = '扣底';
            else if (scenario === 'playing') btn = '出牌';
            else if (scenario === 'waiting_turn') btn = '(对方回合)';
            showToast('点击了：' + btn + '（mock 预览）', 'info');
          }}
          onAntiSuit={(suit) => {
            showToast('点击了反主：' + suit + '（mock 预览）', 'info');
          }}

          /* 语音：mock 里真的开麦（验证权限与交互），但不发送分片。
             左家固定显示"正在说话"，用来走查座位上的声波标样式。 */
          voiceSupported={isVoiceSupported()}
          isTalking={isTalking}
          micLevel={micLevel}
          speakingIds={scenario === 'playing' ? ['p-left'] : []}
          voiceMuted={voiceMuted}
          onToggleVoiceMuted={() => setVoiceMuted(v => !v)}
          onVoiceStart={async () => {
            try {
              await mockRecorder.start(
                () => { /* mock：采到的分片直接丢弃 */ },
                () => { setIsTalking(false); setMicLevel(0); },
                (lv) => setMicLevel(lv),
              );
              setIsTalking(true);
              showToast('已开麦（mock 预览，不会发送）', 'ok');
              return true;
            } catch {
              return false;
            }
          }}
          onVoiceStop={() => {
            mockRecorder.stop();
            setIsTalking(false);
            /* 不清零的话电平条会停在最后一帧的高度，看着像还在录音 */
            setMicLevel(0);
          }}
        />
      </div>
    </div>
  );
}
