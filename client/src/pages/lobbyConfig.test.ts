/**
 * 大厅配置与文案的单测。
 *
 * 这些逻辑原先埋在 Lobby.tsx 的 1500 行里，没有一行测试。抽成模块后补上，
 * 重点守两类历史问题：
 *   1. **模式表与服务端不一致** —— 玩家看到的张数/人数和实发不符；
 *      这里交叉读服务端 server/src/logic/config.ts 做校验。
 *   2. **文案变长导致窄屏截断** —— 模式卡在手机端只有 ~94px 可用宽，
 *      历史上「暂无人在玩 · 可带 AI 开局」被截成「…可带 AI…」。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  MODES, CLASSIC_MODE_ID, TIER_LABELS, modeById, seatsOfMode,
  modeLabelWithDeck, tierLabel, peopleText, formatCoins,
} from './lobbyConfig';

const lobbyHomeSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'LobbyHome.tsx'),
  'utf8',
);

describe('模式表', () => {
  it('id 不重复（重复会让两张卡指向同一玩法）', () => {
    const ids = MODES.map(m => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('人数与底牌数都在合法范围', () => {
    for (const m of MODES) {
      assert.ok(m.players >= 2 && m.players <= 6, `${m.id} 人数异常: ${m.players}`);
      assert.ok(m.bottom > 0, `${m.id} 底牌数异常: ${m.bottom}`);
    }
  });

  it('经典场 id 必须真实存在于模式表', () => {
    assert.ok(MODES.some(m => m.id === CLASSIC_MODE_ID), '经典场 id 不在模式表里');
  });

  /**
   * 交叉校验服务端：服务端才是权威。
   * 这条测试专门防「前端显示 36 张/人、服务端实发 24 张」这种对不上的情况。
   */
  it('每个模式的人数/底牌数/每人张数都与服务端 GAME_MODES 一致', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const cfg = readFileSync(
      path.resolve(here, '../../../server/src/logic/config.ts'), 'utf8',
    );
    for (const m of MODES) {
      // 服务端用 camelCase 的键名，如 fourPlayerThreeDecks: { ... }
      const block = cfg.match(new RegExp(`${m.id}:\\s*\\{([\\s\\S]*?)\\n  \\}`));
      assert.ok(block, `服务端 GAME_MODES 里找不到 ${m.id}`);
      const body = block![1];
      const num = (k: string) => Number(body.match(new RegExp(`${k}:\\s*(\\d+)`))?.[1]);
      assert.equal(num('playerCount'), m.players, `${m.id} 人数与服务端不一致`);
      assert.equal(num('bottomCount'), m.bottom, `${m.id} 底牌数与服务端不一致`);
      // sub 形如「36张/人」，要等于服务端 perPlayer
      const perPlayer = Number(m.sub.match(/(\d+)/)?.[1]);
      assert.equal(num('perPlayer'), perPlayer, `${m.id} 每人张数与服务端不一致`);
    }
  });
});

describe('modeById / seatsOfMode', () => {
  it('认得出已知 id', () => {
    assert.equal(modeById('threePlayerTwoDecks').players, 3);
    assert.equal(seatsOfMode('sixPlayerThreeDecks'), 6);
  });

  it('认不出的 id 回落经典场，绝不返回 undefined', () => {
    for (const bad of ['', 'nope', 'undefined']) {
      const m = modeById(bad);
      assert.ok(m, `${bad} 返回了空`);
      assert.equal(m.id, CLASSIC_MODE_ID);
    }
  });

  it('认不出的 id 按 4 人算座位（匹配页要显示 x/4）', () => {
    assert.equal(seatsOfMode('nope'), 4);
  });
});

describe('快速开始按钮的模式名', () => {
  it('大厅只有一个主操作，快速开始不能再和三个同级按钮抢注意力', () => {
    assert.equal(
      (lobbyHomeSource.match(/lobby-primary-action/g) ?? []).length,
      1,
      '大厅必须且只能有一个 lobby-primary-action',
    );
    assert.match(lobbyHomeSource, /lobby-quick-btn lobby-primary-action/);
  });

  it('房间列表和加入房间归在好友房操作组，并给出分组名称', () => {
    assert.match(lobbyHomeSource, /className="lobby-friend-actions"/);
    assert.match(lobbyHomeSource, /aria-label="好友房"/);
    assert.match(lobbyHomeSource, />好友房</);
  });

  it('必须带副数：三人模式有 2 副/3 副两档，不带副数会显示成同一个名字', () => {
    const a = modeLabelWithDeck('threePlayerTwoDecks');
    const b = modeLabelWithDeck('threePlayerThreeDecks');
    assert.notEqual(a, b, '两档三人模式显示成了同一个名字');
    assert.match(a, /2副/);
    assert.match(b, /3副/);
  });

  it('不能再出现「· 经典」（冗余，且窄屏会折行）', () => {
    for (const m of MODES) {
      assert.ok(!modeLabelWithDeck(m.id).includes('经典'), `${m.id} 的标签又带上了「经典」`);
    }
  });

  it('标签要短，留给窄屏（实测按钮左侧可用 ~94px）', () => {
    for (const m of MODES) {
      assert.ok(modeLabelWithDeck(m.id).length <= 8, `${m.id} 标签过长: ${modeLabelWithDeck(m.id)}`);
    }
  });
});

describe('场次文案', () => {
  it('四个场次都有名字和门槛，且门槛递增', () => {
    const order = ['easy', 'mid', 'high', 'master'];
    let prev = 0;
    for (const t of order) {
      const info = TIER_LABELS[t];
      assert.ok(info, `缺场次 ${t}`);
      assert.ok(info.entry > prev, `${t} 的门槛没有递增`);
      prev = info.entry;
    }
  });

  it('认不出的场次回落初级场（与服务端 tierOf 的回落口径一致）', () => {
    assert.deepEqual(tierLabel('nope'), { name: '初级场', entry: 1_000 });
  });
});

describe('在玩人数文案', () => {
  it('0 人时说「可带 AI 开局」，不能显示成「0 人正在玩」', () => {
    assert.equal(peopleText(0), '可带 AI 开局');
  });

  it('拉不到数据时返回空串（卡上就不显示这行）', () => {
    assert.equal(peopleText(undefined), '');
  });

  it('有人时显示人数', () => {
    assert.equal(peopleText(7), '7 人正在玩');
  });

  it('文案必须短：模式卡在手机端只有约 94px 可用宽', () => {
    for (const n of [0, 1, 99, 1234]) {
      assert.ok(peopleText(n).length <= 10, `「${peopleText(n)}」太长会被截断`);
    }
  });
});

describe('金币格式化', () => {
  it('过万折成万，保留一位小数', () => {
    assert.equal(formatCoins(12345), '1.2万');
    assert.equal(formatCoins(10000), '1.0万');
  });

  it('不过万用千分位', () => {
    assert.equal(formatCoins(9999), '9,999');
    assert.equal(formatCoins(0), '0');
  });
});
