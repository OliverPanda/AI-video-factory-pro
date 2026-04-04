import path from 'node:path';

import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function inferPerformanceTemplate(motionEntry = {}) {
  if (motionEntry.performanceTemplate) {
    return motionEntry.performanceTemplate;
  }

  switch (motionEntry.shotType) {
    case 'dialogue_closeup':
      return 'dialogue_closeup_react';
    case 'dialogue_medium':
      return Array.isArray(motionEntry.participants) && motionEntry.participants.length >= 2
        ? 'dialogue_two_shot_tension'
        : 'emotion_push_in';
    case 'insert_impact':
      return 'fight_impact_insert';
    case 'fight_wide':
      return 'fight_exchange_medium';
    case 'ambient_transition':
      return 'ambient_transition_motion';
    default:
      return 'dialogue_generic';
  }
}

function inferGenerationTier(performanceTemplate) {
  if (performanceTemplate === 'fight_impact_insert') {
    return 'hero';
  }
  if (
    performanceTemplate === 'dialogue_closeup_react' ||
    performanceTemplate === 'dialogue_two_shot_tension' ||
    performanceTemplate === 'emotion_push_in'
  ) {
    return 'enhanced';
  }
  return 'base';
}

function inferVariantCount(generationTier) {
  if (generationTier === 'hero') {
    return 3;
  }
  if (generationTier === 'enhanced') {
    return 2;
  }
  return 1;
}

function buildPerformancePlanEntry(motionEntry = {}) {
  const performanceTemplate = inferPerformanceTemplate(motionEntry);
  const generationTier = motionEntry.generationTier || inferGenerationTier(performanceTemplate);
  const variantCount = motionEntry.variantCount || inferVariantCount(generationTier);
  return {
    shotId: motionEntry.shotId,
    order: motionEntry.order ?? null,
    performanceTemplate,
    subjectBlocking: Array.isArray(motionEntry.subjectBlocking) ? motionEntry.subjectBlocking : [],
    actionBeatList: Array.isArray(motionEntry.actionBeatList) ? motionEntry.actionBeatList : [],
    cameraMovePlan: motionEntry.cameraMovePlan || {
      intent: motionEntry.cameraIntent || null,
      shotType: motionEntry.shotType || null,
    },
    motionIntensity: motionEntry.motionIntensity || 'low',
    tempoCurve: motionEntry.tempoCurve || 'steady',
    expressionCue: motionEntry.expressionCue || null,
    providerPromptDirectives: Array.isArray(motionEntry.providerPromptDirectives)
      ? motionEntry.providerPromptDirectives
      : [],
    enhancementHints: Array.isArray(motionEntry.enhancementHints) ? motionEntry.enhancementHints : [],
    generationTier,
    variantCount,
  };
}

export function buildPerformancePlan(motionPlan = []) {
  return motionPlan.map((entry) => buildPerformancePlanEntry(entry));
}

function writeArtifacts(performancePlan, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'performance-plan.json'), performancePlan);
  saveJSON(path.join(artifactContext.metricsDir, 'performance-plan-metrics.json'), {
    plannedShotCount: performancePlan.length,
    templateBreakdown: performancePlan.reduce((acc, item) => {
      acc[item.performanceTemplate] = (acc[item.performanceTemplate] || 0) + 1;
      return acc;
    }, {}),
    generationTierBreakdown: performancePlan.reduce((acc, item) => {
      acc[item.generationTier] = (acc[item.generationTier] || 0) + 1;
      return acc;
    }, {}),
  });
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    plannedShotCount: performancePlan.length,
    outputFiles: ['performance-plan.json', 'performance-plan-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'performancePlanner',
      agentName: 'Performance Planner',
      status: 'pass',
      headline: `已为 ${performancePlan.length} 个镜头生成表演规划`,
      summary: '当前已生成 Phase 2 的镜头模板、动作节拍和生成层级基础信息。',
      passItems: [`镜头数：${performancePlan.length}`],
      nextAction: '可以继续进入 Phase 2 视频路由阶段。',
      evidenceFiles: ['1-outputs/performance-plan.json', '2-metrics/performance-plan-metrics.json'],
      metrics: { plannedShotCount: performancePlan.length },
    },
    artifactContext
  );
}

export async function planPerformance(motionPlan = [], options = {}) {
  const performancePlan = buildPerformancePlan(motionPlan);
  writeArtifacts(performancePlan, options.artifactContext);
  return performancePlan;
}

export const __testables = {
  buildPerformancePlanEntry,
  buildPerformancePlan,
  inferGenerationTier,
  inferPerformanceTemplate,
  inferVariantCount,
};
