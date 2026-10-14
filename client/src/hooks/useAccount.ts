/**
 * 全局账号状态。
 *
 * 职责：
 *   1. 启动时用本地 token 恢复登录态；没有 token（或 token 失效）就自动开一个游客账号，
 *      让新用户点开就能玩，不用先注册。
 *   2. 提供 refresh()，任何改动余额的操作（买东西、领签到、打完一局）之后调一下，
 *      顶栏金币就跟着变。
 *   3. 服务端连不上时不把用户堵在门外：account 为 null，页面显示占位，
 *      但牌桌照样能进（只是不发币）。
 *
 * 为什么用模块级单例而不是 Context：
 *   大厅、商城、牌桌都是懒加载的独立子树，包一层 Provider 要改的入口太多；
 *   账号本来就是全应用唯一的一份，用一个订阅式 store 更直接，
 *   也顺便避免了"两个页面各自 fetch /api/me 拿到不一致余额"的问题。
 */

import { useEffect, useState } from 'react';
import {
  type AccountView, type AccountStats,
  fetchMe, loginGuest, getToken, clearToken, setUnauthorizedHandler,
  beatOnline,
} from '../utils/api';

export interface AccountState {
  account: AccountView | null;
  stats: AccountStats | null;
  /** 首次加载中（用于避免顶栏闪一下 0 金币） */
  loading: boolean;
  /** 服务端不可用时的错误文案，null 表示正常 */
  error: string | null;
}

const EMPTY_STATE: AccountState = { account: null, stats: null, loading: true, error: null };

let state: AccountState = EMPTY_STATE;
const listeners = new Set<() => void>();

function emit(next: Partial<AccountState>): void {
  state = { ...state, ...next };
  listeners.forEach(fn => fn());
}

/** 当前账号快照，供非 React 代码（如 useColyseus 建房时）读取。 */
export function currentAccount(): AccountView | null {
  return state.account;
}

/** 昵称：没登录时给个默认，牌桌上不要出现空名字。 */
export function currentNickname(fallback = '玩家'): string {
  return state.account?.nickname?.trim() || fallback;
}

let bootPromise: Promise<void> | null = null;

/**
 * 拉一次 /api/me，失败则按情况自动游客登录。
 * 并发调用会复用同一个 Promise，避免启动时几个页面各开一次游客号。
 */
export function bootstrapAccount(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      if (getToken()) {
        const r = await fetchMe();
        emit({ account: r.account, stats: r.stats, loading: false, error: null });
        startOnlineBeat();
        return;
      }
      const r = await loginGuest();
      emit({ account: r.account, stats: null, loading: false, error: null });
      startOnlineBeat();
      // 游客号刚建好还没战绩，补一次 me 把 stats 填上
      void refreshAccount();
    } catch (err) {
      // token 失效（换库/服务端重装）时 request 已清掉 token，这里再试一次开游客号
      if (!getToken()) {
        try {
          const r = await loginGuest();
          emit({ account: r.account, stats: null, loading: false, error: null });
          return;
        } catch { /* 下面统一报错 */ }
      }
      emit({
        account: null, stats: null, loading: false,
        error: err instanceof Error ? err.message : '账号服务不可用',
      });
    } finally {
      bootPromise = null;
    }
  })();
  return bootPromise;
}

/** 重新拉一次余额与战绩汇总。买东西/领奖/打完一局后调用。 */
export async function refreshAccount(): Promise<AccountView | null> {
  if (!getToken()) return null;
  try {
    const r = await fetchMe();
    emit({ account: r.account, stats: r.stats, loading: false, error: null });
    return r.account;
  } catch {
    return null;
  }
}

/** 接口已经返回了新账号视图时，直接写入，省一次请求。 */
export function setAccount(account: AccountView): void {
  emit({ account, loading: false, error: null });
}

/** 退出登录：清空状态并重新开一个游客号。 */
export async function resetToGuest(): Promise<void> {
  clearToken();
  emit({ account: null, stats: null, loading: true, error: null });
  await bootstrapAccount();
}

// token 失效时自动回到游客态，避免用户卡在"点什么都 401"的死局
setUnauthorizedHandler(() => {
  emit({ account: null, stats: null, loading: true, error: null });
  void bootstrapAccount();
});

/* ============================================================
   在线心跳
   ------------------------------------------------------------
   后台管理要看「在线人数 / 在线时长」，而服务端光看接口调用量
   是算不出时长的（玩家坐在牌桌上可能几分钟不发一个 HTTP 请求）。
   所以前端定时报一下“我还在”，服务端累加间隔。

   为什么是 60 秒：服务端单次累加上限是 90 秒（见 admin.ts），
   60 秒心跳留了余量，偶尔丢一拍也不会把时长算少。
   页面隐藏（切后台/锁屏）时停报，否则手机插着充电一晚会多出六七个小时。
   ============================================================ */
const BEAT_INTERVAL_MS = 60_000;
let beatTimer: number | null = null;

function sendBeat(): void {
  if (!getToken()) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  // 心跳失败不影响任何玩法，静默吞掉就行
  void beatOnline().catch(() => undefined);
}

/** 开始定时上报在线（幂等，多次调用只会有一个定时器）。 */
export function startOnlineBeat(): void {
  if (beatTimer !== null) return;
  sendBeat();
  beatTimer = window.setInterval(sendBeat, BEAT_INTERVAL_MS);
  // 从后台切回来时立即补一拍，把“回来了”这个时间点对齐
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sendBeat();
  });
}

/** 订阅账号状态。 */
export function useAccount(): AccountState & {
  refresh: () => Promise<AccountView | null>;
} {
  const [, force] = useState(0);

  useEffect(() => {
    const fn = () => force(n => n + 1);
    listeners.add(fn);
    if (state === EMPTY_STATE) void bootstrapAccount();
    return () => { listeners.delete(fn); };
  }, []);

  return { ...state, refresh: refreshAccount };
}
