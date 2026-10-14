/**
 * 牌的Schema - 用于网络同步
 */

import { Schema, type } from '@colyseus/schema';

export class CardSchema extends Schema {
  @type('string') id: string = '';
  @type('uint8') suit: number = 0;
  @type('uint8') rank: number = 0;
}
