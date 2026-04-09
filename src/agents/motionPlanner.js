import path from 'node:path';

import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function inferShotType(shot) {
  const camera = normalizeText(shot?.camera_type || shot?.cameraType || shot?.camera).toLowerCase();
  const scene = normalizeText(shot?.scene);
  const action = normalizeText(shot?.action);
  const dialogue = normalizeText(shot?.dialogue);

  if (/爆炸|撞击|挥剑|刺入|击中|落地|闪回|特写物件/.test(action)) {
    return 'insert_impact';
  }
  if (/打斗|交锋|混战|厮杀|追逐|围攻/.test(action) || /广角|wide/.test(camera)) {
    return 'fight_wide';
  }
  if (!dialogue && /空镜|转场|宫殿|夜色|风景|环境|外景/.test(`${scene} ${action}`)) {
    return 'ambient_transition';
  }
  if (dialogue && (shot?.isCloseUp === true || /特写|close/.test(camera))) {
    return 'dialogue_closeup';
  }
  if (dialogue) {
    return 'dialogue_medium';
  }
  return 'ambient_transition';
}

function buildCameraSpec(shotType) {
  const presets = {
    dialogue_closeup: {
      template: 'closeup_push_hold',
      lensIntent: 'portrait_close',
      moveType: 'subtle_push_in',
      framing: 'close_up',
      speed: 'slow',
      ratio: '9:16',
    },
    dialogue_medium: {
      template: 'medium_follow',
      lensIntent: 'medium_portrait',
      moveType: 'slow_dolly',
      framing: 'medium',
      speed: 'slow',
      ratio: '9:16',
    },
    fight_wide: {
      template: 'wide_combat_tracking',
      lensIntent: 'dynamic_wide',
      moveType: 'tracking_pan',
      framing: 'wide',
      speed: 'medium',
      ratio: '9:16',
    },
    insert_impact: {
      template: 'impact_insert',
      lensIntent: 'detail_insert',
      moveType: 'snap_in',
      framing: 'insert',
      speed: 'fast',
      ratio: '9:16',
    },
    ambient_transition: {
      template: 'ambient_drift',
      lensIntent: 'environmental',
      moveType: 'slow_drift',
      framing: 'wide',
      speed: 'slow',
      ratio: '9:16',
    },
  };

  return presets[shotType] || presets.ambient_transition;
}

function buildVideoGenerationMode(shotType) {
  if (shotType === 'insert_impact') {
    return 'sora2_image_to_video';
  }
  return 'sora2_image_to_video';
}

function buildVisualGoal(shot) {
  return [shot?.scene, shot?.action, shot?.mood, shot?.dialogue ? `人物说台词：${shot.dialogue}` : '']
    .filter(Boolean)
    .join('，');
}

export function buildMotionPlan(shots = []) {
  return shots.map((shot, index) => {
    const shotType = inferShotType(shot);
    return {
      shotId: shot.id,
      order: index,
      shotType,
      durationTargetSec: Number(shot.duration || shot.durationSec || 3),
      cameraIntent: buildCameraSpec(shotType).moveType,
      cameraSpec: buildCameraSpec(shotType),
      videoGenerationMode: buildVideoGenerationMode(shotType),
      visualGoal: buildVisualGoal(shot),
    };
  });
}

function writeArtifacts(motionPlan, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'motion-plan.json'), motionPlan);
  saveJSON(path.join(artifactContext.metricsDir, 'motion-plan-metrics.json'), {
    plannedShotCount: motionPlan.length,
    shotTypeBreakdown: motionPlan.reduce((acc, item) => {
      acc[item.shotType] = (acc[item.shotType] || 0) + 1;
      return acc;
    }, {}),
  });
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    plannedShotCount: motionPlan.length,
    outputFiles: ['motion-plan.json', 'motion-plan-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'motionPlanner',
      agentName: 'Motion Planner',
      status: 'pass',
      headline: `已为 ${motionPlan.length} 个镜头生成动态规划`,
      summary: '当前已生成 Phase 1 的镜头类型、运镜意图和视频生成模式。',
      passItems: [`镜头数：${motionPlan.length}`],
      nextAction: '可以继续进入视频路由与镜头生成阶段。',
      evidenceFiles: ['1-outputs/motion-plan.json', '2-metrics/motion-plan-metrics.json'],
      metrics: { plannedShotCount: motionPlan.length },
    },
    artifactContext
  );
}

export async function planMotion(shots = [], options = {}) {
  const motionPlan = buildMotionPlan(shots);
  writeArtifacts(motionPlan, options.artifactContext);
  return motionPlan;
}

export const __testables = {
  buildCameraSpec,
  buildMotionPlan,
  buildVideoGenerationMode,
  inferShotType,
};
