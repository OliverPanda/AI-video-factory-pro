import path from 'node:path';

import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function resolvePreferredVideoProvider(options = {}) {
  const rawProvider = options.videoProvider || process.env.VIDEO_PROVIDER || 'seedance';
  if (rawProvider === 'fallback_video' || rawProvider === 'runway') {
    return 'sora2';
  }
  return rawProvider;
}

function buildProviderRequestHints({
  shot,
  motionEntry,
  imageResult,
  promptEntry,
  performanceEntry,
  hasReferenceImage,
}) {
  return {
    shotId: shot.id,
    scene: shot.scene || null,
    action: shot.action || null,
    hasReferenceImage,
    promptSource: promptEntry?.image_prompt ? 'prompt_list' : 'motion_plan',
    targetModelTier: performanceEntry?.generationTier || 'base',
    requestedDurationSec: motionEntry.durationTargetSec,
    requestedRatio: motionEntry?.cameraSpec?.ratio || null,
    requestedMoveType: motionEntry?.cameraSpec?.moveType || null,
    referenceImagePath: imageResult?.imagePath || null,
  };
}

function buildShotPackage(shot, motionEntry, imageResult, promptEntry, options = {}) {
  const hasReferenceImage = Boolean(imageResult?.imagePath);
  const performanceEntry = options.performancePlan?.find((item) => item.shotId === shot.id) || null;
  const preferredVideoProvider = resolvePreferredVideoProvider(options);
  const preferredProvider = hasReferenceImage ? preferredVideoProvider : 'static_image';
  const fallbackProviders = hasReferenceImage ? ['static_image'] : [];
  return {
    shotId: shot.id,
    shotType: motionEntry.shotType,
    durationTargetSec: motionEntry.durationTargetSec,
    visualGoal: promptEntry?.image_prompt || motionEntry.visualGoal,
    cameraSpec: motionEntry.cameraSpec,
    referenceImages: hasReferenceImage
      ? [
          {
            type: 'keyframe',
            path: imageResult.imagePath,
          },
        ]
      : [],
    preferredProvider,
    fallbackProviders,
    providerRequestHints: buildProviderRequestHints({
      shot,
      motionEntry,
      imageResult,
      promptEntry,
      performanceEntry,
      hasReferenceImage,
    }),
    audioRef: options.audioRef || null,
    performanceTemplate: performanceEntry?.performanceTemplate || null,
    actionBeatList: performanceEntry?.actionBeatList || [],
    cameraMovePlan: performanceEntry?.cameraMovePlan || null,
    generationTier: performanceEntry?.generationTier || 'base',
    variantCount: performanceEntry?.variantCount || 1,
    candidateSelectionRule: performanceEntry?.candidateSelectionRule || 'single_best',
    regenPolicy: performanceEntry?.regenPolicy || 'retry_once_then_fallback',
    firstLastFramePolicy: performanceEntry?.firstLastFramePolicy || 'first_frame_required',
    enhancementHints: performanceEntry?.enhancementHints || [],
    qaRules: {
      mustProbeWithFfprobe: true,
      mustHaveNonZeroDuration: true,
      canFallbackToStaticImage: true,
    },
  };
}

export function buildShotPackages(shots = [], motionPlan = [], imageResults = [], options = {}) {
  return shots.map((shot) => {
    const motionEntry = motionPlan.find((item) => item.shotId === shot.id);
    if (!motionEntry) {
      throw new Error(`缺少镜头动态规划：${shot.id}`);
    }
    const imageResult = imageResults.find((item) => item.shotId === shot.id);
    const promptEntry = options.promptList?.find((item) => item.shotId === shot.id) || null;
    return buildShotPackage(shot, motionEntry, imageResult, promptEntry, options);
  });
}

function writeArtifacts(shotPackages, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'shot-packages.json'), shotPackages);
  saveJSON(
    path.join(artifactContext.outputsDir, 'video-routing-decisions.json'),
    shotPackages.map((item) => ({
      shotId: item.shotId,
      preferredProvider: item.preferredProvider,
      fallbackProviders: item.fallbackProviders,
      providerRequestHints: item.providerRequestHints,
    }))
  );
  saveJSON(path.join(artifactContext.metricsDir, 'video-routing-metrics.json'), {
    routedShotCount: shotPackages.length,
    preferredProviderBreakdown: shotPackages.reduce((acc, item) => {
      acc[item.preferredProvider] = (acc[item.preferredProvider] || 0) + 1;
      return acc;
    }, {}),
  });
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    routedShotCount: shotPackages.length,
    outputFiles: ['shot-packages.json', 'video-routing-decisions.json', 'video-routing-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'videoRouter',
      agentName: 'Video Router',
      status: 'pass',
      headline: `已完成 ${shotPackages.length} 个镜头的视频路由`,
      summary: '当前已为镜头生成 provider 选择、参考图绑定和 QA 规则。',
      passItems: [`路由镜头数：${shotPackages.length}`],
      nextAction: '可以继续进入具体视频 provider 的动态镜头生成。',
      evidenceFiles: [
        '1-outputs/shot-packages.json',
        '1-outputs/video-routing-decisions.json',
        '2-metrics/video-routing-metrics.json',
      ],
      metrics: { routedShotCount: shotPackages.length },
    },
    artifactContext
  );
}

export async function routeVideoShots(shots = [], motionPlan = [], imageResults = [], options = {}) {
  const shotPackages = buildShotPackages(shots, motionPlan, imageResults, options);
  writeArtifacts(shotPackages, options.artifactContext);
  return shotPackages;
}

export const __testables = {
  buildShotPackage,
  buildShotPackages,
  buildProviderRequestHints,
  resolvePreferredVideoProvider,
};
