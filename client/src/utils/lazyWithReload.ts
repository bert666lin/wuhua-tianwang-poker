// ===== 懒加载分包的加载失败恢复 =====
//
// 要解决的真实故障：用户反馈「打开新的画面，容易没内容，退出重新进软件又可以」。
//
// 根因是发版：
//   1. 二级页面（战绩/商城/排行…）都是 lazy() 懒加载的独立分包，
//      文件名带内容 hash，例如 assets/Records-CoaCHKbC.js
//   2. `deploy-online.sh` 是整体替换 frontend/ 目录 —— 旧 hash 的文件被**删掉**
//   3. 安卓壳直接加载线上地址，App 可以在后台挂很久。发版之后它手里还是
//      老的 index.html，点「战绩」时去请求那个已经不存在的分包 → 404
//   4. React 的 lazy() 拿到 reject，而外面**没有 ErrorBoundary**，
//      Suspense 只管 pending 不管 rejected，于是那块区域就永远空着，
//      而且 React 会把这个失败结果缓存住 —— 再点几次也还是空的。
//      只有杀掉 App 重开（重新拿到新 index.html）才恢复。
//      这与用户描述完全一致。
//
// 修法分两层，缺一不可：
//   · 先重试一次：真正的网络抖动（地铁、电梯）重试就好，没必要打扰用户
//   · 重试还失败就**刷新页面**：这种情况几乎一定是"分包已经不在服务器上了"，
//     刷新会拿到新的 index.html 和新的 hash，问题自然消失。
//     刷新前用 sessionStorage 打一个标记做防抖，避免万一是持续性故障时
//     陷入"刷新→失败→刷新"的死循环，把用户卡在白屏上。
//
// ⚠️ 不要试图用 ErrorBoundary 单独解决：ErrorBoundary 能显示兜底 UI，
// 但 React 已经缓存了那个 rejected 的 lazy 组件，点重试仍然是失败的。
// 必须在 import 这一层重试 / 刷新。

/** 已经因为分包加载失败刷新过一次了，别再刷。 */
const RELOAD_FLAG = 'tw_chunk_reloaded_at';
/** 同一次故障的判定窗口：10 秒内的第二次失败视为"刷新也没救"。 */
const RELOAD_DEBOUNCE_MS = 10_000;

function recentlyReloaded(): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_FLAG);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < RELOAD_DEBOUNCE_MS;
  } catch {
    // sessionStorage 不可用（隐私模式）时宁可不刷新，也不要陷入死循环
    return true;
  }
}

function markReloaded(): void {
  try { sessionStorage.setItem(RELOAD_FLAG, String(Date.now())); } catch { /* 忽略 */ }
}

/**
 * 给 `React.lazy` 用的 import 函数加上「重试一次，再不行就刷新」。
 *
 * @param load 原始的 `() => import('./Xxx')`
 * @param onGiveUp 测试注入点：真实环境走 location.reload()
 */
export function retryImport<T>(
  load: () => Promise<T>,
  onGiveUp: () => void = () => window.location.reload(),
): () => Promise<T> {
  return async () => {
    try {
      return await load();
    } catch (firstErr) {
      /* 第一次失败：等一小会儿重试。
       * 网络抖动重试就能过；分包真的没了则会再失败一次，走到下面。 */
      await new Promise(r => setTimeout(r, 350));
      try {
        return await load();
      } catch (secondErr) {
        /* 两次都失败，基本可以断定是"发版后旧分包已被删除"。
         * 刷新页面拿新的 index.html —— 这是唯一能真正恢复的动作。 */
        if (!recentlyReloaded()) {
          markReloaded();
          onGiveUp();
          /* 刷新是异步的，这里挂住不 resolve，避免在页面卸载前
           * 又把 rejected 状态塞给 React（那会闪一下错误 UI）。 */
          await new Promise(() => {});
        }
        // 已经刷过一次还是不行：把错误抛出去，让上层显示兜底 UI 而不是白屏
        throw secondErr instanceof Error ? secondErr : firstErr;
      }
    }
  };
}
