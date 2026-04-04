import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables, routeVideoShots } from '../src/agents/videoRouter.js';

test('buildShotPackages assembles complete shotPackage and prefers runway when reference image exists', () => {
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
    preferredProvider: 'runway',
    fallbackProviders: ['static_image'],
    audioRef: null,
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
    {}
  );

  assert.equal(shotPackages[0].preferredProvider, 'static_image');
  assert.deepEqual(shotPackages[0].referenceImages, []);
  assert.deepEqual(shotPackages[0].fallbackProviders, []);
});
