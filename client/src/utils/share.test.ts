import test from 'node:test';
import assert from 'node:assert/strict';

import { canSystemShare, isInWeixin, isNativeApp, systemShare } from './share.js';

/** 临时替换 window 属性，测完还原。 */
function withWindowProps(props: Record<string, unknown>, fn: () => void | Promise<void>) {
  const entries = Object.entries(props);
  const olds = entries.map(([key]) => [key, (globalThis as Record<string, unknown>)[key]] as const);
  for (const [key, value] of entries) (globalThis as Record<string, unknown>)[key] = value;
  const restore = () => {
    for (const [key, old] of olds) {
      if (old === undefined) delete (globalThis as Record<string, unknown>)[key];
      else (globalThis as Record<string, unknown>)[key] = old;
    }
  };
  const r = fn();
  if (r instanceof Promise) return r.finally(restore);
  restore();
  return undefined;
}

/** 临时替换 navigator，测完还原。 */
function withNavigator(nav: unknown, fn: () => void | Promise<void>) {
  const g = globalThis as { navigator?: unknown };
  const had = 'navigator' in g;
  const old = g.navigator;
  Object.defineProperty(g, 'navigator', { value: nav, configurable: true, writable: true });
  const restore = () => {
    if (had) Object.defineProperty(g, 'navigator', { value: old, configurable: true, writable: true });
    else delete g.navigator;
  };
  const r = fn();
  if (r instanceof Promise) return r.finally(restore);
  restore();
  return undefined;
}

test('canSystemShare：只有存在 navigator.share 才算支持', () => {
  withNavigator({ share: () => Promise.resolve() }, () => {
    assert.equal(canSystemShare(), true);
  });
  // 桌面浏览器通常没有 share，必须退回复制链接而不是报错
  withNavigator({}, () => {
    assert.equal(canSystemShare(), false);
  });
});

test('isInWeixin：认得微信内置浏览器的 UA', () => {
  withNavigator({ userAgent: 'Mozilla/5.0 ... MicroMessenger/8.0.49' }, () => {
    assert.equal(isInWeixin(), true);
  });
  withNavigator({ userAgent: 'Mozilla/5.0 ... Safari/605.1' }, () => {
    assert.equal(isInWeixin(), false);
  });
});

test('systemShare：分享成功返回 shared', async () => {
  let got: unknown = null;
  await withNavigator({ share: (d: unknown) => { got = d; return Promise.resolve(); } }, async () => {
    const r = await systemShare({ title: 'T', text: 'X', url: 'https://e.com/' });
    assert.equal(r, 'shared');
    assert.deepEqual(got, { title: 'T', text: 'X', url: 'https://e.com/' });
  });
});

test('systemShare：用户取消要和真失败区分开', async () => {
  // 点"取消"时浏览器抛 AbortError。这是正常操作：
  // 不能弹错误提示，更不能据此发分享奖励（用户什么都没分享出去）
  const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
  await withNavigator({ share: () => Promise.reject(abort) }, async () => {
    assert.equal(await systemShare({ title: 'T', text: 'X', url: 'https://e.com/' }), 'cancelled');
  });
  // 其他异常算失败，需要给用户兜底路径（复制链接）
  await withNavigator({ share: () => Promise.reject(new Error('boom')) }, async () => {
    assert.equal(await systemShare({ title: 'T', text: 'X', url: 'https://e.com/' }), 'failed');
  });
});

test('systemShare：不支持时返回 unsupported，不抛错', async () => {
  await withNavigator({}, async () => {
    assert.equal(await systemShare({ title: 'T', text: 'X', url: 'https://e.com/' }), 'unsupported');
  });
});


test('isNativeApp：认得 Capacitor 注入的全局对象', () => {
  withWindowProps({ Capacitor: { isNativePlatform: () => true } }, () => {
    assert.equal(isNativeApp(), true);
  });
  withWindowProps({ Capacitor: { isNativePlatform: () => false } }, () => {
    assert.equal(isNativeApp(), false);
  });
  withWindowProps({}, () => {
    assert.equal(isNativeApp(), false);
  });
});

test('systemShare：优先走 Capacitor 原生分享面板', async () => {
  let got: unknown = null;
  const Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      Share: {
        share: (data: unknown) => {
          got = data;
          return Promise.resolve();
        },
      },
    },
  };
  await withWindowProps({ Capacitor }, async () => {
    await withNavigator({}, async () => {
      const r = await systemShare({ title: 'T', text: 'X', url: 'https://e.com/' });
      assert.equal(r, 'shared');
      assert.deepEqual(got, { title: 'T', text: 'X', url: 'https://e.com/' });
    });
  });
});

test('systemShare：原生分享文案已含链接时不重复传 url', async () => {
  let got: unknown = null;
  const Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      Share: {
        share: (data: unknown) => {
          got = data;
          return Promise.resolve();
        },
      },
    },
  };
  await withWindowProps({ Capacitor }, async () => {
    await withNavigator({}, async () => {
      const r = await systemShare({
        title: 'T',
        text: '来打梅州五华天王：https://e.com/',
        url: 'https://e.com/',
      });
      assert.equal(r, 'shared');
      assert.deepEqual(got, { title: 'T', text: '来打梅州五华天王：https://e.com/' });
    });
  });
});

test('systemShare：Capacitor 用户取消和失败也区分开', async () => {
  const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
  await withWindowProps({ Capacitor: { isNativePlatform: () => true, Plugins: { Share: { share: () => Promise.reject(abort) } } } }, async () => {
    await withNavigator({}, async () => {
      assert.equal(await systemShare({ title: 'T', text: 'X', url: 'https://e.com/' }), 'cancelled');
    });
  });
  await withWindowProps({ Capacitor: { isNativePlatform: () => true, Plugins: { Share: { share: () => Promise.reject(new Error('boom')) } } } }, async () => {
    await withNavigator({}, async () => {
      assert.equal(await systemShare({ title: 'T', text: 'X', url: 'https://e.com/' }), 'failed');
    });
  });
});
