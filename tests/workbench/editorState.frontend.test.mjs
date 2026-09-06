import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileShotSceneDraft, revertFailedShotPatch } from '../../views/src/pages/editorState.ts';

test('revertFailedShotPatch only rolls back fields from the failed patch', () => {
  const previous = {
    id: 'shot_001',
    index: 0,
    title: '镜头 01',
    scene: '旧场景',
    sceneId: 'scene_old',
    characters: ['角色A'],
    action: '',
    dialogue: '旧对白',
    emotion: 'calm',
    speaker: '角色A',
    durationSec: 3,
    cameraType: 'wide',
    subtitle: '',
    imageUrl: null,
    videoUrl: null,
    audioUrl: null,
    prompt: null,
    negativePrompt: null,
    provider: null,
    status: 'pass',
    hasDialogue: true,
  };

  const current = {
    ...previous,
    dialogue: '失败前的对白',
    emotion: 'tense',
    scene: '新场景',
  };

  const reverted = revertFailedShotPatch(current, previous, { dialogue: '失败前的对白' });

  assert.equal(reverted.dialogue, '旧对白');
  assert.equal(reverted.hasDialogue, true);
  assert.equal(reverted.emotion, 'tense');
  assert.equal(reverted.scene, '新场景');
});

test('reconcileShotSceneDraft keeps scene text and syncs sceneId to the matching scene pack', () => {
  const shot = {
    id: 'shot_001',
    index: 0,
    title: '镜头 01',
    scene: '旧场景',
    sceneId: 'scene_old',
    characters: [],
    action: '',
    dialogue: '',
    emotion: '',
    speaker: '',
    durationSec: 3,
    cameraType: 'wide',
    subtitle: '',
    imageUrl: null,
    videoUrl: null,
    audioUrl: null,
    prompt: null,
    negativePrompt: null,
    provider: null,
    status: 'pass',
    hasDialogue: false,
  };

  const scenes = [
    { id: 'scene_old', title: '旧场景' },
    { id: 'scene_new', title: '新场景' },
  ];

  const matched = reconcileShotSceneDraft(shot, scenes, '新场景');
  assert.equal(matched.scene, '新场景');
  assert.equal(matched.sceneId, 'scene_new');

  const unmatched = reconcileShotSceneDraft(shot, scenes, '自由输入场景');
  assert.equal(unmatched.scene, '自由输入场景');
  assert.equal(unmatched.sceneId, null);
});
