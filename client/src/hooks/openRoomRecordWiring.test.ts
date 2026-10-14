/**
 * 「开房记录 + 结算面板可关闭」的接线回归测试。
 *
 * 为什么读源码而不是渲染组件：见 reconnectUi.test.ts 开头的长注释 ——
 * 本仓库前端测试是纯逻辑的（tsx --test，无 DOM），而这里要防的两类事故
 * TypeScript 和 lint 都不会报：
 *   1. **可选 prop 忘了传**：表现成"功能整个不存在"（结算页没有累计战绩、
 *      战绩页按桌视图永远是空的）。
 *   2. **✕ 退化回"点一下就退房"**：这是本轮修的真 bug，
 *      Settlement 的 ✕ 曾经绑在 onReturnLobby 上，点一下人就被踢回大厅，
 *      还绕过了退房前的房间结算清单。它是"合法的一行代码"，
 *      只有钉死在测试里才不会被下一次重构改回去。
 *   3. **写了类名但没写样式**：渲染出来是一坨没有布局的裸文字。
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

// ===== 结算页的 ✕ =====

test('结算页 ✕ 绑的是关闭面板，绝不能是返回大厅', () => {
  const settlement = read('components/Settlement.tsx');
  const closeBtn = /className="settle-close"[\s\S]{0,120}?onClick=\{(\w+)\}/.exec(settlement);
  assert.ok(closeBtn, '找不到 settle-close 按钮');
  assert.equal(closeBtn[1], 'onClose',
    '✕ 必须调 onClose（关面板回牌桌）。绑 onReturnLobby 会把人直接踢回大厅，' +
    '还绕过退房前的房间结算清单');
});

test('结算面板收起后有路回去，否则玩家再也点不到「下一局」', () => {
  const adapter = read('components/TableV4Adapter.tsx');
  assert.match(adapter, /onClose=\{\(\) => setSettleCollapsed\(true\)\}/,
    'Adapter 必须把 onClose 接到"收起"上');
  assert.match(adapter, /settleCollapsed && \([\s\S]{0,500}?settle-reopen/,
    '收起后必须渲染「查看结算」按钮');
  assert.match(adapter, /setSettleCollapsed\(false\)/,
    '必须有把面板重新展开的入口');
});

test('结算面板收起后不用重新打开，可以直接开始下一局', () => {
  const adapter = read('components/TableV4Adapter.tsx');
  assert.match(adapter, /className="settle-next-collapsed"[\s\S]{0,180}?onClick=\{\(\) => onAction\('next'\)\}/,
    '收起后必须有直接调 next 的按钮，不能强迫玩家重开结算单');
});

test('多张出牌可点开查看大图，用户名只在大图里显示', () => {
  const table = read('components/TableV4.tsx');
  assert.match(table, /setInspectTrickSeat\(p\.seat\)/,
    '每家的出牌组必须能单独放大，多张牌叠密时才能看清');
  assert.doesNotMatch(table, /tv4-trick-owner/, '牌阵上方不再显示用户名小字');
  assert.match(table, /tv4-trick-inspect/, '要有独立的出牌大图层');
  assert.match(table, /tv4-trick-inspect-head[\s\S]{0,160}?owner\.name/,
    '点开大图后仍要标出玩家名和庄闲身份');
});

test('新一局的结算不会被上一局的「收起」状态藏掉', () => {
  const adapter = read('components/TableV4Adapter.tsx');
  /* settlementResult 变化时必须把 collapsed 重置。
   * 少了这一行，玩家上一局收起过面板，下一局结算就再也不弹出来了。 */
  const effect = /if \(!settlementResult\) \{[\s\S]{0,200}?\}\s*setBannerDone\(false\);\s*setSettleCollapsed\(false\);/;
  assert.match(adapter, effect,
    'settlementResult 变化的 effect 里必须重置 settleCollapsed');
});

// ===== 结算页里的本桌累计 =====

test('结算页能看到本桌累计战绩（面板是全屏遮罩，顶栏「记录」按钮点不到）', () => {
  const settlement = read('components/Settlement.tsx');
  assert.match(settlement, /roundsPlayed\?: number;/, 'Settlement 要声明 roundsPlayed');
  assert.match(settlement, /standings\?: StandingRow\[\];/, 'Settlement 要声明 standings');
  assert.match(settlement, /settle-roomtally/, '要渲染本桌累计区块');
  /* 口径必须与顶栏/退房清单同源。自己在结算页再算一遍累计，
   * 两处数字对不上时玩家就再也不信这份记录了。 */
  assert.match(settlement, /from '\.\.\/utils\/roomRecord'/,
    '累计级数的格式化要复用 utils/roomRecord，不要另写一份');

  const adapter = read('components/TableV4Adapter.tsx');
  assert.match(adapter, /roundsPlayed=\{roundsPlayed\}\s*\n\s*standings=\{standings\}/,
    'Adapter 必须把 roundsPlayed / standings 传进 Settlement');
});

test('本桌累计的类名都有样式（否则渲染成一坨裸文字）', () => {
  const css = read('styles/settlement.css');
  for (const cls of [
    'settle-roomtally-list', 'settle-roomtally-row', 'settle-roomtally-rank',
    'settle-roomtally-name', 'settle-roomtally-banker', 'settle-roomtally-level',
    'settle-reopen',
  ]) {
    assert.ok(css.includes(`.${cls}`), `settlement.css 缺少 .${cls} 的样式`);
  }
});

// ===== 顶栏局号文案 =====

test('顶栏写「已打 N 局」而不是「第 N+1 局」', () => {
  const table = read('components/TableV4.tsx');
  /* 「第 roundsPlayed+1 局」表达的是"下一局"，但它和结算面板的「赢 3 级」
   * 并排出现时会被读成"刚打完第 2 局"（其实刚打完第 1 局）。 */
  assert.ok(!/第\{roundsPlayed \+ 1\}局/.test(table),
    '不能写「第{roundsPlayed + 1}局」，结算时会被误读成多打了一局');
  assert.match(table, /已打\{roundsPlayed\}局/, '要写成「已打 N 局」这种既成事实');
});

// ===== 开房记录：服务端落库 =====

test('服务端把房间号和这桌第几局写进战绩表', () => {
  const db = readServer('data', 'db.ts');
  assert.match(db, /if \(version < 6\)/, '要有 v6 迁移');
  assert.match(db, /ALTER TABLE rounds ADD COLUMN room_id/, 'rounds 要加 room_id');
  assert.match(db, /ALTER TABLE rounds ADD COLUMN room_round_no/, 'rounds 要加 room_round_no');
  assert.match(db, /user_version = 6/, '迁移完要把 user_version 推到 6');

  const accounts = readServer('data', 'accounts.ts');
  assert.match(accounts, /roomId\?: string;/, 'RoundInput 要有 roomId');
  assert.match(accounts, /roomRoundNo\?: number;/, 'RoundInput 要有 roomRoundNo');
  assert.match(accounts, /is_card_room, room_id, room_round_no/,
    'INSERT 的列里必须带上新字段，否则数据永远是空的');
  assert.match(accounts, /roomId: String\(r\.room_id \?\? ''\)/,
    'listRounds 要把 room_id 映射出来');

  const room = readServer('rooms', 'GameRoom.ts');
  assert.match(room, /roomId: this\.roomId,/, 'GameRoom 要把房间号传给 recordRound');
  assert.match(room, /roomRoundNo: this\.state\.roundsPlayed,/,
    '局号要用 state.roundsPlayed（和牌桌顶栏显示的是同一个数）');
});

test('INSERT 的占位符个数和列数对得上（多写一列少写一个 ? 会在运行时才炸）', () => {
  const accounts = readServer('data', 'accounts.ts');
  const block = /INSERT INTO rounds \(([\s\S]*?)\)\s*VALUES \(([^)]*)\)/.exec(accounts);
  assert.ok(block, '找不到 recordRound 的 INSERT');
  const columns = block[1]
    .split(/[,\n]/)
    .map(t => t.replace(/--.*$/, '').trim())
    .filter(t => t.length > 0 && !t.startsWith('--'));
  const marks = block[2].split(',').filter(t => t.trim() === '?');
  assert.equal(columns.length, marks.length,
    `列数 ${columns.length} 与占位符数 ${marks.length} 不一致`);
});

// ===== 开房记录：前端接线 =====

test('战绩页真的用上了按桌分组，而不是只定义了函数', () => {
  const records = read('pages/Records.tsx');
  assert.match(records, /from '\.\.\/utils\/recordGroups'/, '要引入分组函数');
  assert.match(records, /groupByRoom\(filtered\)/,
    '分组要跟着筛选后的列表走，否则上面选了「本周」下面却是全部');
  assert.match(records, /<RoomGroupCard/, '要渲染按桌的卡片');
  assert.match(records, /listView === 'room'/, '要有按桌/按局的切换');
});

test('api 的 RoundRow 声明了房间字段，Records 也读出来（少一处就永远是空）', () => {
  const api = read('utils/api.ts');
  assert.match(api, /roomId: string;/, 'RoundRow 要有 roomId');
  assert.match(api, /roomRoundNo: number;/, 'RoundRow 要有 roomRoundNo');

  const records = read('pages/Records.tsx');
  assert.match(records, /roomId: String\(r\.roomId \?\? ''\)/,
    'toRichRound 要把 roomId 带上');
  assert.match(records, /roomRoundNo: Number\(r\.roomRoundNo \?\? 0\)/,
    'toRichRound 要把 roomRoundNo 带上');
});

test('开房记录的类名都有样式', () => {
  const css = read('styles/records.css');
  for (const cls of [
    'records-view-toggle', 'records-room', 'records-room-head', 'records-room-id',
    'records-room-main', 'records-room-line1', 'records-room-line2', 'records-room-line3',
    'records-room-right', 'records-room-level', 'records-room-coins', 'records-room-caret',
    'records-room-rounds', 'records-room-round', 'records-room-round-no',
    'records-room-round-res', 'records-room-minitag', 'records-room-round-score',
    'records-room-round-delta', 'records-room-tag', 'records-room-mode',
  ]) {
    assert.ok(css.includes(`.${cls}`), `records.css 缺少 .${cls} 的样式`);
  }
});

// ===== 牌桌上的累计级数（每家都要看得见）=====

test('每家座位上都显示本桌累计级数，不是只有顶栏有「我」的', () => {
  /* 级数是这游戏唯一的输赢单位，「谁领先、我落后几级」是每手牌都在权衡的事。
   * 原来只有顶栏显示我的累计，别人的要点开记录面板才看到 ——
   * 等于把最该常驻的数字藏进了二级菜单。 */
  const types = read('components/tableV4Types.ts');
  assert.match(types, /roomLevel\?: number;/, 'TableV4Player 要有 roomLevel');

  const transform = read('components/tableV4Transform.ts');
  assert.match(transform, /roomLevel: roundsPlayed > 0 \? \(p\.roomLevel \?\? 0\) : undefined/,
    '没打完一局要传 undefined 而不是 0（显示「0级」会被读成"打了但不输不赢"）');

  const adapter = read('components/TableV4Adapter.tsx');
  assert.match(adapter, /toV4Players\(players, mySeat, playerCount, activeTurn, leaderSeat, roundsPlayed\)/,
    'Adapter 必须把 roundsPlayed 传给 toV4Players，否则座位上永远不显示级数');

  const table = read('components/TableV4.tsx');
  // 对手座位 + 我的座位都要有
  const hits = (table.match(/tv4-seat-level/g) ?? []).length;
  assert.ok(hits >= 2, `对手座位和我的座位都要显示级数，当前只有 ${hits} 处`);
  assert.match(table, /p\.roomLevel !== undefined &&/, '对手座位要按 undefined 判断是否渲染');

  const css = read('styles/table-v4.css');
  for (const cls of ['tv4-seat-level', 'tv4-seat-level.is-up', 'tv4-seat-level.is-down']) {
    assert.ok(css.includes(`.${cls}`), `table-v4.css 缺少 .${cls}`);
  }
});

// ===== 退房必须先看结算清单（两条路径都要）=====

test('结算页底部「大厅」也要先弹房间结算清单，不能直接退房', () => {
  /* 用户反馈「退出房间我还没看到结算单」：顶栏 ✕ 那条路径有清单，
   * 但结算面板底部的「大厅」按钮直接调 onReturnLobby 把人踢回大厅了。
   * 一个功能两条路径、只有一条对，等于没做。 */
  const settlement = read('components/Settlement.tsx');
  assert.match(settlement, /onRequestLeave\?: \(\) => void;/,
    'Settlement 要有 onRequestLeave');
  const lobbyBtn = /aria-label="返回大厅"/.exec(settlement);
  assert.ok(lobbyBtn, '找不到「返回大厅」按钮');
  assert.match(settlement, /onClick=\{onRequestLeave \?\? onReturnLobby\}/,
    '「大厅」按钮要优先走 onRequestLeave（弹清单），onReturnLobby 只作兜底');

  const adapter = read('components/TableV4Adapter.tsx');
  /* 必须同时收起结算面板：退房清单是牌桌内部浮层（z-index 80, absolute），
   * 结算遮罩是 z-index 300 的 fixed 层，不收起清单会开在结算面板背后，
   * 玩家点了「大厅」看起来毫无反应 —— 比原来的 bug 更难查。 */
  assert.match(adapter, /onRequestLeave=\{\(\) => \{ setSettleCollapsed\(true\); requestLeave\(\); \}\}/,
    '要先收起结算面板再弹清单，否则清单会被 z-index 300 的结算遮罩盖住');

  const table = read('components/TableV4.tsx');
  assert.match(table, /settlementSlot\(\{ requestLeave: \(\) => setActivePanel\('leave'\) \}\)/,
    'TableV4 要把「弹退房清单」的能力交给注入的结算面板');
});

// ===== 打开新页面空白（懒加载分包 404）=====

test('所有懒加载分包都过 retryImport，否则发版后点开是永久空白', () => {
  /* 发版会删掉旧 hash 的分包文件，挂在后台的 App 手里还是老 index.html，
   * 点二级页时请求已不存在的文件 → 404 → Suspense 干等（它只管 pending
   * 不管 rejected，外面也没 ErrorBoundary）→ 那块区域永久空白，
   * 且 React 缓存这个失败，再点也没用，只有杀掉 App 重开才恢复。
   * 这就是用户说的「打开新画面容易没内容，退出重进又可以」。 */
  for (const file of ['App.tsx', 'pages/Lobby.tsx']) {
    const src = read(file);
    const bare = src.match(/lazy\(\(\) =>/g);
    assert.equal(bare, null,
      `${file} 里还有没包 retryImport 的裸 lazy(() => ...)，发版后点开会是空白`);
    assert.match(src, /lazy\(retryImport\(/, `${file} 要用 retryImport 包装懒加载`);
  }
});

test('战绩加载失败要说「加载失败 + 重试」，不能显示成「还没有战绩」', () => {
  /* 这两种情况以前长得一模一样：catch 完只弹个 3 秒就消失的 toast，
   * allRounds 保持空数组 → 渲染成「还没有战绩 / 打完一局就会记录在这里」。
   * 于是"网络抖了一下"被显示成"你没打过牌"，用户以为战绩丢了。 */
  const records = read('pages/Records.tsx');
  assert.match(records, /const \[loadError, setLoadError\] = useState<string \| null>\(null\)/,
    '要单独存加载失败的原因');
  assert.match(records, /setLoadError\(null\)/, '加载成功要清掉错误态');
  // 失败态必须排在"空态"之前判断，否则永远显示成"还没有战绩"
  const errIdx = records.indexOf('loadError ? (');
  const emptyIdx = records.indexOf("'还没有战绩'");
  assert.ok(errIdx > 0 && errIdx < emptyIdx,
    '失败态的分支必须在「还没有战绩」之前，否则失败仍会被显示成没数据');
  assert.match(records, /records-retry/, '要给一个当场能点的重试按钮');
  assert.ok(read('styles/records.css').includes('.records-retry'),
    'records.css 缺少 .records-retry 样式');
});

test('退房清单的两个按钮要贴底不随内容滚，否则打满几局就点不到', () => {
  /* 线上实测（横屏 844x390）：这两个按钮原来跟「逐局战绩」列表一起
   * 待在可滚动的 .tv4-panel-body 里，一桌打到第 3 局，按钮 top 就变成 409 —— 
   * 已经在 390 高的视口外面了。玩家看到满屏战绩却找不到「确认退出」。
   * Playwright 点击会自动滚动所以自动化不报错，但真人手指点不到。
   *
   * 静态复现（/tmp/panelrepro）：修前 1/3/8 局 → top 320/409/632；
   * 修后恒为 297，reachable 全为 true。 */
  const css = read('styles/table-v4.css');
  const block = /\.tv4-leave-actions \{([^}]*)\}/.exec(css);
  assert.ok(block, '找不到 .tv4-leave-actions 规则');
  const body = block[1];
  assert.match(body, /position:\s*sticky/,
    '.tv4-leave-actions 要 position:sticky，否则局数一多按钮就滚出屏幕');
  assert.match(body, /bottom:\s*0/, 'sticky 要钉在 bottom:0');
  /* 不透明底不能省：按钮悬在滚动内容上方，没有背景就会看到
   * 战绩文字从按钮下面穿过去。 */
  assert.match(body, /background:\s*var\(--tv4-panel-bg\)/,
    'sticky 按钮条要有不透明背景，否则滚动的文字会透出来');
});
