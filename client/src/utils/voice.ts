/**
 * 牌桌实时语音（按住说话 / Push-To-Talk）。
 *
 * 为什么不用 WebRTC：
 *   牌桌语音是"轮流说一句"的对讲场景，不是持续通话。WebRTC 要额外部署
 *   信令 + STUN/TURN，4~6 人还得组 mesh 或上 SFU，运维成本远超收益。
 *   这里复用已有的 Colyseus WebSocket：按住录一段 -> 编码 -> 发给服务端
 *   -> 服务端转发给同房其他人 -> 收到即播。延迟由分片长度决定（250ms 一片），
 *   实测同城 400~600ms，对讲够用。
 *
 * 编码选择：
 *   MediaRecorder 直接产出 webm/opus（Safari 17+ 为 mp4/aac），
 *   浏览器原生编解码，无需引入 opus.js 之类的 wasm 包。
 *   每片都是独立可播的：靠"每次按住重建 MediaRecorder"实现，
 *   而不是切一个长流（长流的后续分片缺少容器头，单独喂给 <audio> 播不出来）。
 *
 * 隐私：
 *   麦克风只在按住期间打开，松手立刻 stop 掉所有 track（浏览器地址栏的
 *   录音红点会消失），不做常开监听。
 */

import { getSharedAudioContext } from './sound';

/** 一片语音数据。seq 用于接收端按序播放，丢片时直接跳过而不是卡住。 */
export interface VoiceChunk {
  /** 说话人（服务端填充，发送时不需要给）。 */
  playerId?: string;
  playerName?: string;
  /** 容器 MIME，接收端要用它构造 Blob。不同浏览器不一样，必须随包带上。 */
  mime: string;
  /** 本次按住的会话 id：同一次按住的分片共享，用于接收端分组排队。 */
  sessionId: string;
  /** 分片序号，从 0 开始。 */
  seq: number;
  /** 音频字节。 */
  data: Uint8Array;
}

/** 单片时长：越小越实时、开销越大。250ms 是延迟与流量的折中。 */
const CHUNK_MS = 250;

/**
 * 单片体积上限（字节）。
 *
 * 不能按 opus 的体量来定：opus 16kbps 下 250ms ≈ 500B，但 iOS Safari 只能录
 * mp4/aac，**每次按住的第一片还要带 ftyp+moov 初始化段**，实测能到几 KB。
 * 之前这里是 8KB 且超限直接 return —— 一旦 iOS 首片超限被静默丢掉，
 * 后面所有分片都缺容器头，接收端一个字也放不出来（表现是"对方完全听不到"）。
 * 放到 24KB：iOS 首片有充足余量，又稳稳低于服务端 ws maxPayload（32KB）。
 */
const MAX_CHUNK_BYTES = 24 * 1024;

/** 一次按住最长时长，防止有人按住不放把房间刷爆。 */
export const MAX_TALK_MS = 30_000;

/** 挑一个当前浏览器支持的录音容器。 */
function pickMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',   // Chrome / Edge / Firefox / Android
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2', // Safari 17+
    'audio/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* 继续试下一个 */ }
  }
  return '';
}

/** 浏览器是否具备录音能力（HTTPS/localhost + getUserMedia + MediaRecorder）。 */
export function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  if (typeof MediaRecorder === 'undefined') return false;
  return pickMime() !== '';
}

/**
 * 麦克风权限当前是否已被明确拒绝。
 * 用于把「点了没反应」变成一句明确的提示。Permissions API 在部分浏览器
 * 不支持 microphone 查询，查不到就返回 false（当作未拒绝，实际去请求）。
 */
export async function isMicDenied(): Promise<boolean> {
  try {
    const st = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    return st?.state === 'denied';
  } catch { return false; }
}

type ChunkHandler = (chunk: Omit<VoiceChunk, 'playerId' | 'playerName'>) => void;

/** 麦克风实时电平回调，0~1。用于给「按住说话」画真实的音量反馈。 */
type LevelHandler = (level: number) => void;

/**
 * 按住说话的录音器。
 *
 * 生命周期：start() 打开麦克风并开始分片回调，stop() 关闭麦克风。
 * 同一个实例可以反复 start/stop（每次按住都是一次新的 sessionId）。
 */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private seq = 0;
  private sessionId = '';
  private mime = '';
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;
  /* ===== 电平监测 =====
   * 用户反馈「按住说话没反馈，不知道有没有在发送语音」。
   * 光把按钮变个色证明不了"麦克风真的在收音" —— 权限给了但麦克风被系统占用、
   * 静音开关开着、蓝牙耳机没切过去，按钮一样会变色，用户却白说一句。
   * 所以这里接 AnalyserNode 读真实波形能量，UI 画成跳动的电平条：
   * 条子会动 = 真的收到你的声音了，这是唯一可信的反馈。 */
  /** 借用的全局 AudioContext（不归本类所有，不能 close）。 */
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  /** 自己接上去的麦克风源节点，stop 时要断开。 */
  private levelSource: MediaStreamAudioSourceNode | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;

  /** 是否正在录音。 */
  get active(): boolean { return this.recorder?.state === 'recording'; }

  /**
   * 开始录音。onChunk 每 CHUNK_MS 触发一次。
   * onAutoStop 在达到 MAX_TALK_MS 被强制停止时触发（让 UI 能把按钮弹回来）。
   * onLevel 每 ~60ms 给一次麦克风实时电平（0~1），用于画音量反馈。
   * 抛错的情况：用户拒绝授权 / 无麦克风 / 非安全上下文。
   */
  async start(onChunk: ChunkHandler, onAutoStop?: () => void, onLevel?: LevelHandler): Promise<void> {
    if (this.active) return;

    this.mime = pickMime();
    if (!this.mime) throw new Error('当前浏览器不支持录音');

    // 语音通话参数：单声道 + 回声消除 + 降噪，牌桌环境很吵
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.seq = 0;

    // 16kbps 单声道 opus：语音清晰度足够，30 秒也只有 ~60KB
    const rec = new MediaRecorder(this.stream, { mimeType: this.mime, audioBitsPerSecond: 16_000 });
    this.recorder = rec;

    rec.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return;
      /* 异常大片直接丢，别把房间刷爆。
         注意这里丢的必须是"真的异常"：阈值定得太低会把 iOS 那个带初始化段的
         首片丢掉，导致整段语音都解不出来（见 MAX_CHUNK_BYTES 的说明）。 */
      if (e.data.size > MAX_CHUNK_BYTES) return;
      const buf = new Uint8Array(await e.data.arrayBuffer());
      onChunk({ mime: this.mime, sessionId: this.sessionId, seq: this.seq++, data: buf });
    };

    rec.start(CHUNK_MS);

    // 电平监测：失败不能影响录音本身（Safari 老版本 AudioContext 行为不一致），
    // 所以整段包在 try 里 —— 拿不到电平最多是少一个动画，语音照发。
    if (onLevel) this.startLevelMonitor(onLevel);

    // 按住上限：到点自动松手，避免误触后一直占着麦
    this.autoStopTimer = setTimeout(() => { this.stop(); onAutoStop?.(); }, MAX_TALK_MS);
  }

  /**
   * 接 AnalyserNode 读实时电平。60ms 一次，够顺滑又不吃 CPU。
   *
   * ⚠️ 这里必须复用 sound.ts 的那一个 AudioContext 单例，绝不能 new 一个。
   * 根因（用户实测：安卓正常，iPhone 一按语音就弹「网络已断开」并被踢回大厅）：
   * iOS 的 WebAudio 是**独占音频会话**的 —— 页面里已经有一个 AudioContext
   * （sound.ts 的出牌音效常驻），按住说话时再 new 第二个，iOS 会为了新建这个
   * context 去重置整个页面的音频会话。这次重置会连带把页面的媒体栈打断，
   * WebSocket 随之被判定断开，于是「立刻」弹网络已断开。
   * 安卓/桌面 Chrome 允许多个 AudioContext 共存，所以完全复现不出来 ——
   * 这也是我用 Chromium 测不出这个 bug 的原因。
   */
  private startLevelMonitor(onLevel: LevelHandler): void {
    try {
      if (!this.stream) return;
      // 复用全局单例；拿不到就直接放弃电平（语音功能本身不受影响）
      const ctx = getSharedAudioContext();
      if (!ctx) return;
      // 标记：这个 ctx 是借来的，stop() 里绝对不能 close（关掉会把音效一起弄没）
      this.audioCtx = ctx;
      // iOS 上 AudioContext 可能以 suspended 起，必须 resume 否则读到的全是 0
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(this.stream);
      this.levelSource = src;
      const analyser = ctx.createAnalyser();
      // 256 点足够算能量；smoothing 调低一点，让条子对说话的起停反应更快
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      src.connect(analyser);
      /* 注意：analyser 不再往 ctx.destination 接。
         接上去等于把自己的麦克风声音播回自己的听筒（啸叫）。
         AnalyserNode 是旁路节点，不连 destination 也照样能读数据。 */
      this.analyser = analyser;

      /* 缓冲区长度必须是 fftSize，不是 frequencyBinCount。
         frequencyBinCount = fftSize/2 = 128，是**频域**的箱数；
         getByteTimeDomainData 写的是**时域**波形，需要 fftSize=256 个点。
         之前用 128 建缓冲，只能读到半个周期的波形，RMS 被系统性低估。 */
      const buf = new Uint8Array(analyser.fftSize);
      this.levelTimer = setInterval(() => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(buf);
        // RMS：时域数据以 128 为静音中心，偏移量的均方根就是音量
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        // 正常说话 RMS 只有 0.02~0.15，直接用会让条子几乎不动。
        // 乘 6 再夹到 0~1，说话时能顶到七八成高度，安静时归零。
        onLevel(Math.min(1, rms * 6));
      }, 60);
    } catch { /* 拿不到电平就算了，不影响发语音 */ }
  }

  /**
   * 停掉电平监测。
   *
   * ⚠️ 绝对不能 close() 这个 AudioContext —— 它是 sound.ts 的全局单例，
   * 关掉会把出牌音效一起弄没（而且 closed 状态不可逆，只能刷新页面才回来）。
   * 只需要断开自己接上去的节点：MediaStreamSource 断开后就会被 GC，
   * 不会像"每次 new 一个 context"那样累积到浏览器上限。
   */
  private stopLevelMonitor(): void {
    if (this.levelTimer) { clearInterval(this.levelTimer); this.levelTimer = null; }
    // 顺序要紧：先断源，再丢 analyser 引用
    if (this.levelSource) { try { this.levelSource.disconnect(); } catch { /* 已断 */ } this.levelSource = null; }
    if (this.analyser) { try { this.analyser.disconnect(); } catch { /* 已断 */ } this.analyser = null; }
    this.audioCtx = null;   // 只是丢引用，不关
  }

  /** 停止录音并彻底释放麦克风（地址栏录音标记会消失）。 */
  stop(): void {
    if (this.autoStopTimer) { clearTimeout(this.autoStopTimer); this.autoStopTimer = null; }
    this.stopLevelMonitor();
    try { if (this.recorder?.state === 'recording') this.recorder.stop(); } catch { /* 已停 */ }
    this.recorder = null;
    // track 必须逐个 stop：只丢引用不会关掉麦克风
    for (const t of this.stream?.getTracks() ?? []) { try { t.stop(); } catch { /* 忽略 */ } }
    this.stream = null;
  }
}

/**
 * 语音播放队列。
 *
 * 为什么要排队：每片都是独立的短音频，直接 new Audio().play() 会几片同时响、
 * 变成"叠音"。这里按到达顺序串行播放，同一个人的一段话听起来是连续的。
 * 队列上限 40 片（10 秒）：网络抖动补回来的旧片没有意义，超了丢最老的。
 */
export class VoicePlayer {
  private queue: { url: string; playerId: string }[] = [];
  private playing = false;
  private el: HTMLAudioElement | null = null;
  private muted = false;

  setMuted(v: boolean) {
    this.muted = v;
    if (v) this.clear();
  }

  /**
   * 收到一片语音：转成可播 URL 入队。
   *
   * data 故意标成 unknown 而不是 Uint8Array：网络来的东西经 msgpack 往返后
   * 真的可能是普通对象或数组（下面一行就是为此存在的）。标成 Uint8Array
   * 只是让类型系统看着漂亮，实际到手的可能根本不是——那反而会让调用方
   * 以为可以直接当字节用。
   */
  push(chunk: { mime: string; data: unknown; playerId?: string }): void {
    if (this.muted) return;
    // Uint8Array 经 msgpack 往返后可能变成普通对象/数组，统一收敛成 Uint8Array
    const bytes = chunk.data instanceof Uint8Array
      ? chunk.data
      : new Uint8Array(Object.values(chunk.data ?? {}) as number[]);
    if (bytes.byteLength === 0) return;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: chunk.mime || 'audio/webm' }));
    this.queue.push({ url, playerId: chunk.playerId ?? '' });
    while (this.queue.length > 40) {
      const dropped = this.queue.shift();
      if (dropped) URL.revokeObjectURL(dropped.url);
    }
    if (!this.playing) void this.drain();
  }

  /** 串行播完队列。 */
  private async drain(): Promise<void> {
    this.playing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        const el = this.el ?? (this.el = new Audio());
        el.src = item.url;
        // 自动播放策略：牌桌里用户已有交互（点过按钮），一般不会被拦；
        // 被拦时静默跳过这一片，不弹错误打断牌局。
        await el.play().catch(() => undefined);
        await new Promise<void>((resolve) => {
          const done = () => { el.onended = null; el.onerror = null; resolve(); };
          el.onended = done;
          el.onerror = done;
          // 兜底超时：某些容器分片拿不到 duration，onended 可能不触发
          setTimeout(done, 2000);
        });
      } finally {
        URL.revokeObjectURL(item.url);
      }
    }
    this.playing = false;
  }

  /** 清空队列并停止播放。 */
  clear(): void {
    for (const it of this.queue) URL.revokeObjectURL(it.url);
    this.queue = [];
    try { this.el?.pause(); } catch { /* 忽略 */ }
    this.playing = false;
  }
}
