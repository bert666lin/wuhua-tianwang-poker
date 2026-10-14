/**
 * 房间累计战绩的接线测试。
 *
 * 这份记录的价值全在"加起来对得上"：逐局明细之和必须等于各家累计级数，
 * 局数必须等于明细条数。一旦对不上，玩家会立刻发现并且再也不信这个功能。
 *
 * 能出错的地方偏偏都是类型系统看不见的：
 *   1. `resetForNewRound()` 每局都跑，如果谁顺手在里面清了 history，
 *      打第二局时前一局就凭空消失了；
 *   2. history 在两个地方各写一遍（正常结算 + 流局），很容易漏掉流局那条，
 *      于是"明细加起来 ≠ 累计级数"；
 *   3. 新玩家进房时 roomLevel 忘了归 0，会把上一桌的战绩带进来。
 *
 * 所以这里直接读 GameRoom.ts 源码做结构性断言，而不是只测纯函数。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./GameRoom.ts', import.meta.url), 'utf-8');
const GAME_STATE = readFileSync(new URL('../states/GameState.ts', import.meta.url), 'utf-8');
const PLAYER_STATE = readFileSync(new URL('../states/PlayerState.ts', import.meta.url), 'utf-8');

/**
 * 抠出某个方法的函数体（按大括号配平），用来断言"这段代码里有/没有某句话"。
 *
 * 注意必须锚定到【声明】而不是随便一处出现：`recordRoundHistory` 在
 * settleGame 里先被调用、定义在后面，只搜名字会抠到调用点的参数对象。
 */
function methodBody(src: string, name: string): string {
  // 声明形如 `private recordRoundHistory(input: {...})` 或 `settleGame(` 前带缩进+可选修饰符，
  // 而调用点一定带 `this.` 前缀 —— 用这个区分。
  const start = src.search(new RegExp(`\\n\\s*(?:private |public |protected |async )*${name}\\s*\\(`));
  assert.ok(start >= 0, `找不到方法 ${name} 的声明`);

  /* 找函数体的左大括号，不能简单取"声明后的第一个 {" ——
   * recordRoundHistory 的参数是个内联对象类型 `input: { ... }`，
   * 那个 { 会被误当成函数体开头，抠出来的是参数声明而不是实现。
   * 所以先把参数括号走完（parenDepth 归零），之后的第一个 { 才是函数体。 */
  let parenDepth = 0;
  let seenParen = false;
  let open = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') { parenDepth++; seenParen = true; }
    else if (ch === ')') parenDepth--;
    else if (ch === '{' && seenParen && parenDepth === 0) { open = i; break; }
  }
  assert.ok(open >= 0, `找不到 ${name} 的函数体`);

  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`${name} 的大括号没配平`);
}

describe('房间战绩字段都在 Schema 里（不同步等于没做）', () => {
  it('GameState 同步 history 和 roundsPlayed', () => {
    assert.match(GAME_STATE, /@type\(\[RoundRecordState\]\)\s*history/);
    assert.match(GAME_STATE, /@type\('uint16'\)\s*roundsPlayed/);
  });

  it('PlayerState 同步 roomLevel / roomBankerCount / roomBankerWins', () => {
    for (const field of ['roomLevel', 'roomBankerCount', 'roomBankerWins']) {
      assert.match(
        PLAYER_STATE,
        new RegExp(`@type\\([^)]*\\)\\s*${field}`),
        `${field} 没加 @type，客户端永远收不到`,
      );
    }
  });
});

describe('只有一处写 history（避免两条路径算出两个结果）', () => {
  it('history.push 只出现在 recordRoundHistory 里', () => {
    const pushes = [...SRC.matchAll(/state\.history\.push/g)];
    assert.equal(pushes.length, 1, 'state.history.push 应该只有一处，收敛在 recordRoundHistory');
    const body = methodBody(SRC, 'recordRoundHistory');
    assert.ok(body.includes('state.history.push'), 'history.push 应该在 recordRoundHistory 内');
  });

  it('roundsPlayed 只在 recordRoundHistory 里自增', () => {
    const bumps = [...SRC.matchAll(/roundsPlayed\s*\+=/g)];
    assert.equal(bumps.length, 1, 'roundsPlayed 只该在记一条战绩时加一');
  });
});

describe('正常结算和流局都要记一条', () => {
  it('settleGame 调用 recordRoundHistory', () => {
    assert.ok(
      methodBody(SRC, 'settleGame').includes('this.recordRoundHistory('),
      '正常打完一局没记进战绩',
    );
  });

  it('handleFlowBreak 也调用 recordRoundHistory', () => {
    // 流局照样改了各家级数，漏记就会让"明细之和 ≠ 累计级数"。
    assert.ok(
      methodBody(SRC, 'handleFlowBreak').includes('this.recordRoundHistory('),
      '流局没记进战绩，累计级数会和逐局明细对不上',
    );
  });

  it('累计级数与逐局 deltas 同源（都来自同一个 deltas 参数）', () => {
    const body = methodBody(SRC, 'recordRoundHistory');
    assert.match(body, /record\.deltas\.push\(input\.deltas\[seat\]/);
    assert.match(body, /p\.roomLevel\s*\+=\s*input\.deltas\[p\.seatIndex\]/);
  });
});

describe('resetForNewRound 不能清掉房间累计（它每局都跑）', () => {
  const body = methodBody(SRC, 'resetForNewRound');

  for (const field of ['history', 'roundsPlayed', 'roomLevel', 'roomBankerCount', 'roomBankerWins']) {
    it(`不碰 ${field}`, () => {
      assert.ok(
        !body.includes(field),
        `resetForNewRound 里出现了 ${field}：每局重置会把整桌战绩抹掉`,
      );
    });
  }
});
