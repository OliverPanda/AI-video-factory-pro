import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

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

test('runSeedanceVideo passes generationPack and structured prompt blocks through to provider call', async () => {
  const generateCalls = [];

  const videoRun = await runSeedanceVideo(
    [
      {
        shotId: 'shot_structured',
        preferredProvider: 'seedance',
        durationTargetSec: 4,
        generationPack: {
          scene_id: 'scene_001',
          shot_id: 'shot_structured',
          quality_target: 'narrative_clarity',
        },
        seedancePromptBlocks: [
          { key: 'cinematic_intent', text: 'Keep the confrontation grounded and legible.' },
          { key: 'entry_exit', text: 'entry: gun raised; exit: opponent pinned by shelf' },
        ],
      },
    ],
    '/tmp/video',
    {
      generateVideoClip: async (shotPackage, outputPath) => {
        generateCalls.push({
          shotId: shotPackage.shotId,
          generationPack: shotPackage.generationPack,
          seedancePromptBlocks: shotPackage.seedancePromptBlocks,
          outputPath,
        });
        return {
          provider: 'seedance',
          videoPath: outputPath,
          taskId: 'task_shot_structured',
          providerJobId: 'task_shot_structured',
          actualDurationSec: 4,
          providerRequest: { model: 'doubao-seedance-2-0-260128' },
          providerMetadata: { ratio: '9:16' },
        };
      },
    }
  );

  assert.equal(videoRun.results[0].status, 'completed');
  assert.equal(generateCalls.length, 1);
  assert.equal(generateCalls[0].generationPack.scene_id, 'scene_001');
  assert.equal(generateCalls[0].seedancePromptBlocks[0].key, 'cinematic_intent');
});

test('runSeedanceVideo uses providerClient for default seedance generation path', async () => {
  const calls = [];

  const videoRun = await runSeedanceVideo(
    [
      {
        shotId: 'shot_provider_client',
        preferredProvider: 'seedance',
        durationTargetSec: 4,
        generationPack: {
          scene_id: 'scene_provider_client',
        },
      },
    ],
    '/tmp/video',
    {
      providerClient: {
        async submit(shotPackage, outputPath) {
          calls.push(['submit', shotPackage.shotId, outputPath]);
          return {
            taskId: 'task_provider_client',
            provider: 'seedance',
            model: 'doubao-seedance-2-0-260128',
          };
        },
        async poll(taskId) {
          calls.push(['poll', taskId]);
          return {
            status: 'COMPLETED',
            outputUrl: 'https://example.com/shot_provider_client.mp4',
            actualDurationSec: 4,
          };
        },
        async download(outputUrl, outputPath) {
          calls.push(['download', outputUrl, outputPath]);
        },
      },
    }
  );

  assert.equal(videoRun.results[0].status, 'completed');
  assert.equal(videoRun.results[0].provider, 'seedance');
  assert.equal(videoRun.results[0].model, 'doubao-seedance-2-0-260128');
  assert.deepEqual(calls, [
    ['submit', 'shot_provider_client', path.join('/tmp/video', 'shot_provider_client.mp4')],
    ['poll', 'task_provider_client'],
    ['download', 'https://example.com/shot_provider_client.mp4', path.join('/tmp/video', 'shot_provider_client.mp4')],
  ]);
});
