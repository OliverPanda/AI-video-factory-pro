import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleepTimeout } from 'node:timers/promises';

import { createRunwayVideoClip } from '../apis/runwayVideoApi.js';
import { createSeedanceVideoClip } from '../apis/seedanceVideoApi.js';
import { createSequenceClipResult } from '../utils/actionSequenceProtocol.js';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function buildOutputPath(videoDir, sequencePackage) {
  return path.join(videoDir, `${sequencePackage.sequenceId}.mp4`);
}

function normalizeSequenceProviderError(error) {
  return {
    message: error?.message || 'unknown error',
    code: error?.code || 'SEQUENCE_CLIP_ERROR',
    category: error?.category || 'provider_generation_failed',
    status: error?.status || null,
    details: error?.details || null,
  };
}

function classifySequenceProviderError(error) {
  const status = error?.response?.status ?? error?.status ?? null;

  if (error?.category) {
    return {
      message: error?.message || 'Sequence clip generation failed',
      code: error?.code || 'SEQUENCE_CLIP_ERROR',
      category: error.category,
      status,
      details: error?.details || error?.response?.data || null,
    };
  }

  if (!error?.response && String(error?.code || '').includes('_AUTH_MISSING')) {
    return {
      message: error?.message || 'Sequence clip auth missing',
      code: 'SEQUENCE_AUTH_MISSING',
      category: 'provider_auth_error',
      status,
      details: null,
    };
  }

  if (status === 401 || status === 403) {
    return {
      message: error?.message || 'Sequence clip auth failed',
      code: 'SEQUENCE_AUTH_ERROR',
      category: 'provider_auth_error',
      status,
      details: error?.response?.data || null,
    };
  }

  if (status === 429) {
    return {
      message: error?.message || 'Sequence clip rate limited',
      code: 'SEQUENCE_RATE_LIMIT',
      category: 'provider_rate_limit',
      status,
      details: error?.response?.data || null,
    };
  }

  if (status >= 400 && status < 500) {
    return {
      message: error?.message || 'Sequence clip invalid request',
      code: 'SEQUENCE_INVALID_REQUEST',
      category: 'provider_invalid_request',
      status,
      details: error?.response?.data || null,
    };
  }

  if (status >= 500) {
    return {
      message: error?.message || 'Sequence clip generation failed',
      code: 'SEQUENCE_SERVER_ERROR',
      category: 'provider_generation_failed',
      status,
      details: error?.response?.data || null,
    };
  }

  if (error?.code === 'ECONNABORTED' || String(error?.message || '').toLowerCase().includes('timeout')) {
    return {
      message: error?.message || 'Sequence clip timeout',
      code: 'SEQUENCE_TIMEOUT',
      category: 'provider_timeout',
      status,
      details: null,
    };
  }

  return {
    message: error?.message || 'Sequence clip generation failed',
    code: error?.code || 'SEQUENCE_UNKNOWN_ERROR',
    category: 'provider_generation_failed',
    status,
    details: error?.response?.data || null,
  };
}

function isLikelyMp4File(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) {
      return false;
    }

    const fd = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(12);
      const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
      if (bytesRead <= 0) {
        return false;
      }
      return header.subarray(4, 12).toString('ascii').includes('ftyp');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function buildSequenceClipReport(results = []) {
  const generated = results.filter((item) => item.status === 'completed');
  const failed = results.filter((item) => item.status === 'failed');
  const skipped = results.filter((item) => item.status === 'skipped');
  const providerBreakdown = results.reduce((acc, item) => {
    const key = item.provider || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const modelBreakdown = results.reduce((acc, item) => {
    if (!item.model) {
      return acc;
    }
    acc[item.model] = (acc[item.model] || 0) + 1;
    return acc;
  }, {});

  return {
    status: failed.length > 0 ? 'warn' : 'pass',
    plannedSequenceClipCount: results.length,
    generatedCount: generated.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    providerBreakdown,
    modelBreakdown,
    warnings: failed.map((item) => `${item.sequenceId}:${item.failureCategory || item.error || 'generation_failed'}`),
    blockers: [],
  };
}

function buildSequenceGenerationContext(results = [], sequencePackages = []) {
  const packageMap = new Map(
    (Array.isArray(sequencePackages) ? sequencePackages : []).map((entry) => [entry?.sequenceId, entry])
  );

  return results.map((result) => {
    const sequencePackage = packageMap.get(result.sequenceId) || {};
    return {
      sequenceId: result.sequenceId,
      provider: result.provider || null,
      status: result.status,
      coveredShotIds: Array.isArray(result.coveredShotIds) ? result.coveredShotIds : [],
      referenceStrategy: sequencePackage.referenceStrategy || null,
      referenceTier: sequencePackage.providerRequestHints?.referenceTier || null,
      referenceCount: sequencePackage.providerRequestHints?.referenceCount ?? null,
      generationMode: sequencePackage.providerRequestHints?.generationMode || null,
      sequenceContextSummary: sequencePackage.sequenceContextSummary || null,
    };
  });
}

function writeArtifacts(results, report, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const contextEntries = buildSequenceGenerationContext(results, artifactContext.sequencePackages);

  saveJSON(path.join(artifactContext.outputsDir, 'sequence-clip-results.json'), results);
  saveJSON(path.join(artifactContext.outputsDir, 'sequence-generation-context.json'), contextEntries);
  saveJSON(path.join(artifactContext.metricsDir, 'sequence-clip-generation-report.json'), report);
  writeTextFile(
    path.join(artifactContext.outputsDir, 'sequence-clip-report.md'),
    [
      '| Sequence ID | Provider | Status | Reference Strategy | Reference Tier | Failure Category | Output |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...results.map((result) => {
        const contextEntry = contextEntries.find((entry) => entry.sequenceId === result.sequenceId) || {};
        return `| ${result.sequenceId} | ${result.provider || ''} | ${result.status} | ${contextEntry.referenceStrategy || ''} | ${contextEntry.referenceTier || ''} | ${result.failureCategory || ''} | ${result.videoPath || ''} |`;
      }),
      '',
    ].join('\n')
  );
  for (const result of results.filter((item) => item.status === 'failed')) {
    saveJSON(path.join(artifactContext.errorsDir, `${result.sequenceId}-sequence-error.json`), result);
  }
  saveJSON(artifactContext.manifestPath, {
    status: report.failedCount > 0 ? 'completed_with_errors' : 'completed',
    plannedSequenceClipCount: report.plannedSequenceClipCount,
    generatedCount: report.generatedCount,
    failedCount: report.failedCount,
    skippedCount: report.skippedCount,
    providerBreakdown: report.providerBreakdown,
    modelBreakdown: report.modelBreakdown,
    outputFiles: ['sequence-clip-results.json', 'sequence-generation-context.json', 'sequence-clip-generation-report.json', 'sequence-clip-report.md'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'sequenceClipGenerator',
      agentName: 'Sequence Clip Generator',
      status: report.failedCount > 0 ? 'warn' : 'pass',
      headline:
        report.failedCount > 0
          ? `已生成 ${report.generatedCount} 个 sequence clip，另有 ${report.failedCount} 个待回退`
          : `已生成 ${report.generatedCount} 个 sequence clip`,
      summary:
        report.failedCount > 0
          ? '部分连续动作段生成失败，后续应回退到 videoResults + bridgeClips。'
          : '连续动作段已完成生成，可继续进入 sequence QA。',
      passItems: [`已生成连续动作段数：${report.generatedCount}`],
      warnItems: results
        .filter((item) => item.status === 'failed')
        .map((item) => `${item.sequenceId}:${item.failureCategory || 'provider_generation_failed'}`),
      nextAction: '继续进行 sequence QA，确认哪些 sequence clip 可以覆盖对应 shotIds。',
      evidenceFiles: ['1-outputs/sequence-clip-results.json', '2-metrics/sequence-clip-generation-report.json'],
      metrics: {
        plannedSequenceClipCount: report.plannedSequenceClipCount,
        generatedCount: report.generatedCount,
        failedCount: report.failedCount,
      },
    },
    artifactContext
  );
}

function normalizeSequenceStatus(status) {
  return String(status || '').trim().toUpperCase();
}

function getPreferredSequenceProvider(sequencePackage = {}) {
  return sequencePackage.preferredProvider || 'seedance';
}

function resolveSequenceWorkflow(sequencePackage, options) {
  if (options.providerClient) {
    return {
      kind: 'providerClient',
      run: (outputPath) => runProviderClientWorkflow(sequencePackage, outputPath, options),
    };
  }

  if (typeof options.generateSequenceClip === 'function') {
    return {
      kind: 'generateSequenceClip',
      run: (outputPath) => runGenerateSequenceClipWorkflow(sequencePackage, outputPath, options),
    };
  }

  if (getPreferredSequenceProvider(sequencePackage) === 'seedance') {
    return {
      kind: 'seedance',
      run: (outputPath) => runSeedanceWorkflow(sequencePackage, outputPath, options),
    };
  }

  if (getPreferredSequenceProvider(sequencePackage) === 'runway') {
    return {
      kind: 'runway',
      run: (outputPath) => runRunwayWorkflow(sequencePackage, outputPath, options),
    };
  }

  return null;
}

async function runProviderClientWorkflow(sequencePackage, outputPath, options) {
  const providerClient = options.providerClient;
  const submitResult = await providerClient.submit(sequencePackage, outputPath, options);
  const taskId = submitResult?.taskId || submitResult?.id || null;
  const provider = submitResult?.provider || getPreferredSequenceProvider(sequencePackage);
  const model = submitResult?.model || null;
  const pollIntervalMs = options.pollIntervalMs || 5000;
  const overallTimeoutMs = options.overallTimeoutMs || 300000;
  const sleep = options.sleep || ((ms) => sleepTimeout(ms));
  const startedAt = Date.now();
  let pollResult = submitResult;

  if (typeof providerClient.poll === 'function') {
    while (Date.now() - startedAt < overallTimeoutMs) {
      pollResult = await providerClient.poll(taskId, sequencePackage, submitResult, options);
      const status = normalizeSequenceStatus(pollResult?.status || pollResult?.state);

      if (status === 'SUCCEEDED' || status === 'SUCCESS' || status === 'COMPLETED' || status === 'DONE') {
        break;
      }
      if (status === 'FAILED' || status === 'CANCELLED' || status === 'ERROR') {
        throw {
          message: pollResult?.failure || pollResult?.error || 'Sequence clip task failed',
          code: 'SEQUENCE_TASK_FAILED',
          category: 'provider_generation_failed',
          status: pollResult?.status || null,
          details: pollResult,
        };
      }

      await sleep(pollIntervalMs);
    }

    const finalStatus = normalizeSequenceStatus(pollResult?.status || pollResult?.state);
    if (finalStatus !== 'SUCCEEDED' && finalStatus !== 'SUCCESS' && finalStatus !== 'COMPLETED' && finalStatus !== 'DONE') {
      throw {
        message: 'Sequence clip polling timed out',
        code: 'SEQUENCE_TIMEOUT',
        category: 'provider_timeout',
        status: null,
        details: { taskId, sequenceId: sequencePackage.sequenceId },
      };
    }
  }

  if (typeof providerClient.download === 'function') {
    const downloadUrl = pollResult?.outputUrl || pollResult?.url || submitResult?.outputUrl || submitResult?.url || null;
    await providerClient.download(downloadUrl, outputPath, sequencePackage, pollResult, options);
  }

  if (!isLikelyMp4File(outputPath)) {
    throw {
      message: 'Sequence clip download is empty or invalid',
      code: 'SEQUENCE_INVALID_DOWNLOAD',
      category: 'provider_generation_failed',
      status: null,
      details: { outputPath, sequenceId: sequencePackage.sequenceId },
    };
  }

  return {
    provider,
    model,
    taskId,
    outputUrl: pollResult?.outputUrl || pollResult?.url || submitResult?.outputUrl || submitResult?.url || null,
    videoPath: outputPath,
  };
}

async function runGenerateSequenceClipWorkflow(sequencePackage, outputPath, options) {
  const run = await options.generateSequenceClip(sequencePackage, outputPath, options);
  const videoPath = run?.videoPath || outputPath;
  if (!isLikelyMp4File(videoPath)) {
    throw {
      message: 'Sequence clip download is empty or invalid',
      code: 'SEQUENCE_INVALID_DOWNLOAD',
      category: 'provider_generation_failed',
      status: null,
      details: { outputPath, sequenceId: sequencePackage.sequenceId },
    };
  }
  return {
    provider: run?.provider || getPreferredSequenceProvider(sequencePackage),
    model: run?.model || null,
    taskId: run?.taskId || null,
    outputUrl: run?.outputUrl || null,
    videoPath,
    actualDurationSec: Number.isFinite(run?.actualDurationSec) ? run.actualDurationSec : null,
  };
}

async function runSeedanceWorkflow(sequencePackage, outputPath, options) {
  const run = await createSeedanceVideoClip(sequencePackage, outputPath, options);
  if (!isLikelyMp4File(run?.videoPath || outputPath)) {
    throw {
      message: 'Sequence clip download is empty or invalid',
      code: 'SEQUENCE_INVALID_DOWNLOAD',
      category: 'provider_generation_failed',
      status: null,
      details: { outputPath, sequenceId: sequencePackage.sequenceId },
    };
  }
  return {
    provider: run?.provider || getPreferredSequenceProvider(sequencePackage),
    model: run?.model || null,
    taskId: run?.taskId || null,
    outputUrl: run?.outputUrl || null,
    videoPath: run?.videoPath || outputPath,
    actualDurationSec: Number.isFinite(run?.actualDurationSec) ? run.actualDurationSec : null,
  };
}

async function runRunwayWorkflow(sequencePackage, outputPath, options) {
  const run = await createRunwayVideoClip(sequencePackage, outputPath, options);
  if (!isLikelyMp4File(run?.videoPath || outputPath)) {
    throw {
      message: 'Sequence clip download is empty or invalid',
      code: 'SEQUENCE_INVALID_DOWNLOAD',
      category: 'provider_generation_failed',
      status: null,
      details: { outputPath, sequenceId: sequencePackage.sequenceId },
    };
  }
  return {
    provider: run?.provider || getPreferredSequenceProvider(sequencePackage),
    model: run?.model || null,
    taskId: run?.taskId || null,
    outputUrl: run?.outputUrl || null,
    videoPath: run?.videoPath || outputPath,
    actualDurationSec: Number.isFinite(run?.actualDurationSec) ? run.actualDurationSec : null,
  };
}

export async function generateSequenceClips(actionSequencePackages = [], videoDir, options = {}) {
  const resolvedVideoDir = ensureDir(videoDir || path.join(process.env.TEMP_DIR || './temp', 'sequence-video'));
  const results = [];

  for (const sequencePackage of actionSequencePackages) {
    const preferredProvider = getPreferredSequenceProvider(sequencePackage);
    const workflow = resolveSequenceWorkflow(sequencePackage, options);

    if (!workflow) {
      results.push(
        createSequenceClipResult({
          sequenceId: sequencePackage.sequenceId,
          status: 'skipped',
          provider: preferredProvider,
          model: null,
          videoPath: null,
          coveredShotIds: Array.isArray(sequencePackage.shotIds) ? sequencePackage.shotIds : [],
          targetDurationSec: sequencePackage.durationTargetSec ?? null,
          actualDurationSec: null,
          failureCategory: null,
          error: null,
        })
      );
      continue;
    }

    const outputPath = buildOutputPath(resolvedVideoDir, sequencePackage);
    try {
      const run = await workflow.run(outputPath);
      results.push(
        createSequenceClipResult({
          sequenceId: sequencePackage.sequenceId,
          status: 'completed',
          provider: run?.provider || preferredProvider,
          model: run?.model || null,
          videoPath: run?.videoPath || outputPath,
          coveredShotIds: Array.isArray(sequencePackage.shotIds) ? sequencePackage.shotIds : [],
          targetDurationSec: sequencePackage.durationTargetSec ?? null,
          actualDurationSec: Number.isFinite(run?.actualDurationSec) ? run.actualDurationSec : null,
          failureCategory: null,
          error: null,
        })
      );
    } catch (error) {
      const normalizedError = classifySequenceProviderError(error);
      results.push(
        createSequenceClipResult({
          sequenceId: sequencePackage.sequenceId,
          status: 'failed',
          provider: preferredProvider,
          model: null,
          videoPath: null,
          coveredShotIds: Array.isArray(sequencePackage.shotIds) ? sequencePackage.shotIds : [],
          targetDurationSec: sequencePackage.durationTargetSec ?? null,
          actualDurationSec: null,
          failureCategory: normalizedError.category,
          error: normalizedError.message,
        })
      );
    }
  }

  const report = buildSequenceClipReport(results);
  writeArtifacts(results, report, {
    ...options.artifactContext,
    sequencePackages: actionSequencePackages,
  });

  return {
    results,
    sequenceClipResults: results,
    report,
  };
}

export const __testables = {
  buildOutputPath,
  buildSequenceGenerationContext,
  buildSequenceClipReport,
  classifySequenceProviderError,
  isLikelyMp4File,
  normalizeSequenceProviderError,
  resolveSequenceWorkflow,
};

export default {
  generateSequenceClips,
};
