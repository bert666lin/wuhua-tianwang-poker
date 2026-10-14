// ===== 一局战果的「代号」=====
//
// 结算面板、牌桌横幅、房间累计战绩列表都要说出同一句话（「光头」「保底成功」…），
// 所以判定逻辑必须只有一份。这里是服务端那一份，写进 GameState.history。
//
// ⚠️ 客户端有一份同口径的 `client/src/utils/outcome.ts`（负责把代号变成中文文案
// 和动效档位）。两边只共享【代号】，不共享文案 —— 文案随时会改，代号不能改。
// outcome.test.ts 里有一条测试会直接读客户端源码交叉校验分档边界，
// 防止哪天有人只改一边导致「服务端记的是小光、客户端显示光头」。

import { getBankerWinLevel } from './levels.js';

/**
 * 战果代号。与 client/src/utils/outcome.ts 的 OutcomeKind 一一对应。
 */
export type OutcomeKind =
  | 'bald'        // 光头：庄家赢且闲家一分未得
  | 'small_bald'  // 小光：庄家赢且闲家 1~40 分
  | 'hold'        // 保底成功：庄家赢，闲家 41 分以上但没够叫分
  | 'dig'         // 挖底成功：闲家用天王/大小王赢下最后一墩
  | 'over'        // 闲家过庄：闲家赢但没挖底
  | 'flow_break'; // 流局：全员放弃叫分，主牌最多者算庄并输一级

/**
 * 小光的上限分。
 *
 * 不写死 40，而是从 `getBankerWinLevel` 反推：那个函数是「庄家赢几级」的唯一真相
 * （0 分赢 4 级、1~40 赢 2 级、41+ 赢 1 级）。如果哪天分档调了，
 * 这里会自动跟着走，不会留下一个悄悄过期的魔法数字。
 */
export const SMALL_BALD_MAX: number = (() => {
  // 1 分时的级数就是「小光档」的级数；一路往上找到它变小的那一分为止。
  const smallBaldLevel = getBankerWinLevel(1);
  for (let score = 1; score <= 400; score++) {
    if (getBankerWinLevel(score) !== smallBaldLevel) return score - 1;
  }
  // 分档函数退化成「不分档」时（理论上不该发生），保守认为没有小光档。
  return 0;
})();

export interface ResolveOutcomeInput {
  bankerWin: boolean;
  /** 闲家总得分（已含底牌分）。 */
  opponentScore: number;
  /** 闲家是否挖底成功（用天王/大小王赢下最后一墩）。 */
  digSuccess: boolean;
}

/**
 * 判定这一局的战果代号。纯函数。
 *
 * 只管「正常打完」的局。流局不走这里 —— 流局没有叫分也没有闲家分，
 * 硬套进来只会得到一个骗人的「光头」。流局由调用方直接记 'flow_break'。
 */
export function resolveOutcomeKind(input: ResolveOutcomeInput): OutcomeKind {
  if (input.bankerWin) {
    if (input.opponentScore <= 0) return 'bald';
    if (input.opponentScore <= SMALL_BALD_MAX) return 'small_bald';
    return 'hold';
  }
  return input.digSuccess ? 'dig' : 'over';
}
