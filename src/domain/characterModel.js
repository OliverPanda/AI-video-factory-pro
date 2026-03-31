import { createEntity } from './entityFactory.js';

export function createMainCharacterTemplate(input = {}) {
  return createEntity(
    {
      age: null,
      personality: null,
      visualDescription: null,
      basePromptTokens: null,
      defaultVoiceProfile: null,
      ...input,
    },
    'main-character-template'
  );
}

export function createEpisodeCharacter(input = {}) {
  return createEntity(
    {
      mainCharacterTemplateId: null,
      roleType: null,
      age: null,
      personalityOverride: null,
      visualOverride: null,
      voiceOverrideProfile: null,
      ...input,
      mainCharacterTemplateId: input.mainCharacterTemplateId ?? null,
    },
    'episode-character'
  );
}

export function createShotCharacter(input = {}) {
  return createEntity(
    {
      shotId: input.shotId,
      episodeCharacterId: input.episodeCharacterId,
      isSpeaker: input.isSpeaker ?? false,
      isPrimary: input.isPrimary ?? false,
      sortOrder: input.sortOrder ?? 0,
      ...input,
    },
    'shot-character'
  );
}
