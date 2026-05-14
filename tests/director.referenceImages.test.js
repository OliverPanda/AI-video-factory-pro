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
