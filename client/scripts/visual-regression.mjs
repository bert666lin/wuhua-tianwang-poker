// 视觉回归脚本：对指定页面集合做多视口截图
// 用法：node scripts/visual-regression.mjs [output-dir]
// 依赖：npx playwright（系统级已安装）

import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const VIEWPORTS = [
  // 扑克牌 App 以手机横屏为主，主流与小屏两档必须优先跑。
  { name: 'mobile_l', width: 844,  height: 390 },
  { name: 'mobile_ls', width: 667, height: 375 },
  { name: 'desktop',  width: 1440, height: 900 },
  { name: 'mobile_p', width: 390,  height: 844 },
];
const PAGES = [
  { name: 'root',      path: '/' },
  { name: 'lobby',     path: '/?dev=lobby' },
  { name: 'classichall', path: '/?dev=classichall' },
  { name: 'game',      path: '/?dev=mockv4' },
  { name: 'settle',    path: '/?dev=settle' },
  { name: 'admin',     path: '/admin' },
  { name: 'shop',      path: '/?dev=shop' },
  { name: 'rank',      path: '/?dev=rank' },
  { name: 'rooms',     path: '/?dev=rooms' },
  { name: 'profile',   path: '/?dev=profile' },
  { name: 'records',   path: '/?dev=records' },
  { name: 'match',     path: '/?dev=match' },
  { name: 'auth',      path: '/?dev=auth' },
  { name: 'notif',     path: '/?dev=notif' },
  { name: 'feedback',  path: '/?dev=feedback' },
  { name: 'purchase',  path: '/?dev=purchase' },
  { name: 'vip',       path: '/?dev=vip' },
];

const outDir = path.resolve(process.argv[2] || 'shots/baseline');
mkdirSync(outDir, { recursive: true });

let passed = 0, failed = 0;

for (const vp of VIEWPORTS) {
  for (const p of PAGES) {
    const url = new URL(p.path, BASE_URL).toString();
    const file = path.join(outDir, `${vp.name}_${p.name}.png`);
    // 等待启动页和入场动画结束，避免把启动画面误当成目标页面通过。
    const cmd = `npx playwright screenshot --browser chromium --viewport-size=${vp.width},${vp.height} --wait-for-timeout=1800 "${url}" "${file}"`;
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 25000 });
      console.log(`  ✓ ${vp.name}/${p.name}`);
      passed++;
    } catch (e) {
      console.log(`  ✗ ${vp.name}/${p.name}: ${e.message.split('\n')[0]}`);
      failed++;
    }
  }
}

console.log(`\n完成：${passed} 张成功，${failed} 张失败`);
console.log(`输出目录：${outDir}`);
