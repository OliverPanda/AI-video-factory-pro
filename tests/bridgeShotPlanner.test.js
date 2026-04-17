import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BRIDGE_SHOT_PLAN_FIELDS, shapeBridgeShotPlanEntry } from '../src/utils/bridgeShotProtocol.js';
import { __testables, planBridgeShots } from '../src/agents/bridgeShotPlanner.js';

test('shapeBridgeShotPlanEntry exposes the Phase 3 bridge protocol fields without planner semantics', () => {
  const entry = shapeBridgeShotPlanEntry({
    bridgeId: 'bridge_shot_001_shot_002',
    fromShotId: 'shot_001',
    toShotId: 'shot_002',
  });
  for (const field of BRIDGE_SHOT_PLAN_FIELDS) {
    assert.ok(field in entry, `missing required field ${field}`);
    assert.notEqual(entry[field], undefined, `${field} should not be undefined`);
  }
  assert.equal(entry.bridgeId, 'bridge_shot_001_shot_002');
  assert.equal(entry.fromShotId, 'shot_001');
  assert.equal(entry.toShotId, 'shot_002');
  assert.equal(entry.bridgeType, null);
});

test('buildBridgeShotPlan only flags high-risk cuts instead of bridging every transition', () => {
  const shots = [
    {
      id: 'shot_001',
      scene: '回廊',
      action: '沈昭转身拔刀',
      mood: '压抑',
      characters: [{ episodeCharacterId: 'char_shenzhao', name: '沈昭' }],
    },
    {
      id: 'shot_002',
      scene: '回廊',
      action: '刀锋顺势落下，侍卫后撤',
      mood: '爆发',
      characters: [{ episodeCharacterId: 'char_shenzhao', name: '沈昭' }],
    },
    {
      id: 'shot_003',
      scene: '回廊',
      action: '两人停下脚步对视',
      mood: '平静',
      characters: [{ episodeCharacterId: 'char_shenzhao', name: '沈昭' }],
    },
  ];

  const bridgePlan = __testables.buildBridgeShotPlan(shots, {
    continuityFlaggedTransitions: [
      {
        previousShotId: 'shot_001',
        shotId: 'shot_002',
        continuityScore: 5,
        hardViolationCodes: ['camera_axis_flip'],
      },
    ],
    motionPlan: [
      { shotId: 'shot_001', shotType: 'dialogue_medium' },
      { shotId: 'shot_002', shotType: 'fight_wide' },
      { shotId: 'shot_003', shotType: 'dialogue_medium' },
    ],
  });

  assert.equal(bridgePlan.length, 1);
  assert.equal(bridgePlan[0].fromShotId, 'shot_001');
  assert.equal(bridgePlan[0].toShotId, 'shot_002');
});

test('buildBridgeShotPlan covers motion_carry camera_reframe spatial_transition and emotional_transition', () => {
  const bridgePlan = __testables.buildBridgeShotPlan(
    [
      {
        id: 'shot_001',
        scene: '宫门回廊',
        action: '宁王转身冲刺',
        mood: '紧绷',
        characters: [{ episodeCharacterId: 'char_ningwang', name: '宁王' }],
      },
      {
        id: 'shot_002',
        scene: '宫门回廊',
        action: '他跃起挥刀，刀锋即将落下',
        mood: '爆发',
        characters: [{ episodeCharacterId: 'char_ningwang', name: '宁王' }],
      },
      {
        id: 'shot_003',
        scene: '宫门回廊',
        action: '宁王目光逼视对手',
        mood: '爆发',
        characters: [{ episodeCharacterId: 'char_ningwang', name: '宁王' }],
      },
      {
        id: 'shot_004',
        scene: '殿前广场',
        action: '他穿过长阶逼近祭台',
        mood: '决绝',
        characters: [{ episodeCharacterId: 'char_ningwang', name: '宁王' }],
      },
      {
        id: 'shot_005',
        scene: '殿前广场',
        action: '他停下脚步，冷冷看向大殿',
        mood: '压抑',
        characters: [{ episodeCharacterId: 'char_ningwang', name: '宁王' }],
      },
      {
        id: 'shot_006',
        scene: '殿前广场',
        action: '他抬眼，眼神从压抑转为决绝',
        mood: '决绝',
        characters: [{ episodeCharacterId: 'char_ningwang', name: '宁王' }],
      },
    ],
    {
      continuityFlaggedTransitions: [
        { previousShotId: 'shot_001', shotId: 'shot_002', continuityScore: 5, hardViolationCodes: [] },
        { previousShotId: 'shot_002', shotId: 'shot_003', continuityScore: 6, hardViolationCodes: ['camera_axis_flip'] },
        { previousShotId: 'shot_003', shotId: 'shot_004', continuityScore: 5, hardViolationCodes: ['prop_state_break'] },
        { previousShotId: 'shot_005', shotId: 'shot_006', continuityScore: 6, hardViolationCodes: [] },
      ],
      motionPlan: [
        { shotId: 'shot_001', shotType: 'fight_wide' },
        { shotId: 'shot_002', shotType: 'fight_wide' },
        { shotId: 'shot_003', shotType: 'dialogue_closeup' },
        { shotId: 'shot_004', shotType: 'fight_wide' },
        { shotId: 'shot_005', shotType: 'dialogue_closeup' },
        { shotId: 'shot_006', shotType: 'dialogue_closeup' },
      ],
    }
  );

  assert.deepEqual(
    bridgePlan.map((entry) => [entry.fromShotId, entry.toShotId, entry.bridgeType]),
    [
      ['shot_001', 'shot_002', 'motion_carry'],
      ['shot_002', 'shot_003', 'camera_reframe'],
      ['shot_003', 'shot_004', 'spatial_transition'],
      ['shot_005', 'shot_006', 'emotional_transition'],
    ]
  );
});

test('buildBridgeShotPlan sets duration goal risk and transition intent within MVP bounds', () => {
  const [entry] = __testables.buildBridgeShotPlan(
    [
      {
        id: 'shot_010',
        scene: '偏殿',
        action: '皇后猛然起身，甩袖转向门外',
        mood: '震怒',
        characters: [{ episodeCharacterId: 'char_queen', name: '皇后' }],
      },
      {
        id: 'shot_011',
        scene: '偏殿',
        action: '她冲向门槛，衣袍翻起',
        mood: '震怒',
        characters: [{ episodeCharacterId: 'char_queen', name: '皇后' }],
      },
    ],
    {
      continuityFlaggedTransitions: [
        { previousShotId: 'shot_010', shotId: 'shot_011', continuityScore: 4, hardViolationCodes: ['camera_axis_flip'] },
      ],
      motionPlan: [
        { shotId: 'shot_010', shotType: 'dialogue_medium' },
        { shotId: 'shot_011', shotType: 'fight_wide' },
      ],
    }
  );

  assert.equal(entry.bridgeGoal, 'carry_action_across_cut');
  assert.equal(entry.continuityRisk, 'high');
  assert.equal(entry.cameraTransitionIntent, 'follow_through_motion');
  assert.equal(entry.durationTargetSec >= 1.5 && entry.durationTargetSec <= 3, true);
});

test('buildBridgeShotPlan skips flagged cuts that are internal to an already planned sequence span', () => {
  const bridgePlan = __testables.buildBridgeShotPlan(
    [
      {
        id: 'shot_101',
        scene: '回廊',
        action: '主角逼近',
        mood: '紧绷',
        characters: [{ episodeCharacterId: 'char_hero', name: '主角' }],
      },
      {
        id: 'shot_102',
        scene: '回廊',
        action: '主角继续压上',
        mood: '爆发',
        characters: [{ episodeCharacterId: 'char_hero', name: '主角' }],
      },
      {
        id: 'shot_103',
        scene: '回廊',
        action: '对手退到柱边',
        mood: '爆发',
        characters: [{ episodeCharacterId: 'char_hero', name: '主角' }],
      },
    ],
    {
      continuityFlaggedTransitions: [
        { previousShotId: 'shot_101', shotId: 'shot_102', continuityScore: 5, hardViolationCodes: ['camera_axis_flip'] },
        { previousShotId: 'shot_102', shotId: 'shot_103', continuityScore: 5, hardViolationCodes: ['camera_axis_flip'] },
      ],
      motionPlan: [
        { shotId: 'shot_101', shotType: 'fight_wide' },
        { shotId: 'shot_102', shotType: 'fight_wide' },
        { shotId: 'shot_103', shotType: 'dialogue_closeup' },
      ],
      actionSequencePlan: [
        {
          sequenceId: 'sequence_101_102',
          shotIds: ['shot_101', 'shot_102'],
        },
      ],
    }
  );

  assert.deepEqual(
    bridgePlan.map((entry) => [entry.fromShotId, entry.toShotId]),
    [['shot_102', 'shot_103']]
  );
});

test('planBridgeShots writes bridge-shot-plan artifacts and metrics', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-bridge-planner-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const artifactContext = {
    outputsDir: path.join(tempRoot, '1-outputs'),
    metricsDir: path.join(tempRoot, '2-metrics'),
    manifestPath: path.join(tempRoot, 'manifest.json'),
  };
  fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
  fs.mkdirSync(artifactContext.metricsDir, { recursive: true });

  const result = await planBridgeShots(
    [
      {
        id: 'shot_021',
        scene: '长阶',
        action: '太子回身拔剑',
        mood: '压抑',
        characters: [{ episodeCharacterId: 'char_prince', name: '太子' }],
      },
      {
        id: 'shot_022',
        scene: '长阶',
        action: '他顺势前冲，剑锋压向来敌',
        mood: '决绝',
        characters: [{ episodeCharacterId: 'char_prince', name: '太子' }],
      },
    ],
    {
      continuityFlaggedTransitions: [
        { previousShotId: 'shot_021', shotId: 'shot_022', continuityScore: 5, hardViolationCodes: [] },
      ],
      motionPlan: [
        { shotId: 'shot_021', shotType: 'dialogue_medium' },
        { shotId: 'shot_022', shotType: 'fight_wide' },
      ],
      artifactContext,
    }
  );

  assert.equal(result.length, 1);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'bridge-shot-plan.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'bridge-shot-plan-metrics.json')), true);
  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed');
});
