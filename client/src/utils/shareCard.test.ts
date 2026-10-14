import test from 'node:test';
import assert from 'node:assert/strict';
import { drawShareCard, shareCardFileName } from './shareCard.js';

/** 极简假 ctx：只记录画了哪些字，够验证内容组装是否正确。 */
function fakeCtx() {
  const calls: string[] = [];
  return {
    calls,
    ctx: {
      font: '',
      fillStyle: '',
      textAlign: 'left' as CanvasTextAlign,
      fillRect() {},
      fillText(text: string) { calls.push(text); },
    } as unknown as CanvasRenderingContext2D,
  };
}

test('drawShareCard 画出胜负、级别变化与关键明细', () => {
  const { ctx, calls } = fakeCtx();
  drawShareCard(ctx, {
    playerName: '阿强',
    mode: '4人 3副',
    iWon: true,
    levelDelta: 3,
    mainSuitName: '红桃',
    callScore: 80,
    trickScore: 60,
    digSuccess: true,
    rankName: '黄金',
  });
  assert.ok(calls.includes('胜'));
  assert.ok(calls.includes('+3 级'));
  assert.ok(calls.includes('4人 3副'));
  assert.ok(calls.includes('主牌 红桃'));
  assert.ok(calls.includes('叫分 80'));
  assert.ok(calls.includes('挖底成功'));
  assert.ok(calls.includes('当前段位 黄金'));
});

test('drawShareCard 输局时不画正号，也不画没有的明细', () => {
  const { ctx, calls } = fakeCtx();
  drawShareCard(ctx, { playerName: '我', mode: '3人 2副', iWon: false, levelDelta: -2 });
  assert.ok(calls.includes('负'));
  assert.ok(calls.includes('-2 级'));
  assert.ok(!calls.some(t => t.startsWith('主牌')));
  assert.ok(!calls.some(t => t.startsWith('叫分')));
  assert.ok(!calls.includes('挖底成功'));
});

test('shareCardFileName 用本地时间拼出补零的文件名', () => {
  assert.equal(
    shareCardFileName(new Date(2026, 7, 29, 8, 5)),
    '五华天王-战绩-20260829-0805.png',
  );
});
