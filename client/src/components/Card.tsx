// ===== 扑克牌组件 v4 =====
// CSS/SVG 绘制，无图片
// 新增：分数牌角标（5/10/K 显示分值）

import { memo } from 'react';
import type { Card as CardType } from '../types';
import { getSuitSymbol, getRankLabel, isMainCard, isRedCard, getCardScore } from '../utils/cardUtils';
import { suitGlyph } from '../utils/preferences';
import '../styles/card.css';

interface CardProps {
  card: CardType;
  mainSuit?: import('../types').Suit | null;
  selected?: boolean;
  hinted?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  small?: boolean;
  /** 是否显示分数牌角标（手牌中默认显示） */
  showScoreBadge?: boolean;
}

function CardComponent({ card, mainSuit, selected, hinted, onClick, disabled, small, showScoreBadge = true }: CardProps) {
  const isRed = isRedCard(card);
  // suitGlyph：iOS 会用彩色 emoji 渲染 ♠♥♦♣ 并无视 CSS color，必须强制文字形态
  const symbol = suitGlyph(getSuitSymbol(card.suit));
  const label = getRankLabel(card.rank);
  const isJoker = card.suit === 'joker';
  const isTianWang = Boolean(mainSuit && card.suit === mainSuit && card.rank === '3');
  const isMain = isMainCard(card, mainSuit ?? null);
  const score = getCardScore(card);
  const showScore = showScoreBadge && score > 0 && !isJoker;

  const className = [
    'poker-card',
    isRed ? 'card-red' : 'card-black',
    selected ? 'card-selected' : '',
    hinted ? 'card-hinted' : '',
    disabled ? 'card-disabled' : '',
    small ? 'card-small' : '',
    isJoker ? 'card-joker' : '',
    isTianWang ? 'card-tianwang' : '',
    isMain ? 'card-main' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} onClick={disabled ? undefined : onClick}>
      {/* 左上角 */}
      <div className="card-corner card-corner-tl">
        <span className="card-rank">{label}</span>
        <span className="card-suit">{isJoker ? '' : symbol}</span>
      </div>

      {/* 中央花色 */}
      <div className="card-center">
        {isJoker ? (
          <span className="card-joker-text">
            {card.rank === 'big_joker' ? '大' : '小'}
            <br />王
          </span>
        ) : (
          <span className="card-center-suit">{symbol}</span>
        )}
      </div>

      {/* 右下角 */}
      <div className="card-corner card-corner-br">
        <span className="card-rank">{label}</span>
        <span className="card-suit">{isJoker ? '' : symbol}</span>
      </div>

      {/* 天王标识 */}
      {isTianWang && (
        <div className="card-tianwang-badge">天王</div>
      )}

      {/* 分数牌角标（5/10/K） */}
      {showScore && (
        <div className="card-score-badge" title={`${score}分`}>
          {score}
        </div>
      )}
    </div>
  );
}

export const Card = memo(CardComponent);
