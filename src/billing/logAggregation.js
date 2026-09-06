import path from 'node:path';

import { readBillingLedger, summarizeBillingLedger } from './billingLedger.js';
import { classifyBillingOperation } from './operationClassifier.js';
import { resolveRunState } from '../workbench/dataSources/runStateResolver.js';

const CACHE_TTL_MS = Number(process.env.WORKBENCH_CACHE_TTL_MS || 5000);
let _logsCache = null;
let _logsCacheKey = null;
let _logsCacheTimestamp = 0;

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sortByTimestampDesc(items = []) {
  return [...items].sort((a, b) => {
    const aTime = Date.parse(a.finishedAt || a.requestedAt || a.timestamp || a.startedAt || 0);
    const bTime = Date.parse(b.finishedAt || b.requestedAt || b.timestamp || b.startedAt || 0);
    return bTime - aTime;
  });
}

function normalizeConsumptionType(entry = {}) {
  if (entry.status === 'billed') return '消费';
  if (entry.status === 'waived') return '补偿';
  if (entry.status === 'failed') return '失败';
  return '未知';
}

function buildBillingLog(entry = {}, runJob) {
  const gatewayRaw = entry?.metadata?.gatewaySync?.rawPayload && typeof entry.metadata.gatewaySync.rawPayload === 'object'
    ? entry.metadata.gatewaySync.rawPayload
    : {};
  const gatewayOther = gatewayRaw.other && typeof gatewayRaw.other === 'object' ? gatewayRaw.other : {};
  const quantity = toNullableNumber(gatewayOther.quantity)
    ? toNullableNumber(gatewayOther.quantity)
    : (entry.referenceCount && entry.referenceCount > 0 ? entry.referenceCount : 1);
  const entryAmount = toNullableNumber(entry.amount);
  const unitPrice = toNullableNumber(gatewayOther.model_price)
    ?? (entryAmount !== null && quantity > 0 ? entryAmount / quantity : null);
  const requestPath = gatewayOther.request_path || gatewayOther.path || gatewayRaw.request_path || gatewayRaw.path || null;
  const promptTokens = gatewayOther?.usages?.prompt_tokens ?? gatewayRaw.prompt_tokens ?? null;
  const completionTokens = gatewayOther?.usages?.completion_tokens ?? gatewayRaw.completion_tokens ?? null;
  const totalTokens = gatewayOther?.usages?.total_tokens ?? gatewayRaw.total_tokens ?? null;

  return {
    runId: runJob.id,
    runKey: runJob.runKey || null,
    projectId: runJob.projectId,
    scriptId: runJob.scriptId,
    episodeId: runJob.episodeId,
    ledgerEntryId: entry.id || null,
    requestId: entry.requestId || gatewayOther.request_id || null,
    provider: gatewayOther.host || entry.provider || 'unknown',
    modelName: gatewayRaw.model_name || gatewayRaw.modelName || entry?.metadata?.model || null,
    groupName: gatewayRaw.group || null,
    tokenName: gatewayRaw.token_name || null,
    typeLabel: normalizeConsumptionType(entry),
    durationLabel: gatewayRaw.use_time ? `${gatewayRaw.use_time}s` : null,
    streamLabel: gatewayRaw.is_stream ? '流式' : '非流',
    promptTokens: toNullableNumber(promptTokens),
    completionTokens: toNullableNumber(completionTokens),
    totalTokens: toNullableNumber(totalTokens),
    amount: entryAmount,
    currency: entry.currency || 'CNY',
    ip: gatewayRaw.ip || null,
    detail: gatewayRaw.content || entry.promptSummary || entry?.metadata?.error || '',
    status: entry.status || 'unknown',
    operation: classifyBillingOperation(entry),
    occurredAt: entry.finishedAt || entry.requestedAt || entry.timestamp || runJob.startedAt || null,
    quantity,
    unitPrice,
    pricingLabel: unitPrice !== null ? `${unitPrice}/次` : null,
    billingPath: requestPath || entry?.metadata?.taskType || null,
    cacheRatio: gatewayOther.cache_ratio ?? null,
    rawPayload: gatewayRaw,
  };
}

function isRealBilledEntry(entry = {}) {
  const amount = toNullableNumber(entry.amount);
  return entry.status === 'billed' && amount !== null && amount > 0;
}

function buildImageLog(entry = {}, runJob) {
  return {
    runId: runJob.id,
    runKey: runJob.runKey || null,
    shotId: entry.shotId || null,
    projectId: runJob.projectId,
    scriptId: runJob.scriptId,
    episodeId: runJob.episodeId,
    provider: entry.provider || 'unknown',
    operation: classifyBillingOperation({ ...entry, category: 'image' }),
    status: entry.status || 'unknown',
    billingStatus: entry.billingStatus || entry.status || 'unknown',
    meteringStatus: entry.meteringStatus || 'unknown',
    meteringError: entry.meteringError || null,
    requestedAt: entry.requestedAt || entry.timestamp || runJob.startedAt || null,
    finishedAt: entry.finishedAt || entry.timestamp || null,
    imagePath: entry.imagePath || null,
    promptSummary: entry.promptSummary || '',
    referenceCount: entry.referenceCount || 0,
    billingRef: entry.billingRef || entry.id || null,
  };
}

function buildVideoLog(entry = {}, runJob) {
  return {
    runId: runJob.id,
    runKey: runJob.runKey || null,
    shotId: entry.shotId || null,
    projectId: runJob.projectId,
    scriptId: runJob.scriptId,
    episodeId: runJob.episodeId,
    provider: entry.provider || 'unknown',
    operation: classifyBillingOperation({ ...entry, category: 'video' }),
    status: entry.status || 'unknown',
    billingStatus: entry.billingStatus || entry.status || 'unknown',
    meteringStatus: entry.meteringStatus || 'unknown',
    meteringError: entry.meteringError || null,
    requestedAt: entry.requestedAt || entry.timestamp || runJob.startedAt || null,
    finishedAt: entry.finishedAt || entry.timestamp || null,
    videoPath: entry.videoPath || null,
    durationSec: entry.durationSec || null,
    mode: entry.mode || null,
    billingRef: entry.billingRef || entry.id || null,
  };
}

export function buildLogsOverview({ runJobs = [], workspaceRoot, projectStoreBaseTempDir, projectId, runId = null } = {}) {
  const cacheKey = `${runJobs.length}:${projectId || ''}:${runId || ''}`;
  const now = Date.now();
  if (_logsCache && _logsCacheKey === cacheKey && now - _logsCacheTimestamp < CACHE_TTL_MS) {
    return _logsCache;
  }

  const scopedRunJobs = runJobs.filter((runJob) => {
    if (projectId && runJob.projectId !== projectId) return false;
    if (runId && runJob.id !== runId && runJob.runKey !== runId) return false;
    return true;
  });

  if (!projectId && !runId && scopedRunJobs.length > 50) {
    const result = {
      scope: { projectId: null, runId: null, runCount: scopedRunJobs.length },
      costSummary: { currency: 'CNY', total: 0, byCategory: {}, billedCount: 0, waivedCount: 0, failedCount: 0, unknownCount: 0, hasRealBilling: false },
      operationalSummary: { billed: 0, waived: 0, failed: 0, unknown: 0, meterSent: 0, meterFailed: 0 },
      billingLogs: [],
      imageLogs: [],
      videoLogs: [],
    };
    _logsCache = result;
    _logsCacheKey = cacheKey;
    _logsCacheTimestamp = now;
    return result;
  }

  const allLedgerEntries = [];
  const realLedgerEntries = [];
  const imageLogs = [];
  const videoLogs = [];
  const billingLogs = [];

  for (const runJob of scopedRunJobs) {
    const runState = resolveRunState(runJob, { workspaceRoot, projectStoreBaseTempDir });
    const runDir = runState.runDir || runJob.artifactRunDir || null;
    const ledgerEntries = runDir ? readBillingLedger(runDir) : [];

    allLedgerEntries.push(...ledgerEntries);

    const imageEntries = ledgerEntries.filter((entry) => entry.category === 'image' && entry.metadata?.gatewaySync?.rawPayload && isRealBilledEntry(entry));
    const videoEntries = ledgerEntries.filter((entry) => entry.category === 'video' && entry.metadata?.gatewaySync?.rawPayload && isRealBilledEntry(entry));
    const realConsumptionEntries = ledgerEntries.filter((entry) => entry.metadata?.gatewaySync?.rawPayload && isRealBilledEntry(entry));
    realLedgerEntries.push(...realConsumptionEntries);

    for (const entry of imageEntries) {
      imageLogs.push(buildImageLog(entry, runJob));
    }

    for (const entry of videoEntries) {
      videoLogs.push(buildVideoLog(entry, runJob));
    }

    for (const entry of realConsumptionEntries) {
      billingLogs.push(buildBillingLog(entry, runJob));
    }
  }

  const costSummary = summarizeBillingLedger(realLedgerEntries);
  const operationalSummary = {
    billed: realLedgerEntries.filter((entry) => entry?.status === 'billed').length,
    waived: realLedgerEntries.filter((entry) => entry?.status === 'waived').length,
    failed: realLedgerEntries.filter((entry) => entry?.status === 'failed').length,
    unknown: realLedgerEntries.filter((entry) => entry?.status === 'unknown').length,
    meterSent: realLedgerEntries.filter((entry) => entry?.meteringStatus === 'sent').length,
    meterFailed: realLedgerEntries.filter((entry) => entry?.meteringStatus === 'failed').length,
  };

  const result = {
    scope: {
      projectId: projectId || null,
      runId: runId || null,
      runCount: scopedRunJobs.length,
    },
    costSummary,
    operationalSummary,
    billingLogs: sortByTimestampDesc(billingLogs),
    imageLogs: sortByTimestampDesc(imageLogs),
    videoLogs: sortByTimestampDesc(videoLogs),
  };

  _logsCache = result;
  _logsCacheKey = cacheKey;
  _logsCacheTimestamp = now;

  return result;
}

export function buildProjectRunOptions(runJobs = [], projectId) {
  return runJobs
    .filter((runJob) => runJob.projectId === projectId)
    .sort((a, b) => Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0))
    .map((runJob) => ({
      id: runJob.id,
      runKey: runJob.runKey || null,
      scriptId: runJob.scriptId,
      episodeId: runJob.episodeId,
      scriptTitle: runJob.scriptTitle || runJob.scriptId,
      episodeTitle: runJob.episodeTitle || runJob.episodeId,
      status: runJob.status || 'unknown',
      startedAt: runJob.startedAt || null,
      finishedAt: runJob.finishedAt || null,
    }));
}

export default {
  buildLogsOverview,
  buildProjectRunOptions,
};
