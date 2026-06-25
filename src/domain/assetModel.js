import { createEntity } from './entityFactory.js';
const ALLOWED_SOURCE_MODES = new Set([
  'single_keyframe',
  'multi_keyframe',
  'continuation_from_previous',
]);

export function createKeyframeAsset(input = {}) {
  return createEntity(
    {
      negativePrompt: null,
      provider: null,
      model: null,
      ...input,
    },
    'keyframe-asset'
  );
}

export function createAnimationClip(input = {}) {
  const sourceMode = ALLOWED_SOURCE_MODES.has(input.sourceMode)
    ? input.sourceMode
    : 'single_keyframe';

  return createEntity(
    {
      videoPath: null,
      provider: null,
      model: null,
      durationSec: null,
      sourceMode,
      ...input,
      sourceMode,
    },
    'animation-clip'
  );
}

