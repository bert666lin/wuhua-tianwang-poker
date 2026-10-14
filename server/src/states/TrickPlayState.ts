import { ArraySchema, Schema, type } from '@colyseus/schema';
import { CardSchema } from './CardSchema.js';

/** 一名玩家在当前墩实际打出的牌。 */
export class TrickPlayState extends Schema {
  @type('uint8') seatIndex: number = 255;
  @type([CardSchema]) cards = new ArraySchema<CardSchema>();
}
