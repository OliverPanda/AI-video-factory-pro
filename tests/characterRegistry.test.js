import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __testables,
  buildEpisodeCharacterRegistry,
  buildCharacterRegistry,
  getShotCharacterIdentityAnchors,
  getShotForbiddenIdentityTokens,
  getCharacterTokens,
  getSanitizedCharacterTokens,
  getShotCharacterTokens,
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

test('getSanitizedCharacterTokens returns character identity tokens without scene props', () => {
  assert.equal(
    getSanitizedCharacterTokens({
      basePromptTokens: 'short black hair, black tactical suit, metal ladder, concrete pillar, corridor wall',
      visualDescription: 'fallback should not be used',
    }),
    'short black hair, black tactical suit'
  );
  assert.equal(
    getSanitizedCharacterTokens({ visualDescription: 'young woman, pale hanfu, wooden door' }),
    'young woman, pale hanfu'
  );
  assert.equal(getSanitizedCharacterTokens({}), '');
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

test('getShotCharacterTokens stays ID-first under duplicate display names in shotCharacters', () => {
  const registry = [
    {
      id: 'char-zh',
      episodeCharacterId: 'char-zh',
      name: '沈清',
      basePromptTokens: 'long black hair, red hanfu',
    },
    {
      id: 'char-en',
      episodeCharacterId: 'char-en',
      name: '沈清',
      basePromptTokens: 'short silver hair, black tactical suit',
    },
  ];
  const shot = {
    id: 'shot_001',
    shotCharacters: [
      { episodeCharacterId: 'char-en', characterName: '沈清', sortOrder: 1 },
      { episodeCharacterId: 'char-zh', characterName: '沈清', sortOrder: 2 },
    ],
  };

  assert.equal(
    getShotCharacterTokens(shot, registry),
    'short silver hair, black tactical suit, long black hair, red hanfu'
  );
});

test('findCharacterByIdentity does not treat display name as primary identity', () => {
  const registry = [
    { id: 'char-a', episodeCharacterId: 'char-a', name: '沈清' },
    { id: 'char-b', episodeCharacterId: 'char-b', name: '沈清' },
  ];

  assert.equal(__testables.findCharacterByIdentity(registry, 'char-b').episodeCharacterId, 'char-b');
  assert.equal(__testables.findCharacterByIdentity(registry, '沈清'), null);
});

test('sanitizeCharacterIdentityTokens removes scene props from identity anchors', () => {
  const sanitized = __testables.sanitizeCharacterIdentityTokens(
    'man, 28, gray hoodie, hood up, three-sided dagger, metal ladder, concrete pillar, black gloves'
  );

  assert.equal(
    sanitized,
    'man, 28, gray hoodie, hood up, three-sided dagger, black gloves'
  );
});

test('buildCharacterRegistry sanitizes generated identity tokens before saving to registry', async () => {
  const registry = await buildCharacterRegistry(
    [{ name: '阿鬼', gender: 'male', age: '28岁' }],
    'warehouse standoff',
    'realistic',
    {
      chatJSON: async () => ({
        characters: [
          {
            name: 'Ah Gui',
            visualDescription: 'man in gray hoodie standing on a metal ladder',
            basePromptTokens: 'man, 28, gray hoodie, hood up, three-sided dagger, metal ladder',
            personality: '阴冷',
          },
        ],
      }),
    }
  );

  assert.equal(registry.length, 1);
  assert.equal(registry[0].basePromptTokens, 'man, 28, gray hoodie, hood up, three-sided dagger');
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

test('buildEpisodeCharacterRegistry exposes priority and reference assets from Character Bible', () => {
  const registry = buildEpisodeCharacterRegistry(
    [{ id: 'tpl_1', name: '沈清', priority: 'support' }],
    [
      {
        id: 'char_1',
        name: '沈清',
        characterBibleId: 'bible_1',
        mainCharacterTemplateId: 'tpl_1',
      },
    ],
    [
      {
        id: 'bible_1',
        identityAnchor: 'short black hair, red coat',
        priority: 'lead',
        referenceImages: ['ref/front.png'],
        negativeDriftTokens: 'different hairstyle',
      },
    ]
  );

  assert.equal(registry[0].priority, 'lead');
  assert.deepEqual(registry[0].referenceImages, ['ref/front.png']);
  assert.equal(registry[0].negativeDriftTokens, 'different hairstyle');
  assert.equal(registry[0].characterBibleId, 'bible_1');
  assert.equal(registry[0].identityAnchor, 'short black hair, red coat');
  assert.equal(registry[0].forbiddenIdentityTokens, 'different hairstyle');
});

test('buildEpisodeCharacterRegistry prioritizes explicit runtime override for priority', () => {
  const registry = buildEpisodeCharacterRegistry(
    [{ id: 'tpl_1', name: '沈清', priority: 'support' }],
    [
      {
        id: 'char_1',
        name: '沈清',
        characterBibleId: 'bible_1',
        priority: 'lead',
        mainCharacterTemplateId: 'tpl_1',
      },
    ],
    [
      {
        id: 'bible_1',
        priority: 'support',
      },
    ]
  );

  assert.equal(registry[0].priority, 'lead');
});

test('buildEpisodeCharacterRegistry falls back to support priority when no source provides one', () => {
  const registry = buildEpisodeCharacterRegistry(
    [{ id: 'tpl_1', name: '沈清' }],
    [
      {
        id: 'char_1',
        name: '沈清',
        mainCharacterTemplateId: 'tpl_1',
      },
    ],
    []
  );

  assert.equal(registry[0].priority, 'support');
});

test('buildEpisodeCharacterRegistry exposes identity anchor and style family for prompt consumers', () => {
  const registry = buildEpisodeCharacterRegistry(
    [
      {
        id: 'tpl_1',
        name: '沈清',
        identityAnchor: 'short black hair, red coat',
        styleFamily: 'realistic',
      },
    ],
    [
      {
        id: 'char_1',
        name: '沈清',
        mainCharacterTemplateId: 'tpl_1',
      },
    ],
    []
  );

  assert.equal(registry[0].identityAnchor, 'short black hair, red coat');
  assert.equal(registry[0].styleFamily, 'realistic');
});

test('buildEpisodeCharacterRegistry episode path normalizes non-array bible referenceImages to []', () => {
  const registry = buildEpisodeCharacterRegistry(
    [{ id: 'tpl_1', name: '沈清' }],
    [
      {
        id: 'char_1',
        name: '沈清',
        characterBibleId: 'bible_1',
        mainCharacterTemplateId: 'tpl_1',
      },
    ],
    [
      {
        id: 'bible_1',
        referenceImages: 'bad',
      },
    ]
  );

  assert.deepEqual(registry[0].referenceImages, []);
});

test('buildEpisodeCharacterRegistry accepts parsed episode characters with names but no ids', () => {
  const registry = buildEpisodeCharacterRegistry(
    [],
    [
      { name: '陆衍' },
      null,
      { name: '零' },
    ],
    []
  );

  assert.equal(registry.length, 2);
  assert.equal(registry[0].name, '陆衍');
  assert.equal(registry[0].id, 'episode_character_陆衍');
  assert.equal(registry[0].episodeCharacterId, 'episode_character_陆衍');
  assert.equal(registry[0].mainCharacterTemplateId, null);
  assert.equal(registry[1].name, '零');
  assert.equal(registry[1].id, 'episode_character_零');
});

test('buildCharacterRegistry regular merge path exposes stable runtime contract fields with defaults', async () => {
  const registry = await buildCharacterRegistry(
    [{ id: 'char_src_1', name: '阿鬼', gender: 'male', age: '28岁' }],
    'script context',
    'realistic',
    {
      chatJSON: async () => ({
        characters: [
          {
            name: 'Ah Gui',
            visualDescription: 'man in gray hoodie',
            basePromptTokens: 'gray hoodie, hood up',
            personality: '诡秘',
          },
        ],
      }),
    }
  );

  assert.equal(registry.length, 1);
  assert.equal(registry[0].name, '阿鬼');
  assert.equal(registry[0].characterBibleId, null);
  assert.equal(registry[0].priority, 'support');
  assert.deepEqual(registry[0].referenceImages, []);
  assert.equal(registry[0].negativeDriftTokens, null);
});

test('mergeCharacterSources does not reuse consumed source during partial exact match with index fallback', () => {
  const merged = __testables.mergeCharacterSources(
    [
      { name: 'B', basePromptTokens: 'token-b' },
      { name: 'Unknown', basePromptTokens: 'token-x' },
      { name: 'C', basePromptTokens: 'token-c' },
    ],
    [
      { id: 'src-a', episodeCharacterId: 'src-a', name: 'A' },
      { id: 'src-b', episodeCharacterId: 'src-b', name: 'B' },
      { id: 'src-c', episodeCharacterId: 'src-c', name: 'C' },
    ]
  );

  const countsById = merged.reduce((acc, character) => {
    const id = character?.id;
    if (!id) return acc;
    acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {});

  assert.equal(countsById['src-a'], 1);
  assert.equal(countsById['src-b'], 1);
  assert.equal(countsById['src-c'], 1);
});

test('mergeCharacterSources does not hard-bind unmatched generated character to remaining source by index', () => {
  const merged = __testables.mergeCharacterSources(
    [
      { name: 'Hallucinated', basePromptTokens: 'silver hair, black coat' },
      { name: 'B', basePromptTokens: 'token-b' },
    ],
    [
      { id: 'src-a', episodeCharacterId: 'src-a', name: 'A', basePromptTokens: 'token-a' },
      { id: 'src-b', episodeCharacterId: 'src-b', name: 'B', basePromptTokens: 'token-b' },
    ]
  );

  const hallucinated = merged.find((character) => character.name === 'Hallucinated');
  const sourceA = merged.find((character) => character.id === 'src-a');
  const sourceB = merged.find((character) => character.id === 'src-b');

  assert.equal(hallucinated.id, undefined);
  assert.equal(hallucinated.episodeCharacterId, undefined);
  assert.equal(hallucinated.basePromptTokens, 'silver hair, black coat');
  assert.equal(sourceA.name, 'A');
  assert.equal(sourceA.basePromptTokens, 'token-a');
  assert.equal(sourceB.name, 'B');
  assert.equal(sourceB.basePromptTokens, 'token-b');
});

test('shot identity helpers expose anchor and forbidden tokens for prompt generation', () => {
  const registry = [
    {
      id: 'char_1',
      episodeCharacterId: 'char_1',
      name: '陈默',
      identityAnchor: 'short black hair, black tactical jacket',
      basePromptTokens: 'black tactical jacket, stern expression',
      forbiddenIdentityTokens: 'different hairstyle, red coat',
    },
  ];
  const shot = {
    id: 'shot_001',
    shotCharacters: [{ episodeCharacterId: 'char_1', characterName: '陈默', sortOrder: 1 }],
  };

  assert.equal(
    getShotCharacterIdentityAnchors(shot, registry),
    'short black hair, black tactical jacket'
  );
  assert.equal(
    getShotForbiddenIdentityTokens(shot, registry),
    'different hairstyle, red coat'
  );
});

test('buildCharacterRegistry fallback source path also exposes stable runtime contract fields with defaults', async () => {
  const registry = await buildCharacterRegistry(
    [{ id: 'char_src_1', name: '阿鬼', gender: 'male', age: '28岁' }],
    'script context',
    'realistic',
    {
      chatJSON: async () => ({
        characters: [],
      }),
    }
  );

  assert.equal(registry.length, 1);
  assert.equal(registry[0].name, '阿鬼');
  assert.equal(registry[0].characterBibleId, null);
  assert.equal(registry[0].priority, 'support');
  assert.deepEqual(registry[0].referenceImages, []);
  assert.equal(registry[0].negativeDriftTokens, null);
});
