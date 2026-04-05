import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompositionPlan } from '../src/agents/videoComposer.js';

test('buildCompositionPlan lets approved sequence clips cover multiple shots and keeps downstream bridge insertion', () => {
  const plan = buildCompositionPlan(
    [
      { id: 'shot_001', dialogue: '起势', duration: 2 },
      { id: 'shot_002', dialogue: '接招', duration: 2 },
      { id: 'shot_003', dialogue: '反击', duration: 2 },
    ],
    [
      { shotId: 'shot_001', imagePath: '/tmp/shot_001.png', success: true },
      { shotId: 'shot_002', imagePath: '/tmp/shot_002.png', success: true },
      { shotId: 'shot_003', imagePath: '/tmp/shot_003.png', success: true },
    ],
    [],
    [
      {
        sequenceId: 'sequence_001_002',
        coveredShotIds: ['shot_001', 'shot_002'],
        videoPath: '/tmp/sequence_001_002.mp4',
        durationSec: 4.2,
        finalDecision: 'pass',
      },
    ],
    [
      { shotId: 'shot_001', videoPath: '/tmp/shot_001.mp4', durationSec: 2 },
      { shotId: 'shot_002', videoPath: '/tmp/shot_002.mp4', durationSec: 2 },
      { shotId: 'shot_003', videoPath: '/tmp/shot_003.mp4', durationSec: 2 },
    ],
    [],
    [],
    [
      {
        bridgeId: 'bridge_shot_002_shot_003',
        fromShotId: 'shot_002',
        toShotId: 'shot_003',
        videoPath: '/tmp/bridge_002_003.mp4',
        durationSec: 1.1,
        finalDecision: 'pass',
      },
      {
        bridgeId: 'bridge_shot_001_shot_002',
        fromShotId: 'shot_001',
        toShotId: 'shot_002',
        videoPath: '/tmp/bridge_001_002.mp4',
        durationSec: 1,
        finalDecision: 'pass',
      },
    ]
  );

  assert.deepEqual(
    plan.map((item) => [item.shotId, item.visualType, item.videoPath || item.imagePath]),
    [
      ['sequence:sequence_001_002', 'sequence_clip', '/tmp/sequence_001_002.mp4'],
      ['bridge:bridge_shot_002_shot_003', 'bridge_clip', '/tmp/bridge_002_003.mp4'],
      ['shot_003', 'generated_video_clip', '/tmp/shot_003.mp4'],
    ]
  );
});

test('buildCompositionPlan ignores non-pass sequence clips and falls back to shot visuals', () => {
  const plan = buildCompositionPlan(
    [
      { id: 'shot_011', dialogue: '逼近', duration: 2 },
      { id: 'shot_012', dialogue: '出手', duration: 2 },
    ],
    [
      { shotId: 'shot_011', imagePath: '/tmp/shot_011.png', success: true },
      { shotId: 'shot_012', imagePath: '/tmp/shot_012.png', success: true },
    ],
    [],
    [
      {
        sequenceId: 'sequence_011_012',
        coveredShotIds: ['shot_011', 'shot_012'],
        videoPath: '/tmp/sequence_011_012.mp4',
        durationSec: 4,
        finalDecision: 'manual_review',
      },
    ],
    [
      { shotId: 'shot_011', videoPath: '/tmp/shot_011.mp4', durationSec: 2 },
      { shotId: 'shot_012', videoPath: '/tmp/shot_012.mp4', durationSec: 2 },
    ],
    [],
    [],
    []
  );

  assert.deepEqual(
    plan.map((item) => item.shotId),
    ['shot_011', 'shot_012']
  );
  assert.deepEqual(
    plan.map((item) => item.visualType),
    ['generated_video_clip', 'generated_video_clip']
  );
});

test('buildCompositionPlan ignores overlapping or non-contiguous sequence clips', () => {
  const plan = buildCompositionPlan(
    [
      { id: 'shot_101', duration: 2 },
      { id: 'shot_102', duration: 2 },
      { id: 'shot_103', duration: 2 },
    ],
    [
      { shotId: 'shot_101', imagePath: '/tmp/shot_101.png', success: true },
      { shotId: 'shot_102', imagePath: '/tmp/shot_102.png', success: true },
      { shotId: 'shot_103', imagePath: '/tmp/shot_103.png', success: true },
    ],
    [],
    [
      {
        sequenceId: 'sequence_valid',
        coveredShotIds: ['shot_101', 'shot_102'],
        videoPath: '/tmp/sequence_valid.mp4',
        durationSec: 4,
        finalDecision: 'pass',
      },
      {
        sequenceId: 'sequence_overlap',
        coveredShotIds: ['shot_102', 'shot_103'],
        videoPath: '/tmp/sequence_overlap.mp4',
        durationSec: 4,
        finalDecision: 'pass',
      },
      {
        sequenceId: 'sequence_non_contiguous',
        coveredShotIds: ['shot_101', 'shot_103'],
        videoPath: '/tmp/sequence_non_contiguous.mp4',
        durationSec: 4,
        finalDecision: 'pass',
      },
    ],
    [
      { shotId: 'shot_101', videoPath: '/tmp/shot_101.mp4', durationSec: 2 },
      { shotId: 'shot_102', videoPath: '/tmp/shot_102.mp4', durationSec: 2 },
      { shotId: 'shot_103', videoPath: '/tmp/shot_103.mp4', durationSec: 2 },
    ],
    [],
    [],
    []
  );

  assert.deepEqual(
    plan.map((item) => item.shotId),
    ['sequence:sequence_valid', 'shot_103']
  );
});

test('buildCompositionPlan ignores pass sequence clips that do not actually cover multiple unique shots', () => {
  const plan = buildCompositionPlan(
    [
      { id: 'shot_201', duration: 2 },
      { id: 'shot_202', duration: 2 },
    ],
    [
      { shotId: 'shot_201', imagePath: '/tmp/shot_201.png', success: true },
      { shotId: 'shot_202', imagePath: '/tmp/shot_202.png', success: true },
    ],
    [],
    [
      {
        sequenceId: 'sequence_single',
        coveredShotIds: ['shot_201'],
        videoPath: '/tmp/sequence_single.mp4',
        durationSec: 2,
        finalDecision: 'pass',
      },
      {
        sequenceId: 'sequence_duplicate',
        coveredShotIds: ['shot_201', 'shot_201'],
        videoPath: '/tmp/sequence_duplicate.mp4',
        durationSec: 4,
        finalDecision: 'pass',
      },
    ],
    [
      { shotId: 'shot_201', videoPath: '/tmp/shot_201.mp4', durationSec: 2 },
      { shotId: 'shot_202', videoPath: '/tmp/shot_202.mp4', durationSec: 2 },
    ],
    [],
    [],
    []
  );

  assert.deepEqual(
    plan.map((item) => item.shotId),
    ['shot_201', 'shot_202']
  );
  assert.deepEqual(
    plan.map((item) => item.visualType),
    ['generated_video_clip', 'generated_video_clip']
  );
});
