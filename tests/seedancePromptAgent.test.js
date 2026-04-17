import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSequenceGenerationPack, createShotGenerationPack } from '../src/domain/seedanceGenerationProtocol.js';
import { __testables, buildSeedancePromptPackages } from '../src/agents/seedancePromptAgent.js';
import { __testables as seedanceApiTestables } from '../src/apis/seedanceVideoApi.js';

test('generation protocols create valid shot and sequence generation packs', () => {
  const shotPack = createShotGenerationPack({
    scene_id: 'scene_001',
    shot_id: 'shot_001',
    shot_goal: '建立威胁关系并清楚交代谁在掌控局面。',
    entry_state: '林岚举枪切入画面',
    exit_state: '阿哲被逼退到货架边',
    timecoded_beats: [{ at_sec: 0, summary: '林岚举枪逼近' }],
    camera_plan: { framing: 'medium', move_type: 'slow_dolly', coverage_role: 'anchor_master' },
    actor_blocking: ['林岚:foreground', '阿哲:midground'],
    space_anchor: '仓库主通道',
    character_locks: ['林岚', '阿哲'],
    environment_locks: ['仓库主通道'],
    reference_stack: [{ type: 'keyframe', path: '/tmp/shot_001.png', role: 'first_frame' }],
    negative_rules: ['axis break'],
    quality_target: 'narrative_clarity',
  });
  const sequencePack = createSequenceGenerationPack({
    scene_id: 'scene_001',
    sequence_id: 'sequence_001',
    sequence_goal: '让追逐中段持续可读',
    covered_beats: ['追逐起速', '拐角压迫'],
    entry_state: '角色从仓库门口冲出',
    mid_state: '角色贴墙转向',
    exit_state: '角色冲入雨巷',
    timecoded_multi_beats: [{ at_sec: 0, summary: '起跑' }],
    blocking_progression: ['门口->通道->雨巷'],
    camera_progression: ['follow', 'tight_follow'],
    reference_stack: [{ type: 'keyframe', path: '/tmp/sequence_001.png', role: 'first_frame' }],
  });

  assert.equal(shotPack.validation_status, 'valid');
  assert.equal(sequencePack.validation_status, 'valid');
});

test('buildSeedancePromptPackages converts scene and director inputs into structured prompt blocks', async () => {
  const shotPackages = buildSeedancePromptPackages(
    [
      {
        shotId: 'shot_001',
        visualGoal: '皇城长廊里人物缓慢回头',
        cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
        durationTargetSec: 4,
        referenceImages: [{ type: 'keyframe', path: '/tmp/shot_001.png', shotId: 'shot_001' }],
        providerRequestHints: {
          storyBeat: '林岚举枪逼近阿哲',
          spaceAnchor: '仓库主通道',
          cameraFlowIntent: 'slow_dolly',
        },
      },
    ],
    {
      shots: [{ id: 'shot_001', scene: '仓库主通道', action: '林岚举枪逼近阿哲', characters: ['林岚', '阿哲'] }],
      motionPlan: [{ shotId: 'shot_001', durationTargetSec: 4, visualGoal: '林岚举枪逼近阿哲' }],
      scenePacks: [{
        scene_id: 'scene_001',
        scene_goal: '建立威胁关系并清楚交代谁在掌控局面。',
        dramatic_question: '这一轮对峙里谁先压制住对方？',
        start_state: '林岚举枪切入画面',
        end_state: '阿哲被逼退到货架边',
        location_anchor: '仓库主通道',
        cast: ['林岚', '阿哲'],
        delivery_priority: 'narrative_clarity',
        forbidden_choices: ['random axis flips'],
        action_beats: [{ beat_id: 'beat_01', shot_ids: ['shot_001'], summary: '林岚举枪逼近阿哲' }],
      }],
      directorPacks: [{
        scene_id: 'scene_001',
        cinematic_intent: '用克制而清晰的方式建立压迫关系。',
        coverage_strategy: 'master_anchor_then_selective_escalation',
        shot_order_plan: [{ beat_id: 'beat_01', coverage: 'anchor_master', emphasis: 'space_and_power' }],
        blocking_map: [{ beat_id: 'beat_01', subject_positions: ['林岚:foreground', '阿哲:midground'], movement_note: 'pressure_forward' }],
        continuity_locks: ['preserve warehouse geography'],
      }],
    }
  );

  assert.equal(shotPackages.length, 1);
  assert.equal(shotPackages[0].generationPack.scene_id, 'scene_001');
  assert.equal(shotPackages[0].generationPack.timecoded_beats.length, 1);
  assert.equal(shotPackages[0].seedancePromptBlocks[0].key, 'cinematic_intent');
  assert.match(shotPackages[0].seedancePromptBlocks.map((block) => block.text).join(' | '), /压迫关系|narrative_clarity|林岚举枪逼近阿哲/);

  const promptText = await seedanceApiTestables.buildPromptText(shotPackages[0]);
  assert.match(promptText, /entry:/i);
  assert.match(promptText, /narrative clarity|narrative_clarity/i);
});

test('buildSeedancePromptPackages writes prompt artifacts and flags degraded cinematic inputs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-seedance-prompt-'));

  try {
    const artifactContext = {
      outputsDir: path.join(tempDir, '1-outputs'),
      metricsDir: path.join(tempDir, '2-metrics'),
      manifestPath: path.join(tempDir, 'manifest.json'),
      errorsDir: path.join(tempDir, '3-errors'),
    };

    const shotPackages = buildSeedancePromptPackages(
      [
        {
          shotId: 'shot_missing_scene',
          visualGoal: '角色慢慢回头',
          cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
          durationTargetSec: 4,
          referenceImages: [{ type: 'keyframe', path: '/tmp/shot_001.png', shotId: 'shot_missing_scene' }],
          providerRequestHints: {},
        },
      ],
      {
        shots: [{ id: 'shot_missing_scene', scene: '未知空间', action: '回头' }],
        motionPlan: [{ shotId: 'shot_missing_scene', durationTargetSec: 4, visualGoal: '角色慢慢回头' }],
        scenePacks: [],
        directorPacks: [],
        artifactContext,
      }
    );

    assert.equal(shotPackages[0].generationPack.validation_status, 'valid');
    assert.equal(shotPackages[0].generationPack.scene_id, 'scene_unassigned');
    assert.equal(shotPackages[0].qualityStatus, 'degraded');
    assert.equal(shotPackages[0].qualityIssues.includes('missing_scene_pack'), true);
    assert.equal(shotPackages[0].qualityIssues.includes('missing_director_pack'), true);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'seedance-prompt-packages.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'seedance-prompt-blocks.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'seedance-director-inference-audit.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'seedance-prompt-metrics.json')), true);

    const metrics = JSON.parse(fs.readFileSync(path.join(artifactContext.metricsDir, 'seedance-prompt-metrics.json'), 'utf-8'));
    assert.equal(metrics.degradedCount, 1);
    assert.equal(metrics.missingDirectorCount, 1);
    assert.equal(metrics.missingReferenceCount, 0);
    assert.equal(metrics.missingEntryExitCount, 1);
    assert.equal(metrics.inferredCoverageCount, 0);
    assert.equal(metrics.inferredBlockingCount, 0);
    assert.equal(metrics.inferredContinuityCount, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildShotGenerationPack preserves cinematic invariants instead of only copying text labels', () => {
  const enriched = __testables.buildShotGenerationPack(
    {
      shotId: 'shot_critical',
      visualGoal: '仓库主通道内两人对峙',
      cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
      durationTargetSec: 4,
      referenceImages: [{ type: 'keyframe', path: '/tmp/shot_critical.png' }],
      providerRequestHints: {
        storyBeat: '林岚举枪逼近阿哲',
        spaceAnchor: '仓库主通道',
        cameraFlowIntent: 'slow_dolly',
      },
    },
    {
      shot: { id: 'shot_critical', scene: '仓库主通道', action: '林岚举枪逼近阿哲', characters: ['林岚', '阿哲'] },
      motionEntry: { shotId: 'shot_critical', durationTargetSec: 4, visualGoal: '林岚举枪逼近阿哲' },
      scenePack: {
        scene_id: 'scene_critical',
        scene_goal: '建立威胁关系并清楚交代谁在掌控局面。',
        start_state: '林岚举枪切入画面',
        end_state: '阿哲被逼退到货架边',
        location_anchor: '仓库主通道',
        cast: ['林岚', '阿哲'],
        forbidden_choices: ['random axis flips'],
        delivery_priority: 'narrative_clarity',
        action_beats: [{ beat_id: 'beat_01', shot_ids: ['shot_critical'], summary: '林岚举枪逼近阿哲' }],
      },
      directorPack: {
        scene_id: 'scene_critical',
        cinematic_intent: '用克制而清晰的方式建立压迫关系。',
        coverage_strategy: 'master_anchor_then_selective_escalation',
        shot_order_plan: [{ beat_id: 'beat_01', coverage: 'anchor_master', emphasis: 'space_and_power' }],
        blocking_map: [{ beat_id: 'beat_01', subject_positions: ['林岚:foreground', '阿哲:midground'], movement_note: 'pressure_forward' }],
        continuity_locks: ['preserve warehouse geography'],
      },
    }
  );

  assert.equal(enriched.generationPack.entry_state, '林岚举枪切入画面');
  assert.equal(enriched.generationPack.exit_state, '阿哲被逼退到货架边');
  assert.equal(enriched.generationPack.camera_plan.coverage_role, 'anchor_master');
  assert.equal(enriched.generationPack.actor_blocking.includes('林岚:foreground'), true);
  assert.equal(enriched.seedancePromptBlocks.some((block) => block.key === 'continuity_locks'), true);
  assert.equal(enriched.qualityStatus, 'pass');
});

test('buildShotGenerationPack emits Seedance-friendly blocks for subject action, environment, camera, and reference binding', () => {
  const enriched = __testables.buildShotGenerationPack(
    {
      shotId: 'shot_seedance_formula',
      visualGoal: 'Lin Lan raises the pistol and presses forward on A Zhe.',
      cameraSpec: { moveType: 'slow_push', framing: 'medium', ratio: '9:16' },
      durationTargetSec: 5,
      referenceImages: [
        { type: 'keyframe', path: '/tmp/shot_seedance_formula.png', shotId: 'shot_seedance_formula' },
        { type: 'reference_image', path: '/tmp/shot_seedance_formula_ref.png', shotId: 'shot_seedance_formula_ref' },
      ],
      providerRequestHints: {
        storyBeat: 'Lin Lan raises the pistol and presses forward on A Zhe.',
        spaceAnchor: 'warehouse main aisle',
        cameraFlowIntent: 'slow_push',
      },
    },
    {
      shot: { id: 'shot_seedance_formula', scene: 'warehouse main aisle', action: 'Lin Lan raises the pistol and presses forward on A Zhe.', characters: ['Lin Lan', 'A Zhe'] },
      motionEntry: { shotId: 'shot_seedance_formula', durationTargetSec: 5, visualGoal: 'Lin Lan raises the pistol and presses forward on A Zhe.' },
      scenePack: {
        scene_id: 'scene_seedance_formula',
        scene_goal: 'Show who controls the aisle while keeping the threat readable.',
        start_state: 'Lin Lan enters frame with the pistol already raised.',
        end_state: 'A Zhe is forced back toward the shelf.',
        location_anchor: 'warehouse main aisle',
        time_anchor: 'cold industrial night',
        cast: ['Lin Lan', 'A Zhe'],
        visual_motif: 'cold industrial realism, floating dust, practical top light',
        camera_grammar: { coverage: 'clarity_first', movement: 'restrained pressure', lens_bias: 'naturalistic' },
        forbidden_choices: ['random axis flips'],
        delivery_priority: 'narrative_clarity',
        action_beats: [{ beat_id: 'beat_01', shot_ids: ['shot_seedance_formula'], summary: 'Lin Lan raises the pistol and presses forward on A Zhe.' }],
      },
      directorPack: {
        scene_id: 'scene_seedance_formula',
        cinematic_intent: 'Keep the confrontation grounded, tense, and spatially readable.',
        coverage_strategy: 'anchor_master_then_pressure',
        shot_order_plan: [{ beat_id: 'beat_01', coverage: 'anchor_master', emphasis: 'space_and_power' }],
        blocking_map: [{ beat_id: 'beat_01', subject_positions: ['Lin Lan:foreground_anchor', 'A Zhe:midground_counter'], movement_note: 'pressure_forward' }],
        continuity_locks: ['preserve warehouse geography'],
      },
    }
  );

  const blockMap = new Map(enriched.seedancePromptBlocks.map((block) => [block.key, block.text]));
  assert.match(blockMap.get('subject_action') || '', /Lin Lan raises the pistol/i);
  assert.match(blockMap.get('scene_environment') || '', /warehouse main aisle/i);
  assert.match(blockMap.get('scene_environment') || '', /cold industrial night/i);
  assert.match(blockMap.get('scene_environment') || '', /cold industrial realism/i);
  assert.match(blockMap.get('cinematography') || '', /clarity_first/i);
  assert.match(blockMap.get('cinematography') || '', /slow_push/i);
  assert.match(blockMap.get('reference_binding') || '', /image1/i);
  assert.match(blockMap.get('reference_binding') || '', /first frame/i);
});

test('buildShotGenerationPack marks packages degraded when cinematic readability anchors are missing', () => {
  const degraded = __testables.buildShotGenerationPack(
    {
      shotId: 'shot_low_quality',
      visualGoal: '人物快速移动',
      cameraSpec: { moveType: 'whip_pan', framing: 'wide', ratio: '9:16' },
      durationTargetSec: 4,
      referenceImages: [],
      providerRequestHints: {},
    },
    {
      shot: { id: 'shot_low_quality', scene: '未知空间', action: '快速移动', characters: ['路人甲'] },
      motionEntry: { shotId: 'shot_low_quality', durationTargetSec: 4, visualGoal: '人物快速移动' },
      scenePack: null,
      directorPack: null,
    }
  );

  assert.equal(degraded.qualityStatus, 'degraded');
  assert.equal(degraded.qualityIssues.includes('missing_scene_pack'), true);
  assert.equal(degraded.qualityIssues.includes('missing_director_pack'), true);
  assert.equal(degraded.qualityIssues.includes('missing_reference_stack'), true);
  assert.equal(degraded.qualityIssues.includes('entry_state_missing'), true);
  assert.equal(degraded.qualityIssues.includes('exit_state_missing'), true);
});

test('buildShotGenerationPack auto-repairs weak director data into readable defaults before preflight', () => {
  const repairedPackage = __testables.buildShotGenerationPack(
    {
      shotId: 'shot_warn_quality',
      visualGoal: '角色短暂停步',
      cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
      durationTargetSec: 4,
      referenceImages: [{ type: 'keyframe', path: '/tmp/shot_warn_quality.png' }],
      providerRequestHints: {
        storyBeat: '角色短暂停步',
        spaceAnchor: '走廊',
      },
    },
    {
      shot: { id: 'shot_warn_quality', scene: '走廊', action: '角色短暂停步', characters: ['林岚'] },
      motionEntry: { shotId: 'shot_warn_quality', durationTargetSec: 4, visualGoal: '角色短暂停步' },
      scenePack: {
        scene_id: 'scene_warn',
        scene_goal: '交代角色犹豫。',
        start_state: '角色停在走廊口',
        end_state: '角色仍未行动',
        location_anchor: '走廊',
        cast: ['林岚'],
        forbidden_choices: [],
        delivery_priority: 'narrative_clarity',
        action_beats: [{ beat_id: 'beat_01', shot_ids: ['shot_warn_quality'], summary: '角色短暂停步' }],
      },
      directorPack: {
        scene_id: 'scene_warn',
        cinematic_intent: '保持克制。',
        shot_order_plan: [{ beat_id: 'beat_01', coverage: '', emphasis: 'hesitation' }],
        blocking_map: [{ beat_id: 'beat_01', subject_positions: [], movement_note: 'hold' }],
        continuity_locks: [],
      },
    }
  );

  assert.equal(repairedPackage.qualityStatus, 'pass');
  assert.equal(repairedPackage.generationPack.camera_plan.coverage_role, 'emotion_anchor_medium');
  assert.equal(repairedPackage.generationPack.actor_blocking.includes('林岚:readable_single_subject'), true);
  assert.equal(repairedPackage.seedancePromptBlocks.some((block) => block.key === 'continuity_locks'), true);
  assert.equal(repairedPackage.qualityIssues.includes('coverage_role_missing'), false);
  assert.equal(repairedPackage.qualityIssues.includes('blocking_missing'), false);
  assert.equal(repairedPackage.qualityIssues.includes('continuity_locks_missing'), false);
  assert.equal(repairedPackage.directorInferenceAudit.inferredFields.coverageRole.inferred, true);
  assert.equal(repairedPackage.directorInferenceAudit.inferredFields.actorBlocking.inferred, true);
  assert.equal(repairedPackage.directorInferenceAudit.inferredFields.continuityLocks.inferred, true);
});

test('buildSeedancePromptPackages metrics expose how many shots relied on inferred director defaults', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-seedance-prompt-inference-'));

  try {
    const artifactContext = {
      outputsDir: path.join(tempDir, '1-outputs'),
      metricsDir: path.join(tempDir, '2-metrics'),
      manifestPath: path.join(tempDir, 'manifest.json'),
      errorsDir: path.join(tempDir, '3-errors'),
    };

    buildSeedancePromptPackages(
      [
        {
          shotId: 'shot_inferred',
          visualGoal: '角色短暂停步',
          cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
          durationTargetSec: 4,
          referenceImages: [{ type: 'keyframe', path: '/tmp/shot_inferred.png', shotId: 'shot_inferred' }],
          providerRequestHints: {
            storyBeat: '角色短暂停步',
            spaceAnchor: '走廊',
          },
        },
      ],
      {
        shots: [{ id: 'shot_inferred', scene: '走廊', action: '角色短暂停步', characters: ['林岚'] }],
        motionPlan: [{ shotId: 'shot_inferred', durationTargetSec: 4, visualGoal: '角色短暂停步' }],
        scenePacks: [{
          scene_id: 'scene_inferred',
          scene_goal: '交代角色犹豫。',
          start_state: '角色停在走廊口',
          end_state: '角色仍未行动',
          location_anchor: '走廊',
          cast: ['林岚'],
          forbidden_choices: [],
          delivery_priority: 'narrative_clarity',
          action_beats: [{ beat_id: 'beat_01', shot_ids: ['shot_inferred'], summary: '角色短暂停步' }],
        }],
        directorPacks: [{
          scene_id: 'scene_inferred',
          cinematic_intent: '保持克制。',
          shot_order_plan: [{ beat_id: 'beat_01', coverage: '', emphasis: 'hesitation' }],
          blocking_map: [{ beat_id: 'beat_01', subject_positions: [], movement_note: 'hold' }],
          continuity_locks: [],
        }],
        artifactContext,
      }
    );

    const metrics = JSON.parse(fs.readFileSync(path.join(artifactContext.metricsDir, 'seedance-prompt-metrics.json'), 'utf-8'));
    assert.equal(metrics.inferredCoverageCount, 1);
    assert.equal(metrics.inferredBlockingCount, 1);
    assert.equal(metrics.inferredContinuityCount, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
