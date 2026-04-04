import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables, runRunwayVideo } from '../src/agents/runwayVideoAgent.js';

test('runRunwayVideo skips static-image routed shots and records provider failures', async () => {
  const videoRun = await runRunwayVideo(
    [
      {
        shotId: 'shot_ok',
        preferredProvider: 'runway',
        durationTargetSec: 4,
        generationTier: 'enhanced',
        variantCount: 2,
      },
      {
        shotId: 'shot_static',
        preferredProvider: 'static_image',
        durationTargetSec: 3,
      },
      {
        shotId: 'shot_fail',
        preferredProvider: 'runway',
        durationTargetSec: 5,
        generationTier: 'hero',
        variantCount: 3,
      },
    ],
    '/tmp/video',
    {
      generateVideoClip: async (shotPackage, outputPath) => {
        if (shotPackage.shotId === 'shot_fail') {
          const error = new Error('rate limited');
          error.code = 'RUNWAY_RATE_LIMIT';
          error.category = 'provider_rate_limit';
          throw error;
        }
        return {
          provider: 'runway',
          model: shotPackage.generationTier === 'hero' ? 'gen4_aleph' : 'gen4_turbo',
          videoPath: outputPath,
          taskId: `task_${shotPackage.shotId}`,
          actualDurationSec: shotPackage.durationTargetSec,
          variantIndex: shotPackage.variantCount > 1 ? 1 : 0,
        };
      },
    }
  );

  assert.equal(videoRun.results.length, 3);
  assert.equal(videoRun.results[0].status, 'completed');
  assert.equal(videoRun.results[0].model, 'gen4_turbo');
  assert.equal(videoRun.results[0].actualDurationSec, 4);
  assert.equal(videoRun.results[0].variantIndex, 1);
  assert.equal(videoRun.results[1].status, 'skipped');
  assert.equal(videoRun.results[1].variantIndex, null);
  assert.equal(videoRun.results[2].failureCategory, 'provider_rate_limit');
  assert.equal(videoRun.results[2].model, 'gen4_aleph');
  assert.equal(videoRun.results[2].variantIndex, null);
  assert.equal(videoRun.report.failedCount, 1);
  assert.equal(videoRun.report.skippedCount, 1);
});

test('buildReport summarizes generated failed and skipped video shots', () => {
  const report = __testables.buildReport([
    { shotId: 'a', provider: 'runway', model: 'gen4_turbo', status: 'completed' },
    { shotId: 'b', provider: 'runway', model: 'gen4_aleph', status: 'failed', failureCategory: 'provider_timeout' },
    { shotId: 'c', provider: 'static_image', status: 'skipped' },
  ]);

  assert.equal(report.status, 'warn');
  assert.equal(report.generatedCount, 1);
  assert.equal(report.failedCount, 1);
  assert.equal(report.skippedCount, 1);
  assert.deepEqual(report.providerBreakdown, { runway: 2, static_image: 1 });
  assert.deepEqual(report.modelBreakdown, { gen4_turbo: 1, gen4_aleph: 1 });
});
