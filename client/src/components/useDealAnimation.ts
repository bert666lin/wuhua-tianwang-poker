// ===== 发牌动画阶段机 =====
// 把 dealAnimation.ts 的时间线变成 React 状态，供牌桌决定：
//   - 手牌该用「刚发到手的乱序」还是「理好的顺序」
//   - 什么时候允许玩家点牌
//
// 单独成文件是为了让 TableV4Adapter 保持可读；也避免把一堆 setTimeout
// 塞进本来就很长的适配器里。

import { useEffect, useRef, useState } from 'react';
import { dealTimeline } from './dealAnimation';

/**
 * 发牌动画的四个阶段：
 * - `idle`   没有动画（重连、扣底后 hand_update、平时打牌）
 * - `fly`    牌正一张张飞进手里，全部背面朝上
 * - `flip`   牌陆续翻开
 * - `sort`   已切换成理好的顺序，位移动画进行中
 */
export type DealStage = 'idle' | 'fly' | 'flip' | 'sort';

export interface DealAnimationState {
  stage: DealStage;
  /** 动画期间为 true：手牌区要屏蔽点击，避免动画中途选牌导致状态错乱。 */
  locked: boolean;
  /** 手牌是否已经可以按「理好的顺序」渲染。 */
  sorted: boolean;
}

const IDLE: DealAnimationState = { stage: 'idle', locked: false, sorted: true };

/**
 * 监听 dealKey，每次自增就走一遍发牌动画时间线。
 *
 * @param dealKey 发牌序号，0 表示还没发过牌（不播动画）
 * @param count   本次发到手的张数，决定每张牌的错峰间隔
 */
export function useDealAnimation(dealKey: number, count: number): DealAnimationState {
  const [state, setState] = useState<DealAnimationState>(IDLE);
  // count 用 ref 读取：张数在动画途中不会变，但把它放进 effect 依赖会让
  // 「扣底后 hand_update 改变张数」重启整段动画。
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    // dealKey=0 是初始值，重连进来时不该突然播一遍发牌动画
    if (dealKey <= 0) { setState(IDLE); return; }

    const t = dealTimeline(countRef.current);
    setState({ stage: 'fly', locked: true, sorted: false });

    const timers: ReturnType<typeof setTimeout>[] = [
      setTimeout(() => setState({ stage: 'flip', locked: true, sorted: false }), t.flipStart),
      setTimeout(() => setState({ stage: 'sort', locked: true, sorted: true }), t.sortStart),
      setTimeout(() => setState(IDLE), t.total),
    ];
    return () => { for (const id of timers) clearTimeout(id); };
  }, [dealKey]);

  return state;
}
