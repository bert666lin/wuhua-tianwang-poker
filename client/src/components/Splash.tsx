// ===== 启动画面 v3 =====
// 避免白屏，首屏加载时显示品牌 + 进度条
// 500ms 后自动淡出

import { useEffect, useState } from 'react';
import { CrownIcon } from './icons';
import '../styles/splash.css';

export function Splash() {
  const [visible, setVisible] = useState(true);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    // 800ms 后开始淡出
    const t1 = setTimeout(() => setHiding(true), 800);
    // 1.2s 后彻底移除
    const t2 = setTimeout(() => setVisible(false), 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (!visible) return null;

  return (
    <div className={`splash-root ${hiding ? 'is-hiding' : ''}`}>
      <div className="splash-bg" />
      <div className="splash-rays" />
      <div className="splash-content">
        <div className="splash-icon">
          <CrownIcon size={64} tone="gold" goldColor="#0F1A2E" />
        </div>
        <div className="splash-brand">五华天王</div>
        <div className="splash-sub">梅州五华 · 扑克对战</div>
        <div className="splash-bar">
          <div className="splash-bar-fill" />
        </div>
      </div>
    </div>
  );
}
