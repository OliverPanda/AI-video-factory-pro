import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __testables,
  buildCharacterRegistry,
  getCharacterTokens,
  resolveShotParticipants,
  resolveShotSpeaker,
} from '../src/agents/characterRegistry.js';

test('buildCharacterRegistry merges Chinese source names with English generated aliases by position', async () => {
  const sourceCharacters = [
    { name: '陈默', gender: 'male', age: '30岁' },
    { name: '阿鬼', gender: 'male', age: '28岁' },
    { name: '林霜', gender: 'female', age: '26岁' },
  ];

  const generatedCharacters = [
    {
      name: 'Chen Mo',
      visualDescription: 'man in black tactical suit',
      basePromptTokens: 'short black hair, black tactical suit',
      personality: '冷静',
    },
    {
      name: 'Ah Gui',
      visualDescription: 'man in gray hoodie',
      basePromptTokens: 'gray hoodie, hood up',
      personality: '诡秘',
    },
    {
      name: 'Lin Shuang',
      visualDescription: 'woman in black leather jacket',
      basePromptTokens: 'shoulder-length black hair, black leather jacket',
      personality: '坚定',
    },
  ];

  const registry = await buildCharacterRegistry(sourceCharacters, 'script context', 'realistic', {
    chatJSON: async () => ({ characters: generatedCharacters }),
  });

  assert.equal(registry.length, 3);
  assert.deepEqual(
    registry.map((card) => card.name),
    ['陈默', '阿鬼', '林霜']
  );
  assert.equal(registry[0].aliases.includes('Chen Mo'), true);
  assert.equal(registry[1].aliases.includes('Ah Gui'), true);
  assert.equal(registry[2].aliases.includes('Lin Shuang'), true);
  assert.equal(getCharacterTokens('陈默', registry), 'short black hair, black tactical suit');
  assert.equal(getCharacterTokens('Chen Mo', registry), 'short black hair, black tactical suit');
});

test('resolveShotParticipants and speaker resolution stay ID-first when duplicate display names exist', () => {
  const registry = [
    { id: 'char-zh', episodeCharacterId: 'char-zh', name: '沈清', aliases: ['Shen Qing'] },
    { id: 'char-en', episodeCharacterId: 'char-en', name: '沈清', aliases: ['Shen Qing Clone'] },
  ];
  const shot = {
    id: 'shot_001',
    speaker: 'Shen Qing',
    shotCharacters: [
      { episodeCharacterId: 'char-en', characterName: '沈清', isSpeaker: true },
      { episodeCharacterId: 'char-zh', characterName: '沈清' },
    ],
  };

  const participants = resolveShotParticipants(shot, registry);
  const speaker = resolveShotSpeaker(shot, registry);

  assert.equal(participants.length, 2);
  assert.equal(participants[0].character.episodeCharacterId, 'char-en');
  assert.equal(participants[1].character.episodeCharacterId, 'char-zh');
  assert.equal(speaker.character.episodeCharacterId, 'char-en');
});

test('findCharacterByIdentity does not treat display name as primary identity', () => {
  const registry = [
    { id: 'char-a', episodeCharacterId: 'char-a', name: '沈清' },
    { id: 'char-b', episodeCharacterId: 'char-b', name: '沈清' },
  ];

  assert.equal(__testables.findCharacterByIdentity(registry, 'char-b').episodeCharacterId, 'char-b');
  assert.equal(__testables.findCharacterByIdentity(registry, '沈清'), null);
});

test('resolveShotSpeaker does not bind ambiguous duplicate names by name-only speaker field', () => {
  const registry = [
    { id: 'char-a', episodeCharacterId: 'char-a', name: '沈清' },
    { id: 'char-b', episodeCharacterId: 'char-b', name: '沈清' },
  ];
  const shot = {
    id: 'shot_002',
    speaker: '沈清',
    shotCharacters: [
      { episodeCharacterId: 'char-a', characterName: '沈清' },
      { episodeCharacterId: 'char-b', characterName: '沈清' },
    ],
  };

  const speaker = resolveShotSpeaker(shot, registry);

  assert.equal(speaker.character, null);
  assert.equal(speaker.name, '沈清');
});
