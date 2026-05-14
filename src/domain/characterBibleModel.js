import { createEntity } from './entityFactory.js';

export function createCharacterBible(input = {}) {
  const normalizedAliases = Array.isArray(input.aliases) ? input.aliases : [];
  const normalizedReferenceImages = Array.isArray(input.referenceImages) ? input.referenceImages : [];
  const normalizedCoreTraits =
    input.coreTraits && typeof input.coreTraits === 'object' && !Array.isArray(input.coreTraits)
      ? input.coreTraits
      : {};
  const normalizedWardrobeAnchor =
    input.wardrobeAnchor && typeof input.wardrobeAnchor === 'object' && !Array.isArray(input.wardrobeAnchor)
      ? input.wardrobeAnchor
      : {};
  const normalizedLightingAnchor =
    input.lightingAnchor && typeof input.lightingAnchor === 'object' && !Array.isArray(input.lightingAnchor)
      ? input.lightingAnchor
      : {};

  return createEntity(
    {
      ...input,
      projectId: input.projectId,
      aliases: normalizedAliases,
      coreTraits: normalizedCoreTraits,
      wardrobeAnchor: normalizedWardrobeAnchor,
      lightingAnchor: normalizedLightingAnchor,
      basePromptTokens: input.basePromptTokens ?? null,
      notes: input.notes ?? null,
      tier: input.tier ?? 'supporting',
      priority: input.priority ?? 'support',
      referenceImages: normalizedReferenceImages,
      negativeDriftTokens: input.negativeDriftTokens ?? null,
    },
    'character-bible'
  );
}

export default {
  createCharacterBible,
};
