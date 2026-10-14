// ===== 结算弹窗预览（dev only） =====
// 访问路径: /?dev=settle-preview

import { useState } from 'react';
import { Settlement } from '../components/Settlement';
import type { SettlementResult, Player, Card as CardType, Suit, Rank, AuctionEntry } from '../types';
import { showToast } from '../utils/toast';


function makeCard(suit: Suit, rank: Rank, id: string): CardType {
  return { suit, rank, id };
}

/**
 * 给 mock 场景补齐 v4 结算页新增的两块数据。
 *
 * 手写 5 个场景 × 4 家的最后一手太啰嗦，而且预览的目的是**看排版**，
 * 牌面具体是什么不重要，重要的是「四列都有牌、赢家那列被点亮」。
 * 所以这里按规则生成：赢家用 finalCards，其余三家各给同样张数的杂牌。
 */
function fillEvidence(
  result: SettlementResult,
  opts: { bankerSeat: number; suitCaller: number; stealer?: number; bidders: [number, number][] },
): SettlementResult {
  const n = result.levelDeltas.length;
  const per = Math.max(1, result.finalCards.length);
  const filler: [Suit, Rank][] = [
    ['heart', '4'], ['club', '6'], ['diamond', '8'], ['heart', '9'],
    ['club', 'J'], ['diamond', 'Q'],
  ];
  const lastTrickPlays = Array.from({ length: n }, (_, seat) => ({
    seat,
    cards: seat === result.lastTrickWinner
      ? result.finalCards
      : Array.from({ length: per }, (_, i) => {
          const [suit, rank] = filler[(seat * 2 + i) % filler.length];
          return makeCard(suit, rank, `lt-${seat}-${i}`);
        }),
  }));

  const names = ['东家', '北家', '西家', '南家'];
  const auctionLog: AuctionEntry[] = [
    {
      kind: 'call_suit', seatIndex: opts.suitCaller, playerName: names[opts.suitCaller],
      suit: 0, sevenCount: 1, score: 0,
    },
  ];
  if (opts.stealer !== undefined) {
    auctionLog.push({
      kind: 'steal_suit', seatIndex: opts.stealer, playerName: names[opts.stealer],
      suit: 0, sevenCount: 2, score: 0,
    });
  }
  for (const [seat, score] of opts.bidders) {
    auctionLog.push(
      score > 0
        ? { kind: 'bid', seatIndex: seat, playerName: names[seat], suit: 255, sevenCount: 0, score }
        : { kind: 'pass_bid', seatIndex: seat, playerName: names[seat], suit: 255, sevenCount: 0, score: 0 },
    );
  }
  return { ...result, lastTrickPlays, auctionLog };
}

// 不同场景的 mock data
const scenarios = {
  rankUp: {
    label: '段位提升（白银→黄金）',
    result: {
      bankerWin: false,
      finisherSeat: 1,
      finisherIsBanker: false,
      level: 5,
      levelDeltas: [0, 5, 0, 0] as number[],
      callScore: 100,
      opponentScore: 235,
      bankerScore: 65,
      scoreLevel: 4,
      digLevel: 0,
      trickScore: 200,
      endingTableScore: 0,
      remainingScore: 0,
      bottomScore: 35,
      bottomTaken: true,
      digSuccess: true,
      digTianWangCount: 1,
      digBigJokerCount: 1,
      digSmallJokerCount: 0,
      digGuaranteeLevel: 4,
      lastTrickWinner: 1,
      finalCards: [
        { suit: 'spade', rank: 'A', id: 'sA-1' } as CardType,
        { suit: 'spade', rank: 'K', id: 'sK-1' } as CardType,
        { suit: 'spade', rank: '2', id: 's2-1' } as CardType,
      ],
      bottomCards: [
        { suit: 'spade', rank: '5',  id: 's5-1'  } as CardType,
        { suit: 'spade', rank: '10', id: 's10-1' } as CardType,
        { suit: 'spade', rank: 'K',  id: 'sK-2'  } as CardType,
        { suit: 'spade', rank: 'Q',  id: 'sQ-1'  } as CardType,
        { suit: 'spade', rank: 'A',  id: 'sA-2'  } as CardType,
        { suit: 'spade', rank: '2',  id: 's2-2'  } as CardType,
      ],
      bankerRemainingCards: [] as CardType[],
    } as SettlementResult,
    players: [
      { id: 'p0', name: '老王(庄)', seatIndex: 0, isBanker: true,  score: 6,  takenScore: 0,   handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: false, isOwner: true,  isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p1', name: '我',       seatIndex: 1, isBanker: false, score: 22, takenScore: 235, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: false, isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p2', name: '阿强',     seatIndex: 2, isBanker: false, score: 4,  takenScore: 0,   handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: true,  isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p3', name: '翠花',     seatIndex: 3, isBanker: false, score: 3,  takenScore: 0,   handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: true,  isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
    ] as Player[],
  },
  bankerWinLose: {
    label: '庄家赢（我是闲家，输）',
    result: {
      bankerWin: true,
      finisherSeat: 0,
      finisherIsBanker: true,
      level: 1,
      levelDeltas: [1, -1, -1, -1] as number[],
      callScore: 80,
      opponentScore: 35,
      bankerScore: 65,
      scoreLevel: 1,
      digLevel: 0,
      trickScore: 35,
      endingTableScore: 0,
      remainingScore: 0,
      bottomScore: 50,
      bottomTaken: false,
      digSuccess: false,
      digTianWangCount: 0,
      digBigJokerCount: 0,
      digSmallJokerCount: 0,
      digGuaranteeLevel: 0,
      lastTrickWinner: 0,
      finalCards: [
        makeCard('heart', 'A', 'hA-0'),
        makeCard('heart', 'K', 'hK-0'),
        makeCard('spade', 'A', 'sA-0'),
      ] as CardType[],
      bottomCards: [
        makeCard('heart', '5', 'h5-0'),
        makeCard('diamond', '10', 'd10-0'),
        makeCard('club', 'K', 'cK-0'),
        makeCard('spade', '5', 's5-0'),
        makeCard('spade', '10', 's10-0'),
        makeCard('club', '10', 'c10-0'),
      ] as CardType[],
      bankerRemainingCards: [] as CardType[],
    } as SettlementResult,
    players: [
      { id: 'p0', name: '东家(庄)', seatIndex: 0, isBanker: true, score: 12, takenScore: 65, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: false, isOwner: true, isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p1', name: '我（北）',   seatIndex: 1, isBanker: false, score: 8,  takenScore: 15, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: false, isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p2', name: 'AI-西',      seatIndex: 2, isBanker: false, score: 5,  takenScore: 10, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: true,  isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p3', name: 'AI-南',      seatIndex: 3, isBanker: false, score: 3,  takenScore: 10, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: true,  isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
    ] as Player[],
  },

  defenderDigWin: {
    label: '闲家挖底（我赢 +3 级）',
    result: {
      bankerWin: false,
      finisherSeat: 1,
      finisherIsBanker: false,
      level: 3,
      levelDeltas: [-1, 3, 3, 3] as number[],
      callScore: 60,
      opponentScore: 135,
      bankerScore: 15,
      scoreLevel: 2,
      digLevel: 3,
      trickScore: 100,
      endingTableScore: 35,
      remainingScore: 0,
      bottomScore: 80,
      bottomTaken: true,
      digSuccess: true,
      digTianWangCount: 1,
      digBigJokerCount: 0,
      digSmallJokerCount: 0,
      digGuaranteeLevel: 3,
      lastTrickWinner: 1,
      finalCards: [
        makeCard('spade', '3', 's3-0'),  // 天王
        makeCard('spade', '5', 's5-0'),
        makeCard('spade', '10', 's10-0'),
        makeCard('spade', 'K', 'sK-0'),
      ] as CardType[],
      bottomCards: [
        makeCard('heart', '5', 'h5-0'),
        makeCard('diamond', '5', 'd5-0'),
        makeCard('club', '5', 'c5-0'),
        makeCard('spade', '10', 's10-0'),
        makeCard('heart', '10', 'h10-0'),
        makeCard('diamond', '10', 'd10-0'),
        makeCard('club', 'K', 'cK-0'),
        makeCard('spade', 'K', 'sK-0'),
        makeCard('heart', 'K', 'hK-0'),
        makeCard('diamond', 'K', 'dK-0'),
        makeCard('heart', '7', 'h7-0'),
        makeCard('club', '7', 'c7-0'),
      ] as CardType[],
      bankerRemainingCards: [] as CardType[],
    } as SettlementResult,
    players: [
      { id: 'p0', name: '东家(庄)', seatIndex: 0, isBanker: true,  score: 10, takenScore: 15, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: false, isOwner: true,  isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p1', name: '我（北）',   seatIndex: 1, isBanker: false, score: 25, takenScore: 60, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: false, isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p2', name: 'AI-西',      seatIndex: 2, isBanker: false, score: 18, takenScore: 40, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: true,  isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p3', name: 'AI-南',      seatIndex: 3, isBanker: false, score: 22, takenScore: 35, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: true,  isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
    ] as Player[],
  },

  bigDig: {
    label: '挖底保底 4 级（2 张天王）',
    result: {
      bankerWin: false,
      finisherSeat: 1,
      finisherIsBanker: false,
      level: 4,
      levelDeltas: [-2, 4, 4, 4] as number[],
      callScore: 40,
      opponentScore: 175,
      bankerScore: 5,
      scoreLevel: 3,
      digLevel: 4,
      trickScore: 145,
      endingTableScore: 30,
      remainingScore: 0,
      bottomScore: 100,
      bottomTaken: true,
      digSuccess: true,
      digTianWangCount: 2,
      digBigJokerCount: 0,
      digSmallJokerCount: 0,
      digGuaranteeLevel: 4,
      lastTrickWinner: 1,
      finalCards: [
        makeCard('spade', '3', 's3-0'),
        makeCard('heart', '3', 'h3-0'),
        makeCard('joker', 'big_joker', 'jB-0'),
        makeCard('spade', 'A', 'sA-0'),
        makeCard('heart', 'A', 'hA-0'),
      ] as CardType[],
      bottomCards: [
        makeCard('heart', '5', 'h5-0'),
        makeCard('diamond', '5', 'd5-0'),
        makeCard('club', '5', 'c5-0'),
        makeCard('spade', '10', 's10-0'),
        makeCard('heart', '10', 'h10-0'),
        makeCard('diamond', '10', 'd10-0'),
        makeCard('club', 'K', 'cK-0'),
        makeCard('spade', 'K', 'sK-0'),
        makeCard('heart', 'K', 'hK-0'),
        makeCard('diamond', 'K', 'dK-0'),
        makeCard('spade', 'A', 'sA-0'),
        makeCard('heart', 'A', 'hA-0'),
      ] as CardType[],
      bankerRemainingCards: [] as CardType[],
    } as SettlementResult,
    players: [
      { id: 'p0', name: '东家(庄)', seatIndex: 0, isBanker: true,  score: 8,  takenScore: 5,  handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: false, isOwner: true,  isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p1', name: '我（北）',   seatIndex: 1, isBanker: false, score: 35, takenScore: 80, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: false, isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p2', name: '阿强',        seatIndex: 2, isBanker: false, score: 24, takenScore: 50, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: true,  isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p3', name: '老王',        seatIndex: 3, isBanker: false, score: 28, takenScore: 45, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: true,  isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
    ] as Player[],
  },

  loseBig: {
    label: '惨败（我输 4 级）',
    result: {
      bankerWin: true,
      finisherSeat: 0,
      finisherIsBanker: true,
      level: 4,
      levelDeltas: [4, -4, -4, -4] as number[],
      callScore: 100,
      opponentScore: 0,
      bankerScore: 100,
      scoreLevel: 4,
      digLevel: 0,
      trickScore: 0,
      endingTableScore: 0,
      remainingScore: 0,
      bottomScore: 60,
      bottomTaken: false,
      digSuccess: false,
      digTianWangCount: 0,
      digBigJokerCount: 0,
      digSmallJokerCount: 0,
      digGuaranteeLevel: 0,
      lastTrickWinner: 0,
      finalCards: [
        makeCard('spade', 'A', 'sA-0'),
        makeCard('spade', 'K', 'sK-0'),
        makeCard('spade', 'Q', 'sQ-0'),
        makeCard('spade', 'J', 'sJ-0'),
      ] as CardType[],
      bottomCards: [
        makeCard('heart', '5', 'h5-0'),
        makeCard('heart', '10', 'h10-0'),
        makeCard('heart', 'K', 'hK-0'),
        makeCard('diamond', '5', 'd5-0'),
        makeCard('diamond', '10', 'd10-0'),
        makeCard('diamond', 'K', 'dK-0'),
      ] as CardType[],
      bankerRemainingCards: [] as CardType[],
    } as SettlementResult,
    players: [
      { id: 'p0', name: '东家(庄)', seatIndex: 0, isBanker: true,  score: 30, takenScore: 100, handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: false, isOwner: true,  isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p1', name: '我（北）',   seatIndex: 1, isBanker: false, score: 5,  takenScore: 0,   handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: false, isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p2', name: 'AI-西',      seatIndex: 2, isBanker: false, score: 12, takenScore: 0,   handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: true,  isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
      { id: 'p3', name: 'AI-南',      seatIndex: 3, isBanker: false, score: 8,  takenScore: 0,   handCount: 0, isReady: false, isCalling: false, isOffline: false, isAI: true,  isOwner: false, isAutoPlay: false, isTrusteeByOffline: false },
    ] as Player[],
  },
} as const;

type ScenarioKey = keyof typeof scenarios;

export function SettlementPreview() {
  const [key, setKey] = useState<ScenarioKey>('defenderDigWin');
  const s = scenarios[key];
  /* 每个场景的叫牌过程都不一样（有没有抢主、谁叫的分），
   * 在这里按场景补，而不是在 mock 里写死 5 份重复数据。 */
  const result = fillEvidence(s.result, {
    bankerSeat: 0,
    suitCaller: key === 'loseBig' ? 0 : 2,
    stealer: key === 'defenderDigWin' || key === 'bigDig' ? 0 : undefined,
    bidders: [[2, 125], [3, 0], [1, 120], [0, s.result.callScore]],
  });
  return (
    <div style={{ minHeight: '100dvh', background: '#050304' }}>
      {/* 顶部：场景切换器 */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999,
        padding: '10px 14px',
        background: 'rgba(20, 12, 6, 0.95)',
        borderBottom: '1px solid rgba(212, 168, 44, 0.3)',
        display: 'flex', alignItems: 'center', gap: 8,
        flexWrap: 'wrap',
      }}>
        <span style={{ color: '#ffd45f', fontWeight: 800, fontSize: 12 }}>DEV PREVIEW</span>
        <span style={{ color: 'rgba(255, 248, 224, 0.5)', fontSize: 11 }}>选择场景：</span>
        {Object.entries(scenarios).map(([k, v]) => (
          <button
            key={k}
            onClick={() => setKey(k as ScenarioKey)}
            style={{
              padding: '5px 10px',
              border: '1px solid ' + (k === key ? '#ffd45f' : 'rgba(255,255,255,0.18)'),
              borderRadius: 999,
              background: k === key ? 'rgba(255, 212, 95, 0.18)' : 'transparent',
              color: k === key ? '#ffd45f' : '#fff8e0',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >{v.label}</button>
        ))}
      </div>
      <div style={{ paddingTop: 60 }}>
        <Settlement
          result={result}
          players={s.players}
          mySeat={1}
          bankerSeat={0}
          mainSuit="spade"
          modeName="4人 3副"
          onNext={() => showToast('dev 预览：下一局', 'info')}
          onReturnLobby={() => showToast('dev 预览：返回大厅', 'info')}
        />
      </div>
    </div>
  );
}
