// ===== 牌桌 v4 的数据类型 =====
// 从 TableV4.tsx 抽出（原文件 1755 行）。类型放在独立文件的好处：
// tableV4Transform.ts / TableV4Menus.tsx / GameMockPreviewV4.tsx 都要用它们，
// 原先它们得 import 整个 1700 行的组件文件才能拿到一个 interface。
//
// 注意：TableV4.tsx 仍然 re-export 这些类型（`export type { ... }`），
// 所以老的 `from './TableV4'` 写法照旧可用，不必一次性改所有调用方。

import type { SeatPosition } from './tableV4Layout';

export type GamePhase = 'calling' | 'discarding' | 'playing' | 'waiting' | 'dealing';

export interface TableV4Player {
  id: string;
  name: string;
  avatar?: string;
  rankLabel: string;
  rankLevel: 'red' | 'green' | 'blue';
  coins: number;
  position: SeatPosition;
  handCount?: number;
  isTurn?: boolean;
  /**
   * 本墩首家（领出的那个人）。
   *
   * 为什么单独标：这游戏"跟牌"必须跟足首家的花色和张数，所以「这一墩是谁领的、
   * 领的什么」是每次出牌前都要看的信息。原来只标了「轮到谁」，玩家还得回想
   * 一圈才知道该跟什么门 —— 用户反馈「要在谁先出牌，加个小标签」。
   */
  isLeader?: boolean;
  /**
   * 这一桌的累计级数（可负）。
   *
   * 为什么每家都要显示：级数是这个游戏唯一的输赢单位，一桌人连打十几把，
   * 「现在谁领先、我落后几级」是每一手牌都在权衡的事（决定要不要冒险抢庄）。
   * 原来只有顶栏显示"我"的累计，别人的得点开记录面板才看得到 ——
   * 等于把最该常驻的数字藏进了二级菜单。
   *
   * undefined = 还没打完一局（没有累计可言），此时座位上不渲染这个标签，
   * 而不是显示一个 0 —— 0 会被读成"打了但不输不赢"。
   */
  roomLevel?: number;
}

export interface HandCardData {
  id: string;
  rank: string;
  suit: string;      // '♠','♥','♣','♦',''
  color: 'red' | 'black';
  isJoker?: boolean;
  jokerType?: 'big' | 'small';
  /**
   * 是否主牌。本游戏的主牌集合新手认不出来：除了主花色，**所有花色的 7 和 2**
   * 以及大小王也都是主牌。玩家反馈「不知道哪些是主」，所以在牌面上标出来。
   * 由 toHandCard 按 mainSuit 算好，UI 层不再自己判断（判断逻辑只留一份）。
   */
  isMain?: boolean;
  /** 天王（主花色3，全场最大）。单独标，因为它比普通主牌重要得多。 */
  isTianWang?: boolean;
}

export interface TrickPlay {
  seat: number;   // 0=自己, 1=右, 2=上(对家), 3=左
  cards: HandCardData[];
  /** 这一墩是他领出的（定门的人）。标签贴在牌上，比贴头像旁边直观。 */
  isLeader?: boolean;
  /** 他的牌目前压着全场。首家自己压着时不标（见 toTrickPlays 注释）。 */
  isWinner?: boolean;
}

/** 记录面板里每家的战况。 */
export interface RecordPlayer {
  name: string;
  takenScore: number;
  isBanker: boolean;
  handCount: number;
}

/** 只取叫分记录需要的字段。 */
export interface BidEventLike {
  playerId: string;
  playerName: string;
  score: number;
}

/** 只取聊天渲染需要的字段，避免和全局类型耦合。 */
export interface ChatMessageLike {
  playerId?: string;
  playerName: string;
  text: string;
}
