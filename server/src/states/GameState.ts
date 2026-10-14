/**
 * 游戏房间状态Schema
 */

import { Schema, type, ArraySchema, MapSchema } from '@colyseus/schema';
import { CardSchema } from './CardSchema.js';
import { PlayerState } from './PlayerState.js';
import { TrickPlayState } from './TrickPlayState.js';
import { AuctionEntryState } from './AuctionEntryState.js';
import { RoundRecordState } from './RoundRecordState.js';

export class GameState extends Schema {
  // 模式ID（fourPlayerTwoDecks / threePlayerTwoDecks / fivePlayerThreeDecks）
  @type('string') modeId: string = 'fourPlayerTwoDecks';

  // 本房间人数上限（3-6人）
  @type('uint8') modePlayerCount: number = 4;

  // 场次（easy/mid/high/master）：决定底分与入场门槛，牌桌要显示这局多大注
  @type('string') tierId: string = 'easy';

  /**
   * 是不是房卡局（朋友局）。
   *
   * 必须同步给客户端：牌桌和结算面要把「底分/输赢金币」换成
   * 「朋友局·不输赢金币」，否则玩家会以为金币没结算是 bug。
   */
  @type('boolean') isCardRoom: boolean = false;

  // 游戏阶段
  @type('string') phase: string = 'waiting'; // waiting|dealing|calling_suit|calling_score|discarding|playing|settling
  
  // 主花色 (0-3, 255=未定)
  @type('uint8') mainSuit: number = 255;

  // 当前主花色是用几张7亮出来的。抢主必须严格多于这个数，0=还没人叫主。
  // 客户端要用它算「我还能不能抢」，所以必须同步。
  @type('uint8') mainSuitCallCount: number = 0;
  
  // 庄家座位号
  @type('uint8') bankerSeat: number = 255;
  
  // 庄家叫分
  @type('uint16') callScore: number = 0;

  // 当前叫分玩家可选的最高分（后叫必须更低）。默认=两副牌基准分125。
  @type('uint16') nextBidMax: number = 125;
  
  // 全局总分
  @type('uint16') totalScore: number = 200;
  
  // 当前出牌玩家
  @type('uint8') currentTurn: number = 0;
  
  // 上一轮的牌（用于显示）
  @type([CardSchema]) lastTrick = new ArraySchema<CardSchema>();
  
  // 上一轮赢家
  @type('uint8') lastWinner: number = 255;
  
  // 当前轮出的牌
  @type([CardSchema]) currentTrick = new ArraySchema<CardSchema>();

  // 当前轮按座位分开的出牌（用于四方桌面呈现）
  @type({ map: TrickPlayState }) currentPlays = new MapSchema<TrickPlayState>();

  // 首家出牌后，后家必须实际跟出的张数；0表示本墩尚未领出
  @type('uint8') requiredPlayCount: number = 0;

  // 本墩暂时最大的座位（255=尚无）
  @type('uint8') currentWinnerSeat: number = 255;
  
  // 当前轮首个出牌玩家
  @type('uint8') trickLeader: number = 255;
  
  // 玩家列表
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  
  // 回合数
  @type('uint8') round: number = 0;
  
  // 底牌数量（扣底后不显示具体牌）
  @type('uint8') bottomCount: number = 0;

  /**
   * 本局叫主/抢主/叫分的完整过程，按发生顺序。
   *
   * 牌桌顶栏要显示「主：♠（张三 1张7）· 庄：李四 叫115」，结算页也要复述一遍。
   * 只靠 suit_called / score_bid 广播的话，重连的人这块永远是空的。
   */
  @type([AuctionEntryState]) auction = new ArraySchema<AuctionEntryState>();

  /**
   * 本房间已打完的每一局战果，按顺序。
   *
   * 牌桌上要显示「第 N 局 / 各家累计几级」，退出房间时要弹一份房间结算清单。
   * 放进 state（而不是只靠 game_settled 广播）才能让重连和后来者也看得到。
   */
  @type([RoundRecordState]) history = new ArraySchema<RoundRecordState>();

  /**
   * 已打完的局数（= history.length，冗余一个标量方便客户端直接显示）。
   *
   * 注意和 `round` 区分：`round` 是当前这一局内的第几墩，每局都会归零；
   * 这个是房间开桌以来打完的整局数，只增不减。名字容易看混，所以写清楚。
   */
  @type('uint16') roundsPlayed: number = 0;
}
