/**
 * 「战果横幅 / 埋底确认 / 叫牌归属」三条链路的接线回归测试。
 *
 * 为什么读源码而不是渲染组件：见 reconnectUi.test.ts 开头的长注释 ——
 * 本仓库前端测试是纯逻辑的（tsx --test，无 DOM），而这里要防的正是
 * **接线被静默丢掉**：props 在 TableV4 的类型里声明了、组件内部也用了，
 * 但 Adapter 忘了传，TypeScript 不报错（可选 prop 不传完全合法）、
 * lint 也不报错，最后表现成「功能整个不存在」。
 *
 * 这三块都是本轮新写的，而且每一块都恰好是「多传一个可选 prop」的形状，
 * 属于最容易被漏掉的那类改动，所以钉死。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(srcDir, rel), 'utf8');

test('埋底确认：服务端不自动开打，客户端一路把确认动作接到底', () => {
  // 服务端：凑够张数只能发 discard_ready，绝不能顺手 commit
  const roomSrc = readFileSync(
    path.join(srcDir, '..', '..', 'server', 'src', 'rooms', 'GameRoom.ts'),
    'utf8',
  );
  assert.match(roomSrc, /discard_ready/, '服务端必须发 discard_ready 通知庄家可以确认了');
  assert.match(
    roomSrc,
    /onMessage\(\s*['"]confirm_discard['"]/,
    '服务端必须监听 confirm_discard，否则客户端点了确认没人接',
  );

  const hook = read('hooks/useColyseus.ts');
  assert.match(hook, /confirmDiscard,/, 'useColyseus 的返回值里必须有 confirmDiscard');

  const game = read('pages/Game.tsx');
  assert.match(
    game,
    /onConfirmDiscard=\{actions\.confirmDiscard\}/,
    'Game 必须把 confirmDiscard 传下去',
  );
  // 张数满了以后主按钮语义要变成「确认」，否则按钮写着确认却什么都不发生
  assert.match(
    game,
    /if \(remaining <= 0\) \{[\s\S]{0,200}actions\.confirmDiscard\(\)/,
    'Game 的 discard 分支在张数已满时必须走 confirmDiscard',
  );

  const adapter = read('components/TableV4Adapter.tsx');
  assert.match(
    adapter,
    /canConfirmDiscard=\{canConfirmDiscard\}/,
    'Adapter 必须把 canConfirmDiscard 传给 TableV4',
  );
  assert.match(
    adapter,
    /onConfirmDiscard=\{props\.onConfirmDiscard\}/,
    'Adapter 必须把 onConfirmDiscard 传给 TableV4',
  );
  // 可确认的判定必须以服务端暂存区为准，掺进本地选中数会让庄家点了被服务端拒
  assert.match(
    adapter,
    /const canConfirmDiscard = discardCount > 0 && stagedCount >= discardCount/,
    'canConfirmDiscard 必须只看 stagedCount，不能算上本地 selectedCount',
  );

  const table = read('components/TableV4.tsx');
  assert.match(table, /canConfirmDiscard && \(/, '牌桌底牌区必须有确认按钮的条件渲染');
});

test('战果横幅：先亮大字再弹结算，且不会把玩家永久卡在牌桌上', () => {
  const adapter = read('components/TableV4Adapter.tsx');
  assert.match(adapter, /<OutcomeBanner/, 'Adapter 必须真的渲染 OutcomeBanner（写了组件没引用等于没做）');
  assert.match(adapter, /onDone=\{\(\) => setBannerDone\(true\)\}/, '横幅播完要能放行结算面板');
  /* 结算面板必须被 bannerDone 门控，否则横幅白做。
   * 只断言「bannerDone && ... <Settlement」而不是精确的 `{bannerDone && (`：
   * 门控条件后来加了「玩家有没有把面板收起来」（settleCollapsed），
   * 写死字面量会让每次加条件都误报。真正要守的是"横幅没播完不许弹面板"。 */
  assert.match(adapter, /\{bannerDone && [^}]*<Settlement/s,
    '结算面板必须被 bannerDone 门控，否则横幅白做');
  // 兜底定时器：动效失效也不能让玩家看不到结算
  assert.match(
    adapter,
    /setTimeout\(\(\) => setBannerDone\(true\), \d+\)/,
    '必须有兜底定时器，横幅万一不回调也要把结算放出来',
  );
  // playKey 必须自增，不能是布尔量（连着两局同战果就不重播了）
  assert.match(adapter, /setBannerKey\(k => k \+ 1\)/, 'playKey 必须自增');

  const banner = read('components/OutcomeBanner.tsx');
  // 横幅和结算页必须共用同一套战果判定，否则会出现两处说法不一致
  assert.match(banner, /describeOutcome/, '横幅必须用 describeOutcome，不能自己再判一套');
  const settlement = read('components/Settlement.tsx');
  assert.match(settlement, /describeOutcome/, '结算页必须用同一个 describeOutcome');
});

test('叫主/抢主/叫分归属：服务端记全过程，客户端标明是谁', () => {
  const roomSrc = readFileSync(
    path.join(srcDir, '..', '..', 'server', 'src', 'rooms', 'GameRoom.ts'),
    'utf8',
  );
  /* 六个埋点少一个就会出现「记录里查不到某一步」。
   * 只断言 kind 字面量出现过 —— 叫主/抢主那两处是写成三元的
   * （isSteal ? 'steal_suit' : 'call_suit'），不能要求固定写法。 */
  const auctionCalls = roomSrc.match(/recordAuction\(\{[\s\S]*?\}\)/g) ?? [];
  const recorded = auctionCalls.join('\n');
  assert.ok(auctionCalls.length >= 6, `recordAuction 调用点太少（${auctionCalls.length} 处）`);
  for (const kind of ['call_suit', 'steal_suit', 'pass_suit', 'bottom_suit', 'bid', 'pass_bid']) {
    assert.ok(
      new RegExp(`['"]${kind}['"]`).test(recorded),
      `GameRoom 漏了 ${kind} 的埋点，记录面板会缺这一步`,
    );
  }
  // 换局必须清空，否则上一局的叫牌会串到下一局的记录面板里
  assert.match(roomSrc, /this\.auctionLog\s*=\s*\[\]/, '新一局必须清空 auctionLog');

  const adapter = read('components/TableV4Adapter.tsx');
  assert.match(adapter, /summarizeAuction\(auction\)/, 'Adapter 必须把 state.auction 汇总出来');
  for (const prop of ['auctionRows', 'suitCallerName', 'suitCallerSevens', 'suitFromBottom', 'suitStealCount']) {
    assert.match(adapter, new RegExp(`${prop}=\\{`), `Adapter 漏传 ${prop}，牌桌上就看不到是谁叫的主`);
  }

  const game = read('pages/Game.tsx');
  assert.match(game, /auction=\{roomState\.auction\}/, 'Game 必须把 roomState.auction 传给牌桌');

  // 顶栏和记录面板两处都要用上，只算不画等于没做
  const table = read('components/TableV4.tsx');
  assert.match(table, /tv4-score-main-by/, '顶栏必须显示「叫·XX / 抢·XX / 翻底定主」');
  assert.match(table, /auctionRows=\{auctionRows\}/, 'TableV4 必须把 auctionRows 透传给记录面板');
  const menus = read('components/TableV4Menus.tsx');
  assert.match(menus, /auctionRows\.map/, '记录面板必须逐条渲染 auctionRows');
});

test('新增的 CSS 类都有样式（有类名没样式 = 画出来是裸的）', () => {
  const tableCss = readFileSync(path.join(srcDir, 'styles', 'table-v4.css'), 'utf8');
  for (const cls of ['.tv4-score-main-by', '.tv4-panel-seat', '.tv4-panel-list-item.is-dim',
                     '.tv4-discard-ops', '.tv4-discard-confirm']) {
    /* 必须是完整的选择器，后面只能跟分隔符。
     * 用 includes 会被 `.tv4-panel-seat-XX` 这种改名骗过去（真踩过）。 */
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      tableCss,
      new RegExp(`${esc}\\s*[,{]`),
      `table-v4.css 缺 ${cls} 的样式（或选择器被改名了）`,
    );
  }
  const bannerCss = readFileSync(path.join(srcDir, 'styles', 'outcome-banner.css'), 'utf8');
  // 横幅是纯展示层，一旦能吃点击就会挡住结算页的「继续」按钮
  assert.match(bannerCss, /pointer-events: none/, '横幅必须 pointer-events:none，不能挡点击');
  // z-index 必须低于结算面板（settle-backdrop 300），否则退场动画期间盖住按钮
  const z = bannerCss.match(/\.ob-layer \{[\s\S]*?z-index: (\d+)/);
  assert.ok(z, '找不到 .ob-layer 的 z-index');
  assert.ok(Number(z![1]) < 300, `横幅 z-index 必须小于结算面板的 300，实际 ${z![1]}`);
});

test('扣底「还需几张」不能把本地选中数算进去（真实 bug，会让 UI 骗人）', () => {
  const adapter = read('components/TableV4Adapter.tsx');

  /* 这条是线上实测抓出来的 bug：
   * 原来写的是 discardCount - stagedCount - selectedCount。
   * 底牌还差 1 张、庄家一次选了 4 张时，这个数被算成 0，牌桌立刻显示
   * 「张数已够，确认后开打」、主按钮也切成「确认埋底」——
   * 可服务端暂存区明明只有 17/18 张，点确认必然被拒。
   * 表现出来就是「埋底埋不进去、按钮像坏了」。
   * 选中的牌只是"准备放"，没提交就不算扣下去了。 */
  assert.match(
    adapter,
    /const remainingDiscard = Math\.max\(0, discardCount - stagedCount\)/,
    'remainingDiscard 只能是 discardCount - stagedCount',
  );
  assert.ok(
    !/discardCount - stagedCount - selectedCount/.test(adapter),
    'remainingDiscard 不能再减 selectedCount（会让 UI 谎报「张数已够」）',
  );

  // 选多了必须有明确反馈，不能静默无反应
  assert.match(adapter, /const discardOverflow = Math\.max\(0, selectedCount - remainingDiscard\)/,
    '必须算出多选了几张');
  assert.match(adapter, /discardOverflow=\{discardOverflow\}/, '必须把 discardOverflow 传给牌桌');

  const table = read('components/TableV4.tsx');
  assert.match(table, /tv4-discard-over/, '牌桌必须显示「多选了 N 张」的提示');
  assert.match(
    table,
    /disabled=\{blocked \|\| \(isDiscarding && discardOverflow > 0\)\}/,
    '选多了要禁用主按钮：按不下去比按下去没反应清楚',
  );
  const css = readFileSync(path.join(srcDir, 'styles', 'table-v4.css'), 'utf8');
  assert.match(css, /\.tv4-discard-over\s*[,{]/, '缺 .tv4-discard-over 样式');
});
