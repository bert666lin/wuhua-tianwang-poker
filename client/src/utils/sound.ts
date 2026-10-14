// 轻量音效：用 Web Audio API 合成，无需音频文件。
// 支持出牌、抓分、赢墩、按钮、胜负、倒计时滴答。

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); }
    catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/**
 * 把这一个 AudioContext 单例暴露出去，给「按住说话」的电平监测复用。
 *
 * 为什么必须共享而不是各建一个：iOS 的 WebAudio 独占音频会话，页面里已经有
 * 一个 context 时再 new 第二个，iOS 会重置整个页面的音频会话，连带把媒体栈
 * 和 WebSocket 打断 —— 实测表现是 iPhone 一按语音就弹「网络已断开」被踢回大厅，
 * 而安卓/桌面 Chrome 允许多 context 共存，完全复现不出来。
 *
 * 借用方只能连自己的节点，**不可以 close()**：closed 不可逆，
 * 关掉之后所有出牌音效都没了，只能刷新页面才恢复。
 */
export function getSharedAudioContext(): AudioContext | null {
  return ac();
}

function beep(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.08) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + duration);
}

export const sound = {
  setMuted(v: boolean) { muted = v; try { localStorage.setItem('tw_muted', v ? '1' : '0'); } catch {} },
  isMuted() {
    try { muted = localStorage.getItem('tw_muted') === '1'; } catch {}
    return muted;
  },
  play() { beep(420, 0.06, 'triangle', 0.05); },
  click() { beep(600, 0.03, 'square', 0.03); },
  trick() { beep(520, 0.08, 'triangle', 0.06); setTimeout(() => beep(780, 0.1, 'triangle', 0.06), 60); },
  score() { beep(880, 0.08, 'sine', 0.08); setTimeout(() => beep(1100, 0.12, 'sine', 0.07), 70); },
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'triangle', 0.07), i * 110)); },
  lose() { [400, 330, 262].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'sine', 0.06), i * 160)); },
  tick() { beep(1200, 0.02, 'square', 0.02); },
  hint() { beep(660, 0.05, 'sine', 0.04); setTimeout(() => beep(880, 0.05, 'sine', 0.04), 40); },
};

/** 震动开关（牌桌设置面板可切换），持久化在 localStorage。 */
export function isVibrateEnabled(): boolean {
  try { return localStorage.getItem('tw_vibrate') !== '0'; } catch { return true; }
}

export function setVibrateEnabled(v: boolean) {
  try { localStorage.setItem('tw_vibrate', v ? '1' : '0'); } catch { /* 隐私模式忽略 */ }
}

export function vibrate(pattern: number | number[] = 20) {
  // 尊重设置面板的开关，否则开关只是摆设
  if (!isVibrateEnabled()) return;
  try { navigator.vibrate?.(pattern); } catch {}
}
