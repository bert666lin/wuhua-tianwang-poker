// ===== 结算页的数据整理（纯函数） =====
//
// 为什么单独一个文件：结算页原来是 9 个平级区块平铺，什么都有、什么都不突出。
// 重做成「大字战果 + 牌面证据 + 折叠明细」之后，「谁叫的主」「底牌归谁」
// 「各家最后一手」这些都要先算清楚再渲染。这些判断有明确的对错
// （比如"抢主的人不是叫主的人"、"底牌分只在闲家赢最后一墩时归闲家"），
// 埋在 JSX 里就没法测 —— 而它们算错等于结算页在骗玩家。
//
// 渲染相关的东西（className、动画时长）不放这里，只放"事实"。

import type { AuctionEntry, Card, SettlementResult, Suit } from '../types';

// ===== 底牌归属 =====

export interface BottomFate {
  /** 底牌一共多少分。 */
  score: number;
  /** 底牌张数。 */
  count: number;
  /** 这些分最终算给了闲家吗。 */
  toOpponent: boolean;
  /** 徽章短文案，如「归闲家」。 */
  badge: string;
  /** 一句话说清为什么，给不熟规则的人看。 */
  reason: string;
}

/**
 * 底牌分归谁。
 *
 * 这是玩家最容易算错的一块：底牌分归属只看「最后一墩是不是闲家赢的」，
 * 用普通牌赢也算；天王/大小王的区别只在于额外的保底级数。
 * 老结算页把这两件事混在一个「挖到/未挖到」徽章里，玩家看不出区别。
 */
export function describeBottomFate(result: {
  bottomScore: number;
  bottomCards: Card[];
  bottomTaken: boolean;
  digSuccess: boolean;
  digGuaranteeLevel: number;
}): BottomFate {
  if (!result.bottomTaken) {
    return {
      score: result.bottomScore,
      count: result.bottomCards.length,
      toOpponent: false,
      badge: '庄家守住',
      reason: `庄家赢下最后一墩，底牌这 ${result.bottomScore} 分不计入闲家`,
    };
  }
  if (result.digSuccess) {
    return {
      score: result.bottomScore,
      count: result.bottomCards.length,
      toOpponent: true,
      badge: '挖底成功',
      reason: `闲家用天王/大小王赢下最后一墩，底牌 ${result.bottomScore} 分计入闲家，另加保底 ${result.digGuaranteeLevel} 级`,
    };
  }
  return {
    score: result.bottomScore,
    count: result.bottomCards.length,
    toOpponent: true,
    badge: '归闲家',
    reason: `闲家赢下最后一墩，底牌 ${result.bottomScore} 分计入闲家（没用天王/大小王，所以没有保底级）`,
  };
}

// ===== 叫主 / 抢主 / 叫分是谁 =====

const SUIT_GLYPH = ['♠', '♥', '♦', '♣'];

/** 花色数字转符号；255 或越界返回空串。 */
export function auctionSuitGlyph(suit: number): string {
  return SUIT_GLYPH[suit] ?? '';
}

export interface AuctionSummary {
  /** 最终定主的人。翻底定主时为 null。 */
  suitOwner: { seatIndex: number; playerName: string; suit: number; sevenCount: number } | null;
  /** 主是不是翻底牌翻出来的（没人叫主）。 */
  fromBottom: boolean;
  /** 主花色（0-3），未知时 255。 */
  suit: number;
  /** 定主经历了几次抢主（第一次叫不算抢）。 */
  stealCount: number;
  /** 坐庄的人（最后一个也就是叫得最低的那个叫分者）。 */
  banker: { seatIndex: number; playerName: string; score: number } | null;
  /** 按时间顺序的可读记录，逐条给结算页/记录面板渲染。 */
  rows: { seatIndex: number; playerName: string; text: string; highlight: boolean }[];
}

/**
 * 把叫主/叫分过程整理成「谁做了什么」。
 *
 * 用户明确要求「叫主、抢主、叫分 谁叫 要标明」。之前记录面板只列了叫分，
 * 而且不带座位，四家同名（比如两个「游客」）时根本分不清是谁。
 */
export function summarizeAuction(entries: AuctionEntry[]): AuctionSummary {
  let suitOwner: AuctionSummary['suitOwner'] = null;
  let fromBottom = false;
  let suit = 255;
  let stealCount = 0;
  let banker: AuctionSummary['banker'] = null;
  const rows: AuctionSummary['rows'] = [];

  for (const e of entries) {
    switch (e.kind) {
      case 'call_suit':
        suitOwner = { seatIndex: e.seatIndex, playerName: e.playerName, suit: e.suit, sevenCount: e.sevenCount };
        suit = e.suit;
        rows.push({
          seatIndex: e.seatIndex,
          playerName: e.playerName,
          text: `叫主 ${auctionSuitGlyph(e.suit)}（亮 ${e.sevenCount} 张 7）`,
          highlight: true,
        });
        break;
      case 'steal_suit':
        suitOwner = { seatIndex: e.seatIndex, playerName: e.playerName, suit: e.suit, sevenCount: e.sevenCount };
        suit = e.suit;
        stealCount++;
        rows.push({
          seatIndex: e.seatIndex,
          playerName: e.playerName,
          text: `抢主 ${auctionSuitGlyph(e.suit)}（亮 ${e.sevenCount} 张 7）`,
          highlight: true,
        });
        break;
      case 'pass_suit':
        rows.push({ seatIndex: e.seatIndex, playerName: e.playerName, text: '不叫主', highlight: false });
        break;
      case 'bottom_suit':
        fromBottom = true;
        suitOwner = null;
        suit = e.suit;
        rows.push({
          seatIndex: 255,
          playerName: '',
          text: `无人叫主，翻底牌定主 ${auctionSuitGlyph(e.suit)}`,
          highlight: true,
        });
        break;
      case 'bid':
        // 叫分是往下叫的，最后一个叫的人分最低 -> 他坐庄
        banker = { seatIndex: e.seatIndex, playerName: e.playerName, score: e.score };
        rows.push({
          seatIndex: e.seatIndex,
          playerName: e.playerName,
          text: `叫分 ${e.score}`,
          highlight: true,
        });
        break;
      case 'pass_bid':
        rows.push({ seatIndex: e.seatIndex, playerName: e.playerName, text: '不叫分', highlight: false });
        break;
    }
  }

  return { suitOwner, fromBottom, suit, stealCount, banker, rows };
}

// ===== 最后一墩：每家一列 =====

export interface LastTrickColumn {
  seatIndex: number;
  playerName: string;
  cards: Card[];
  isBanker: boolean;
  /** 赢下这一墩的人。 */
  isWinner: boolean;
  /** 是不是我。 */
  isMe: boolean;
}

/**
 * 最后一墩按座位排成列，从「我」开始按座位顺时针。
 *
 * 从我开始排是为了对得上牌桌上的方位记忆 —— 结算页如果按 0..3 固定排，
 * 玩家得先想"我是几号位"才能看懂哪列是自己。
 *
 * 没有 lastTrickPlays 的旧数据（老服务端 / 流局）返回空数组，
 * 调用方据此决定退回只显示赢家那一手。
 */
export function buildLastTrickColumns(input: {
  lastTrickPlays: { seat: number; cards: Card[] }[];
  players: { seatIndex: number; name: string }[];
  mySeat: number;
  bankerSeat: number;
  lastTrickWinner: number;
  playerCount: number;
}): LastTrickColumn[] {
  const bySeat = new Map(input.lastTrickPlays.map(p => [p.seat, p.cards]));
  if (bySeat.size === 0) return [];
  const nameOf = new Map(input.players.map(p => [p.seatIndex, p.name]));
  const count = input.playerCount > 0 ? input.playerCount : input.players.length;
  const out: LastTrickColumn[] = [];
  for (let i = 0; i < count; i++) {
    const seat = (input.mySeat + i) % count;
    const cards = bySeat.get(seat);
    if (!cards) continue;
    out.push({
      seatIndex: seat,
      playerName: nameOf.get(seat) ?? `座位 ${seat + 1}`,
      cards,
      isBanker: seat === input.bankerSeat,
      isWinner: seat === input.lastTrickWinner,
      isMe: seat === input.mySeat,
    });
  }
  return out;
}

// ===== 顶部大字 =====

export interface HeadlineNumbers {
  /** 「赢 3 级」/「输 9 级」里的数字（我的级数变化的绝对值）。 */
  levelAbs: number;
  /** 我这局是赢还是输。 */
  iWon: boolean;
  /** 主标题，如「赢 3 级」。 */
  title: string;
  /** 闲家总分。 */
  opponentScore: number;
  /** 庄家实得分。 */
  bankerScore: number;
  /** 叫分。 */
  callScore: number;
  /** 差多少分：闲家赢时是超出叫分多少，庄家赢时是还差多少。 */
  gap: number;
  /** 一句话说明差距，如「超出叫分 30 分」。 */
  gapText: string;
}

/**
 * 顶部那行大字要显示的数。
 *
 * 用户诉求是「结算页要突出赢多少档、多少分」。这里把"档"（级数）和
 * "分"（闲家得分 vs 叫分）算在一起，避免两处各算一遍对不上。
 */
export function buildHeadline(input: {
  result: Pick<SettlementResult, 'bankerWin' | 'level' | 'levelDeltas' | 'callScore' | 'opponentScore' | 'bankerScore'>;
  mySeat: number;
  bankerSeat: number;
}): HeadlineNumbers {
  const { result } = input;
  const iAmBanker = input.mySeat === input.bankerSeat;
  const iWon = result.bankerWin === iAmBanker;
  const myDelta = result.levelDeltas?.[input.mySeat] ?? 0;
  const levelAbs = Math.abs(myDelta);
  const diff = result.opponentScore - result.callScore;
  return {
    levelAbs,
    iWon,
    title: `${iWon ? '赢' : '输'} ${levelAbs} 级`,
    opponentScore: result.opponentScore,
    bankerScore: Math.max(0, result.bankerScore),
    callScore: result.callScore,
    gap: Math.abs(diff),
    gapText: diff >= 0
      ? `闲家 ${result.opponentScore} 分，超出叫分 ${diff} 分`
      : `闲家 ${result.opponentScore} 分，离叫分还差 ${-diff} 分`,
  };
}

/** 花色中文名，分享文案与说明文字用。 */
export const SUIT_LABEL: Record<Suit, string> = {
  spade: '黑桃',
  heart: '红桃',
  diamond: '方块',
  club: '梅花',
  joker: '王牌',
};
