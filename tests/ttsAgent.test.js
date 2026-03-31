import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCharacterRegistry,
  buildEpisodeCharacterRegistry,
  getEpisodeCharacterContext,
} from '../src/agents/characterRegistry.js';
import { generatePromptForShot } from '../src/agents/promptEngineer.js';
import { generateAllAudio } from '../src/agents/ttsAgent.js';

test('character registry exposes merged main-template and episode-instance context', () => {
  const mainTemplates = [
    {
      id: 'tpl-hero',
      name: '沈清',
      gender: 'female',
      age: '20多岁',
      visualDescription: 'base visual',
      basePromptTokens: 'template tokens',
      personality: '冷静',
      defaultVoiceProfile: 'warm-default',
    },
  ];
  const episodeCharacters = [
    {
      id: 'ep-hero',
      name: '沈清',
      mainCharacterTemplateId: 'tpl-hero',
      roleType: 'lead',
      visualOverride: 'episode visual override',
      personalityOverride: '更沉稳',
      voiceOverrideProfile: 'episode-voice',
    },
  ];

  const registry = buildEpisodeCharacterRegistry(mainTemplates, episodeCharacters);
  const entry = registry[0];
  const context = getEpisodeCharacterContext('ep-hero', registry);

  assert.equal(registry.length, 1);
  assert.equal(entry.id, 'ep-hero');
  assert.equal(entry.episodeCharacterId, 'ep-hero');
  assert.equal(entry.mainCharacterTemplateId, 'tpl-hero');
  assert.equal(entry.name, '沈清');
  assert.equal(entry.visualDescription, 'episode visual override');
  assert.equal(entry.basePromptTokens, 'template tokens');
  assert.equal(entry.personality, '更沉稳');
  assert.equal(entry.defaultVoiceProfile, 'episode-voice');
  assert.equal(context.character, entry);
  assert.equal(context.episodeCharacter.id, 'ep-hero');
  assert.equal(context.mainCharacterTemplate.id, 'tpl-hero');
});

test('buildCharacterRegistry preserves source identifiers and legacy names rescue relation-only shots', async () => {
  const registry = await buildCharacterRegistry(
    [
      {
        id: 'ep-hero',
        episodeCharacterId: 'ep-hero',
        mainCharacterTemplateId: 'tpl-hero',
        name: '沈清',
        gender: 'female',
      },
      {
        id: 'ep-guard',
        episodeCharacterId: 'ep-guard',
        mainCharacterTemplateId: 'tpl-guard',
        name: '侍卫',
        gender: 'male',
      },
    ],
    '宫廷冲突',
    'realistic',
    {
      chatJSON: async () => ({
        characters: [
          {
            name: '沈清',
            visualDescription: 'young strategist in dark hanfu',
            basePromptTokens: 'dark hanfu, poised gaze',
            personality: '冷静',
          },
          {
            name: '侍卫',
            visualDescription: 'armored palace guard',
            basePromptTokens: 'bronze armor, stern posture',
            personality: '警觉',
          },
        ],
      }),
    }
  );

  assert.equal(registry[0].id, 'ep-hero');
  assert.equal(registry[0].episodeCharacterId, 'ep-hero');
  assert.equal(registry[0].mainCharacterTemplateId, 'tpl-hero');
  assert.equal(registry[1].id, 'ep-guard');
  assert.equal(registry[1].episodeCharacterId, 'ep-guard');

  const promptShot = {
    id: 'shot_prod_prompt',
    scene: '冷宫回廊',
    action: '沈清逼近侍卫',
    emotion: '紧张',
    camera_type: '中景',
    characters: ['沈清', '侍卫'],
    shotCharacters: [{ episodeCharacterId: 'missing-1' }, { episodeCharacterId: 'missing-2' }],
  };

  let capturedMessages;
  const promptResult = await generatePromptForShot(promptShot, registry.map(({ id, episodeCharacterId, mainCharacterTemplateId, ...rest }) => rest), 'realistic', {
    chatJSON: async (messages) => {
      capturedMessages = messages;
      return {
        image_prompt: 'cinematic corridor confrontation',
        negative_prompt: 'blurry',
        style_notes: '',
      };
    },
  });

  assert.ok(capturedMessages);
  assert.match(capturedMessages[1].content, /出场角色：沈清、侍卫/);
  assert.ok(promptResult.image_prompt.startsWith('dark hanfu, poised gaze, bronze armor, stern posture'));

  const ttsCalls = [];
  const audioResults = await generateAllAudio(
    [
      {
        id: 'shot_prod_tts',
        dialogue: '退下。',
        characters: ['沈清', '侍卫'],
        shotCharacters: [
          { episodeCharacterId: 'missing-1', sortOrder: 1, isSpeaker: true },
          { episodeCharacterId: 'missing-2', sortOrder: 2 },
        ],
      },
    ],
    registry.map(({ id, episodeCharacterId, mainCharacterTemplateId, ...rest }) => rest),
    'tmp-audio',
    {
      textToSpeech: async (text, outputPath, options) => {
        ttsCalls.push({ text, outputPath, options });
        return outputPath;
      },
    }
  );

  assert.equal(ttsCalls.length, 1);
  assert.equal(ttsCalls[0].options.gender, 'female');
  assert.match(audioResults[0].audioPath, /shot_prod_tts\.mp3$/);
});

test('prompt engineer derives role context from ShotCharacter relations rather than string arrays', async () => {
  const registry = [
    {
      id: 'ep-hero',
      name: '沈清',
      visualDescription: 'young strategist in dark hanfu',
      basePromptTokens: 'dark hanfu, poised gaze',
    },
    {
      id: 'ep-guard',
      name: '侍卫',
      visualDescription: 'armored palace guard',
      basePromptTokens: 'bronze armor, stern posture',
    },
    {
      id: 'ep-legacy',
      name: '旧角色',
      visualDescription: 'legacy fallback character',
      basePromptTokens: 'legacy token',
    },
  ];

  let capturedMessages;
  const shot = {
    id: 'shot_1',
    scene: '冷宫回廊',
    action: '沈清与侍卫对峙',
    emotion: '紧张',
    camera_type: '中景',
    characters: ['旧角色'],
    shotCharacters: [
      { episodeCharacterId: 'ep-guard', sortOrder: 2 },
      { episodeCharacterId: 'ep-hero', sortOrder: 1, isPrimary: true },
    ],
  };

  const result = await generatePromptForShot(shot, registry, 'realistic', {
    chatJSON: async (messages) => {
      capturedMessages = messages;
      return {
        image_prompt: 'cinematic confrontation in corridor',
        negative_prompt: 'blurry',
        style_notes: 'use tense body language',
      };
    },
  });

  assert.ok(capturedMessages);
  assert.match(capturedMessages[1].content, /出场角色：沈清、侍卫/);
  assert.doesNotMatch(capturedMessages[1].content, /出场角色：旧角色/);
  assert.match(capturedMessages[1].content, /沈清：young strategist in dark hanfu/);
  assert.match(capturedMessages[1].content, /侍卫：armored palace guard/);
  assert.ok(result.image_prompt.startsWith('dark hanfu, poised gaze, bronze armor, stern posture'));
  assert.equal(result.shotId, 'shot_1');
});

test('tts agent identifies the speaker through ShotCharacter.isSpeaker', async () => {
  const registry = [
    { id: 'ep-hero', name: '沈清', gender: 'female' },
    { id: 'ep-guard', name: '侍卫', gender: 'male' },
  ];

  const calls = [];
  const results = await generateAllAudio(
    [
      {
        id: 'shot_2',
        dialogue: '别过来。',
        characters: ['侍卫'],
        shotCharacters: [
          { episodeCharacterId: 'ep-guard', sortOrder: 1 },
          { episodeCharacterId: 'ep-hero', sortOrder: 2, isSpeaker: true },
        ],
      },
    ],
    registry,
    'tmp-audio',
    {
      textToSpeech: async (text, outputPath, options) => {
        calls.push({ text, outputPath, options });
        return outputPath;
      },
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, '别过来。');
  assert.equal(calls[0].options.gender, 'female');
  assert.equal(results[0].shotId, 'shot_2');
  assert.equal(results[0].hasDialogue, true);
  assert.match(results[0].audioPath, /shot_2\.mp3$/);
});

test('legacy fallback still works if relation-based data is absent', async () => {
  const registry = [{ name: '旁白', gender: 'male' }];

  const promptShot = {
    id: 'shot_legacy_prompt',
    scene: '雨夜街巷',
    action: '旁白声响起',
    emotion: '压抑',
    camera_type: '远景',
    characters: ['旁白'],
  };

  let capturedMessages;
  const promptResult = await generatePromptForShot(promptShot, registry, 'realistic', {
    chatJSON: async (messages) => {
      capturedMessages = messages;
      return {
        image_prompt: 'rainy alley at night',
        negative_prompt: 'low quality',
        style_notes: '',
      };
    },
  });

  assert.ok(capturedMessages);
  assert.match(capturedMessages[1].content, /出场角色：旁白/);
  assert.match(promptResult.image_prompt, /medium shot|establishing shot|wide shot/);
  assert.match(promptResult.image_prompt, /rainy alley at night/);

  const audioCalls = [];
  const audioResults = await generateAllAudio(
    [
      {
        id: 'shot_legacy_tts',
        dialogue: '天快亮了。',
        speaker: '旁白',
        characters: ['旁白'],
      },
    ],
    registry,
    'tmp-audio',
    {
      textToSpeech: async (text, outputPath, options) => {
        audioCalls.push({ text, outputPath, options });
        return outputPath;
      },
    }
  );

  assert.equal(audioCalls.length, 1);
  assert.equal(audioCalls[0].options.gender, 'male');
  assert.equal(audioResults[0].hasDialogue, true);
  assert.match(audioResults[0].audioPath, /shot_legacy_tts\.mp3$/);
});

test('buildCharacterRegistry keeps source characters when the LLM omits some entries', async () => {
  const registry = await buildCharacterRegistry(
    [
      { id: 'episode_1_shenqing', name: '沈清', gender: 'female' },
      { id: 'episode_1_guard', name: '侍卫', gender: 'male' },
    ],
    '冷宫夜查',
    'realistic',
    {
      chatJSON: async () => ({
        characters: [
          {
            name: '沈清',
            gender: 'female',
            basePromptTokens: 'shen qing',
          },
        ],
      }),
    }
  );

  assert.equal(registry.length, 2);
  assert.equal(registry.some((character) => character.name === '沈清'), true);
  assert.equal(registry.some((character) => character.name === '侍卫'), true);
  assert.equal(
    registry.find((character) => character.name === '侍卫').episodeCharacterId,
    'episode_1_guard'
  );
});
