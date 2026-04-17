import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { __testables, runSora2Video } from '../src/agents/sora2VideoAgent.js';

test('runSora2Video skips non-sora2 shots and records provider failures', async () => {
  const videoRun = await runSora2Video(
    [
      {
        shotId: 'shot_001',
        preferredProvider: 'sora2',
        durationTargetSec: 4,
      },
      {
        shotId: 'shot_002',
        preferredProvider: 'static_image',
        durationTargetSec: 3,
      },
      {
        shotId: 'shot_003',
        preferredProvider: 'sora2',
        durationTargetSec: 5,
      },
    ],
    '/tmp/video',
    {
      generateVideoClip: async (shotPackage, outputPath) => {
        if (shotPackage.shotId === 'shot_001') {
          return {
            provider: 'sora2',
            model: 'sora_video2',
            videoPath: outputPath,
            actualDurationSec: 4,
          };
        }
        throw Object.assign(new Error('timeout'), {
          code: 'SORA2_TIMEOUT',
          category: 'provider_timeout',
        });
      },
    }
  );

  assert.equal(videoRun.results[0].provider, 'sora2');
  assert.equal(videoRun.results[0].status, 'completed');
  assert.equal(videoRun.results[1].provider, 'static_image');
  assert.equal(videoRun.results[1].status, 'skipped');
  assert.equal(videoRun.results[2].provider, 'sora2');
  assert.equal(videoRun.results[2].failureCategory, 'provider_timeout');
});

test('buildReport summarizes generated failed and skipped sora2 shots', () => {
  const report = __testables.buildReport([
    { shotId: 'a', provider: 'sora2', status: 'completed', model: 'sora_video2' },
    { shotId: 'b', provider: 'sora2', status: 'failed', model: 'sora_video2', failureCategory: 'provider_timeout' },
    { shotId: 'c', provider: 'static_image', status: 'skipped', model: null },
  ]);

  assert.equal(report.generatedCount, 1);
  assert.equal(report.failedCount, 1);
  assert.equal(report.skippedCount, 1);
  assert.deepEqual(report.providerBreakdown, { sora2: 2, static_image: 1 });
});

test('runSora2Video can use providerClient for compatibility generation path', async () => {
  const calls = [];

  const videoRun = await runSora2Video(
    [
      {
        shotId: 'shot_provider_client',
        preferredProvider: 'sora2',
        durationTargetSec: 4,
      },
    ],
    '/tmp/video',
    {
      providerClient: {
        async submit(shotPackage, outputPath) {
          calls.push(['submit', shotPackage.shotId, outputPath]);
          return {
            taskId: 'task_sora2_provider_client',
            provider: 'sora2',
            model: 'relay-seedance-compatible',
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
  assert.equal(videoRun.results[0].provider, 'sora2');
  assert.equal(videoRun.results[0].model, 'relay-seedance-compatible');
  assert.deepEqual(calls, [
    ['submit', 'shot_provider_client', path.join('/tmp/video', 'shot_provider_client.mp4')],
    ['poll', 'task_sora2_provider_client'],
    ['download', 'https://example.com/shot_provider_client.mp4', path.join('/tmp/video', 'shot_provider_client.mp4')],
  ]);
});
