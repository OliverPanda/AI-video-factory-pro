import path from 'node:path';

import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function findAssetByShotId(items = [], shotId) {
  return (Array.isArray(items) ? items : []).find((entry) => entry?.shotId === shotId) || null;
}

function buildPromptDirectives(planEntry) {
  return [
    `bridge type: ${planEntry.bridgeType}`,
    `bridge goal: ${planEntry.bridgeGoal}`,
    `camera intent: ${planEntry.cameraTransitionIntent}`,
    `preserve: ${(Array.isArray(planEntry.mustPreserveElements) ? planEntry.mustPreserveElements : []).join(', ')}`,
  ];
}

function resolveRoutingMode(planEntry, fromReferenceImage, toReferenceImage) {
  if (!fromReferenceImage || !toReferenceImage) {
    return {
      preferredProvider: 'fallback_direct_cut',
      fallbackProviders: [],
      providerCapabilityRequirement: 'none',
      firstLastFrameMode: 'disabled',
    };
  }

  if (planEntry.bridgeGenerationMode === 'first_last_keyframe') {
    return {
      preferredProvider: planEntry.preferredProvider || 'sora2',
      fallbackProviders: ['direct_cut'],
      providerCapabilityRequirement: 'first_last_keyframe',
      firstLastFrameMode: 'required',
    };
  }

  return {
    preferredProvider: planEntry.preferredProvider || 'sora2',
    fallbackProviders: ['direct_cut'],
    providerCapabilityRequirement: 'image_to_video',
    firstLastFrameMode: 'disabled',
  };
}

function buildBridgeShotPackage(planEntry, options = {}) {
  const fromImageResult = findAssetByShotId(options.imageResults, planEntry.fromShotId);
  const toImageResult = findAssetByShotId(options.imageResults, planEntry.toShotId);
  const fromVideoResult = findAssetByShotId(options.videoResults, planEntry.fromShotId);
  const toVideoResult = findAssetByShotId(options.videoResults, planEntry.toShotId);
  const fromReferenceImage = fromImageResult?.imagePath || null;
  const toReferenceImage = toImageResult?.imagePath || null;
  const routingMode = resolveRoutingMode(planEntry, fromReferenceImage, toReferenceImage);

  return {
    bridgeId: planEntry.bridgeId,
    fromShotRef: fromVideoResult ? { shotId: planEntry.fromShotId, videoPath: fromVideoResult.videoPath } : { shotId: planEntry.fromShotId },
    toShotRef: toVideoResult ? { shotId: planEntry.toShotId, videoPath: toVideoResult.videoPath } : { shotId: planEntry.toShotId },
    fromReferenceImage,
    toReferenceImage,
    promptDirectives: buildPromptDirectives(planEntry),
    negativePromptDirectives: ['identity drift', 'flash frame', 'axis break'],
    durationTargetSec: planEntry.durationTargetSec,
    providerCapabilityRequirement: routingMode.providerCapabilityRequirement,
    firstLastFrameMode: routingMode.firstLastFrameMode,
    preferredProvider: routingMode.preferredProvider,
    fallbackProviders: routingMode.fallbackProviders,
    qaRules: {
      mustProbeWithFfprobe: true,
      mustConnectFromShot: true,
      mustConnectToShot: true,
      canFallbackToDirectCut: true,
    },
  };
}

export function buildBridgeShotPackages(bridgeShotPlan = [], options = {}) {
  return (Array.isArray(bridgeShotPlan) ? bridgeShotPlan : []).map((planEntry) =>
    buildBridgeShotPackage(planEntry, options)
  );
}

function writeArtifacts(bridgeShotPackages, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const metrics = {
    routedBridgeShotCount: bridgeShotPackages.length,
    preferredProviderBreakdown: bridgeShotPackages.reduce((acc, item) => {
      acc[item.preferredProvider] = (acc[item.preferredProvider] || 0) + 1;
      return acc;
    }, {}),
  };
  saveJSON(path.join(artifactContext.outputsDir, 'bridge-shot-packages.json'), bridgeShotPackages);
  saveJSON(path.join(artifactContext.metricsDir, 'bridge-routing-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    routedBridgeShotCount: bridgeShotPackages.length,
    outputFiles: ['bridge-shot-packages.json', 'bridge-routing-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'bridgeShotRouter',
      agentName: 'Bridge Shot Router',
      status: 'pass',
      headline: `已路由 ${bridgeShotPackages.length} 个 bridge shot`,
      summary: '当前已完成桥接镜头的 provider 能力分层、参考资产绑定和保守回退决策。',
      passItems: [`桥接路由数：${bridgeShotPackages.length}`],
      nextAction: '可以继续进入 bridge clip 生成阶段。',
      evidenceFiles: ['1-outputs/bridge-shot-packages.json', '2-metrics/bridge-routing-metrics.json'],
      metrics,
    },
    artifactContext
  );
}

export async function routeBridgeShots(bridgeShotPlan = [], options = {}) {
  const bridgeShotPackages = buildBridgeShotPackages(bridgeShotPlan, options);
  writeArtifacts(bridgeShotPackages, options.artifactContext);
  return bridgeShotPackages;
}

export const __testables = {
  buildBridgeShotPackage,
  buildBridgeShotPackages,
};

export default {
  routeBridgeShots,
};
