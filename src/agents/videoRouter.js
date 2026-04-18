import path from 'node:path';

import { findCharacterByIdentity, resolveCharacterIdentity } from './characterRegistry.js';
import { buildSeedancePromptPackages } from './seedancePromptAgent.js';
import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function resolvePreferredVideoProvider(options = {}) {
  const rawProvider = options.videoProvider || process.env.VIDEO_PROVIDER || 'seedance';
  if (rawProvider === 'fallback_video' || rawProvider === 'runway') {
    return 'sora2';
  }
  return rawProvider;
}

function resolveExecutionPrompt(promptEntry, motionEntry) {
  return promptEntry?.image_prompt_en || promptEntry?.image_prompt || motionEntry.visualGoal;
}

function resolveExecutionNegativePrompt(promptEntry) {
  return promptEntry?.negative_prompt_en || promptEntry?.negative_prompt || '';
}

function buildProviderRequestHints({
  shot,
  motionEntry,
  imageResult,
  promptEntry,
  executionNegativePrompt,
  performanceEntry,
  hasReferenceImage,
}) {
  const continuityTargets = [
    motionEntry?.storyBeat || performanceEntry?.storyBeat || null,
    motionEntry?.spaceAnchor || performanceEntry?.spaceAnchor ? `space:${motionEntry?.spaceAnchor || performanceEntry?.spaceAnchor}` : null,
    (motionEntry?.screenDirection || performanceEntry?.screenDirection) &&
    (motionEntry?.screenDirection || performanceEntry?.screenDirection) !== 'unspecified'
      ? `screen_direction:${motionEntry?.screenDirection || performanceEntry?.screenDirection}`
      : null,
  ].filter(Boolean);
  const hardContinuityRules = [
    motionEntry?.spaceAnchor || performanceEntry?.spaceAnchor
      ? `keep the shot grounded in ${motionEntry?.spaceAnchor || performanceEntry?.spaceAnchor}`
      : null,
    (motionEntry?.screenDirection || performanceEntry?.screenDirection) &&
    (motionEntry?.screenDirection || performanceEntry?.screenDirection) !== 'unspecified'
      ? `preserve subject travel and facing direction toward ${motionEntry?.screenDirection || performanceEntry?.screenDirection}`
      : null,
    motionEntry?.storyBeat || performanceEntry?.storyBeat
      ? `open on the incoming beat and end on a readable handoff for ${motionEntry?.storyBeat || performanceEntry?.storyBeat}`
      : null,
  ].filter(Boolean);

  return {
    shotId: shot.id,
    scene: shot.scene || null,
    action: shot.action || null,
    hasReferenceImage,
    promptSource: (promptEntry?.image_prompt_en || promptEntry?.image_prompt) ? 'prompt_list' : 'motion_plan',
    negativePrompt: executionNegativePrompt,
    targetModelTier: performanceEntry?.generationTier || 'base',
    requestedDurationSec: motionEntry.durationTargetSec,
    requestedRatio: motionEntry?.cameraSpec?.ratio || null,
    requestedMoveType: motionEntry?.cameraSpec?.moveType || null,
    referenceImagePath: imageResult?.imagePath || null,
    storyBeat: motionEntry?.storyBeat || performanceEntry?.storyBeat || null,
    screenDirection: motionEntry?.screenDirection || performanceEntry?.screenDirection || 'unspecified',
    spaceAnchor: motionEntry?.spaceAnchor || performanceEntry?.spaceAnchor || null,
    continuityTargets,
    hardContinuityRules,
    cameraFlowIntent:
      performanceEntry?.cameraMovePlan?.intent ||
      motionEntry?.cameraIntent ||
      motionEntry?.cameraSpec?.moveType ||
      null,
  };
}

function collectReferenceImages(shot, imageResult, shotIndex, shots, imageResults, options = {}) {
  const images = [];
  if (imageResult?.imagePath) {
    images.push({ type: 'keyframe', path: imageResult.imagePath, shotId: shot.id });
  }
  const characterRegistry = Array.isArray(options.characterRegistry) ? options.characterRegistry : [];
  const shotCharacterIds = (Array.isArray(shot.characters) ? shot.characters : [])
    .map((c) => resolveCharacterIdentity(c))
    .filter(Boolean);
  for (const charId of shotCharacterIds) {
    if (images.length >= 9) break;
    const card = findCharacterByIdentity(characterRegistry, charId);
    if (card?.referenceImagePath) {
      images.push({ type: 'character_reference', path: card.referenceImagePath, characterId: charId });
    }
  }
  const adjacentIndices = [shotIndex - 1, shotIndex + 1];
  for (const adjIdx of adjacentIndices) {
    if (images.length >= 9) break;
    if (adjIdx >= 0 && adjIdx < shots.length) {
      const adjResult = imageResults.find((r) => r.shotId === shots[adjIdx].id);
      if (adjResult?.imagePath) {
        images.push({ type: 'adjacent_shot', path: adjResult.imagePath, shotId: shots[adjIdx].id });
      }
    }
  }
  return images.slice(0, 9);
}

function buildShotPackage(shot, motionEntry, imageResult, promptEntry, options = {}) {
  const hasReferenceImage = Boolean(imageResult?.imagePath);
  const performanceEntry = options.performancePlan?.find((item) => item.shotId === shot.id) || null;
  const executionPrompt = resolveExecutionPrompt(promptEntry, motionEntry);
  const executionNegativePrompt = resolveExecutionNegativePrompt(promptEntry);
  const preferredVideoProvider = resolvePreferredVideoProvider(options);
  const preferredProvider = hasReferenceImage ? preferredVideoProvider : 'static_image';
  const fallbackProviders = hasReferenceImage ? ['static_image'] : [];
  const referenceImages = hasReferenceImage
    ? collectReferenceImages(
        shot,
        imageResult,
        options._shotIndex ?? 0,
        options._shots ?? [],
        options._imageResults ?? [],
        options
      )
    : [];
  return {
    shotId: shot.id,
    shotType: motionEntry.shotType,
    durationTargetSec: motionEntry.durationTargetSec,
    visualGoal: executionPrompt,
    cameraSpec: motionEntry.cameraSpec,
    referenceImages,
    preferredProvider,
    fallbackProviders,
    providerRequestHints: buildProviderRequestHints({
      shot,
      motionEntry,
      imageResult,
      promptEntry,
      executionNegativePrompt,
      performanceEntry,
      hasReferenceImage,
    }),
    audioRef: options.audioRef || null,
    continuityContext: performanceEntry?.continuityContext || motionEntry.continuityContext || null,
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
  return shots.map((shot, index) => {
    const motionEntry = motionPlan.find((item) => item.shotId === shot.id);
    if (!motionEntry) {
      throw new Error(`缺少镜头动态规划：${shot.id}`);
    }
    const imageResult = imageResults.find((item) => item.shotId === shot.id);
    const promptEntry = options.promptList?.find((item) => item.shotId === shot.id) || null;
    return buildShotPackage(shot, motionEntry, imageResult, promptEntry, {
      ...options,
      _shotIndex: index,
      _shots: shots,
      _imageResults: imageResults,
    });
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
  const enrichedShotPackages = buildSeedancePromptPackages(shotPackages, {
    shots,
    motionPlan,
    scenePacks: options.scenePacks,
    directorPacks: options.directorPacks,
    artifactContext: options.seedancePromptArtifactContext,
  });
  writeArtifacts(enrichedShotPackages, options.artifactContext);
  return enrichedShotPackages;
}

export const __testables = {
  buildShotPackage,
  buildShotPackages,
  buildProviderRequestHints,
  collectReferenceImages,
  resolveExecutionPrompt,
  resolveExecutionNegativePrompt,
  resolvePreferredVideoProvider,
};
