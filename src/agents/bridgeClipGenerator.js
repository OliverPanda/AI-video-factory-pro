import fs from 'node:fs';
import path from 'node:path';

import { createFallbackVideoClip } from '../apis/fallbackVideoApi.js';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function buildOutputPath(videoDir, bridgePackage) {
  return path.join(videoDir, `${bridgePackage.bridgeId}.mp4`);
}

function normalizeProviderError(error) {
  return {
    message: error?.message || 'unknown error',
    code: error?.code || 'BRIDGE_CLIP_ERROR',
    category: error?.category || 'provider_generation_failed',
    status: error?.status || null,
    details: error?.details || null,
  };
}

function buildBridgeClipReport(results = []) {
  const generated = results.filter((item) => item.status === 'completed');
  const failed = results.filter((item) => item.status === 'failed');
  const skipped = results.filter((item) => item.status === 'skipped');
  return {
    status: failed.length > 0 ? 'warn' : 'pass',
    plannedBridgeClipCount: results.length,
    generatedCount: generated.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    providerBreakdown: results.reduce((acc, item) => {
      const key = item.provider || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    modelBreakdown: results.reduce((acc, item) => {
      if (!item.model) {
        return acc;
      }
      acc[item.model] = (acc[item.model] || 0) + 1;
      return acc;
    }, {}),
  };
}

function writeArtifacts(results, report, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'bridge-clip-results.json'), results);
  saveJSON(path.join(artifactContext.metricsDir, 'bridge-clip-generation-report.json'), report);
  writeTextFile(
    path.join(artifactContext.outputsDir, 'bridge-clip-report.md'),
    [
      '| Bridge ID | Provider | Status | Failure Category | Output |',
      '| --- | --- | --- | --- | --- |',
      ...results.map((result) =>
        `| ${result.bridgeId} | ${result.provider || ''} | ${result.status} | ${result.failureCategory || ''} | ${result.videoPath || ''} |`
      ),
      '',
    ].join('\n')
  );
  for (const result of results.filter((item) => item.status === 'failed')) {
    saveJSON(path.join(artifactContext.errorsDir, `${result.bridgeId}-bridge-error.json`), result);
  }
  saveJSON(artifactContext.manifestPath, {
    status: report.failedCount > 0 ? 'completed_with_errors' : 'completed',
    plannedBridgeClipCount: report.plannedBridgeClipCount,
    generatedCount: report.generatedCount,
    failedCount: report.failedCount,
    skippedCount: report.skippedCount,
    outputFiles: ['bridge-clip-results.json', 'bridge-clip-generation-report.json', 'bridge-clip-report.md'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'bridgeClipGenerator',
      agentName: 'Bridge Clip Generator',
      status: report.failedCount > 0 ? 'warn' : 'pass',
      headline:
        report.failedCount > 0
          ? `已生成 ${report.generatedCount} 个 bridge clip，另有 ${report.failedCount} 个待回退`
          : `已生成 ${report.generatedCount} 个 bridge clip`,
      summary:
        report.failedCount > 0
          ? '部分桥接片段无法生成，后续应回退到 direct cut 或 transition stub。'
          : '桥接片段已完成生成，可继续进入 bridge QA。',
      passItems: [`已生成桥接片段数：${report.generatedCount}`],
      warnItems: results
        .filter((item) => item.status === 'failed')
        .map((item) => `${item.bridgeId}:${item.failureCategory || 'provider_generation_failed'}`),
      nextAction: '继续进行 bridge QA，确认哪些 bridge clip 可以插入时间线。',
      evidenceFiles: ['1-outputs/bridge-clip-results.json', '2-metrics/bridge-clip-generation-report.json'],
      metrics: {
        plannedBridgeClipCount: report.plannedBridgeClipCount,
        generatedCount: report.generatedCount,
        failedCount: report.failedCount,
      },
    },
    artifactContext
  );
}

function capabilitySupported(bridgePackage, supportedCapabilities = []) {
  if (bridgePackage.providerCapabilityRequirement === 'none') {
    return true;
  }
  if (bridgePackage.providerCapabilityRequirement === 'image_to_video') {
    return true;
  }
  return supportedCapabilities.includes(bridgePackage.providerCapabilityRequirement);
}

function toSora2ShotPackage(bridgePackage) {
  return {
    shotId: bridgePackage.bridgeId,
    durationTargetSec: bridgePackage.durationTargetSec,
    preferredProvider: 'sora2',
    visualGoal: (Array.isArray(bridgePackage.promptDirectives) ? bridgePackage.promptDirectives : []).join('. '),
    cameraSpec: {
      moveType: bridgePackage.firstLastFrameMode === 'required' ? 'bridge_keyframe_transition' : 'bridge_transition',
      framing: 'bridge',
      ratio: '9:16',
    },
    referenceImages: bridgePackage.fromReferenceImage
      ? [{ type: 'bridge_from_frame', path: bridgePackage.fromReferenceImage }]
      : [],
  };
}

export async function generateBridgeClips(bridgeShotPackages = [], videoDir, options = {}) {
  const resolvedVideoDir = ensureDir(videoDir || path.join(process.env.TEMP_DIR || './temp', 'bridge-video'));
  const supportedCapabilities = Array.isArray(options.supportedCapabilities)
    ? options.supportedCapabilities
    : ['image_to_video'];
  const generateBridgeClip = options.generateBridgeClip || ((bridgePackage, outputPath, innerOptions) =>
    createFallbackVideoClip(toSora2ShotPackage(bridgePackage), outputPath, innerOptions));
  const results = [];

  for (const bridgePackage of bridgeShotPackages) {
    if (bridgePackage.preferredProvider !== 'sora2') {
      results.push({
        bridgeId: bridgePackage.bridgeId,
        status: 'skipped',
        provider: bridgePackage.preferredProvider,
        model: null,
        videoPath: null,
        targetDurationSec: bridgePackage.durationTargetSec,
        actualDurationSec: null,
        failureCategory: null,
        error: null,
        taskId: null,
        outputUrl: null,
      });
      continue;
    }

    if (!capabilitySupported(bridgePackage, supportedCapabilities)) {
      results.push({
        bridgeId: bridgePackage.bridgeId,
        status: 'failed',
        provider: 'sora2',
        model: null,
        videoPath: null,
        targetDurationSec: bridgePackage.durationTargetSec,
        actualDurationSec: null,
        failureCategory: 'provider_invalid_request',
        error: `unsupported capability: ${bridgePackage.providerCapabilityRequirement}`,
        taskId: null,
        outputUrl: null,
      });
      continue;
    }

    const outputPath = buildOutputPath(resolvedVideoDir, bridgePackage);
    try {
      const run = await generateBridgeClip(bridgePackage, outputPath, options);
      results.push({
        bridgeId: bridgePackage.bridgeId,
        status: 'completed',
        provider: run?.provider || 'sora2',
        model: run?.model || null,
        videoPath: run?.videoPath || outputPath,
        targetDurationSec: bridgePackage.durationTargetSec,
        actualDurationSec: run?.actualDurationSec || bridgePackage.durationTargetSec || null,
        failureCategory: null,
        error: null,
        taskId: run?.taskId || null,
        outputUrl: run?.outputUrl || null,
      });
    } catch (error) {
      const normalizedError = normalizeProviderError(error);
      results.push({
        bridgeId: bridgePackage.bridgeId,
        status: 'failed',
        provider: 'sora2',
        model: null,
        videoPath: null,
        targetDurationSec: bridgePackage.durationTargetSec,
        actualDurationSec: null,
        failureCategory: normalizedError.category,
        error: normalizedError.message,
        taskId: null,
        outputUrl: null,
      });
    }
  }

  const report = buildBridgeClipReport(results);
  writeArtifacts(results, report, options.artifactContext);
  return { results, report };
}

export const __testables = {
  buildBridgeClipReport,
  buildOutputPath,
  normalizeProviderError,
  toSora2ShotPackage,
};

export default {
  generateBridgeClips,
};
