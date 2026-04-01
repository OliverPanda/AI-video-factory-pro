import { createEntity } from './entityFactory.js';

const MIN_EPISODE_DURATION_SEC = 90;
const MAX_EPISODE_DURATION_SEC = 180;

function clampEpisodeDuration(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return MIN_EPISODE_DURATION_SEC;
  }

  return Math.min(MAX_EPISODE_DURATION_SEC, Math.max(MIN_EPISODE_DURATION_SEC, value));
}

export function createProject(input = {}) {
  return createEntity(
    {
      description: null,
      ...input,
    },
    'project'
  );
}

export function createScript(input = {}) {
  return createEntity(
    {
      sourceText: '',
      genre: null,
      theme: null,
      targetEpisodeCount: null,
      ...input,
    },
    'script'
  );
}

export function createEpisode(input = {}) {
  const targetDurationSec = clampEpisodeDuration(input.targetDurationSec);

  return createEntity(
    {
      title: null,
      summary: null,
      targetDurationSec,
      ...input,
      targetDurationSec,
    },
    'episode'
  );
}

export function createShotPlan(input = {}) {
  return createEntity(
    {
      scene: null,
      goal: null,
      action: null,
      dialogue: null,
      emotion: null,
      cameraType: null,
      cameraMovement: null,
      durationSec: null,
      continuitySourceShotId: null,
      continuityState: {
        carryOverFromShotId: null,
        sceneLighting: null,
        cameraAxis: null,
        propStates: [],
        emotionState: {},
        continuityRiskTags: [],
      },
      ...input,
    },
    'shotplan'
  );
}
