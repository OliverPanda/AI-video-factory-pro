import fs from 'node:fs';
import path from 'node:path';

import { createRunwayVideoClip } from '../apis/runwayVideoApi.js';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function buildOutputPath(videoDir, shotPackage) {
  return path.join(videoDir, `${shotPackage.shotId}.mp4`);
}

function normalizeProviderError(error) {
  return {
    message: error?.message || 'unknown error',
    code: error?.code || 'RUNWAY_VIDEO_ERROR',
    category: error?.category || 'provider_generation_failed',
    status: error?.status || null,
    details: error?.details || null,
  };
}

function buildReport(results) {
  const generated = results.filter((item) => item.status === 'completed');
  const failed = results.filter((item) => item.status === 'failed');
  const skipped = results.filter((item) => item.status === 'skipped');
  const providerBreakdown = results.reduce((acc, item) => {
    const key = item.provider || item.preferredProvider || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    status: failed.length > 0 ? 'warn' : 'pass',
    plannedShotCount: results.length,
    generatedCount: generated.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    providerBreakdown,
    warnings: failed.map((item) => `${item.shotId}:${item.failureCategory || item.reason || 'generation_failed'}`),
    blockers: [],
  };
}

function writeArtifacts(results, report, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'video.index.json'), results);
  saveJSON(path.join(artifactContext.metricsDir, 'video-generation-report.json'), report);
  writeTextFile(
    path.join(artifactContext.outputsDir, 'video-report.md'),
    [
      '| Shot ID | Provider | Status | Failure Category | Output |',
      '| --- | --- | --- | --- | --- |',
      ...results.map((result) =>
        `| ${result.shotId} | ${result.provider || result.preferredProvider || ''} | ${result.status} | ${result.failureCategory || ''} | ${result.videoPath || ''} |`
      ),
      '',
    ].join('\n')
  );
  for (const result of results.filter((item) => item.status === 'failed')) {
    saveJSON(path.join(artifactContext.errorsDir, `${result.shotId}-video-error.json`), result);
  }
  saveJSON(artifactContext.manifestPath, {
    status: report.failedCount > 0 ? 'completed_with_errors' : 'completed',
    plannedShotCount: report.plannedShotCount,
    generatedCount: report.generatedCount,
    failedCount: report.failedCount,
    skippedCount: report.skippedCount,
    providerBreakdown: report.providerBreakdown,
    outputFiles: ['video.index.json', 'video-generation-report.json', 'video-report.md'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'runwayVideoAgent',
      agentName: 'Runway Video Agent',
      status: report.failedCount > 0 ? 'warn' : 'pass',
      headline:
        report.failedCount > 0
          ? `Runway 已生成 ${report.generatedCount} 个镜头，另有 ${report.failedCount} 个镜头待 fallback`
          : `Runway 已生成 ${report.generatedCount} 个动态镜头`,
      summary:
        report.failedCount > 0
          ? '部分镜头未成功生成，后续可回退到静图合成主链。'
          : '当前所有已路由到 Runway 的镜头都已成功生成。 ',
      passItems: [`已生成镜头数：${report.generatedCount}`],
      warnItems: report.warnings,
      nextAction: '继续进行镜头级 QA，确认哪些镜头可直接进入成片。',
      evidenceFiles: ['1-outputs/video.index.json', '2-metrics/video-generation-report.json'],
      metrics: {
        plannedShotCount: report.plannedShotCount,
        generatedCount: report.generatedCount,
        failedCount: report.failedCount,
      },
    },
    artifactContext
  );
}

export async function runRunwayVideo(shotPackages = [], videoDir, options = {}) {
  const resolvedVideoDir = ensureDir(videoDir || path.join(process.env.TEMP_DIR || './temp', 'video'));
  const results = [];

  for (const shotPackage of shotPackages) {
    if (shotPackage.preferredProvider !== 'runway') {
      results.push({
        shotId: shotPackage.shotId,
        preferredProvider: shotPackage.preferredProvider,
        provider: shotPackage.preferredProvider,
        status: 'skipped',
        reason: 'routed_to_static_image',
        videoPath: null,
        targetDurationSec: shotPackage.durationTargetSec,
      });
      continue;
    }

    const outputPath = buildOutputPath(resolvedVideoDir, shotPackage);
    try {
      const run = await (options.generateVideoClip || createRunwayVideoClip)(shotPackage, outputPath, options);
      results.push({
        shotId: shotPackage.shotId,
        preferredProvider: shotPackage.preferredProvider,
        provider: run?.provider || 'runway',
        status: 'completed',
        videoPath: run?.videoPath || outputPath,
        outputUrl: run?.outputUrl || null,
        taskId: run?.taskId || null,
        targetDurationSec: shotPackage.durationTargetSec,
      });
    } catch (error) {
      const normalizedError = normalizeProviderError(error);
      results.push({
        shotId: shotPackage.shotId,
        preferredProvider: shotPackage.preferredProvider,
        provider: 'runway',
        status: 'failed',
        videoPath: null,
        targetDurationSec: shotPackage.durationTargetSec,
        failureCategory: normalizedError.category,
        error: normalizedError.message,
        errorCode: normalizedError.code,
        errorStatus: normalizedError.status,
        errorDetails: normalizedError.details,
      });
    }
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
  normalizeProviderError,
};
