import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ACTION_SEQUENCE_PACKAGE_FIELDS } from '../src/utils/actionSequenceProtocol.js';
import { __testables, routeActionSequencePackages } from '../src/agents/actionSequenceRouter.js';

test('buildActionSequencePackages assembles a complete actionSequencePackage', () => {
  const [packageEntry] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_001',
        shotIds: ['shot_001', 'shot_002'],
        durationTargetSec: 8,
        sequenceGoal: '让连续动作保持稳定推进',
        cameraFlowIntent: 'push_in_then_follow',
        motionContinuityTargets: ['hand_position', 'weapon_path'],
        subjectContinuityTargets: ['char_a'],
        environmentContinuityTargets: ['lighting'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住上一镜的挥臂姿态',
        exitConstraint: '落到下一轮攻防节拍',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [{ shotId: 'shot_001', imagePath: '/tmp/shot_001.png', success: true }],
      videoResults: [
        {
          shotId: 'shot_001',
          videoPath: '/tmp/shot_001.mp4',
          status: 'completed',
          finalDecision: 'pass',
        },
      ],
      bridgeClipResults: [],
      performancePlan: [
        {
          shotId: 'shot_001',
          audioBeatHints: ['beat_1'],
        },
      ],
    }
  );

  assert.deepEqual(Object.keys(packageEntry), ACTION_SEQUENCE_PACKAGE_FIELDS);
  assert.equal(packageEntry.sequenceId, 'seq_001');
  assert.deepEqual(packageEntry.shotIds, ['shot_001', 'shot_002']);
  assert.deepEqual(packageEntry.audioBeatHints, ['beat_1']);
  assert.equal(packageEntry.preferredProvider, 'seedance');
});

test('buildActionSequencePackages prefers QA-passed videoResults over bridgeClipResults and imageResults', () => {
  const [packageEntry] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_priority',
        shotIds: ['shot_010', 'shot_011'],
        durationTargetSec: 6,
        sequenceGoal: '保持连续动作节奏',
        cameraFlowIntent: 'continuous_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['char_a'],
        environmentContinuityTargets: ['lighting'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住上一镜的动作惯性',
        exitConstraint: '落到下一镜的动作落点',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_010', imagePath: '/tmp/shot_010.png', success: true },
        { shotId: 'shot_011', imagePath: '/tmp/shot_011.png', success: true },
      ],
      videoResults: [
        {
          shotId: 'shot_010',
          videoPath: '/tmp/shot_010.mp4',
          status: 'completed',
          finalDecision: 'pass',
        },
      ],
      bridgeClipResults: [
        {
          sequenceId: 'seq_priority',
          bridgeId: 'bridge_seq_priority',
          videoPath: '/tmp/bridge_seq_priority.mp4',
          status: 'completed',
          finalDecision: 'pass',
        },
      ],
      performancePlan: [],
    }
  );

  assert.equal(packageEntry.referenceVideos.length > 0, true);
  assert.deepEqual(packageEntry.referenceVideos.map((entry) => entry.path), ['/tmp/shot_010.mp4']);
  assert.deepEqual(packageEntry.bridgeReferences, []);
  assert.deepEqual(packageEntry.referenceImages, []);
});

test('buildActionSequencePackages falls back to QA-passed bridgeClipResults before imageResults', () => {
  const [packageEntry] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_bridge',
        shotIds: ['shot_020', 'shot_021'],
        durationTargetSec: 6,
        sequenceGoal: '保持连续动作节奏',
        cameraFlowIntent: 'continuous_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['char_b'],
        environmentContinuityTargets: ['lighting'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住上一镜的动作惯性',
        exitConstraint: '落到下一镜的动作落点',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_020', imagePath: '/tmp/shot_020.png', success: true },
        { shotId: 'shot_021', imagePath: '/tmp/shot_021.png', success: true },
      ],
      videoResults: [
        {
          shotId: 'shot_020',
          videoPath: '/tmp/shot_020.mp4',
          status: 'failed',
          finalDecision: 'fallback_to_direct_cut',
        },
      ],
      bridgeClipResults: [
        {
          sequenceId: 'seq_bridge',
          bridgeId: 'bridge_seq_bridge',
          coveredShotIds: ['shot_020', 'shot_021'],
          videoPath: '/tmp/bridge_seq_bridge.mp4',
          status: 'completed',
          finalDecision: 'pass',
        },
      ],
      performancePlan: [],
    }
  );

  assert.deepEqual(packageEntry.referenceVideos, []);
  assert.equal(packageEntry.bridgeReferences.length > 0, true);
  assert.deepEqual(packageEntry.bridgeReferences.map((entry) => entry.path), ['/tmp/bridge_seq_bridge.mp4']);
  assert.deepEqual(packageEntry.referenceImages, []);
});

test('buildActionSequencePackages does not elevate a bridge that only matches sequenceId or partial coverage', () => {
  const [packageEntry] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_partial_bridge',
        shotIds: ['shot_025', 'shot_026'],
        durationTargetSec: 6,
        sequenceGoal: '保持连续动作节奏',
        cameraFlowIntent: 'continuous_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['char_b'],
        environmentContinuityTargets: ['lighting'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住上一镜的动作惯性',
        exitConstraint: '落到下一镜的动作落点',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_025', imagePath: '/tmp/shot_025.png', success: true },
        { shotId: 'shot_026', imagePath: '/tmp/shot_026.png', success: true },
      ],
      videoResults: [],
      bridgeClipResults: [
        {
          sequenceId: 'seq_partial_bridge',
          bridgeId: 'bridge_seq_partial_bridge',
          coveredShotIds: ['shot_025'],
          videoPath: '/tmp/bridge_seq_partial_bridge.mp4',
          finalDecision: 'pass',
        },
      ],
      performancePlan: [],
    }
  );

  assert.deepEqual(packageEntry.bridgeReferences, []);
  assert.deepEqual(packageEntry.referenceImages.map((entry) => entry.path), [
    '/tmp/shot_025.png',
    '/tmp/shot_026.png',
  ]);
});

test('buildActionSequencePackages falls back to imageResults when QA-passed video and bridge references are missing', () => {
  const [packageEntry] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_image',
        shotIds: ['shot_030', 'shot_031'],
        durationTargetSec: 6,
        sequenceGoal: '保持连续动作节奏',
        cameraFlowIntent: 'continuous_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['char_c'],
        environmentContinuityTargets: ['lighting'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住上一镜的动作惯性',
        exitConstraint: '落到下一镜的动作落点',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_030', imagePath: '/tmp/shot_030.png', success: true },
        { shotId: 'shot_031', imagePath: '/tmp/shot_031.png', success: true },
      ],
      videoResults: [],
      bridgeClipResults: [],
      performancePlan: [],
    }
  );

  assert.deepEqual(packageEntry.referenceVideos, []);
  assert.deepEqual(packageEntry.bridgeReferences, []);
  assert.deepEqual(packageEntry.referenceImages.map((entry) => entry.path), [
    '/tmp/shot_030.png',
    '/tmp/shot_031.png',
  ]);
});

test('buildActionSequencePackages defaults provider to seedance when plan entry omits preferredProvider', () => {
  const [packageEntry] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_default_provider',
        shotIds: ['shot_032', 'shot_033'],
        durationTargetSec: 6,
        sequenceGoal: '保持连续动作节奏',
        cameraFlowIntent: 'continuous_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['char_c'],
        environmentContinuityTargets: ['lighting'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住上一镜的动作惯性',
        exitConstraint: '落到下一镜的动作落点',
        generationMode: 'standalone_sequence',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_032', imagePath: '/tmp/shot_032.png', success: true },
        { shotId: 'shot_033', imagePath: '/tmp/shot_033.png', success: true },
      ],
      videoResults: [],
      bridgeClipResults: [],
      performancePlan: [],
    }
  );

  assert.equal(packageEntry.preferredProvider, 'seedance');
});

test('buildActionSequencePackages picks the best duplicate video and image candidate by explicit priority', () => {
  const [packageEntry] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_duplicates',
        shotIds: ['shot_060', 'shot_061'],
        durationTargetSec: 6,
        sequenceGoal: '保持连续动作节奏',
        cameraFlowIntent: 'continuous_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['char_f'],
        environmentContinuityTargets: ['lighting'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住上一镜的动作惯性',
        exitConstraint: '落到下一镜的动作落点',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_060', imagePath: '/tmp/shot_060_best.png', success: true },
        { shotId: 'shot_060', imagePath: '/tmp/shot_060_worse.png', success: false },
        { shotId: 'shot_061', imagePath: '/tmp/shot_061_best.png', success: true },
        { shotId: 'shot_061', imagePath: '/tmp/shot_061_worse.png', success: false },
      ],
      videoResults: [
        { shotId: 'shot_060', videoPath: '/tmp/shot_060_best.mp4', canUseVideo: true, status: 'completed' },
        { shotId: 'shot_060', videoPath: '/tmp/shot_060_worse.mp4', finalDecision: 'fail', status: 'completed' },
        { shotId: 'shot_061', videoPath: '/tmp/shot_061_best.mp4', finalDecision: 'pass', status: 'completed' },
        { shotId: 'shot_061', videoPath: '/tmp/shot_061_worse.mp4', finalDecision: 'fail', status: 'completed' },
      ],
      bridgeClipResults: [],
      performancePlan: [],
    }
  );

  assert.deepEqual(packageEntry.referenceVideos.map((entry) => entry.path), [
    '/tmp/shot_060_best.mp4',
    '/tmp/shot_061_best.mp4',
  ]);
  assert.deepEqual(packageEntry.referenceImages, []);

  const imageOnlyPackage = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_image_duplicates',
        shotIds: ['shot_070'],
        durationTargetSec: 4,
        sequenceGoal: '保持连续动作节奏',
        cameraFlowIntent: 'continuous_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['char_g'],
        environmentContinuityTargets: ['lighting'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住上一镜的动作惯性',
        exitConstraint: '落到下一镜的动作落点',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_070', imagePath: '/tmp/shot_070_best.png', success: true },
        { shotId: 'shot_070', imagePath: '/tmp/shot_070_worse.png', success: false },
      ],
      videoResults: [],
      bridgeClipResults: [],
      performancePlan: [],
    }
  );

  assert.deepEqual(imageOnlyPackage[0].referenceImages.map((entry) => entry.path), ['/tmp/shot_070_best.png']);
});

test('buildActionSequencePackages marks insufficient references as skip instead of creating an invalid provider request', () => {
  const [packageEntry] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_skip',
        shotIds: ['shot_040', 'shot_041'],
        durationTargetSec: 6,
        sequenceGoal: '保持连续动作节奏',
        cameraFlowIntent: 'continuous_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['char_d'],
        environmentContinuityTargets: ['lighting'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住上一镜的动作惯性',
        exitConstraint: '落到下一镜的动作落点',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [],
      videoResults: [],
      bridgeClipResults: [],
      performancePlan: [],
    }
  );

  assert.equal(packageEntry.preferredProvider, 'skip');
  assert.deepEqual(packageEntry.fallbackProviders, []);
  assert.deepEqual(packageEntry.referenceVideos, []);
  assert.deepEqual(packageEntry.bridgeReferences, []);
  assert.deepEqual(packageEntry.referenceImages, []);
  assert.match(packageEntry.qaRules.join(' '), /skip|fallback/i);
});

test('routeActionSequencePackages writes artifacts, metrics, manifest and qa summary', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-action-sequence-router-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const artifactContext = {
    outputsDir: path.join(tempRoot, '1-outputs'),
    metricsDir: path.join(tempRoot, '2-metrics'),
    manifestPath: path.join(tempRoot, 'manifest.json'),
  };
  fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
  fs.mkdirSync(artifactContext.metricsDir, { recursive: true });

  const result = await routeActionSequencePackages(
    [
      {
        sequenceId: 'seq_artifact',
        shotIds: ['shot_050', 'shot_051'],
        durationTargetSec: 7.2,
        sequenceGoal: '保持连续动作节奏',
        cameraFlowIntent: 'continuous_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['char_e'],
        environmentContinuityTargets: ['lighting'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住上一镜的动作惯性',
        exitConstraint: '落到下一镜的动作落点',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_050', imagePath: '/tmp/shot_050.png', success: true },
        { shotId: 'shot_051', imagePath: '/tmp/shot_051.png', success: true },
      ],
      videoResults: [
        {
          shotId: 'shot_050',
          videoPath: '/tmp/shot_050.mp4',
          status: 'completed',
          finalDecision: 'pass',
        },
      ],
      bridgeClipResults: [],
      performancePlan: [
        {
          shotId: 'shot_050',
          audioBeatHints: ['beat_1', 'beat_2'],
        },
      ],
      artifactContext,
    }
  );

  assert.equal(result.length, 1);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'action-sequence-packages.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'action-sequence-routing-metrics.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'qa-summary.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'qa-summary.md')), true);

  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed');
  assert.deepEqual(manifest.outputFiles, ['action-sequence-packages.json', 'action-sequence-routing-metrics.json']);
});
