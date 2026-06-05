import fs from 'node:fs';
import path from 'node:path';

import { createUnifiedVideoProviderClient } from '../apis/unifiedVideoProviderClient.js';
import {
  normalizeVideoProvider,
  resolveVideoPackageId,
  resolveVideoPackageType,
  summarizeReferenceBindings,
} from '../apis/videoGenerationContract.js';
import { ensureDir, loadJSON, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import { videoQueue, queueWithRetry } from '../utils/queue.js';

const NON_GENERATING_PROVIDERS = new Set(['static_image', 'skip', 'fallback_direct_cut', 'direct_cut']);

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function normalizeProviderError(error) {
  return {
    message: error?.message || 'unknown error',
    code: error?.code || 'VIDEO_GENERATION_ERROR',
    category: error?.category || 'provider_generation_failed',
    status: error?.status || null,
    details: error?.details || null,
  };
}

function shouldSkipVideoGeneration(videoPackage = {}) {
  const rawProvider = String(videoPackage?.preferredProvider || videoPackage?.provider || '').trim().toLowerCase();
  return NON_GENERATING_PROVIDERS.has(rawProvider);
}

function resolveOutputStem(videoPackage = {}) {
  const packageType = resolveVideoPackageType(videoPackage);
  return resolveVideoPackageId(videoPackage, packageType) || `${packageType}_unknown`;
}

function buildOutputPath(videoDir, videoPackage = {}) {
  return path.join(videoDir, `${resolveOutputStem(videoPackage)}.mp4`);
}

function getRunIndexDir(artifactContext = null) {
  if (!artifactContext?.dir) {
    return null;
  }
  return path.dirname(artifactContext.dir);
}

function appendJsonEntry(filePath, entry) {
  const current = loadJSON(filePath);
  const next = Array.isArray(current) ? current : [];
  next.push(entry);
  saveJSON(filePath, next);
}

function appendUnifiedRunArtifacts(record, artifactContext = null) {
  const runDir = getRunIndexDir(artifactContext);
  if (!runDir) {
    return;
  }
  appendJsonEntry(path.join(runDir, 'videos.index.json'), {
    requestId: record.requestId || null,
    packageType: record.packageType || null,
    packageId: record.packageId || null,
    provider: record.provider || null,
    model: record.model || null,
    transport: record.transport || null,
    requestedProvider: record.requestedProvider || null,
    resolvedAdapter: record.resolvedAdapter || null,
    resolvedTransport: record.resolvedTransport || null,
    referenceBindingSummary: record.referenceBindingSummary || null,
    status: record.status || null,
    fallbackReason: null,
    errorCode: record.errorCode || null,
    errorStatus: record.errorStatus || null,
    requestBodyDigest: record.requestBodyDigest || null,
    errorStage: record.errorStage || null,
  });
  appendJsonEntry(path.join(runDir, 'video-provider-runs.json'), record);
}

async function runViaProviderClient(providerClient, videoPackage, outputPath, options = {}) {
  const submitResult = await providerClient.submit(videoPackage, outputPath, options);
  const pollResult = await providerClient.poll(submitResult.taskId, videoPackage, submitResult, options);
  const downloadResult = await providerClient.download(
    pollResult?.outputUrl || submitResult?.outputUrl || outputPath,
    outputPath,
    videoPackage,
    pollResult,
    options
  );
  return {
    submitResult,
    pollResult,
    downloadResult,
  };
}

function buildRuntimeRecord({
  videoPackage,
  outputPath,
  submitResult = null,
  pollResult = null,
  downloadResult = null,
  status,
  error = null,
  errorStage = null,
}) {
  const packageType = resolveVideoPackageType(videoPackage);
  const packageId = resolveVideoPackageId(videoPackage, packageType);
  const normalizedError = error ? normalizeProviderError(error) : null;
  const providerMetadata = submitResult?.providerMetadata || downloadResult?.providerMetadata || {};

  return {
    requestId: submitResult?.requestId || downloadResult?.requestId || null,
    packageType,
    packageId,
    provider: submitResult?.provider || downloadResult?.provider || normalizeVideoProvider(videoPackage?.provider || videoPackage?.preferredProvider) || null,
    model: submitResult?.model || downloadResult?.model || videoPackage?.model || null,
    transport: submitResult?.transport || downloadResult?.transport || videoPackage?.transport || null,
    requestedProvider: normalizeVideoProvider(videoPackage?.provider || videoPackage?.preferredProvider) || null,
    resolvedAdapter: providerMetadata?.resolvedAdapter || null,
    resolvedTransport: providerMetadata?.resolvedTransport || null,
    referenceBindingSummary: providerMetadata?.referenceBindingSummary || summarizeReferenceBindings(videoPackage),
    requestBodyDigest: providerMetadata?.requestBodyDigest || null,
    status,
    fallbackReason: null,
    errorStage,
    errorCode: normalizedError?.code || null,
    errorStatus: normalizedError?.status || null,
    errorDetails: normalizedError?.details || null,
    taskId: submitResult?.taskId || downloadResult?.taskId || pollResult?.taskId || null,
    outputUrl: pollResult?.outputUrl || submitResult?.outputUrl || downloadResult?.outputUrl || null,
    videoPath: downloadResult?.videoPath || outputPath || null,
    providerRequest: submitResult?.providerRequest || downloadResult?.providerRequest || null,
    providerResponse: downloadResult?.providerResponse || pollResult?.providerResponse || submitResult?.providerResponse || null,
  };
}

function buildResultEntity(videoPackage = {}, record = {}) {
  const packageType = record.packageType || resolveVideoPackageType(videoPackage);
  const packageId = record.packageId || resolveVideoPackageId(videoPackage, packageType);
  const idField = packageType === 'sequence' ? 'sequenceId' : packageType === 'bridge' ? 'bridgeId' : 'shotId';

  return {
    [idField]: packageId,
    packageType,
    packageId,
    preferredProvider: videoPackage?.preferredProvider || videoPackage?.provider || null,
    provider: record.provider || null,
    model: record.model || null,
    transport: record.transport || null,
    requestId: record.requestId || null,
    status: record.status,
    videoPath: record.status === 'completed' ? record.videoPath : null,
    outputUrl: record.outputUrl || null,
    taskId: record.taskId || null,
    targetDurationSec: videoPackage?.durationTargetSec ?? null,
    actualDurationSec: record.actualDurationSec ?? null,
    failureCategory: record.errorCode ? normalizeProviderError({ code: record.errorCode, category: record.errorStage }).category : null,
    error: record.errorCode ? normalizeProviderError({ message: record.errorCode }).message : null,
    errorCode: record.errorCode || null,
    errorStatus: record.errorStatus || null,
    errorDetails: record.errorDetails || null,
  };
}

function buildReport(results = []) {
  const completed = results.filter((item) => item.status === 'completed');
  const failed = results.filter((item) => item.status === 'failed');
  const skipped = results.filter((item) => item.status === 'skipped');
  const providerBreakdown = results.reduce((acc, item) => {
    const key = item.provider || item.preferredProvider || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const transportBreakdown = results.reduce((acc, item) => {
    const key = item.transport || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    status: failed.length > 0 ? 'warn' : 'pass',
    plannedCount: results.length,
    generatedCount: completed.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    providerBreakdown,
    transportBreakdown,
    warnings: failed.map((item) => `${item.packageId || 'unknown'}:${item.errorCode || item.failureCategory || 'generation_failed'}`),
    blockers: [],
  };
}

function writeArtifacts(results, report, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'video-generation-results.json'), results);
  saveJSON(path.join(artifactContext.metricsDir, 'video-generation-report.json'), report);
  writeTextFile(
    path.join(artifactContext.outputsDir, 'video-generation-report.md'),
    [
      '| Package | Provider | Transport | Status | Error | Output |',
      '| --- | --- | --- | --- | --- | --- |',
      ...results.map((result) =>
        `| ${result.packageId || ''} | ${result.provider || result.preferredProvider || ''} | ${result.transport || ''} | ${result.status} | ${result.errorCode || ''} | ${result.videoPath || ''} |`
      ),
      '',
      '统一索引：`../videos.index.json`',
      'Provider 运行明细：`../video-provider-runs.json`',
      '',
    ].join('\n')
  );
  saveJSON(artifactContext.manifestPath, {
    status: report.failedCount > 0 ? 'completed_with_errors' : 'completed',
    plannedCount: report.plannedCount,
    generatedCount: report.generatedCount,
    failedCount: report.failedCount,
    skippedCount: report.skippedCount,
    providerBreakdown: report.providerBreakdown,
    transportBreakdown: report.transportBreakdown,
    outputFiles: ['video-generation-results.json', 'video-generation-report.json', 'video-generation-report.md'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'videoGenerationAgent',
      agentName: 'Video Generation Agent',
      status: report.failedCount > 0 ? 'warn' : 'pass',
      headline:
        report.failedCount > 0
          ? `视频生成完成 ${report.generatedCount} 个，失败 ${report.failedCount} 个`
          : `视频生成完成 ${report.generatedCount} 个`,
      summary: '当前视频层已统一经过 Router / Adapter / Transport，并同步写入统一运行索引。',
      passItems: [`生成数：${report.generatedCount}`],
      warnItems: report.warnings,
      nextAction: '继续进入后续 QA 或合成阶段。',
      evidenceFiles: ['1-outputs/video-generation-results.json', '2-metrics/video-generation-report.json'],
      metrics: {
        plannedCount: report.plannedCount,
        generatedCount: report.generatedCount,
        failedCount: report.failedCount,
      },
    },
    artifactContext
  );
}
export async function runVideoGeneration(videoPackages = [], videoDir, options = {}) {
  const resolvedVideoDir = ensureDir(videoDir || path.join(process.env.TEMP_DIR || './temp', 'video'));
  const providerClient = options.providerClient || createUnifiedVideoProviderClient();

  const rawResults = await Promise.all(
    (Array.isArray(videoPackages) ? videoPackages : []).map((videoPackage) => {
      const packageType = resolveVideoPackageType(videoPackage);
      const packageId = resolveVideoPackageId(videoPackage, packageType);

      if (shouldSkipVideoGeneration(videoPackage)) {
        return Promise.resolve({
          result: {
            packageType,
            packageId,
            preferredProvider: videoPackage?.preferredProvider || videoPackage?.provider || null,
            provider: videoPackage?.provider || videoPackage?.preferredProvider || null,
            model: videoPackage?.model || null,
            transport: videoPackage?.transport || null,
            status: 'skipped',
            videoPath: null,
            outputUrl: null,
            taskId: null,
            targetDurationSec: videoPackage?.durationTargetSec ?? null,
            actualDurationSec: null,
            errorCode: null,
            errorStatus: null,
            errorDetails: null,
          },
          record: null,
        });
      }

      return queueWithRetry(
        videoQueue,
        async () => {
          const outputPath = buildOutputPath(resolvedVideoDir, videoPackage);
          let submitResult = null;
          let pollResult = null;
          let downloadResult = null;
          let errorStage = null;

          try {
            errorStage = 'submit';
            ({ submitResult, pollResult, downloadResult } = await runViaProviderClient(providerClient, videoPackage, outputPath, options));
            const record = buildRuntimeRecord({
              videoPackage,
              outputPath,
              submitResult,
              pollResult,
              downloadResult,
              status: 'completed',
            });
            const result = {
              ...buildResultEntity(videoPackage, record),
              actualDurationSec: downloadResult?.actualDurationSec ?? pollResult?.actualDurationSec ?? videoPackage?.durationTargetSec ?? null,
            };
            return { result, record };
          } catch (error) {
            const normalizedError = normalizeProviderError(error);
            const record = buildRuntimeRecord({
              videoPackage,
              outputPath: null,
              submitResult,
              pollResult,
              downloadResult,
              status: 'failed',
              error: normalizedError,
              errorStage,
            });
            const result = {
              ...buildResultEntity(videoPackage, record),
              failureCategory: normalizedError.category,
              error: normalizedError.message,
            };
            return { result, record };
          }
        },
        3,
        packageId || 'video-package'
      );
    })
  );

  const results = [];
  for (const item of rawResults) {
    if (item.record) {
      appendUnifiedRunArtifacts(item.record, options.artifactContext);
    }
    results.push(item.result);
  }

  const report = buildReport(results);
  writeArtifacts(results, report, options.artifactContext);
  return {
    results,
    report,
  };
}
export const __testables = {
  buildOutputPath,
  buildReport,
  getRunIndexDir,
  normalizeProviderError,
  shouldSkipVideoGeneration,
};

export default {
  runVideoGeneration,
};
