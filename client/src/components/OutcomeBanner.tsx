// ===== 战果横幅：最后一手打完，先亮结果再进结算 =====
//
// 用户诉求（原话）：「最后一手牌打完，要突出有没有成功挖底。做个动效」。
//
// 为什么需要它：以前最后一墩收完就直接弹结算面板，「这局到底赢在哪」被埋在
// 结算页的第 7 个区块里。牌桌上那一瞬间是情绪最高的时刻 ——
// 挖底成功、光头，这些是玩家会截图发群的东西，必须在牌桌上就亮出来。
//
// 时长和动效强度都由 utils/outcome.ts 决定（intensity / outcomeBannerMs），
// 不在这里另算一套：两处各判一次必然会出现「横幅说挖底、结算说过庄」。

import { useEffect, useState } from 'react';
import { describeOutcome, outcomeBannerMs, type OutcomeInput } from '../utils/outcome';
import { BoltIcon, CrownIcon, TrophyIcon } from './icons';
import '../styles/outcome-banner.css';

interface OutcomeBannerProps {
  /** 结算数据；null 表示这局还没结束，横幅不出现。 */
  input: OutcomeInput | null;
  /**
   * 换一局要重新播动画的序号。
   *
   * 用序号而不是布尔量：连续两局的战果可能完全一样（比如连着两次光头），
   * 布尔量会因为「值没变」而不重播，玩家会以为第二局没有横幅。
   */
  playKey: number;
  /** 我这局是赢家吗（决定文案是"你"还是"对手"的语气）。 */
  iWon: boolean;
  /** 横幅播完的回调，通常用来打开结算面板。 */
  onDone?: () => void;
}

export function OutcomeBanner({ input, playKey, iWon, onDone }: OutcomeBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!input) { setVisible(false); return; }
    setVisible(true);
    const ms = outcomeBannerMs(describeOutcome(input).intensity);
    const timer = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, ms);
    return () => clearTimeout(timer);
    // playKey 变化才重播；onDone 每次渲染都是新函数，不能进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, input === null]);

  if (!input || !visible) return null;
  const outcome = describeOutcome(input);

  return (
    <div
      className={`ob-layer intensity-${outcome.intensity} ${iWon ? 'is-win' : 'is-lose'}`}
      data-kind={outcome.kind}
      role="status"
      aria-live="polite"
    >
      {/* 强度 2 才有全屏冲击波：光头和挖底值得，普通胜负不值得 */}
      {outcome.intensity >= 2 && (
        <div className="ob-shock" aria-hidden="true">
          <span className="ob-ring ob-ring-1" />
          <span className="ob-ring ob-ring-2" />
        </div>
      )}
      <div className="ob-card">
        <span className="ob-icon">
          {outcome.kind === 'dig'
            ? <BoltIcon size={26} tone="gold" />
            : outcome.bankerWin
            ? <CrownIcon size={26} tone="gold" />
            : <TrophyIcon size={26} tone="gold" />}
        </span>
        <strong className="ob-label">{outcome.label}</strong>
        <span className="ob-detail">{outcome.detail}</span>
      </div>
    </div>
  );
}
