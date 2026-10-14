/**
 * 玩家状态Schema
 */

import { Schema, type } from '@colyseus/schema';

export class PlayerState extends Schema {
  @type('string') id: string = '';           // 玩家ID
  @type('string') name: string = '';         // 玩家昵称
  @type('uint8') seatIndex: number = 0;      // 座位号 0-3
  @type('boolean') isBanker: boolean = false; // 是否为庄家
  @type('boolean') isReady: boolean = false;  // 是否准备
  @type('int16') score: number = 0;          // 累计积分（允许负分）
  @type('uint16') takenScore: number = 0;    // 当局得分
  @type('boolean') isOffline: boolean = false; // 是否离线
  @type('uint8') handCount: number = 0;      // 只公开手牌数量，具体牌面私发
  @type('boolean') isCalling: boolean = false; // 是否正在叫主/叫分
  @type('boolean') isAI: boolean = false;       // 是否由服务端AI控制
  @type('boolean') isOwner: boolean = false;    // 是否房主（可管理AI与座位）
  @type('boolean') isAutoPlay: boolean = false; // 真人进入持续托管（可自行收回）
  @type('boolean') isTrusteeByOffline: boolean = false; // 因掉线被AI接管

  /**
   * 本房间内的累计级数（可负）。
   *
   * ⚠️ 与上面的 `score` 不是一回事：`score` 是账号的终身累计积分（进房时从
   * 数据库带出来，用于算段位）；这个只统计"在这张桌子上赢/输了几级"，
   * 进房时一律从 0 开始。玩家问的"我们打了几把、我赢了几级"指的是这个。
   */
  @type('int16') roomLevel: number = 0;

  /** 本房间内坐庄次数，房间结算清单要显示。 */
  @type('uint16') roomBankerCount: number = 0;
  /** 本房间内当庄且守住的次数（庄家赢）。 */
  @type('uint16') roomBankerWins: number = 0;
}
