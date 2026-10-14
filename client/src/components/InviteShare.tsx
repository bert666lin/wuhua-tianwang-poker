// ===== 通用「分享 / 邀请」按钮组 =====
// 大厅的邀请好友、结算分享、商城分享都复用这一组按钮，避免各写一套。
//
// ===== 为什么没有"分享到微信"按钮 =====
// 微信不允许 H5 网页调起它的选好友界面（只有在微信内部打开 + 公众号 JS-SDK 才行）。
// 以前那个"分享到微信"其实是跳 weixin.qq.com 首页，等于把用户丢到微信官网，没用。
// 现在改成三条真正可用的路径：
//   1. 手机浏览器 -> 系统分享面板（navigator.share），面板里就有微信，点一下直进微信选好友；
//   2. 微信内打开 -> 提示用右上角「···」转发（这是微信里唯一的正路）；
//   3. 桌面浏览器 -> 复制链接（桌面没有系统分享面板）。

import { useState } from 'react';
import { copyText, canSystemShare, isInWeixin, systemShare } from '../utils/share';
import { showToast } from '../utils/toast';
import '../styles/inviteShare.css';

export interface InviteShareProps {
  /** 分享文案（系统面板/复制用） */
  text: string;
  /** 落地页地址 */
  url: string;
  /** 分享标题 */
  title: string;
  /** 分享摘要（部分系统面板会用到） */
  summary: string;
  /** 复制成功后的提示 */
  copyHint?: string;
  className?: string;
  /**
   * 用户真的执行了一次分享动作时回调。
   *
   * 用来解锁「分享送金币」：原来领奖按钮和分享按钮各自独立，
   * 打开面板不分享也能直接领钱（用户反馈"没分享就可以领金币"）。
   *
   * 注意口径：
   *   · system 只在 navigator.share 真正 resolve 后才上报（用户点了取消不算）；
   *   · copy 只在复制成功后上报。
   * 网页拿不到"对方是否真的收到"的回执，所以这只能保证"用户确实做了分享动作"，
   * 真实性最终靠每日次数上限兜着。
   */
  onShared?: (channel: 'system' | 'copy') => void;
}

export function InviteShare({
  text, url, title, summary, copyHint = '已复制，发给好友即可', className, onShared,
}: InviteShareProps) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const doCopy = async (): Promise<boolean> => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    return ok;
  };

  const onCopy = async () => {
    const ok = await doCopy();
    showToast(ok ? copyHint : '复制失败，请手动复制', ok ? 'ok' : 'err');
    if (ok) onShared?.('copy');
  };

  /** 拉起系统分享面板；里面有微信/QQ/短信等所有已装的应用。 */
  const onSystemShare = async () => {
    if (sharing) return;   // 面板已经开着时别重复拉起
    setSharing(true);
    try {
      const r = await systemShare({ title, text: `${text}${summary ? '' : ''}`, url });
      if (r === 'shared') {
        showToast('分享成功', 'ok');
        onShared?.('system');
      } else if (r === 'failed' || r === 'unsupported') {
        // 兜底：拉不起面板就退回复制，别让用户卡在这
        const ok = await doCopy();
        showToast(ok ? '已复制链接，粘贴给好友即可' : '分享失败，请手动复制链接', ok ? 'ok' : 'err');
        if (ok) onShared?.('copy');
      }
      // r === 'cancelled'：用户主动取消，什么都不做（不提示、不发奖）
    } finally {
      setSharing(false);
    }
  };

  const inWeixin = isInWeixin();
  const hasSystemShare = canSystemShare();

  return (
    <div className={`invite-share ${className ?? ''}`}>
      {/* 微信内部：唯一的正路是右上角「···」，先把链接复制好 */}
      {inWeixin && (
        <button type="button" className="invite-share-btn invite-share-btn--weixin" onClick={onCopy}>
          <span className="invite-share-icon">💬</span>
          <span>点右上角「···」转发</span>
        </button>
      )}

      {/* 手机浏览器：系统分享面板（内含微信） */}
      {!inWeixin && hasSystemShare && (
        <button
          type="button"
          className="invite-share-btn invite-share-btn--weixin"
          onClick={onSystemShare}
          disabled={sharing}
        >
          <span className="invite-share-icon">📤</span>
          <span>{sharing ? '正在打开…' : '分享给好友'}</span>
        </button>
      )}

      <button type="button" className="invite-share-btn invite-share-btn--copy" onClick={onCopy}>
        {copied ? '已复制' : '复制链接'}
      </button>

      {/* 桌面浏览器没有系统分享面板，说清楚为什么只有"复制链接" */}
      {!inWeixin && !hasSystemShare && (
        <p className="invite-share-tip">电脑上没有系统分享面板，复制链接发给好友即可</p>
      )}
    </div>
  );
}
