// 统一的分享底层能力。
// 房间邀请（roomInvite.ts）、结算分享、商城分享都复用这里，避免各页各写一套。
//
// ===== 为什么用系统原生分享面板，而不是"分享到微信"按钮 =====
// 微信从未开放过"H5 网页调起微信分享"的能力：
//   · 只有在微信内部打开网页时，才能用微信 JS-SDK 调起分享（且要公众号 + 认证域名）；
//   · 在 Safari / Chrome 里，任何网页都无法唤起微信的选好友界面。
// 我们之前跳 weixin.qq.com 官网，等于把用户丢到微信首页，毫无用处。
//
// 目前网页能做到的最接近效果是 Web Share API（navigator.share）：
// 手机上会拉起**系统分享面板**，里面就有微信图标，点一下直接进微信选好友。
// 桌面浏览器基本没有系统分享面板，退回"复制链接"。

/** 是否运行在 Capacitor 原生 App 壳里。 */
export function isNativeApp(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}

interface CapacitorSharePlugin {
  share: (options: { title: string; text: string; url?: string }) => Promise<void>;
}

function getCapacitorSharePlugin(): CapacitorSharePlugin | null {
  if (!isNativeApp()) return null;
  const cap = (globalThis as { Capacitor?: { Plugins?: { Share?: CapacitorSharePlugin } } }).Capacitor;
  const share = cap?.Plugins?.Share;
  return share && typeof share.share === 'function' ? share : null;
}

/** @internal 把「用户取消」和真实失败统一成同一个结果口径。 */
function normalizeShareError(err: unknown): SystemShareResult {
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
    return 'cancelled';
  }
  return 'failed';
}

/** 当前环境能否调起系统分享面板。 */
export function canSystemShare(): boolean {
  if (getCapacitorSharePlugin()) return true;
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** 是否在微信内部打开（此时引导用右上角「···」转发最顺）。 */
export function isInWeixin(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /micromessenger/i.test(navigator.userAgent);
}

export interface SystemShareInput {
  title: string;
  /** 分享正文（含邀请文案）。 */
  text: string;
  url: string;
}

export type SystemShareResult = 'shared' | 'cancelled' | 'unsupported' | 'failed';

/**
 * 调起系统分享面板。
 *
 * 返回值区分「用户取消」和「失败」很重要：取消是正常操作，不该弹错误提示，
 * 也不该据此发放分享奖励（用户什么都没分享出去）。
 */
export async function systemShare(input: SystemShareInput): Promise<SystemShareResult> {
  const nativeShare = getCapacitorSharePlugin();
  if (nativeShare) {
    try {
      const options: { title: string; text: string; url?: string } = { title: input.title, text: input.text };
      // Capacitor/Android 会把 text 和 url 拼进同一条 EXTRA_TEXT；文案已含链接时不要再传 url，否则链接重复。
      if (!input.text.includes(input.url)) options.url = input.url;
      await nativeShare.share(options);
      return 'shared';
    } catch (err) {
      return normalizeShareError(err);
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: input.title, text: input.text, url: input.url });
      return 'shared';
    } catch (err) {
      return normalizeShareError(err);
    }
  }

  return 'unsupported';
}

/** 复制文本。navigator.clipboard 在非 HTTPS 下不可用，退回 execCommand。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走 execCommand 兜底
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 新开窗口，被浏览器拦截时不抛错。 */
export function openShareWindow(url: string): void {
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    // 被拦截就静默：调用方通常已经把文案复制到剪贴板了
  }
}

export interface SettlementShareInput {
  playerName: string;
  mode: string;
  iWon: boolean;
  scoreDelta: number;
  callScore?: number;
  mainSuitName?: string;
  pageUrl: string;
  /**
   * 战果名称（光头 / 小光 / 保底成功 / 挖底成功 / 闲家过庄）。
   * 只写「赢了3级」看不出这局有多精彩，「光头」才是能拿出去说的东西。
   */
  outcomeLabel?: string;
}

/** 结算分享文案。 */
export function buildSettlementShareText(input: SettlementShareInput): string {
  const { playerName, mode, iWon, scoreDelta, callScore, mainSuitName, pageUrl, outcomeLabel } = input;
  const delta = scoreDelta > 0 ? `+${scoreDelta}` : String(scoreDelta);
  const parts = [
    `${playerName} 在五华天王【${mode}】${iWon ? '赢了' : '输了'}这局，本局 ${delta} 级`,
  ];
  if (outcomeLabel) parts.push(outcomeLabel);
  if (mainSuitName) parts.push(`主牌 ${mainSuitName}`);
  if (typeof callScore === 'number' && callScore > 0) parts.push(`叫分 ${callScore}`);
  return `${parts.join('，')}。来一起打：${pageUrl}`;
}
