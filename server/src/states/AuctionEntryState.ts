/**
 * 叫主 / 抢主 / 叫分的一条记录。
 *
 * 为什么要进 Schema 而不是只发广播：
 * 牌桌顶栏和结算页都要标明「主是谁叫的、庄是谁叫的、亮了几张 7」，
 * 而逐条广播（suit_called / score_bid）只有当时在场的人收得到 ——
 * 掉线重连、中途换设备、进结算页重新挂载，都会拿到一份空记录。
 * 放进 state 后新加入/重连的客户端一次性拿到完整过程。
 */

import { Schema, type } from '@colyseus/schema';

/** 记录类型。用固定字符串而不是数字，日志和前端 switch 都能一眼看懂。 */
export type AuctionKind = 'call_suit' | 'steal_suit' | 'pass_suit' | 'bottom_suit' | 'bid' | 'pass_bid';

export class AuctionEntryState extends Schema {
  /** call_suit=叫主 / steal_suit=抢主 / pass_suit=不叫主 / bottom_suit=翻底定主 / bid=叫分 / pass_bid=不叫分 */
  @type('string') kind: string = 'call_suit';
  /** 座位号。翻底定主没有座位，用 255。 */
  @type('uint8') seatIndex: number = 255;
  @type('string') playerName: string = '';
  /** 花色 0-3，与 Suit 一致；不涉及花色时 255。 */
  @type('uint8') suit: number = 255;
  /** 叫主/抢主亮出的同花色 7 的张数。 */
  @type('uint8') sevenCount: number = 0;
  /** 叫分的分数；不涉及叫分时 0。 */
  @type('uint16') score: number = 0;
}
