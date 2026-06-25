import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function safeExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function loadJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isPathInside(basePath, candidatePath) {
  const absoluteBase = path.resolve(basePath);
  const absoluteCandidate = path.resolve(candidatePath);
  const relative = path.relative(absoluteBase, absoluteCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildShotTimeline(shots = []) {
  let cursor = 0;
  return (Array.isArray(shots) ? shots : []).map((shot, index) => {
    const explicitStart = Number.isFinite(Number(shot?.startSec)) ? Number(shot.startSec) : cursor;
    const durationSec = normalizeNumber(
      shot?.durationSec ?? shot?.duration ?? shot?.targetDurationSec,
      0
    );
    const explicitEnd = Number.isFinite(Number(shot?.endSec))
      ? Number(shot.endSec)
      : explicitStart + Math.max(durationSec, 0);
    cursor = explicitEnd;
    return {
      type: 'shot',
      id: shot?.id || `shot_${index + 1}`,
      shotId: shot?.id || null,
      title: shot?.title || shot?.scene || shot?.action || shot?.id || `shot_${index + 1}`,
      scene: shot?.scene || null,
      dialogue: shot?.dialogue || '',
      startSec: explicitStart,
      endSec: explicitEnd,
      durationSec: Math.max(explicitEnd - explicitStart, 0),
      videoPath: shot?.videoPath || null,
      imagePath: shot?.imagePath || null,
    };
  });
}

function computeTimelineRange(clip = {}, shotIndex = new Map()) {
  if (Number.isFinite(Number(clip?.startSec)) && Number.isFinite(Number(clip?.endSec))) {
    return { startSec: Number(clip.startSec), endSec: Number(clip.endSec) };
  }

  if (Number.isFinite(Number(clip?.startMs)) && Number.isFinite(Number(clip?.endMs))) {
    return { startSec: Number(clip.startMs) / 1000, endSec: Number(clip.endMs) / 1000 };
  }

  const referencedIds = []
    .concat(Array.isArray(clip?.shotIds) ? clip.shotIds : [])
    .concat(clip?.shotId ? [clip.shotId] : [])
    .concat(clip?.fromShotId ? [clip.fromShotId] : [])
    .concat(clip?.toShotId ? [clip.toShotId] : []);
  const referencedClips = referencedIds
    .map((id) => shotIndex.get(id))
    .filter(Boolean);
  if (referencedClips.length > 0) {
    return {
      startSec: Math.min(...referencedClips.map((item) => item.startSec)),
      endSec: Math.max(...referencedClips.map((item) => item.endSec)),
    };
  }

  const timelineStartMs = normalizeNumber(clip?.timelineStartMs, NaN);
  const timelineEndMs = normalizeNumber(clip?.timelineEndMs, NaN);
  if (Number.isFinite(timelineStartMs) && Number.isFinite(timelineEndMs)) {
    return { startSec: timelineStartMs / 1000, endSec: timelineEndMs / 1000 };
  }

  return { startSec: 0, endSec: 0 };
}

function buildTaskStatusSummary(tasks = []) {
  const summary = {
    total: Array.isArray(tasks) ? tasks.length : 0,
    pending: 0,
    approved: 0,
    skipped: 0,
    manual_review: 0,
    other: 0,
  };

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const status = String(task?.status || 'pending_approval').trim();
    if (status === 'approved' || status === 'skipped' || status === 'manual_review') {
      summary[status] += 1;
    } else if (status === 'pending_approval' || status === 'open' || status === 'pending') {
      summary.pending += 1;
    } else {
      summary.other += 1;
    }
  }

  return summary;
}

function buildHumanReviewQueueSummary(items = []) {
  const openStatuses = new Set(['open', 'pending', 'pending_approval']);
  const openItems = (Array.isArray(items) ? items : []).filter((item) => openStatuses.has(String(item?.status || 'open')));
  return {
    openCount: openItems.length,
    highPriorityCount: openItems.filter((item) => item?.priority === 'high').length,
    mediumPriorityCount: openItems.filter((item) => item?.priority === 'medium').length,
    lowPriorityCount: openItems.filter((item) => item?.priority === 'low').length,
  };
}

export function resolveTrustedAbsoluteFinalVideoPath(targetPath, workspaceRoot) {
  if (!targetPath || !path.isAbsolute(targetPath)) {
    return null;
  }

  const absoluteTarget = path.resolve(targetPath);
  if (path.basename(absoluteTarget).toLowerCase() !== 'final-video.mp4') {
    return null;
  }

  const normalized = absoluteTarget.toLowerCase();
  if (!normalized.includes(`${path.sep}output${path.sep}`)) {
    return null;
  }

  const trustedRoots = [
    workspaceRoot,
    path.resolve(process.env.OUTPUT_DIR || './output'),
    path.resolve(process.env.TEMP_DIR || './temp'),
    os.tmpdir(),
  ];

  return trustedRoots.some((rootDir) => rootDir && isPathInside(rootDir, absoluteTarget))
    ? absoluteTarget
    : null;
}

export function resolveRunDir(runJob, workspaceRoot) {
  if (!runJob?.artifactRunDir) return null;
  const absolute = path.isAbsolute(runJob.artifactRunDir)
    ? runJob.artifactRunDir
    : path.join(workspaceRoot, runJob.artifactRunDir);
  if (path.isAbsolute(runJob.artifactRunDir) && !isPathInside(workspaceRoot, absolute)) {
    console.warn(`[router] resolveRunDir: absolute path outside workspace: ${runJob.artifactRunDir}`);
    return null;
  }
  return absolute;
}

export function findArtifactFileByName(rootDir, fileName, maxDepth = 5) {
  if (!rootDir || !safeExists(rootDir)) return null;
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of safeReadDir(current.dir)) {
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name === fileName) {
        return entryPath;
      }
      if (entry.isDirectory() && current.depth < maxDepth) {
        queue.push({ dir: entryPath, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

export function loadRunArtifactJson(runJob, workspaceRoot, fileName) {
  const runDir = resolveRunDir(runJob, workspaceRoot);
  const filePath = findArtifactFileByName(runDir, fileName);
  return {
    runDir,
    filePath,
    data: filePath ? loadJsonSafe(filePath) : null,
  };
}

export function buildReviewClips({ snapshot, editTaskPack, episode }) {
  const snapshotShots = snapshot?.scriptData?.shots;
  const shots = Array.isArray(snapshotShots) && snapshotShots.length > 0
    ? snapshotShots
    : (episode?.shots || []);
  const shotClips = buildShotTimeline(shots);
  const shotIndex = new Map(shotClips.map((clip) => [clip.id, clip]));

  const sequenceClips = (Array.isArray(snapshot?.sequenceClipResults) ? snapshot.sequenceClipResults : []).map((clip, index) => {
    const range = computeTimelineRange(clip, shotIndex);
    return {
      type: 'sequence',
      id: clip?.id || clip?.sequenceId || `sequence_${index + 1}`,
      shotIds: Array.isArray(clip?.shotIds) ? clip.shotIds : [],
      startSec: range.startSec,
      endSec: range.endSec,
      videoPath: clip?.videoPath || null,
    };
  });

  const bridgeClips = (Array.isArray(snapshot?.bridgeClipResults) ? snapshot.bridgeClipResults : []).map((clip, index) => {
    const range = computeTimelineRange(clip, shotIndex);
    return {
      type: 'bridge',
      id: clip?.id || clip?.bridgeId || `bridge_${index + 1}`,
      fromShotId: clip?.fromShotId || null,
      toShotId: clip?.toShotId || null,
      startSec: range.startSec,
      endSec: range.endSec,
      videoPath: clip?.videoPath || null,
    };
  });

  const audioClips = (Array.isArray(snapshot?.audioResults) ? snapshot.audioResults : []).map((clip, index) => {
    const shot = shotIndex.get(clip?.shotId);
    const range = computeTimelineRange(clip, shotIndex);
    return {
      type: 'audio',
      id: clip?.id || clip?.shotId || `audio_${index + 1}`,
      shotId: clip?.shotId || null,
      startSec: Number.isFinite(Number(clip?.startSec)) ? Number(clip.startSec) : (shot?.startSec ?? range.startSec),
      endSec: Number.isFinite(Number(clip?.endSec)) ? Number(clip.endSec) : (shot?.endSec ?? range.endSec),
      audioPath: clip?.audioPath || null,
    };
  });

  if (shotClips.length === 0 && Array.isArray(editTaskPack?.tasks)) {
    for (const task of editTaskPack.tasks) {
      if (task?.targetRef?.type !== 'shot') continue;
      const startMs = normalizeNumber(task.targetRef.timelineStartMs, NaN);
      const endMs = normalizeNumber(task.targetRef.timelineEndMs, NaN);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      shotClips.push({
        type: 'shot',
        id: task.targetRef.id || task.id,
        shotId: task.targetRef.id || null,
        title: task.reason || task.id,
        startSec: startMs / 1000,
        endSec: endMs / 1000,
        durationSec: (endMs - startMs) / 1000,
      });
    }
  }

  return {
    shot: shotClips,
    sequence: sequenceClips,
    bridge: bridgeClips,
    audio: audioClips,
  };
}

export function syncEditTaskPackStatusFields(editTaskPack) {
  if (!editTaskPack || typeof editTaskPack !== 'object') return editTaskPack;
  const summary = buildTaskStatusSummary(editTaskPack.tasks);
  editTaskPack.taskStatusSummary = summary;
  editTaskPack.reviewSummary = {
    ...(editTaskPack.reviewSummary || {}),
    taskCount: summary.total,
    manualTaskCount: summary.total,
    pendingTaskCount: summary.pending,
    approvedTaskCount: summary.approved,
    skippedTaskCount: summary.skipped,
    manualReviewTaskCount: summary.manual_review,
  };
  if (editTaskPack.humanReview && Array.isArray(editTaskPack.humanReview.items)) {
    const statusByTaskId = new Map((editTaskPack.tasks || []).map((task) => [task.id, task.status]));
    editTaskPack.humanReview.items = editTaskPack.humanReview.items.map((item) => ({
      ...item,
      status: statusByTaskId.get(item.taskId) || item.status || 'open',
    }));
  }
  return editTaskPack;
}

export function syncPostComposeReviewStatusFields(postComposeReview, editTaskPack) {
  if (!postComposeReview || typeof postComposeReview !== 'object') return postComposeReview;
  const summary = buildTaskStatusSummary(editTaskPack?.tasks);
  postComposeReview.taskStatusSummary = summary;
  postComposeReview.summary = {
    ...(postComposeReview.summary || {}),
    taskCount: summary.total,
    manualTaskCount: summary.total,
    pendingTaskCount: summary.pending,
    approvedTaskCount: summary.approved,
    skippedTaskCount: summary.skipped,
    manualReviewTaskCount: summary.manual_review,
    status: summary.pending > 0 ? 'needs_review' : 'reviewed',
  };
  return postComposeReview;
}

export function syncHumanReviewQueueStatusFields(humanReviewQueue, taskId, nextStatus) {
  if (!humanReviewQueue || !Array.isArray(humanReviewQueue.items)) return humanReviewQueue;
  humanReviewQueue.items = humanReviewQueue.items.map((item) => (
    item?.id === `post_compose_${taskId}` || String(item?.id || '').endsWith(taskId)
      ? { ...item, status: nextStatus }
      : item
  ));
  humanReviewQueue.summary = buildHumanReviewQueueSummary(humanReviewQueue.items);
  return humanReviewQueue;
}
