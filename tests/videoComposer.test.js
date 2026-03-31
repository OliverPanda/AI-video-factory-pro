import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildAudioTimeline,
  buildCompositionPlan,
  buildVisualSegmentJobs,
  collectExistingAudioItems,
} from '../src/agents/videoComposer.js';

test('buildCompositionPlan prefers animation clips when provided', () => {
  const shots = [{ id: 'shot_1', dialogue: '第一句', duration: 4 }];
  const imageResults = [
    {
      shotId: 'shot_1',
      keyframeAssetId: 'keyframe_1',
      imagePath: '/tmp/shot_1.png',
      success: true,
    },
  ];
  const animationClips = [
    {
      id: 'clip_1',
      shotId: 'shot_1',
      keyframeAssetId: 'keyframe_1',
      videoPath: '/tmp/shot_1.mp4',
      durationSec: 6,
      status: 'ready',
    },
  ];
  const audioResults = [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }];

  const plan = buildCompositionPlan(shots, imageResults, audioResults, animationClips);

  assert.deepEqual(plan, [
    {
      shotId: 'shot_1',
      visualType: 'animation_clip',
      videoPath: '/tmp/shot_1.mp4',
      audioPath: '/tmp/shot_1.mp3',
      dialogue: '第一句',
      duration: 6,
    },
  ]);
});

test('buildCompositionPlan falls back to static image when no animation clip exists', () => {
  const shots = [{ id: 'shot_2', dialogue: '', duration: 3 }];
  const imageResults = [
    {
      shotId: 'shot_2',
      keyframeAssetId: 'keyframe_2',
      imagePath: '/tmp/shot_2.png',
      success: true,
    },
  ];

  const plan = buildCompositionPlan(shots, imageResults, [], []);

  assert.deepEqual(plan, [
    {
      shotId: 'shot_2',
      visualType: 'static_image',
      imagePath: '/tmp/shot_2.png',
      audioPath: null,
      dialogue: '',
      duration: 3,
    },
  ]);
});

test('collectExistingAudioItems skips silent shots without calling existsSync on null paths', () => {
  const plan = [
    {
      shotId: 'shot_1',
      visualType: 'static_image',
      imagePath: '/tmp/shot_1.png',
      audioPath: '/tmp/shot_1.mp3',
      duration: 2,
    },
    {
      shotId: 'shot_2',
      visualType: 'static_image',
      imagePath: '/tmp/shot_2.png',
      audioPath: null,
      duration: 3,
    },
    {
      shotId: 'shot_3',
      visualType: 'animation_clip',
      videoPath: '/tmp/shot_3.mp4',
      audioPath: '/tmp/missing.mp3',
      duration: 4,
    },
  ];
  const existsCalls = [];

  const audioItems = collectExistingAudioItems(plan, (audioPath) => {
    existsCalls.push(audioPath);
    return audioPath === '/tmp/shot_1.mp3';
  });

  assert.deepEqual(existsCalls, ['/tmp/shot_1.mp3', '/tmp/missing.mp3']);
  assert.deepEqual(audioItems, [
    {
      shotId: 'shot_1',
      audioPath: '/tmp/shot_1.mp3',
      offsetMs: 0,
    },
  ]);
});

test('buildAudioTimeline preserves offsets across mixed audio and silent shots', () => {
  const timeline = buildAudioTimeline([
    { shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3', duration: 2 },
    { shotId: 'shot_2', audioPath: null, duration: 3 },
    { shotId: 'shot_3', audioPath: '/tmp/shot_3.mp3', duration: 4 },
  ]);

  assert.deepEqual(timeline, [
    { shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3', offsetMs: 0 },
    { shotId: 'shot_2', audioPath: null, offsetMs: 2000 },
    { shotId: 'shot_3', audioPath: '/tmp/shot_3.mp3', offsetMs: 5000 },
  ]);
});

test('buildVisualSegmentJobs carries animation clips into the segment rendering pipeline', () => {
  const jobs = buildVisualSegmentJobs(
    [
      {
        shotId: 'shot_1',
        visualType: 'animation_clip',
        videoPath: '/tmp/shot_1.mp4',
        duration: 6,
      },
      {
        shotId: 'shot_2',
        visualType: 'static_image',
        imagePath: '/tmp/shot_2.png',
        duration: 3,
      },
    ],
    '/tmp/segments'
  );

  assert.deepEqual(jobs, [
    {
      shotId: 'shot_1',
      visualType: 'animation_clip',
      videoPath: '/tmp/shot_1.mp4',
      duration: 6,
      segmentPath: path.join('/tmp/segments', '000_shot_1.mp4'),
    },
    {
      shotId: 'shot_2',
      visualType: 'static_image',
      imagePath: '/tmp/shot_2.png',
      duration: 3,
      segmentPath: path.join('/tmp/segments', '001_shot_2.mp4'),
    },
  ]);
});

test('buildCompositionPlan supports ShotPlan camelCase duration fields', () => {
  const plan = buildCompositionPlan(
    [{ id: 'shot_1', dialogue: '你好', durationSec: 5 }],
    [{ shotId: 'shot_1', imagePath: '/tmp/shot_1.png', success: true }],
    [],
    []
  );

  assert.equal(plan.length, 1);
  assert.equal(plan[0].duration, 5);
});
