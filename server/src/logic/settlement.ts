// ===== 局终结算的分数与级数计算 =====
// 从 GameRoom.ts 的 settleGame 抽出（原文件 2279 行）。
//
// 为什么值得独立：这段决定「谁赢、赢几级、闲家拿多少分」，是整局最容易出错
// 也最要紧的算术（直接换成金币和段位）。原先它埋在 settleGame 里，
// 和清计时器、改 state.phase、发广播、写数据库混在一起，没法单测。
// 现在拆成「纯算 → 房间只负责把结果写进 state 并广播」。

import { calcTrickScore } from './score.js';
import {
  calculateOpponentLevel,
  createLevelDeltas,
  evaluateDig,
  getBankerWinLevel,
} from './levels.js';
import type { CardData } from './config.js';

export interface SettlementInput {
  /** 最后一墩的赢家座位。 */
  lastTrickWinner: number;
  /** 最后一墩的制胜牌（判挖底要看有没有天王/大小王）。 */
  winningCards: CardData[];
  bankerSeat: number;
  mainSuit: number;
  /** 庄家手上未打出的牌。正常打完为空，中途异常结束才有。 */
  bankerRemainingCards: CardData[];
  /** 底牌。 */
  bottomCards: CardData[];
  /** 各座位这一局抓到的分（索引 = 座位号）。 */
  trickScores: number[];
  /** 座位是否为庄家（索引 = 座位号）。用它算闲家总抓分。 */
  isBankerBySeat: boolean[];
  callScore: number;
  deckCount: 2 | 3;
  playerCount: number;
  /** 本模式的总分，用于回推庄家得分。 */
  totalScore: number;
}

export interface SettlementResult {
  bankerWin: boolean;
  level: number;
  /** 各座位的级数增减（索引 = 座位号）。 */
  deltas: number[];
  opponentScore: number;
  bankerScore: number;
  trickScore: number;
  remainingScore: number;
  bottomScore: number;
  bottomTaken: boolean;
  scoreLevel: number;
  digLevel: number;
  digSuccess: boolean;
  digTianWangCount: number;
  digBigJokerCount: number;
  digSmallJokerCount: number;
  digGuaranteeLevel: number;
}

/**
 * 算一局的结算结果。纯函数：同样的输入永远得到同样的输出，不碰房间状态。
 */
export function computeSettlement(input: SettlementInput): SettlementResult {
  // 庄家手上未打出的牌里的分数。每家张数相同，正常打完最后一墩时为 0；
  // 只有中途异常结束才会有剩牌。
  const remainingScore = calcTrickScore(input.bankerRemainingCards);
  const bottomScore = calcTrickScore(input.bottomCards);

  // 挖底：最后一墩闲家用含天王或大小王的牌赢下。
  const dig = evaluateDig(
    input.lastTrickWinner, input.bankerSeat, input.winningCards, input.mainSuit,
  );

  // 各墩抓分只统计闲家。最后一墩的分在收墩时已记入赢家，这里不再重复累加。
  let trickScore = 0;
  for (let seat = 0; seat < input.trickScores.length; seat++) {
    if (!input.isBankerBySeat[seat]) trickScore += input.trickScores[seat] ?? 0;
  }

  let opponentScore = trickScore;
  // 庄家剩牌分（异常中断时）归闲家
  if (dig.opponentWonLastTrick) opponentScore += remainingScore;
  // 闲家赢下最后一墩就把底牌分计入闲家，用普通牌赢也算；
  // 天王/大小王的区别只体现在 dig.success 带来的保底级数上。
  if (dig.bottomTaken) opponentScore += bottomScore;

  const levelResult = calculateOpponentLevel({
    opponentScore,
    callScore: input.callScore,
    deckCount: input.deckCount,
    dig,
  });

  const bankerWin = !levelResult.opponentWon;
  const level = bankerWin ? getBankerWinLevel(opponentScore) : levelResult.finalLevel;
  const deltas = createLevelDeltas(
    input.playerCount, input.bankerSeat, bankerWin, level,
  );

  return {
    bankerWin,
    level,
    deltas,
    opponentScore,
    bankerScore: input.totalScore - opponentScore,
    trickScore,
    remainingScore,
    bottomScore,
    bottomTaken: dig.bottomTaken,
    scoreLevel: levelResult.scoreLevel,
    digLevel: levelResult.digLevel,
    digSuccess: dig.success,
    digTianWangCount: dig.tianWangCount,
    digBigJokerCount: dig.bigJokerCount,
    digSmallJokerCount: dig.smallJokerCount,
    digGuaranteeLevel: dig.guaranteeLevel,
  };
}
