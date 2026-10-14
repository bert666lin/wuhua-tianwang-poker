#!/usr/bin/env node
// ===== 规则 PDF 交付前校验 =====
//
// 用法：node scripts/check-rules-pdf.mjs
//
// 为什么需要它：build-rules-pdf.mjs 退出码为 0 **不代表 PDF 是对的**。
// 实测踩过的坑：用 PingFang SC 生成时，Chrome 把一批常用汉字写成 Unicode
// 「康熙部首」区的同形字符（生->⽣、大->⼤、门->⻔…），肉眼零差别，
// 但 PDF 里搜不到、复制出来是错字。只看"生成成功"会把这种文档直接交出去。
//
// 本脚本比对 **PDF 文字层** 与 docs/RULES.md 的正文，检查三件事：
//   1. 页数 > 0 且每页都有文字（排版没塌）
//   2. 源文档里的每一句正文都能在 PDF 文字层里找到（无缺字/无字符替换）
//   3. 关键术语可被搜索命中（花色符号、金额、级数这些最容易出问题）
//
// 依赖 pdftotext 或 pypdf 任一即可；两者都没有时明确报错而不是假装通过。

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MD = join(ROOT, 'docs/RULES.md');
const PDF = join(ROOT, 'docs/梅州五华天王扑克-规则清单.pdf');

if (!existsSync(PDF)) {
  console.error(`❌ 找不到 ${PDF}，请先运行 node scripts/build-rules-pdf.mjs`);
  process.exit(1);
}

/** 抽取 PDF 文字层。优先 pdftotext，退回 pypdf 虚拟环境。 */
function extractText() {
  try {
    return execFileSync('pdftotext', ['-layout', PDF, '-'], { encoding: 'utf8' });
  } catch { /* 没装 pdftotext，继续试 pypdf */ }

  const pythons = ['/tmp/pdfvenv/bin/python', 'python3'];
  for (const py of pythons) {
    try {
      return execFileSync(py, [
        '-c',
        'import sys;from pypdf import PdfReader;print("\\f".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages))',
        PDF,
      ], { encoding: 'utf8' });
    } catch { /* 换下一个 */ }
  }
  console.error('❌ 需要 pdftotext 或 pypdf 才能校验。装一个：pip install pypdf');
  process.exit(1);
}

const raw = extractText();
const pages = raw.split('\f').filter(p => p.trim() !== '');
// 文字层里的换行位置由排版决定，比对前统一压掉所有空白
const flat = raw.replace(/\s+/g, '');

const failures = [];

// —— 检查 1：页数与每页文字量 ——
if (pages.length === 0) failures.push('PDF 没有任何文字页');
pages.forEach((p, i) => {
  const n = p.replace(/\s+/g, '').length;
  if (n < 50) failures.push(`第 ${i + 1} 页几乎没有文字（${n} 字符），排版可能塌了`);
});

// —— 检查 2：源文档正文逐句命中 ——
// 把 markdown 还原成"应该出现在纸面上的纯文字"：去掉标记符号，
// 表格按单元格拆分（PDF 里单元格之间会插空白，整行比对必然失败）。
const md = readFileSync(MD, 'utf8');
const fragments = [];
for (const line of md.split('\n')) {
  const t = line.trim();
  if (!t || /^---+$/.test(t) || /^\|[\s:|-]+\|?$/.test(t)) continue;
  const plain = t
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '');
  const cells = plain.startsWith('|')
    ? plain.replace(/^\|/, '').replace(/\|$/, '').split('|')
    : [plain];
  for (const cell of cells) {
    const s = cell.replace(/\s+/g, '');
    // 太短的片段（如表格里的「—」「0」）在正文里到处都是，比对没有意义
    if (s.length >= 6) fragments.push({ shown: cell.trim(), needle: s });
  }
}

const missing = fragments.filter(f => !flat.includes(f.needle));
if (missing.length) {
  failures.push(`${missing.length} 处正文在 PDF 文字层里找不到（缺字或字符被替换）`);
  for (const m of missing.slice(0, 8)) failures.push(`    · ${m.shown.slice(0, 60)}`);
}

// —— 检查 3：关键术语可搜索 ——
// 这些词一旦被同形字符污染就搜不到，是最典型的"看着对、实际错"的位置。
const KEYWORDS = [
  '天王', '大王', '小王', '常主', '甩牌', '挖底', '底牌分', '保底级',
  '大师场', '初级场', '入场门槛', '青铜', '白银', '黄金', '钻石',
  '零和结算', '拖拉机', '王组合', '连三张', '不支持顺子',
  '♠', '♥', '♦', '125', '145', '100,000',
];
const badWords = KEYWORDS.filter(k => !flat.includes(k));
if (badWords.length) {
  failures.push(`关键术语搜不到（字符被同形字替换）：${badWords.join(' ')}`);
}

// —— 报告 ——
console.log(`页数：${pages.length}`);
console.log(`文字层字符数：${flat.length}`);
console.log(`比对正文片段：${fragments.length} 处`);

if (failures.length) {
  console.error('\n❌ 校验未通过：');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('\n✅ 校验通过：页数正常、正文完整、关键术语均可搜索');
