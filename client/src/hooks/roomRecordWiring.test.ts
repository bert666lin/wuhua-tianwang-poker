/**
 * 「房间累计战绩 + 退房清单」的接线回归测试。
 *
 * 为什么读源码而不是渲染组件：见 reconnectUi.test.ts 开头的长注释 ——
 * 本仓库前端测试是纯逻辑的（tsx --test，无 DOM），而这里要防的正是
 * **接线被静默丢掉**：可选 prop 忘了传，TypeScript 和 lint 都不报错，
 * 最后表现成「功能整个不存在」（面板打开是空的、顶栏什么都不显示）。
 *
 * 这一整条链路有 5 段（服务端 state → useColyseus → 页面 → Adapter → TableV4
 * → 面板），每一段都是"多传一个可选字段"的形状，全是高危改动。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(srcDir, rel), 'utf8');
const readServer = (...rel: string[]) =>
  readFileSync(path.join(srcDir, '..', '..', 'server', 'src', ...rel), 'utf8');

test('服务端把战绩放进 state 而不是只发广播', () => {
  /* 只靠 game_settled 广播的话，掉线重连、换设备、后来加入的人
   * 拿到的都是空历史 —— 而"我们打了几把了"恰恰是最需要随时能翻的。 */
  const gameState = readServer('states', 'GameState.ts');
  assert.match(gameState, /@type\(\[RoundRecordState\]\)\s*history/,
    'GameState 必须同步 history，否则重连的人看不到历史');
  assert.match(gameState, /@type\('uint16'\)\s*roundsPlayed/,
    'GameState 必须同步 roundsPlayed');

  const playerState = readServer('states', 'PlayerState.ts');
  for (const f of ['roomLevel', 'roomBankerCount', 'roomBankerWins']) {
    assert.match(playerState, new RegExp(`@type\\([^)]*\\)\\s*${f}`),
      `PlayerState 必须同步 ${f}`);
  }
});

test('useColyseus 把 history / roomLevel 转成前端类型', () => {
  const hook = read('hooks/useColyseus.ts');
  assert.match(hook, /function convertRoundRecord/,
    'useColyseus 必须有 history 的转换函数（ArraySchema 不能直接当数组用）');
  assert.match(hook, /state\.history\?\.forEach/,
    'history 是 ArraySchema，只能 forEach 取值');
  assert.match(hook, /roundsPlayed: readNumber\(state\.roundsPlayed\)/,
    'roundsPlayed 必须透传');
  for (const f of ['roomLevel', 'roomBankerCount', 'roomBankerWins']) {
    assert.match(hook, new RegExp(`${f}: readNumber\\(p\\.${f}\\)`),
      `玩家的 ${f} 必须透传，否则累计成绩表全是 0`);
  }
});

test('页面 → Adapter → TableV4 一路把战绩传到底', () => {
  const game = read('pages/Game.tsx');
  assert.match(game, /history=\{roomState\.history\}/,
    'Game 必须把 history 传给 Adapter');
  assert.match(game, /roundsPlayed=\{roomState\.roundsPlayed\}/,
    'Game 必须把 roundsPlayed 传给 Adapter');

  const adapter = read('components/TableV4Adapter.tsx');
  assert.match(adapter, /roundsPlayed=\{roundsPlayed\}/,
    'Adapter 必须把 roundsPlayed 传给 TableV4');
  assert.match(adapter, /standings=\{standings\}/,
    'Adapter 必须把 standings 传给 TableV4');
  assert.match(adapter, /roundRows=\{roundRows\}/,
    'Adapter 必须把 roundRows 传给 TableV4');
  // 整理逻辑必须走纯函数，不能在 JSX 里现算（那样测不到）
  assert.match(adapter, /toStandings\(players, mySeat\)/, 'standings 必须由 toStandings 算');
  assert.match(adapter, /toRoundRows\(history, players, mySeat\)/, 'roundRows 必须由 toRoundRows 算');

  const table = read('components/TableV4.tsx');
  assert.match(table, /standings=\{standings\}/, 'TableV4 必须把 standings 传给记录面板');
  assert.match(table, /rounds=\{roundRows\}/, 'TableV4 必须把 roundRows 传给面板');
  assert.match(table, /tv4-score-rounds/, '顶栏必须显示「第N局 + 我的累计级数」');

  const menus = read('components/TableV4Menus.tsx');
  assert.match(menus, /function StandingsList/, '面板必须有累计成绩表');
  assert.match(menus, /function RoundRowsList/, '面板必须有逐局战绩表');
});

test('退出房间必须先过退房清单，不能直接 leave', () => {
  const menus = read('components/TableV4Menus.tsx');
  assert.match(menus, /export function TableLeavePanel/, '必须有退房清单面板');
  /* 关键一条：菜单里的「退出房间」不能再直接调 onLeave。
   * 用户明确要求"关闭房间结算才能退出"，而且对局中误点会被罚金。 */
  assert.match(menus, /onRequestLeave\?\.\(\)/,
    '菜单的退出按钮必须走 onRequestLeave（打开清单），不是直接 onLeave');
  assert.ok(
    !/onLeave\?\.\(\)/.test(menus),
    '菜单里不该再有直接 onLeave 的调用 —— 那样点一下就掉出房间了',
  );

  const table = read('components/TableV4.tsx');
  assert.match(table, /onRequestLeave=\{\(\) => setActivePanel\('leave'\)\}/,
    'TableV4 必须把菜单的退出按钮接到退房清单');
  assert.match(table, /activePanel === 'leave'/, 'TableV4 必须渲染退房清单');
  // 顶栏那个 ✕ 图标也必须走清单，否则等于留了一个绕过确认的后门
  assert.match(
    table,
    /title="退出房间" onClick=\{\(\) => togglePanel\('leave'\)\}/,
    '顶栏退出图标也必须走退房清单，不能直接 onLeave',
  );
  // 真正的 leave 只能发生在清单里点了确认之后
  assert.match(
    table,
    /onConfirmLeave=\{\(\) => \{ setActivePanel\(null\); props\.onLeave\?\.\(\); \}\}/,
    '只有清单里的「确认退出」才真的离开房间',
  );
});

test('对局中退出的罚金警告要说出来，且只在真会被罚时说', () => {
  const adapter = read('components/TableV4Adapter.tsx');
  /* 服务端 applyEscapePenalty 只在对局中扣币。等待/结算阶段退出不罚，
   * 那时候弹罚金警告是白吓人，会让人不敢正常退房。 */
  assert.match(
    adapter,
    /leaveIsEscape=\{phase !== 'waiting' && phase !== 'settling' && phase !== 'flow_end'\}/,
    '逃跑判断必须在 Adapter 里做（TableV4 的 phase 已把 settling 折叠成 playing，分不出来）',
  );
  const menus = read('components/TableV4Menus.tsx');
  assert.match(menus, /算逃跑/, '清单里必须写明对局中退出会被判逃跑');

  /* 和服务端口径钉在一起。服务端 onLeave 里写的是
   *   phase !== Waiting && phase !== Settling
   * 客户端多一个 flow_end，因为流局在客户端是独立阶段、在服务端仍是 Settling。
   * 服务端哪天把这行改了（比如改成"发牌阶段也不罚"），这条会红，
   * 提醒同步改客户端 —— 否则玩家会看到一个说谎的警告。 */
  const roomSrc = readFileSync(
    path.join(srcDir, '..', '..', 'server', 'src', 'rooms', 'GameRoom.ts'), 'utf8',
  );
  assert.match(
    roomSrc,
    /const inProgress = this\.state\.phase !== Phase\.Waiting && this\.state\.phase !== Phase\.Settling;/,
    '服务端的逃跑阶段判断变了，客户端 leaveIsEscape 要跟着改',
  );
});

test('新增的 CSS 类都有样式（有类名没样式 = 画出来是裸的）', () => {
  const css = readFileSync(path.join(srcDir, 'styles', 'table-v4.css'), 'utf8');
  const classes = [
    '.tv4-score-rounds', '.tv4-room-level', '.tv4-room-banker',
    '.tv4-panel-list-item.is-me', '.tv4-panel-badge.is-me',
    '.tv4-round-no', '.tv4-round-outcome', '.tv4-round-detail',
    '.tv4-leave-headline', '.tv4-panel-note.is-warn',
    '.tv4-leave-actions', '.tv4-leave-btn', '.tv4-leave-btn.is-danger',
  ];
  for (const cls of classes) {
    /* 必须是完整选择器、后面只跟分隔符。用 includes 会被
     * `.tv4-room-level-XX` 这种改名骗过去（settlementWiring 里真踩过）。 */
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(css, new RegExp(`${esc}\\s*[,{:]`), `table-v4.css 缺 ${cls} 的样式`);
  }
  // 每个战果代号都要有配色，否则某些战果的标签是灰的、看不出区别
  for (const kind of ['bald', 'small_bald', 'hold', 'dig', 'over', 'flow_break']) {
    assert.match(css, new RegExp(`\\.tv4-round-outcome\\.is-${kind}\\s*[,{]`),
      `战果 ${kind} 缺配色`);
  }
});
