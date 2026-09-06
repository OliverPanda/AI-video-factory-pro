import { normalizeRunState } from '../../runtime/schemas/runState.js';
import { deriveHumanReviewStatus } from '../../runtime/schemas/humanReviewRecord.js';
import { loadRunArtifactJson, syncEditTaskPackStatusFields, syncHumanReviewQueueStatusFields, syncPostComposeReviewStatusFields } from './reviewSupport.js';
import { resolveRunState } from '../dataSources/runStateResolver.js';

export function loadReviewArtifactsWithLiveFallback(runJob, workspaceRoot, { projectStoreBaseTempDir }) {
  const { liveState } = resolveRunState(runJob, { workspaceRoot, projectStoreBaseTempDir });
  const postComposeReview = loadRunArtifactJson(runJob, workspaceRoot, 'post-compose-review.json');
  const editTaskPack = loadRunArtifactJson(runJob, workspaceRoot, 'edit-task-pack.json');
  const humanReviewQueue = loadRunArtifactJson(runJob, workspaceRoot, 'human-review-queue.json');

  return {
    liveState,
    postComposeReview: {
      ...postComposeReview,
      data: postComposeReview.data || liveState?.postComposeReview?.report || null,
    },
    editTaskPack: {
      ...editTaskPack,
      data: editTaskPack.data || liveState?.postComposeReview?.editTaskPack || null,
    },
    humanReviewQueue: {
      ...humanReviewQueue,
      data:
        humanReviewQueue.data ||
        liveState?.humanReviewQueue ||
        liveState?.postComposeReview?.editTaskPack?.humanReview ||
        null,
    },
  };
}

export function syncSnapshotHumanReviewState(snapshot, humanReviewQueue, { taskId, nextStatus, reviewedAt }) {
  if (!snapshot || typeof snapshot !== 'object') {
    return snapshot;
  }

  snapshot.humanReviewQueue = humanReviewQueue || snapshot.humanReviewQueue || null;

  const executionGate = snapshot.executionGate && typeof snapshot.executionGate === 'object'
    ? snapshot.executionGate
    : {};
  const queueItems = Array.isArray(humanReviewQueue?.items) ? humanReviewQueue.items : [];
  const openStatuses = new Set(['open', 'pending', 'pending_approval']);
  const hasOpenItems = queueItems.some((item) => openStatuses.has(String(item?.status || 'open')));
  const derivedStatus = deriveHumanReviewStatus({
    queueItems,
    blockedStage: hasOpenItems ? (snapshot.blockedStage || snapshot.executionGate?.stoppedBeforeStage || '') : '',
    fallbackStatus: nextStatus,
  });
  const shouldPassExecutionGate = derivedStatus === 'approved';

  snapshot.runState = normalizeRunState({
    snapshot: {
      ...snapshot,
      executionGate: hasOpenItems
        ? executionGate
        : {
            ...executionGate,
            status: executionGate.status === 'blocked'
              ? (shouldPassExecutionGate ? 'pass' : 'blocked')
              : executionGate.status,
          },
    },
    runtimeJournal: snapshot.runtimeJournal,
    stageRuns: snapshot.pipelineExecutionRecords,
    decisions: snapshot.decisionRecords,
  });

  if (Array.isArray(snapshot.runState?.humanReviewRecords) && snapshot.runState.humanReviewRecords.length > 0) {
    snapshot.runState.humanReviewRecords = snapshot.runState.humanReviewRecords.map((record) => ({
      ...record,
      reviewerAction: taskId && String(record.reviewId || '').length > 0 ? `${taskId}:${nextStatus}` : record.reviewerAction,
      resolvedAt: hasOpenItems ? '' : (reviewedAt || record.resolvedAt || ''),
      status: hasOpenItems ? record.status : derivedStatus,
      resolutionPayload: {
        ...(record.resolutionPayload || {}),
        latestTaskUpdate: {
          taskId,
          status: nextStatus,
          reviewedAt,
        },
      },
    }));
  }

  return snapshot;
}

export async function applyHumanReviewTaskAction({
  run,
  taskId,
  nextStatus,
  workspaceRoot,
  projectStoreBaseTempDir,
  writeJsonSafe,
}) {
  const editTaskPack = loadRunArtifactJson(run, workspaceRoot, 'edit-task-pack.json');
  if (!editTaskPack.data || !editTaskPack.filePath) {
    return {
      ok: false,
      statusCode: 404,
      payload: { error: 'Edit task pack not found' },
    };
  }

  const taskIndex = Array.isArray(editTaskPack.data.tasks)
    ? editTaskPack.data.tasks.findIndex((task) => task?.id === taskId)
    : -1;
  if (taskIndex < 0) {
    return {
      ok: false,
      statusCode: 404,
      payload: { error: 'Review task not found' },
    };
  }

  const updatedTask = {
    ...editTaskPack.data.tasks[taskIndex],
    status: nextStatus,
    reviewedAt: new Date().toISOString(),
  };
  editTaskPack.data.tasks[taskIndex] = updatedTask;
  syncEditTaskPackStatusFields(editTaskPack.data);
  writeJsonSafe(editTaskPack.filePath, editTaskPack.data);

  const postComposeReview = loadRunArtifactJson(run, workspaceRoot, 'post-compose-review.json');
  if (postComposeReview.filePath && postComposeReview.data) {
    postComposeReview.data.lastTaskUpdate = {
      taskId,
      status: nextStatus,
      reviewedAt: updatedTask.reviewedAt,
    };
    syncPostComposeReviewStatusFields(postComposeReview.data, editTaskPack.data);
    writeJsonSafe(postComposeReview.filePath, postComposeReview.data);
  }

  const humanReviewQueue = loadRunArtifactJson(run, workspaceRoot, 'human-review-queue.json');
  if (humanReviewQueue.filePath && humanReviewQueue.data) {
    syncHumanReviewQueueStatusFields(humanReviewQueue.data, taskId, nextStatus);
    writeJsonSafe(humanReviewQueue.filePath, humanReviewQueue.data);
  }

  const resolvedRunState = resolveRunState(run, { workspaceRoot, projectStoreBaseTempDir });
  if (resolvedRunState.locator.snapshotPath && resolvedRunState.snapshot) {
    const nextSnapshot = syncSnapshotHumanReviewState(
      structuredClone(resolvedRunState.snapshot),
      humanReviewQueue.data || resolvedRunState.snapshot.humanReviewQueue || null,
      {
        taskId,
        nextStatus,
        reviewedAt: updatedTask.reviewedAt,
      }
    );
    writeJsonSafe(resolvedRunState.locator.snapshotPath, nextSnapshot);
  }

  return {
    ok: true,
    statusCode: 200,
    payload: {
      success: true,
      runId: run.id,
      controlCommand: {
        kind: 'submit_review_action',
        runId: run.id,
        taskId,
        status: nextStatus,
      },
      task: updatedTask,
    },
  };
}
