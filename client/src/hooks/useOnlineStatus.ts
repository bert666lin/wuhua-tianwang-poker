/**
 * 浏览器网络连通性（navigator.onLine）。
 *
 * 用途：断网时把「快速开始 / 加入房间」这类会发起网络请求的按钮**禁掉**，
 * 并给出明确原因。原来的行为是按钮照常可点，点了要等 SDK 超时才报错，
 * 期间没有任何反馈，玩家会连点好几次，攒出一串失败提示。
 *
 * ⚠️ onLine 的语义只是「有没有网络链路」，**不代表连得上我们的服务器**：
 * 连着一个没有外网的 Wi-Fi 时 onLine 仍然是 true。
 * 所以它只能用来做「确定没网」的快速拦截，不能用来断言「一定连得上」。
 */
import { useEffect, useState } from 'react';

/** SSR / 老环境拿不到 navigator 时，一律当作在线，避免误锁死按钮。 */
function readOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(readOnline);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    // 挂载与事件之间可能已经变过一次，补读一次当前值
    setOnline(readOnline());
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return online;
}
