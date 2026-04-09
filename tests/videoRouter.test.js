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
    referenceImages: [{ type: 'keyframe', path: '/tmp/shot_001.png' }],
    preferredProvider: 'seedance',
    fallbackProviders: ['static_image'],
    providerRequestHints: {
      shotId: 'shot_001',
      scene: '大殿',
      action: '对峙',
      hasReferenceImage: true,
      promptSource: 'prompt_list',
      targetModelTier: 'enhanced',
      requestedDurationSec: 4,
      requestedRatio: '9:16',
      requestedMoveType: 'slow_dolly',
      referenceImagePath: '/tmp/shot_001.png',
    },
    audioRef: null,
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
