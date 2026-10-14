// 轻提示事件总线。组件在 components/Toast.tsx，这里只放数据与函数
// （放一起会触发 react-refresh 的 only-export-components 告警）。

export type ToastKind = 'info' | 'ok' | 'err';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

type Listener = (item: ToastItem) => void;

const listeners = new Set<Listener>();
let seq = 0;

/** 轻提示显示时长。 */
export const TOAST_DURATION_MS = 1800;

/** 弹一条轻提示。没有挂 <ToastHost /> 时静默丢弃，不会抛错。 */
export function showToast(text: string, kind: ToastKind = 'info'): void {
  if (!text) return;
  seq += 1;
  listeners.forEach(fn => fn({ id: seq, kind, text }));
}

/** 语法糖，读起来顺一点。 */
export const toast = {
  info: (text: string) => showToast(text, 'info'),
  ok: (text: string) => showToast(text, 'ok'),
  err: (text: string) => showToast(text, 'err'),
};

/** 订阅轻提示。返回取消订阅函数。 */
export function subscribeToast(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
