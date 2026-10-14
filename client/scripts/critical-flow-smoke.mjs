import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true });

const landscapeViewports = [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];

async function verifyLandscape(viewport) {
  const page = await browser.newPage({ viewport });
  const size = `${viewport.width}×${viewport.height}`;

  async function open(path, readySelector) {
    await page.goto(new URL(path, baseUrl).toString(), { waitUntil: 'domcontentloaded' });
    await page.locator(readySelector).first().waitFor({ state: 'visible', timeout: 12_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${size} ${path} 横向溢出 ${overflow}px`);
  }

  try {
    await open('/?dev=lobby', '.lobby-primary-action');
    assert.equal(await page.locator('.lobby-primary-action').count(), 1, `${size} 大厅主操作必须唯一`);
    await page.getByText('好友房', { exact: true }).waitFor({ state: 'visible' });

    await open('/?dev=classichall', '.classic-room-card');
    assert.equal(await page.locator('.classic-room-card').count(), 4, `${size} 应显示四个场次卡片`);
    assert.equal(await page.locator('.classic-room-art-space').count(), 4, `${size} 场次底图应保留展示空间`);

    await open('/?dev=match', '.mm-btn--gold');
    const start = page.locator('.mm-btn--gold');
    assert.equal(await start.isEnabled(), true, `${size} 立即开局按钮必须从开始就可用`);

    await open('/?dev=mockv4', '.tv4-table');
    await page.getByRole('button', { name: '多张甩牌' }).click();
    const taggedTricks = page.locator('.tv4-trick-slot:has(.tv4-trick-tag)');
    assert.ok(await taggedTricks.count() > 0, `${size} 牌组应显示先出或压牌标签`);
    assert.equal(
      await page.locator('.tv4-trick-owner').count(),
      0,
      `${size} 打出的牌上方不应显示用户名小字`,
    );
    const trick = page.locator('.tv4-trick-slot').first();
    await trick.click();
    await page.getByRole('dialog', { name: '查看出牌' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '关闭出牌大图' }).click();

    await open('/?dev=settle', '.settle-btn-primary');
    await page.locator('.settle-hero-reward').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.settle-btn-primary').isEnabled(), true, `${size} 下一局按钮不可禁用`);

    await open('/admin', '.adm-login-card');
    console.log(`✓ ${size} 横屏关键体验冒烟检查通过`);
  } finally {
    await page.close();
  }
}

try {
  for (const viewport of landscapeViewports) {
    await verifyLandscape(viewport);
  }
} finally {
  await browser.close();
}
