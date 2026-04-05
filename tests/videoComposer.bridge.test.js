import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables, buildCompositionPlan } from '../src/agents/videoComposer.js';

test('buildCompositionPlan inserts approved bridge clips between primary shots', () => {
  const plan = buildCompositionPlan(
    [
      { id: 'shot_001', dialogue: '起势', duration: 2 },
      { id: 'shot_002', dialogue: '落刀', duration: 2 },
    ],
    [
      { shotId: 'shot_001', imagePath: '/tmp/shot_001.png', success: true },
      { shotId: 'shot_002', imagePath: '/tmp/shot_002.png', success: true },
    ],
    [],
    [],
    [
      { shotId: 'shot_001', videoPath: '/tmp/shot_001.mp4', durationSec: 2 },
      { shotId: 'shot_002', videoPath: '/tmp/shot_002.mp4', durationSec: 2 },
    ],
    [],
    [],
    [
      {
        bridgeId: 'bridge_shot_001_shot_002',
        fromShotId: 'shot_001',
        toShotId: 'shot_002',
        videoPath: '/tmp/bridge_001_002.mp4',
        durationSec: 1.2,
        finalDecision: 'pass',
      },
    ]
  );

  assert.deepEqual(
    plan.map((item) => [item.shotId, item.visualType, item.videoPath || item.imagePath]),
    [
      ['shot_001', 'generated_video_clip', '/tmp/shot_001.mp4'],
      ['bridge:bridge_shot_001_shot_002', 'bridge_clip', '/tmp/bridge_001_002.mp4'],
      ['shot_002', 'generated_video_clip', '/tmp/shot_002.mp4'],
    ]
  );
});

test('insertBridgeClips ignores direct-cut fallback and manual-review bridge entries', () => {
  const timeline = __testables.insertBridgeClips(
    [
      { shotId: 'shot_011', visualType: 'generated_video_clip', videoPath: '/tmp/shot_011.mp4', duration: 2, audioPath: null, dialogue: '' },
      { shotId: 'shot_012', visualType: 'generated_video_clip', videoPath: '/tmp/shot_012.mp4', duration: 2, audioPath: null, dialogue: '' },
    ],
    [
      {
        bridgeId: 'bridge_direct_cut',
        fromShotId: 'shot_011',
        toShotId: 'shot_012',
        videoPath: '/tmp/bridge_direct_cut.mp4',
        durationSec: 1,
        finalDecision: 'fallback_to_direct_cut',
      },
      {
        bridgeId: 'bridge_manual',
        fromShotId: 'shot_011',
        toShotId: 'shot_012',
        videoPath: '/tmp/bridge_manual.mp4',
        durationSec: 1,
        finalDecision: 'manual_review',
      },
    ]
  );

  assert.deepEqual(
    timeline.map((item) => item.shotId),
    ['shot_011', 'shot_012']
  );
});

test('insertBridgeClips ignores bridges whose toShotId is not the next timeline anchor', () => {
  const timeline = __testables.insertBridgeClips(
    [
      { shotId: 'shot_021', visualType: 'generated_video_clip', videoPath: '/tmp/shot_021.mp4', duration: 2, audioPath: null, dialogue: '' },
      { shotId: 'shot_022', visualType: 'generated_video_clip', videoPath: '/tmp/shot_022.mp4', duration: 2, audioPath: null, dialogue: '' },
    ],
    [
      {
        bridgeId: 'bridge_wrong_target',
        fromShotId: 'shot_021',
        toShotId: 'shot_099',
        videoPath: '/tmp/bridge_wrong_target.mp4',
        durationSec: 1,
        finalDecision: 'pass',
      },
    ]
  );

  assert.deepEqual(
    timeline.map((item) => item.shotId),
    ['shot_021', 'shot_022']
  );
});
