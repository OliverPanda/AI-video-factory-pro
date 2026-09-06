import { normalizeText } from '../../utils/normalization.js';
import { normalizeDecisionRecord } from './decisionRecord.js';

function normalizeList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeError(error) {
  if (!error) return null;
  return {
    name: normalizeText(error.name) || 'Error',
    message: normalizeText(error.message) || '',
  };
}

export const RUNTIME_JOURNAL_VERSION = 1;

export const STAGE_RUN_STATUSES = Object.freeze([
  'pending',
  'running',
  'completed',
  'failed',
  'blocked',
  'skipped',
  'invalidated',
  'unknown',
]);

export function normalizeStageRun(record = {}) {
  const status = normalizeText(record.status) || 'unknown';
  return {
    stage: normalizeText(record.stage) || '',
    status: STAGE_RUN_STATUSES.includes(status) ? status : 'unknown',
    startedAt: normalizeText(record.startedAt) || '',
    completedAt: normalizeText(record.completedAt) || '',
    durationMs: Number.isFinite(Number(record.durationMs)) ? Number(record.durationMs) : null,
    reusedCheckpoint: record.reusedCheckpoint === true,
    checkpointPath: normalizeText(record.checkpointPath) || '',
    partialCheckpointPath: normalizeText(record.partialCheckpointPath) || '',
    outputKeys: normalizeList(record.outputKeys),
    error: normalizeError(record.error),
  };
}

export function normalizeRuntimeJournal(journal = {}) {
  return {
    runtimeVersion: RUNTIME_JOURNAL_VERSION,
    status: normalizeText(journal.status) || 'unknown',
    updatedAt: normalizeText(journal.updatedAt) || '',
    stages: (Array.isArray(journal.stages) ? journal.stages : [])
      .map((item) => normalizeStageRun(item))
      .filter((item) => item.stage),
    decisions: (Array.isArray(journal.decisions) ? journal.decisions : [])
      .map((item) => normalizeDecisionRecord(item))
      .filter((item) => item.decisionType !== 'unknown' || item.decisionKey),
  };
}

export function buildRuntimeStageTimelineEntries(journal = {}) {
  const normalized = normalizeRuntimeJournal(journal);
  return normalized.stages.map((record) => ({
    event: 'runtime_stage_execution',
    stage: record.stage,
    status: record.status,
    at: record.completedAt || record.startedAt || normalized.updatedAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    durationMs: record.durationMs,
    reusedCheckpoint: record.reusedCheckpoint,
    outputKeys: record.outputKeys,
    error: record.error,
  }));
}

export default {
  RUNTIME_JOURNAL_VERSION,
  STAGE_RUN_STATUSES,
  normalizeStageRun,
  normalizeRuntimeJournal,
  buildRuntimeStageTimelineEntries,
};
