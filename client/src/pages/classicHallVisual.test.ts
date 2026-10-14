import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(new URL('./ClassicHall.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../styles/classic-hall.css', import.meta.url), 'utf8');

describe('横屏场次卡片视觉层级', () => {
  it('底图中央保留独立展示空间，不再被信息面板压暗', () => {
    assert.match(pageSource, /classic-room-art-space/);
    assert.match(cssSource, /\.classic-room-art-space\s*\{/);
  });

  it('入场、牌数与可进状态按信息层级重新排列且不重复底分', () => {
    assert.match(pageSource, /入场门槛/);
    assert.match(pageSource, /金币充足/);
    assert.doesNotMatch(pageSource, /底分 \{formatStake\(room\.stake\)\} · 可进/);
  });
});
