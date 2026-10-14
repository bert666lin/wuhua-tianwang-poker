/**
 * 随机对局压力测试。
 *
 * mode.test.ts 每种模式只跑一局、且全程用固定 AI 策略，覆盖不到罕见分支。
 * 这里对 6 种模式各跑多局，并在**合法范围内随机**选择跟牌与甩牌，
 * 每局校验一批不变量：
 *   - 发牌张数守恒、全牌分值等于模式总分
 *   - 扣底后手牌数正确
 *   - 每墩结束后各家手牌数必须一致（不存在漏出/多出）
 *   - 通过 checkFollow 的牌不能被 submitRoundPlay 拒绝（两处口径必须一致）
 *   - 收墩分 + 底牌分守恒、级数落在 0~4、结算不抛错
 *   - 对局必须能结束（防死循环）
 *
 * 用 SEED / GAMES 环境变量可放大强度做长跑排查。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_MODES, CardData, Rank } from './config.js';
import { dealCards } from './deck.js';
import { chooseAiDiscard, chooseAiPlay, type AiPlayContext } from './ai.js';
import { createPlayRound, submitRoundPlay, type PlayRoundState } from './round.js';
import { calcTrickScore } from './score.js';
import { getCardRank, identifyCardType } from './compare.js';
import { calculateOpponentLevel, evaluateDig, createLevelDeltas } from './levels.js';
import { checkFollow } from './validate.js';
import { resolveToss } from './toss.js';

// 可复现的伪随机
let seed = Number(process.env.SEED ?? 20260822);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

/* 发牌也必须走同一个种子，否则整个测试不可复现。
 *
 * 之前只有"怎么打"是seed控制的，"发到什么牌"却走 deck.ts 里的
 * Math.random —— 于是每次跑都是全新牌局。像 joker_combo（王组合领出）
 * 这种低频事件在 72 局里只出现 1~10 次，偶尔就是 0，断言 >0 会随机失败，
 * 而 deploy 前的质量闸门会被这种抖动挡住。
 * 这里在测试期间把 Math.random 换成种子随机，跑完还原。 */
const realRandom = Math.random;
Math.random = rnd;
process.on('exit', () => { Math.random = realRandom; });

interface Issue { mode: string; game: number; kind: string; detail: string; }
const issues: Issue[] = [];

// 穷举出合法的跟牌组合（张数正确 + 通过 checkFollow），用于随机挑一个
function legalFollows(lead: CardData[], hand: CardData[], mainSuit: number, cap = 60): CardData[][] {
  const need = lead.length;
  const out: CardData[][] = [];
  const combo: CardData[] = [];
  const walk = (start: number) => {
    if (out.length >= cap) return;
    if (combo.length === need) {
      if (checkFollow(lead, combo, hand, mainSuit)) out.push([...combo]);
      return;
    }
    for (let i = start; i < hand.length; i++) {
      combo.push(hand[i]); walk(i + 1); combo.pop();
      if (out.length >= cap) return;
    }
  };
  walk(0);
  return out;
}

/**
 * 从手牌里凑一手「组合牌型」用于领出：连对 / 连三张 / 王组合。
 * 目的是让压测真的走到这些新牌型的领出+跟牌+压牌路径，
 * 而不是只测单张对子（AI 自己只领单/对/三张）。
 */
function findComboLead(hand: CardData[], mainSuit: number): CardData[] | null {
  // 按 花色+点数 聚合
  const byFace = new Map<string, CardData[]>();
  for (const c of hand) {
    const k = `${c.suit}-${c.rank}`;
    if (!byFace.has(k)) byFace.set(k, []);
    byFace.get(k)!.push(c);
  }

  // 王组合：大小王各取等量（2或3张）
  const bigs = hand.filter(c => c.suit === 5);
  const smalls = hand.filter(c => c.suit === 4);
  const jn = Math.min(bigs.length, smalls.length);
  if (jn >= 2) {
    const n = Math.min(jn, 3);
    const combo = [...bigs.slice(0, n), ...smalls.slice(0, n)];
    if (identifyCardType(combo, mainSuit)) return combo;
  }

  // 连对 / 连三张：同花色相邻点数各有 >=2 或 >=3 张
  for (const size of [3, 2]) {
    for (let suit = 0; suit <= 3; suit++) {
      for (let rank = 3; rank <= 14; rank++) {
        const a = byFace.get(`${suit}-${rank}`) ?? [];
        const b = byFace.get(`${suit}-${rank + 1}`) ?? [];
        if (a.length >= size && b.length >= size) {
          const combo = [...a.slice(0, size), ...b.slice(0, size)];
          if (identifyCardType(combo, mainSuit)) return combo;
        }
      }
    }
  }
  return null;
}

function runGame(modeId: keyof typeof GAME_MODES, game: number, randomPlay: boolean, tryToss: boolean) {
  const mode = GAME_MODES[modeId];
  const { hands, bottom } = dealCards(mode);
  const totalCards = hands.reduce((s, h) => s + h.length, 0) + bottom.length;
  if (totalCards !== mode.perPlayer * mode.playerCount + mode.bottomCount) {
    issues.push({ mode: modeId, game, kind: '发牌数不守恒', detail: `${totalCards}` });
  }
  // 全牌分值总和必须等于模式总分
  const allScore = calcTrickScore([...hands.flat(), ...bottom]);
  if (allScore !== mode.totalScore) {
    issues.push({ mode: modeId, game, kind: '总分不符', detail: `实际${allScore} 期望${mode.totalScore}` });
  }

  let mainSuit = 255;
  for (const h of hands) { const s = h.find(c => c.rank === Rank.Seven)?.suit; if (s !== undefined) { mainSuit = s; break; } }
  if (mainSuit === 255) mainSuit = (bottom[5]?.suit ?? 0) <= 3 ? bottom[5].suit : 0;

  const bankerSeat = Math.floor(rnd() * mode.playerCount);
  const bankerHand = [...hands[bankerSeat], ...bottom];
  const discarded = chooseAiDiscard(bankerHand, mode.discardCount, mainSuit);
  const dIds = new Set(discarded.map(c => c.id));
  hands[bankerSeat] = bankerHand.filter(c => !dIds.has(c.id));
  if (hands[bankerSeat].length !== mode.perPlayer) {
    issues.push({ mode: modeId, game, kind: '扣底后手牌数错', detail: `${hands[bankerSeat].length}` });
  }
  const bottomCards = discarded;

  const trickScores = new Array(mode.playerCount).fill(0);
  let round: PlayRoundState = createPlayRound(mode.playerCount, bankerSeat);
  let guard = 0, tricks = 0, tossOk = 0, tossFail = 0;
  const comboLeads = { tractor: 0, triple_run: 0, joker_combo: 0 } as Record<string, number>;

  while (guard++ < 2000) {
    const seat = round.currentTurn;
    const hand = hands[seat];
    if (hand.length === 0) { issues.push({ mode: modeId, game, kind: '轮到空手玩家', detail: `seat${seat}` }); return; }
    const lead = round.plays[0]?.cards ?? [];
    const isAlly = (s: number) => (s === bankerSeat) === (seat === bankerSeat);
    const leaderSeat = round.plays[0]?.seat ?? seat;
    const winnerSeat = round.currentWinnerSeat ?? leaderSeat;
    const ctx: AiPlayContext = {
      isBanker: seat === bankerSeat, leaderIsAlly: isAlly(leaderSeat),
      currentWinningCards: [...round.currentWinningCards],
      winnerIsAlly: winnerSeat !== seat && isAlly(winnerSeat),
      isLastToPlay: round.plays.length === mode.playerCount - 1,
    };

    let cards: CardData[];
    let tossLead = false;

    // 领出时先试组合牌型，确保连对/连三张/王组合真的被打出来过
    // 只要能凑出组合就领出（概率不打折）：连三张要求同花色同点数各3张，
    // 自然出现率极低（实测三副牌 200 局才 2~17 手），打折就永远覆盖不到。
    const comboTry = lead.length === 0 ? findComboLead(hand, mainSuit) : null;
    if (comboTry) {
      cards = comboTry;
      const t = identifyCardType(comboTry, mainSuit);
      if (t && comboLeads[t] !== undefined) comboLeads[t]++;
    } else if (lead.length === 0 && tryToss && hand.length >= 3 && rnd() < 0.35) {
      // 随机试甩：取某门最大的若干张（模拟真人甩牌）
      const groups = new Map<string, CardData[]>();
      for (const c of hand) {
        const k = (c.suit >= 4 || c.rank === Rank.Seven || c.rank === Rank.Two || c.suit === mainSuit) ? 'main' : 's' + c.suit;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(c);
      }
      const cand = [...groups.values()].filter(g => g.length >= 2);
      if (cand.length) {
        const g = pick(cand);
        const others = new Map<number, CardData[]>();
        hands.forEach((h, s) => { if (s !== seat && h.length) others.set(s, h); });
        // 取该门最大的 2~3 张
        const desc = [...g].sort((a, b) => getCardRank(b, mainSuit) - getCardRank(a, mainSuit));
        const take = desc.slice(0, Math.min(2 + Math.floor(rnd() * 2), desc.length));
        const res = resolveToss(take, hand, others, mainSuit, true);
        if (res.cards.length) {
          cards = res.cards;
          tossLead = res.accepted && res.cards.length >= 2;
          if (res.accepted) tossOk++; else tossFail++;
        } else cards = chooseAiPlay(hand, lead, mainSuit, ctx).cards;
      } else cards = chooseAiPlay(hand, lead, mainSuit, ctx).cards;
    } else if (randomPlay && lead.length > 0) {
      const opts = legalFollows(lead, hand, mainSuit);
      cards = opts.length ? pick(opts) : chooseAiPlay(hand, lead, mainSuit, ctx).cards;
    } else {
      cards = chooseAiPlay(hand, lead, mainSuit, ctx).cards;
    }

    // 出的牌必须都在手上、无重复
    const hIds = new Set(hand.map(c => c.id));
    if (cards.some(c => !hIds.has(c.id)) || new Set(cards.map(c => c.id)).size !== cards.length) {
      issues.push({ mode: modeId, game, kind: '出牌不在手牌/重复', detail: `seat${seat}` }); return;
    }
    if (lead.length && cards.length !== lead.length) {
      issues.push({ mode: modeId, game, kind: '跟牌张数不符', detail: `${cards.length}!=${lead.length}` }); return;
    }

    let res;
    try {
      res = submitRoundPlay(round, seat, cards, mainSuit, hand, { tossLead });
    } catch (e) {
      issues.push({ mode: modeId, game, kind: '合法牌被拒', detail: `seat${seat} lead=${lead.length} n=${cards.length} toss=${tossLead} -> ${(e as Error).message}` });
      return;
    }
    const played = new Set(cards.map(c => c.id));
    hands[seat] = hand.filter(c => !played.has(c.id));
    round = res.state;

    if (res.state.resolved && res.roundWinnerSeat !== null) {
      tricks++;
      trickScores[res.roundWinnerSeat] += res.capturedScore;
      const left = hands.map(h => h.length);
      if (new Set(left).size > 1) {
        issues.push({ mode: modeId, game, kind: '墩后手牌数不齐', detail: left.join(',') }); return;
      }
      if (left[0] === 0) {
        const dig = evaluateDig(res.roundWinnerSeat, bankerSeat, [...res.state.currentWinningCards], mainSuit);
        let opp = trickScores.reduce((s, v, i) => i === bankerSeat ? s : s + v, 0);
        if (dig.success) opp += calcTrickScore(bottomCards);
        const level = calculateOpponentLevel({ opponentScore: opp, callScore: 105, deckCount: mode.deckCount as 2 | 3, dig });
        if (!(level.finalLevel >= 0 && level.finalLevel <= 4)) {
          issues.push({ mode: modeId, game, kind: '级数越界', detail: `${level.finalLevel}` });
        }
        try { createLevelDeltas(mode.playerCount, bankerSeat, !level.opponentWon, Math.max(1, level.finalLevel)); }
        catch (e) { issues.push({ mode: modeId, game, kind: '结算抛错', detail: (e as Error).message }); }
        // 抓分守恒：各家收墩分 + 底牌分 = 总分
        const sum = trickScores.reduce((a, b) => a + b, 0) + calcTrickScore(bottomCards);
        if (sum !== mode.totalScore) {
          issues.push({ mode: modeId, game, kind: '抓分不守恒', detail: `${sum}!=${mode.totalScore}` });
        }
        const expectTricks = mode.perPlayer;
        if (tricks < 1) issues.push({ mode: modeId, game, kind: '墩数异常', detail: `${tricks}` });
        return { tricks, tossOk, tossFail, level: level.finalLevel, expectTricks, comboLeads };
      }
      round = createPlayRound(mode.playerCount, res.roundWinnerSeat);
    }
  }
  issues.push({ mode: modeId, game, kind: '对局未结束(卡死)', detail: `guard=${guard}` });
}

const MODES = Object.keys(GAME_MODES) as Array<keyof typeof GAME_MODES>;
const GAMES = Number(process.env.GAMES ?? 12);

test(`6 种模式随机对局压力测试（每模式 ${GAMES} 局，含随机甩牌）`, () => {
  issues.length = 0;
  let done = 0, tossOkAll = 0, tossFailAll = 0;
  const combosAll: Record<string, number> = { tractor: 0, triple_run: 0, joker_combo: 0 };
  for (const mode of MODES) {
    for (let game = 1; game <= GAMES; game++) {
      // 偶数局随机跟牌，非 3 倍数局尝试甩牌，尽量铺开分支组合
      const result = runGame(mode, game, game % 2 === 0, game % 3 !== 0);
      if (result) {
        done++; tossOkAll += result.tossOk; tossFailAll += result.tossFail;
        for (const k of Object.keys(combosAll)) combosAll[k] += result.comboLeads[k] ?? 0;
      }
    }
  }
  const detail = issues.slice(0, 5).map(i => `${i.mode}#${i.game} [${i.kind}] ${i.detail}`).join('\n  ');
  assert.equal(issues.length, 0, `发现 ${issues.length} 个问题：\n  ${detail}`);
  assert.equal(done, MODES.length * GAMES, '有对局未正常完成');
  // 随机甩牌必须真的被触发过，否则这项覆盖是假的
  assert.ok(tossOkAll + tossFailAll > 0, '随机甩牌一次都没触发');
  // 连对和王组合在随机牌局里必然出现，强制断言防止覆盖造假。
  assert.ok(combosAll.tractor > 0, '连对一次都没领出过');
  assert.ok(combosAll.joker_combo > 0, '王组合一次都没领出过');
  // 连三张不强制断言：它要求同花色同点数各 3 张且不跨常主，
  // 实测发牌阶段只有 0.1%~2.3% 的手牌能凑出，靠随机碰不稳定。
  // 它的领出/跟牌/压牌路径由 round.test.ts 的确定性对局测试覆盖。
  console.log('  组合牌型领出次数:', JSON.stringify(combosAll));
});
