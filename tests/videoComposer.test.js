import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import {
  __testables,
  buildAudioTimeline,
  buildCompositionPlan,
  buildVisualSegmentJobs,
  collectExistingAudioItems,
  composeFromJob,
  composeFromLegacy,
} from '../src/agents/videoComposer.js';

test('buildCompositionPlan prefers generated video clips over animation clips when provided', () => {
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
      videoPath: '/tmp/shot_1-animation.mp4',
      durationSec: 6,
      status: 'ready',
    },
  ];
  const videoClips = [
    {
      shotId: 'shot_1',
      videoPath: '/tmp/shot_1-generated.mp4',
      durationSec: 4.5,
      status: 'completed',
    },
  ];
  const audioResults = [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }];

  const plan = buildCompositionPlan(shots, imageResults, audioResults, [], videoClips, animationClips);

  assert.deepEqual(plan, [
    {
      shotId: 'shot_1',
      visualType: 'generated_video_clip',
      videoPath: '/tmp/shot_1-generated.mp4',
      audioPath: '/tmp/shot_1.mp3',
      dialogue: '第一句',
      duration: 4.5,
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

  const plan = buildCompositionPlan(shots, imageResults, [], [], []);

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

test('buildSubtitleFilterArg uses quoted subtitles syntax that fluent-ffmpeg accepts on Windows paths', () => {
  const filterArg = __testables.buildSubtitleFilterArg(
    'D:\\My-Project\\AI-video-factory-pro\\output\\寒烬宫变\\final-video.ass'
  );

  assert.equal(
    filterArg,
    "subtitles='D\\:/My-Project/AI-video-factory-pro/output/寒烬宫变/final-video.ass'"
  );
});

test('buildCompositionPlan prefers lipsync clips over animation clips', () => {
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
      videoPath: '/tmp/shot_1-anim.mp4',
      durationSec: 5,
      status: 'ready',
    },
  ];
  const lipsyncClips = [
    {
      shotId: 'shot_1',
      videoPath: '/tmp/shot_1-lipsync.mp4',
      durationSec: 4,
      status: 'completed',
    },
  ];
  const audioResults = [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }];

  const plan = buildCompositionPlan(
    shots,
    imageResults,
    audioResults,
    [],
    [],
    animationClips,
    lipsyncClips
  );

  assert.deepEqual(plan, [
    {
      shotId: 'shot_1',
      visualType: 'lipsync_clip',
      videoPath: '/tmp/shot_1-lipsync.mp4',
      audioPath: '/tmp/shot_1.mp3',
      dialogue: '第一句',
      duration: 4,
    },
  ]);
});

test('buildCompositionPlan falls back to animation clips when generated video and lipsync are unavailable', () => {
  const plan = buildCompositionPlan(
    [{ id: 'shot_2', dialogue: '第二句', duration: 3 }],
    [{ shotId: 'shot_2', imagePath: '/tmp/shot_2.png', success: true }],
    [],
    [],
    [],
    [{ shotId: 'shot_2', videoPath: '/tmp/shot_2-anim.mp4', durationSec: 5 }],
    []
  );

  assert.equal(plan[0].visualType, 'animation_clip');
  assert.equal(plan[0].videoPath, '/tmp/shot_2-anim.mp4');
});

test('buildVideoMetrics summarizes composition outputs', () => {
  const metrics = __testables.buildVideoMetrics(
    [
      { shotId: 'shot_1', duration: 2, dialogue: '你好' },
      { shotId: 'shot_2', duration: 3, dialogue: '' },
    ],
    '/tmp/final-video.mp4'
  );

  assert.deepEqual(metrics, {
    composed_shot_count: 2,
    subtitle_count: 1,
    total_duration_sec: 5,
    output_path: '/tmp/final-video.mp4',
  });
});

test('adaptLegacyComposeInput maps current agent outputs into normalized protocol shapes', () => {
  const adapted = __testables.adaptLegacyComposeInput({
    shots: [
      { id: 'shot_1', dialogue: '你好', durationSec: 5, speaker: '沈清' },
      { id: 'shot_2', dialogue: '', duration: 3 },
    ],
    imageResults: [{ shotId: 'shot_1', keyframeAssetId: 'kf_1', imagePath: '/tmp/shot_1.png', success: true }],
    audioResults: [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }],
    animationClips: [{ shotId: 'shot_2', videoPath: '/tmp/shot_2-anim.mp4', durationSec: 3 }],
    lipsyncResults: [{ shotId: 'shot_1', videoPath: '/tmp/shot_1-lipsync.mp4', durationSec: 5 }],
  });

  assert.deepEqual(adapted.normalizedShots, [
    {
      shotId: 'shot_1',
      order: 0,
      durationMs: 5000,
      dialogue: '你好',
      speakerId: '沈清',
      subtitleSource: '你好',
      metadata: {
        dialogueDurationMs: null,
        camera_type: undefined,
        cameraType: undefined,
        isCloseUp: undefined,
        visualSpeechRequired: undefined,
      },
    },
    {
      shotId: 'shot_2',
      order: 1,
      durationMs: 3000,
      dialogue: '',
      speakerId: '',
      subtitleSource: '',
      metadata: {
        dialogueDurationMs: null,
        camera_type: undefined,
        cameraType: undefined,
        isCloseUp: undefined,
        visualSpeechRequired: undefined,
      },
    },
  ]);
  assert.equal(adapted.assets.visuals.length, 1);
  assert.equal(adapted.assets.audios.length, 1);
  assert.equal(adapted.assets.clips.length, 2);
});

test('composeFromLegacy blocks before render when tts qa is blocked', async () => {
  const result = await composeFromLegacy(
    {
      shots: [{ id: 'shot_1', dialogue: '你好', durationSec: 3 }],
      imageResults: [{ shotId: 'shot_1', imagePath: '/tmp/shot_1.png', success: true }],
      audioResults: [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }],
      ttsQaReport: {
        status: 'block',
        blockers: ['镜头 shot_1 音频缺失'],
      },
    },
    '/tmp/final-video.mp4',
    {
      checkFFmpeg: async () => {
        throw new Error('should not run ffmpeg check');
      },
    }
  );

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.report.blockedReasons, ['镜头 shot_1 音频缺失']);
});

test('composeFromLegacy returns structured result and warning summary after render', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-compose-legacy-'));
  const imagePath = path.join(tempRoot, 'shot_1.png');
  const audioPath = path.join(tempRoot, 'shot_1.mp3');
  fs.writeFileSync(imagePath, 'fake-image');
  fs.writeFileSync(audioPath, 'fake-audio');

  const result = await composeFromLegacy(
    {
      shots: [{ id: 'shot_1', dialogue: '你好', durationSec: 3 }],
      imageResults: [{ shotId: 'shot_1', imagePath, success: true }],
      audioResults: [{ shotId: 'shot_1', audioPath }],
      lipsyncReport: {
        status: 'warn',
        warnings: ['shot_1:manual_review_required_without_evaluator'],
        fallbackCount: 1,
        fallbackShots: ['shot_1'],
        downgradedCount: 0,
        manualReviewShots: ['shot_1'],
      },
      ttsQaReport: {
        status: 'warn',
        warnings: ['镜头 shot_1 使用了 fallback voice'],
        manualReviewPlan: { recommendedShotIds: ['shot_1'] },
      },
    },
    path.join(tempRoot, 'final-video.mp4'),
    {
      checkFFmpeg: async () => {},
      allowedRoots: [tempRoot],
      generateSubtitleFile: () => {},
      mergeWithFFmpeg: async () => {},
    }
  );

  assert.equal(result.status, 'completed_with_warnings');
  assert.equal(result.outputVideo.uri, path.join(tempRoot, 'final-video.mp4'));
  assert.deepEqual(result.report.manualReviewShots, ['shot_1']);
  assert.equal(result.report.fallbackCount, 1);
  assert.equal(result.report.qaSummary.deliveryReadiness, 'warn');

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('composeFromJob adapts platform job assets into legacy-compatible render inputs', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-compose-job-'));
  const imagePath = path.join(tempRoot, 'shot_1.png');
  const audioPath = path.join(tempRoot, 'shot_1.mp3');
  const lipsyncPath = path.join(tempRoot, 'shot_1-lipsync.mp4');
  fs.writeFileSync(imagePath, 'fake-image');
  fs.writeFileSync(audioPath, 'fake-audio');
  fs.writeFileSync(lipsyncPath, 'fake-video');

  const result = await composeFromJob(
    {
      jobId: 'job_1',
      projectId: 'project_1',
      episodeId: 'episode_1',
      profile: {},
      shots: [
        {
          shotId: 'shot_1',
          order: 0,
          durationMs: 4000,
          dialogue: '第一句',
          visualRef: imagePath,
          audioRef: audioPath,
          lipsyncRef: lipsyncPath,
        },
      ],
      assets: {
        visuals: [{ shotId: 'shot_1', type: 'image', uri: imagePath }],
        audios: [{ shotId: 'shot_1', type: 'audio', uri: audioPath }],
        clips: [{ shotId: 'shot_1', role: 'lipsync', type: 'video', uri: lipsyncPath, durationSec: 4 }],
      },
    },
    path.join(tempRoot, 'final-video.mp4'),
    {
      checkFFmpeg: async () => {},
      allowedRoots: [tempRoot],
      generateSubtitleFile: () => {},
      mergeWithFFmpeg: async () => {},
    }
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.jobId, 'job_1');
  assert.equal(result.outputVideo.uri, path.join(tempRoot, 'final-video.mp4'));

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
