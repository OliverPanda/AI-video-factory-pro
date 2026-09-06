import { asArray } from '../utils/normalization.js';

const ACTIONS = new Set([
  'approve',
  'regenerate_shot',
  'regenerate_sequence',
  'regenerate_bridge',
  'replace_clip',
  'adjust_audio_packaging',
  'manual_review',
  'skip',
]);

function normalizeStatus(value) {
  return String(value || '').toLowerCase();
}

function isFailStatus(value) {
  return ['fail', 'failed', 'block', 'blocked', 'error'].includes(normalizeStatus(value));
}

function isWarnStatus(value) {
  return ['warn', 'warning', 'warnings'].includes(normalizeStatus(value));
}

function isManualStatus(value) {
  return ['manual_review', 'needs_review', 'review'].includes(normalizeStatus(value));
}

function hasRiskStatus(value) {
  return isFailStatus(value) || isWarnStatus(value) || isManualStatus(value);
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function targetId(item = {}, fallback = 'final_video') {
  return (
    item.shotId ||
    item.sequenceId ||
    item.bridgeId ||
    item.lipsyncId ||
    item.clipId ||
    item.id ||
    item.targetId ||
    fallback
  );
}

function targetType(item = {}, fallback = 'final_video') {
  if (item.sequenceId || String(item.clipId || '').startsWith('seq')) return 'sequence';
  if (item.bridgeId || String(item.clipId || '').startsWith('bridge')) return 'bridge';
  if (item.lipsyncId) return 'lipsync';
  if (item.shotId || String(item.clipId || '').startsWith('shot')) return 'shot';
  if (item.category === 'audio' || item.dimension === 'lipsync_risk') return 'audio_packaging';
  return fallback;
}

function timelineEntries(composePlan = {}) {
  const safePlan = composePlan || {};
  if (Array.isArray(safePlan)) {
    return safePlan.filter(Boolean);
  }
  return [
    ...asArray(safePlan.timeline),
    ...asArray(safePlan.clips),
    ...asArray(safePlan.items),
    ...asArray(safePlan.videoTracks),
  ].filter(Boolean);
}

function buildTimelineIndex(composePlan = {}) {
  const byKey = new Map();
  for (const item of timelineEntries(composePlan)) {
    const type = item.type || item.kind || targetType(item, 'clip');
    const ids = [
      item.id,
      item.clipId,
      item.shotId,
      item.sequenceId,
      item.bridgeId,
      item.lipsyncId,
    ].filter(Boolean);
    const normalized = {
      type,
      id: ids[0] || 'unknown',
      timelineStartMs: item.startMs ?? item.timelineStartMs ?? Math.round(Number(item.startSec || 0) * 1000),
      timelineEndMs: item.endMs ?? item.timelineEndMs ?? Math.round(Number(item.endSec || 0) * 1000),
      clipPath: item.clipPath || item.videoPath || item.path || null,
      sourceType: item.sourceType || item.source || item.fallbackType || item.visualType || null,
      fallbackReason: item.fallbackReason || item.reason || null,
      raw: item,
    };
    for (const id of ids) {
      byKey.set(String(id), normalized);
      byKey.set(`${type}:${id}`, normalized);
    }
  }
  return byKey;
}

function timelineTarget(index, type, id) {
  const entry = index.get(`${type}:${id}`) || index.get(String(id));
  return {
    type,
    id,
    ...(entry?.timelineStartMs ? { timelineStartMs: entry.timelineStartMs } : {}),
    ...(entry?.timelineEndMs ? { timelineEndMs: entry.timelineEndMs } : {}),
  };
}

function collectReportItems(report = {}) {
  const normalizedReport = report && typeof report === 'object' ? report : {};
  return [
    ...asArray(normalizedReport.items),
    ...asArray(normalizedReport.failures),
    ...asArray(normalizedReport.warnings),
    ...asArray(normalizedReport.reviewItems),
    ...asArray(normalizedReport.entries).filter((entry) => hasRiskStatus(entry.status)),
  ];
}

function addFinding(findings, input) {
  const id = `finding_${String(findings.length + 1).padStart(3, '0')}`;
  findings.push({
    id,
    severity: input.severity || 'warn',
    category: input.category,
    message: input.message || input.reason || 'Review finding requires attention.',
    targetRef: input.targetRef,
    evidenceRefs: asArray(input.evidenceRefs),
    confidence: input.confidence ?? 0.8,
  });
  return findings[findings.length - 1];
}

function taskPriority(severity) {
  if (['blocker', 'block', 'fail', 'high'].includes(normalizeStatus(severity))) return 'high';
  if (['low', 'info'].includes(normalizeStatus(severity))) return 'low';
  return 'medium';
}

function addTask(tasks, input) {
  if (!ACTIONS.has(input.action)) {
    throw new Error(`[postComposeReview] Unsupported edit action: ${input.action}`);
  }
  const id = `edit_task_${String(tasks.length + 1).padStart(3, '0')}`;
  const approvalRequired = input.action !== 'approve';
  const target = input.targetRef || { type: 'final_video', id: 'final_video' };
  tasks.push({
    id,
    action: input.action,
    status: approvalRequired ? 'pending_approval' : 'approved',
    approvalRequired,
    priority: input.priority || taskPriority(input.severity),
    targetRef: target,
    reason: input.reason || 'Generated by post-compose review.',
    dependsOn: asArray(input.dependsOn),
    idempotencyKey: `${input.runId || 'run'}:${input.action}:${target.id}`,
    costGovernanceRef: input.costGovernanceRef || null,
    evidenceRefs: asArray(input.evidenceRefs),
    confidence: input.confidence ?? 0.8,
    executionMode: 'manual_only',
    writeBoundary: {
      candidateOnly: true,
      canMutateFinalVideo: false,
      canMutateComposePlan: false,
      canWriteCanonicalMemory: false,
    },
  });
  return tasks[tasks.length - 1];
}

function addFindingTask(findings, tasks, context) {
  const finding = addFinding(findings, context);
  return addTask(tasks, {
    ...context,
    evidenceRefs: [finding.id, ...asArray(context.evidenceRefs)],
  });
}

function composePlanFindings(input, index, findings, tasks) {
  for (const entry of timelineEntries(input.composePlan)) {
    const id = targetId(entry, entry.id || entry.clipId || 'clip');
    const type = targetType(entry, entry.type || 'clip');
    const sourceText = `${entry.sourceType || ''} ${entry.fallbackType || ''} ${entry.visualType || ''} ${entry.kind || ''} ${entry.status || ''}`;
    const missingClip = entry.missingClip === true || entry.clipMissing === true || entry.clipPath === null;
    const staticFallback = /static|image|fallback/i.test(sourceText) || entry.isStaticFallback === true;
    if (!missingClip && !staticFallback) continue;

    const action = missingClip ? 'regenerate_shot' : 'replace_clip';
    addFindingTask(findings, tasks, {
      runId: input.runId,
      action,
      severity: missingClip ? 'blocker' : 'warn',
      category: missingClip ? 'compose_missing_clip' : 'compose_static_fallback',
      message: firstText(entry.fallbackReason, entry.reason, missingClip ? 'Compose plan is missing a clip.' : 'Compose plan uses a static fallback.'),
      reason: missingClip ? 'Final compose timeline references a missing clip.' : 'Final compose timeline uses static/image fallback.',
      targetRef: timelineTarget(index, type === 'sequence' || type === 'bridge' ? type : 'shot', id),
      evidenceRefs: ['composePlan'],
      confidence: missingClip ? 0.9 : 0.78,
    });
  }
}

function qaFindings(input, index, findings, tasks) {
  for (const item of collectReportItems(input.shotQaReport)) {
    if (!hasRiskStatus(item.status || input.shotQaReport?.status)) continue;
    const id = targetId(item, 'shot');
    addFindingTask(findings, tasks, {
      runId: input.runId,
      action: 'regenerate_shot',
      severity: item.severity || input.shotQaReport?.status || 'fail',
      category: 'shot_qa',
      message: firstText(item.message, item.reason, 'Shot QA failed.'),
      reason: 'shot QA failed and final timeline may use this shot.',
      targetRef: timelineTarget(index, 'shot', id),
      evidenceRefs: ['shotQaReport'],
      confidence: item.confidence ?? 0.86,
    });
  }

  for (const item of collectReportItems(input.sequenceQaReport)) {
    if (!hasRiskStatus(item.status || input.sequenceQaReport?.status)) continue;
    const id = targetId(item, 'sequence');
    const manual = isManualStatus(item.status || input.sequenceQaReport?.status);
    addFindingTask(findings, tasks, {
      runId: input.runId,
      action: manual ? 'manual_review' : 'regenerate_sequence',
      severity: item.severity || input.sequenceQaReport?.status || 'warn',
      category: 'sequence_qa',
      message: firstText(item.message, item.reason, 'Sequence QA requires attention.'),
      reason: manual ? 'sequence QA needs human judgment before regeneration.' : 'sequence QA failed.',
      targetRef: timelineTarget(index, 'sequence', id),
      evidenceRefs: ['sequenceQaReport'],
      confidence: manual ? 0.62 : 0.84,
    });
  }

  for (const item of collectReportItems(input.bridgeQaReport)) {
    if (!hasRiskStatus(item.status || input.bridgeQaReport?.status)) continue;
    const id = targetId(item, 'bridge');
    const manual = isManualStatus(item.status || input.bridgeQaReport?.status);
    addFindingTask(findings, tasks, {
      runId: input.runId,
      action: manual ? 'manual_review' : 'regenerate_bridge',
      severity: item.severity || input.bridgeQaReport?.status || 'fail',
      category: 'bridge_qa',
      message: firstText(item.message, item.reason, 'Bridge QA failed.'),
      reason: manual ? 'bridge QA needs human judgment before regeneration.' : 'bridge QA failed.',
      targetRef: timelineTarget(index, 'bridge', id),
      evidenceRefs: ['bridgeQaReport'],
      confidence: manual ? 0.64 : 0.84,
    });
  }
}

function audioFindings(input, index, findings, tasks) {
  const ttsItems = collectReportItems(input.ttsQaReport);
  if (hasRiskStatus(input.ttsQaReport?.status) && ttsItems.length === 0) {
    ttsItems.push({ status: input.ttsQaReport.status, message: 'TTS QA reported a risk.' });
  }
  for (const item of ttsItems) {
    if (!hasRiskStatus(item.status || input.ttsQaReport?.status)) continue;
    const id = targetId(item, item.shotId || 'audio_packaging');
    addFindingTask(findings, tasks, {
      runId: input.runId,
      action: isFailStatus(item.status || input.ttsQaReport?.status) ? 'manual_review' : 'adjust_audio_packaging',
      severity: item.severity || item.status || input.ttsQaReport?.status || 'warn',
      category: 'tts_qa',
      message: firstText(item.message, item.reason, 'TTS QA warning or failure.'),
      reason: 'TTS QA risk should be handled as audio packaging or manual review.',
      targetRef: timelineTarget(index, item.shotId ? 'shot' : 'audio_packaging', id),
      evidenceRefs: ['ttsQaReport'],
      confidence: 0.76,
    });
  }

  for (const item of collectReportItems(input.lipsyncReport)) {
    if (!hasRiskStatus(item.status || input.lipsyncReport?.status)) continue;
    const id = targetId(item, item.shotId || 'lipsync');
    addFindingTask(findings, tasks, {
      runId: input.runId,
      action: 'manual_review',
      severity: item.severity || item.status || input.lipsyncReport?.status || 'warn',
      category: 'lipsync',
      message: firstText(item.message, item.reason, 'Lipsync report requires review.'),
      reason: 'Lipsync issues need human review in first version.',
      targetRef: timelineTarget(index, item.shotId ? 'shot' : 'lipsync', id),
      evidenceRefs: ['lipsyncReport'],
      confidence: 0.68,
    });
  }

  for (const warning of asArray(input.avPackagingPlan?.warnings)) {
    addFindingTask(findings, tasks, {
      runId: input.runId,
      action: warning.blocking ? 'manual_review' : 'adjust_audio_packaging',
      severity: warning.blocking ? 'blocker' : 'warn',
      category: 'audio_packaging',
      message: firstText(warning.message, warning.code, 'AV packaging warning.'),
      reason: 'AV packaging warning should become an audio packaging edit task.',
      targetRef: { type: 'audio_packaging', id: warning.code || 'audio_packaging' },
      evidenceRefs: ['avPackagingPlan'],
      confidence: 0.76,
    });
  }
}

function crossVideoFindings(input, index, findings, tasks) {
  const actionMap = {
    regenerate_sequence: 'regenerate_sequence',
    regenerate_bridge: 'regenerate_bridge',
    regenerate_shot: 'regenerate_shot',
    attach_reference_and_regenerate: 'regenerate_shot',
    manual_review: 'manual_review',
    replace_clip: 'replace_clip',
    skip: 'skip',
  };

  for (const item of asArray(input.crossVideoConsistencyReport?.reviewItems)) {
    const action = actionMap[item.recommendedAction] || 'manual_review';
    const type = targetType(item, action === 'regenerate_sequence' ? 'sequence' : 'shot');
    const id = targetId(item, type);
    addFindingTask(findings, tasks, {
      runId: input.runId,
      action,
      severity: item.severity || input.crossVideoConsistencyReport?.status || 'warn',
      category: `cross_video_${item.dimension || 'consistency'}`,
      message: firstText(item.message, item.reason, 'Cross-video consistency review item.'),
      reason: `crossVideoConsistencyReport recommended ${item.recommendedAction || 'manual_review'}.`,
      targetRef: timelineTarget(index, type, id),
      evidenceRefs: ['crossVideoConsistencyReport'],
      confidence: item.confidence ?? 0.74,
    });
  }
}

function costFindings(input, findings, tasks) {
  const report = input.costGovernanceReport || {};
  const issues = [
    ...asArray(report.blockers).map((message) => ({ severity: 'blocker', message })),
    ...asArray(report.highRiskItems).map((message) => ({ severity: 'high', message })),
    ...asArray(report.warnings).map((message) => ({ severity: 'warn', message })),
  ];
  if (isFailStatus(report.status) && issues.length === 0) {
    issues.push({ severity: 'blocker', message: 'Cost governance blocked automatic repair.' });
  }
  for (const issue of issues) {
    addFindingTask(findings, tasks, {
      runId: input.runId,
      action: issue.severity === 'blocker' ? 'skip' : 'manual_review',
      severity: issue.severity,
      category: 'cost_governance',
      message: typeof issue.message === 'string' ? issue.message : issue.message?.message || 'Cost governance risk.',
      reason: 'Cost governance risk must be reviewed; no automatic execution is allowed.',
      targetRef: { type: 'cost_governance', id: 'repair_budget' },
      evidenceRefs: ['costGovernanceReport'],
      confidence: 0.9,
    });
  }
}

function userFeedbackFindings(input, findings, tasks) {
  const feedback = input.userFeedback || input.userPreviewFeedback;
  if (!feedback) return;
  addFindingTask(findings, tasks, {
    runId: input.runId,
    action: 'manual_review',
    severity: 'warn',
    category: 'user_feedback',
    message: typeof feedback === 'string' ? feedback : JSON.stringify(feedback),
    reason: 'User preview feedback is subjective and requires manual review in first version.',
    targetRef: { type: 'final_video', id: 'final_video' },
    evidenceRefs: ['userFeedback'],
    confidence: 0.58,
  });
}

function buildHumanReview(tasks) {
  const items = tasks
    .filter((task) => task.approvalRequired || task.confidence < 0.7)
    .map((task) => ({
      taskId: task.id,
      reviewType: task.action === 'skip' ? 'confirm_skip' : 'approve_or_skip',
      assignedRole: 'director',
      priority: task.priority,
      targetRef: task.targetRef,
      reason: task.reason,
    }));
  return {
    queueName: 'post-compose-review',
    items,
  };
}

function buildSummary(findings, tasks) {
  const nonApproveTasks = tasks.filter((task) => task.action !== 'approve');
  const blockingFindings = findings.filter((finding) =>
    ['blocker', 'block', 'fail', 'high'].includes(normalizeStatus(finding.severity))
  ).length;
  return {
    status: nonApproveTasks.length === 0 ? 'approved' : 'needs_review',
    totalFindings: findings.length,
    blockingFindings,
    taskCount: tasks.length,
    manualTaskCount: nonApproveTasks.length,
    estimatedRepairCost: {
      currency: 'USD',
      min: 0,
      max: null,
    },
  };
}

export function buildPostComposeReview(input = {}) {
  const index = buildTimelineIndex(input.composePlan || {});
  const findings = [];
  const tasks = [];

  qaFindings(input, index, findings, tasks);
  audioFindings(input, index, findings, tasks);
  composePlanFindings(input, index, findings, tasks);
  crossVideoFindings(input, index, findings, tasks);
  costFindings(input, findings, tasks);
  userFeedbackFindings(input, findings, tasks);

  if (tasks.length === 0) {
    addTask(tasks, {
      runId: input.runId,
      action: 'approve',
      reason: 'No post-compose risks found in supplied reports.',
      targetRef: { type: 'final_video', id: input.composeResult?.finalVideoPath || input.finalVideoPath || 'final_video' },
      evidenceRefs: ['composeResult', 'composePlan'],
      confidence: 0.92,
    });
  }

  const reviewSummary = buildSummary(findings, tasks);
  const editTaskPack = {
    schemaVersion: 'edit-task-pack.v1',
    projectId: input.projectId || 'unknown',
    runId: input.runId || 'unknown',
    composePlanRef: input.composePlanPath || input.composePlan?.path || 'compose-plan.json',
    finalVideoRef: input.finalVideoPath || input.composeResult?.finalVideoPath || input.composeResult?.outputPath || null,
    createdAt: input.now || new Date().toISOString(),
    executionMode: 'manual_only',
    manualExecutionRequired: tasks.some((task) => task.approvalRequired),
    memoryBoundary: {
      owner: 'review_queue',
      patchMode: 'candidate_only',
      autoPromoteToConstraint: false,
      requiresHumanApprovalForConstraint: true,
    },
    reviewSummary,
    findings,
    tasks,
    humanReview: buildHumanReview(tasks),
    candidateChanges: tasks
      .filter((task) => task.action !== 'approve')
      .map((task) => ({
        candidateId: `post_compose_candidate_${task.id}`,
        type: 'post_compose_edit_candidate',
        action: task.action,
        targetRef: task.targetRef,
        reason: task.reason,
        evidenceRefs: task.evidenceRefs,
      })),
  };

  const report = {
    schemaVersion: 'post-compose-review.v1',
    projectId: editTaskPack.projectId,
    runId: editTaskPack.runId,
    status: reviewSummary.status,
    summary: reviewSummary,
    findings,
    editTaskPackRef: 'edit-task-pack.json',
    executionBoundary: {
      automaticProviderCalls: false,
      finalVideoMutation: false,
      composePlanMutation: false,
      canonicalMemoryMutation: false,
    },
  };

  return {
    report,
    editTaskPack,
    status: report.status,
    humanReviewItemIds: editTaskPack.humanReview.items.map((item) => item.taskId),
  };
}

export const __testables = {
  buildTimelineIndex,
  collectReportItems,
};
