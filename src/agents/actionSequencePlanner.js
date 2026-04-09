import path from 'node:path';

import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import { createActionSequencePlanEntry } from '../utils/actionSequenceProtocol.js';

function resolvePreferredSequenceProvider(options = {}) {
  const rawProvider = options.preferredProvider || options.videoProvider || process.env.VIDEO_PROVIDER || 'seedance';
  if (rawProvider === 'fallback_video' || rawProvider === 'runway') {
    return 'sora2';
  }
  return rawProvider;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function buildMotionPlanMap(motionPlan = []) {
  return new Map((Array.isArray(motionPlan) ? motionPlan : []).map((entry) => [entry.shotId, entry]));
}

function buildPerformancePlanMap(performancePlan = []) {
  return new Map((Array.isArray(performancePlan) ? performancePlan : []).map((entry) => [entry.shotId, entry]));
}

function buildBridgeShotIndex(values = []) {
  return new Map(
    (Array.isArray(values) ? values : [])
      .filter((entry) => entry?.fromShotId && entry?.toShotId)
      .map((entry) => [`${entry.fromShotId}__${entry.toShotId}`, entry])
  );
}

function buildSequenceContextSignalSet(options = {}, shotIds = []) {
  const shotIdSet = new Set(Array.isArray(shotIds) ? shotIds : []);
  const signals = new Set();

  for (const transition of Array.isArray(options.continuityFlaggedTransitions) ? options.continuityFlaggedTransitions : []) {
    const previousInSequence = shotIdSet.has(transition?.previousShotId);
    const currentInSequence = shotIdSet.has(transition?.shotId);
    if (previousInSequence && currentInSequence && transition?.previousShotId) {
      signals.add(transition.previousShotId);
    }
    if (previousInSequence && currentInSequence && transition?.shotId) {
      signals.add(transition.shotId);
    }
  }

  for (const bridge of Array.isArray(options.bridgeShotPlan) ? options.bridgeShotPlan : []) {
    const fromInSequence = shotIdSet.has(bridge?.fromShotId);
    const toInSequence = shotIdSet.has(bridge?.toShotId);
    if (fromInSequence && toInSequence && bridge?.fromShotId) {
      signals.add(bridge.fromShotId);
    }
    if (fromInSequence && toInSequence && bridge?.toShotId) {
      signals.add(bridge.toShotId);
    }
  }

  return signals;
}

function getShotCharacters(shot = {}) {
  return (Array.isArray(shot.characters) ? shot.characters : [])
    .map((character) => character?.episodeCharacterId || character?.id || character?.name)
    .filter(Boolean);
}

function getSharedCharacterIds(shots = []) {
  if (!Array.isArray(shots) || shots.length === 0) {
    return [];
  }

  const [firstShot, ...restShots] = shots;
  const shared = new Set(getShotCharacters(firstShot));
  for (const shot of restShots) {
    const shotIds = new Set(getShotCharacters(shot));
    for (const id of [...shared]) {
      if (!shotIds.has(id)) {
        shared.delete(id);
      }
    }
  }

  return [...shared];
}

function getSceneNames(shots = []) {
  return [...new Set((Array.isArray(shots) ? shots : []).map((shot) => normalizeText(shot?.scene)).filter(Boolean))];
}

function scoreFightExchange(shot, motionEntry, performanceEntry) {
  const text = normalizeLowerText([shot?.action, shot?.dialogue, motionEntry?.shotType, performanceEntry?.performanceTemplate].join(' '));
  let score = 0;
  if (/(fight|交锋|缠斗|厮杀|对决|决斗|格挡|回击|反击|出刀|拔刀|挥刀|挥剑|挥拳|挥棍|抡起|猛攻|强攻|扑上|扑向|逼攻|攻防|搏斗|肉搏|扭打|缠住|制住|压制|扑倒|摔倒|刀锋)/.test(text)) {
    score += 4;
  }
  if (normalizeLowerText(motionEntry?.shotType).includes('fight')) {
    score += 2;
  }
  if (normalizeLowerText(performanceEntry?.performanceTemplate).includes('fight')) {
    score += 2;
  }
  return score;
}

function scoreChaseRun(shot, motionEntry, performanceEntry) {
  const text = normalizeLowerText([shot?.action, shot?.dialogue, motionEntry?.shotType, performanceEntry?.performanceTemplate].join(' '));
  let score = 0;
  if (/(追逐|追赶|追击|疾跑|奔跑|冲刺|追着|追上|追捕|追兵)/.test(text)) {
    score += 4;
  }
  if (normalizeLowerText(motionEntry?.shotType).includes('chase')) {
    score += 2;
  }
  return score;
}

function scoreEscapeTransition(shot, motionEntry, performanceEntry) {
  const text = normalizeLowerText([shot?.action, shot?.dialogue, motionEntry?.shotType, performanceEntry?.performanceTemplate].join(' '));
  let score = 0;
  if (/(逃离|逃跑|撤退|撤离|脱离|突围|遁走|离开|转身逃|躲开)/.test(text)) {
    score += 4;
  }
  if (/(逃|撤|脱离)/.test(normalizeLowerText(motionEntry?.shotType))) {
    score += 1;
  }
  return score;
}

function scoreImpactFollowthrough(shot, motionEntry, performanceEntry) {
  const text = normalizeLowerText([shot?.action, shot?.dialogue, motionEntry?.shotType, performanceEntry?.performanceTemplate].join(' '));
  let score = 0;
  if (/(撞击|击中|击倒|重击|受击|落地|倒地|砸倒|摔倒|爆开|爆炸|余震|震开|反弹|后仰|踉跄|击飞|冲击)/.test(text)) {
    score += 4;
  }
  if (normalizeLowerText(motionEntry?.shotType).includes('impact')) {
    score += 2;
  }
  if (normalizeLowerText(performanceEntry?.performanceTemplate).includes('impact')) {
    score += 2;
  }
  return score;
}

function scoreDialogueMove(shot, motionEntry, performanceEntry) {
  const text = normalizeLowerText([shot?.action, shot?.dialogue, motionEntry?.shotType, performanceEntry?.performanceTemplate].join(' '));
  let score = 0;
  if (shot?.dialogue) {
    score += 1;
  }
  if (/(边走边说|移动|靠近|后退|逼近|起身|转身|穿过|踱步|挪动|步位|位移|走向)/.test(text)) {
    score += 4;
  }
  if (normalizeLowerText(performanceEntry?.performanceTemplate).includes('dialogue')) {
    score += 1;
  }
  return score;
}

function inferSequenceType(shot, motionEntry, performanceEntry, contextSignals = new Set()) {
  const contextBonus = contextSignals.has(shot?.id) ? 2 : 0;
  const candidates = [
    ['impact_followthrough_sequence', scoreImpactFollowthrough(shot, motionEntry, performanceEntry) + contextBonus],
    ['escape_transition_sequence', scoreEscapeTransition(shot, motionEntry, performanceEntry) + contextBonus],
    ['chase_run_sequence', scoreChaseRun(shot, motionEntry, performanceEntry) + contextBonus],
    ['fight_exchange_sequence', scoreFightExchange(shot, motionEntry, performanceEntry) + contextBonus],
    ['dialogue_move_sequence', scoreDialogueMove(shot, motionEntry, performanceEntry) + contextBonus],
  ];

  candidates.sort((left, right) => right[1] - left[1]);
  const [sequenceType, score] = candidates[0];
  return score >= 4 ? sequenceType : null;
}

function isCompatibleSequenceTransition(activeType, nextType) {
  if (!activeType || !nextType || activeType === nextType) {
    return true;
  }

  const pairKey = [activeType, nextType].sort().join('__');
  return pairKey === 'fight_exchange_sequence__impact_followthrough_sequence';
}

function mergeSequenceType(activeType, nextType) {
  if (activeType === nextType) {
    return activeType;
  }
  if (activeType === 'fight_exchange_sequence' || nextType === 'fight_exchange_sequence') {
    return 'fight_exchange_sequence';
  }
  return activeType || nextType;
}

function getSegmentGroups(shots = [], motionPlanMap, performancePlanMap, contextSignals = new Set()) {
  const groups = [];
  let activeGroup = null;

  for (const shot of Array.isArray(shots) ? shots : []) {
    const motionEntry = motionPlanMap.get(shot.id) || null;
    const performanceEntry = performancePlanMap.get(shot.id) || null;
    const sequenceType = inferSequenceType(shot, motionEntry, performanceEntry, contextSignals);

    if (!sequenceType) {
      if (activeGroup) {
        groups.push(activeGroup);
        activeGroup = null;
      }
      continue;
    }

    if (!activeGroup || !isCompatibleSequenceTransition(activeGroup.sequenceType, sequenceType)) {
      if (activeGroup) {
        groups.push(activeGroup);
      }
      activeGroup = {
        sequenceType,
        shots: [shot],
      };
      continue;
    }

    activeGroup.sequenceType = mergeSequenceType(activeGroup.sequenceType, sequenceType);
    activeGroup.shots.push(shot);
  }

  if (activeGroup) {
    groups.push(activeGroup);
  }

  return groups;
}

function splitGroupIntoSequences(group) {
  const plannedGroups = [];
  const shots = Array.isArray(group.shots) ? group.shots : [];

  for (let index = 0; index + 1 < shots.length; index += 5) {
    const chunk = shots.slice(index, index + 5);
    if (chunk.length >= 2) {
      plannedGroups.push({
        sequenceType: group.sequenceType,
        shots: chunk,
      });
    }
  }

  return plannedGroups;
}

function buildSequenceGoal(sequenceType) {
  const goals = {
    fight_exchange_sequence: '保持连续攻防与武器/手部节奏',
    chase_run_sequence: '保持追逐速度与方向连续',
    escape_transition_sequence: '保持逃离、脱身与空间方向连续',
    impact_followthrough_sequence: '保持冲击、受击与余震连续',
    dialogue_move_sequence: '保持对白、步位与视线移动连续',
  };

  return goals[sequenceType] || '保持连续动作节奏';
}

function buildCameraFlowIntent(sequenceType) {
  const intents = {
    fight_exchange_sequence: 'dynamic_orbit_then_push',
    chase_run_sequence: 'forward_tracking',
    escape_transition_sequence: 'panic_pan_then_follow',
    impact_followthrough_sequence: 'snap_then_hold',
    dialogue_move_sequence: 'walk_and_talk_tracking',
  };

  return intents[sequenceType] || 'continuous_follow';
}

function buildMotionContinuityTargets(sequenceType) {
  const targets = {
    fight_exchange_sequence: ['hand_position', 'weapon_path', 'impact_timing'],
    chase_run_sequence: ['direction_of_travel', 'speed_curve'],
    escape_transition_sequence: ['escape_direction', 'body_orientation'],
    impact_followthrough_sequence: ['impact_timing', 'reaction_timing'],
    dialogue_move_sequence: ['speech_timing', 'body_position', 'eye_line'],
  };

  return targets[sequenceType] || ['motion_continuity'];
}

function buildEntryConstraint(sequenceType) {
  const constraints = {
    fight_exchange_sequence: '接住上一镜的格挡或出刀终点',
    chase_run_sequence: '接住上一镜的追赶起步方向',
    escape_transition_sequence: '接住上一镜的逃离或撤退姿态',
    impact_followthrough_sequence: '接住上一镜的冲击瞬间',
    dialogue_move_sequence: '接住上一镜的对白与位移衔接',
  };

  return constraints[sequenceType] || '接住上一镜的动作惯性';
}

function buildExitConstraint(sequenceType) {
  const constraints = {
    fight_exchange_sequence: '收束到下一轮攻防节拍',
    chase_run_sequence: '落到持续追逐的下一步位',
    escape_transition_sequence: '收束到脱离追击后的安全落点',
    impact_followthrough_sequence: '落到余震和角色反应',
    dialogue_move_sequence: '落到下一步位或停顿点',
  };

  return constraints[sequenceType] || '落到下一镜的动作落点';
}

function buildFallbackStrategy(sequenceType) {
  return 'fallback_to_shot_and_bridge';
}

function getShotDurationSec(shot, motionEntry) {
  const candidates = [shot?.durationSec, shot?.duration, motionEntry?.durationTargetSec]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (candidates.length > 0) {
    return candidates[0];
  }

  return null;
}

function buildDurationTargetSec(sequenceType, shots = [], motionPlanMap = new Map()) {
  const perShotDurations = {
    fight_exchange_sequence: 2.2,
    chase_run_sequence: 2.0,
    escape_transition_sequence: 1.6,
    impact_followthrough_sequence: 1.2,
    dialogue_move_sequence: 2.3,
  };

  const shotDurations = (Array.isArray(shots) ? shots : []).map((shot) => {
    const motionEntry = motionPlanMap.get(shot.id) || null;
    return getShotDurationSec(shot, motionEntry) ?? (perShotDurations[sequenceType] || 2);
  });
  const aggregatedDuration = shotDurations.reduce((total, duration) => total + duration, 0);
  const minimumDuration = (perShotDurations[sequenceType] || 2) * Math.max(1, shotDurations.length);

  return Number(Math.max(aggregatedDuration, minimumDuration).toFixed(1));
}

function buildSubjectContinuityTargets(shots = []) {
  const sharedCharacterIds = getSharedCharacterIds(shots);
  return sharedCharacterIds.length > 0 ? sharedCharacterIds : [];
}

function buildEnvironmentContinuityTargets(shots = [], sequenceType) {
  const targets = ['lighting'];
  const scenes = getSceneNames(shots);
  if (scenes.length > 1) {
    targets.push('scene_geography');
  }
  if (sequenceType === 'fight_exchange_sequence' || sequenceType === 'impact_followthrough_sequence') {
    targets.push('camera_axis');
  }
  if (sequenceType === 'chase_run_sequence' || sequenceType === 'escape_transition_sequence') {
    targets.push('direction_of_travel');
  }
  if (sequenceType === 'dialogue_move_sequence') {
    targets.push('blocking_route');
  }
  return [...new Set(targets)];
}

function buildMustPreserveElements(shots = [], sequenceType) {
  const sharedCharacterIds = getSharedCharacterIds(shots);
  const preserve = sharedCharacterIds.map((id) => `character:${id}`);
  if (preserve.length === 0) {
    preserve.push('subject_identity');
  }

  const typePreserve = {
    fight_exchange_sequence: ['weapon_path', 'hand_position'],
    chase_run_sequence: ['direction_of_travel'],
    escape_transition_sequence: ['escape_direction'],
    impact_followthrough_sequence: ['impact_timing', 'aftershock'],
    dialogue_move_sequence: ['speech_timing', 'blocking_route'],
  };

  return [...new Set([...preserve, ...(typePreserve[sequenceType] || []), 'subject_identity'])];
}

function buildGenerationMode(shots = [], options = {}) {
  const relevantSignals = buildSequenceContextSignalSet(options, shots.map((shot) => shot.id));
  if (relevantSignals.size > 0) {
    return 'bridge_assisted';
  }

  return 'standalone_sequence';
}

function buildSequencePlanEntry(sequenceType, shots, options = {}, motionPlanMap = new Map()) {
  const shotIds = shots.map((shot) => shot.id);
  const preferredProvider = resolvePreferredSequenceProvider(options);
  return createActionSequencePlanEntry({
    sequenceId: `action_sequence_${shotIds[0]}_${shotIds[shotIds.length - 1]}`,
    shotIds,
    sequenceType,
    sequenceGoal: buildSequenceGoal(sequenceType),
    durationTargetSec: buildDurationTargetSec(sequenceType, shots, motionPlanMap),
    cameraFlowIntent: buildCameraFlowIntent(sequenceType),
    motionContinuityTargets: buildMotionContinuityTargets(sequenceType),
    subjectContinuityTargets: buildSubjectContinuityTargets(shots),
    environmentContinuityTargets: buildEnvironmentContinuityTargets(shots, sequenceType),
    mustPreserveElements: buildMustPreserveElements(shots, sequenceType),
    entryConstraint: buildEntryConstraint(sequenceType),
    exitConstraint: buildExitConstraint(sequenceType),
    generationMode: buildGenerationMode(shots, options),
    preferredProvider,
    fallbackStrategy: buildFallbackStrategy(sequenceType),
  });
}

export function buildActionSequencePlan(shots = [], options = {}) {
  const motionPlanMap = buildMotionPlanMap(options.motionPlan);
  const performancePlanMap = buildPerformancePlanMap(options.performancePlan);
  const contextSignals = buildSequenceContextSignalSet(options);
  const groups = getSegmentGroups(shots, motionPlanMap, performancePlanMap, contextSignals);
  const plan = [];

  for (const group of groups) {
    for (const chunk of splitGroupIntoSequences(group)) {
      plan.push(buildSequencePlanEntry(chunk.sequenceType, chunk.shots, options, motionPlanMap));
    }
  }

  return plan;
}

function buildMetrics(actionSequencePlan = []) {
  return {
    plannedActionSequenceCount: actionSequencePlan.length,
    sequenceTypeBreakdown: actionSequencePlan.reduce((acc, entry) => {
      acc[entry.sequenceType] = (acc[entry.sequenceType] || 0) + 1;
      return acc;
    }, {}),
    coveredShotCount: actionSequencePlan.reduce((count, entry) => count + (Array.isArray(entry.shotIds) ? entry.shotIds.length : 0), 0),
  };
}

function writeArtifacts(actionSequencePlan, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const metrics = buildMetrics(actionSequencePlan);
  saveJSON(path.join(artifactContext.outputsDir, 'action-sequence-plan.json'), actionSequencePlan);
  saveJSON(path.join(artifactContext.metricsDir, 'action-sequence-plan-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    plannedActionSequenceCount: actionSequencePlan.length,
    outputFiles: ['action-sequence-plan.json', 'action-sequence-plan-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'actionSequencePlanner',
      agentName: 'Action Sequence Planner',
      status: 'pass',
      headline: `已规划 ${actionSequencePlan.length} 个连续动作段`,
      summary: '当前仅为高价值连续动作段生成 action sequence plan，避免把所有 shot 都强制串联。',
      passItems: [`动作段数量：${actionSequencePlan.length}`],
      warnItems: actionSequencePlan.length === 0 ? ['未检测到足够明确的连续动作段'] : [],
      nextAction: '可以继续进入 action sequence 路由与生成阶段。',
      evidenceFiles: ['1-outputs/action-sequence-plan.json', '2-metrics/action-sequence-plan-metrics.json'],
      metrics,
    },
    artifactContext
  );
}

export async function planActionSequences(shots = [], options = {}) {
  const actionSequencePlan = buildActionSequencePlan(shots, options);
  writeArtifacts(actionSequencePlan, options.artifactContext);
  return actionSequencePlan;
}

export const __testables = {
  buildActionSequencePlan,
  buildCameraFlowIntent,
  buildDurationTargetSec,
  buildEntryConstraint,
  buildExitConstraint,
  buildFallbackStrategy,
  buildGenerationMode,
  buildMotionContinuityTargets,
  buildSequenceGoal,
  inferSequenceType,
  resolvePreferredSequenceProvider,
};

export default {
  planActionSequences,
};
