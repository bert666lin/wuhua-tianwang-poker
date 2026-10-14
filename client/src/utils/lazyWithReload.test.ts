// retryImport 的行为测试。
//
// 这一组守的是用户报的这个故障：「打开新的画面，容易没内容，
// 退出重新进软件又可以」—— 发版删掉旧 hash 的分包后，挂在后台的 App
// 请求老文件拿到 404，Suspense 只管 pending 不管 rejected，
// 外面又没有 ErrorBoundary，于是那块区域永久空白。
//
// 这里能真跑（不需要 DOM）：retryImport 只依赖 Promise + sessionStorage，
// 后者用最小假实现注入。

import test from 'node:test';
import assert from 'node:assert/strict';
import { retryImport } from './lazyWithReload.js';

/* retryImport 在两次尝试之间会等 350ms（给网络抖动一个恢复窗口）。
 * 所有"等它跑完"的地方都必须比这个久，否则测的是中间状态。 */
const AFTER_RETRY_MS = 600;

/** 装一个假的 sessionStorage，让"刷新防抖"那段可测。 */
function installSessionStorage(): { clear: () => void } {
  const store = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  return { clear: () => store.clear() };
}

test('一次就成功时不该有任何重试开销', async () => {
  installSessionStorage().clear();
  let calls = 0;
  const load = retryImport(async () => { calls++; return 'ok'; }, () => {
    throw new Error('不该走到刷新');
  });
  assert.equal(await load(), 'ok');
  assert.equal(calls, 1, '成功就只调一次');
});

test('第一次失败会自动重试一次（网络抖动不该打扰用户）', async () => {
  installSessionStorage().clear();
  let calls = 0;
  const load = retryImport(async () => {
    calls++;
    if (calls === 1) throw new Error('网络抖了一下');
    return 'ok';
  }, () => { throw new Error('重试成功了就不该刷新'); });

  assert.equal(await load(), 'ok', '重试成功要正常返回模块');
  assert.equal(calls, 2, '应该正好试了两次');
});

test('两次都失败时刷新页面（分包已被发版删掉，只有拿新 index.html 能救）', async () => {
  installSessionStorage().clear();
  let calls = 0;
  let reloaded = 0;
  const load = retryImport(async () => {
    calls++;
    throw new Error('404');
  }, () => { reloaded++; });

  /* 放弃时故意不 resolve（等页面卸载），所以不能 await 它，
   * 否则测试会挂住 —— 用竞速确认"刷新被调用了且没有抛错给 React"。 */
  const race = await Promise.race([
    load().then(() => 'resolved').catch(() => 'rejected'),
    new Promise(r => setTimeout(() => r('pending'), AFTER_RETRY_MS)),
  ]);

  assert.equal(calls, 2, '刷新之前要真的试过两次');
  assert.equal(reloaded, 1, '两次都失败必须刷新页面');
  assert.equal(race, 'pending',
    '触发刷新后应挂住而不是抛错，否则会在页面卸载前闪一下错误 UI');
});

test('刷新过一次还失败就抛错，绝不陷入"刷新→失败→刷新"死循环', async () => {
  const ss = installSessionStorage();
  ss.clear();
  let reloaded = 0;
  const mk = () => retryImport(async () => { throw new Error('404'); }, () => { reloaded++; });

  // 第一轮：会刷新（挂住）
  void mk()().catch(() => {});
  await new Promise(r => setTimeout(r, AFTER_RETRY_MS));
  assert.equal(reloaded, 1);

  // 第二轮：sessionStorage 里有刚才的标记，这次必须抛错而不是再刷一次
  await assert.rejects(() => mk()(), /404/, '第二次失败要把错误抛出去');
  assert.equal(reloaded, 1, '绝不能刷第二次（否则用户被卡在白屏刷新循环里）');
});

test('sessionStorage 不可用时（隐私模式）宁可抛错也不刷新', async () => {
  // 隐私模式下 setItem/getItem 会抛 —— 此时无法记录"刷过了"，
  // 一旦刷新就会变成无限循环，所以必须选择抛错让上层显示兜底 UI。
  (globalThis as any).sessionStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  let reloaded = 0;
  const load = retryImport(async () => { throw new Error('404'); }, () => { reloaded++; });
  await assert.rejects(() => load(), /404/);
  assert.equal(reloaded, 0, 'storage 不可用时不能刷新，否则死循环');
});

test('超过防抖窗口的新故障可以再刷一次（这是另一次发版了）', async () => {
  const ss = installSessionStorage();
  ss.clear();
  // 手工写一个 11 秒前的标记：防抖窗口是 10 秒，应视为"另一次故障"
  (globalThis as any).sessionStorage.setItem('tw_chunk_reloaded_at', String(Date.now() - 11_000));
  let reloaded = 0;
  const load = retryImport(async () => { throw new Error('404'); }, () => { reloaded++; });
  void load().catch(() => {});
  await new Promise(r => setTimeout(r, AFTER_RETRY_MS));
  assert.equal(reloaded, 1, '距上次刷新已久，应该允许再刷一次');
});
