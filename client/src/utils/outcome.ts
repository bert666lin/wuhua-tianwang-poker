// ===== 一局战果的「名字」=====
//
// 结算页和牌桌横幅都要用同一套叫法，所以抽成纯函数放这里，不散在 JSX 里。
// 名称口径由产品确认（2026-09 与用户逐条核对）：
//
//   庄家赢：
//     闲家 0 分            -> 光头
//     闲家 1~40 分          -> 小光
//     闲家 41 分及以上       -> 保底成功
//   闲家赢：
//     用天王/大小王赢最后一墩 -> 挖底成功（额外拿保底级）
//     用普通牌赢最后一墩     -> 闲家过庄（底牌分照样归闲家，但没有保底级）
//
// ⚠️ 1~40 这个边界跟 server/src/logic/levels.ts 的 getBankerWinLevel 是同一套
// 分档（0 分赢 4 级、1~40 赢 2 级、41+ 赢 1 级），改一处必须改两处。
// 用户原话是「1~40 分算小光」，明确沿用代码既有边界，不是 5~45。

/** 战果类型。kind 用于选样式/动效，不要用 label 做判断（文案随时会改）。 */
export type OutcomeKind =
  | 'bald'        // 光头：闲家一分未得
  | 'small_bald'  // 小光：闲家 1~40 分
  | 'hold'        // 保底成功：庄家守住，闲家 41 分以上但没够叫分
  | 'dig'         // 挖底成功：闲家用天王/大小王赢下最后一墩
  | 'over';       // 闲家过庄：闲家赢但没挖底

export interface Outcome {
  kind: OutcomeKind;
  /** 大字主标题，如「光头」。 */
  label: string;
  /** 一句话解释为什么是这个战果，给不熟规则的人看。 */
  detail: string;
  /** 庄家是否赢了这一局。 */
  bankerWin: boolean;
  /**
   * 情绪强度 0~2，决定动效档位：
   * 2 = 全屏重击（光头/挖底），1 = 明显（小光），0 = 克制（保底/过庄）。
   * 把「多大动静」和「什么战果」绑在一起，避免两边各判一次导致不一致。
   */
  intensity: 0 | 1 | 2;
}

export interface OutcomeInput {
  bankerWin: boolean;
  /** 闲家总得分（已含底牌分）。 */
  opponentScore: number;
  /** 闲家是否挖底成功（用天王/大小王赢下最后一墩）。 */
  digSuccess: boolean;
  /** 挖底带来的保底级数，仅 digSuccess 时有意义。 */
  digGuaranteeLevel?: number;
  /** 庄家叫分，用于「保底成功」的解释文案。 */
  callScore?: number;
}

/** 光头/小光的分档边界，与 levels.ts 的 getBankerWinLevel 对齐。 */
const SMALL_BALD_MAX = 40;

export function describeOutcome(input: OutcomeInput): Outcome {
  if (input.bankerWin) {
    if (input.opponentScore <= 0) {
      return {
        kind: 'bald',
        label: '光头',
        detail: '闲家一分未得，庄家通吃',
        bankerWin: true,
        intensity: 2,
      };
    }
    if (input.opponentScore <= SMALL_BALD_MAX) {
      return {
        kind: 'small_bald',
        label: '小光',
        detail: `闲家只拿到 ${input.opponentScore} 分`,
        bankerWin: true,
        intensity: 1,
      };
    }
    return {
      kind: 'hold',
      label: '保底成功',
      detail: input.callScore !== undefined
        ? `闲家 ${input.opponentScore} 分，未达叫分 ${input.callScore}，庄家守住`
        : `闲家 ${input.opponentScore} 分，未达叫分，庄家守住`,
      bankerWin: true,
      intensity: 0,
    };
  }

  if (input.digSuccess) {
    const level = input.digGuaranteeLevel ?? 0;
    return {
      kind: 'dig',
      label: '挖底成功',
      detail: level > 0
        ? `闲家用天王/大小王赢下最后一墩，保底 ${level} 级`
        : '闲家用天王/大小王赢下最后一墩',
      bankerWin: false,
      intensity: 2,
    };
  }

  return {
    kind: 'over',
    label: '闲家过庄',
    detail: `闲家 ${input.opponentScore} 分，达到叫分打倒庄家`,
    bankerWin: false,
    intensity: 0,
  };
}

/**
 * 战果横幅停留多久（毫秒）。
 *
 * 横幅是"最后一手打完 → 结算页"之间的一拍。时长按战果强度分档：
 * 光头/挖底值得停久一点让人看清，保底成功/闲家过庄一闪而过就行 ——
 * 每局都停 2.5 秒会让连打的人烦，每局都只闪 0.8 秒又浪费了高光时刻。
 *
 * 注意：这段时间里玩家看不到结算数据，所以上限必须克制。
 */
export function outcomeBannerMs(intensity: 0 | 1 | 2): number {
  if (intensity >= 2) return 2200;
  if (intensity === 1) return 1600;
  return 1000;
}
