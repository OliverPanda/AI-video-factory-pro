import fs from 'node:fs';
import path from 'node:path';

import PQueue from 'p-queue';

import { createFallbackVideoClip } from '../apis/fallbackVideoApi.js';
import { createFallbackVideoClip as createSeedanceBridgeClipViaFallback } from '../apis/fallbackVideoApi.js';
import { createUnifiedVideoProviderClient } from '../apis/unifiedVideoProviderClient.js';
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
  const preferredProvider = bridgePackage.preferredProvider === 'seedance' ? 'seedance' : 'sora2';
  return {
    shotId: bridgePackage.bridgeId,
    durationTargetSec: bridgePackage.durationTargetSec,
    preferredProvider,
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
  const providerClient = options.providerClient || createUnifiedVideoProviderClient();
  const generateBridgeClip = options.generateBridgeClip || ((bridgePackage, outputPath, innerOptions) =>
    createFallbackVideoClip(toSora2ShotPackage(bridgePackage), outputPath, innerOptions));
  const bridgeQueue = new PQueue({
    concurrency: parseInt(process.env.VIDEO_CONCURRENCY || '3', 10),
  });

  const settled = await Promise.allSettled(
    bridgeShotPackages.map((bridgePackage) =>
      bridgeQueue.add(async () => {
        const provider = bridgePackage.preferredProvider;
        if (provider !== 'sora2' && provider !== 'seedance') {
          return {
            bridgeId: bridgePackage.bridgeId,
            status: 'skipped',
            provider,
            model: null,
            videoPath: null,
            targetDurationSec: bridgePackage.durationTargetSec,
            actualDurationSec: null,
            failureCategory: null,
            error: null,
            taskId: null,
            outputUrl: null,
          };
        }

        if (provider === 'sora2' && !capabilitySupported(bridgePackage, supportedCapabilities)) {
          return {
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
          };
        }

        const outputPath = buildOutputPath(resolvedVideoDir, bridgePackage);
        try {
          const run = options.generateBridgeClip
            ? await generateBridgeClip(bridgePackage, outputPath, options)
            : await (async () => {
                const unifiedBridgePackage = {
                  ...bridgePackage,
                  packageType: 'bridge',
                  shotId: bridgePackage.bridgeId,
                  visualGoal: (bridgePackage.promptDirectives || []).join('. '),
                  referenceImages: [
                    bridgePackage.fromReferenceImage ? { path: bridgePackage.fromReferenceImage, role: 'first_frame' } : null,
                    bridgePackage.toReferenceImage ? { path: bridgePackage.toReferenceImage, role: 'last_frame' } : null,
                  ].filter(Boolean),
                };
                const submitResult = await providerClient.submit(unifiedBridgePackage, outputPath, options);
                const pollResult = await providerClient.poll(submitResult.taskId, unifiedBridgePackage, submitResult, options);
                await providerClient.download(
                  pollResult?.outputUrl || submitResult?.outputUrl || outputPath,
                  outputPath,
                  unifiedBridgePackage,
                  pollResult,
                  options
                );
                return {
                  provider: submitResult?.provider || provider,
                  model: submitResult?.model || null,
                  videoPath: outputPath,
                  taskId: submitResult?.taskId || null,
                  outputUrl: pollResult?.outputUrl || submitResult?.outputUrl || null,
                  actualDurationSec: pollResult?.actualDurationSec || bridgePackage.durationTargetSec || null,
                };
              })();
          return {
            bridgeId: bridgePackage.bridgeId,
            status: 'completed',
            provider: run?.provider || provider,
            model: run?.model || null,
            videoPath: run?.videoPath || outputPath,
            targetDurationSec: bridgePackage.durationTargetSec,
            actualDurationSec: run?.actualDurationSec || bridgePackage.durationTargetSec || null,
            failureCategory: null,
            error: null,
            taskId: run?.taskId || null,
            outputUrl: run?.outputUrl || null,
          };
        } catch (error) {
          const normalizedError = normalizeProviderError(error);
          return {
            bridgeId: bridgePackage.bridgeId,
            status: 'failed',
            provider,
            model: null,
            videoPath: null,
            targetDurationSec: bridgePackage.durationTargetSec,
            actualDurationSec: null,
            failureCategory: normalizedError.category,
            error: normalizedError.message,
            taskId: null,
            outputUrl: null,
          };
        }
      })
    )
  );

  const results = settled.map((entry) =>
    entry.status === 'fulfilled'
      ? entry.value
      : {
          bridgeId: null,
          status: 'failed',
          provider: null,
          model: null,
          videoPath: null,
          targetDurationSec: null,
          actualDurationSec: null,
          failureCategory: 'provider_generation_failed',
          error: entry.reason?.message || 'unknown bridge generation error',
          taskId: null,
          outputUrl: null,
        }
  );

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
