import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables } from '../src/agents/director.js';

test('attachShotReferenceImagesToPrompts injects character reference stacks into initial image prompts', () => {
  const prompts = [{ shotId: 'shot_001', image_prompt: 'prompt', negative_prompt: 'neg' }];
  const shots = [{ id: 'shot_001', characters: ['沈清'] }];
  const characterRegistry = [
    {
      id: 'char_1',
      episodeCharacterId: 'char_1',
      name: '沈清',
      referenceImages: ['refs/front.png', { path: 'refs/side.png' }],
      referenceImagePath: 'refs/ref-sheet.png',
    },
  ];

  const enriched = __testables.attachShotReferenceImagesToPrompts(prompts, shots, characterRegistry);

  assert.deepEqual(enriched, [
    {
      shotId: 'shot_001',
      image_prompt: 'prompt',
      negative_prompt: 'neg',
      referenceImages: ['refs/front.png', 'refs/side.png', 'refs/ref-sheet.png'],
    },
  ]);
});

test('attachShotReferenceImagesToPrompts inherits contextual character refs for character-less shots and preserves existing refs', () => {
  const prompts = [
    {
      shotId: 'shot_004',
      image_prompt: 'warning flash',
      negative_prompt: 'neg',
      referenceImages: ['refs/existing.png'],
    },
  ];
  const shots = [
    { id: 'shot_003', scene: '虚空蓝光', characters: ['陆衍'] },
    { id: 'shot_004', scene: '虚空蓝光', characters: [] },
    { id: 'shot_005', scene: '虚空蓝光', characters: ['陆衍'] },
  ];
  const characterRegistry = [
    {
      id: 'char_1',
      episodeCharacterId: 'char_1',
      name: '陆衍',
      referenceImagePath: 'refs/luyan-sheet.png',
      referenceImages: [],
    },
  ];

  const enriched = __testables.attachShotReferenceImagesToPrompts(prompts, shots, characterRegistry);

  assert.deepEqual(enriched, [
    {
      shotId: 'shot_004',
      image_prompt: 'warning flash',
      negative_prompt: 'neg',
      referenceImages: ['refs/existing.png', 'refs/luyan-sheet.png'],
    },
  ]);
});
