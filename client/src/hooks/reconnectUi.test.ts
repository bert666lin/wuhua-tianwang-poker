/**
 * 断线重连提示的「接线」回归测试。
 *
 * 为什么用读源码的方式测，而不是渲染组件：
 *   本仓库的前端测试是纯逻辑的（tsx --test，没有 DOM/renderer），
 *   而这里要防的恰恰不是逻辑错误，而是**接线被静默丢掉**——
 *   历史上真实发生过：useColyseus 算出了 isReconnecting，App 也传给了 <Game>，
 *   Game.tsx 的类型里也声明了，但那一行 25 个 prop 的解构**漏写了它**，
 *   于是重连遮罩永远画不出来。TypeScript 不会报错（漏解构完全合法），
 *   lint 也不会报错，只有玩家在电梯里才会发现牌桌静止且毫无提示。
 *
 * 所以断言的对象就是「这条链路上每一环都还在」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(srcDir, rel), 'utf8');

test('isReconnecting 从 hook 一路传到牌桌，每一环都不能断', () => {
  const hook = read('hooks/useColyseus.ts');
  assert.match(hook, /isReconnecting,/, 'useColyseus 必须把 isReconnecting 放进返回值');

  const app = read('App.tsx');
  assert.match(app, /isReconnecting=\{isReconnecting\}/, 'App 必须把 isReconnecting 传给 Game');

  const game = read('pages/Game.tsx');
  // 关键：解构参数列表里必须有它，只在类型声明里出现是不够的
  const destructure = game.match(/export function Game\(\{([\s\S]*?)\}: GameProps\)/);
  assert.ok(destructure, '没找到 Game 的解构参数列表');
  assert.match(destructure![1], /\bisReconnecting\b/, 'Game 的解构参数漏了 isReconnecting（历史 bug）');
  assert.match(game, /isReconnecting=\{isReconnecting\}/, 'Game 必须把 isReconnecting 透传给牌桌');

  const adapter = read('components/TableV4Adapter.tsx');
  const adapterDestructure = adapter.match(/const \{([\s\S]*?)\n\s*\} = props/);
  if (adapterDestructure) {
    assert.match(adapterDestructure[1], /\bisReconnecting\b/, 'Adapter 的解构漏了 isReconnecting');
  }
  assert.match(adapter, /isReconnecting=\{isReconnecting\}/, 'Adapter 必须把 isReconnecting 传给 TableV4');
});

test('牌桌在重连时会渲染遮罩，并且不与错误红条同时出现', () => {
  const table = read('components/TableV4.tsx');
  assert.match(table, /isReconnecting = false/, 'TableV4 要给 isReconnecting 一个默认值');
  assert.match(table, /tv4-reconnect-mask/, 'TableV4 必须渲染重连遮罩');
  // 遮罩已经在解释情况，再叠一个红色错误条只会制造双重焦虑
  assert.match(
    table,
    /errorText && !isReconnecting/,
    '重连遮罩显示期间应抑制错误红条',
  );
});

test('重连遮罩的样式与动画都已定义', () => {
  const css = read('styles/table-v4.css');
  for (const cls of [
    '.tv4-reconnect-mask',
    '.tv4-reconnect-card',
    '.tv4-reconnect-spinner',
    '.tv4-reconnect-title',
    '.tv4-reconnect-tip',
  ]) {
    assert.ok(css.includes(cls), `样式缺少 ${cls}`);
  }
  assert.match(css, /@keyframes tv4-reconnect-spin/, '缺少转圈动画');
  // 遮罩必须盖在所有浮层之上（框选矩形是 999）
  const mask = css.match(/\.tv4-reconnect-mask \{([\s\S]*?)\}/);
  assert.ok(mask, '没找到遮罩样式块');
  const zIndex = Number(mask![1].match(/z-index:\s*(\d+)/)?.[1] ?? 0);
  assert.ok(zIndex > 999, `遮罩 z-index 必须大于 999，实际 ${zIndex}`);
});

test('错误提示统一走 showError，不再有裸 setError 漏掉自动消失', () => {
  const hook = read('hooks/useColyseus.ts');
  assert.match(hook, /const showError = useCallback/, '缺少 showError');
  assert.match(hook, /const clearError = useCallback/, '缺少 clearError');

  // showError/clearError 自己的实现里会用 setError，那是合法的；
  // 除此之外不该再有 setError(' 这种直接弹提示又忘了清的写法。
  const rawToasts = hook.match(/setError\(['"`]/g) ?? [];
  assert.equal(
    rawToasts.length,
    0,
    `还有 ${rawToasts.length} 处直接 setError 文案，会导致提示永久挂着`,
  );
});

test('物理断网会立刻提示，不用等 WebSocket 心跳超时', () => {
  const hook = read('hooks/useColyseus.ts');
  assert.match(hook, /addEventListener\('offline'/, '缺少 offline 事件监听');
  assert.match(hook, /addEventListener\('online'/, '缺少 online 事件监听');
  assert.match(hook, /removeEventListener\('offline'/, 'offline 监听必须在 cleanup 里摘掉');
  assert.match(hook, /removeEventListener\('online'/, 'online 监听必须在 cleanup 里摘掉');
});

test('重连倒计时的窗口必须与服务端 allowReconnection 一致', () => {
  const hook = read('hooks/useColyseus.ts');
  const declared = hook.match(/RECONNECT_WINDOW_MS = ([\d_]+)/)?.[1];
  assert.ok(declared, '缺少 RECONNECT_WINDOW_MS 常量');
  const clientMs = Number(declared!.replace(/_/g, ''));

  // 服务端是权威方：allowReconnection(client, 120) 里的秒数才决定座位何时释放。
  // 两边不一致时玩家会看到「倒计时还剩很多但座位已被释放并挨了逃跑罚金」，
  // 或者「倒计时归零了却还在转圈」——都比没有倒计时更让人困惑。
  const serverSrc = readFileSync(
    path.resolve(srcDir, '../../server/src/rooms/GameRoom.ts'),
    'utf8',
  );
  const serverSec = serverSrc.match(/allowReconnection\(\s*client\s*,\s*(\d+)\s*\)/)?.[1];
  assert.ok(serverSec, '没在服务端找到 allowReconnection(client, N)');

  assert.equal(
    clientMs,
    Number(serverSec) * 1000,
    `前端倒计时 ${clientMs}ms 与服务端窗口 ${serverSec}s 不一致`,
  );
});

test('一次掉线多个入口触发时，倒计时不会被反复推回满值', () => {
  const hook = read('hooks/useColyseus.ts');
  // offline 事件、onDrop、onLeave 兜底重连都会调用 beginReconnecting，
  // 若每次都重算 deadline，玩家看到的秒数会忽上忽下。
  assert.match(hook, /const beginReconnecting = useCallback/, '缺少 beginReconnecting');
  const body = hook.match(/const beginReconnecting = useCallback\(\(\) => \{([\s\S]*?)\}, \[/);
  assert.ok(body, '没找到 beginReconnecting 实现');
  assert.match(
    body![1],
    /setReconnectDeadline\(prev => prev \?\? /,
    'deadline 必须保留已有值（prev ?? ...），否则倒计时会被反复重置',
  );

  // 退出重连态时必须把 deadline 清掉，否则回大厅后残留一个过期时间
  const endBody = hook.match(/const endReconnecting = useCallback\(\(\) => \{([\s\S]*?)\}, \[/);
  assert.ok(endBody, '没找到 endReconnecting 实现');
  assert.match(endBody![1], /setReconnectDeadline\(null\)/, 'endReconnecting 要清空 deadline');
});

test('reconnectDeadline 从 hook 一路传到牌桌', () => {
  assert.match(read('hooks/useColyseus.ts'), /reconnectDeadline,/, 'hook 要返回 reconnectDeadline');
  assert.match(read('App.tsx'), /reconnectDeadline=\{reconnectDeadline\}/, 'App 要传下去');

  const game = read('pages/Game.tsx');
  const destructure = game.match(/export function Game\(\{([\s\S]*?)\}: GameProps\)/);
  assert.ok(destructure, '没找到 Game 的解构参数列表');
  assert.match(destructure![1], /\breconnectDeadline\b/, 'Game 解构漏了 reconnectDeadline');
  assert.match(game, /reconnectDeadline=\{reconnectDeadline\}/, 'Game 要透传给牌桌');

  const adapter = read('components/TableV4Adapter.tsx');
  assert.match(adapter, /reconnectDeadline=\{reconnectDeadline\}/, 'Adapter 要传给 TableV4');

  const table = read('components/TableV4.tsx');
  assert.match(table, /reconnectDeadline = null/, 'TableV4 要有默认值');
  assert.match(table, /tv4-reconnect-count/, '遮罩里要渲染倒计时');
  // 计时器必须在卸载/恢复时清掉
  assert.match(table, /clearInterval\(id\)/, '倒计时的 interval 要清理');
});

test('大厅断网时禁用入口按钮并说明原因', () => {
  /* 大厅在 2026-09 拆过文件：入口按钮与断网横幅搬到了 LobbyHome.tsx，
     在线状态与「发起前拦截」仍在 Lobby.tsx。这里按职责分别断言，
     并把两个文件拼起来兜底，避免下次搬家时这条测试又假失败。 */
  const lobby = read('pages/Lobby.tsx');
  const home = read('pages/LobbyHome.tsx');
  const both = lobby + home;

  assert.match(lobby, /useOnlineStatus/, '大厅要读取在线状态');
  assert.match(both, /lobby-offline-banner/, '要有断网横幅说明原因');
  // 只禁用不解释，玩家会以为游戏坏了
  const disabled = both.match(/disabled=\{loading \|\| offline\}/g) ?? [];
  assert.ok(disabled.length >= 3, `入口按钮应在断网时禁用，实际只有 ${disabled.length} 处`);
  // 点击入口前就地拦截，避免等 SDK 超时数秒毫无反馈
  assert.match(lobby, /navigator\.onLine/, '发起前要就地拦截断网');

  const css = read('styles/lobby-v6.css');
  assert.match(css, /\.lobby-quick-btn:disabled/, '禁用态必须有视觉区分');
  assert.match(css, /\.lobby-offline-banner/, '缺少断网横幅样式');
});

test('useOnlineStatus 在拿不到 navigator 时按在线处理，且会摘掉监听', () => {
  const src = read('hooks/useOnlineStatus.ts');
  // 误判成离线会把按钮永久锁死，比漏判严重得多
  assert.match(src, /typeof navigator === 'undefined'\) return true/, '拿不到 navigator 时要当作在线');
  assert.match(src, /removeEventListener\('online'/, 'online 监听要摘掉');
  assert.match(src, /removeEventListener\('offline'/, 'offline 监听要摘掉');
});
