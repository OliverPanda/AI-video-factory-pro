import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables, runSeedanceVideo } from '../src/agents/seedanceVideoAgent.js';

test('runSeedanceVideo skips non-seedance shots and records provider failures', async () => {
  const videoRun = await runSeedanceVideo(
    [
      {
        shotId: 'shot_ok',
        preferredProvider: 'seedance',
        durationTargetSec: 4,
      },
      {
        shotId: 'shot_other',
        preferredProvider: 'runway',
        durationTargetSec: 3,
      },
      {
        shotId: 'shot_fail',
        preferredProvider: 'seedance',
        durationTargetSec: 5,
      },
    ],
    '/tmp/video',
    {
      generateVideoClip: async (shotPackage, outputPath) => {
        if (shotPackage.shotId === 'shot_fail') {
          const error = new Error('rate limited');
          error.code = 'SEEDANCE_RATE_LIMIT';
          error.category = 'provider_rate_limit';
          throw error;
        }
        return {
          provider: 'seedance',
          videoPath: outputPath,
          taskId: `task_${shotPackage.shotId}`,
          providerJobId: `task_${shotPackage.shotId}`,
          actualDurationSec: shotPackage.durationTargetSec,
          providerRequest: { model: 'doubao-seedance-2-0-260128' },
          providerMetadata: { ratio: '9:16' },
        };
      },
    }
  );

  assert.equal(videoRun.results.length, 3);
  assert.equal(videoRun.results[0].status, 'completed');
  assert.equal(videoRun.results[0].provider, 'seedance');
  assert.equal(videoRun.results[1].status, 'skipped');
  assert.equal(videoRun.results[1].provider, 'runway');
  assert.equal(videoRun.results[2].failureCategory, 'provider_rate_limit');
  assert.equal(videoRun.report.failedCount, 1);
  assert.equal(videoRun.report.skippedCount, 1);
});

test('buildReport summarizes generated failed and skipped seedance shots', () => {
  const report = __testables.buildReport([
    { shotId: 'a', provider: 'seedance', status: 'completed' },
    { shotId: 'b', provider: 'seedance', status: 'failed', failureCategory: 'provider_timeout' },
    { shotId: 'c', provider: 'runway', status: 'skipped' },
  ]);

  assert.equal(report.status, 'warn');
  assert.equal(report.generatedCount, 1);
  assert.equal(report.failedCount, 1);
  assert.equal(report.skippedCount, 1);
  assert.deepEqual(report.providerBreakdown, { seedance: 2, runway: 1 });
});
