import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunMetrics, finalizeRunMetrics, measureStep } from '../src/utils/metrics.js';

test('measureStep 会记录成功步骤耗时和元数据', async () => {
  const metrics = createRunMetrics();
  const result = await measureStep(metrics, 'demo', '演示步骤', async () => 'ok', {
    onSuccessMeta: (value) => ({ value }),
  });

  assert.equal(result, 'ok');
  assert.equal(metrics.steps.demo.status, 'success');
  assert.equal(metrics.steps.demo.meta.value, 'ok');
  assert.equal(typeof metrics.steps.demo.durationMs, 'number');
});

test('measureStep 会记录失败步骤信息', async () => {
  const metrics = createRunMetrics();

  await assert.rejects(
    () =>
      measureStep(metrics, 'broken', '失败步骤', async () => {
        throw new Error('boom');
      }),
    /boom/
  );

  assert.equal(metrics.steps.broken.status, 'failed');
  assert.equal(metrics.steps.broken.error, 'boom');
});

test('finalizeRunMetrics 会生成总耗时摘要', () => {
  const metrics = createRunMetrics();
  const finalized = finalizeRunMetrics(metrics);

  assert.equal(typeof finalized.summary.totalDurationMs, 'number');
  assert.equal(typeof finalized.summary.totalDurationSec, 'number');
  assert.equal(finalized.summary.cost, null);
  assert.ok(finalized.finishedAt);
});
