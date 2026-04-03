import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { runLipsync, __testables } from '../src/agents/lipsyncAgent.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-lipsync-agent-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('shouldApplyLipsync matches close-up rules from shot metadata', () => {
  assert.equal(__testables.shouldApplyLipsync({ dialogue: '你好', visualSpeechRequired: true }), true);
  assert.equal(__testables.shouldApplyLipsync({ dialogue: '你好', isCloseUp: true }), true);
  assert.equal(__testables.shouldApplyLipsync({ dialogue: '你好', camera_type: '特写' }), true);
  assert.equal(__testables.shouldApplyLipsync({ dialogue: '你好', camera_type: '全景' }), false);
  assert.equal(__testables.shouldApplyLipsync({ dialogue: '' }), false);
});

test('runLipsync only generates clips for triggered shots and writes artifacts', async () => {
  await withTempRoot(async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_123',
      projectName: '咖啡馆相遇',
      scriptId: 'script_001',
      scriptTitle: '第一卷',
      episodeId: 'episode_001',
      episodeTitle: '试播集',
      episodeNo: 1,
      runJobId: 'run_lipsync_artifacts',
      startedAt: '2026-04-03T09:00:00.000Z',
    });

    const imagePath = path.join(tempRoot, 'shot_001.png');
    const audioPath = path.join(tempRoot, 'shot_001.mp3');
    const clipPath = path.join(tempRoot, 'shot_001-lipsync.mp4');
    fs.writeFileSync(imagePath, 'fake-image');
    fs.writeFileSync(audioPath, 'fake-audio');
    fs.writeFileSync(clipPath, 'fake-video');

    const generatedCalls = [];
    const result = await runLipsync(
      [
        { id: 'shot_001', dialogue: '你好', camera_type: '特写', durationSec: 3 },
        { id: 'shot_002', dialogue: '远景旁白', camera_type: '全景', durationSec: 3 },
      ],
      [
        { shotId: 'shot_001', imagePath, success: true },
        { shotId: 'shot_002', imagePath, success: true },
      ],
      [
        { shotId: 'shot_001', audioPath },
        { shotId: 'shot_002', audioPath },
      ],
      {
        artifactContext: ctx.agents.lipsyncAgent,
        generateLipsyncClip: async (shot) => {
          generatedCalls.push(shot.id);
          return { videoPath: clipPath, durationSec: 3 };
        },
      }
    );

    assert.deepEqual(generatedCalls, ['shot_001']);
    assert.deepEqual(result.clips, [
      {
        shotId: 'shot_001',
        triggered: true,
        status: 'completed',
        reason: null,
        provider: null,
        attemptedProviders: [],
        fallbackApplied: false,
        fallbackFrom: null,
        imagePath,
        audioPath,
        videoPath: clipPath,
        durationSec: 3,
        timingOffsetMs: null,
        evaluator: null,
        downgradeApplied: false,
        downgradeReason: null,
        shotScale: 'close_up',
        triggerReasons: ['close_up'],
        manualReviewRequired: true,
        qaStatus: 'warn',
        qaWarnings: ['manual_review_required_without_evaluator'],
        qaBlockers: [],
      },
    ]);

    const report = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.lipsyncAgent.metricsDir, 'lipsync-report.json'), 'utf-8')
    );
    assert.equal(report.triggeredCount, 1);
    assert.equal(report.generatedCount, 1);
    assert.equal(report.failedCount, 0);
    assert.equal(report.status, 'warn');
    assert.equal(report.fallbackCount, 0);
    assert.deepEqual(report.fallbackShots, []);
    assert.deepEqual(report.manualReviewShots, ['shot_001']);

    const manifest = JSON.parse(fs.readFileSync(ctx.agents.lipsyncAgent.manifestPath, 'utf-8'));
    assert.equal(manifest.status, 'warn');
    assert.equal(manifest.triggeredCount, 1);
    assert.equal(manifest.generatedCount, 1);
    assert.equal(manifest.failedCount, 0);
    assert.equal(manifest.skippedCount, 1);
    assert.equal(manifest.downgradedCount, 0);
    assert.equal(manifest.fallbackCount, 0);
    assert.deepEqual(manifest.fallbackShots, []);
    assert.equal(manifest.manualReviewCount, 1);
    assert.deepEqual(manifest.manualReviewShots, ['shot_001']);

    const index = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.lipsyncAgent.outputsDir, 'lipsync.index.json'), 'utf-8')
    );
    assert.equal(index.length, 2);
    assert.equal(index[1].status, 'skipped');
    assert.equal(index[1].qaStatus, 'pass');
  });
});

test('runLipsync records per-shot error evidence when provider fails', async () => {
  await withTempRoot(async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_123',
      projectName: '咖啡馆相遇',
      scriptId: 'script_001',
      scriptTitle: '第一卷',
      episodeId: 'episode_001',
      episodeTitle: '试播集',
      episodeNo: 1,
      runJobId: 'run_lipsync_failures',
      startedAt: '2026-04-03T09:10:00.000Z',
    });

    const imagePath = path.join(tempRoot, 'shot_001.png');
    const audioPath = path.join(tempRoot, 'shot_001.mp3');
    fs.writeFileSync(imagePath, 'fake-image');
    fs.writeFileSync(audioPath, 'fake-audio');

    const result = await runLipsync(
      [{ id: 'shot_001', dialogue: '你好', visualSpeechRequired: true }],
      [{ shotId: 'shot_001', imagePath, success: true }],
      [{ shotId: 'shot_001', audioPath }],
      {
        artifactContext: ctx.agents.lipsyncAgent,
        generateLipsyncClip: async () => {
          throw new Error('provider unavailable');
        },
      }
    );

    assert.equal(result.report.failedCount, 1);
    assert.equal(result.report.status, 'block');
    const errorFile = path.join(ctx.agents.lipsyncAgent.errorsDir, 'shot_001-lipsync-error.json');
    const errorPayload = JSON.parse(fs.readFileSync(errorFile, 'utf-8'));
    assert.equal(errorPayload.error, 'provider unavailable');
    assert.equal(errorPayload.qaStatus, 'block');
    assert.equal(errorPayload.downgradeApplied, true);
  });
});

test('runLipsync preserves structured provider failure categories for downgrade reporting', async () => {
  const result = await runLipsync(
    [{ id: 'shot_timeout', dialogue: '你好', camera_type: '中景' }],
    [{ shotId: 'shot_timeout', imagePath: 'images/shot_timeout.png', success: true }],
    [{ shotId: 'shot_timeout', audioPath: 'audio/shot_timeout.mp3' }],
    {
      generateLipsyncClip: async () => {
        const error = new Error('provider timeout');
        error.provider = 'funcineforge';
        error.code = 'FUNCINEFORGE_TIMEOUT';
        error.category = 'timeout';
        throw error;
      },
    }
  );

  assert.equal(result.report.failedCount, 1);
  assert.equal(result.results[0].reason, 'timeout');
  assert.equal(result.results[0].downgradeReason, 'timeout');
  assert.equal(result.results[0].provider, 'funcineforge');
  assert.equal(result.results[0].errorCode, 'FUNCINEFORGE_TIMEOUT');
});

test('runLipsync records fallback provider usage in result entries', async () => {
  await withTempRoot(async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_123',
      projectName: '咖啡馆相遇',
      scriptId: 'script_001',
      scriptTitle: '第一卷',
      episodeId: 'episode_001',
      episodeTitle: '试播集',
      episodeNo: 1,
      runJobId: 'run_lipsync_fallback_manifest',
      startedAt: '2026-04-03T09:20:00.000Z',
    });

    const result = await runLipsync(
      [{ id: 'shot_fallback', dialogue: '你好', camera_type: '中景' }],
      [{ shotId: 'shot_fallback', imagePath: 'images/shot_fallback.png', success: true }],
      [{ shotId: 'shot_fallback', audioPath: 'audio/shot_fallback.mp3' }],
      {
        artifactContext: ctx.agents.lipsyncAgent,
        generateLipsyncClip: async () => ({
          provider: 'mock',
          videoPath: 'tmp/shot_fallback.mp4',
          attemptedProviders: ['funcineforge', 'mock'],
          fallbackApplied: true,
          fallbackFrom: 'funcineforge',
        }),
      }
    );

    assert.equal(result.results[0].provider, 'mock');
    assert.deepEqual(result.results[0].attemptedProviders, ['funcineforge', 'mock']);
    assert.equal(result.results[0].fallbackApplied, true);
    assert.equal(result.results[0].fallbackFrom, 'funcineforge');
    assert.equal(result.report.fallbackCount, 1);
    assert.deepEqual(result.report.fallbackShots, ['shot_fallback']);

    const manifest = JSON.parse(fs.readFileSync(ctx.agents.lipsyncAgent.manifestPath, 'utf-8'));
    assert.equal(manifest.fallbackCount, 1);
    assert.deepEqual(manifest.fallbackShots, ['shot_fallback']);
  });
});

test('runLipsync blocks close-up shots when timing offset exceeds threshold', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot_001.png');
    const audioPath = path.join(tempRoot, 'shot_001.mp3');
    const clipPath = path.join(tempRoot, 'shot_001-lipsync.mp4');
    fs.writeFileSync(imagePath, 'fake-image');
    fs.writeFileSync(audioPath, 'fake-audio');
    fs.writeFileSync(clipPath, 'fake-video');

    const result = await runLipsync(
      [{ id: 'shot_001', dialogue: '你好', camera_type: '特写' }],
      [{ shotId: 'shot_001', imagePath, success: true }],
      [{ shotId: 'shot_001', audioPath }],
      {
        generateLipsyncClip: async () => ({
          videoPath: clipPath,
          durationSec: 3,
          timingOffsetMs: 95,
          evaluator: 'timing-offset',
        }),
      }
    );

    assert.equal(result.report.status, 'block');
    assert.equal(result.results[0].qaStatus, 'block');
    assert.deepEqual(result.results[0].qaBlockers, ['timing_offset_exceeded_60ms']);
  });
});
