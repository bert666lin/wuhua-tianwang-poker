#!/usr/bin/env node
// ===== 规则清单 Markdown -> PDF =====
//
// 用法：node scripts/build-rules-pdf.mjs
//   输入：docs/RULES.md（规则的唯一书面口径）
//   输出：docs/梅州五华天王扑克-规则清单.pdf
//
// 为什么不用 pandoc / marked / puppeteer：
//   这个脚本只服务一份结构固定的文档，引三方依赖反而让"随时重新生成"变难
//   （装 pandoc 要 Homebrew，装 puppeteer 要下一整个 Chromium）。
//   这里只解析本文档真正用到的 Markdown 子集，再调用**系统已装的 Chrome**
//   的 --print-to-pdf，全程零 npm 依赖。
//   代价：不支持嵌套列表、图片、代码块围栏等本文档没用到的语法。
//   如果以后 RULES.md 用了新语法，务必回来补 —— 否则会被静默渲染成纯文本。

import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'docs/RULES.md');
const OUT = join(ROOT, 'docs/梅州五华天王扑克-规则清单.pdf');

/** Chrome 可执行文件的候选位置，按优先级找第一个存在的。 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);

function findChrome() {
  const hit = CHROME_CANDIDATES.find(p => existsSync(p));
  if (!hit) {
    throw new Error(
      '找不到 Chrome。请装 Google Chrome，或用 CHROME_PATH=/路径 指定浏览器。',
    );
  }
  return hit;
}

/** HTML 转义。必须在所有行内标记处理**之前**做，否则会把生成的标签也转义掉。 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 行内标记：**粗体** 和 `代码`。
 * 顺序有讲究：先转义再替换，且反引号里的内容不再解析粗体
 * （本文档的 `♦6♦6 + ♦7♦7` 之类不含星号，所以简单处理即可）。
 */
function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** 表格行 `| a | b |` -> 单元格数组。首尾空串来自两端的竖线，要丢掉。 */
function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
}

const isTableRow = line => /^\s*\|/.test(line);
const isTableDivider = line => /^\s*\|[\s:|-]+\|?\s*$/.test(line);

function renderMarkdown(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let index = 0;

  // 列表和引用是「连续多行合成一个块」，所以用 while + 内层聚合，
  // 不能逐行独立处理（否则每个 - 都会生成一个单独的 <ul>）。
  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') { index++; continue; }

    // 分隔线
    if (/^---+\s*$/.test(line.trim())) { out.push('<hr/>'); index++; continue; }

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index++;
      continue;
    }

    // 表格：表头 + 分隔行 + 若干数据行
    if (isTableRow(line) && isTableDivider(lines[index + 1] ?? '')) {
      const header = splitRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && isTableRow(lines[index])) {
        rows.push(splitRow(lines[index]));
        index++;
      }
      out.push('<table><thead><tr>'
        + header.map(c => `<th>${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    // 引用块（本文档用它放"源码位置"和重点提醒）
    if (/^>\s?/.test(line)) {
      const buffer = [];
      while (index < lines.length && /^>/.test(lines[index])) {
        buffer.push(lines[index].replace(/^>\s?/, ''));
        index++;
      }
      // 引用块内部空行分段，避免"源码：xxx"和下一句提醒挤成一行
      const paragraphs = buffer.join('\n').split(/\n\s*\n/)
        .map(p => p.trim()).filter(Boolean)
        .map(p => `<p>${inline(p.replace(/\n/g, ' '))}</p>`)
        .join('');
      out.push(`<blockquote>${paragraphs}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^[-*]\s+/, ''))}</li>`);
        index++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // 普通段落：连续非空行合并
    const paragraph = [];
    while (
      index < lines.length
      && lines[index].trim() !== ''
      && !/^(#{1,6}\s|>|[-*]\s|---+\s*$)/.test(lines[index])
      && !isTableRow(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index++;
    }
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  return out.join('\n');
}

/**
 * 打印样式。要点：
 *  - h2 用 break-inside/break-after 约束，防止小节标题落在页脚孤零零一行
 *  - 表格 page-break-inside: avoid，短表格不跨页；长表格允许拆（否则会留大片空白）
 *
 * ⚠️ 中文字体**必须**以 STHeiti / Arial Unicode MS 开头，不要改成 PingFang SC。
 *   macOS 上的 Chrome 用 PingFang SC 打印 PDF 时，会把一批常用汉字映射到
 *   Unicode「康熙部首」区（U+2F00–U+2FDF）的同形字符：
 *     生->⽣  大->⼤  人->⼈  门->⻔  高->⾼  黄->⻩  青->⻘  白->⽩ …
 *   肉眼完全看不出差别，但 PDF 里**搜不到也复制不对**（搜「大师场」零结果）。
 *   实测 PingFang SC / Hiragino Sans GB / Heiti SC / Songti SC 都有这个问题，
 *   只有 STHeiti 和 Arial Unicode MS 输出的字符与源文一致。
 *   改字体后请务必重跑 scripts/check-rules-pdf.mjs 验证。
 */
function buildHtml(body, generatedAt) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>梅州五华天王扑克 —— 完整规则清单</title>
<style>
  @page { size: A4; margin: 18mm 16mm 16mm; }
  * { box-sizing: border-box; }
  body {
    /* 见上方注释：字体顺序影响 PDF 文字层正确性，不要随意调整 */
    font-family: "STHeiti", "Arial Unicode MS", "Microsoft YaHei", sans-serif;
    font-size: 10.5pt; line-height: 1.75; color: #1a2130; margin: 0;
    -webkit-font-smoothing: antialiased;
  }
  h1 {
    font-size: 21pt; margin: 0 0 4pt; color: #0f2650; letter-spacing: .5px;
    border-bottom: 2.5pt solid #c8a24a; padding-bottom: 8pt;
  }
  .meta { color: #7a8395; font-size: 8.5pt; margin: 0 0 18pt; }
  h2 {
    font-size: 13.5pt; color: #0f2650; margin: 20pt 0 8pt;
    padding-left: 8pt; border-left: 4pt solid #c8a24a;
    break-after: avoid; break-inside: avoid;
  }
  h3 { font-size: 11.5pt; color: #24365c; margin: 13pt 0 5pt; break-after: avoid; }
  p { margin: 5pt 0; }
  strong { color: #8a2a2a; font-weight: 600; }
  code {
    font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 9pt;
    background: #f1f3f7; border: .5pt solid #dfe3ec; border-radius: 3pt;
    padding: .5pt 3pt; color: #33405c;
  }
  ul { margin: 5pt 0 5pt 0; padding-left: 17pt; }
  li { margin: 2.5pt 0; }
  blockquote {
    margin: 7pt 0; padding: 6pt 10pt; background: #f6f8fc;
    border-left: 3pt solid #9fb0d0; border-radius: 0 3pt 3pt 0;
    color: #4a5570; font-size: 9.5pt;
  }
  blockquote p { margin: 2pt 0; }
  blockquote strong { color: #8a2a2a; }
  table {
    border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9.5pt;
    page-break-inside: avoid;
  }
  th, td { border: .5pt solid #c6cddc; padding: 4.5pt 7pt; text-align: left; vertical-align: top; }
  th { background: #e9edf6; color: #0f2650; font-weight: 600; }
  tbody tr:nth-child(even) td { background: #fafbfe; }
  hr { border: 0; border-top: .5pt solid #d6dbe6; margin: 14pt 0; }
</style></head><body>
<h1>梅州五华天王扑克 —— 完整规则清单</h1>
<p class="meta">生成时间 ${generatedAt}　·　源文件 docs/RULES.md　·　由源码逐条核对生成</p>
${body}
</body></html>`;
}

const markdown = readFileSync(SRC, 'utf8');
// 去掉 md 里的一级标题和开头引用块：HTML 模板已经自带标题与副标题，
// 留着会在 PDF 首页出现两份标题。
const stripped = markdown.replace(/^#\s+.*\n/, '').replace(/^(>.*\n)+/, '');
const generatedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const html = buildHtml(renderMarkdown(stripped), generatedAt);

const stage = mkdtempSync(join(tmpdir(), 'rulespdf-'));
const htmlPath = join(stage, 'rules.html');
writeFileSync(htmlPath, html, 'utf8');

execFileSync(findChrome(), [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  // 不加页眉页脚：Chrome 默认会打上文件 URL 和日期，URL 是 /var/folders 临时路径，很难看
  '--no-pdf-header-footer',
  `--print-to-pdf=${OUT}`,
  `file://${htmlPath}`,
], { stdio: 'inherit' });

console.log(`✅ 已生成 ${OUT}`);
