export interface MatchWaitHint {
  text: string;
  canStartWithAi: boolean;
}

/** 匹配等待文案只由可见状态决定，避免计时器和按钮各自猜一套门槛。 */
export function getMatchWaitHint(
  elapsed: number,
  foundCount: number,
  totalOpponents: number,
): MatchWaitHint {
  if (foundCount >= totalOpponents) {
    return { text: '对手已就位，正在准备牌桌', canStartWithAi: false };
  }
  const prefix = elapsed >= 20 ? '不用继续等待，' : '';
  return { text: `${prefix}正在安排电脑对手，可以立即开局`, canStartWithAi: true };
}
