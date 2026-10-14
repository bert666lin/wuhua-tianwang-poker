// ===== 牌面渲染 =====
// 从 TableV4.tsx 抽出（原文件 1755 行）。这个函数只依赖入参，
// 手牌 / 牌阵 / 底牌三处都在用它，抽出来后各处牌面必然一致
// （历史上牌阵的字号漏跟卡片缩放，就是因为牌面渲染散落在多处）。

import { suitClass, suitGlyph } from '../utils/preferences';
import type { HandCardData } from './tableV4Types';

/**
 * 渲染一张牌的正面内容（不含卡片外框与尺寸，由调用方给）。
 *
 * @param showFull 是否渲染中央大花色与右下角标。
 *   现在三处调用（手牌 / 牌阵 / 底牌）**都传 true** —— 「窄屏只露一条时省掉
 *   看不见的部分」这件事是由 CSS 做的（手机端 .tv4-hc-center 与 .tv4-hc-bcorner
 *   直接 display:none，见 table-v4.css），不是靠这个开关。
 *   保留它是为了让「牌面可以只画角标」这个能力显式可见；真要用请一并确认
 *   CSS 那边的媒体查询，别让两套隐藏逻辑打架。
 */
export function CardFace({ card, showFull }: { card: HandCardData; showFull: boolean }) {
  return (
    <>
      {/* 主牌小标注。
       * 位置选左下角是被布局逼出来的：手机端牌只露出左侧 ~22px 一条竖条
       * （右边被邻牌压住），右上/右下都在不可见区里；而 .tv4-hc-bcorner
       * 在手机端是 display:none，左下这块正好空着，是竖条里唯一的空位。
       * 天王（主花色3）单独写「王」——它是全场最大的一张，跟普通主牌不是一个量级。 */}
      {card.isMain && (
        <span
          className={`tv4-hc-main-tag${card.isTianWang ? ' is-tianwang' : ''}`}
          aria-label={card.isTianWang ? '天王' : '主牌'}
        >
          {card.isTianWang ? '王' : '主'}
        </span>
      )}
      <div className="tv4-hc-corner">
        {card.isJoker ? (
          <span className="tv4-hc-rank tv4-hc-joker">
            {card.rank || (card.jokerType === 'big' ? '大王' : '小王')}
          </span>
        ) : (
          <>
            <span className="tv4-hc-rank">{card.rank}</span>
            <span className={`tv4-hc-suit tv4-s-${suitClass(card.suit)}`}>{suitGlyph(card.suit)}</span>
          </>
        )}
      </div>
      {showFull && (
        <>
          <div className={`tv4-hc-center${card.isJoker ? '' : ` tv4-s-${suitClass(card.suit)}`}`}>
            {card.isJoker ? '🃏' : suitGlyph(card.suit)}
          </div>
          <div className="tv4-hc-bcorner">
            {card.isJoker ? (
              <span className="tv4-hc-rank tv4-hc-joker">
                {card.rank || (card.jokerType === 'big' ? '大王' : '小王')}
              </span>
            ) : (
              <>
                <span className="tv4-hc-rank">{card.rank}</span>
                <span className={`tv4-hc-suit tv4-s-${suitClass(card.suit)}`}>{suitGlyph(card.suit)}</span>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
