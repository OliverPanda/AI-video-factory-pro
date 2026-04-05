export const BRIDGE_SHOT_PLAN_FIELDS = [
  'bridgeId',
  'fromShotId',
  'toShotId',
  'bridgeType',
  'bridgeGoal',
  'durationTargetSec',
  'continuityRisk',
  'cameraTransitionIntent',
  'subjectContinuityTargets',
  'environmentContinuityTargets',
  'mustPreserveElements',
  'bridgeGenerationMode',
  'preferredProvider',
  'fallbackStrategy',
];

export function shapeBridgeShotPlanEntry(source = {}) {
  return BRIDGE_SHOT_PLAN_FIELDS.reduce((entry, field) => {
    entry[field] = source[field] ?? null;
    return entry;
  }, {});
}

export default {
  BRIDGE_SHOT_PLAN_FIELDS,
  shapeBridgeShotPlanEntry,
};
