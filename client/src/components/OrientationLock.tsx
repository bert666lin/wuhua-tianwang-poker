// ===== 横屏锁定 v3 =====
// 监听方向变化，portrait 时全屏遮罩 + 旋转提示
// JS 调用 screen.orientation.lock('landscape')（仅 Android Chrome 支持）
// iOS Safari 不支持 API lock，但 PWA standalone + meta orientation 可强制

import { useEffect, useState, useCallback } from 'react';
import { CrownIcon, ChevronRightIcon } from './icons';
import '../styles/orientationLock.css';

interface OrientationLockProps {
  /** 可选：仅需横屏提示时可不传 */
  children?: React.ReactNode;
  /** 是否启用（开发/桌面端可关闭） */
  enabled?: boolean;
}

function detectPortrait(): boolean {
  // 优先用 matchMedia
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(orientation: portrait)').matches;
  }
  // fallback：比较宽高
  return window.innerHeight > window.innerWidth;
}

export function OrientationLock({ children, enabled = true }: OrientationLockProps) {
  const [isPortrait, setIsPortrait] = useState<boolean>(() => detectPortrait());

  // 尝试 JS 锁横屏（仅 Android Chrome/Edge 有效）
  const tryLock = useCallback(async () => {
    try {
      // @ts-ignore - 非标准 API
      const so = (screen as any).orientation;
      if (so && typeof so.lock === 'function') {
        await so.lock('landscape');
      }
    } catch {
      // iOS Safari / 普通浏览器不支持，静默失败
    }
  }, []);

  // 监听方向变化
  useEffect(() => {
    if (!enabled) return;

    const onChange = () => {
      setIsPortrait(detectPortrait());
    };

    const mq = window.matchMedia('(orientation: portrait)');
    mq.addEventListener('change', onChange);
    window.addEventListener('orientationchange', onChange);
    window.addEventListener('resize', onChange);

    // 首次进入尝试锁
    tryLock();

    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('orientationchange', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [enabled, tryLock]);

  // 桌面端（width > 1024）不强制横屏
  const isDesktop = typeof window !== 'undefined' && window.innerWidth > 1024;
  const shouldShowLock = enabled && !isDesktop && isPortrait;

  return (
    <>
      {children}
      {shouldShowLock && <PortraitOverlay onTryLock={tryLock} />}
    </>
  );
}

function PortraitOverlay({ onTryLock }: { onTryLock: () => void }) {
  return (
    <div className="orient-root" role="alertdialog" aria-modal="true">
      <div className="orient-portrait">
        <div className="orient-brand">
          <div className="orient-brand-icon">
            <CrownIcon size={32} tone="default" goldColor="#0F1A2E" />
          </div>
          <div className="orient-brand-name">五华天王</div>
        </div>

        <div className="orient-center">
          <div className="orient-rotate">
            <div className="orient-rotate-glow" />
            <div className="orient-rotate-phone">
              <CrownIcon size={36} tone="gold" goldColor="#A38E84" />
            </div>
            <span className="orient-rotate-arrow">→</span>
          </div>

          <div className="orient-text">
            <div className="orient-text-title">请旋转设备至横屏</div>
            <div className="orient-text-sub">
              本游戏专为横屏设计，请将手机横置以获得最佳体验
            </div>
          </div>
        </div>

        <div className="orient-footer">
          <div className="orient-hint">
            <ChevronRightIcon size={12} tone="gold-soft" />
            <span>建议关闭「锁定竖屏」开关</span>
          </div>
          <button className="orient-btn" onClick={onTryLock}>
            尝试锁定横屏
          </button>
        </div>
      </div>
    </div>
  );
}
