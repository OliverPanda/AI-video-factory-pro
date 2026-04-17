import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, routeBridgeShots } from '../src/agents/bridgeShotRouter.js';

test('buildBridgeShotPackages assembles the minimum bridgeShotPackage fields', () => {
  const bridgePackages = __testables.buildBridgeShotPackages(
    [
      {
        bridgeId: 'bridge_shot_001_shot_002',
        fromShotId: 'shot_001',
        toShotId: 'shot_002',
        bridgeType: 'motion_carry',
        bridgeGoal: 'carry_action_across_cut',
        durationTargetSec: 1.8,
        continuityRisk: 'high',
        cameraTransitionIntent: 'follow_through_motion',
        subjectContinuityTargets: ['char_a'],
        environmentContinuityTargets: ['lighting'],
        mustPreserveElements: ['character:char_a', 'subject_identity'],
        bridgeGenerationMode: 'first_last_keyframe',
        preferredProvider: 'seedance',
        fallbackStrategy: 'direct_cut',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_001', imagePath: '/tmp/shot_001.png', success: true },
        { shotId: 'shot_002', imagePath: '/tmp/shot_002.png', success: true },
      ],
      videoResults: [
        { shotId: 'shot_001', videoPath: '/tmp/shot_001.mp4', provider: 'sora2' },
        { shotId: 'shot_002', videoPath: '/tmp/shot_002.mp4', provider: 'sora2' },
      ],
    }
  );

  assert.equal(bridgePackages.length, 1);
  assert.deepEqual(bridgePackages[0], {
    bridgeId: 'bridge_shot_001_shot_002',
    fromShotRef: { shotId: 'shot_001', videoPath: '/tmp/shot_001.mp4' },
    toShotRef: { shotId: 'shot_002', videoPath: '/tmp/shot_002.mp4' },
    fromReferenceImage: '/tmp/shot_001.png',
    toReferenceImage: '/tmp/shot_002.png',
    promptDirectives: [
      'transition brief: create a motion_carry bridge that carry_action_across_cut',
      'camera and timing: follow_through_motion, duration 1.8 seconds',
      'reference binding: image1 is the first frame keyframe from shot_001. image2 is the target last frame keyframe from shot_002',
      'continuity locks: char_a, lighting',
      'preserve elements: character:char_a, subject_identity',
    ],
    negativePromptDirectives: ['identity drift', 'flash frame', 'axis break'],
    durationTargetSec: 1.8,
    providerCapabilityRequirement: 'first_last_keyframe',
    firstLastFrameMode: 'required',
    preferredProvider: 'seedance',
    fallbackProviders: ['sora2', 'direct_cut'],
    qaRules: {
      mustProbeWithFfprobe: true,
      mustConnectFromShot: true,
      mustConnectToShot: true,
      canFallbackToDirectCut: true,
    },
  });
});

test('buildBridgeShotPackages emits Seedance-friendly bridge directives with explicit frame binding', () => {
  const [bridgePackage] = __testables.buildBridgeShotPackages(
    [
      {
        bridgeId: 'bridge_seedance_prompt',
        fromShotId: 'shot_101',
        toShotId: 'shot_102',
        bridgeType: 'motion_carry',
        bridgeGoal: 'carry the sword swing cleanly across the cut',
        durationTargetSec: 1.8,
        continuityRisk: 'high',
        cameraTransitionIntent: 'follow_through_motion',
        subjectContinuityTargets: ['char_a'],
        environmentContinuityTargets: ['courtyard_light'],
        mustPreserveElements: ['character:char_a', 'subject_identity', 'sword_path'],
        bridgeGenerationMode: 'first_last_keyframe',
        preferredProvider: 'seedance',
        fallbackStrategy: 'direct_cut',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_101', imagePath: '/tmp/shot_101.png', success: true },
        { shotId: 'shot_102', imagePath: '/tmp/shot_102.png', success: true },
      ],
      videoResults: [],
    }
  );

  assert.match(bridgePackage.promptDirectives.join(' | '), /transition brief:/i);
  assert.match(bridgePackage.promptDirectives.join(' | '), /reference binding:/i);
  assert.match(bridgePackage.promptDirectives.join(' | '), /image1 is the first frame/i);
  assert.match(bridgePackage.promptDirectives.join(' | '), /image2 is the target last frame/i);
  assert.match(bridgePackage.promptDirectives.join(' | '), /camera and timing:/i);
  assert.match(bridgePackage.promptDirectives.join(' | '), /continuity locks:/i);
});

test('buildBridgeShotPackages routes standard and constrained bridge tiers correctly', () => {
  const bridgePackages = __testables.buildBridgeShotPackages(
    [
      {
        bridgeId: 'bridge_basic',
        fromShotId: 'shot_011',
        toShotId: 'shot_012',
        bridgeType: 'emotional_transition',
        bridgeGoal: 'bridge_emotional_escalation',
        durationTargetSec: 1.8,
        continuityRisk: 'medium',
        cameraTransitionIntent: 'emotional_push_in',
        subjectContinuityTargets: ['char_b'],
        environmentContinuityTargets: ['lighting', 'mood_progression'],
        mustPreserveElements: ['character:char_b', 'subject_identity'],
        bridgeGenerationMode: 'image_to_video_bridge',
        preferredProvider: 'sora2',
        fallbackStrategy: 'direct_cut',
      },
      {
        bridgeId: 'bridge_constrained',
        fromShotId: 'shot_021',
        toShotId: 'shot_022',
        bridgeType: 'spatial_transition',
        bridgeGoal: 'bridge_spatial_relocation',
        durationTargetSec: 2.6,
        continuityRisk: 'high',
        cameraTransitionIntent: 'travel_between_spaces',
        subjectContinuityTargets: ['char_c'],
        environmentContinuityTargets: ['lighting', 'scene_geography'],
        mustPreserveElements: ['character:char_c', 'subject_identity'],
        bridgeGenerationMode: 'first_last_keyframe',
        preferredProvider: 'sora2',
        fallbackStrategy: 'direct_cut',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_011', imagePath: '/tmp/shot_011.png', success: true },
        { shotId: 'shot_012', imagePath: '/tmp/shot_012.png', success: true },
        { shotId: 'shot_021', imagePath: '/tmp/shot_021.png', success: true },
        { shotId: 'shot_022', imagePath: '/tmp/shot_022.png', success: true },
      ],
      videoResults: [],
    }
  );

  assert.equal(bridgePackages[0].providerCapabilityRequirement, 'image_to_video');
  assert.equal(bridgePackages[0].firstLastFrameMode, 'disabled');
  assert.equal(bridgePackages[1].providerCapabilityRequirement, 'first_last_keyframe');
  assert.equal(bridgePackages[1].firstLastFrameMode, 'required');
});

test('buildBridgeShotPackages falls back conservatively when reference images are missing', () => {
  const [bridgePackage] = __testables.buildBridgeShotPackages(
    [
      {
        bridgeId: 'bridge_missing_refs',
        fromShotId: 'shot_031',
        toShotId: 'shot_032',
        bridgeType: 'camera_reframe',
        bridgeGoal: 'smooth_reframe',
        durationTargetSec: 1.6,
        continuityRisk: 'high',
        cameraTransitionIntent: 'progressive_reframe',
        subjectContinuityTargets: ['char_d'],
        environmentContinuityTargets: ['lighting', 'camera_axis'],
        mustPreserveElements: ['character:char_d', 'subject_identity'],
        bridgeGenerationMode: 'first_last_keyframe',
        preferredProvider: 'sora2',
        fallbackStrategy: 'direct_cut',
      },
    ],
    {
      imageResults: [{ shotId: 'shot_031', imagePath: '/tmp/shot_031.png', success: true }],
      videoResults: [],
    }
  );

  assert.equal(bridgePackage.preferredProvider, 'fallback_direct_cut');
  assert.equal(bridgePackage.providerCapabilityRequirement, 'none');
  assert.equal(bridgePackage.fromReferenceImage, '/tmp/shot_031.png');
  assert.equal(bridgePackage.toReferenceImage, null);
  assert.deepEqual(bridgePackage.fallbackProviders, []);
});

test('routeBridgeShots writes bridge-shot-packages artifacts', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-bridge-router-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const artifactContext = {
    outputsDir: path.join(tempRoot, '1-outputs'),
    metricsDir: path.join(tempRoot, '2-metrics'),
    manifestPath: path.join(tempRoot, 'manifest.json'),
  };
  fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
  fs.mkdirSync(artifactContext.metricsDir, { recursive: true });

  const result = await routeBridgeShots(
    [
      {
        bridgeId: 'bridge_artifact',
        fromShotId: 'shot_041',
        toShotId: 'shot_042',
        bridgeType: 'motion_carry',
        bridgeGoal: 'carry_action_across_cut',
        durationTargetSec: 1.8,
        continuityRisk: 'high',
        cameraTransitionIntent: 'follow_through_motion',
        subjectContinuityTargets: ['char_e'],
        environmentContinuityTargets: ['lighting', 'motion_direction'],
        mustPreserveElements: ['character:char_e', 'subject_identity'],
        bridgeGenerationMode: 'first_last_keyframe',
        preferredProvider: 'sora2',
        fallbackStrategy: 'direct_cut',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_041', imagePath: '/tmp/shot_041.png', success: true },
        { shotId: 'shot_042', imagePath: '/tmp/shot_042.png', success: true },
      ],
      artifactContext,
    }
  );

  assert.equal(result.length, 1);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'bridge-shot-packages.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'bridge-routing-metrics.json')), true);
  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed');
});
