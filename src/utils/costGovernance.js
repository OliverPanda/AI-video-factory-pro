import path from 'node:path';

import { writeTextFile, ensureDir, saveJSON } from './fileHelper.js';
import { writeAgentQaSummary } from './qaSummary.js';

const NON_GENERATING_PROVIDERS = new Set(['static_image', 'skip', 'fallback_direct_cut', 'direct_cut']);

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function isGeneratingVideoPackage(item = {}) {
  const provider = normalizeProvider(item.preferredProvider || item.provider);
  return provider && !NON_GENERATING_PROVIDERS.has(provider);
}

function countBy(items = [], keyFn) {
  return (Array.isArray(items) ? items : []).reduce((acc, item) => {
    const key = keyFn(item) || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function normalizeRunId(value) {
  return String(value || 'current_run').trim() || 'current_run';
}

function normalizeCostMetricsState(state = {}) {
  const runs = state && typeof state === 'object' && state.runs && typeof state.runs === 'object'
    ? state.runs
    : {};
  return { runs: { ...runs } };
}

function buildCurrentRunMetrics({
  generatingPackages = [],
  reanchorRegens = [],
  promptTightenRegens = [],
  actualVideoResults = [],
} = {}) {
  const failedVideoCount = actualVideoResults.filter((item) => item?.status === 'failed').length;
  const completedVideoCount = actualVideoResults.filter((item) => item?.status === 'completed').length;
  const skippedVideoCount = actualVideoResults.filter((item) => item?.status === 'skipped').length;
  const estimatedUnits = {
    videoRequestUnits: generatingPackages.length,
    reanchorImageUnits: reanchorRegens.length * 2,
    promptTightenImageUnits: promptTightenRegens.length,
    total:
      generatingPackages.length +
      reanchorRegens.length * 2 +
      promptTightenRegens.length,
  };

  return {
    videoRequestCount: generatingPackages.length,
    reanchorRegenerationCount: reanchorRegens.length,
    promptTightenRegenerationCount: promptTightenRegens.length,
    estimatedUnits,
    videoResultCount: actualVideoResults.length,
    failedVideoCount,
    completedVideoCount,
    skippedVideoCount,
  };
}

function emptyAccumulatedMetrics() {
  return {
    videoRequestCount: 0,
    reanchorRegenerationCount: 0,
    promptTightenRegenerationCount: 0,
    estimatedUnits: {
      videoRequestUnits: 0,
      reanchorImageUnits: 0,
      promptTightenImageUnits: 0,
      total: 0,
    },
    videoResultCount: 0,
    failedVideoCount: 0,
    completedVideoCount: 0,
    skippedVideoCount: 0,
  };
}

function accumulateRunMetrics(runs = {}) {
  const accumulated = emptyAccumulatedMetrics();
  for (const metrics of Object.values(runs || {})) {
    accumulated.videoRequestCount += metrics?.videoRequestCount || 0;
    accumulated.reanchorRegenerationCount += metrics?.reanchorRegenerationCount || 0;
    accumulated.promptTightenRegenerationCount += metrics?.promptTightenRegenerationCount || 0;
    accumulated.estimatedUnits.videoRequestUnits += metrics?.estimatedUnits?.videoRequestUnits || 0;
    accumulated.estimatedUnits.reanchorImageUnits += metrics?.estimatedUnits?.reanchorImageUnits || 0;
    accumulated.estimatedUnits.promptTightenImageUnits += metrics?.estimatedUnits?.promptTightenImageUnits || 0;
    accumulated.estimatedUnits.total += metrics?.estimatedUnits?.total || 0;
    accumulated.videoResultCount += metrics?.videoResultCount || 0;
    accumulated.failedVideoCount += metrics?.failedVideoCount || 0;
    accumulated.completedVideoCount += metrics?.completedVideoCount || 0;
    accumulated.skippedVideoCount += metrics?.skippedVideoCount || 0;
  }
  return accumulated;
}

export function buildCostGovernanceReport({
  preflightShotPackages = [],
  consistencyNeedsRegeneration = [],
  videoResults = [],
  costMetricsState = null,
  runId = null,
  policy = {},
  now = new Date().toISOString(),
} = {}) {
  const generatingPackages = (Array.isArray(preflightShotPackages) ? preflightShotPackages : [])
    .filter(isGeneratingVideoPackage);
  const reanchorRegens = (Array.isArray(consistencyNeedsRegeneration) ? consistencyNeedsRegeneration : [])
    .filter((item) => item?.regenStrategy === 'reanchor_regenerate');
  const promptTightenRegens = (Array.isArray(consistencyNeedsRegeneration) ? consistencyNeedsRegeneration : [])
    .filter((item) => item?.regenStrategy === 'prompt_tighten');
  const actualVideoResults = Array.isArray(videoResults) ? videoResults : [];
  const currentRun = buildCurrentRunMetrics({
    generatingPackages,
    reanchorRegens,
    promptTightenRegens,
    actualVideoResults,
  });
  const normalizedCostMetricsState = normalizeCostMetricsState(costMetricsState);
  const hasPreviousRuns = Object.keys(normalizedCostMetricsState.runs).length > 0;
  const normalizedRunId = normalizeRunId(runId);
  const nextRuns = {
    ...normalizedCostMetricsState.runs,
    [normalizedRunId]: currentRun,
  };
  const accumulated = accumulateRunMetrics(nextRuns);

  const maxVideoRequests = parsePositiveInteger(
    policy.maxVideoRequests ?? process.env.COST_MAX_VIDEO_REQUESTS,
    60
  );
  const maxReanchorRegenerations = parsePositiveInteger(
    policy.maxReanchorRegenerations ?? process.env.COST_MAX_REANCHOR_REGENERATIONS,
    8
  );
  const maxFailedVideoRequests = parsePositiveInteger(
    policy.maxFailedVideoRequests ?? process.env.COST_MAX_FAILED_VIDEO_REQUESTS,
    5
  );
  const enforce = policy.enforce === true || process.env.COST_GOVERNANCE_ENFORCE === '1';

  const warnings = [];
  const blockers = [];

  if (currentRun.videoRequestCount > maxVideoRequests) {
    const message = `计划视频请求数 ${currentRun.videoRequestCount} 超过预算 ${maxVideoRequests}`;
    (enforce ? blockers : warnings).push(message);
  }
  if (currentRun.reanchorRegenerationCount > maxReanchorRegenerations) {
    const message = `回锚重生成次数 ${currentRun.reanchorRegenerationCount} 超过预算 ${maxReanchorRegenerations}`;
    (enforce ? blockers : warnings).push(message);
  }
  if (currentRun.failedVideoCount > maxFailedVideoRequests) {
    warnings.push(`视频失败数 ${currentRun.failedVideoCount} 超过建议阈值 ${maxFailedVideoRequests}`);
  }
  // 仅当当前轮自身未超预算、但累计超预算时才报警（去重，避免同一语义的重复报告）
  if (hasPreviousRuns && accumulated.videoRequestCount > maxVideoRequests && currentRun.videoRequestCount <= maxVideoRequests) {
    const message = `累计视频请求数 ${accumulated.videoRequestCount} 超过预算 ${maxVideoRequests}（本单轮 ${currentRun.videoRequestCount}，历史累计超出）`;
    (enforce ? blockers : warnings).push(message);
  }
  if (hasPreviousRuns && accumulated.reanchorRegenerationCount > maxReanchorRegenerations && currentRun.reanchorRegenerationCount <= maxReanchorRegenerations) {
    const message = `累计回锚重生成次数 ${accumulated.reanchorRegenerationCount} 超过预算 ${maxReanchorRegenerations}（本单轮 ${currentRun.reanchorRegenerationCount}，历史累计超出）`;
    (enforce ? blockers : warnings).push(message);
  }
  if (hasPreviousRuns && accumulated.failedVideoCount > maxFailedVideoRequests && currentRun.failedVideoCount <= maxFailedVideoRequests) {
    warnings.push(`累计视频失败数 ${accumulated.failedVideoCount} 超过建议阈值 ${maxFailedVideoRequests}（本单轮 ${currentRun.failedVideoCount}，历史累计超出）`);
  }

  return {
    generatedAt: now,
    runId: normalizedRunId,
    status: blockers.length > 0 ? 'block' : (warnings.length > 0 ? 'warn' : 'pass'),
    enforce,
    budgets: {
      maxVideoRequests,
      maxReanchorRegenerations,
      maxFailedVideoRequests,
    },
    planned: {
      videoRequestCount: currentRun.videoRequestCount,
      providerBreakdown: countBy(generatingPackages, (item) => item.preferredProvider || item.provider),
      transportBreakdown: countBy(generatingPackages, (item) => item.transport),
      reanchorRegenerationCount: currentRun.reanchorRegenerationCount,
      promptTightenRegenerationCount: currentRun.promptTightenRegenerationCount,
      estimatedUnits: currentRun.estimatedUnits,
    },
    actual: {
      videoResultCount: currentRun.videoResultCount,
      failedVideoCount: currentRun.failedVideoCount,
      completedVideoCount: currentRun.completedVideoCount,
      skippedVideoCount: currentRun.skippedVideoCount,
    },
    currentRun,
    accumulated,
    costMetricsState: {
      runs: nextRuns,
      accumulated,
    },
    warnings,
    blockers,
  };
}

export function buildCostGovernanceMarkdown(report = {}) {
  return [
    '# Cost Governance',
    '',
    `- Status: ${report.status || 'unknown'}`,
    `- Enforce: ${report.enforce ? 'yes' : 'no'}`,
    `- Planned Video Requests: ${report.planned?.videoRequestCount || 0}/${report.budgets?.maxVideoRequests ?? ''}`,
    `- Reanchor Regens: ${report.planned?.reanchorRegenerationCount || 0}/${report.budgets?.maxReanchorRegenerations ?? ''}`,
    `- Estimated Units: ${report.planned?.estimatedUnits?.total || 0}`,
    `- Actual Failed Videos: ${report.actual?.failedVideoCount || 0}/${report.budgets?.maxFailedVideoRequests ?? ''}`,
    `- Accumulated Video Requests: ${report.accumulated?.videoRequestCount || 0}/${report.budgets?.maxVideoRequests ?? ''}`,
    `- Accumulated Reanchor Regens: ${report.accumulated?.reanchorRegenerationCount || 0}/${report.budgets?.maxReanchorRegenerations ?? ''}`,
    `- Accumulated Units: ${report.accumulated?.estimatedUnits?.total || 0}`,
    '',
    '## Provider Breakdown',
    ...Object.entries(report.planned?.providerBreakdown || {}).map(([provider, count]) => `- ${provider}: ${count}`),
    '',
    '## Warnings',
    ...(report.warnings || []).length > 0 ? (report.warnings || []).map((item) => `- ${item}`) : ['- 无'],
    '',
    '## Blockers',
    ...(report.blockers || []).length > 0 ? (report.blockers || []).map((item) => `- ${item}`) : ['- 无'],
    '',
  ].join('\n');
}

export function writeCostGovernanceArtifacts(report, artifactContext) {
  if (!artifactContext || !report) {
    return null;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'cost-governance-report.json'), report);
  writeTextFile(path.join(artifactContext.outputsDir, 'cost-governance-report.md'), buildCostGovernanceMarkdown(report));
  saveJSON(path.join(artifactContext.metricsDir, 'cost-governance-metrics.json'), {
    status: report.status,
    ...report.budgets,
    ...report.planned,
    ...report.actual,
    accumulated: report.accumulated || {},
  });
  saveJSON(artifactContext.manifestPath, {
    status: report.status === 'block' ? 'completed_with_warnings' : 'completed',
    plannedVideoRequests: report.planned?.videoRequestCount || 0,
    estimatedUnits: report.planned?.estimatedUnits?.total || 0,
    outputFiles: ['cost-governance-report.json', 'cost-governance-report.md', 'cost-governance-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'costGovernance',
      agentName: 'Cost Governance',
      status: report.status,
      headline:
        report.status === 'pass'
          ? '成本预算在阈值内'
          : `成本治理发现 ${report.blockers.length + report.warnings.length} 个预算风险`,
      summary: '成本治理按视频请求、回锚重生成、失败请求数统计预算风险，避免自动化链路无限烧钱。',
      passItems: [`估算单位：${report.planned?.estimatedUnits?.total || 0}`],
      warnItems: report.warnings || [],
      blockItems: report.blockers || [],
      nextAction:
        report.status === 'block'
          ? '降低生成规模或显式提高预算阈值后再继续。'
          : '可以继续生产，同时保留成本报告用于复盘。',
      evidenceFiles: ['1-outputs/cost-governance-report.json', '1-outputs/cost-governance-report.md'],
      metrics: {
        status: report.status,
        plannedVideoRequestCount: report.planned?.videoRequestCount || 0,
        estimatedUnits: report.planned?.estimatedUnits?.total || 0,
        accumulatedVideoRequestCount: report.accumulated?.videoRequestCount || 0,
        accumulatedEstimatedUnits: report.accumulated?.estimatedUnits?.total || 0,
      },
    },
    artifactContext
  );

  return report;
}

export default {
  buildCostGovernanceMarkdown,
  buildCostGovernanceReport,
  writeCostGovernanceArtifacts,
};
