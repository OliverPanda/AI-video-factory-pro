import path from 'node:path';

import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import { shapeBridgeShotPlanEntry } from '../utils/bridgeShotProtocol.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeShotType(value) {
  return normalizeText(value).toLowerCase();
}

function buildMotionPlanMap(motionPlan = []) {
  return new Map((Array.isArray(motionPlan) ? motionPlan : []).map((entry) => [entry.shotId, entry]));
}

function buildFlaggedTransitionMap(flaggedTransitions = []) {
  return new Map(
    (Array.isArray(flaggedTransitions) ? flaggedTransitions : [])
      .filter((entry) => entry?.previousShotId && entry?.shotId)
      .map((entry) => [`${entry.previousShotId}__${entry.shotId}`, entry])
  );
}

function getFramingClass(shotType) {
  if (shotType.includes('close')) return 'close';
  if (shotType.includes('medium')) return 'medium';
  if (shotType.includes('wide') || shotType.includes('ambient')) return 'wide';
  if (shotType.includes('insert')) return 'insert';
  return 'unknown';
}

function getCharacterIds(shot = {}) {
  return (Array.isArray(shot.characters) ? shot.characters : [])
    .map((character) => character?.episodeCharacterId || character?.id || character?.name)
    .filter(Boolean);
}

function getSharedCharacterIds(previousShot = {}, currentShot = {}) {
  const previousIds = new Set(getCharacterIds(previousShot));
  return getCharacterIds(currentShot).filter((id) => previousIds.has(id));
}

function inferBridgeType(previousShot, currentShot, previousMotion, currentMotion, flaggedTransition) {
  const previousAction = normalizeText(previousShot?.action);
  const currentAction = normalizeText(currentShot?.action);
  const previousScene = normalizeText(previousShot?.scene);
  const currentScene = normalizeText(currentShot?.scene);
  const previousMood = normalizeText(previousShot?.mood);
  const currentMood = normalizeText(currentShot?.mood);
  const previousShotType = normalizeShotType(previousMotion?.shotType);
  const currentShotType = normalizeShotType(currentMotion?.shotType);
  const sharedCharacterIds = getSharedCharacterIds(previousShot, currentShot);
  const hardViolationCodes = Array.isArray(flaggedTransition?.hardViolationCodes)
    ? flaggedTransition.hardViolationCodes
    : [];

  const motionCarryPattern = /转身|冲刺|前冲|冲向|跃起|跃下|挥刀|挥剑|落下|刺出|扑向|追击|翻身|拔刀|拔剑/;
  if (
    motionCarryPattern.test(currentAction) ||
    (motionCarryPattern.test(previousAction) && normalizeShotType(currentMotion?.shotType).includes('fight'))
  ) {
    return 'motion_carry';
  }

  if (
    sharedCharacterIds.length > 0 &&
    previousScene &&
    currentScene &&
    previousScene === currentScene &&
    getFramingClass(previousShotType) !== getFramingClass(currentShotType) &&
    (hardViolationCodes.includes('camera_axis_flip') ||
      getFramingClass(previousShotType) === 'close' ||
      getFramingClass(currentShotType) === 'close')
  ) {
    return 'camera_reframe';
  }

  if (previousScene && currentScene && previousScene !== currentScene) {
    return 'spatial_transition';
  }

  if (previousMood && currentMood && previousMood !== currentMood) {
    return 'emotional_transition';
  }

  return null;
}

function buildDurationTargetSec(bridgeType) {
  const durations = {
    motion_carry: 1.8,
    camera_reframe: 1.6,
    spatial_transition: 2.6,
    emotional_transition: 1.8,
  };
  return durations[bridgeType] || 2;
}

function buildBridgeGoal(bridgeType) {
  const goals = {
    motion_carry: 'carry_action_across_cut',
    camera_reframe: 'smooth_reframe',
    spatial_transition: 'bridge_spatial_relocation',
    emotional_transition: 'bridge_emotional_escalation',
  };
  return goals[bridgeType] || 'smooth_transition';
}

function buildCameraTransitionIntent(bridgeType) {
  const intents = {
    motion_carry: 'follow_through_motion',
    camera_reframe: 'progressive_reframe',
    spatial_transition: 'travel_between_spaces',
    emotional_transition: 'emotional_push_in',
  };
  return intents[bridgeType] || 'smooth_transition';
}

function buildEnvironmentTargets(bridgeType, previousShot, currentShot) {
  const sharedTargets = ['lighting'];
  if (normalizeText(previousShot?.scene) !== normalizeText(currentShot?.scene)) {
    sharedTargets.push('scene_geography');
  }
  if (bridgeType === 'camera_reframe') {
    sharedTargets.push('camera_axis');
  }
  if (bridgeType === 'motion_carry') {
    sharedTargets.push('motion_direction');
  }
  if (bridgeType === 'emotional_transition') {
    sharedTargets.push('mood_progression');
  }
  return [...new Set(sharedTargets)];
}

function buildMustPreserveElements(previousShot, currentShot) {
  return [
    ...getSharedCharacterIds(previousShot, currentShot).map((id) => `character:${id}`),
    'subject_identity',
  ];
}

function buildBridgeGenerationMode(bridgeType, continuityRisk) {
  if (continuityRisk === 'high' && (bridgeType === 'motion_carry' || bridgeType === 'spatial_transition')) {
    return 'first_last_keyframe';
  }
  return 'image_to_video_bridge';
}

function buildContinuityRisk(flaggedTransition, bridgeType) {
  const score = Number(flaggedTransition?.continuityScore ?? 10);
  const hardViolationCount = Array.isArray(flaggedTransition?.hardViolationCodes)
    ? flaggedTransition.hardViolationCodes.length
    : 0;
  if (score <= 5 || hardViolationCount > 0) {
    return 'high';
  }
  if (bridgeType === 'spatial_transition' || score <= 7) {
    return 'medium';
  }
  return 'low';
}

function buildSubjectContinuityTargets(previousShot, currentShot) {
  const sharedCharacterIds = getSharedCharacterIds(previousShot, currentShot);
  return sharedCharacterIds.length > 0 ? sharedCharacterIds : ['subject_identity'];
}

export function buildBridgeShotPlan(shots = [], options = {}) {
  const motionPlanMap = buildMotionPlanMap(options.motionPlan);
  const flaggedTransitionMap = buildFlaggedTransitionMap(options.continuityFlaggedTransitions);
  const bridgePlan = [];

  for (let index = 1; index < shots.length; index += 1) {
    const previousShot = shots[index - 1];
    const currentShot = shots[index];
    const flaggedTransition = flaggedTransitionMap.get(`${previousShot.id}__${currentShot.id}`) || null;

    if (!flaggedTransition) {
      continue;
    }

    const previousMotion = motionPlanMap.get(previousShot.id) || null;
    const currentMotion = motionPlanMap.get(currentShot.id) || null;
    const bridgeType = inferBridgeType(previousShot, currentShot, previousMotion, currentMotion, flaggedTransition);
    if (!bridgeType) {
      continue;
    }

    const continuityRisk = buildContinuityRisk(flaggedTransition, bridgeType);
    bridgePlan.push(
      shapeBridgeShotPlanEntry({
        bridgeId: `bridge_${previousShot.id}_${currentShot.id}`,
        fromShotId: previousShot.id,
        toShotId: currentShot.id,
        bridgeType,
        bridgeGoal: buildBridgeGoal(bridgeType),
        durationTargetSec: buildDurationTargetSec(bridgeType),
        continuityRisk,
        cameraTransitionIntent: buildCameraTransitionIntent(bridgeType),
        subjectContinuityTargets: buildSubjectContinuityTargets(previousShot, currentShot),
        environmentContinuityTargets: buildEnvironmentTargets(bridgeType, previousShot, currentShot),
        mustPreserveElements: buildMustPreserveElements(previousShot, currentShot),
        bridgeGenerationMode: buildBridgeGenerationMode(bridgeType, continuityRisk),
        preferredProvider: 'sora2',
        fallbackStrategy: 'direct_cut',
      })
    );
  }

  return bridgePlan;
}

function buildMetrics(bridgePlan = []) {
  return {
    plannedBridgeShotCount: bridgePlan.length,
    bridgeTypeBreakdown: bridgePlan.reduce((acc, entry) => {
      acc[entry.bridgeType] = (acc[entry.bridgeType] || 0) + 1;
      return acc;
    }, {}),
    highRiskBridgeCount: bridgePlan.filter((entry) => entry.continuityRisk === 'high').length,
  };
}

function writeArtifacts(bridgePlan, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const metrics = buildMetrics(bridgePlan);
  saveJSON(path.join(artifactContext.outputsDir, 'bridge-shot-plan.json'), bridgePlan);
  saveJSON(path.join(artifactContext.metricsDir, 'bridge-shot-plan-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    plannedBridgeShotCount: bridgePlan.length,
    outputFiles: ['bridge-shot-plan.json', 'bridge-shot-plan-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'bridgeShotPlanner',
      agentName: 'Bridge Shot Planner',
      status: 'pass',
      headline: `已规划 ${bridgePlan.length} 个桥接镜头`,
      summary: '当前使用规则版策略，只为高风险 cut 点生成 bridge shot 计划。',
      passItems: [`桥接镜头数：${bridgePlan.length}`],
      nextAction: '可以继续进入 bridge shot 路由阶段。',
      evidenceFiles: ['1-outputs/bridge-shot-plan.json', '2-metrics/bridge-shot-plan-metrics.json'],
      metrics,
    },
    artifactContext
  );
}

export async function planBridgeShots(shots = [], options = {}) {
  const bridgePlan = buildBridgeShotPlan(shots, options);
  writeArtifacts(bridgePlan, options.artifactContext);
  return bridgePlan;
}

export const __testables = {
  buildBridgeShotPlan,
  buildBridgeGoal,
  buildCameraTransitionIntent,
  buildContinuityRisk,
  inferBridgeType,
};

export default {
  planBridgeShots,
};
