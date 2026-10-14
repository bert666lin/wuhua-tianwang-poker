import test from 'node:test';
import assert from 'node:assert/strict';
import { getModeIdForSelection } from './modeSelection.js';

test('两副牌支持 3/4 人并返回服务端模式', () => {
  assert.equal(getModeIdForSelection(3, 2), 'threePlayerTwoDecks');
  assert.equal(getModeIdForSelection(4, 2), 'fourPlayerTwoDecks');
});

test('三副牌支持 3/4/5/6 人并返回服务端模式', () => {
  assert.equal(getModeIdForSelection(3, 3), 'threePlayerThreeDecks');
  assert.equal(getModeIdForSelection(4, 3), 'fourPlayerThreeDecks');
  assert.equal(getModeIdForSelection(5, 3), 'fivePlayerThreeDecks');
  assert.equal(getModeIdForSelection(6, 3), 'sixPlayerThreeDecks');
});

test('不支持的组合必须失败，不能静默路由到其他模式', () => {
  assert.equal(getModeIdForSelection(5, 2), null);
  assert.equal(getModeIdForSelection(6, 2), null);
});

import { getModeIdForLabel } from './modeSelection.js';

test('getModeIdForLabel 能从中文模式名反查模式 id', () => {
  assert.equal(getModeIdForLabel('4人 3副'), 'fourPlayerThreeDecks');
  assert.equal(getModeIdForLabel('3人 2副'), 'threePlayerTwoDecks');
  assert.equal(getModeIdForLabel('6人 3副'), 'sixPlayerThreeDecks');
});

test('getModeIdForLabel 对不存在的组合和乱码返回 null', () => {
  assert.equal(getModeIdForLabel('5人 2副'), null);
  assert.equal(getModeIdForLabel('经典场'), null);
});

import { getModeLabel } from './modeSelection.js';

test('getModeLabel 把服务端模式 id 转成中文标签', () => {
  assert.equal(getModeLabel('fourPlayerThreeDecks'), '4人 3副');
  assert.equal(getModeLabel('threePlayerTwoDecks'), '3人 2副');
  assert.equal(getModeLabel('sixPlayerThreeDecks'), '6人 3副');
});

test('getModeLabel 遇到未知模式 id 返回 null，不瞎猜', () => {
  assert.equal(getModeLabel('nope'), null);
});

import { getModeDeal, getModeDealForSelection } from './modeSelection.js';

test('getModeDeal 的发牌参数与服务端 GAME_MODES 对齐（含 5 人 3 副的 29+17）', () => {
  assert.deepEqual(getModeDeal('fivePlayerThreeDecks'), {
    playerCount: 5, deckCount: 3, totalCards: 162, perPlayer: 29, bottomCount: 17, totalScore: 300,
  });
  assert.deepEqual(getModeDeal('fourPlayerTwoDecks'), {
    playerCount: 4, deckCount: 2, totalCards: 108, perPlayer: 24, bottomCount: 12, totalScore: 200,
  });
});

test('每个模式都满足 人数×每人手牌 + 底牌 = 总牌数', () => {
  for (const id of [
    'threePlayerTwoDecks', 'threePlayerThreeDecks', 'fourPlayerTwoDecks',
    'fourPlayerThreeDecks', 'fivePlayerThreeDecks', 'sixPlayerThreeDecks',
  ]) {
    const d = getModeDeal(id)!;
    assert.equal(d.playerCount * d.perPlayer + d.bottomCount, d.totalCards, id);
    assert.equal(d.deckCount * 54, d.totalCards, id);
  }
});

test('getModeDealForSelection 对不存在的 5 人 2 副返回 null', () => {
  assert.equal(getModeDealForSelection(5, 2), null);
  assert.equal(getModeDealForSelection(4, 3)?.perPlayer, 36);
});
