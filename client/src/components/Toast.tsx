// ===== 全局轻提示宿主 =====
// 之前各页各写一套 toast state，很多按钮干脆什么都不反馈。
// 现在统一：任何地方 showToast('文案') 就能提示。

import { useEffect, useState } from 'react';
import { subscribeToast, TOAST_DURATION_MS, type ToastItem } from '../utils/toast';
import '../styles/toast.css';

/** 挂在 App 根节点，负责渲染所有轻提示。 */
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToast(item => {
    // 同时最多留 3 条，避免连点堆满屏幕
    setItems(prev => [...prev.slice(-2), item]);
    setTimeout(() => {
      setItems(prev => prev.filter(x => x.id !== item.id));
    }, TOAST_DURATION_MS);
  }), []);

  if (items.length === 0) return null;

  return (
    <div className="app-toast-host" role="status" aria-live="polite">
      {items.map(item => (
        <div key={item.id} className={`app-toast is-${item.kind}`}>{item.text}</div>
      ))}
    </div>
  );
}
