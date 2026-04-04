import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, runShotQa } from '../src/agents/shotQaAgent.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-shot-qa-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('runShotQa passes valid mp4-like results and records fallback for invalid ones', async () => {
  await withTempRoot(async (tempRoot) => {
    const validPath = path.join(tempRoot, 'valid.mp4');
    const emptyPath = path.join(tempRoot, 'empty.mp4');
    fs.writeFileSync(validPath, 'non-empty-video');
    fs.writeFileSync(emptyPath, '');

    const report = await runShotQa(
      [
        { shotId: 'shot_pass', status: 'completed', videoPath: validPath, targetDurationSec: 4, performanceTemplate: 'dialogue_closeup_react' },
        { shotId: 'shot_empty', status: 'completed', videoPath: emptyPath, targetDurationSec: 4, performanceTemplate: 'fight_impact_insert' },
        { shotId: 'shot_failed', status: 'failed', videoPath: null, targetDurationSec: 4, performanceTemplate: 'fight_impact_insert', failureCategory: 'provider_timeout' },
      ],
      {
        probeVideo: async (videoPath) => ({
          durationSec: videoPath === validPath ? 4.1 : 0,
          freezeDurationSec: 0,
          nearDuplicateRatio: 0.1,
          motionScore: 0.8,
        }),
      }
    );

    assert.equal(report.status, 'warn');
    assert.equal(report.engineeringPassedCount, 1);
    assert.equal(report.motionPassedCount, 1);
    assert.equal(report.fallbackCount, 2);
    assert.deepEqual(report.fallbackShots, ['shot_empty', 'shot_failed']);
    assert.equal(report.entries[0].engineeringStatus, 'pass');
    assert.equal(report.entries[0].motionStatus, 'pass');
    assert.equal(report.entries[0].finalDecision, 'pass');
  });
});

test('evaluateShotVideos fails when ffprobe cannot read file or duration is out of range', async () => {
  await withTempRoot(async (tempRoot) => {
    const badProbePath = path.join(tempRoot, 'bad.mp4');
    const badDurationPath = path.join(tempRoot, 'bad2.mp4');
    fs.writeFileSync(badProbePath, 'video');
    fs.writeFileSync(badDurationPath, 'video');

    const entries = await __testables.evaluateShotVideos(
      [
        { shotId: 'shot_bad_probe', status: 'completed', videoPath: badProbePath, targetDurationSec: 4, performanceTemplate: 'dialogue_closeup_react' },
        { shotId: 'shot_bad_duration', status: 'completed', videoPath: badDurationPath, targetDurationSec: 4, performanceTemplate: 'dialogue_closeup_react' },
      ],
      {
        probeVideo: async (videoPath) => {
          if (videoPath === badProbePath) {
            throw new Error('ffprobe parse failed');
          }
          return { durationSec: 20, freezeDurationSec: 0, nearDuplicateRatio: 0.1, motionScore: 0.8 };
        },
      }
    );

    assert.equal(entries[0].reason, 'ffprobe_failed');
    assert.equal(entries[0].canUseVideo, false);
    assert.equal(entries[1].reason, 'duration_out_of_range');
    assert.equal(entries[1].fallbackToImage, true);
  });
});

test('evaluateShotVideos marks near-static clips as motion_fail with explainable decision', async () => {
  await withTempRoot(async (tempRoot) => {
    const staticPath = path.join(tempRoot, 'static.mp4');
    fs.writeFileSync(staticPath, 'video');

    const [entry] = await __testables.evaluateShotVideos(
      [
        {
          shotId: 'shot_static',
          status: 'completed',
          videoPath: staticPath,
          targetDurationSec: 4,
          performanceTemplate: 'fight_impact_insert',
        },
      ],
      {
        probeVideo: async () => ({
          durationSec: 4,
          freezeDurationSec: 2.8,
          nearDuplicateRatio: 0.92,
          motionScore: 0.05,
        }),
      }
    );

    assert.equal(entry.engineeringStatus, 'pass');
    assert.equal(entry.motionStatus, 'fail');
    assert.equal(entry.finalDecision, 'fallback_to_image');
    assert.equal(entry.decisionReason, 'motion_below_threshold');
  });
});
