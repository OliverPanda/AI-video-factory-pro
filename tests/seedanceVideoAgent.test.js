import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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
        preferredProvider: 'happyhorse',
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
  assert.equal(videoRun.results[1].provider, 'happyhorse');
  assert.equal(videoRun.results[2].failureCategory, 'provider_rate_limit');
  assert.equal(videoRun.report.failedCount, 1);
  assert.equal(videoRun.report.skippedCount, 1);
});

test('buildReport summarizes generated failed and skipped seedance shots', () => {
  const report = __testables.buildReport([
    { shotId: 'a', provider: 'seedance', status: 'completed' },
    { shotId: 'b', provider: 'seedance', status: 'failed', failureCategory: 'provider_timeout' },
    { shotId: 'c', provider: 'happyhorse', status: 'skipped' },
  ]);

  assert.equal(report.status, 'warn');
  assert.equal(report.generatedCount, 1);
  assert.equal(report.failedCount, 1);
  assert.equal(report.skippedCount, 1);
  assert.deepEqual(report.providerBreakdown, { seedance: 2, happyhorse: 1 });
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

test('runSeedanceVideo reuses existing video output without submitting again', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-seedance-reuse-'));

  try {
    const existingPath = path.join(tempRoot, 'shot_existing.mp4');
    fs.writeFileSync(existingPath, 'already-generated-video');
    let submitCount = 0;

    const videoRun = await runSeedanceVideo(
      [
        {
          shotId: 'shot_existing',
          preferredProvider: 'seedance',
          durationTargetSec: 4,
        },
      ],
      tempRoot,
      {
        providerClient: {
          async submit() {
            submitCount += 1;
            throw new Error('submit should not be called');
          },
        },
      }
    );

    assert.equal(submitCount, 0);
    assert.equal(videoRun.results[0].status, 'completed');
    assert.equal(videoRun.results[0].videoPath, existingPath);
    assert.equal(videoRun.results[0].reusedFromDisk, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runSeedanceVideo stops submitting remaining seedance shots after quota error', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-seedance-guard-'));
  const submitCalls = [];

  try {
    const videoRun = await runSeedanceVideo(
      [
        {
          shotId: 'shot_quota',
          preferredProvider: 'seedance',
          durationTargetSec: 4,
        },
        {
          shotId: 'shot_should_not_submit',
          preferredProvider: 'seedance',
          durationTargetSec: 4,
        },
      ],
      tempRoot,
      {
        generateVideoClip: async (shotPackage) => {
          submitCalls.push(shotPackage.shotId);
          const error = new Error('insufficient_quota');
          error.code = 'ERR_BAD_REQUEST';
          error.status = 402;
          error.category = 'provider_generation_failed';
          error.details = { reason: 'insufficient_quota' };
          throw error;
        },
      }
    );

    assert.deepEqual(submitCalls, ['shot_quota']);
    assert.equal(videoRun.results[0].status, 'failed');
    assert.equal(videoRun.results[0].errorStatus, 402);
    assert.equal(videoRun.results[1].status, 'skipped');
    assert.equal(videoRun.results[1].reason, 'paid_video_guard_stopped_after_high_risk_error');
    assert.equal(videoRun.results[1].blockedByShotId, 'shot_quota');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
