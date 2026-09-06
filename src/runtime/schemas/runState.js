import { normalizeText } from '../../utils/normalization.js';
import { normalizeRuntimeJournal, normalizeStageRun } from './runtimeJournal.js';
import { normalizeDecisionRecord } from './decisionRecord.js';
import { deriveHumanReviewStatus, normalizeHumanReviewRecord } from './humanReviewRecord.js';

export const RUN_STATE_VERSION = 1;

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStringList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

export function normalizeArtifactRecord(record = {}) {
  return {
    path: normalizeText(record.path) || '',
    kind: normalizeText(record.kind) || 'file',
    producerStage: normalizeText(record.producerStage) || '',
    logicalLabel: normalizeText(record.logicalLabel) || '',
    summary: normalizeText(record.summary) || '',
  };
}

function buildArtifactRecords(snapshot = {}) {
  const records = [];
  const pushIfPresent = (pathValue, kind, producerStage, logicalLabel, summary = '') => {
    const normalizedPath = normalizeText(pathValue);
    if (!normalizedPath) return;
    records.push(normalizeArtifactRecord({
      path: normalizedPath,
      kind,
      producerStage,
      logicalLabel,
      summary,
    }));
  };

  pushIfPresent(snapshot.outputPath, 'video', 'compose', 'final_output');
  pushIfPresent(snapshot.deliverySummaryPath, 'markdown', 'compose', 'delivery_summary');

  const editTaskPackRef = snapshot.postComposeReview?.editTaskPackRef || snapshot.postComposeReview?.editTaskPack?.path;
  pushIfPresent(editTaskPackRef, 'json', 'cross_video_consistency', 'edit_task_pack');

  return records;
}

function buildHumanReviewRecords(snapshot = {}, runtimeJournal = null) {
  const records = [];
  const executionGate = snapshot.executionGate || {};
  const humanReviewQueue = snapshot.humanReviewQueue || {};
  const queueItems = Array.isArray(humanReviewQueue.items) ? humanReviewQueue.items : [];
  const blockedStage = executionGate.status === 'blocked'
    ? normalizeText(executionGate.stoppedBeforeStage) || 'generate_video_clips'
    : '';

  if (blockedStage || queueItems.length > 0) {
    records.push(normalizeHumanReviewRecord({
      reviewId: normalizeText(humanReviewQueue.queueId) || 'human_review_queue',
      blockedStage,
      blockingReason: normalizeText(executionGate.message) || normalizeText(executionGate.reason) || '',
      status: deriveHumanReviewStatus({
        queueItems,
        blockedStage,
        fallbackStatus: blockedStage ? 'blocked' : 'pending',
      }),
      reviewerAction: '',
      resolutionPayload: {
        executionGate: normalizeObject(executionGate),
        summary: normalizeObject(humanReviewQueue.summary),
      },
      resolvedAt: '',
      taskIds: queueItems.map((item) => item?.taskId || item?.id).filter(Boolean),
    }));
  }

  if (runtimeJournal?.status === 'blocked' && records.length === 0) {
    records.push(normalizeHumanReviewRecord({
      reviewId: 'runtime_block',
      blockedStage: '',
      blockingReason: '',
      status: 'blocked',
    }));
  }

  return records;
}

export function normalizeRunState(input = {}) {
  const snapshot = normalizeObject(input.snapshot);
  const runtimeJournal = normalizeRuntimeJournal(input.runtimeJournal || snapshot.runtimeJournal || {});
  const stageRuns = (Array.isArray(input.stageRuns) ? input.stageRuns : snapshot.pipelineExecutionRecords || runtimeJournal.stages || [])
    .map((item) => normalizeStageRun(item))
    .filter((item) => item.stage);
  const decisions = (Array.isArray(input.decisions) ? input.decisions : snapshot.decisionRecords || runtimeJournal.decisions || [])
    .map((item) => normalizeDecisionRecord(item))
    .filter((item) => item.decisionType !== 'unknown' || item.decisionKey);

  return {
    runStateVersion: RUN_STATE_VERSION,
    run: {
      runId: normalizeText(input.runId || snapshot.runId || snapshot.id) || '',
      jobId: normalizeText(input.jobId || snapshot.jobId) || '',
      projectId: normalizeText(input.projectId || snapshot.projectId) || '',
      scriptId: normalizeText(input.scriptId || snapshot.scriptId) || '',
      episodeId: normalizeText(input.episodeId || snapshot.episodeId) || '',
      workflowVersion: normalizeText(input.workflowVersion || snapshot.workflowVersion) || 'experimental_director_v1',
      status: normalizeText(input.status || runtimeJournal.status || snapshot.status) || 'unknown',
      startedAt: normalizeText(input.startedAt || snapshot.startedAt) || '',
      updatedAt: normalizeText(input.updatedAt || runtimeJournal.updatedAt || snapshot.completedAt || snapshot.failedAt) || '',
      completedAt: normalizeText(input.completedAt || snapshot.completedAt) || '',
      failedAt: normalizeText(input.failedAt || snapshot.failedAt) || '',
    },
    stageRuns,
    decisionRecords: decisions,
    artifactRecords: (Array.isArray(input.artifactRecords) ? input.artifactRecords : buildArtifactRecords(snapshot))
      .map((item) => normalizeArtifactRecord(item))
      .filter((item) => item.path || item.logicalLabel),
    humanReviewRecords: (Array.isArray(input.humanReviewRecords) ? input.humanReviewRecords : buildHumanReviewRecords(snapshot, runtimeJournal))
      .map((item) => normalizeHumanReviewRecord(item))
      .filter((item) => item.reviewId || item.blockedStage || item.blockingReason),
    runtimeJournal,
  };
}

export default {
  RUN_STATE_VERSION,
  normalizeArtifactRecord,
  normalizeRunState,
};
