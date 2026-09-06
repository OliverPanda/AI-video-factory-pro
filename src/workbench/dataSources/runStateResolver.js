import fs from 'node:fs';
import path from 'node:path';

import { getEpisodeDir } from '../../utils/fileHelper.js';
import { normalizeRuntimeJournal } from '../../runtime/schemas/runtimeJournal.js';
import { normalizeRunState } from '../../runtime/schemas/runState.js';
import { findArtifactFileByName, resolveRunDir } from '../http/reviewSupport.js';
import { loadRunLiveState } from '../http/episodeHelpers.js';

const CACHE_TTL_MS = Number(process.env.WORKBENCH_CACHE_TTL_MS || 5000);
const _stateCache = new Map();

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function createRunArtifactLocator(runJob, { workspaceRoot, projectStoreBaseTempDir } = {}) {
  const artifactRunDir = resolveRunDir(runJob, workspaceRoot);
  const episodeDir = runJob?.projectId && runJob?.scriptId && runJob?.episodeId
    ? getEpisodeDir(runJob.projectId, runJob.scriptId, runJob.episodeId, projectStoreBaseTempDir)
    : null;
  const snapshotPath = artifactRunDir ? findArtifactFileByName(artifactRunDir, 'state.snapshot.json') : null;
  const runtimeJournalPath = artifactRunDir ? findArtifactFileByName(artifactRunDir, 'runtime-journal.json') : null;
  const runJobPath = episodeDir && runJob?.id ? path.join(episodeDir, 'run-jobs', `${runJob.id}.json`) : null;
  const liveStatePath = episodeDir && runJob?.jobId ? path.join(projectStoreBaseTempDir, runJob.jobId, 'state.json') : null;

  return {
    runJob,
    runJobPath,
    artifactRunDir,
    snapshotPath,
    runtimeJournalPath,
    liveStatePath,
    episodeDir,
    debug: {
      runJobMissing: !runJob,
      artifactRunDirMissing: !artifactRunDir,
      snapshotMissing: !snapshotPath,
      runtimeJournalMissing: !runtimeJournalPath,
      liveStateMissing: !liveStatePath || !fs.existsSync(liveStatePath),
    },
  };
}

export function resolveRunState(runJob, { workspaceRoot, projectStoreBaseTempDir } = {}) {
  const cacheKey = `${runJob?.id || ''}:${runJob?.jobId || ''}`;
  const now = Date.now();
  const cached = _stateCache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }

  const locator = createRunArtifactLocator(runJob, { workspaceRoot, projectStoreBaseTempDir });
  const snapshot = locator.snapshotPath ? readJsonSafe(locator.snapshotPath) : null;
  const runtimeJournal = snapshot?.runState?.runtimeJournal
    ? normalizeRuntimeJournal(snapshot.runState.runtimeJournal)
    : (locator.runtimeJournalPath ? normalizeRuntimeJournal(readJsonSafe(locator.runtimeJournalPath)) : null);
  const runState = snapshot
    ? normalizeRunState({
        snapshot,
        runtimeJournal,
        runId: runJob?.id,
        jobId: runJob?.jobId,
        projectId: runJob?.projectId,
        scriptId: runJob?.scriptId,
        episodeId: runJob?.episodeId,
        status: runJob?.status,
        startedAt: runJob?.startedAt,
        completedAt: runJob?.finishedAt,
      })
    : null;
  const liveState = runJob ? loadRunLiveState(runJob, { projectStoreBaseTempDir }) : null;
  const result = {
    locator,
    snapshot,
    runState,
    runtimeJournal,
    liveState,
    runDir: locator.artifactRunDir,
  };

  _stateCache.set(cacheKey, { value: result, ts: now });
  if (_stateCache.size > 500) {
    const oldest = _stateCache.keys().next().value;
    _stateCache.delete(oldest);
  }

  return result;
}

export default {
  createRunArtifactLocator,
  resolveRunState,
};
