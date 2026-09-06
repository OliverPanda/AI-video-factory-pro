import fs from 'node:fs';
import path from 'node:path';

import { finishRunJob } from '../../utils/jobStore.js';
import { getEpisodeDir, loadJSON } from '../../utils/fileHelper.js';
import { safeExists, resolvePathInside } from './pathSecurity.js';
import { resolveRunDir } from './reviewSupport.js';
import { loadRunLiveState } from './episodeHelpers.js';

function readJsonSafe(filePath) {
  return loadJSON(filePath);
}

function isTerminalRunStatus(status) {
  return ['completed', 'failed', 'error', 'blocked', 'cancelled'].includes(String(status || '').toLowerCase());
}

export function resolveRunJobLogPath(runJob, workspaceRoot) {
  const configuredPath = String(runJob?.debugLogPath || '').trim();
  if (configuredPath) {
    if (path.isAbsolute(configuredPath)) {
      return configuredPath;
    }
    try {
      return resolvePathInside(workspaceRoot, configuredPath, 'workspace');
    } catch {
      return null;
    }
  }

  try {
    const baseTempDir = path.join(workspaceRoot, 'temp');
    const episodeDir = getEpisodeDir(runJob.projectId, runJob.scriptId, runJob.episodeId, baseTempDir);
    return path.join(episodeDir, 'run-jobs', `${runJob.id}.log`);
  } catch {
    return null;
  }
}

export function readSpawnedPidFromRunLog(logPath) {
  if (!logPath || !safeExists(logPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const matches = [...content.matchAll(/\[WorkbenchRunTrigger\] spawned pid=(\d+)/g)];
    const lastMatch = matches.at(-1);
    if (!lastMatch) {
      return null;
    }
    const pid = Number.parseInt(lastMatch[1], 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function readFailureFromRunLog(logPath) {
  if (!logPath || !safeExists(logPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const mainErrorMatches = [...content.matchAll(/ERROR \[Main\]\u001b\[0m 生成失败：([^\r\n]+)/g)];
    const directorErrorMatches = [...content.matchAll(/ERROR \[Director\]\u001b\[0m 任务失败：([^\r\n]+)/g)];
    const plainMainErrorMatches = [...content.matchAll(/\[Main\].*生成失败：([^\r\n]+)/g)];
    const plainDirectorErrorMatches = [...content.matchAll(/\[Director\].*任务失败：([^\r\n]+)/g)];
    const match = [
      ...mainErrorMatches,
      ...directorErrorMatches,
      ...plainMainErrorMatches,
      ...plainDirectorErrorMatches,
    ].at(-1);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

export function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function reconcileRunJobs(
  runJobs,
  {
    workspaceRoot,
    projectStoreBaseTempDir = path.join(workspaceRoot, 'temp'),
    isProcessAlive = defaultIsProcessAlive,
  } = {}
) {
  for (const runJob of Array.isArray(runJobs) ? runJobs : []) {
    if (!runJob || isTerminalRunStatus(runJob.status) || runJob.finishedAt) {
      continue;
    }

    const liveState = loadRunLiveState(runJob, { projectStoreBaseTempDir });
    if (liveState?.completedAt) {
      const finishedRun = finishRunJob(runJob, {
        status: 'completed',
        finishedAt: liveState.completedAt,
      }, { baseTempDir: projectStoreBaseTempDir });
      Object.assign(runJob, finishedRun);
      continue;
    }

    if (liveState?.failedAt || liveState?.lastError) {
      const failedRun = finishRunJob(runJob, {
        status: 'failed',
        finishedAt: liveState.failedAt || new Date().toISOString(),
        error: liveState.lastError || 'Run failed before terminal status was persisted',
      }, { baseTempDir: projectStoreBaseTempDir });
      Object.assign(runJob, failedRun);
      continue;
    }

    const runDir = resolveRunDir(runJob, workspaceRoot);
    const stateSnapshot = runDir ? readJsonSafe(path.join(runDir, 'state.snapshot.json')) : null;
    if (stateSnapshot?.completedAt) {
      const finishedRun = finishRunJob(runJob, {
        status: 'completed',
        finishedAt: stateSnapshot.completedAt,
      }, { baseTempDir: projectStoreBaseTempDir });
      Object.assign(runJob, finishedRun);
      continue;
    }

    if (stateSnapshot?.failedAt || stateSnapshot?.lastError) {
      const failedRun = finishRunJob(runJob, {
        status: 'failed',
        finishedAt: stateSnapshot.failedAt || new Date().toISOString(),
        error: stateSnapshot.lastError || 'Run failed before terminal status was persisted',
      }, { baseTempDir: projectStoreBaseTempDir });
      Object.assign(runJob, failedRun);
      continue;
    }

    const logPath = resolveRunJobLogPath(runJob, workspaceRoot);
    const logFailure = readFailureFromRunLog(logPath);
    if (logFailure) {
      const failedRun = finishRunJob(runJob, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: logFailure,
      }, { baseTempDir: projectStoreBaseTempDir });
      Object.assign(runJob, failedRun);
      continue;
    }

    const spawnedPid = readSpawnedPidFromRunLog(logPath);
    if (!spawnedPid || isProcessAlive(spawnedPid)) {
      continue;
    }

    const failedRun = finishRunJob(runJob, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: 'Run process exited before writing a terminal run state',
    }, { baseTempDir: projectStoreBaseTempDir });
    Object.assign(runJob, failedRun);
  }

  return runJobs;
}
