// ===== PWA 安装引导 v4 =====
// iOS Safari：教学「分享 → 添加到主屏幕」，并补一步「关掉竖屏方向锁定」
// iOS 微信内：微信浏览器没有 Safari 的分享按钮，必须先教「··· → 在浏览器打开」，
//            否则用户照着教程找分享按钮永远找不到。
// Android Chrome：用 beforeinstallprompt 触发原生安装
// Android 其它情况：拿不到 beforeinstallprompt（微信/部分国产浏览器），
//            直接把用户引到 /download 装原生 App —— 那才是真正免设置的全屏横屏。
// 非 standalone 模式时显示引导

import { useEffect, useState } from 'react';
import {
  CloseIcon, ShareIcon, CrownIcon, PlusIcon, DownloadIcon,
  PhoneIcon, LightningIcon, GamepadIcon, LockIcon,
} from './icons';
import { isNativeApp, isInWeixin } from '../utils/share';
import '../styles/installPrompt.css';

type PwaMode = 'standalone' | 'browser' | 'unknown';

/** 下载页：安卓装 App、苹果看图文教程都指到这里。 */
export const DOWNLOAD_PAGE_PATH = '/download/';

function detectPwaMode(): PwaMode {
  // 原生 App 壳本身就是已安装状态，别再引导「添加到主屏幕」
  if (isNativeApp()) return 'standalone';
  // iOS Safari
  // @ts-ignore
  if (typeof navigator !== 'undefined' && (navigator as any).standalone === true) {
    return 'standalone';
  }
  // 标准 PWA
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
    if (window.matchMedia('(display-mode: fullscreen)').matches) return 'standalone';
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return 'standalone';
  }
  return 'browser';
}

function detectPlatform(): 'ios' | 'android' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android|HarmonyOS/.test(ua)) return 'android';
  return 'desktop';
}

export function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<PwaMode>('unknown');
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');
  const [dismissed, setDismissed] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [inWeixin, setInWeixin] = useState(false);

  useEffect(() => {
    const m = detectPwaMode();
    const p = detectPlatform();
    setMode(m);
    setPlatform(p);
    setInWeixin(isInWeixin());

    // 仅在浏览器模式 + 移动端显示
    if (m === 'standalone' || p === 'desktop') return;

    // 已被用户关闭过则不再显示
    if (sessionStorage.getItem('install-prompt-dismissed') === '1') {
      setDismissed(true);
      return;
    }

    // Android 监听原生安装事件
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // 两端都延迟弹：让用户先看到大厅，别一进来就被弹窗糊住。
    // Android 即使没拿到 beforeinstallprompt 也要弹——此时引导去下载原生 App。
    const timer = setTimeout(() => setShow(true), p === 'ios' ? 2200 : 2600);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      clearTimeout(timer);
    };
  }, []);

  const handleDismiss = () => {
    setShow(false);
    setDismissed(true);
    sessionStorage.setItem('install-prompt-dismissed', '1');
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShow(false);
    }
    setDeferredPrompt(null);
  };

  if (mode === 'standalone' || platform === 'desktop' || dismissed || !show) {
    return null;
  }

  return (
    <>
      {/* 遮罩 */}
      <div className="ip-mask" onClick={handleDismiss} />
      {/* 引导卡 */}
      <div className="ip-card" role="dialog" aria-label="全屏横屏玩法">
        <button className="ip-close" onClick={handleDismiss} aria-label="关闭">
          <CloseIcon size={14} tone="mute" />
        </button>

        <div className="ip-header">
          <div className="ip-icon">
            <CrownIcon size={28} tone="gold" goldColor="#0F1A2E" />
          </div>
          <div className="ip-title">{platform === 'android' && !deferredPrompt ? '装上App，免设置' : '添加到主屏幕'}</div>
          <div className="ip-sub">获得全屏横屏体验</div>
        </div>

        <div className="ip-benefits">
          <div className="ip-benefit">
            <div className="ip-benefit-icon"><PhoneIcon size={16} tone="gold" /></div>
            <div className="ip-benefit-text">全屏沉浸，无地址栏</div>
          </div>
          <div className="ip-benefit">
            <div className="ip-benefit-icon"><LightningIcon size={16} tone="gold" /></div>
            <div className="ip-benefit-text">秒开应用，启动更快</div>
          </div>
          <div className="ip-benefit">
            <div className="ip-benefit-icon"><GamepadIcon size={16} tone="gold" /></div>
            <div className="ip-benefit-text">横屏锁定，体验更佳</div>
          </div>
        </div>

        {platform === 'ios' && <IosGuide inWeixin={inWeixin} onDone={handleDismiss} />}
        {platform === 'android' && (
          deferredPrompt ? (
            <div className="ip-action">
              <button className="ip-btn ip-btn--primary" onClick={handleInstall}>
                <DownloadIcon size={16} tone="dark" />
                <span>安装到主屏幕</span>
              </button>
              <button className="ip-btn ip-btn--ghost" onClick={handleDismiss}>
                稍后
              </button>
            </div>
          ) : (
            /* 微信内置浏览器等拿不到 beforeinstallprompt：引到下载页装 apk */
            <AndroidFallback inWeixin={inWeixin} onDone={handleDismiss} />
          )
        )}
      </div>
    </>
  );
}

/** 安卓拿不到原生安装事件时的兜底：去下载页装 App。 */
function AndroidFallback({ inWeixin, onDone }: { inWeixin: boolean; onDone: () => void }) {
  return (
    <div className="ip-ios">
      {inWeixin && (
        <div className="ip-wx-tip">
          <div className="ip-wx-tip-title">微信里不能直接装App</div>
          <div className="ip-wx-tip-body">
            点右上角 <span className="ip-ios-highlight">···</span> → <b>在浏览器打开</b>，再点下面的按钮
          </div>
        </div>
      )}
      <div className="ip-action">
        <a className="ip-btn ip-btn--primary" href={DOWNLOAD_PAGE_PATH} target="_blank" rel="noopener noreferrer">
          <DownloadIcon size={16} tone="dark" />
          <span>下载安卓App</span>
        </a>
        <button className="ip-btn ip-btn--ghost" onClick={onDone}>
          稍后
        </button>
      </div>
    </div>
  );
}

function IosGuide({ inWeixin, onDone }: { inWeixin: boolean; onDone: () => void }) {
  // 微信里没有 Safari 的分享按钮，先把用户送到 Safari 才谈得上后面几步
  if (inWeixin) {
    return (
      <div className="ip-ios">
        <div className="ip-wx-tip">
          <div className="ip-wx-tip-title">请先用 Safari 打开</div>
          <div className="ip-wx-tip-body">
            微信里没法全屏，也不能加到桌面
          </div>
        </div>
        <div className="ip-ios-steps">
          <div className="ip-ios-step">
            <div className="ip-ios-step-num">1</div>
            <div className="ip-ios-step-text">
              点右上角 <span className="ip-ios-highlight">···</span>
            </div>
          </div>
          <div className="ip-ios-step">
            <div className="ip-ios-step-num">2</div>
            <div className="ip-ios-step-text">
              选 <span className="ip-ios-highlight">在浏览器打开</span>
            </div>
          </div>
          <div className="ip-ios-step">
            <div className="ip-ios-step-num">3</div>
            <div className="ip-ios-step-text">
              照 <span className="ip-ios-highlight">教程页</span> 加到主屏幕
            </div>
          </div>
        </div>
        <a
          className="ip-btn ip-btn--ghost ip-btn--full"
          href={DOWNLOAD_PAGE_PATH}
          target="_blank"
          rel="noopener noreferrer"
        >
          查看图文教程
        </a>
        <button className="ip-btn ip-btn--ghost ip-btn--full" onClick={onDone}>
          我知道了
        </button>
      </div>
    );
  }

  return (
    <div className="ip-ios">
      <div className="ip-ios-steps">
        <div className="ip-ios-step">
          <div className="ip-ios-step-num">1</div>
          <div className="ip-ios-step-text">
            点击底部 <span className="ip-ios-highlight">
              <ShareIcon size={16} tone="gold" />
            </span> 分享按钮
          </div>
        </div>
        <div className="ip-ios-step">
          <div className="ip-ios-step-num">2</div>
          <div className="ip-ios-step-text">
            滑动找到 <span className="ip-ios-highlight">
              <PlusIcon size={16} tone="gold" />
              添加到主屏幕
            </span>
          </div>
        </div>
        <div className="ip-ios-step">
          <div className="ip-ios-step-num">3</div>
          <div className="ip-ios-step-text">
            点击右上角 <span className="ip-ios-highlight">添加</span>
          </div>
        </div>
        {/* 前 3 步只解决全屏；横屏还差这一步，控制中心的方向锁不关就永远转不过来 */}
        <div className="ip-ios-step">
          <div className="ip-ios-step-num">4</div>
          <div className="ip-ios-step-text">
            关掉控制中心的 <span className="ip-ios-highlight">
              <LockIcon size={14} tone="gold" />
              竖屏锁定
            </span>
          </div>
        </div>
      </div>
      <div className="ip-ios-illustration">
        <div className="ip-ios-safari">
          <div className="ip-ios-safari-bar">
            <span className="ip-ios-safari-url">tianwang.geju8.cn</span>
            <div className="ip-ios-safari-share">
              <ShareIcon size={18} tone="white" />
            </div>
          </div>
          <div className="ip-ios-safari-content" />
        </div>
        <div className="ip-ios-arrow"><ShareIcon size={20} tone="gold" /></div>
      </div>
      <a
        className="ip-btn ip-btn--ghost ip-btn--full"
        href={DOWNLOAD_PAGE_PATH}
        target="_blank"
        rel="noopener noreferrer"
      >
        看详细图文教程
      </a>
      <button className="ip-btn ip-btn--ghost ip-btn--full" onClick={onDone}>
        我知道了
      </button>
    </div>
  );
}
