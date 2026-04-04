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
        { shotId: 'shot_pass', status: 'completed', videoPath: validPath, targetDurationSec: 4 },
        { shotId: 'shot_empty', status: 'completed', videoPath: emptyPath, targetDurationSec: 4 },
        { shotId: 'shot_failed', status: 'failed', videoPath: null, targetDurationSec: 4, failureCategory: 'provider_timeout' },
      ],
      {
        probeVideo: async (videoPath) => ({ durationSec: videoPath === validPath ? 4.1 : 0 }),
      }
    );

    assert.equal(report.status, 'warn');
    assert.equal(report.passedCount, 1);
    assert.equal(report.fallbackCount, 2);
    assert.deepEqual(report.fallbackShots, ['shot_empty', 'shot_failed']);
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
        { shotId: 'shot_bad_probe', status: 'completed', videoPath: badProbePath, targetDurationSec: 4 },
        { shotId: 'shot_bad_duration', status: 'completed', videoPath: badDurationPath, targetDurationSec: 4 },
      ],
      {
        probeVideo: async (videoPath) => {
          if (videoPath === badProbePath) {
            throw new Error('ffprobe parse failed');
          }
          return { durationSec: 20 };
        },
      }
    );

    assert.equal(entries[0].reason, 'ffprobe_failed');
    assert.equal(entries[0].canUseVideo, false);
    assert.equal(entries[1].reason, 'duration_out_of_range');
    assert.equal(entries[1].fallbackToImage, true);
  });
});
