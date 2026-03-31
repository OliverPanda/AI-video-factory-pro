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

export function createVoiceAsset(input = {}) {
  return createEntity(
    {
      audioPath: null,
      voice: null,
      rate: null,
      pitch: null,
      volume: null,
      provider: null,
      ...input,
    },
    'voice-asset'
  );
}

export function createSubtitleAsset(input = {}) {
  return createEntity(
    {
      text: '',
      startTime: null,
      endTime: null,
      style: null,
      ...input,
    },
    'subtitle-asset'
  );
}

export function createEpisodeCut(input = {}) {
  return createEntity(
    {
      resolution: null,
      fps: null,
      totalDurationSec: null,
      publishedPlatform: null,
      publishedAt: null,
      ...input,
    },
    'episode-cut'
  );
}
