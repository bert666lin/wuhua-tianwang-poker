/**
 * 洗牌/发牌逻辑
 */

import { CardData, GAME_CONFIG, GAME_MODES, GameModeConfig, Suit, Rank } from './config.js';

/**
 * 生成指定副数的牌组
 * 每副牌54张：52标准牌 + 小王 + 大王
 * 每张牌有唯一ID（用于多副牌区分）
 * 
 * @param decks 副数（默认2副=108张）
 * @returns 牌组数组
 */
export function createDeck(decks: number = GAME_CONFIG.deckCount): CardData[] {
  const deck: CardData[] = [];
  
  for (let d = 0; d < decks; d++) {
    // 4个花色：黑桃0、红桃1、方块2、梅花3
    for (let suit = 0; suit < 4; suit++) {
      // 3到A(14)，再到2(15)
      for (let rank = Rank.Three; rank <= Rank.Two; rank++) {
        deck.push({
          id: `${d}-${suit}-${rank}`,
          suit,
          rank,
        });
      }
    }
    // 小王
    deck.push({
      id: `${d}-4-16`,
      suit: Suit.SmallJoker,
      rank: Rank.SmallJoker,
    });
    // 大王
    deck.push({
      id: `${d}-5-17`,
      suit: Suit.BigJoker,
      rank: Rank.BigJoker,
    });
  }
  
  return deck;
}

/**
 * Fisher-Yates 洗牌算法
 * @param deck 牌组
 * @returns 洗好的牌组（新数组）
 */
export function shuffle(deck: CardData[]): CardData[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * 发牌
 * 
 * @param deck 已洗好的牌组
 * @param players 玩家数（默认4）
 * @param perPlayer 每人发牌数（默认24）
 * @param bottomCount 底牌数（默认12）
 * @returns { hands: 每个玩家的手牌数组, bottom: 底牌数组 }
 */
export function deal(
  deck: CardData[],
  players: number = GAME_CONFIG.playerCount,
  perPlayer: number = GAME_CONFIG.perPlayer,
  bottomCount: number = GAME_CONFIG.bottomCount
): { hands: CardData[][]; bottom: CardData[] } {
  const hands: CardData[][] = Array.from({ length: players }, () => []);
  const bottom: CardData[] = [];
  
  let index = 0;
  
  // 每人发 perPlayer 张
  for (let i = 0; i < perPlayer; i++) {
    for (let p = 0; p < players; p++) {
      hands[p].push(deck[index++]);
    }
  }
  
  // 剩余的作为底牌
  for (let i = 0; i < bottomCount; i++) {
    bottom.push(deck[index++]);
  }
  
  return { hands, bottom };
}

/**
 * 完整的发牌流程：生成牌组 -> 洗牌 -> 发牌
 */
export function dealCards(mode: GameModeConfig = GAME_MODES.fourPlayerTwoDecks): { hands: CardData[][]; bottom: CardData[] } {
  const deck = createDeck(mode.deckCount);
  const shuffled = shuffle(deck);
  return deal(shuffled, mode.playerCount, mode.perPlayer, mode.bottomCount);
}
