/**
 * 后端地址推断。单独一个文件是为了能在 node 下直接单测
 * （utils/api.ts 顶层要读 import.meta.env 和 localStorage，node 里跑不起来）。
 */

/**
 * 去掉 base 末尾的 `/api` 与多余斜杠。
 *
 * 线上 .env.production 历史上写的是 `https://tianwang.geju8.cn/api`，
 * 而 utils/api.ts 里每个路径本身就带 `/api` 前缀，直接拼会变成
 * `/api/api/auth/guest` → 404，线上所有账号接口全挂。
 * 这里统一收敛成"站点根地址"，两种写法都能跑。
 */
export function normalizeBase(raw: string): string {
  let base = raw.trim().replace(/\/+$/, '');
  if (base.toLowerCase().endsWith('/api')) base = base.slice(0, -4);
  return base;
}

/**
 * 没配 VITE_API_BASE 时的推断值。
 *
 * 线上是单端口同源（Node 同时托管前端产物和接口），直接用 origin；
 * 只有 vite dev（5180 等端口）才需要把请求打到 2567。
 */
export function inferApiBase(loc?: { protocol: string; hostname: string; port: string; origin: string }): string {
  const l = loc ?? (typeof window === 'undefined' ? null : window.location);
  if (!l) return 'http://127.0.0.1:2567';
  const isDevServer = l.port !== '' && l.port !== '2567';
  return isDevServer ? `${l.protocol}//${l.hostname}:2567` : l.origin;
}
