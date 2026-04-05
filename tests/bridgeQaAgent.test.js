import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, runBridgeQa } from '../src/agents/bridgeQaAgent.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-bridge-qa-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('runBridgeQa passes valid bridge clips with readable ffprobe and acceptable duration', async () => {
  await withTempRoot(async (tempRoot) => {
    const videoPath = path.join(tempRoot, 'bridge-ok.mp4');
    fs.writeFileSync(videoPath, 'bridge-video');

    const report = await runBridgeQa(
      [
        {
          bridgeId: 'bridge_ok',
          status: 'completed',
          provider: 'runway',
          model: 'gen4_turbo',
          videoPath,
          targetDurationSec: 1.8,
        },
      ],
      {
        probeVideo: async () => ({ durationSec: 1.9 }),
        evaluateContinuity: async () => ({
          continuityStatus: 'pass',
          transitionSmoothness: 'pass',
          identityDriftRisk: 'low',
          cameraAxisStatus: 'pass',
        }),
      }
    );

    assert.equal(report.status, 'pass');
    assert.equal(report.passedCount, 1);
    assert.equal(report.entries[0].finalDecision, 'pass');
  });
});

test('evaluateBridgeClips fails empty files bad probes and abnormal durations as direct-cut fallback', async () => {
  await withTempRoot(async (tempRoot) => {
    const emptyPath = path.join(tempRoot, 'empty.mp4');
    const badProbePath = path.join(tempRoot, 'bad.mp4');
    const badDurationPath = path.join(tempRoot, 'bad-duration.mp4');
    fs.writeFileSync(emptyPath, '');
    fs.writeFileSync(badProbePath, 'bridge-video');
    fs.writeFileSync(badDurationPath, 'bridge-video');

    const entries = await __testables.evaluateBridgeClips(
      [
        { bridgeId: 'bridge_empty', status: 'completed', videoPath: emptyPath, targetDurationSec: 1.8 },
        { bridgeId: 'bridge_probe', status: 'completed', videoPath: badProbePath, targetDurationSec: 1.8 },
        { bridgeId: 'bridge_duration', status: 'completed', videoPath: badDurationPath, targetDurationSec: 1.8 },
      ],
      {
        probeVideo: async (videoPath) => {
          if (videoPath === badProbePath) {
            throw new Error('ffprobe failed');
          }
          return { durationSec: 5.5 };
        },
      }
    );

    assert.equal(entries[0].finalDecision, 'fallback_to_direct_cut');
    assert.equal(entries[0].decisionReason, 'missing_or_empty_video_file');
    assert.equal(entries[1].decisionReason, 'ffprobe_failed');
    assert.equal(entries[2].decisionReason, 'duration_out_of_range');
  });
});

test('evaluateBridgeClips supports direct-cut fallback transition stub and manual review decisions', async () => {
  await withTempRoot(async (tempRoot) => {
    const directCutPath = path.join(tempRoot, 'direct-cut.mp4');
    const stubPath = path.join(tempRoot, 'stub.mp4');
    const manualPath = path.join(tempRoot, 'manual.mp4');
    fs.writeFileSync(directCutPath, 'bridge-video');
    fs.writeFileSync(stubPath, 'bridge-video');
    fs.writeFileSync(manualPath, 'bridge-video');

    const entries = await __testables.evaluateBridgeClips(
      [
        { bridgeId: 'bridge_direct_cut', status: 'completed', videoPath: directCutPath, targetDurationSec: 1.8 },
        { bridgeId: 'bridge_stub', status: 'completed', videoPath: stubPath, targetDurationSec: 1.8 },
        { bridgeId: 'bridge_manual', status: 'completed', videoPath: manualPath, targetDurationSec: 1.8 },
      ],
      {
        probeVideo: async () => ({ durationSec: 1.8 }),
        evaluateContinuity: async (result) => {
          if (result.bridgeId === 'bridge_direct_cut') {
            return {
              continuityStatus: 'fail',
              transitionSmoothness: 'fail',
              identityDriftRisk: 'high',
              cameraAxisStatus: 'fail',
            };
          }
          if (result.bridgeId === 'bridge_stub') {
            return {
              continuityStatus: 'warn',
              transitionSmoothness: 'warn',
              identityDriftRisk: 'low',
              cameraAxisStatus: 'pass',
            };
          }
          return {
            continuityStatus: 'warn',
            transitionSmoothness: 'pass',
            identityDriftRisk: 'medium',
            cameraAxisStatus: 'warn',
          };
        },
      }
    );

    assert.equal(entries[0].finalDecision, 'fallback_to_direct_cut');
    assert.equal(entries[1].finalDecision, 'fallback_to_transition_stub');
    assert.equal(entries[2].finalDecision, 'manual_review');
  });
});

test('runBridgeQa writes bridge-qa-report artifacts', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-bridge-qa-artifact-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const artifactContext = {
    outputsDir: path.join(tempRoot, '1-outputs'),
    metricsDir: path.join(tempRoot, '2-metrics'),
    manifestPath: path.join(tempRoot, 'manifest.json'),
  };
  fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
  fs.mkdirSync(artifactContext.metricsDir, { recursive: true });

  const videoPath = path.join(tempRoot, 'bridge-artifact.mp4');
  fs.writeFileSync(videoPath, 'bridge-video');

  const report = await runBridgeQa(
    [
      {
        bridgeId: 'bridge_artifact',
        status: 'completed',
        provider: 'runway',
        model: 'gen4_turbo',
        videoPath,
        targetDurationSec: 1.8,
      },
    ],
    {
      artifactContext,
      probeVideo: async () => ({ durationSec: 1.8 }),
      evaluateContinuity: async () => ({
        continuityStatus: 'pass',
        transitionSmoothness: 'pass',
        identityDriftRisk: 'low',
        cameraAxisStatus: 'pass',
      }),
    }
  );

  assert.equal(report.passedCount, 1);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'bridge-qa-report.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'bridge-qa-metrics.json')), true);
  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed');
});
