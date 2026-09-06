function normalizeStatus(value, fallback = 'unknown') {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : fallback;
}

function createAction({
  kind,
  runId,
  stage,
  taskId,
  enabled,
  reason,
  label,
  supportedStatuses,
} = {}) {
  const actionState = enabled ? 'executable' : 'disabled';
  return {
    kind,
    label: label || kind,
    enabled: Boolean(enabled),
    actionState,
    reason: reason || '',
    stage: stage || undefined,
    taskId: taskId || undefined,
    supportedStatuses: Array.isArray(supportedStatuses) ? supportedStatuses : undefined,
    command: {
      kind,
      runId: runId || '',
      ...(stage ? { stage } : {}),
      ...(taskId ? { taskId } : {}),
    },
  };
}

function buildAvailableActions({ run, runState, latestHumanReview } = {}) {
  const actions = [];
  const runId = run?.id || runState?.run?.runId || '';

  // P2 单轨收敛：实验轨专属的 resume_runtime / rerun_stage action 已随 src/director 移除，
  // 控制面仅保留人审（human review）action；运行时控制将在 P2d（Mastra workflow 化）重建。
  const taskIds = Array.isArray(latestHumanReview?.taskIds) ? latestHumanReview.taskIds.filter(Boolean) : [];
  for (const taskId of taskIds) {
    actions.push(createAction({
      kind: 'submit_review_action',
      runId,
      taskId,
      enabled: true,
      reason: 'human review queue item can be updated through control plane',
      label: `人工审核 ${taskId}`,
      supportedStatuses: ['approved', 'rejected', 'needs_changes', 'skipped', 'manual_review'],
    }));
  }

  return actions;
}

function buildAvailableActionCounts(actions = []) {
  return actions.reduce(
    (summary, action) => {
      if (action?.actionState === 'executable') {
        summary.executable += 1;
      } else if (action?.actionState === 'disabled') {
        summary.disabled += 1;
      } else {
        summary.pending += 1;
      }
      return summary;
    },
    { executable: 0, pending: 0, disabled: 0 }
  );
}

export function buildRuntimeControlPlaneView({ run, runState, runtimeJournal } = {}) {
  const stageRuns = Array.isArray(runState?.stageRuns) ? runState.stageRuns : [];
  const latestStage = [...stageRuns].reverse().find((item) => item?.stage) || null;
  const latestHumanReview = Array.isArray(runState?.humanReviewRecords) && runState.humanReviewRecords.length > 0
    ? runState.humanReviewRecords[runState.humanReviewRecords.length - 1]
    : null;
  const availableActions = buildAvailableActions({ run, runState, latestHumanReview });

  return {
    status: normalizeStatus(runState?.run?.status || run?.status),
    currentStage: latestStage?.stage || '',
    currentStageStatus: normalizeStatus(latestStage?.status),
    blockedStage: latestHumanReview?.blockedStage || '',
    blockReason: latestHumanReview?.blockingReason || '',
    decisionTrail: Array.isArray(runState?.decisionRecords)
      ? runState.decisionRecords.map((item) => ({
          decisionType: item.decisionType,
          decisionKey: item.decisionKey,
          policySource: item.policySource,
          rationale: item.rationale,
          timestamp: item.timestamp,
        }))
      : [],
    runtimeSummary: {
      stageCount: stageRuns.length,
      decisionCount: Array.isArray(runState?.decisionRecords) ? runState.decisionRecords.length : 0,
      reviewCount: Array.isArray(runState?.humanReviewRecords) ? runState.humanReviewRecords.length : 0,
      updatedAt: runtimeJournal?.updatedAt || runState?.run?.updatedAt || '',
    },
    actionSummary: buildAvailableActionCounts(availableActions),
    availableActions,
  };
}

export default {
  buildRuntimeControlPlaneView,
};
