import path from 'node:path';
import { getEpisodeDir, loadJSON, saveJSON } from './fileHelper.js';

function resolveBaseTempDir(options = {}) {
  return options.baseTempDir;
}

function validateId(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return value;
}

function getRunJobFilePath(projectId, scriptId, episodeId, runJobId, options = {}) {
  return path.join(
    getEpisodeDir(
      validateId(projectId, 'projectId'),
      validateId(scriptId, 'scriptId'),
      validateId(episodeId, 'episodeId'),
      resolveBaseTempDir(options)
    ),
    'run-jobs',
    `${validateId(runJobId, 'runJob.id')}.json`
  );
}

function readRunJob(projectId, scriptId, episodeId, runJobId, options = {}) {
  return loadJSON(getRunJobFilePath(projectId, scriptId, episodeId, runJobId, options));
}

function writeRunJob(runJob, options = {}) {
  saveJSON(
    getRunJobFilePath(runJob.projectId, runJob.scriptId, runJob.episodeId, runJob.id, options),
    runJob
  );
  return runJob;
}

export function createRunJob(input, options = {}) {
  const runJob = {
    id: validateId(input?.id, 'runJob.id'),
    projectId: validateId(input?.projectId, 'runJob.projectId'),
    scriptId: validateId(input?.scriptId, 'runJob.scriptId'),
    episodeId: validateId(input?.episodeId, 'runJob.episodeId'),
    jobId: validateId(input?.jobId || input?.id, 'runJob.jobId'),
    status: input?.status || 'running',
    style: input?.style || null,
    scriptTitle: input?.scriptTitle || null,
    episodeTitle: input?.episodeTitle || null,
    startedAt: input?.startedAt || new Date().toISOString(),
    finishedAt: input?.finishedAt || null,
    error: input?.error || null,
    agentTaskRuns: Array.isArray(input?.agentTaskRuns) ? input.agentTaskRuns : [],
  };

  return writeRunJob(runJob, options);
}

export function appendAgentTaskRun(runJobRef, taskRunInput, options = {}) {
  const runJob = readRunJob(
    runJobRef?.projectId,
    runJobRef?.scriptId,
    runJobRef?.episodeId,
    runJobRef?.id,
    options
  );
  if (!runJob) {
    throw new Error(`RunJob not found: ${runJobRef?.id || 'unknown'}`);
  }

  runJob.agentTaskRuns = [
    ...(runJob.agentTaskRuns || []),
    {
      id: validateId(taskRunInput?.id, 'agentTaskRun.id'),
      step: validateId(taskRunInput?.step, 'agentTaskRun.step'),
      agent: taskRunInput?.agent || null,
      status: taskRunInput?.status || 'completed',
      detail: taskRunInput?.detail || null,
      startedAt: taskRunInput?.startedAt || new Date().toISOString(),
      finishedAt:
        taskRunInput?.finishedAt || taskRunInput?.startedAt || new Date().toISOString(),
      error: taskRunInput?.error || null,
    },
  ];

  return writeRunJob(runJob, options);
}

export function finishRunJob(runJobRef, finishInput = {}, options = {}) {
  const runJob = readRunJob(
    runJobRef?.projectId,
    runJobRef?.scriptId,
    runJobRef?.episodeId,
    runJobRef?.id,
    options
  );
  if (!runJob) {
    throw new Error(`RunJob not found: ${runJobRef?.id || 'unknown'}`);
  }

  runJob.status = finishInput.status || 'completed';
  runJob.finishedAt = finishInput.finishedAt || new Date().toISOString();
  runJob.error = finishInput.error || null;

  return writeRunJob(runJob, options);
}

export default {
  createRunJob,
  finishRunJob,
  appendAgentTaskRun,
};
