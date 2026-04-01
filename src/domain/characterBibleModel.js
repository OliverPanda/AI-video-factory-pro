import { createEntity } from './entityFactory.js';

export function createCharacterBible(input = {}) {
  return createEntity(
    {
      projectId: input.projectId,
      aliases: Array.isArray(input.aliases) ? input.aliases : [],
      referenceImages: Array.isArray(input.referenceImages) ? input.referenceImages : [],
      coreTraits: input.coreTraits ?? {},
      wardrobeAnchor: input.wardrobeAnchor ?? {},
      lightingAnchor: input.lightingAnchor ?? {},
      basePromptTokens: input.basePromptTokens ?? null,
      negativeDriftTokens: input.negativeDriftTokens ?? null,
      notes: input.notes ?? null,
      tier: input.tier ?? 'supporting',
      ...input,
    },
    'character-bible'
  );
}

export default {
  createCharacterBible,
};
