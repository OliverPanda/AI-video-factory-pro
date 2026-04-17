import path from 'node:path';

import { createScenePack } from '../domain/seedanceSceneProtocol.js';
import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeCharacterList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item?.name || item))
    .filter(Boolean);
}

function inferTimeAnchor(shot = {}) {
  return normalizeText(shot.time || shot.time_anchor || shot.timeAnchor || shot.period) || 'continuous_present';
}

function inferLocationAnchor(shot = {}) {
  return normalizeText(shot.scene || shot.location || shot.setting) || 'unanchored_location';
}

function extractBeatSummary(shot = {}) {
  const action = normalizeText(shot.action);
  const dialogue = normalizeText(shot.dialogue);
  if (action && dialogue) {
    return `${action} / 台词：${dialogue}`;
  }
  return action || dialogue || normalizeText(shot.scene) || '未命名动作';
}

function getSharedCharacterCount(left = [], right = []) {
  const leftSet = new Set(normalizeCharacterList(left));
  return normalizeCharacterList(right).filter((item) => leftSet.has(item)).length;
}

function shouldStartNewScene(previousShot, currentShot) {
  if (!previousShot) {
    return false;
  }

  const previousLocation = inferLocationAnchor(previousShot);
  const currentLocation = inferLocationAnchor(currentShot);
  if (previousLocation !== currentLocation) {
    return true;
  }

  const previousTime = inferTimeAnchor(previousShot);
  const currentTime = inferTimeAnchor(currentShot);
  if (previousTime !== currentTime) {
    return true;
  }

  const sharedCharacterCount = getSharedCharacterCount(previousShot.characters, currentShot.characters);
  const previousAction = normalizeText(previousShot.action);
  const currentAction = normalizeText(currentShot.action);

  if (sharedCharacterCount === 0 && previousAction && currentAction && previousAction !== currentAction) {
    return true;
  }

  return false;
}

export function groupShotsIntoScenes(shots = []) {
  const normalizedShots = Array.isArray(shots) ? shots : [];
  const scenes = [];
  let currentScene = null;

  for (const shot of normalizedShots) {
    if (!currentScene || shouldStartNewScene(currentScene.shots.at(-1), shot)) {
      currentScene = {
        sceneIndex: scenes.length,
        shots: [],
      };
      scenes.push(currentScene);
    }
    currentScene.shots.push(shot);
  }

  return scenes;
}

function inferSceneGoal(shots = []) {
  const actionText = shots.map((shot) => normalizeText(shot.action)).filter(Boolean).join('，');
  if (/逃离|冲出|撞开|离开|奔出/.test(actionText)) {
    return '让观众看懂角色如何脱离当前危险。';
  }
  if (/逼近|对峙|举枪|威胁|拦住/.test(actionText)) {
    return '建立威胁关系并清楚交代谁在掌控局面。';
  }
  return '用最少镜头把戏剧目标和空间关系讲清楚。';
}

function inferDramaticQuestion(shots = []) {
  const actionText = shots.map((shot) => normalizeText(shot.action)).filter(Boolean).join('，');
  if (/逃离|冲出|撞开|离开|奔出/.test(actionText)) {
    return '角色能否带着当前代价离开现场？';
  }
  if (/逼近|对峙|举枪|威胁|拦住/.test(actionText)) {
    return '这一轮对峙里谁先压制住对方？';
  }
  return '这一场戏结束时，局面会朝哪个方向改变？';
}

function inferPowerShift(shots = []) {
  const actionText = shots.map((shot) => normalizeText(shot.action)).filter(Boolean).join('，');
  if (/逃离|冲出|摆脱|撞开|离开/.test(actionText)) {
    return 'pressure_to_escape';
  }
  if (/逼近|威胁|举枪|按住|拦住/.test(actionText)) {
    return 'dominance_established';
  }
  return 'stable';
}

function inferEmotionalCurve(shots = []) {
  const actionText = shots.map((shot) => normalizeText(shot.action)).filter(Boolean).join('，');
  if (/冲出|奔跑|逃|爆/.test(actionText)) {
    return 'tension_to_release';
  }
  if (/对峙|逼近|停步|凝视/.test(actionText)) {
    return 'slow_burn_to_spike';
  }
  return 'steady_tension';
}

function inferCameraGrammar(shots = []) {
  const shotCount = shots.length;
  return {
    coverage: shotCount > 2 ? 'master_plus_selective_coverage' : 'selective_clarity_coverage',
    movement: /追|跑|冲/.test(shots.map((shot) => normalizeText(shot.action)).join('，'))
      ? 'controlled_follow'
      : 'restrained',
    lens_bias: 'naturalistic',
  };
}

function buildSpaceLayout(shots = []) {
  const locations = [...new Set(shots.map((shot) => inferLocationAnchor(shot)).filter(Boolean))];
  return {
    primary_zone: locations[0] || 'unanchored_location',
    secondary_zone: locations[1] || null,
    geography_note: locations.length > 1 ? `空间递进：${locations.join(' -> ')}` : `主空间：${locations[0] || '未知'}`,
  };
}

export function buildScenePackFromShots(shots = [], sceneIndex = 0) {
  const normalizedShots = Array.isArray(shots) ? shots : [];
  const firstShot = normalizedShots[0] || {};
  const lastShot = normalizedShots.at(-1) || firstShot;
  const cast = [...new Set(normalizedShots.flatMap((shot) => normalizeCharacterList(shot.characters)))];
  const locationAnchor = inferLocationAnchor(firstShot);
  const timeAnchor = inferTimeAnchor(firstShot);
  const sceneNumber = String(sceneIndex + 1).padStart(3, '0');
  const actionBeats = normalizedShots.map((shot, index) => ({
    beat_id: `scene_${sceneNumber}_beat_${String(index + 1).padStart(2, '0')}`,
    shot_ids: normalizeText(shot.id) ? [shot.id] : [],
    summary: extractBeatSummary(shot),
    dramatic_turn: index === normalizedShots.length - 1 ? 'handoff_ready' : null,
  }));

  return createScenePack({
    scene_id: `scene_${sceneNumber}`,
    scene_title: `${locationAnchor} ${sceneNumber}`,
    scene_goal: inferSceneGoal(normalizedShots),
    dramatic_question: inferDramaticQuestion(normalizedShots),
    start_state: extractBeatSummary(firstShot),
    end_state: extractBeatSummary(lastShot),
    location_anchor: locationAnchor,
    time_anchor: timeAnchor,
    cast,
    power_shift: inferPowerShift(normalizedShots),
    emotional_curve: inferEmotionalCurve(normalizedShots),
    action_beats: actionBeats,
    visual_motif: `${locationAnchor} 的写实压迫感`,
    space_layout: buildSpaceLayout(normalizedShots),
    camera_grammar: inferCameraGrammar(normalizedShots),
    hard_locks: [
      `keep geography readable in ${locationAnchor}`,
      'preserve character wardrobe and facing continuity',
      'prioritize readable entry and exit states',
    ],
    forbidden_choices: [
      'random axis flips',
      'unmotivated handheld chaos',
      'stylized impossible camera moves',
    ],
    delivery_priority: normalizedShots.length > 2 ? 'narrative_coherence' : 'character_readability',
  });
}

function buildMetrics(scenePacks = []) {
  return {
    plannedSceneCount: scenePacks.length,
    totalBeatCount: scenePacks.reduce((count, pack) => count + pack.action_beats.length, 0),
    locations: [...new Set(scenePacks.map((pack) => pack.location_anchor).filter(Boolean))],
  };
}

function writeArtifacts(scenePacks, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const metrics = buildMetrics(scenePacks);
  saveJSON(path.join(artifactContext.outputsDir, 'scene-packs.json'), scenePacks);
  saveJSON(path.join(artifactContext.metricsDir, 'scene-pack-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    plannedSceneCount: scenePacks.length,
    outputFiles: ['scene-packs.json', 'scene-pack-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'sceneGrammarAgent',
      agentName: 'Scene Grammar Agent',
      status: 'pass',
      headline: `已提炼 ${scenePacks.length} 个场景包`,
      summary: '场景层先定义戏剧目标、空间关系和交接状态，为后续导演层准备输入。',
      passItems: [`场景数：${scenePacks.length}`],
      nextAction: '可以继续生成 director pack 或沿用旧链路继续出片。',
      evidenceFiles: ['1-outputs/scene-packs.json', '2-metrics/scene-pack-metrics.json'],
      metrics,
    },
    artifactContext
  );
}

export async function planSceneGrammar(shots = [], options = {}) {
  const sceneGroups = groupShotsIntoScenes(shots);
  const scenePacks = sceneGroups.map((group, index) => buildScenePackFromShots(group.shots, index));
  writeArtifacts(scenePacks, options.artifactContext);
  return scenePacks;
}

export const __testables = {
  buildScenePackFromShots,
  extractBeatSummary,
  groupShotsIntoScenes,
  inferDramaticQuestion,
  inferEmotionalCurve,
  inferLocationAnchor,
  inferPowerShift,
  inferSceneGoal,
  inferTimeAnchor,
  shouldStartNewScene,
};
