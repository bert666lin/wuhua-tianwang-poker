// 结算「截图」：不引三方库（html2canvas 体积太大），直接用 Canvas 画一张战绩卡。
// 好处是产出稳定、不受 CSS/字体影响，也不会因为跨域图片而变白图。

export interface ShareCardInput {
  playerName: string;
  mode: string;
  iWon: boolean;
  /** 本局级别变化 */
  levelDelta: number;
  mainSuitName?: string;
  callScore?: number;
  /** 闲家抓分 */
  trickScore?: number;
  digSuccess?: boolean;
  rankName?: string;
  /** 闲家总得分（含底牌分）。 */
  opponentScore?: number;
  /** 底牌分。 */
  bottomScore?: number;
  /** 战果名称（光头 / 小光 / 保底成功 / 挖底成功 / 闲家过庄）。 */
  outcomeLabel?: string;
}

export const SHARE_CARD_WIDTH = 720;
export const SHARE_CARD_HEIGHT = 420;

/** 在 canvas 上画战绩卡。抽出来是为了能在测试里用假 ctx 断言画了哪些字。 */
export function drawShareCard(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
  width = SHARE_CARD_WIDTH,
  height = SHARE_CARD_HEIGHT,
): string[] {
  const lines: string[] = [];
  const write = (
    text: string, x: number, y: number,
    font: string, color: string, align: CanvasTextAlign = 'left',
  ) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    lines.push(text);
  };

  // 背景
  ctx.fillStyle = '#101A2E';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = input.iWon ? 'rgba(232, 211, 168, 0.12)' : 'rgba(110, 131, 181, 0.12)';
  ctx.fillRect(0, 0, width, 132);

  // 标题
  write('梅州五华天王升级', 40, 58, 'bold 30px sans-serif', '#E8D3A8');
  write(input.mode, 40, 98, '22px sans-serif', '#9EACC8');

  // 胜负
  write(input.iWon ? '胜' : '负', width - 40, 92,
    'bold 76px sans-serif', input.iWon ? '#E8D3A8' : '#6E83B5', 'right');

  // 级别变化
  const deltaText = `${input.levelDelta > 0 ? '+' : ''}${input.levelDelta} 级`;
  write(deltaText, 40, 196, 'bold 60px sans-serif', input.levelDelta >= 0 ? '#7DCC97' : '#E55A4E');
  write(input.playerName, 40, 238, '24px sans-serif', '#E4EAF6');

  // 明细
  const rows: string[] = [];
  /* 战果名放第一行：这是整张图最值得看的一条信息。
   * digSuccess 那条不再单独写 —— outcomeLabel 已经是「挖底成功」了，
   * 两条一起写会重复。 */
  if (input.outcomeLabel) rows.push(`战果 ${input.outcomeLabel}`);
  if (input.mainSuitName) rows.push(`主牌 ${input.mainSuitName}`);
  if (typeof input.callScore === 'number') rows.push(`叫分 ${input.callScore}`);
  if (typeof input.opponentScore === 'number') rows.push(`闲家总分 ${input.opponentScore}`);
  else if (typeof input.trickScore === 'number') rows.push(`闲家抓分 ${input.trickScore}`);
  if (typeof input.bottomScore === 'number') rows.push(`底牌 ${input.bottomScore} 分`);
  if (!input.outcomeLabel && input.digSuccess) rows.push('挖底成功');
  if (input.rankName) rows.push(`当前段位 ${input.rankName}`);
  rows.forEach((row, i) => {
    write(row, 40, 292 + i * 30, '20px sans-serif', '#C3CDE2');
  });

  // 页脚
  write('扫码/打开链接即可一起开局', width - 40, height - 32, '18px sans-serif', '#8C9BBB', 'right');
  return lines;
}

/** 生成 PNG dataURL。浏览器不支持 canvas 时返回 null。 */
export function renderShareCard(input: ShareCardInput): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SHARE_CARD_WIDTH;
    canvas.height = SHARE_CARD_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawShareCard(ctx, input);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** 触发下载。 */
export function downloadDataUrl(dataUrl: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** 战绩卡文件名：五华天王-战绩-20260829-1830.png */
export function shareCardFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `五华天王-战绩-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.png`;
}
