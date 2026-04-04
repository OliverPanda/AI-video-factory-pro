import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

const execFileAsync = promisify(execFile);

function decideEnhancement(rawVideoResult = {}, shotPackage = {}) {
  if (rawVideoResult.status !== 'completed' || !rawVideoResult.videoPath) {
    return {
      decision: 'skip_enhance',
      profile: 'none',
      reason: 'video_unavailable',
    };
  }

  const hints = Array.isArray(shotPackage.enhancementHints) ? shotPackage.enhancementHints : [];
  if (hints.length === 0) {
    return {
      decision: 'pass_through',
      profile: 'none',
      reason: 'no_enhancement_needed',
    };
  }

  return {
    decision: 'enhance',
    profile: hints[0],
    reason: 'enhancement_hints_present',
  };
}

async function defaultEnhanceVideoFile({ inputPath, outputPath }) {
  ensureDir(path.dirname(outputPath));
  await execFileAsync(
    'ffmpeg',
    ['-y', '-i', inputPath, '-vf', 'fps=24', '-pix_fmt', 'yuv420p', outputPath],
    { windowsHide: true }
  );
  return {
    enhancementActions: ['motion_smoothness_enhancement', 'encoding_normalization'],
    durationAdjusted: false,
    qualityDelta: 'normalized',
  };
}

function buildEnhancedOutputPath(sourceVideoPath) {
  return path.join(path.dirname(sourceVideoPath), 'enhanced', path.basename(sourceVideoPath));
}

function writeArtifacts(results, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'enhanced-video-results.json'), results);
  saveJSON(path.join(artifactContext.metricsDir, 'motion-enhancer-metrics.json'), {
    plannedShotCount: results.length,
    enhancedCount: results.filter((item) => item.enhancementApplied).length,
    skippedCount: results.filter((item) => item.status === 'skipped').length,
  });
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    plannedShotCount: results.length,
    outputFiles: ['enhanced-video-results.json', 'motion-enhancer-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'motionEnhancer',
      agentName: 'Motion Enhancer',
      status: 'pass',
      headline: `已处理 ${results.length} 个镜头增强决策`,
      summary: '当前已为可增强镜头生成增强后视频结果，并保留跳过与透传决策。',
      passItems: [`增强镜头数：${results.filter((item) => item.enhancementApplied).length}`],
      nextAction: '可以继续进入 Shot QA v2。',
      evidenceFiles: ['1-outputs/enhanced-video-results.json', '2-metrics/motion-enhancer-metrics.json'],
      metrics: { plannedShotCount: results.length },
    },
    artifactContext
  );
}

export async function runMotionEnhancer(rawVideoResults = [], shotPackages = [], options = {}) {
  const results = [];
  const enhanceVideoFile = options.enhanceVideoFile || defaultEnhanceVideoFile;

  for (const rawVideoResult of rawVideoResults) {
    const shotPackage = shotPackages.find((item) => item.shotId === rawVideoResult.shotId) || {};
    const decision = decideEnhancement(rawVideoResult, shotPackage);

    if (decision.decision === 'skip_enhance') {
      results.push({
        shotId: rawVideoResult.shotId,
        sourceVideoPath: rawVideoResult.videoPath || null,
        enhancementApplied: false,
        enhancementProfile: decision.profile,
        enhancementActions: [],
        enhancedVideoPath: rawVideoResult.videoPath || null,
        durationAdjusted: false,
        cameraMotionInjected: false,
        interpolationApplied: false,
        stabilizationApplied: false,
        qualityDelta: 'unchanged',
        status: 'skipped',
        error: null,
      });
      continue;
    }

    if (decision.decision === 'pass_through') {
      results.push({
        shotId: rawVideoResult.shotId,
        sourceVideoPath: rawVideoResult.videoPath,
        enhancementApplied: false,
        enhancementProfile: decision.profile,
        enhancementActions: [],
        enhancedVideoPath: rawVideoResult.videoPath,
        durationAdjusted: false,
        cameraMotionInjected: false,
        interpolationApplied: false,
        stabilizationApplied: false,
        qualityDelta: 'unchanged',
        status: 'completed',
        error: null,
      });
      continue;
    }

    const outputPath = buildEnhancedOutputPath(rawVideoResult.videoPath);
    ensureDir(path.dirname(outputPath));
    try {
      const enhancement = await enhanceVideoFile({
        inputPath: rawVideoResult.videoPath,
        outputPath,
        rawVideoResult,
        shotPackage,
        options,
      });
      results.push({
        shotId: rawVideoResult.shotId,
        sourceVideoPath: rawVideoResult.videoPath,
        enhancementApplied: true,
        enhancementProfile: decision.profile,
        enhancementActions: enhancement.enhancementActions || [],
        enhancedVideoPath: outputPath,
        durationAdjusted: Boolean(enhancement.durationAdjusted),
        cameraMotionInjected: Boolean(enhancement.cameraMotionInjected),
        interpolationApplied: Boolean(enhancement.interpolationApplied),
        stabilizationApplied: Boolean(enhancement.stabilizationApplied),
        qualityDelta: enhancement.qualityDelta || 'improved',
        status: 'completed',
        error: null,
      });
    } catch (error) {
      results.push({
        shotId: rawVideoResult.shotId,
        sourceVideoPath: rawVideoResult.videoPath,
        enhancementApplied: false,
        enhancementProfile: decision.profile,
        enhancementActions: [],
        enhancedVideoPath: rawVideoResult.videoPath,
        durationAdjusted: false,
        cameraMotionInjected: false,
        interpolationApplied: false,
        stabilizationApplied: false,
        qualityDelta: 'unchanged',
        status: 'failed',
        error: error.message,
      });
    }
  }

  writeArtifacts(results, options.artifactContext);
  return results;
}

export const __testables = {
  buildEnhancedOutputPath,
  decideEnhancement,
};
