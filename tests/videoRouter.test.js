import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables, routeVideoShots } from '../src/agents/videoRouter.js';

test('buildShotPackages assembles complete shotPackage and prefers configured video provider when reference image exists', () => {
  const shotPackages = __testables.buildShotPackages(
    [{ id: 'shot_001', scene: '大殿', action: '对峙' }],
    [
      {
        shotId: 'shot_001',
        shotType: 'dialogue_medium',
        durationTargetSec: 4,
        visualGoal: '大殿对峙',
        cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
        storyBeat: '双方对峙',
        screenDirection: 'forward',
        spaceAnchor: '大殿',
        continuityContext: {
          storyBeat: '双方对峙',
          screenDirection: 'forward',
          spaceAnchor: '大殿',
          previousShotId: null,
          nextShotId: null,
        },
      },
    ],
    [{ shotId: 'shot_001', imagePath: '/tmp/shot_001.png', success: true }],
    {
      videoProvider: 'seedance',
      performancePlan: [
        {
          shotId: 'shot_001',
          performanceTemplate: 'dialogue_two_shot_tension',
          actionBeatList: [{ atSec: 1.5, action: 'eye_contact_hold' }],
          cameraMovePlan: { pattern: 'push_in', intensity: 'light' },
          generationTier: 'enhanced',
          variantCount: 2,
          candidateSelectionRule: 'prefer_motion_pass',
          regenPolicy: 'retry_once_then_fallback',
          firstLastFramePolicy: 'first_frame_required',
          enhancementHints: ['timing_normalizer'],
        },
      ],
      promptList: [{ shotId: 'shot_001', image_prompt: '皇城大殿内，两人对峙', negative_prompt: '' }],
    }
  );

  assert.equal(shotPackages.length, 1);
  assert.deepEqual(shotPackages[0], {
    shotId: 'shot_001',
    shotType: 'dialogue_medium',
    durationTargetSec: 4,
    visualGoal: '皇城大殿内，两人对峙',
    cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
    referenceImages: [{ type: 'keyframe', path: '/tmp/shot_001.png', shotId: 'shot_001' }],
    preferredProvider: 'seedance',
    fallbackProviders: ['static_image'],
    providerRequestHints: {
      shotId: 'shot_001',
      scene: '大殿',
      action: '对峙',
      hasReferenceImage: true,
      promptSource: 'prompt_list',
      negativePrompt: '',
      targetModelTier: 'enhanced',
      requestedDurationSec: 4,
      requestedRatio: '9:16',
      requestedMoveType: 'slow_dolly',
      referenceImagePath: '/tmp/shot_001.png',
      storyBeat: '双方对峙',
      screenDirection: 'forward',
      spaceAnchor: '大殿',
      continuityTargets: ['双方对峙', 'space:大殿', 'screen_direction:forward'],
      hardContinuityRules: [
        'keep the shot grounded in 大殿',
        'preserve subject travel and facing direction toward forward',
        'open on the incoming beat and end on a readable handoff for 双方对峙',
      ],
      cameraFlowIntent: 'slow_dolly',
    },
    audioRef: null,
    continuityContext: {
      storyBeat: '双方对峙',
      screenDirection: 'forward',
      spaceAnchor: '大殿',
      previousShotId: null,
      nextShotId: null,
    },
    performanceTemplate: 'dialogue_two_shot_tension',
    actionBeatList: [{ atSec: 1.5, action: 'eye_contact_hold' }],
    cameraMovePlan: { pattern: 'push_in', intensity: 'light' },
    generationTier: 'enhanced',
    variantCount: 2,
    candidateSelectionRule: 'prefer_motion_pass',
    regenPolicy: 'retry_once_then_fallback',
    firstLastFramePolicy: 'first_frame_required',
    enhancementHints: ['timing_normalizer'],
    qaRules: {
      mustProbeWithFfprobe: true,
      mustHaveNonZeroDuration: true,
      canFallbackToStaticImage: true,
    },
  });
});

test('routeVideoShots prefers image_prompt_en for provider-facing visual goal and ignores display_prompt_zh', async () => {
  const shotPackages = await routeVideoShots(
    [{ id: 'shot_en_001', scene: 'Warehouse', action: 'Standoff' }],
    [
      {
        shotId: 'shot_en_001',
        shotType: 'dialogue_medium',
        durationTargetSec: 4,
        visualGoal: 'motion plan fallback goal',
        cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
      },
    ],
    [{ shotId: 'shot_en_001', imagePath: '/tmp/shot_en_001.png', success: true }],
    {
      promptList: [
        {
          shotId: 'shot_en_001',
          image_prompt_en: 'english execution prompt',
          image_prompt: 'legacy execution prompt',
          negative_prompt_en: 'blurry',
          negative_prompt: 'legacy blurry',
          display_prompt_zh: '中文展示提示词，不可用于执行',
        },
      ],
      performancePlan: [],
    }
  );

  assert.equal(shotPackages[0].visualGoal, 'english execution prompt');
  assert.equal(shotPackages[0].providerRequestHints.promptSource, 'prompt_list');
  assert.equal(shotPackages[0].providerRequestHints.negativePrompt, 'blurry');
  assert.notEqual(shotPackages[0].visualGoal, '中文展示提示词，不可用于执行');
});

test('routeVideoShots falls back to static image provider when no reference image is available', async () => {
  const shotPackages = await routeVideoShots(
    [{ id: 'shot_002', scene: '宫墙', action: '风起' }],
    [
      {
        shotId: 'shot_002',
        shotType: 'ambient_transition',
        durationTargetSec: 3,
        visualGoal: '宫墙风起',
        cameraSpec: { moveType: 'slow_drift', framing: 'wide', ratio: '9:16' },
      },
    ],
    [],
    {
      performancePlan: [
        {
          shotId: 'shot_002',
          performanceTemplate: 'ambient_transition_motion',
          actionBeatList: [],
          cameraMovePlan: { pattern: 'drift', intensity: 'light' },
          generationTier: 'base',
          variantCount: 1,
          candidateSelectionRule: 'single_best',
          regenPolicy: 'fallback_only',
          firstLastFramePolicy: 'first_frame_optional',
          enhancementHints: [],
        },
      ],
    }
  );

  assert.equal(shotPackages[0].preferredProvider, 'static_image');
  assert.deepEqual(shotPackages[0].referenceImages, []);
  assert.deepEqual(shotPackages[0].fallbackProviders, []);
  assert.equal(shotPackages[0].providerRequestHints.hasReferenceImage, false);
  assert.equal(shotPackages[0].performanceTemplate, 'ambient_transition_motion');
  assert.equal(shotPackages[0].generationTier, 'base');
  assert.equal(shotPackages[0].variantCount, 1);
  assert.deepEqual(shotPackages[0].providerRequestHints.continuityTargets, []);
});

test('routeVideoShots enriches shot packages with generationPack and structured Seedance prompt blocks', async () => {
  const shotPackages = await routeVideoShots(
    [{ id: 'shot_003', scene: '仓库主通道', action: '林岚举枪逼近阿哲', characters: ['林岚', '阿哲'] }],
    [
      {
        shotId: 'shot_003',
        shotType: 'dialogue_medium',
        durationTargetSec: 4,
        visualGoal: '仓库对峙',
        cameraIntent: 'slow_dolly',
        cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
        storyBeat: '林岚举枪逼近阿哲',
        screenDirection: 'forward',
        spaceAnchor: '仓库主通道',
        continuityContext: { storyBeat: '林岚举枪逼近阿哲', screenDirection: 'forward', spaceAnchor: '仓库主通道' },
      },
    ],
    [{ shotId: 'shot_003', imagePath: '/tmp/shot_003.png', success: true }],
    {
      promptList: [{ shotId: 'shot_003', image_prompt: '仓库主通道内两人对峙', negative_prompt: '' }],
      scenePacks: [{
        scene_id: 'scene_003',
        scene_goal: '建立威胁关系并清楚交代谁在掌控局面。',
        dramatic_question: '这一轮对峙里谁先压制住对方？',
        start_state: '林岚举枪切入画面',
        end_state: '阿哲被逼退到货架边',
        location_anchor: '仓库主通道',
        cast: ['林岚', '阿哲'],
        delivery_priority: 'narrative_clarity',
        forbidden_choices: ['random axis flips'],
        action_beats: [{ beat_id: 'beat_01', shot_ids: ['shot_003'], summary: '林岚举枪逼近阿哲' }],
      }],
      directorPacks: [{
        scene_id: 'scene_003',
        cinematic_intent: '用克制而清晰的方式建立压迫关系。',
        coverage_strategy: 'master_anchor_then_selective_escalation',
        shot_order_plan: [{ beat_id: 'beat_01', coverage: 'anchor_master', emphasis: 'space_and_power' }],
        blocking_map: [{ beat_id: 'beat_01', subject_positions: ['林岚:foreground', '阿哲:midground'], movement_note: 'pressure_forward' }],
        continuity_locks: ['preserve warehouse geography'],
      }],
      performancePlan: [],
    }
  );

  assert.equal(shotPackages[0].generationPack.scene_id, 'scene_003');
  assert.equal(Array.isArray(shotPackages[0].seedancePromptBlocks), true);
  assert.equal(shotPackages[0].seedancePromptBlocks.some((block) => block.key === 'cinematic_intent'), true);
});

test('routeVideoShots preserves continuity compatibility fields after prompt enrichment', async () => {
  const shotPackages = await routeVideoShots(
    [{ id: 'shot_004', scene: '仓库主通道', action: '林岚举枪逼近阿哲', characters: ['林岚', '阿哲'] }],
    [
      {
        shotId: 'shot_004',
        shotType: 'dialogue_medium',
        durationTargetSec: 4,
        visualGoal: '仓库对峙',
        cameraIntent: 'slow_dolly',
        cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
        storyBeat: '林岚举枪逼近阿哲',
        screenDirection: 'forward',
        spaceAnchor: '仓库主通道',
        continuityContext: {
          storyBeat: '林岚举枪逼近阿哲',
          screenDirection: 'forward',
          spaceAnchor: '仓库主通道',
          previousShotId: null,
          nextShotId: 'shot_005',
        },
      },
    ],
    [{ shotId: 'shot_004', imagePath: '/tmp/shot_004.png', success: true }],
    {
      promptList: [{ shotId: 'shot_004', image_prompt: '仓库主通道内两人对峙', negative_prompt: '' }],
      scenePacks: [{
        scene_id: 'scene_004',
        scene_goal: '建立威胁关系并清楚交代谁在掌控局面。',
        dramatic_question: '这一轮对峙里谁先压制住对方？',
        start_state: '林岚举枪切入画面',
        end_state: '阿哲被逼退到货架边',
        location_anchor: '仓库主通道',
        cast: ['林岚', '阿哲'],
        delivery_priority: 'narrative_clarity',
        forbidden_choices: ['random axis flips'],
        action_beats: [{ beat_id: 'beat_01', shot_ids: ['shot_004'], summary: '林岚举枪逼近阿哲' }],
      }],
      directorPacks: [{
        scene_id: 'scene_004',
        cinematic_intent: '用克制而清晰的方式建立压迫关系。',
        coverage_strategy: 'master_anchor_then_selective_escalation',
        shot_order_plan: [{ beat_id: 'beat_01', coverage: 'anchor_master', emphasis: 'space_and_power' }],
        blocking_map: [{ beat_id: 'beat_01', subject_positions: ['林岚:foreground', '阿哲:midground'], movement_note: 'pressure_forward' }],
        continuity_locks: ['preserve warehouse geography'],
      }],
      performancePlan: [{
        shotId: 'shot_004',
        performanceTemplate: 'dialogue_two_shot_tension',
        actionBeatList: [{ atSec: 1.5, action: 'eye_contact_hold' }],
        cameraMovePlan: { intent: 'push_in', intensity: 'light' },
        generationTier: 'enhanced',
        variantCount: 2,
      }],
    }
  );

  assert.deepEqual(shotPackages[0].providerRequestHints.continuityTargets, ['林岚举枪逼近阿哲', 'space:仓库主通道', 'screen_direction:forward']);
  assert.equal(shotPackages[0].providerRequestHints.cameraFlowIntent, 'push_in');
  assert.equal(shotPackages[0].continuityContext.nextShotId, 'shot_005');
  assert.equal(shotPackages[0].generationPack.space_anchor, '仓库主通道');
});

test('buildShotPackages collects character reference images by stable character ID instead of name', () => {
  const shotPackages = __testables.buildShotPackages(
    [
      {
        id: 'shot_identity',
        scene: '偏殿',
        action: '沈清回头',
        characters: [{ episodeCharacterId: 'char_target', name: '沈清' }],
      },
    ],
    [
      {
        shotId: 'shot_identity',
        shotType: 'dialogue_closeup',
        durationTargetSec: 4,
        visualGoal: '偏殿回头',
        cameraSpec: { moveType: 'push_in', framing: 'close', ratio: '9:16' },
      },
    ],
    [{ shotId: 'shot_identity', imagePath: '/tmp/shot_identity.png', success: true }],
    {
      characterRegistry: [
        { episodeCharacterId: 'char_other', name: '沈清', referenceImagePath: '/tmp/wrong.png' },
        { episodeCharacterId: 'char_target', name: '沈清', referenceImagePath: '/tmp/right.png' },
      ],
      performancePlan: [],
      promptList: [{ shotId: 'shot_identity', image_prompt: '偏殿里的沈清回头', negative_prompt: '' }],
    }
  );

  const characterReferences = shotPackages[0].referenceImages.filter((entry) => entry.type === 'character_reference');
  assert.deepEqual(characterReferences, [
    { type: 'character_reference', path: '/tmp/right.png', characterId: 'char_target' },
  ]);
});

test('resolvePreferredVideoProvider defaults to seedance and allows explicit override', () => {
  const previousVideoProvider = process.env.VIDEO_PROVIDER;
  delete process.env.VIDEO_PROVIDER;
  try {
    assert.equal(__testables.resolvePreferredVideoProvider({}), 'seedance');
    assert.equal(__testables.resolvePreferredVideoProvider({ videoProvider: 'seedance' }), 'seedance');
    assert.equal(__testables.resolvePreferredVideoProvider({ videoProvider: 'runway' }), 'sora2');
    assert.equal(__testables.resolvePreferredVideoProvider({ videoProvider: 'fallback_video' }), 'sora2');
  } finally {
    if (previousVideoProvider == null) {
      delete process.env.VIDEO_PROVIDER;
    } else {
      process.env.VIDEO_PROVIDER = previousVideoProvider;
    }
  }
});

test('buildShotPackages routes to seedance when VIDEO_PROVIDER is seedance and a reference image is present', () => {
  const previousVideoProvider = process.env.VIDEO_PROVIDER;
  process.env.VIDEO_PROVIDER = 'seedance';

  try {
    const shotPackages = __testables.buildShotPackages(
      [{ id: 'shot_env_seedance', scene: '回廊', action: '逼近' }],
      [
        {
          shotId: 'shot_env_seedance',
          shotType: 'action_medium',
          durationTargetSec: 4,
          visualGoal: '回廊逼近',
          cameraSpec: { moveType: 'tracking', framing: 'medium', ratio: '9:16' },
        },
      ],
      [{ shotId: 'shot_env_seedance', imagePath: '/tmp/shot_env_seedance.png', success: true }]
    );

    assert.equal(shotPackages.length, 1);
    assert.equal(shotPackages[0].preferredProvider, 'seedance');
    assert.deepEqual(shotPackages[0].fallbackProviders, ['static_image']);
  } finally {
    if (previousVideoProvider == null) {
      delete process.env.VIDEO_PROVIDER;
    } else {
      process.env.VIDEO_PROVIDER = previousVideoProvider;
    }
  }
});
