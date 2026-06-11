import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCostGovernanceReport } from '../src/utils/costGovernance.js';

test('cost governance warns when planned video requests exceed budget in advisory mode', () => {
  const report = buildCostGovernanceReport({
    preflightShotPackages: [
      { shotId: 's1', preferredProvider: 'seedance' },
      { shotId: 's2', preferredProvider: 'sora' },
      { shotId: 's3', preferredProvider: 'static_image' },
    ],
    policy: { maxVideoRequests: 1, enforce: false },
  });

  assert.equal(report.status, 'warn');
  assert.equal(report.planned.videoRequestCount, 2);
  assert.equal(report.warnings.length, 1);
  assert.equal(report.blockers.length, 0);
});

test('cost governance blocks when enforce mode is enabled', () => {
  const report = buildCostGovernanceReport({
    preflightShotPackages: [{ shotId: 's1', preferredProvider: 'seedance' }],
    consistencyNeedsRegeneration: [
      { shotId: 's1', regenStrategy: 'reanchor_regenerate' },
      { shotId: 's2', regenStrategy: 'reanchor_regenerate' },
    ],
    policy: {
      maxVideoRequests: 0,
      maxReanchorRegenerations: 1,
      enforce: true,
    },
  });

  assert.equal(report.status, 'block');
  assert.equal(report.blockers.length, 2);
  assert.equal(report.planned.estimatedUnits.total, 5);
});

test('cost governance records actual video failures', () => {
  const report = buildCostGovernanceReport({
    preflightShotPackages: [{ shotId: 's1', preferredProvider: 'seedance' }],
    videoResults: [
      { shotId: 's1', status: 'failed' },
      { shotId: 's2', status: 'completed' },
    ],
    policy: { maxFailedVideoRequests: 0 },
  });

  assert.equal(report.status, 'warn');
  assert.equal(report.actual.failedVideoCount, 1);
  assert.match(report.warnings[0], /视频失败数/);
});

test('cost governance accumulates metrics across resume runs', () => {
  const first = buildCostGovernanceReport({
    runId: 'run_1',
    preflightShotPackages: [{ shotId: 's1', preferredProvider: 'seedance' }],
    consistencyNeedsRegeneration: [{ shotId: 's1', regenStrategy: 'reanchor_regenerate' }],
    policy: { maxVideoRequests: 10, maxReanchorRegenerations: 10 },
  });
  const second = buildCostGovernanceReport({
    runId: 'run_2',
    costMetricsState: first.costMetricsState,
    preflightShotPackages: [
      { shotId: 's2', preferredProvider: 'seedance' },
      { shotId: 's3', preferredProvider: 'static_image' },
    ],
    consistencyNeedsRegeneration: [{ shotId: 's2', regenStrategy: 'prompt_tighten' }],
    videoResults: [{ shotId: 's2', status: 'failed' }],
    policy: { maxVideoRequests: 10, maxReanchorRegenerations: 10, maxFailedVideoRequests: 10 },
  });

  assert.equal(second.currentRun.videoRequestCount, 1);
  assert.equal(second.accumulated.videoRequestCount, 2);
  assert.equal(second.accumulated.reanchorRegenerationCount, 1);
  assert.equal(second.accumulated.promptTightenRegenerationCount, 1);
  assert.equal(second.accumulated.failedVideoCount, 1);
  assert.equal(second.accumulated.estimatedUnits.total, 5);
});

test('cost governance overwrites the same run id instead of double counting it', () => {
  const first = buildCostGovernanceReport({
    runId: 'run_same',
    preflightShotPackages: [{ shotId: 's1', preferredProvider: 'seedance' }],
    policy: { maxVideoRequests: 10 },
  });
  const recomputed = buildCostGovernanceReport({
    runId: 'run_same',
    costMetricsState: first.costMetricsState,
    preflightShotPackages: [{ shotId: 's1', preferredProvider: 'seedance' }],
    videoResults: [{ shotId: 's1', status: 'completed' }],
    policy: { maxVideoRequests: 10 },
  });

  assert.equal(recomputed.accumulated.videoRequestCount, 1);
  assert.equal(recomputed.accumulated.completedVideoCount, 1);
  assert.equal(Object.keys(recomputed.costMetricsState.runs).length, 1);
});
