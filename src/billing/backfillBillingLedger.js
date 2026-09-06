import { appendBillingLedgerEntry, readBillingLedger } from './billingLedger.js';

function hasLedgerEntries(runDir) {
  return readBillingLedger(runDir).length > 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildImageLedgerEntries(runJob, snapshot = {}) {
  return asArray(snapshot.imageResults)
    .filter((item) => item?.shotId && item?.imagePath)
    .map((item) => ({
      runId: runJob.id,
      projectId: runJob.projectId || '',
      scriptId: runJob.scriptId || '',
      episodeId: runJob.episodeId || '',
      shotId: item.shotId,
      category: 'image',
      provider: item?.request?.providerConfig?.provider || 'openai_compat',
      operation: item?.request?.providerConfig?.taskType === 'image_edit' ? 'edit_image' : 'generate_image',
      requestId: item?.providerResult?.requestId || item.keyframeAssetId || null,
      currency: 'CNY',
      amount: null,
      status: item.success === false ? 'failed' : 'unknown',
      timestamp: runJob.finishedAt || runJob.startedAt || new Date().toISOString(),
      requestedAt: runJob.startedAt || null,
      finishedAt: runJob.finishedAt || runJob.startedAt || null,
      imagePath: item.imagePath || null,
      promptSummary: item?.request?.prompt || '',
      referenceCount: asArray(item?.request?.referenceImages).length,
      billingRef: item?.providerResult?.requestId || item.keyframeAssetId || null,
      metadata: {
        model: item?.request?.providerConfig?.model || null,
        taskType: item?.request?.providerConfig?.taskType || null,
        providerRequest: item?.request || null,
        providerResponse: item?.providerResult?.providerResponse || null,
        remoteRequestId: item?.providerResult?.requestId || null,
        backfilledFrom: 'state.snapshot.imageResults',
        success: item.success === true,
        error: item.error || null,
      },
    }));
}

function buildVideoLedgerEntries(runJob, snapshot = {}) {
  return asArray(snapshot.rawVideoResults)
    .filter((item) => item?.shotId)
    .map((item) => ({
      runId: runJob.id,
      projectId: runJob.projectId || '',
      scriptId: runJob.scriptId || '',
      episodeId: runJob.episodeId || '',
      shotId: item.shotId,
      category: 'video',
      provider: item.provider || item.preferredProvider || 'unknown',
      operation: 'generate_video',
      requestId: item.requestId || item.taskId || null,
      currency: 'CNY',
      amount: null,
      status: item.status === 'failed' ? 'failed' : 'unknown',
      timestamp: runJob.finishedAt || runJob.startedAt || new Date().toISOString(),
      requestedAt: runJob.startedAt || null,
      finishedAt: runJob.finishedAt || runJob.startedAt || null,
      videoPath: item.videoPath || null,
      durationSec: item.actualDurationSec ?? item.targetDurationSec ?? null,
      mode: item.model || item.transport || item.preferredProvider || null,
      billingRef: item.taskId || item.requestId || null,
      metadata: {
        packageType: item.packageType || null,
        packageId: item.packageId || null,
        transport: item.transport || null,
        preferredProvider: item.preferredProvider || null,
        errorCode: item.errorCode || null,
        errorStatus: item.errorStatus || null,
        errorDetails: item.errorDetails || null,
        backfilledFrom: 'state.snapshot.rawVideoResults',
      },
    }));
}

export function backfillBillingLedgerForRun(runJob, runState = {}) {
  const runDir = runState.runDir || runJob?.artifactRunDir || null;
  if (!runDir || hasLedgerEntries(runDir)) {
    return {
      runId: runJob?.id || null,
      runDir,
      skipped: true,
      createdCount: 0,
      reason: !runDir ? 'missing_run_dir' : 'ledger_exists',
    };
  }

  const snapshot = runState.snapshot || runState.liveState || {};
  const entries = [
    ...buildImageLedgerEntries(runJob, snapshot),
    ...buildVideoLedgerEntries(runJob, snapshot),
  ];

  for (const entry of entries) {
    appendBillingLedgerEntry(runDir, entry);
  }

  return {
    runId: runJob?.id || null,
    runDir,
    skipped: false,
    createdCount: entries.length,
    reason: entries.length > 0 ? 'backfilled' : 'no_backfillable_entries',
  };
}

export default {
  backfillBillingLedgerForRun,
};
