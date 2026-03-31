import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEpisode,
  createProject,
  createScript,
  createShotPlan,
} from '../src/domain/projectModel.js';
import {
  createAnimationClip,
  createEpisodeCut,
  createKeyframeAsset,
  createSubtitleAsset,
  createVoiceAsset,
} from '../src/domain/assetModel.js';

test('createProject sets default status and timestamps', () => {
  const project = createProject({ name: '宫廷短剧', code: 'gongting' });

  assert.equal(project.name, '宫廷短剧');
  assert.equal(project.code, 'gongting');
  assert.equal(project.status, 'draft');
  assert.equal(typeof project.id, 'string');
  assert.equal(typeof project.createdAt, 'string');
  assert.equal(typeof project.updatedAt, 'string');
  assert.equal(project.createdAt, project.updatedAt);
  assert.ok(!Number.isNaN(Date.parse(project.createdAt)));
});

test('createScript sets default status and timestamps', () => {
  const script = createScript({ projectId: 'p1', title: '第一卷', sourceText: '原始剧本' });

  assert.equal(script.projectId, 'p1');
  assert.equal(script.title, '第一卷');
  assert.equal(script.sourceText, '原始剧本');
  assert.equal(script.status, 'draft');
  assert.equal(typeof script.id, 'string');
  assert.equal(typeof script.createdAt, 'string');
  assert.equal(typeof script.updatedAt, 'string');
  assert.equal(script.createdAt, script.updatedAt);
});

test('createEpisode defaults targetDurationSec to 90 seconds', () => {
  const episode = createEpisode({ projectId: 'p1', scriptId: 's1', episodeNo: 1 });

  assert.equal(episode.projectId, 'p1');
  assert.equal(episode.scriptId, 's1');
  assert.equal(episode.episodeNo, 1);
  assert.equal(episode.targetDurationSec, 90);
  assert.equal(episode.status, 'draft');
});

test('createEpisode clamps targetDurationSec below 90 to 90', () => {
  const episode = createEpisode({
    projectId: 'p1',
    scriptId: 's1',
    episodeNo: 1,
    targetDurationSec: 30,
  });

  assert.equal(episode.targetDurationSec, 90);
});

test('createEpisode clamps targetDurationSec above 180 to 180', () => {
  const episode = createEpisode({
    projectId: 'p1',
    scriptId: 's1',
    episodeNo: 1,
    targetDurationSec: 240,
  });

  assert.equal(episode.targetDurationSec, 180);
});

test('createShotPlan preserves core shot fields', () => {
  const shotPlan = createShotPlan({
    projectId: 'p1',
    scriptId: 's1',
    episodeId: 'e1',
    shotNo: 3,
    scene: '室内',
    goal: '争取线索',
    action: '翻找抽屉',
    dialogue: '这里应该有答案',
    emotion: '紧张',
    cameraType: 'medium_shot',
    cameraMovement: 'push_in',
    durationSec: 12,
    continuitySourceShotId: 'sh2',
  });

  assert.equal(shotPlan.projectId, 'p1');
  assert.equal(shotPlan.scriptId, 's1');
  assert.equal(shotPlan.episodeId, 'e1');
  assert.equal(shotPlan.shotNo, 3);
  assert.equal(shotPlan.status, 'draft');
  assert.equal(shotPlan.continuitySourceShotId, 'sh2');
});

test('createKeyframeAsset sets default status', () => {
  const asset = createKeyframeAsset({
    shotId: 'sh1',
    prompt: 'character portrait',
    imagePath: '/tmp/keyframe.png',
  });

  assert.equal(asset.shotId, 'sh1');
  assert.equal(asset.prompt, 'character portrait');
  assert.equal(asset.imagePath, '/tmp/keyframe.png');
  assert.equal(asset.status, 'draft');
  assert.equal(typeof asset.id, 'string');
});

test('createAnimationClip supports sourceMode', () => {
  const clip = createAnimationClip({
    shotId: 'sh1',
    keyframeAssetId: 'kf1',
    sourceMode: 'single_keyframe',
  });

  assert.equal(clip.shotId, 'sh1');
  assert.equal(clip.keyframeAssetId, 'kf1');
  assert.equal(clip.sourceMode, 'single_keyframe');
  assert.equal(clip.status, 'draft');
});

test('createAnimationClip falls back to single_keyframe for invalid sourceMode', () => {
  const clip = createAnimationClip({
    shotId: 'sh1',
    keyframeAssetId: 'kf1',
    sourceMode: 'not_a_real_mode',
  });

  assert.equal(clip.sourceMode, 'single_keyframe');
});

test('createVoiceAsset sets shot and speaker linkage fields', () => {
  const asset = createVoiceAsset({
    shotId: 'sh1',
    episodeCharacterId: 'c1',
    audioPath: '/tmp/voice.mp3',
  });

  assert.equal(asset.shotId, 'sh1');
  assert.equal(asset.episodeCharacterId, 'c1');
  assert.equal(asset.audioPath, '/tmp/voice.mp3');
  assert.equal(asset.status, 'draft');
});

test('createSubtitleAsset records subtitle text and status', () => {
  const asset = createSubtitleAsset({
    shotId: 'sh1',
    text: '你好，世界',
    startTime: 0,
    endTime: 2.5,
  });

  assert.equal(asset.shotId, 'sh1');
  assert.equal(asset.text, '你好，世界');
  assert.equal(asset.startTime, 0);
  assert.equal(asset.endTime, 2.5);
  assert.equal(asset.status, 'draft');
});

test('createEpisodeCut records output path and status', () => {
  const cut = createEpisodeCut({
    episodeId: 'e1',
    outputPath: '/tmp/episode-1.mp4',
  });

  assert.equal(cut.episodeId, 'e1');
  assert.equal(cut.outputPath, '/tmp/episode-1.mp4');
  assert.equal(cut.status, 'draft');
});
