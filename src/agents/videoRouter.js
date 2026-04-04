import path from 'node:path';

import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function buildShotPackage(shot, motionEntry, imageResult, promptEntry, options = {}) {
  const hasReferenceImage = Boolean(imageResult?.imagePath);
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
    preferredProvider: hasReferenceImage ? 'runway' : 'static_image',
    fallbackProviders: hasReferenceImage ? ['static_image'] : [],
    audioRef: options.audioRef || null,
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
    outputFiles: ['shot-packages.json', 'video-routing-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'videoRouter',
      agentName: 'Video Router',
      status: 'pass',
      headline: `已完成 ${shotPackages.length} 个镜头的视频路由`,
      summary: '当前已为镜头生成 provider 选择、参考图绑定和 QA 规则。',
      passItems: [`路由镜头数：${shotPackages.length}`],
      nextAction: '可以继续进入 Runway 动态镜头生成。',
      evidenceFiles: ['1-outputs/shot-packages.json', '2-metrics/video-routing-metrics.json'],
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
};
