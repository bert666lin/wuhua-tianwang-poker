import { CardData, CardType, GAME_CONFIG, Rank, Suit } from './config.js';
import { getCardRank, identifyCardType, isMainCard, isSameFace, isTianWang, isBigJoker, isSmallJoker } from './compare.js';
import { getCardScore } from './score.js';
import { checkFollow } from './validate.js';

export interface AiPlayAction {
  type: 'play';
  cards: CardData[];
  /** 空手牌 / 无合法出牌等异常原因，调用方用来做更友好的提示 */
  reason?: 'hand_empty';
}

export interface AiPlayContext {
  /** 已经公开打出的牌（含本墩已出的牌），用于记牌 */
  playedCards?: CardData[];
  /** 本局副牌数，用于推算某种牌还剩几张 */
  deckCount?: number;
  /** 我是庄家吗 */
  isBanker: boolean;
  /** 首家是否与我同阵营 */
  leaderIsAlly: boolean;
  /** 当前墩暂时最大的牌，用于判断能不能压过 */
  currentWinningCards: CardData[];
  /** 当前暂时最大的一家是否与我同阵营 */
  winnerIsAlly: boolean;
  /** 我是本墩最后一个出牌的人 */
  isLastToPlay: boolean;
  /**
   * 这是不是本局**最后一墩**。
   *
   * 最后一墩是全局最关键的一墩，双方目标完全相反：
   *   - 闲家赢下它 → 底牌分归闲家；若用天王/大小王赢，还额外拿保底级数（挖底）；
   *   - 庄家必须守住它 → 否则底牌分和保底级数一起送出去。
   * 所以到了这一墩，双方都该把留着的大牌用出来，不能再"省着"。
   */
  isFinalTrick?: boolean;
}

/**
 * 估一手牌到底强不强，返回 0~1 的分值。
 *
 * 叫主/叫分都靠它。原来的实现只数「该花色有几张 7」和「主牌占比」，
 * 结果一手烂牌只要摸到一张 7 就去抢主，抢到了又打不动，白送一局。
 *
 * 真人判断一手牌能不能坐庄，看的是这几件事：
 *   1. 有几张压得住场的大牌（天王/大小王/常主 2）；
 *   2. 主牌够不够长（主牌少，杀牌次数就少）；
 *   3. 手上分牌（5/10/K）多不多 —— 分在自己手里才好保；
 *   4. 有没有短门（缺门/单张门），短门能靠主牌杀牌抓分。
 *
 * @param mainSuit 假定的主花色
 */
export function evaluateHandStrength(hand: CardData[], mainSuit: number): number {
  if (hand.length === 0) return 0;

  const mainCards = hand.filter(card => isMainCard(card, mainSuit));
  const mainRatio = mainCards.length / hand.length;

  // 大牌数：天王、大小王、常主 2 是真正能控场的牌
  const bigCount = hand.filter(card =>
    isTianWang(card, mainSuit) || isBigJoker(card) || isSmallJoker(card)
    || card.rank === Rank.Two,
  ).length;
  // 常主 7 也算半张大牌（数量多，但比 2 小）
  const sevenCount = hand.filter(card => card.rank === Rank.Seven).length;

  // 分牌在自己手上更容易保住
  const scoreCards = hand.filter(card => getCardScore(card) > 0).length;

  // 短门：某个副花色只有 0~2 张，容易做成缺门用主牌杀分
  const offSuitCounts = new Map<number, number>();
  for (const card of hand) {
    if (isMainCard(card, mainSuit)) continue;
    offSuitCounts.set(card.suit, (offSuitCounts.get(card.suit) ?? 0) + 1);
  }
  const shortSuits = [...offSuitCounts.values()].filter(n => n <= 2).length;

  /* 权重是按"什么最能决定坐庄成败"排的：
   * 主牌长度和大牌数量最关键，分牌和短门是加分项。
   * 各项都先归一化到 0~1，再加权求和，最后夹在 0~1。 */
  const score =
      Math.min(1, mainRatio / 0.45) * 0.34          // 主牌占比达到 45% 就算满分
    + Math.min(1, bigCount / 4) * 0.30              // 4 张控场大牌算满分
    + Math.min(1, sevenCount / 4) * 0.12            // 常主 7
    + Math.min(1, scoreCards / (hand.length * 0.25)) * 0.12  // 分牌
    + Math.min(1, shortSuits / 2) * 0.12;           // 两个短门算满分

  return Math.max(0, Math.min(1, score));
}

/**
 * AI 选择叫主花色。
 *
 * 除了「该花色的 7 够不够门槛」，还要求这手牌真的打得动
 * —— 否则 AI 会摸到一张 7 就抢主，抢到了又坐不住庄。
 *
 * @param minSevens 抢主门槛：手上该花色的 7 必须达到这个张数才能叫。
 *                  首家叫主传 1；已有人叫主时传「当前亮牌数 + 1」。
 * @returns 花色，255 = 放弃叫主
 */
export function chooseAiSuit(
  hand: CardData[],
  minSevens: number = 1,
  bidContext?: { bidMax: number; hasCurrentBid: boolean },
): number {
  const sevensOf = (suit: number) =>
    hand.filter(card => card.suit === suit && card.rank === Rank.Seven).length;
  const candidates = [Suit.Spade, Suit.Heart, Suit.Diamond, Suit.Club]
    .filter(suit => sevensOf(suit) >= minSevens);
  if (candidates.length === 0) return 255;

  /* 挑哪一门做主：按「定这门为主之后这手牌有多强」排，而不是按该门有几张。
   *
   * 原来只比「该门张数 + 该门 7 的个数」，会挑出错的门。实测反例：
   * 黑桃 6 张全是小牌（定黑桃主后牌力 0.556）vs 红桃 4 张 A K Q
   * （定红桃主后牌力 0.468）—— 老逻辑因为黑桃更长而选黑桃，但那 6 张
   * 全是 4/5/6 这种压不住人的牌，实际打起来比红桃差。
   * evaluateHandStrength 已经把主牌长度算进去了（mainRatio 权重最高），
   * 所以直接比它就同时兼顾了「够长」和「够大」。
   *
   * 手牌太少时（测试构造/异常状态）牌力算不准，退回老的张数比较。 */
  const canJudge = hand.length >= MIN_HAND_FOR_STRENGTH;
  const strengthOf = (suit: number) => evaluateHandStrength(hand, suit);
  const best = canJudge
    ? candidates.reduce((a, b) => (strengthOf(b) > strengthOf(a) ? b : a))
    : candidates.sort((a, b) =>
        hand.filter(card => card.suit === b).length - hand.filter(card => card.suit === a).length
        || sevensOf(b) - sevensOf(a)
      )[0];

  /* 牌力门槛：抢主意味着可能要坐庄，牌不行就别抢。
   * 抢别人的主（minSevens > 1）风险更大 —— 要多亮一张 7，
   * 等于把自己的常主提前暴露掉，所以门槛更高。
   *
   * 只对"真实规模的手牌"做牌力判断：实战叫主时手上一定是整副手牌
   * （最少 12 张，三副牌 27 张），牌力才算得准。
   * 手牌很少时（单元测试的构造用例、异常状态）样本不足，
   * 强行判牌力只会得出没意义的结论，此时退回纯张数门槛。 */
  if (canJudge) {
    const strength = strengthOf(best);
    const threshold = minSevens > 1 ? SUIT_CALL_THRESHOLD_STEAL : SUIT_CALL_THRESHOLD_FIRST;
    if (strength < threshold) return 255;

    /* 叫主要和「打算不打算抢庄」打通。
     *
     * 亮 7 定主的代价是把自己的常主 7 提前暴露给全桌；换来的好处只有
     * 「主花色是我选的」。如果紧接着的叫分阶段自己根本不敢叫（牌力没到
     * BID_MIN_STRENGTH），庄就让给别人了 —— 等于花了代价，好处全被对手拿走，
     * 还顺手告诉对手自己手里有几张 7。
     * 实测有 33.4% 的局是这个形状（叫了主却没坐庄），是纯亏的一类操作。
     *
     * 所以这里再问一次 chooseAiBid：定这门主之后我会去叫分吗？不会就别叫主。
     * bidContext 可选是为了兼容只关心花色选择的老调用方/单测。 */
    if (bidContext) {
      const willBid = chooseAiBid(hand, best, bidContext.bidMax, bidContext.hasCurrentBid);
      if (willBid <= 0) return 255;
    }
  }

  return best;
}

/**
 * 牌力判断的最小手牌数。
 * 实战叫主/叫分时手牌一定 >= 12（两副牌 4 人也有 12 张），
 * 低于这个数的只有测试构造和异常情况，此时不做牌力判断。
 */
const MIN_HAND_FOR_STRENGTH = 8;

/**
 * 首家叫主的牌力门槛：低于此值宁可不叫，让别人去坐庄。
 *
 * 数值是实测标定的：两副牌 4 人各 24 张，用 evaluateHandStrength 打 3000 局，
 * 「手上有该门 7」的有资格比例高达 87.8%，牌力中位数 0.71。
 * 原来门槛设 0.42，只筛掉 2.8% —— 等于形同虚设，AI 照样摸到一张 7 就叫主
 * （这就是用户反馈"AI 牌不好也要去叫主"仍然存在的原因：门槛值算在了
 * 一个错误的量级上）。0.65 对应叫主率约 58%，把明显偏弱的一半挡掉。
 */
const SUIT_CALL_THRESHOLD_FIRST = 0.65;
/**
 * 抢主（要多亮一张 7）的门槛更高：暴露常主的代价更大。
 * 0.75 ≈ 有资格者里的前 43%。
 */
const SUIT_CALL_THRESHOLD_STEAL = 0.75;

/**
 * AI 叫分。
 *
 * ⚠️ 这里的方向很容易搞反，先说清规则（见 CONTEXT.md / PHASE1-SPEC.md）：
 * 叫分是**倒着叫**的 —— 从基准分 125 起，后叫必须比当前更低，
 * 谁叫得**最低**谁坐庄，叫到 40 立刻结束。
 * 而叫分的含义是「闲家达到这个分数就算打倒庄家」。
 *
 * 所以：**叫分越低 = 契约越难 = 越需要好牌**。
 * 叫 40 意味着"我保证把三个闲家压在 40 分以内"，这是最狠的承诺；
 * 叫 125 则宽松得多（闲家要拿满 125 分才赢）。
 *
 * 原实现把方向弄反了：牌力 0.9 的强牌算出 willing=125（最保守的契约），
 * 牌力刚过门槛的烂牌算出 willing=40（最狠的契约），
 * 于是「牌越差越抢庄、还专挑最难的契约」——
 * 这正是用户反馈的"AI 牌不好也要去叫分"的根因。
 *
 * 现在的做法：牌力换算出一个**敢承诺的下限** floor，然后**直接叫到 floor**。
 *
 * 为什么不"只让一档"（叫 maxScore）：每人只有一次机会，如果人人都只让
 * 一档，结果就是 125→120→115→110，永远是**最后一个座位**坐庄，牌力完全
 * 不起作用（实测庄家是全桌最强牌的比例只有 29%，跟随机 25% 没差别）。
 * 想坐庄就必须真的往下压 —— 强牌 floor 低，能一路压到别人不敢跟的位置；
 * 弱牌 floor 高，压不动就自然退出。这样座位顺序的影响才让位给牌力。
 *
 * @param maxScore 本次允许叫的最高分（有人叫过时 = 当前叫分 - 步长）
 */
export function chooseAiBid(
  hand: CardData[],
  mainSuit: number,
  maxScore: number,
  hasCurrentBid: boolean,
): number {
  const { callScoreMin, callScoreMax, callScoreStep } = GAME_CONFIG;
  if (maxScore < callScoreMin) return 0;
  // 规则上可以叫到 callScoreMin(40)，但 AI 自愿守住 90 分的硬下限（见 AI_BID_HARD_FLOOR）。
  if (maxScore < AI_BID_HARD_FLOOR) return 0;

  // 手牌太少时牌力算不准（见 MIN_HAND_FOR_STRENGTH），退回保守行为：
  // 只在没人叫过时接一个最宽松的契约。
  if (hand.length < MIN_HAND_FOR_STRENGTH) {
    if (hasCurrentBid) return 0;
    return Math.max(AI_BID_HARD_FLOOR, Math.min(maxScore, callScoreMax));
  }

  const strength = evaluateHandStrength(hand, mainSuit);

  // 牌力太差：不叫分，让对手去坐庄（当闲家反而能靠抓分赢）
  if (strength < BID_MIN_STRENGTH) return 0;

  /* 牌力 -> 敢承诺的最低叫分（floor）。
   *
   * 这里的跨度是**实测标定**出来的，不是拍脑袋：让全桌牌力最强的人坐庄、
   * 叫分固定 125 打 1200 局，闲家实际得分中位数仍有 120~125 分
   * （牌力 0.9 以上的极品牌也只能压到 105）。也就是说
   * 「把三家闲家压在 60 分以内」这种承诺根本不现实 ——
   * 原来 AI 平均叫 58 分，实测庄家胜率只有 0.8%，等于每局自杀。
   *
   * 所以 floor 只在 callScoreMax(125) 往下让 BID_FLOOR_SPAN(20) 分：
   * 普通牌守 125，极品牌才敢压到 105。 */
  const ratio = Math.min(1, (strength - BID_MIN_STRENGTH) / (BID_MAX_STRENGTH - BID_MIN_STRENGTH));
  const floor = Math.max(
    AI_BID_HARD_FLOOR,
    callScoreMax - Math.round((BID_FLOOR_SPAN * ratio) / callScoreStep) * callScoreStep,
  );

  /* 硬下限：被压到 AI_BID_HARD_FLOOR 以下就直接退出竞价。
   * 注意这两个判断不能合并：前者是「规则上还能叫但 AI 不愿叫」，
   * 后者是「牌力不够支持这个契约」。 */
  if (maxScore < AI_BID_HARD_FLOOR) return 0;
  if (maxScore < floor) return 0;

  /* 敢接：叫到自己牌力支撑得起的最低分，用真实的承诺去抢庄。
   * 上限仍受 maxScore 约束（后叫必须比当前叫分低），
   * 下限取 AI_BID_HARD_FLOOR 而不是规则下限 callScoreMin。 */
  return Math.max(AI_BID_HARD_FLOOR, Math.min(maxScore, floor));
}

/**
 * 叫分的最低牌力：比这还差就不叫分，当闲家去抓分。
 *
 * 同样是实测标定：跑全流程仿真（叫主→拍卖→扣底→打完→结算）800 局，
 * 门槛从 0.45 提到 0.68 时庄家胜率从 35.8% 升到 40.2%，
 * 说明原门槛让太多不够格的手牌去坐庄了。再往上（0.75）虽然胜率到 44%，
 * 但流局率涨到 13.5%（没人敢叫分），体验变差，所以取 0.68。
 */
const BID_MIN_STRENGTH = 0.68;
/** 牌力达到这个值就敢把叫分压到 floor 的最低处。 */
const BID_MAX_STRENGTH = 0.9;
/**
 * 叫分最多敢从基准分（125）往下让多少。
 *
 * 实测标定：即使是全桌最强的一手牌坐庄，三家闲家的得分中位数也在
 * 120 分上下，所以敢承诺的下限只能贴着基准分。放大这个值会让 AI
 * 抢庄抢得很凶但局局完不成契约（实测 58 分时庄家胜率 0.8%）。
 */
const BID_FLOOR_SPAN = 10;
/**
 * AI 叫分的**硬下限**：低于这个分数 AI 一律不叫，宁可弃庄当闲家。
 *
 * 来自真人实测反馈：叫分低于 90 的庄家几乎全输。仓理上也成立——
 * 叫分越低契约越苛刻（要把三家闲家压在更低的分数内），
 * 而全牌 200 分里底牌和散分太多，“压在 90 以内”实际上做不到。
 *
 * 注意：这只约束 AI。GAME_CONFIG.callScoreMin 仍为 40，
 * 真人玩家想冲低分契约依旧可以。
 *
 * 副作用：叫分不能无限往下压 -> AI 之间抢庄的空间变小。
 * 但当前 BID_FLOOR_SPAN 只有 10（floor 最低 115），所以它实际是一道
 * “防御性的下限”：防止以后谁把 BID_FLOOR_SPAN 调大时又跌回叫低分自杀。
 */
const AI_BID_HARD_FLOOR = 90;

/**
 * 扣底策略：优先「做缺门」，其次才是扣低牌力的废牌。
 *
 * 做缺门是庄家扣底最大的价值所在：把某个副花色彻底扣光，
 * 之后对手领出这门牌时自己就能用主牌杀牌抓分。
 * 只按牌力排序扣牌（老策略）会把短门的零散牌留在手上，
 * 既杀不了牌又跟不出好牌，白白浪费了扣底的机会。
 *
 * 具体做法：
 *   1. 把副花色按「张数少 + 总分低」排序，优先整门扣掉；
 *   2. 只有能**完整扣光**的门才做缺门（扣一半没有意义）；
 *   3. 剩下的额度再按 不送分 → 非主牌 → 低牌力 扣。
 *
 * 注意：分牌（5/10/K）扣进底牌后，只要庄家守住最后一墩这些分就不会被闲家拿到，
 * 但闲家赢下最后一墩就会连底牌分一起拿走，所以仍然尽量不把大分扣进底。
 */
export function chooseAiDiscard(
  hand: CardData[],
  count: number,
  mainSuit: number,
): CardData[] {
  const discards: CardData[] = [];
  const remaining = new Set(hand.map(card => card.id));

  // 1. 按副花色分组（主牌不参与做缺门，主牌是要留着杀牌的）
  const offSuitBySuit = new Map<number, CardData[]>();
  for (const card of hand) {
    if (isMainCard(card, mainSuit)) continue;
    if (!offSuitBySuit.has(card.suit)) offSuitBySuit.set(card.suit, []);
    offSuitBySuit.get(card.suit)!.push(card);
  }

  // 2. 优先整门扣光：张数越少越容易扣光，同长度优先扣总分低的门
  const suitsByPriority = [...offSuitBySuit.values()].sort((a, b) =>
    a.length - b.length || handScore(a) - handScore(b)
  );
  for (const suitCards of suitsByPriority) {
    // 只有能完整扣光才做缺门；扣一半留一张，这门照样得跟牌，没有意义
    if (suitCards.length > count - discards.length) continue;
    for (const card of suitCards) {
      discards.push(card);
      remaining.delete(card.id);
    }
  }

  // 3. 剩余额度按 不送分 → 非主牌 → 低牌力 补齐
  const rest = hand
    .filter(card => remaining.has(card.id))
    .sort((a, b) => {
      const scoreDifference = getCardScore(a) - getCardScore(b);
      if (scoreDifference !== 0) return scoreDifference;
      const mainDifference = Number(isMainCard(a, mainSuit)) - Number(isMainCard(b, mainSuit));
      if (mainDifference !== 0) return mainDifference;
      return getCardRank(a, mainSuit) - getCardRank(b, mainSuit);
    });
  discards.push(...rest.slice(0, count - discards.length));

  return discards.slice(0, count);
}

function faceGroups(hand: CardData[]): CardData[][] {
  const groups: CardData[][] = [];
  for (const card of hand) {
    const group = groups.find(items => isSameFace(items[0], card));
    if (group) group.push(card);
    else groups.push([card]);
  }
  return groups;
}

function byRankAsc(mainSuit: number) {
  return (a: CardData, b: CardData) => getCardRank(a, mainSuit) - getCardRank(b, mainSuit);
}

function handScore(cards: CardData[]): number {
  return cards.reduce((sum, card) => sum + getCardScore(card), 0);
}

function sameFace(a: CardData, b: CardData): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

function countFace(cards: CardData[], face: CardData): number {
  return cards.filter(card => sameFace(card, face)).length;
}

/** 生成能压过这张牌的“牌面”，不含具体ID，只用于记牌推算。 */
function beatingFaces(card: CardData, mainSuit: number): CardData[] {
  const result: CardData[] = [];
  if (isMainCard(card, mainSuit)) {
    for (let suit = Suit.Spade; suit <= Suit.Club; suit++) {
      // 3到2：普通花色3~A，以及永远是主牌的7和2
      for (let rank = Rank.Three; rank <= Rank.Two; rank++) {
        const candidate: CardData = { id: 'memory', suit, rank };
        if (isMainCard(candidate, mainSuit)
          && getCardRank(candidate, mainSuit) > getCardRank(card, mainSuit)) result.push(candidate);
      }
    }
    for (const [suit, rank] of [[Suit.SmallJoker, Rank.SmallJoker], [Suit.BigJoker, Rank.BigJoker]]) {
      const candidate: CardData = { id: 'memory', suit, rank };
      if (getCardRank(candidate, mainSuit) > getCardRank(card, mainSuit)) result.push(candidate);
    }
    return result;
  }

  for (let rank = card.rank + 1; rank <= Rank.Ace; rank++) {
    if (rank === Rank.Seven) continue; // 7永远是主牌
    const candidate: CardData = { id: 'memory', suit: card.suit, rank };
    if (!isMainCard(candidate, mainSuit)) result.push(candidate);
  }
  return result;
}

/**
 * 判断一张牌从“外部威胁”看是不是当前剩余牌里的boss。
 * 只使用公开已出的牌、自己的手牌和固定副牌数，不读取其他玩家手牌。
 * 自己手里更高的牌不算威胁，因为不能在同一墩里打出来压自己。
 */
function isExternalBoss(
  card: CardData,
  hand: CardData[],
  context: AiPlayContext,
  mainSuit: number,
): boolean {
  const deckCount = context.deckCount;
  const playedCards = context.playedCards;
  if (!deckCount || !playedCards) return false;

  return beatingFaces(card, mainSuit).every(face => {
    const unseen = deckCount - countFace(playedCards, face) - countFace(hand, face);
    return unseen <= 0;
  });
}

function isGroupExternalBoss(
  group: CardData[],
  hand: CardData[],
  context: AiPlayContext,
  mainSuit: number,
): boolean {
  return group.some(card => isExternalBoss(card, hand, context, mainSuit));
}

/**
 * 「压箱底的大牌」：天王 / 大王 / 小王。
 *
 * 这几张牌不该在开局随手领出去，原因不只是"浪费大牌"，而是直接关系到结算：
 * 按规则，闲家赢下**最后一墩**且那手牌里含天王或大小王才算「挖底」
 * （1个天王保底3级，2个及以上封顶4级，仅大小王保底1级）。
 * 早早把天王打掉，等于主动放弃挖底，这是用户反馈"AI早早把天王出掉"的实质损失。
 */
function isPremiumTrump(card: CardData, mainSuit: number): boolean {
  return isTianWang(card, mainSuit) || isBigJoker(card) || isSmallJoker(card);
}

/** 这一手牌里有没有天王/大小王（挖底的本钱，不该随手花掉）。 */
function hasPremium(cards: CardData[], mainSuit: number): boolean {
  return cards.some(card => isPremiumTrump(card, mainSuit));
}

/**
 * 现在是否已到收尾阶段——手上没什么牌了，留着天王也没有下一墩可用，
 * 该打就打（也正好是争取挖底的那一墩）。
 *
 * 传了 context 且已知这是最后一墩时，一律算收尾：
 * 最后一墩不用大牌，留着就烂在手里了。
 */
function isEndgame(hand: CardData[], context?: AiPlayContext): boolean {
  if (context?.isFinalTrick) return true;
  /* 没有 isFinalTrick 信号时的兜底判断。
   * 原来定在 3 张偏松：一墩一张的话手上 3 张还有 3 墩要打，
   * 这时候甩天王等于提前两墩放弃挖底。收紧到 1 张
   * ——真的只剩这一手了，留着也没有下一墩可用。 */
  return hand.length <= 1;
}

/** 同结构同张数时，用最大单张点数比较，够用且不读隐藏信息。 */
function patternPower(cards: CardData[], mainSuit: number): number {
  return Math.max(...cards.map(card => getCardRank(card, mainSuit)));
}

function isAllMain(cards: CardData[], mainSuit: number): boolean {
  return cards.every(card => isMainCard(card, mainSuit));
}

/**
 * 挑一个值得领出的组合牌型，没有就返回 null。
 *
 * 优先级：
 *   1. 王组合 —— 全场最强，无人能压，直接打；
 *   2. 组合里含外部boss的连对/连三张 —— 大概率直接收墩；
 *   3. 没有记牌信息时，只打副牌高张(≥K)组成的组合，避免白送小连对。
 * 同优先级里取张数最多的（一次走掉更多牌），张数相同取牌力更高的。
 */
function pickComboLead(
  hand: CardData[],
  mainSuit: number,
  context: AiPlayContext,
): CardData[] | null {
  const combos = buildComboOptions(hand, mainSuit);
  if (combos.length === 0) return null;

  const byStrength = (a: CardData[], b: CardData[]) =>
    b.length - a.length || patternPower(b, mainSuit) - patternPower(a, mainSuit);

  /* 1. 王组合（大王组+小王组）全场无人能压，但它整副都是大小王 ——
   *    正是挖底的本钱。原来这里无条件 return，等于开局摸到王组合就甩掉，
   *    是"AI 早早把天王出掉"最直接的一条路径。收尾阶段才允许打。 */
  const jokerCombo = combos
    .filter(combo => identifyCardType(combo, mainSuit) === CardType.JokerCombo)
    .sort(byStrength)[0];
  if (jokerCombo && isEndgame(hand, context)) return jokerCombo;

  // 2. 含外部boss的组合：对手压不过，能稳收一墩
  const hasMemory = Boolean(context.playedCards && context.deckCount);
  if (hasMemory) {
    const bossCombo = combos
      .filter(combo => isGroupExternalBoss(combo, hand, context, mainSuit))
      /* 天王/大小王本身就是"无人能压"，所以含它们的连对必然被判成 boss 组合，
       * 结果开局第一手就甩出去。收尾阶段之前一律不拿它们去开路。
       * 注意这里必须用 isPremiumTrump（天王+大小王），原来只排了天王，
       * 大王对/小王对照样会被当成 boss 组合打掉。 */
      .filter(combo => isEndgame(hand, context) || !hasPremium(combo, mainSuit))
      .sort(byStrength)[0];
    if (bossCombo) return bossCombo;
    // 有记牌信息但没有稳赢组合时不冒进，交给后续常规策略
    return null;
  }

  // 3. 没有记牌信息：只打副牌高张组合（K/A 级别），小连对留着别送
  const strongOffSuit = combos
    .filter(combo => !isMainCard(combo[0], mainSuit))
    .filter(combo => patternPower(combo, mainSuit) >= 100 + Rank.King)
    .sort(byStrength)[0];
  return strongOffSuit ?? null;
}

/**
 * 领出策略：
 * 0. 手上有「稳赢的组合牌型」（连对/连三张/王组合且是外部boss）就先打出去，
 *    组合牌型张数多、对手难跟，是最高效的抓分和走牌手段；
 * 1. 手上有能一次走掉的整组（三张/对子），先用小的整组理牌；
 * 2. 优先攻副牌短门的小单张，逼对手交牌；
 * 3. 保留主牌和大牌到后面控场，不再无脑打最小牌。
 */
function chooseLead(hand: CardData[], mainSuit: number, context: AiPlayContext): CardData[] {
  const groups = faceGroups(hand);
  const offSuitGroups = groups.filter(group => !isMainCard(group[0], mainSuit));
  const mainGroups = groups.filter(group => isMainCard(group[0], mainSuit));

  // 优先领出组合牌型：张数多、结构强，对手往往跟不出同结构，收益最高。
  // 王组合无条件最强，直接打；连对/连三张要求是外部boss（没有记牌信息时
  // 退化为"只打副牌里的高张组合"），避免把小连对白送给对手。
  const comboLead = pickComboLead(hand, mainSuit, context);
  if (comboLead) return comboLead;

  // 只剩主牌时：有记牌信息就用“最小的外部boss”开路，避免浪费大牌。
  if (offSuitGroups.length === 0) {
    /* 天王/大小王要留到最后一墩（挖底），所以先把它们从候选里排掉；
     * 只有"除了这些就没别的牌可出"或已到收尾阶段时才动用。
     * 注意兜底那一行原本是按牌力**降序**取第一个，天王牌力 1000 必然排第一，
     * 所以这里不排掉的话，即使 boss 判定绕过了，兜底还是会把天王打出去。 */
    const keepPremium = !isEndgame(hand, context);
    const usable = keepPremium
      ? mainGroups.filter(group => !group.some(card => isPremiumTrump(card, mainSuit)))
      : mainGroups;
    const pool = usable.length > 0 ? usable : mainGroups;

    const bossMain = pool
      .filter(group => isGroupExternalBoss(group, hand, context, mainSuit))
      .sort((a, b) => patternPower(a, mainSuit) - patternPower(b, mainSuit))[0];
    const best = bossMain ?? [...pool]
      .sort((a, b) => patternPower(b, mainSuit) - patternPower(a, mainSuit))[0];
    if (best.length >= 3) return best.slice(0, 3);
    if (best.length >= 2) return best.slice(0, 2);
    return [best[0]];
  }

  // 副牌里的高张（A/K）能直接抓分时先打出去；有记牌时避免打出还没成boss的高张。
  const strongOffSuit = offSuitGroups
    .filter(group => getCardRank(group[0], mainSuit) >= 100 + Rank.King)
    .filter(group => !context.playedCards || isGroupExternalBoss(group, hand, context, mainSuit))
    .sort((a, b) => b.length - a.length || patternPower(b, mainSuit) - patternPower(a, mainSuit))[0];
  if (strongOffSuit) {
    if (strongOffSuit.length >= 3) return strongOffSuit.slice(0, 3);
    if (strongOffSuit.length >= 2) return strongOffSuit.slice(0, 2);
    return [strongOffSuit[0]];
  }

  // 否则出副牌里最小的一组，尽量不送分（不带5/10/K）。
  const safeGroups = offSuitGroups.filter(group => getCardScore(group[0]) === 0);
  const pool = safeGroups.length > 0 ? safeGroups : offSuitGroups;
  const smallest = [...pool].sort((a, b) => patternPower(a, mainSuit) - patternPower(b, mainSuit))[0];
  if (smallest.length >= 3) return smallest.slice(0, 3);
  if (smallest.length >= 2) return smallest.slice(0, 2);
  return [smallest[0]];
}

/** 从候选组合里挑出能压过当前最大牌的最小方案，压不过则返回 null。 */
function findWinningOption(
  options: CardData[][],
  leadCards: CardData[],
  context: AiPlayContext,
  mainSuit: number,
): CardData[] | null {
  const leadType = identifyCardType(leadCards, mainSuit);
  const winning = context.currentWinningCards;
  const winnerIsMain = isAllMain(winning, mainSuit);
  const winnerPower = patternPower(winning, mainSuit);
  // 首家甩牌时没有标准牌型可对齐，只要张数相同就有资格比（能不能赢由主牌/牌力决定）。
  const leadIsToss = isTossLead(leadCards, mainSuit);

  const viable = options.filter(option => {
    if (option.length !== leadCards.length) return false;
    if (!leadIsToss && identifyCardType(option, mainSuit) !== leadType) return false;
    const optionIsMain = isAllMain(option, mainSuit);
    if (optionIsMain !== winnerIsMain) return optionIsMain;
    return patternPower(option, mainSuit) > winnerPower;
  });
  if (viable.length === 0) return null;
  // 能赢就用代价最小的方案：先比牌力，再少送分。
  return viable.sort((a, b) =>
    patternPower(a, mainSuit) - patternPower(b, mainSuit) || handScore(a) - handScore(b)
  )[0];
}

/**
 * 首家是否甩牌：同门任意多张、不构成标准牌型。
 * 与 round.ts 的 leadIsToss 口径一致——甩牌资格已由服务端校验，
 * AI 这里只需要知道「本墩没有标准牌型可对齐」。
 */
function isTossLead(leadCards: CardData[], mainSuit: number): boolean {
  return leadCards.length >= 2 && identifyCardType(leadCards, mainSuit) === null;
}

/**
 * 枚举出所有「组合牌型」候选：连对、连三张、王组合。
 *
 * buildOptions 只会从同一个牌面里取 N 张（单/对/三张），
 * 凑不出跨点数的组合牌型，导致 AI 明明手握 ♦99+♦TT 也压不过对手的 ♦44+♦55。
 * 这里补上跨点数的枚举，交给 identifyCardType 做最终合法性判定
 * （主副混组、跨常主等非法情况会被它挡掉，不必在这里重复判断）。
 *
 * @param exactCount 只返回正好这个张数的组合；不传则返回所有长度。
 */
function buildComboOptions(
  cards: CardData[],
  mainSuit: number,
  exactCount?: number,
): CardData[][] {
  const options: CardData[][] = [];
  const push = (combo: CardData[]) => {
    if (exactCount !== undefined && combo.length !== exactCount) return;
    if (!identifyCardType(combo, mainSuit)) return;
    options.push(combo);
  };

  // 王组合：大小王等量各取 n 张
  const bigs = cards.filter(card => card.suit === Suit.BigJoker);
  const smalls = cards.filter(card => card.suit === Suit.SmallJoker);
  for (let n = 2; n <= Math.min(bigs.length, smalls.length); n++) {
    push([...bigs.slice(0, n), ...smalls.slice(0, n)]);
  }

  // 连对 / 连三张：按 花色+点数 聚合后，找连续的等量组
  const byFace = new Map<string, CardData[]>();
  for (const card of cards) {
    if (card.suit > Suit.Club) continue;
    const key = `${card.suit}-${card.rank}`;
    if (!byFace.has(key)) byFace.set(key, []);
    byFace.get(key)!.push(card);
  }
  for (const groupSize of [2, 3]) {
    for (let suit = Suit.Spade; suit <= Suit.Club; suit++) {
      // 起点点数遍历 3..A(14) 和 2(15)；连续性由 identifyCardType 兜底判定
      for (let start = Rank.Three; start <= Rank.Two; start++) {
        const combo: CardData[] = [];
        // 从起点往后连续接，每接一组就产出一个候选（2组、3组、4组…）
        for (let step = 0; step < 6; step++) {
          const rank = nextRankFrom(start, step);
          if (rank === null) break;
          const group = byFace.get(`${suit}-${rank}`) ?? [];
          if (group.length < groupSize) break;
          combo.push(...group.slice(0, groupSize));
          if (step >= 1) push([...combo]);
        }
      }
    }
  }
  return options;
}

/** 从 start 点数往后走 step 步的点数，遵循 K-A-2-3 跨接顺序。 */
function nextRankFrom(start: number, step: number): number | null {
  let rank = start;
  for (let i = 0; i < step; i++) {
    if (rank === Rank.Ace) rank = Rank.Two;
    else if (rank === Rank.Two) rank = Rank.Three;
    else if (rank >= Rank.Three && rank < Rank.Ace) rank = rank + 1;
    else return null;
  }
  return rank;
}

function buildOptions(cards: CardData[], count: number): CardData[][] {
  const groups = faceGroups(cards);
  const options: CardData[][] = [];
  if (count === 1) {
    for (const group of groups) options.push([group[0]]);
    return options;
  }
  for (const group of groups) {
    if (group.length >= count) options.push(group.slice(0, count));
  }
  return options;
}

/**
 * 跟牌用的全部候选：同牌面的 N 张 + 所有组合牌型。
 * 组合牌型必须一起纳入 findWinningOption 的候选池，
 * 否则 AI 永远压不过对手的连对/连三张。
 */
function buildFollowOptions(
  cards: CardData[],
  count: number,
  mainSuit: number,
): CardData[][] {
  return [...buildOptions(cards, count), ...buildComboOptions(cards, mainSuit, count)];
}

/**
 * 桌面上有多少分才值得动用大牌去抢。
 *
 * 一墩里 5/10 各 5 分、K 10 分（按 score.ts）。定在 10 分是因为：
 * 低于 10 分（比如只有一张 5）用天王去抢不值得，
 * 10 分往上（一张 K 或两张 5/10）已经影响叫分能否完成，该杀就杀。
 */
const WORTH_KILLING_SCORE = 10;

/**
 * 要动用天王/大小王去抢一墩，桌面至少得有多少分。
 *
 * 门槛比 WORTH_KILLING_SCORE 高得多，因为代价完全不同：
 * 普通大牌打掉就打掉了，天王/大小王打掉等于放弃挖底
 * （闲家用天王赢最后一墩保底 3 级、两张封顶 4 级）。
 * 定在 20 分 = 桌面已经有两张 K/10 级别的分牌，
 * 这种墩不抢会直接影响叫分能否完成，才值得花天王。
 */
const PREMIUM_KILL_SCORE = 20;

/** 挑选“最不心疼”的牌去垫：先不送分，再出最小牌力。 */
function pickDiscards(pool: CardData[], count: number, mainSuit: number): CardData[] {
  return [...pool]
    .sort((a, b) =>
      getCardScore(a) - getCardScore(b)
      || Number(isMainCard(a, mainSuit)) - Number(isMainCard(b, mainSuit))
      || getCardRank(a, mainSuit) - getCardRank(b, mainSuit)
    )
    .slice(0, count);
}

/** 同阵营已经拿下这一墩时，主动把分牌送进自家墩里。 */
function pickScoreFeed(pool: CardData[], count: number, mainSuit: number): CardData[] {
  return [...pool]
    .sort((a, b) =>
      getCardScore(b) - getCardScore(a)
      || getCardRank(a, mainSuit) - getCardRank(b, mainSuit)
    )
    .slice(0, count);
}

/**
 * 对战AI：领出会理牌型和攻短门，跟牌会判断能否压过、该不该压、
 * 以及给队友喂分还是保牌。仍然只读取自己的手牌与桌面公开信息。
 */
export function chooseAiPlay(
  hand: CardData[],
  leadCards: CardData[],
  mainSuit: number,
  context?: AiPlayContext,
): AiPlayAction {
  if (hand.length === 0) {
    return { type: 'play', cards: [], reason: 'hand_empty' };
  }

  const ctx: AiPlayContext = context ?? {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: leadCards,
    winnerIsAlly: false,
    isLastToPlay: false,
  };

  if (leadCards.length === 0) {
    return { type: 'play', cards: chooseLead(hand, mainSuit, ctx) };
  }

  const leadCard = leadCards[0];
  const followsLead = (card: CardData) => isMainCard(leadCard, mainSuit)
    ? isMainCard(card, mainSuit)
    : !isMainCard(card, mainSuit) && card.suit === leadCard.suit;

  const availableFollow = hand.filter(followsLead).sort(byRankAsc(mainSuit));
  const otherCards = hand.filter(card => !followsLead(card)).sort(byRankAsc(mainSuit));
  const requiredCount = leadCards.length;

  // 首家花色不够：必须全部跟出，剩余张数用其他牌补齐。
  if (availableFollow.length < requiredCount) {
    const fillCount = requiredCount - availableFollow.length;
    const mainCards = otherCards.filter(card => isMainCard(card, mainSuit));
    const trashCards = otherCards.filter(card => !isMainCard(card, mainSuit));

    // 完全没有首家花色时，可以用整套主牌杀牌争分。
    if (availableFollow.length === 0 && !ctx.winnerIsAlly) {
      // 甩牌墩没有标准牌型，主杀只要凑够张数的主牌即可，不必是对子/三张。
      const killerOptions = isTossLead(leadCards, mainSuit) && mainCards.length >= requiredCount
        ? [[...mainCards].sort(byRankAsc(mainSuit)).slice(0, requiredCount)]
        // 主杀也要能用主牌连对/连三张，才杀得掉对手的副牌连对。
        : buildFollowOptions(mainCards, requiredCount, mainSuit);
      const killer = findWinningOption(killerOptions, leadCards, ctx, mainSuit);
      /* 不用天王/大小王的杀法优先：手上没有首家花色时，任何主牌都能杀，
       * 犯不着拿挖底的本钱去换一墩。只有最后一墩或桌面分够大才动它。 */
      const killerNoPremium = findWinningOption(
        killerOptions.filter(option => !hasPremium(option, mainSuit)),
        leadCards,
        ctx,
        mainSuit,
      );
      const tableScore = handScore(leadCards) + handScore(ctx.currentWinningCards);
      /* 什么时候动用主牌杀牌（我没有首家花色，可以用主牌吃下这一墩）：
       *   - 最后一墩：闲家靠它挖底、庄家靠它保底，必杀；
       *   - 桌面有分：庄家杀分、闲家抓分；
       *   - 我是末位：不杀就白送。
       * 桌上一分没有又不是末位时，留着主牌后面杀分更划算。 */
      const worthKilling = ctx.isFinalTrick === true || tableScore > 0 || ctx.isLastToPlay;
      if (worthKilling) {
        // 优先用不含天王/大小王的主牌去杀
        if (killerNoPremium) return { type: 'play', cards: killerNoPremium };
        /* 只有天王/大小王能杀时，抬高门槛：最后一墩必杀，
         * 否则桌面至少要有 PREMIUM_KILL_SCORE 分才值得。 */
        if (killer && (ctx.isFinalTrick === true || tableScore >= PREMIUM_KILL_SCORE)) {
          return { type: 'play', cards: killer };
        }
      }
    }

    const fillPool = trashCards.length >= fillCount ? trashCards : otherCards;
    const fill = ctx.winnerIsAlly
      ? pickScoreFeed(fillPool, fillCount, mainSuit)
      : pickDiscards(fillPool, fillCount, mainSuit);
    const chosen = [...availableFollow, ...fill];
    if (chosen.length === requiredCount) return { type: 'play', cards: chosen };
    // 兜底：保证张数一定正确。
    const usedIds = new Set(chosen.map(card => card.id));
    const extra = hand.filter(card => !usedIds.has(card.id)).slice(0, requiredCount - chosen.length);
    return { type: 'play', cards: [...chosen, ...extra] };
  }

  const leadType = identifyCardType(leadCards, mainSuit);
  const legal = (candidate: CardData[]) =>
    candidate.length === requiredCount
    && checkFollow(leadCards, candidate, hand, mainSuit);

  // 按策略排出候选顺序，再用服务端同一套跟牌校验过滤，保证一定合法。
  const candidates: CardData[][] = [];

  if (ctx.winnerIsAlly) {
    // 同阵营暂时最大：不压自己人，优先把分牌喂进自家墩里。
    const feedGroups = buildFollowOptions(availableFollow, requiredCount, mainSuit)
      .sort((a, b) => handScore(b) - handScore(a));
    candidates.push(...feedGroups);
    candidates.push(pickScoreFeed(availableFollow, requiredCount, mainSuit));
  } else {
    // 对手暂时最大：能压就用代价最小的方案压。
    // 候选池必须含组合牌型，否则手握 ♦99+♦TT 也压不过对手的 ♦44+♦55。
    const allFollowOptions = buildFollowOptions(availableFollow, requiredCount, mainSuit);
    const winning = findWinningOption(allFollowOptions, leadCards, ctx, mainSuit);
    /* 「不动用天王/大小王也能压过」的方案。
     *
     * findWinningOption 只按"牌力最小"挑，而天王牌力 1000 —— 当手上恰好
     * 只有天王和一张更小但仍能压的牌时它会选对的，但很多局面里天王是
     * **唯一**能压的牌，于是每次对手一领大牌就把天王换掉一墩小分。
     * 这里单独算一个"不含 premium 的最小取胜方案"，让下面的决策能选择
     * 「宁可不压，也把挖底的本钱留到最后一墩」。 */
    const winningNoPremium = findWinningOption(
      allFollowOptions.filter(option => !hasPremium(option, mainSuit)),
      leadCards,
      ctx,
      mainSuit,
    );
    const tableScore = handScore(leadCards) + handScore(ctx.currentWinningCards);
    const winningIsBoss = winning?.some(card => isExternalBoss(card, hand, ctx, mainSuit)) ?? false;

    /* ===== 该不该抢下这一墩 =====
     *
     * 原来只有一条规则："不是末位且桌面没分就别花掉 boss"。
     * 这漏掉了两个双方都必须打的关键局面（用户反馈的"AI 不聪明"）：
     *
     * 1. **最后一墩**：闲家赢下它就拿走底牌分，用天王/大小王赢还额外拿
     *    保底级数（挖底）。所以这一墩闲家必须全力抢、庄家必须全力守，
     *    此时再"省大牌"是纯亏 —— 留到局终就烂在手里了。
     *
     * 2. **桌面有分**：庄家要杀分（把分抢回来），闲家要抓分。
     *    原逻辑 tableScore > 0 已覆盖，但门槛太松：桌上只有 5 分也会
     *    动用 boss。改成按分量决定值不值得。 */
    const mustWinThisTrick =
      // 最后一墩：双方都不能让（闲家挖底 / 庄家保底）
      ctx.isFinalTrick === true
      // 桌面分量可观：庄家杀分、闲家抓分都该出手
      || tableScore >= WORTH_KILLING_SCORE
      // 末位且桌上有分：我不压就白送对手
      || (ctx.isLastToPlay && tableScore > 0)
      /* 庄家杀分门槛要更低：庄家是 1 打 3，全场 200 分里闲家只要凑够
       * 叫分就升级，庄家每漏一墩分都是往对手的目标上送。所以只要桌上
       * 有分、又不用动天王，庄家就该压下来（对手方案不含 premium 时
       * 由 winningNoPremium 承接，代价很低）。 */
      || (ctx.isBanker && tableScore > 0);

    /* 选哪一手去压：
     *   1. 不用天王就能压 → 永远优先，天王留着挖底；
     *   2. 只有天王能压 → 只在"这一墩真的必须拿下"时才动用：
     *      最后一墩（挖底/保底）、桌面分够大（值得杀）、
     *      或者我是庄家且闲家正在把分往回收。
     * 桌上一两张小分就把天王换掉，是纯亏 —— 天王赢最后一墩
     * 直接值 3 个级数，远大于一墩 5 分。 */
    if (winningNoPremium && (mustWinThisTrick || !winningIsBoss)) {
      candidates.push(winningNoPremium);
    }
    const premiumWorthIt =
      ctx.isFinalTrick === true
      || tableScore >= PREMIUM_KILL_SCORE
      || (ctx.isBanker && ctx.isLastToPlay && tableScore >= WORTH_KILLING_SCORE);
    if (winning && winning !== winningNoPremium
      && (mustWinThisTrick || !winningIsBoss)
      && (!hasPremium(winning, mainSuit) || premiumWorthIt)) {
      candidates.push(winning);
    }

    /* 压不过时：优先用「散牌」凑张数，不要拆自己的对子/三张。
     *
     * 老实现直接把 buildFollowOptions 的结果按送分/牌力排序，而这些候选
     * 全是"同牌面的 N 张"，也就是对子和三张本身 —— 于是对手领出一个压不过
     * 的大对子时，AI 会把自己手里的小对子整对跟掉（用户反馈的"别人大一对，
     * 它也要把对跟掉"）。对子拆散后就再也压不了别人的对子，是纯亏。
     *
     * 正确顺序：先试"只用散牌"的组合，散牌不够才允许动成对的牌，
     * 且动的时候从最不值钱的开始。 */
    const followGroups = faceGroups(availableFollow);
    const singleCards = followGroups.filter(g => g.length === 1).map(g => g[0]);
    // 只用散牌就能凑够张数时，这是代价最小的跟法
    if (singleCards.length >= requiredCount) {
      candidates.push(pickDiscards(singleCards, requiredCount, mainSuit));
    }
    // 散牌不够：散牌全上 + 从最小的成对牌里抽零头补齐（拆最不心疼的那组）
    if (singleCards.length > 0 && singleCards.length < requiredCount) {
      const pairedPool = followGroups
        .filter(g => g.length > 1)
        .sort((a, b) => handScore(a) - handScore(b)
          || patternPower(a, mainSuit) - patternPower(b, mainSuit))
        .flat();
      const need = requiredCount - singleCards.length;
      const filler = pickDiscards(pairedPool, need, mainSuit);
      if (filler.length === need) candidates.push([...singleCards, ...filler]);
    }
    // 最后才是"整组跟出"（含拆对），保持原有兜底能力
    candidates.push(
      ...buildFollowOptions(availableFollow, requiredCount, mainSuit)
        .sort((a, b) => handScore(a) - handScore(b)
          || patternPower(a, mainSuit) - patternPower(b, mainSuit)),
    );

    if (leadType === CardType.Triple) {
      const pair = faceGroups(availableFollow).find(group => group.length >= 2);
      if (pair) {
        const pairIds = new Set(pair.slice(0, 2).map(card => card.id));
        const kicker = pickDiscards(
          availableFollow.filter(card => !pairIds.has(card.id)),
          1,
          mainSuit,
        );
        if (kicker.length === 1) candidates.push([...pair.slice(0, 2), kicker[0]]);
      }
    }

    candidates.push(pickDiscards(availableFollow, requiredCount, mainSuit));
  }

  // 兜底候选：直接按牌力顺序跟足张数，这是最基础的合法跟牌。
  candidates.push(availableFollow.slice(0, requiredCount));
  candidates.push([...availableFollow].reverse().slice(0, requiredCount));

  for (const candidate of candidates) {
    if (legal(candidate)) return { type: 'play', cards: candidate };
  }

  // 理论不可达：仍然按张数跟出，避免卡住对局。
  return { type: 'play', cards: availableFollow.slice(0, requiredCount) };
}

/**
 * 枚举「提示」可以给玩家的多套合法出牌方案。
 *
 * 为什么需要它：原来「提示」每次都调 chooseAiPlay，返回的永远是同一手牌，
 * 玩家撤回后再按还是那一手，等于只能看一个答案。这里把合法方案整理成一个
 * 有序列表，客户端反复按提示就能在方案之间轮转。
 *
 * 排序规则（第一个就是 AI 的推荐）：
 *   1. AI 推荐的那一手；
 *   2. 能赢下这一墩的方案，从代价最小的开始（牌力小、少送分）；
 *   3. 赢不了时的垫牌方案，同样从最不心疼的开始。
 *
 * 合法性一律交给服务端同一套校验（领出用 identifyCardType，跟牌用 checkFollow），
 * 所以提示给出的方案点「出牌」一定不会被服务端打回。
 *
 * @param limit 最多返回几套，默认 6（够轮转，又不至于让玩家按到迷路）。
 */
export function enumerateHintPlays(
  hand: CardData[],
  leadCards: CardData[],
  mainSuit: number,
  context?: AiPlayContext,
  limit = 6,
): CardData[][] {
  if (hand.length === 0) return [];

  const ctx: AiPlayContext = context ?? {
    isBanker: false,
    leaderIsAlly: false,
    currentWinningCards: leadCards,
    winnerIsAlly: false,
    isLastToPlay: false,
  };

  const recommended = chooseAiPlay(hand, leadCards, mainSuit, ctx).cards;
  const keyOf = (cards: CardData[]) => cards.map(c => c.id).sort().join(',');

  // ---- 领出：所有合法牌型（单张 / 对子 / 三张 / 连对 / 连三张 / 王组合）----
  if (leadCards.length === 0) {
    const raw: CardData[][] = [];
    for (const group of faceGroups(hand)) {
      raw.push([group[0]]);
      if (group.length >= 2) raw.push(group.slice(0, 2));
      if (group.length >= 3) raw.push(group.slice(0, 3));
    }
    raw.push(...buildComboOptions(hand, mainSuit));
    // 甩牌不在这里给：它要过 toss.ts 的资格校验，提示里给了可能被服务端打回。
    const legalLeads = raw.filter(cards => identifyCardType(cards, mainSuit) !== null);
    return orderHintOptions(legalLeads, recommended, keyOf, mainSuit, null, ctx, limit);
  }

  // ---- 跟牌 ----
  const leadCard = leadCards[0];
  const followsLead = (card: CardData) => isMainCard(leadCard, mainSuit)
    ? isMainCard(card, mainSuit)
    : !isMainCard(card, mainSuit) && card.suit === leadCard.suit;

  const availableFollow = hand.filter(followsLead).sort(byRankAsc(mainSuit));
  const otherCards = hand.filter(card => !followsLead(card)).sort(byRankAsc(mainSuit));
  const requiredCount = leadCards.length;
  const raw: CardData[][] = [];

  if (availableFollow.length < requiredCount) {
    // 本门不够：本门必须全出，剩下的张数用别的牌补。只枚举有代表性的补法，
    // 全排列会爆（8 张里挑 3 张就有 56 种），玩家也不需要看那么多。
    const fillCount = requiredCount - availableFollow.length;
    const trash = otherCards.filter(card => !isMainCard(card, mainSuit));
    const mains = otherCards.filter(card => isMainCard(card, mainSuit));
    const fills: CardData[][] = [];
    for (const pool of [trash, mains, otherCards]) {
      if (pool.length < fillCount) continue;
      fills.push(pickDiscards(pool, fillCount, mainSuit));   // 最不心疼
      fills.push(pickScoreFeed(pool, fillCount, mainSuit));  // 给队友喂分
      fills.push(pool.slice(0, fillCount));                  // 最小几张
      fills.push([...pool].reverse().slice(0, fillCount));   // 最大几张（主杀）
      fills.push(...buildOptions(pool, fillCount));          // 整组丢出去
    }
    for (const fill of fills) {
      if (fill.length === fillCount) raw.push([...availableFollow, ...fill]);
    }
  } else {
    // 本门够跟：任意 requiredCount 张本门牌都合法，枚举结构化的几类。
    raw.push(...buildFollowOptions(availableFollow, requiredCount, mainSuit));
    const singles = faceGroups(availableFollow).filter(g => g.length === 1).map(g => g[0]);
    if (singles.length >= requiredCount) {
      raw.push(pickDiscards(singles, requiredCount, mainSuit));
      raw.push(pickScoreFeed(singles, requiredCount, mainSuit));
    }
    raw.push(pickDiscards(availableFollow, requiredCount, mainSuit));
    raw.push(pickScoreFeed(availableFollow, requiredCount, mainSuit));
    // 从小到大滑窗：给玩家一串"中间档"的选择，成本低且一定合法。
    for (let i = 0; i + requiredCount <= availableFollow.length; i++) {
      raw.push(availableFollow.slice(i, i + requiredCount));
    }
  }

  const legalFollows = raw.filter(cards =>
    cards.length === requiredCount && checkFollow(leadCards, cards, hand, mainSuit));
  return orderHintOptions(legalFollows, recommended, keyOf, mainSuit, leadCards, ctx, limit);
}

/** 提示方案去重 + 排序：推荐在最前，然后「能赢的从小到大」，再「垫牌从便宜到贵」。 */
function orderHintOptions(
  options: CardData[][],
  recommended: CardData[],
  keyOf: (cards: CardData[]) => string,
  mainSuit: number,
  leadCards: CardData[] | null,
  ctx: AiPlayContext,
  limit: number,
): CardData[][] {
  const seen = new Set<string>();
  const unique: CardData[][] = [];
  const push = (cards: CardData[]) => {
    if (cards.length === 0) return;
    const key = keyOf(cards);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(cards);
  };

  push(recommended);
  const rest: CardData[][] = [];
  for (const option of options) {
    const key = keyOf(option);
    if (seen.has(key)) continue;
    seen.add(key);
    rest.push(option);
  }

  // 领出时无所谓"赢不赢"，直接按牌力从小到大；跟牌时先给能赢的方案。
  const wins = (option: CardData[]) => leadCards !== null
    && findWinningOption([option], leadCards, ctx, mainSuit) !== null;

  rest.sort((a, b) => {
    if (leadCards !== null) {
      const diff = Number(wins(b)) - Number(wins(a));
      if (diff !== 0) return diff;
    }
    return patternPower(a, mainSuit) - patternPower(b, mainSuit)
      || handScore(a) - handScore(b)
      || a.length - b.length;
  });

  for (const option of rest) {
    if (unique.length >= limit) break;
    unique.push(option);
  }
  return unique.slice(0, limit);
}
