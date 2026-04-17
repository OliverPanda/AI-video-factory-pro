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
        sequenceType: 'fight_exchange_sequence',
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
  assert.equal(packageEntry.referenceStrategy, 'video_first');
  assert.match(packageEntry.sequenceContextSummary, /sequence type: fight_exchange_sequence/i);
  assert.match(packageEntry.sequenceContextSummary, /shot coverage: shot_001 -> shot_002/i);
  assert.equal(packageEntry.providerRequestHints.referenceTier, 'video');
  assert.equal(packageEntry.providerRequestHints.referenceCount, 1);
  assert.equal(packageEntry.providerRequestHints.hasAudioBeatHints, true);
  assert.equal(packageEntry.providerRequestHints.generationMode, 'standalone_sequence');
  assert.match(packageEntry.sequenceContextSummary, /continuous attack-and-defense exchange/i);
  assert.match(packageEntry.sequenceContextSummary, /preserve weapon path/i);
  assert.match(packageEntry.sequenceContextSummary, /entry anchor: 接住上一镜的挥臂姿态/i);
  assert.match(packageEntry.sequenceContextSummary, /exit anchor: 落到下一轮攻防节拍/i);
  assert.match(packageEntry.sequenceContextSummary, /hard continuity rule:/i);
  assert.deepEqual(packageEntry.providerRequestHints.continuityTargets, ['hand_position', 'weapon_path', 'char_a', 'lighting']);
  assert.deepEqual(packageEntry.providerRequestHints.preserveElements, ['subject_identity']);
  assert.equal(packageEntry.providerRequestHints.entryConstraint, '接住上一镜的挥臂姿态');
  assert.equal(packageEntry.providerRequestHints.exitConstraint, '落到下一轮攻防节拍');
});

test('buildActionSequencePackages adds specialized sequence template hints by sequence type', () => {
  const [fightPackage, chasePackage, dialoguePackage, genericPackage] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_fight',
        shotIds: ['shot_f_1', 'shot_f_2'],
        sequenceType: 'fight_exchange_sequence',
        durationTargetSec: 6,
        sequenceGoal: '连续打斗',
        cameraFlowIntent: 'push_in_then_follow',
        motionContinuityTargets: ['weapon_path'],
        subjectContinuityTargets: ['fighter_a', 'fighter_b'],
        environmentContinuityTargets: ['courtyard'],
        mustPreserveElements: ['sword'],
        entryConstraint: '接住出刀姿态',
        exitConstraint: '落到下一轮格挡',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
      {
        sequenceId: 'seq_chase',
        shotIds: ['shot_c_1', 'shot_c_2'],
        sequenceType: 'chase_run_sequence',
        durationTargetSec: 6,
        sequenceGoal: '连续追逐',
        cameraFlowIntent: 'long_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['runner_a'],
        environmentContinuityTargets: ['street'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住起跑方向',
        exitConstraint: '落到下一步位',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
      {
        sequenceId: 'seq_dialogue',
        shotIds: ['shot_d_1', 'shot_d_2'],
        sequenceType: 'dialogue_move_sequence',
        durationTargetSec: 6,
        sequenceGoal: '边走边说推进压迫感',
        cameraFlowIntent: 'steady_push',
        motionContinuityTargets: ['walking_pace'],
        subjectContinuityTargets: ['speaker_a'],
        environmentContinuityTargets: ['corridor'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住对白步伐',
        exitConstraint: '落到停顿点',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
      {
        sequenceId: 'seq_generic',
        shotIds: ['shot_g_1', 'shot_g_2'],
        sequenceType: 'escape_transition_sequence',
        durationTargetSec: 6,
        sequenceGoal: '撤离',
        cameraFlowIntent: 'continuous_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['runner_b'],
        environmentContinuityTargets: ['hall'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住转身姿态',
        exitConstraint: '落到逃离出口',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_f_1', imagePath: '/tmp/shot_f_1.png', success: true },
        { shotId: 'shot_f_2', imagePath: '/tmp/shot_f_2.png', success: true },
        { shotId: 'shot_c_1', imagePath: '/tmp/shot_c_1.png', success: true },
        { shotId: 'shot_c_2', imagePath: '/tmp/shot_c_2.png', success: true },
        { shotId: 'shot_d_1', imagePath: '/tmp/shot_d_1.png', success: true },
        { shotId: 'shot_d_2', imagePath: '/tmp/shot_d_2.png', success: true },
        { shotId: 'shot_g_1', imagePath: '/tmp/shot_g_1.png', success: true },
        { shotId: 'shot_g_2', imagePath: '/tmp/shot_g_2.png', success: true },
      ],
      videoResults: [],
      bridgeClipResults: [],
      performancePlan: [],
    }
  );

  assert.match(fightPackage.sequenceContextSummary, /continuous attack-and-defense exchange/i);
  assert.match(chasePackage.sequenceContextSummary, /sustain forward chase momentum/i);
  assert.match(dialoguePackage.sequenceContextSummary, /sustain walking dialogue pressure/i);
  assert.doesNotMatch(genericPackage.sequenceContextSummary, /continuous attack-and-defense exchange/i);
  assert.doesNotMatch(genericPackage.sequenceContextSummary, /sustain forward chase momentum/i);
});

test('buildActionSequencePackages tags sequence references with explicit Seedance-friendly roles', () => {
  const [packageEntry] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_roles',
        shotIds: ['shot_r_1', 'shot_r_2'],
        sequenceType: 'chase_run_sequence',
        durationTargetSec: 6,
        sequenceGoal: '连续追逐',
        cameraFlowIntent: 'long_follow',
        motionContinuityTargets: ['direction_of_travel'],
        subjectContinuityTargets: ['runner_a'],
        environmentContinuityTargets: ['street'],
        mustPreserveElements: ['subject_identity'],
        entryConstraint: '接住起跑方向',
        exitConstraint: '落到下一步位',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [
        { shotId: 'shot_r_1', imagePath: '/tmp/shot_r_1.png', success: true },
        { shotId: 'shot_r_2', imagePath: '/tmp/shot_r_2.png', success: true },
      ],
      videoResults: [
        {
          shotId: 'shot_r_1',
          videoPath: '/tmp/shot_r_1.mp4',
          status: 'completed',
          finalDecision: 'pass',
        },
      ],
      bridgeClipResults: [],
      performancePlan: [],
    }
  );

  assert.equal(packageEntry.referenceVideos[0].type, 'qa_passed_video');
  assert.equal(packageEntry.referenceVideos[0].role, 'motion_reference');
  assert.equal(packageEntry.referenceImages.length, 0);
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
  assert.equal(packageEntry.referenceStrategy, 'bridge_first');
  assert.equal(packageEntry.providerRequestHints.referenceTier, 'bridge');
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
  assert.equal(packageEntry.referenceStrategy, 'image_first');
  assert.equal(packageEntry.providerRequestHints.referenceTier, 'image');
  assert.equal(packageEntry.providerRequestHints.referenceCount, 2);
  assert.equal(packageEntry.skipReason, null);
});

test('buildActionSequencePackages defaults provider to seedance when plan entry omits preferredProvider', () => {
  const previousVideoProvider = process.env.VIDEO_PROVIDER;
  delete process.env.VIDEO_PROVIDER;

  try {
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
  } finally {
    if (previousVideoProvider == null) {
      delete process.env.VIDEO_PROVIDER;
    } else {
      process.env.VIDEO_PROVIDER = previousVideoProvider;
    }
  }
});

test('buildActionSequencePackages follows fallback_video env override and normalizes to sora2', () => {
  const previousVideoProvider = process.env.VIDEO_PROVIDER;
  process.env.VIDEO_PROVIDER = 'fallback_video';

  try {
    const [packageEntry] = __testables.buildActionSequencePackages(
      [
        {
          sequenceId: 'seq_env_provider',
          shotIds: ['shot_132', 'shot_133'],
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
          { shotId: 'shot_132', imagePath: '/tmp/shot_132.png', success: true },
          { shotId: 'shot_133', imagePath: '/tmp/shot_133.png', success: true },
        ],
        videoResults: [],
        bridgeClipResults: [],
        performancePlan: [],
      }
    );

    assert.equal(packageEntry.preferredProvider, 'sora2');
    assert.equal(packageEntry.providerRequestHints.preferredProvider, 'sora2');
  } finally {
    if (previousVideoProvider == null) {
      delete process.env.VIDEO_PROVIDER;
    } else {
      process.env.VIDEO_PROVIDER = previousVideoProvider;
    }
  }
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
  assert.equal(packageEntry.referenceStrategy, 'skip_generation');
  assert.equal(packageEntry.providerRequestHints.referenceTier, 'skip');
  assert.equal(packageEntry.providerRequestHints.referenceCount, 0);
  assert.equal(packageEntry.skipReason, 'no_valid_reference_material');
});

test('buildActionSequencePackages classifies skip reasons for missing or insufficient references', () => {
  const [missingImagePackage] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_missing_image',
        shotIds: ['shot_missing_img'],
        sequenceType: 'fight_exchange_sequence',
        durationTargetSec: 4,
        sequenceGoal: '连续动作',
        cameraFlowIntent: 'push_in',
        motionContinuityTargets: [],
        subjectContinuityTargets: [],
        environmentContinuityTargets: [],
        mustPreserveElements: [],
        entryConstraint: '',
        exitConstraint: '',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [{ shotId: 'other_shot', imagePath: '/tmp/other.png', success: true }],
      videoResults: [],
      bridgeClipResults: [],
      performancePlan: [],
    }
  );

  const [insufficientMixPackage] = __testables.buildActionSequencePackages(
    [
      {
        sequenceId: 'seq_insufficient_mix',
        shotIds: ['shot_mix_a', 'shot_mix_b'],
        sequenceType: 'chase_run_sequence',
        durationTargetSec: 5,
        sequenceGoal: '连续追逐',
        cameraFlowIntent: 'follow_run',
        motionContinuityTargets: [],
        subjectContinuityTargets: [],
        environmentContinuityTargets: [],
        mustPreserveElements: [],
        entryConstraint: '',
        exitConstraint: '',
        generationMode: 'standalone_sequence',
        preferredProvider: 'seedance',
        fallbackStrategy: 'fallback_to_shot_and_bridge',
      },
    ],
    {
      imageResults: [{ shotId: 'shot_mix_a', imagePath: '/tmp/shot_mix_a.png', success: true }],
      videoResults: [],
      bridgeClipResults: [],
      performancePlan: [],
    }
  );

  assert.equal(missingImagePackage.skipReason, 'missing_image_reference');
  assert.equal(insufficientMixPackage.skipReason, 'insufficient_reference_mix');
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
  const metrics = JSON.parse(fs.readFileSync(path.join(artifactContext.metricsDir, 'action-sequence-routing-metrics.json'), 'utf-8'));
  assert.deepEqual(metrics.skipReasonBreakdown, {});

  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed');
  assert.deepEqual(manifest.outputFiles, ['action-sequence-packages.json', 'action-sequence-routing-metrics.json']);
});
