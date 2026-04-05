import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ACTION_SEQUENCE_PLAN_FIELDS,
  ACTION_SEQUENCE_PACKAGE_FIELDS,
  SEQUENCE_CLIP_RESULT_FIELDS,
  SEQUENCE_QA_REPORT_FIELDS,
  createActionSequencePlanEntry,
  createActionSequencePackage,
  createSequenceClipResult,
  createSequenceQaEntry,
  createSequenceQaReport,
  isActionSequencePlanEntry,
  isActionSequencePackage,
  isSequenceClipResult,
  isSequenceQaReport,
} from '../src/utils/actionSequenceProtocol.js';
import { __testables, planActionSequences } from '../src/agents/actionSequencePlanner.js';

test('createActionSequencePlanEntry fills the minimal Phase 4 protocol fields', () => {
  const entry = createActionSequencePlanEntry({
    sequenceId: 'seq_001',
    shotIds: ['shot_001', 'shot_002'],
    sequenceType: 'fight_exchange_sequence',
    sequenceGoal: '让角色在连续交手中保持动作连贯',
    durationTargetSec: 8,
    cameraFlowIntent: 'push_in_then_orbit',
    motionContinuityTargets: ['hand_position'],
    subjectContinuityTargets: ['character_a', 'character_b'],
    environmentContinuityTargets: ['corridor'],
    mustPreserveElements: ['weapon'],
    entryConstraint: '接住上一镜的挥臂姿态',
    exitConstraint: '落到对峙停顿',
    generationMode: 'provider-assisted',
    preferredProvider: 'runway',
    fallbackStrategy: 'fallback_to_shot_and_bridge',
  });

  assert.deepEqual(Object.keys(entry), ACTION_SEQUENCE_PLAN_FIELDS);
  assert.equal(isActionSequencePlanEntry(entry), true);
});

test('createActionSequencePackage and sequence result helpers preserve Phase 4 protocol fields', () => {
  const packageEntry = createActionSequencePackage({
    sequenceId: 'seq_001',
    shotIds: ['shot_001', 'shot_002'],
    durationTargetSec: 8,
    referenceImages: ['temp/image-001.png'],
    referenceVideos: ['temp/video-001.mp4'],
    bridgeReferences: ['temp/bridge-001.mp4'],
    referenceStrategy: 'video_first',
    visualGoal: '延续连续动作的视觉节奏',
    cameraSpec: 'handheld_orbit',
    continuitySpec: 'keep_weapon_and_face_direction',
    sequenceContextSummary: 'sequence type: fight_exchange_sequence | shot coverage: shot_001 -> shot_002',
    entryFrameHint: 'hero_entering_frame_left',
    exitFrameHint: 'hero_exiting_frame_right',
    audioBeatHints: ['impact_on_beat_3'],
    preferredProvider: 'runway',
    fallbackProviders: ['bridge'],
    providerRequestHints: {
      referenceTier: 'video',
      referenceCount: 1,
      hasAudioBeatHints: true,
    },
    qaRules: ['no_scene_jump'],
  });

  const clipResult = createSequenceClipResult({
    sequenceId: 'seq_001',
    status: 'completed',
    provider: 'runway',
    model: 'gen-4',
    videoPath: 'temp/sequence-001.mp4',
    coveredShotIds: ['shot_001', 'shot_002'],
    targetDurationSec: 8,
    actualDurationSec: 7.8,
    failureCategory: null,
    error: null,
  });

  const qaReport = createSequenceQaReport({
    status: 'pass',
    entries: [
      createSequenceQaEntry({
        sequenceId: 'seq_001',
        coveredShotIds: ['shot_001', 'shot_002'],
        engineCheck: 'pass',
        continuityCheck: 'pass',
        durationCheck: 'pass',
        entryExitCheck: 'pass',
        finalDecision: 'pass',
        fallbackAction: 'none',
        notes: 'ok',
      }),
    ],
    passedCount: 1,
    fallbackCount: 0,
    manualReviewCount: 0,
    warnings: [],
    blockers: [],
  });

  assert.deepEqual(Object.keys(packageEntry), ACTION_SEQUENCE_PACKAGE_FIELDS);
  assert.deepEqual(Object.keys(clipResult), SEQUENCE_CLIP_RESULT_FIELDS);
  assert.deepEqual(Object.keys(qaReport), SEQUENCE_QA_REPORT_FIELDS);
  assert.equal(isActionSequencePackage(packageEntry), true);
  assert.equal(isSequenceClipResult(clipResult), true);
  assert.equal(isSequenceQaReport(qaReport), true);
});

test('shape validators reject malformed array fields', () => {
  assert.equal(
    isActionSequencePlanEntry({
      sequenceId: 'seq_001',
      shotIds: 'shot_001',
      sequenceType: 'fight_exchange_sequence',
      sequenceGoal: 'goal',
      durationTargetSec: 8,
      cameraFlowIntent: 'push',
      motionContinuityTargets: [],
      subjectContinuityTargets: [],
      environmentContinuityTargets: [],
      mustPreserveElements: [],
      entryConstraint: 'entry',
      exitConstraint: 'exit',
      generationMode: 'provider-assisted',
      preferredProvider: 'runway',
      fallbackStrategy: 'fallback_to_shot_and_bridge',
    }),
    false
  );

  assert.equal(
    isActionSequencePackage({
      sequenceId: 'seq_001',
      shotIds: ['shot_001'],
      durationTargetSec: 8,
      referenceImages: 'temp/image-001.png',
      referenceVideos: [],
      bridgeReferences: [],
      referenceStrategy: 'video_first',
      visualGoal: 'goal',
      cameraSpec: 'spec',
      continuitySpec: 'spec',
      sequenceContextSummary: 'summary',
      entryFrameHint: 'entry',
      exitFrameHint: 'exit',
      audioBeatHints: [],
      preferredProvider: 'runway',
      fallbackProviders: [],
      providerRequestHints: {},
      qaRules: [],
    }),
    false
  );

  assert.equal(
    isSequenceClipResult({
      sequenceId: 'seq_001',
      status: 'completed',
      provider: 'runway',
      model: 'gen-4',
      videoPath: 'temp/sequence-001.mp4',
      coveredShotIds: 'shot_001',
      targetDurationSec: 8,
      actualDurationSec: 8,
      failureCategory: null,
      error: null,
    }),
    false
  );

  assert.equal(
    isSequenceQaReport({
      status: 'pass',
      entries: {},
      passedCount: 1,
      fallbackCount: 0,
      manualReviewCount: 0,
      warnings: [],
      blockers: [],
    }),
    false
  );
});

test('shape validators enforce scalar types while allowing default nulls', () => {
  assert.equal(
    isActionSequencePlanEntry(createActionSequencePlanEntry()),
    true
  );
  assert.equal(
    isActionSequencePackage(createActionSequencePackage()),
    true
  );
  assert.equal(
    isSequenceClipResult(createSequenceClipResult()),
    true
  );
  assert.equal(
    isSequenceQaReport(createSequenceQaReport()),
    true
  );

  assert.equal(
    isActionSequencePlanEntry({
      ...createActionSequencePlanEntry(),
      sequenceId: 123,
    }),
    false
  );
  assert.equal(
    isActionSequencePackage({
      ...createActionSequencePackage(),
      durationTargetSec: '8',
    }),
    false
  );
  assert.equal(
    isActionSequencePackage({
      ...createActionSequencePackage(),
      providerRequestHints: 'invalid',
    }),
    false
  );
  assert.equal(
    isSequenceClipResult({
      ...createSequenceClipResult(),
      videoPath: 42,
    }),
    false
  );
  assert.equal(
    isSequenceQaReport({
      ...createSequenceQaReport(),
      status: 1,
    }),
    false
  );
  assert.equal(
    isSequenceQaReport({
      ...createSequenceQaReport({
        entries: [
          createSequenceQaEntry({
            sequenceId: 'seq_001',
            coveredShotIds: ['shot_001'],
            engineCheck: 'pass',
            continuityCheck: 'pass',
            durationCheck: 'pass',
            entryExitCheck: 'pass',
            finalDecision: 0,
            fallbackAction: 'none',
            notes: 'ok',
          }),
        ],
      }),
    }),
    false
  );
});

test('buildActionSequencePlan detects all supported high-value continuous action sequence types', () => {
  const shots = [
    {
      id: 'shot_001',
      action: '两人拔刀交锋，迅速进入缠斗',
      scene: '回廊',
      dialogue: '',
      durationSec: 2.4,
      characters: [{ episodeCharacterId: 'char_a' }, { episodeCharacterId: 'char_b' }],
    },
    {
      id: 'shot_002',
      action: '格挡后反手回击，刀锋擦出火花',
      scene: '回廊',
      durationSec: 2.4,
      characters: [{ episodeCharacterId: 'char_a' }, { episodeCharacterId: 'char_b' }],
    },
    {
      id: 'shot_003',
      action: '追着对手冲出门外',
      scene: '门廊',
      durationSec: 2.2,
      characters: [{ episodeCharacterId: 'char_c' }],
    },
    {
      id: 'shot_004',
      action: '继续追赶，步伐加快',
      scene: '门廊',
      durationSec: 2.2,
      characters: [{ episodeCharacterId: 'char_c' }],
    },
    {
      id: 'shot_005',
      action: '他慌忙转身逃向侧门',
      scene: '侧殿',
      durationSec: 1.8,
      characters: [{ episodeCharacterId: 'char_d' }],
    },
    {
      id: 'shot_006',
      action: '侧身穿过屏风，快速脱离追击',
      scene: '侧殿',
      durationSec: 1.8,
      characters: [{ episodeCharacterId: 'char_d' }],
    },
    {
      id: 'shot_007',
      action: '拳头击中胸口，人物后仰',
      scene: '殿前',
      durationSec: 1.4,
      characters: [{ episodeCharacterId: 'char_e' }],
    },
    {
      id: 'shot_008',
      action: '余震未散，角色踉跄后退',
      scene: '殿前',
      durationSec: 1.4,
      characters: [{ episodeCharacterId: 'char_e' }],
    },
    {
      id: 'shot_009',
      action: '边走边说，朝门口靠近',
      scene: '长廊',
      dialogue: '你现在还来得及回头。',
      durationSec: 2.6,
      characters: [{ episodeCharacterId: 'char_f' }],
    },
    {
      id: 'shot_010',
      action: '继续向前移动，语气平静',
      scene: '长廊',
      dialogue: '不要再逼我。',
      durationSec: 2.6,
      characters: [{ episodeCharacterId: 'char_f' }],
    },
    {
      id: 'shot_011',
      action: '边走边说，走到门前停下',
      scene: '长廊',
      dialogue: '我们到此为止。',
      durationSec: 2.6,
      characters: [{ episodeCharacterId: 'char_f' }],
    },
    {
      id: 'shot_012',
      action: '空镜掠过殿门',
      scene: '殿外',
      durationSec: 3,
      characters: [],
    },
  ];

  const motionPlan = shots.map((shot) => ({
    shotId: shot.id,
    shotType:
      shot.id === 'shot_001' || shot.id === 'shot_002'
        ? 'fight_wide'
        : shot.id === 'shot_003' || shot.id === 'shot_004'
          ? 'chase_run'
        : shot.id === 'shot_007' || shot.id === 'shot_008'
          ? 'insert_impact'
        : shot.id === 'shot_009' || shot.id === 'shot_010' || shot.id === 'shot_011'
            ? 'dialogue_medium'
            : 'ambient_transition',
    durationTargetSec: shot.durationSec,
  }));
  const performancePlan = shots.map((shot) => ({
    shotId: shot.id,
    performanceTemplate:
      shot.id === 'shot_001' || shot.id === 'shot_002'
        ? 'fight_exchange_medium'
        : shot.id === 'shot_003' || shot.id === 'shot_004'
          ? 'chase_run_motion'
        : shot.id === 'shot_005' || shot.id === 'shot_006'
            ? 'ambient_transition_motion'
            : shot.id === 'shot_007' || shot.id === 'shot_008'
              ? 'fight_impact_insert'
              : shot.id === 'shot_009' || shot.id === 'shot_010' || shot.id === 'shot_011'
                ? 'dialogue_two_shot_tension'
                : 'ambient_transition_motion',
  }));

  const plan = __testables.buildActionSequencePlan(shots, {
    motionPlan,
    performancePlan,
    continuityFlaggedTransitions: [
      { previousShotId: 'shot_001', shotId: 'shot_002', continuityScore: 4, hardViolationCodes: ['camera_axis_flip'] },
      { previousShotId: 'shot_007', shotId: 'shot_008', continuityScore: 5, hardViolationCodes: [] },
    ],
    bridgeShotPlan: [
      { fromShotId: 'shot_005', toShotId: 'shot_006', bridgeType: 'spatial_transition' },
    ],
  });

  assert.deepEqual(
    plan.map((entry) => [entry.sequenceType, entry.shotIds]),
    [
      ['fight_exchange_sequence', ['shot_001', 'shot_002']],
      ['chase_run_sequence', ['shot_003', 'shot_004']],
      ['escape_transition_sequence', ['shot_005', 'shot_006']],
      ['impact_followthrough_sequence', ['shot_007', 'shot_008']],
      ['dialogue_move_sequence', ['shot_009', 'shot_010', 'shot_011']],
    ]
  );
});

test('buildActionSequencePlan does not default every shot into a sequence', () => {
  const plan = __testables.buildActionSequencePlan([
    {
      id: 'shot_101',
      action: '角色静静望向远处',
      scene: '庭院',
      durationSec: 3,
      characters: [{ episodeCharacterId: 'char_x' }],
    },
    {
      id: 'shot_102',
      action: '空镜掠过屋檐',
      scene: '庭院',
      durationSec: 3,
      characters: [],
    },
    {
      id: 'shot_103',
      action: '角色坐下沉默',
      scene: '庭院',
      durationSec: 3,
      characters: [{ episodeCharacterId: 'char_x' }],
    },
  ]);

  assert.deepEqual(plan, []);
});

test('buildActionSequencePlan defaults preferredProvider to seedance for generated sequence entries', () => {
  const plan = __testables.buildActionSequencePlan(
    [
      {
        id: 'shot_default_001',
        action: '两人拔刀交锋，迅速进入缠斗',
        scene: '回廊',
        durationSec: 2.4,
        characters: [{ episodeCharacterId: 'char_a' }, { episodeCharacterId: 'char_b' }],
      },
      {
        id: 'shot_default_002',
        action: '格挡后反手回击，刀锋擦出火花',
        scene: '回廊',
        durationSec: 2.4,
        characters: [{ episodeCharacterId: 'char_a' }, { episodeCharacterId: 'char_b' }],
      },
    ],
    {
      motionPlan: [
        { shotId: 'shot_default_001', shotType: 'fight_wide' },
        { shotId: 'shot_default_002', shotType: 'fight_wide' },
      ],
      performancePlan: [
        { shotId: 'shot_default_001', performanceTemplate: 'fight_exchange_medium' },
        { shotId: 'shot_default_002', performanceTemplate: 'fight_exchange_medium' },
      ],
    }
  );

  assert.equal(plan[0].preferredProvider, 'seedance');
});

test('buildActionSequencePlan fills entryConstraint exitConstraint durationTargetSec and fallbackStrategy by sequence type', () => {
  const plan = __testables.buildActionSequencePlan(
    [
      {
        id: 'shot_201',
        action: '两人拔刀交锋，迅速进入缠斗',
        scene: '回廊',
        durationSec: 2.4,
        characters: [{ episodeCharacterId: 'char_a' }, { episodeCharacterId: 'char_b' }],
      },
      {
        id: 'shot_202',
        action: '格挡后反手回击，刀锋擦出火花',
        scene: '回廊',
        durationSec: 2.4,
        characters: [{ episodeCharacterId: 'char_a' }, { episodeCharacterId: 'char_b' }],
      },
      {
      id: 'shot_203',
      action: '追着对手冲出门外',
      scene: '门廊',
      durationSec: 2.2,
      characters: [{ episodeCharacterId: 'char_c' }],
      },
      {
      id: 'shot_204',
      action: '继续追赶，步伐加快',
      scene: '门廊',
      durationSec: 2.2,
      characters: [{ episodeCharacterId: 'char_c' }],
      },
      {
        id: 'shot_205',
        action: '他慌忙转身逃向侧门',
        scene: '侧殿',
        durationSec: 1.8,
        characters: [{ episodeCharacterId: 'char_d' }],
      },
      {
        id: 'shot_206',
        action: '侧身穿过屏风，快速脱离追击',
        scene: '侧殿',
        durationSec: 1.8,
        characters: [{ episodeCharacterId: 'char_d' }],
      },
      {
        id: 'shot_207',
        action: '拳头击中胸口，人物后仰',
        scene: '殿前',
        durationSec: 1.4,
        characters: [{ episodeCharacterId: 'char_e' }],
      },
      {
        id: 'shot_208',
        action: '余震未散，角色踉跄后退',
        scene: '殿前',
        durationSec: 1.4,
        characters: [{ episodeCharacterId: 'char_e' }],
      },
      {
        id: 'shot_209',
        action: '边走边说，朝门口靠近',
        scene: '长廊',
        dialogue: '你现在还来得及回头。',
        durationSec: 2.6,
        characters: [{ episodeCharacterId: 'char_f' }],
      },
      {
        id: 'shot_210',
        action: '继续向前移动，语气平静',
        scene: '长廊',
        dialogue: '不要再逼我。',
        durationSec: 2.6,
        characters: [{ episodeCharacterId: 'char_f' }],
      },
      {
        id: 'shot_211',
        action: '边走边说，走到门前停下',
        scene: '长廊',
        dialogue: '我们到此为止。',
        durationSec: 2.6,
        characters: [{ episodeCharacterId: 'char_f' }],
      },
    ],
    {
      motionPlan: [
        { shotId: 'shot_201', shotType: 'fight_wide' },
        { shotId: 'shot_202', shotType: 'fight_wide' },
        { shotId: 'shot_203', shotType: 'chase_run' },
        { shotId: 'shot_204', shotType: 'chase_run' },
        { shotId: 'shot_205', shotType: 'ambient_transition' },
        { shotId: 'shot_206', shotType: 'ambient_transition' },
        { shotId: 'shot_207', shotType: 'insert_impact' },
        { shotId: 'shot_208', shotType: 'insert_impact' },
        { shotId: 'shot_209', shotType: 'dialogue_medium' },
        { shotId: 'shot_210', shotType: 'dialogue_medium' },
        { shotId: 'shot_211', shotType: 'dialogue_medium' },
      ],
      performancePlan: [
        { shotId: 'shot_201', performanceTemplate: 'fight_exchange_medium' },
        { shotId: 'shot_202', performanceTemplate: 'fight_exchange_medium' },
        { shotId: 'shot_203', performanceTemplate: 'chase_run_motion' },
        { shotId: 'shot_204', performanceTemplate: 'chase_run_motion' },
        { shotId: 'shot_205', performanceTemplate: 'ambient_transition_motion' },
        { shotId: 'shot_206', performanceTemplate: 'ambient_transition_motion' },
        { shotId: 'shot_207', performanceTemplate: 'fight_impact_insert' },
        { shotId: 'shot_208', performanceTemplate: 'fight_impact_insert' },
        { shotId: 'shot_209', performanceTemplate: 'dialogue_two_shot_tension' },
        { shotId: 'shot_210', performanceTemplate: 'dialogue_two_shot_tension' },
        { shotId: 'shot_211', performanceTemplate: 'dialogue_two_shot_tension' },
      ],
    }
  );

  const byType = Object.fromEntries(plan.map((entry) => [entry.sequenceType, entry]));

  assert.equal(byType.fight_exchange_sequence.entryConstraint, '接住上一镜的格挡或出刀终点');
  assert.equal(byType.fight_exchange_sequence.exitConstraint, '收束到下一轮攻防节拍');
  assert.equal(byType.fight_exchange_sequence.durationTargetSec, 4.8);
  assert.equal(byType.fight_exchange_sequence.fallbackStrategy, 'fallback_to_shot_and_bridge');

  assert.equal(byType.chase_run_sequence.entryConstraint, '接住上一镜的追赶起步方向');
  assert.equal(byType.chase_run_sequence.exitConstraint, '落到持续追逐的下一步位');
  assert.equal(byType.chase_run_sequence.durationTargetSec, 4.4);
  assert.equal(byType.chase_run_sequence.fallbackStrategy, 'fallback_to_shot_and_bridge');

  assert.equal(byType.escape_transition_sequence.entryConstraint, '接住上一镜的逃离或撤退姿态');
  assert.equal(byType.escape_transition_sequence.exitConstraint, '收束到脱离追击后的安全落点');
  assert.equal(byType.escape_transition_sequence.durationTargetSec, 3.6);
  assert.equal(byType.escape_transition_sequence.fallbackStrategy, 'fallback_to_shot_and_bridge');

  assert.equal(byType.impact_followthrough_sequence.entryConstraint, '接住上一镜的冲击瞬间');
  assert.equal(byType.impact_followthrough_sequence.exitConstraint, '落到余震和角色反应');
  assert.equal(byType.impact_followthrough_sequence.durationTargetSec, 2.8);
  assert.equal(byType.impact_followthrough_sequence.fallbackStrategy, 'fallback_to_shot_and_bridge');

  assert.equal(byType.dialogue_move_sequence.entryConstraint, '接住上一镜的对白与位移衔接');
  assert.equal(byType.dialogue_move_sequence.exitConstraint, '落到下一步位或停顿点');
  assert.equal(byType.dialogue_move_sequence.durationTargetSec, 7.8);
  assert.equal(byType.dialogue_move_sequence.fallbackStrategy, 'fallback_to_shot_and_bridge');
});

test('buildActionSequencePlan uses continuity and bridge context as a conservative signal', () => {
  const shots = [
    {
      id: 'shot_401',
      action: '两人拔刀交锋，迅速进入缠斗',
      scene: '回廊',
      dialogue: '',
      durationSec: 2.4,
      characters: [{ episodeCharacterId: 'char_g' }, { episodeCharacterId: 'char_h' }],
    },
    {
      id: 'shot_402',
      action: '格挡后反手回击，刀锋擦出火花',
      scene: '回廊',
      dialogue: '',
      durationSec: 2.4,
      characters: [{ episodeCharacterId: 'char_g' }, { episodeCharacterId: 'char_h' }],
    },
  ];

  const motionPlan = [
    { shotId: 'shot_401', shotType: 'dialogue_medium' },
    { shotId: 'shot_402', shotType: 'dialogue_medium' },
  ];
  const performancePlan = [
    { shotId: 'shot_401', performanceTemplate: 'fight_exchange_medium' },
    { shotId: 'shot_402', performanceTemplate: 'fight_exchange_medium' },
  ];

  const withContext = __testables.buildActionSequencePlan(shots, {
    motionPlan,
    performancePlan,
    continuityFlaggedTransitions: [
      { previousShotId: 'shot_401', shotId: 'shot_402', continuityScore: 6, hardViolationCodes: ['camera_axis_flip'] },
    ],
    bridgeShotPlan: [
      { fromShotId: 'shot_401', toShotId: 'shot_402', bridgeType: 'emotional_transition' },
    ],
  });

  assert.equal(withContext.length, 1);
  assert.equal(withContext[0].sequenceType, 'fight_exchange_sequence');
  assert.equal(withContext[0].generationMode, 'bridge_assisted');
  assert.equal(withContext[0].fallbackStrategy, 'fallback_to_shot_and_bridge');
});

test('buildActionSequencePlan keeps generationMode local to the matched sequence context', () => {
  const shots = [
    {
      id: 'shot_501',
      action: '两人拔刀交锋，迅速进入缠斗',
      scene: '回廊',
      durationSec: 1.3,
      characters: [{ episodeCharacterId: 'char_h' }, { episodeCharacterId: 'char_i' }],
    },
    {
      id: 'shot_502',
      action: '格挡后反手回击，刀锋擦出火花',
      scene: '回廊',
      durationSec: 1.7,
      characters: [{ episodeCharacterId: 'char_h' }, { episodeCharacterId: 'char_i' }],
    },
    {
      id: 'shot_503',
      action: '边走边说，朝门口靠近',
      scene: '长廊',
      dialogue: '你现在还来得及回头。',
      durationSec: 2.4,
      characters: [{ episodeCharacterId: 'char_j' }],
    },
    {
      id: 'shot_504',
      action: '边走边说，走到门前停下',
      scene: '长廊',
      dialogue: '我们到此为止。',
      durationSec: 2.4,
      characters: [{ episodeCharacterId: 'char_j' }],
    },
  ];

  const motionPlan = [
    { shotId: 'shot_501', shotType: 'fight_wide', durationTargetSec: 1.5 },
    { shotId: 'shot_502', shotType: 'fight_wide', durationTargetSec: 1.9 },
    { shotId: 'shot_503', shotType: 'dialogue_medium', durationTargetSec: 2.2 },
    { shotId: 'shot_504', shotType: 'dialogue_medium', durationTargetSec: 2.4 },
  ];
  const performancePlan = [
    { shotId: 'shot_501', performanceTemplate: 'fight_exchange_medium' },
    { shotId: 'shot_502', performanceTemplate: 'fight_exchange_medium' },
    { shotId: 'shot_503', performanceTemplate: 'dialogue_two_shot_tension' },
    { shotId: 'shot_504', performanceTemplate: 'dialogue_two_shot_tension' },
  ];

  const planWithoutContext = __testables.buildActionSequencePlan(shots, { motionPlan, performancePlan });
  assert.equal(planWithoutContext[0].generationMode, 'standalone_sequence');
  assert.equal(planWithoutContext[1].generationMode, 'standalone_sequence');

  const planWithContext = __testables.buildActionSequencePlan(shots, {
    motionPlan,
    performancePlan,
    continuityFlaggedTransitions: [
      { previousShotId: 'shot_501', shotId: 'shot_502', continuityScore: 5, hardViolationCodes: ['camera_axis_flip'] },
    ],
    bridgeShotPlan: [
      { fromShotId: 'shot_501', toShotId: 'shot_502', bridgeType: 'motion_carry' },
    ],
  });

  assert.equal(planWithContext[0].generationMode, 'bridge_assisted');
  assert.equal(planWithContext[1].generationMode, 'standalone_sequence');
});

test('buildActionSequencePlan bases durationTargetSec on shot and motionPlan durations instead of fixed constants', () => {
  const plan = __testables.buildActionSequencePlan(
    [
      {
        id: 'shot_601',
        action: '两人拔刀交锋，迅速进入缠斗',
        scene: '回廊',
        durationSec: 2.5,
        characters: [{ episodeCharacterId: 'char_k' }, { episodeCharacterId: 'char_l' }],
      },
      {
        id: 'shot_602',
        action: '格挡后反手回击，刀锋擦出火花',
        scene: '回廊',
        durationSec: 2.7,
        characters: [{ episodeCharacterId: 'char_k' }, { episodeCharacterId: 'char_l' }],
      },
    ],
    {
      motionPlan: [
        { shotId: 'shot_601', shotType: 'fight_wide', durationTargetSec: 1.5 },
        { shotId: 'shot_602', shotType: 'fight_wide', durationTargetSec: 1.9 },
      ],
      performancePlan: [
        { shotId: 'shot_601', performanceTemplate: 'fight_exchange_medium' },
        { shotId: 'shot_602', performanceTemplate: 'fight_exchange_medium' },
      ],
    }
  );

  assert.equal(plan[0].durationTargetSec, 5.2);
  assert.equal(plan[0].generationMode, 'standalone_sequence');

  const motionBasedPlan = __testables.buildActionSequencePlan(
    [
      {
        id: 'shot_603',
        action: '边走边说，朝门口靠近',
        scene: '长廊',
        dialogue: '你现在还来得及回头。',
        characters: [{ episodeCharacterId: 'char_m' }],
      },
      {
        id: 'shot_604',
        action: '继续向前移动，语气平静',
        scene: '长廊',
        dialogue: '不要再逼我。',
        characters: [{ episodeCharacterId: 'char_m' }],
      },
      {
        id: 'shot_605',
        action: '边走边说，走到门前停下',
        scene: '长廊',
        dialogue: '我们到此为止。',
        characters: [{ episodeCharacterId: 'char_m' }],
      },
    ],
    {
      motionPlan: [
        { shotId: 'shot_603', shotType: 'dialogue_medium', durationTargetSec: 2.2 },
        { shotId: 'shot_604', shotType: 'dialogue_medium', durationTargetSec: 2.4 },
        { shotId: 'shot_605', shotType: 'dialogue_medium', durationTargetSec: 2.6 },
      ],
      performancePlan: [
        { shotId: 'shot_603', performanceTemplate: 'dialogue_two_shot_tension' },
        { shotId: 'shot_604', performanceTemplate: 'dialogue_two_shot_tension' },
        { shotId: 'shot_605', performanceTemplate: 'dialogue_two_shot_tension' },
      ],
    }
  );

  assert.equal(motionBasedPlan[0].durationTargetSec, 7.2);
});

test('planActionSequences writes action-sequence-plan artifacts metrics manifest and qa summary', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-action-sequence-plan-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const artifactContext = {
    outputsDir: path.join(tempRoot, '1-outputs'),
    metricsDir: path.join(tempRoot, '2-metrics'),
    manifestPath: path.join(tempRoot, 'manifest.json'),
  };
  fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
  fs.mkdirSync(artifactContext.metricsDir, { recursive: true });

  const result = await planActionSequences(
    [
      {
        id: 'shot_301',
        action: '两人拔刀交锋，迅速进入缠斗',
        scene: '回廊',
        durationSec: 2.4,
        characters: [{ episodeCharacterId: 'char_a' }, { episodeCharacterId: 'char_b' }],
      },
      {
        id: 'shot_302',
        action: '格挡后反手回击，刀锋擦出火花',
        scene: '回廊',
        durationSec: 2.4,
        characters: [{ episodeCharacterId: 'char_a' }, { episodeCharacterId: 'char_b' }],
      },
    ],
    {
      motionPlan: [
        { shotId: 'shot_301', shotType: 'fight_wide' },
        { shotId: 'shot_302', shotType: 'fight_wide' },
      ],
      performancePlan: [
        { shotId: 'shot_301', performanceTemplate: 'fight_exchange_medium' },
        { shotId: 'shot_302', performanceTemplate: 'fight_exchange_medium' },
      ],
      continuityFlaggedTransitions: [
        { previousShotId: 'shot_301', shotId: 'shot_302', continuityScore: 4, hardViolationCodes: ['camera_axis_flip'] },
      ],
      artifactContext,
    }
  );

  assert.equal(result.length, 1);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'action-sequence-plan.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'action-sequence-plan-metrics.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'qa-summary.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'qa-summary.md')), true);
  assert.equal(fs.existsSync(artifactContext.manifestPath), true);

  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed');
  assert.deepEqual(manifest.outputFiles, ['action-sequence-plan.json', 'action-sequence-plan-metrics.json']);
});
