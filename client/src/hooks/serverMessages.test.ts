/**
 * 服务端消息契约测试。
 *
 * 这个文件测的是**类型系统抓不到的那部分**。把 `any` 换成 interface 只解决了
 * 「拼错字段名会报错」，但解决不了最要紧的问题：**接口声明的字段名和服务端
 * 实际广播的字段名是不是同一个**。声明 `seatIndex?: number` 而服务端发的是
 * `seat`，TypeScript 一声不响，运行时永远读到 undefined。
 *
 * 所以这里交叉读 server/src/rooms/GameRoom.ts 与 server/src/states/*.ts，
 * 逐个核对字段名。改坏任一边，测试立刻红。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readArray, readCardIds, readNumber, readString } from './serverMessages.js';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');
const GAME_ROOM = read('../../../server/src/rooms/GameRoom.ts');
const GAME_STATE = read('../../../server/src/states/GameState.ts');
const PLAYER_STATE = read('../../../server/src/states/PlayerState.ts');
const TRICK_PLAY_STATE = read('../../../server/src/states/TrickPlayState.ts');
const MESSAGES = read('./serverMessages.ts');
const SHAPE = read('./roomStateShape.ts');
const HOOK = read('./useColyseus.ts');

/** 抽出 `@type(...) 字段名` —— Schema 里真正会同步给客户端的字段。 */
function schemaFields(src: string): string[] {
  return [...src.matchAll(/@type\([^)]*\)\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]);
}

/** 抽出某个 interface 声明的字段名。 */
function interfaceFields(src: string, name: string): string[] {
  // 要认 `interface X {` 和 `interface X extends Y {` 两种写法
  const start = src.search(new RegExp(`interface ${name}\\b[^{]*\\{`));
  assert.ok(start >= 0, `找不到 interface ${name}`);
  const open = src.indexOf('{', start);
  let depth = 0, end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(open + 1, end);
  // 去掉注释再匹配，否则注释里的 `foo:` 会被当成字段
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  return [...clean.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map(m => m[1]);
}

describe('Schema 字段名与服务端一致（对不上就永远读到 undefined）', () => {
  it('GameStateLike 覆盖 GameState 里所有会同步的字段', () => {
    const server = schemaFields(GAME_STATE);
    const client = interfaceFields(SHAPE, 'GameStateLike');
    assert.ok(server.length > 15, `服务端 GameState 字段太少(${server.length})，正则可能失效了`);
    const missing = server.filter(f => !client.includes(f));
    assert.deepEqual(missing, [], `GameStateLike 缺了这些服务端字段：${missing.join(', ')}`);
  });

  it('GameStateLike 里没有服务端不存在的字段（拼错了会永远读到 undefined）', () => {
    const server = schemaFields(GAME_STATE);
    const client = interfaceFields(SHAPE, 'GameStateLike');
    const extra = client.filter(f => !server.includes(f));
    assert.deepEqual(extra, [], `GameStateLike 多了服务端没有的字段：${extra.join(', ')}`);
  });

  it('PlayerStateLike 与 PlayerState 字段名完全对得上', () => {
    const server = schemaFields(PLAYER_STATE);
    const client = interfaceFields(SHAPE, 'PlayerStateLike');
    assert.ok(server.length > 10, '服务端 PlayerState 字段太少，正则可能失效了');
    assert.deepEqual(
      server.filter(f => !client.includes(f)), [],
      'PlayerStateLike 缺字段',
    );
    assert.deepEqual(
      client.filter(f => !server.includes(f)), [],
      'PlayerStateLike 有服务端不存在的字段',
    );
  });

  it('TrickPlayStateLike 与 TrickPlayState 对得上', () => {
    const server = schemaFields(TRICK_PLAY_STATE);
    const client = interfaceFields(SHAPE, 'TrickPlayStateLike');
    assert.deepEqual(server.filter(f => !client.includes(f)), [], 'TrickPlayStateLike 缺字段');
  });
});

/**
 * 逐个消息核对：服务端 broadcast/send 的字段 → 客户端 interface 有没有声明。
 * 只挑客户端真正读了的消息（纯提示类广播客户端不读字段，不用管）。
 */
describe('消息字段名与服务端 broadcast 一致', () => {
  /** 取 `broadcast('xxx', { ... })` 或 `send('xxx', { ... })` 里的第一层字段名。 */
  function payloadFields(messageType: string): string[] {
    const re = new RegExp(`(?:broadcast|send)\\(\\s*'${messageType}'\\s*,\\s*\\{`, 'g');
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(GAME_ROOM)) !== null) {
      const open = GAME_ROOM.indexOf('{', m.index + messageType.length);
      let depth = 0, end = open;
      for (let i = open; i < GAME_ROOM.length; i++) {
        if (GAME_ROOM[i] === '{') depth++;
        else if (GAME_ROOM[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      const body = GAME_ROOM.slice(open + 1, end);
      // 只要最外层：把嵌套的 {...} 和 (...) 挖掉再匹配
      let flat = body;
      for (let i = 0; i < 6; i++) flat = flat.replace(/\{[^{}]*\}/g, '').replace(/\([^()]*\)/g, '');
      flat = flat.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
      for (const f of flat.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/g)) found.add(f[1]);
    }
    return [...found];
  }

  const cases: Array<[string, string]> = [
    ['score_bid', 'ScoreBidMessage'],
    ['action_timeout', 'ActionTimeoutMessage'],
    ['play_turn', 'PlayTurnMessage'],
    ['auto_play', 'AutoPlayMessage'],
    ['trustee_on', 'TrusteeMessage'],
    ['reconnected', 'ReconnectedMessage'],
    ['hint_result', 'HintResultMessage'],
    ['trick_end', 'TrickEndMessage'],
    ['toss_result', 'TossResultMessage'],
    ['discard_staged', 'DiscardStagedMessage'],
    ['chat', 'ChatMessagePayload'],
    ['voice', 'VoiceMessagePayload'],
  ];

  for (const [messageType, interfaceName] of cases) {
    it(`${messageType} → ${interfaceName}`, () => {
      const server = payloadFields(messageType);
      assert.ok(server.length > 0, `没能从 GameRoom.ts 里抽到 ${messageType} 的字段，正则失效了`);
      // PlayTurnMessage 从 DeadlineMessage 继承 deadline/timeLimit
      const client = [
        ...interfaceFields(MESSAGES, interfaceName),
        ...(MESSAGES.includes(`interface ${interfaceName} extends DeadlineMessage`)
          ? interfaceFields(MESSAGES, 'DeadlineMessage') : []),
      ];
      const missing = server.filter(f => !client.includes(f));
      assert.deepEqual(
        missing, [],
        `服务端 ${messageType} 发了这些字段但 ${interfaceName} 没声明：${missing.join(', ')}`,
      );
    });
  }

  /** game_settled 用 `{ ...result, coinRewards }` 展开，字段要从 result 定义处抽。 */
  it('game_settled → GameSettledMessage（含 coinRewards）', () => {
    const start = GAME_ROOM.indexOf('const result = {');
    assert.ok(start > 0, '找不到 settleGame 里的 result 对象');
    const open = GAME_ROOM.indexOf('{', start);
    let depth = 0, end = open;
    for (let i = open; i < GAME_ROOM.length; i++) {
      if (GAME_ROOM[i] === '{') depth++;
      else if (GAME_ROOM[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    let flat = GAME_ROOM.slice(open + 1, end);
    for (let i = 0; i < 6; i++) flat = flat.replace(/\{[^{}]*\}/g, '').replace(/\([^()]*\)/g, '');
    const server = [...flat.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/g)].map(m => m[1]);
    assert.ok(server.length > 15, `result 字段太少(${server.length})，正则失效了`);

    const client = interfaceFields(MESSAGES, 'GameSettledMessage');
    const missing = server.filter(f => !client.includes(f));
    assert.deepEqual(missing, [], `GameSettledMessage 缺了：${missing.join(', ')}`);
    assert.ok(client.includes('coinRewards'), 'coinRewards 是单独拼上去的，必须声明');
  });
});

describe('useColyseus.ts 不再用 any 接消息', () => {
  it('一个 any 都不剩（含 (room as any) 这类绕过）', () => {
    // 剥掉注释再查，避免注释里提到 any 造成误判
    const code = HOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    const hits = [...code.matchAll(/\bany\b/g)];
    assert.equal(hits.length, 0, `还剩 ${hits.length} 处 any`);
  });

  it('每个读字段的 onMessage 都标了具体消息类型', () => {
    const code = HOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    // onMessage('x', (message: 无类型) => ...) 这种写法不该存在
    const untyped = [...code.matchAll(/onMessage\(\s*'([a-z_]+)'\s*,\s*\(\s*message\s*\)/g)];
    assert.deepEqual(
      untyped.map(m => m[1]), [],
      '这些 onMessage 的 message 没标类型',
    );
  });
});

describe('取值辅助：网络来的脏数据不能变成 NaN 或崩溃', () => {
  it('readNumber 把缺失/脏值收敛成兜底值，不吐 NaN', () => {
    assert.equal(readNumber(7), 7);
    assert.equal(readNumber('7'), 7, '服务端偶尔发字符串数字也要认');
    assert.equal(readNumber(undefined), 0);
    assert.equal(readNumber(null), 0);
    assert.equal(readNumber('abc'), 0, 'NaN 必须被拦住，否则画面显示 NaN');
    assert.equal(readNumber(Infinity), 0, '无穷大也不能往下传');
    assert.equal(readNumber(NaN), 0);
  });

  /**
   * 座位号的"空值"是 255 而不是 0：兜底成 0 会让画面把 0 号位
   * 错认成庄家/赢家，这种错在牌桌上非常显眼却很难查。
   */
  it('readNumber 支持自定义兜底（座位号要用 255，不是 0）', () => {
    assert.equal(readNumber(undefined, 255), 255);
    assert.equal(readNumber(3, 255), 3);
    assert.equal(readNumber(0, 255), 0, '真的是 0 号位时不能被兜底顶掉');
  });

  it('readString 只认字符串，其他一律走兜底', () => {
    assert.equal(readString('阿强'), '阿强');
    assert.equal(readString(undefined, '玩家'), '玩家');
    assert.equal(readString(123, '玩家'), '玩家', '数字不是名字');
    assert.equal(readString(null, '玩家'), '玩家');
    assert.equal(readString(''), '', '空字符串是合法值，不该被兜底顶掉');
  });

  it('readArray 保证能安全 .map（不是数组就给空数组）', () => {
    assert.deepEqual(readArray([1, 2]), [1, 2]);
    assert.deepEqual(readArray(undefined), []);
    assert.deepEqual(readArray(null), []);
    // 传个对象进来也不能炸
    assert.deepEqual(readArray({ 0: 'a' } as unknown as string[]), []);
  });

  it('readCardIds 统一转字符串并丢掉空值', () => {
    assert.deepEqual(readCardIds(['a', 'b']), ['a', 'b']);
    assert.deepEqual(readCardIds([1, 2]), ['1', '2'], '数字 id 也要能用');
    assert.deepEqual(readCardIds(undefined), []);
    assert.deepEqual(readCardIds(['a', '', null]), ['a'], '空 id 选不中任何牌，直接丢');
  });
});
