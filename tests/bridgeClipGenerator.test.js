import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, generateBridgeClips } from '../src/agents/bridgeClipGenerator.js';

test('generateBridgeClips produces the minimum bridgeClipResults structure for standard bridge clips', async () => {
  const run = await generateBridgeClips(
    [
      {
        bridgeId: 'bridge_standard',
        fromShotRef: { shotId: 'shot_001', videoPath: '/tmp/shot_001.mp4' },
        toShotRef: { shotId: 'shot_002', videoPath: '/tmp/shot_002.mp4' },
        fromReferenceImage: '/tmp/shot_001.png',
        toReferenceImage: '/tmp/shot_002.png',
        promptDirectives: ['bridge type: emotional_transition'],
        negativePromptDirectives: ['identity drift'],
        durationTargetSec: 1.8,
        providerCapabilityRequirement: 'image_to_video',
        firstLastFrameMode: 'disabled',
        preferredProvider: 'runway',
        fallbackProviders: ['direct_cut'],
      },
    ],
    '/tmp/bridge-video',
    {
      generateBridgeClip: async (_bridgePackage, outputPath) => ({
        provider: 'runway',
        model: 'gen4_turbo',
        videoPath: outputPath,
        taskId: 'task_bridge_standard',
        actualDurationSec: 1.8,
      }),
    }
  );

  assert.deepEqual(run.results[0], {
    bridgeId: 'bridge_standard',
    status: 'completed',
    provider: 'runway',
    model: 'gen4_turbo',
    videoPath: path.join('/tmp/bridge-video', 'bridge_standard.mp4'),
    targetDurationSec: 1.8,
    actualDurationSec: 1.8,
    failureCategory: null,
    error: null,
    taskId: 'task_bridge_standard',
    outputUrl: null,
  });
});

test('generateBridgeClips returns an explainable failure when constrained capability is unavailable', async () => {
  const run = await generateBridgeClips(
    [
      {
        bridgeId: 'bridge_keyframe',
        fromShotRef: { shotId: 'shot_011' },
        toShotRef: { shotId: 'shot_012' },
        fromReferenceImage: '/tmp/shot_011.png',
        toReferenceImage: '/tmp/shot_012.png',
        promptDirectives: ['bridge type: spatial_transition'],
        negativePromptDirectives: ['flash frame'],
        durationTargetSec: 2.6,
        providerCapabilityRequirement: 'first_last_keyframe',
        firstLastFrameMode: 'required',
        preferredProvider: 'runway',
        fallbackProviders: ['direct_cut'],
      },
    ],
    '/tmp/bridge-video',
    {
      supportedCapabilities: ['image_to_video'],
    }
  );

  assert.equal(run.results[0].status, 'failed');
  assert.equal(run.results[0].failureCategory, 'provider_invalid_request');
  assert.match(run.results[0].error, /first_last_keyframe/i);
});

test('generateBridgeClips skips conservative direct-cut fallback packages', async () => {
  const run = await generateBridgeClips(
    [
      {
        bridgeId: 'bridge_fallback',
        fromShotRef: { shotId: 'shot_021' },
        toShotRef: { shotId: 'shot_022' },
        fromReferenceImage: '/tmp/shot_021.png',
        toReferenceImage: null,
        promptDirectives: ['bridge type: camera_reframe'],
        negativePromptDirectives: ['axis break'],
        durationTargetSec: 1.6,
        providerCapabilityRequirement: 'none',
        firstLastFrameMode: 'disabled',
        preferredProvider: 'fallback_direct_cut',
        fallbackProviders: [],
      },
    ],
    '/tmp/bridge-video'
  );

  assert.equal(run.results[0].status, 'skipped');
  assert.equal(run.results[0].failureCategory, null);
  assert.equal(run.results[0].videoPath, null);
});

test('generateBridgeClips writes bridge clip artifacts and report', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-bridge-generator-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const artifactContext = {
    outputsDir: path.join(tempRoot, '1-outputs'),
    metricsDir: path.join(tempRoot, '2-metrics'),
    errorsDir: path.join(tempRoot, '3-errors'),
    manifestPath: path.join(tempRoot, 'manifest.json'),
  };
  fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
  fs.mkdirSync(artifactContext.metricsDir, { recursive: true });
  fs.mkdirSync(artifactContext.errorsDir, { recursive: true });

  const run = await generateBridgeClips(
    [
      {
        bridgeId: 'bridge_artifact',
        fromShotRef: { shotId: 'shot_031' },
        toShotRef: { shotId: 'shot_032' },
        fromReferenceImage: '/tmp/shot_031.png',
        toReferenceImage: '/tmp/shot_032.png',
        promptDirectives: ['bridge type: motion_carry'],
        negativePromptDirectives: ['identity drift'],
        durationTargetSec: 1.8,
        providerCapabilityRequirement: 'image_to_video',
        firstLastFrameMode: 'disabled',
        preferredProvider: 'runway',
        fallbackProviders: ['direct_cut'],
      },
    ],
    path.join(tempRoot, 'video'),
    {
      artifactContext,
      generateBridgeClip: async (_bridgePackage, outputPath) => ({
        provider: 'runway',
        model: 'gen4_turbo',
        videoPath: outputPath,
        actualDurationSec: 1.8,
      }),
    }
  );

  assert.equal(run.results.length, 1);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'bridge-clip-results.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'bridge-clip-generation-report.json')), true);
  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed');
});

test('buildBridgeClipReport summarizes completed failed and skipped bridge clips', () => {
  const report = __testables.buildBridgeClipReport([
    { bridgeId: 'a', status: 'completed', provider: 'runway', model: 'gen4_turbo' },
    { bridgeId: 'b', status: 'failed', provider: 'runway', model: 'gen4_turbo', failureCategory: 'provider_timeout' },
    { bridgeId: 'c', status: 'skipped', provider: 'fallback_direct_cut', model: null },
  ]);

  assert.equal(report.generatedCount, 1);
  assert.equal(report.failedCount, 1);
  assert.equal(report.skippedCount, 1);
  assert.deepEqual(report.providerBreakdown, { runway: 2, fallback_direct_cut: 1 });
});
