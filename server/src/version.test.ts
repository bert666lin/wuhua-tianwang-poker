import test from 'node:test';
import assert from 'node:assert/strict';
import { versionInfo } from './version.js';

test('版本信息优先使用构建时注入的环境变量', () => {
  const prev = {
    commit: process.env.APP_COMMIT,
    buildTime: process.env.APP_BUILD_TIME,
    frontendBundle: process.env.APP_FRONTEND_BUNDLE,
  };
  process.env.APP_COMMIT = '93adb0a';
  process.env.APP_BUILD_TIME = '2026-08-31T12:00:00Z';
  process.env.APP_FRONTEND_BUNDLE = 'index-abc123.js';
  try {
    assert.deepEqual(versionInfo(), {
      commit: '93adb0a',
      buildTime: '2026-08-31T12:00:00Z',
      frontendBundle: 'index-abc123.js',
    });
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
