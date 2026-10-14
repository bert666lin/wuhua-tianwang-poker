/**
 * 一整局（一手牌）打完后的战果记录，用于「这个房间打了几次、各家多少级」。
 *
 * 为什么要进 Schema 而不是只靠 game_settled 广播：
 * 广播只有当时在场的人收得到。掉线重连、中途换设备、后来加入的人，
 * 拿到的都会是一份空历史 —— 而房间累计战绩恰恰是最需要"随时能翻"的东西
 * （玩家会问"我们打了几把了？我总共赢了几级？"）。
 * 放进 state 后，任何时刻加入或重连的客户端都能一次性拿到完整历史。
 *
 * ⚠️ 这里存的是【本房间内】的级数变化，与账号的终身累计积分
 * （PlayerState.score，从数据库带出来）完全是两回事，不要混用。
 */

import { Schema, type, ArraySchema } from '@colyseus/schema';

export class RoundRecordState extends Schema {
  /** 第几局（从 1 开始，房间内递增）。 */
  @type('uint16') roundNo: number = 0;
  /** 这一局庄家的座位号。 */
  @type('uint8') bankerSeat: number = 255;
  /** 庄家叫的分。 */
  @type('uint16') callScore: number = 0;
  /** 庄家是否赢了这一局。 */
  @type('boolean') bankerWin: boolean = false;
  /** 这一局打了几级。 */
  @type('uint8') level: number = 0;
  /** 闲家总得分（已含底牌分）。 */
  @type('uint16') opponentScore: number = 0;
  /**
   * 战果代号，与客户端 utils/outcome.ts 的 OutcomeKind 一一对应：
   * bald=光头 / small_bald=小光 / hold=保底成功 / dig=挖底成功 / over=闲家过庄。
   * 存代号而不是中文文案：文案随时会改，代号不能改。
   */
  @type('string') outcome: string = '';
  /**
   * 各座位这一局的级数变化（可正可负，庄家一人对三家所以幅度大）。
   * 用 int16 而不是 uint：输的一方是负数。
   */
  @type(['int16']) deltas = new ArraySchema<number>();
}
