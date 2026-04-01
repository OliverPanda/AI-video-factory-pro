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
      characterBibleId: null,
      roleType: null,
      age: null,
      personalityOverride: null,
      visualOverride: null,
      lookOverride: null,
      wardrobeOverride: null,
      voiceOverrideProfile: null,
      voicePresetId: null,
      ...input,
      mainCharacterTemplateId: input.mainCharacterTemplateId ?? null,
      characterBibleId: input.characterBibleId ?? null,
      voicePresetId: input.voicePresetId ?? null,
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
      poseIntent: input.poseIntent ?? null,
      relativePosition: input.relativePosition ?? null,
      facingDirection: input.facingDirection ?? null,
      interactionTargetEpisodeCharacterId: input.interactionTargetEpisodeCharacterId ?? null,
      ...input,
    },
    'shot-character'
  );
}
