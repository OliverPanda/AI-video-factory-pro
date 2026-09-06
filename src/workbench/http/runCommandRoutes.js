import fs from 'node:fs';
import path from 'node:path';

import { createRunJob } from '../../utils/jobStore.js';
import { getEpisodeDir, getJobDir } from '../../utils/fileHelper.js';
import { sendJson } from './httpResponseHelpers.js';
import { removePathIfSafe } from './pathSecurity.js';
import { ensureRunnableScriptForRun } from './scriptRoutes.js';
import { applyHumanReviewTaskAction } from './humanReviewActions.js';
import { matchesRunLocator } from '../../utils/runKey.js';
import { invalidateRunJobCache } from '../../workbench/dataSources/runJobRepository.js';
import { invalidateRouteContextCache } from '../../workbench/dataSources/routeContextCache.js';

function appendTextLog(filePath, message) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${new Date().toISOString()} ${message}\n`, 'utf8');
}

function pickRuntimeEnvSnapshot(env = process.env) {
  return {
    IMAGE_API_BASE_URL: String(env.IMAGE_API_BASE_URL || '').trim(),
    REALISTIC_IMAGE_MODEL: String(env.REALISTIC_IMAGE_MODEL || '').trim(),
    IMAGE_EDIT_MODEL: String(env.IMAGE_EDIT_MODEL || '').trim(),
    PRIMARY_API_PROVIDER: String(env.PRIMARY_API_PROVIDER || '').trim(),
  };
}

function buildScriptParserTask({ runId, error, startedAt, finishedAt } = {}) {
  const message = String(error || '剧本解析失败，请检查是否包含【画面1】、场景、人物、动作、对白、时长。');
  return {
    id: `${runId || 'run'}_script_parser_failed`,
    step: 'script_parser',
    agent: 'Script Parser',
    status: 'failed',
    detail: '剧本解析失败',
    startedAt: startedAt || new Date().toISOString(),
    finishedAt: finishedAt || startedAt || new Date().toISOString(),
    error: message,
  };
}

function findLatestRunJob(runJobs, projectId, scriptId, episodeId) {
  const matches = runJobs.filter(
    (job) => job.projectId === projectId && job.scriptId === scriptId && job.episodeId === episodeId
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
  return matches[0];
}

function findRunJobById(runJobs, runId) {
  if (!runId) return null;
  return runJobs.find((job) => matchesRunLocator(job, runId)) || null;
}

function resolveRunLocatorFromBody(body = {}, runJobs = []) {
  const bodyProjectId = typeof body?.projectId === 'string' ? body.projectId : '';
  const bodyScriptId = typeof body?.scriptId === 'string' ? body.scriptId : '';
  const bodyEpisodeId = typeof body?.episodeId === 'string' ? body.episodeId : '';
  const bodyRunId = typeof body?.runId === 'string'
    ? body.runId
    : typeof body?.runKey === 'string'
      ? body.runKey
    : typeof body?.mode?.runId === 'string'
      ? body.mode.runId
      : typeof body?.mode?.runKey === 'string'
        ? body.mode.runKey
      : '';

  const runRef = findRunJobById(runJobs, bodyRunId);

  return {
    runRef,
    projectId: bodyProjectId || runRef?.projectId || '',
    scriptId: bodyScriptId || runRef?.scriptId || '',
    episodeId: bodyEpisodeId || runRef?.episodeId || '',
    runId: bodyRunId || runRef?.id || '',
  };
}

function normalizeRuntimeControlMode(mode = {}) {
  return {
    kind: typeof mode?.kind === 'string' ? mode.kind : '',
    runId: typeof mode?.runId === 'string' ? mode.runId : (typeof mode?.runKey === 'string' ? mode.runKey : ''),
    stage: typeof mode?.stage === 'string' ? mode.stage.trim().toLowerCase() : '',
  };
}

function createControlPlaneRunReference(targetRun, fallback = {}) {
  return {
    id: targetRun.id,
    projectId: targetRun.projectId || fallback.projectId,
    scriptId: targetRun.scriptId || fallback.scriptId,
    episodeId: targetRun.episodeId || fallback.episodeId,
    jobId: targetRun.jobId || targetRun.id,
    status: 'running',
    style: targetRun.style || fallback.style || null,
    scriptTitle: targetRun.scriptTitle || fallback.scriptTitle || null,
    episodeTitle: targetRun.episodeTitle || fallback.episodeTitle || null,
    startedAt: targetRun.startedAt || new Date().toISOString(),
    finishedAt: null,
    error: null,
    artifactRunDir: targetRun.artifactRunDir || null,
    artifactManifestPath: targetRun.artifactManifestPath || null,
    artifactTimelinePath: targetRun.artifactTimelinePath || null,
    agentTaskRuns: Array.isArray(targetRun.agentTaskRuns) ? targetRun.agentTaskRuns : [],
  };
}

async function runHumanReviewControlPlaneAction({
  mode,
  projectId,
  scriptId,
  episodeId,
  runJobs,
  workspaceRoot,
  baseTempDir,
  writeJsonSafe,
}) {
  const controlMode = normalizeRuntimeControlMode(mode);
  const targetRun = findRunJobById(runJobs, controlMode.runId) || findLatestRunJob(runJobs, projectId, scriptId, episodeId);
  if (!targetRun) {
    return {
      ok: false,
      statusCode: 404,
      payload: { error: 'Target run not found for human review action' },
    };
  }

  const taskId = typeof mode?.taskId === 'string' ? mode.taskId : '';
  const nextStatus = typeof mode?.status === 'string' ? mode.status.trim() : '';
  const allowedStatuses = new Set(['approved', 'rejected', 'needs_changes', 'skipped', 'manual_review']);
  if (!taskId) {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: 'mode.taskId is required for submit_review_action' },
    };
  }
  if (!allowedStatuses.has(nextStatus)) {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: 'Invalid review action status' },
    };
  }

  const result = await applyHumanReviewTaskAction({
    run: targetRun,
    taskId,
    nextStatus,
    workspaceRoot,
    projectStoreBaseTempDir: baseTempDir,
    writeJsonSafe,
  });

  return {
    ...result,
    payload: result.ok
      ? {
          ...result.payload,
          runId: targetRun.id,
          mode: 'submit_review_action',
          controlCommand: {
            kind: 'submit_review_action',
            runId: targetRun.id,
            taskId,
            status: nextStatus,
          },
        }
      : result.payload,
  };
}

function cleanLatestFailedRun({ latestRun, projectId, scriptId, episodeId, baseTempDir, workspaceRoot, debugLogPath }) {
  if (!latestRun) {
    appendTextLog(debugLogPath, '[WorkbenchRunRetry] no previous run found to clean');
    return { removed: [] };
  }

  const removed = [];
  const episodeDir = getEpisodeDir(projectId, scriptId, episodeId, baseTempDir);
  const runJobFilePath = path.join(episodeDir, 'run-jobs', `${latestRun.id}.json`);

  if (removePathIfSafe(runJobFilePath, workspaceRoot)) {
    removed.push(runJobFilePath);
  }
  if (latestRun.artifactRunDir && removePathIfSafe(latestRun.artifactRunDir, workspaceRoot)) {
    removed.push(latestRun.artifactRunDir);
  }
  if (latestRun.jobId) {
    const jobDir = getJobDir(latestRun.jobId, baseTempDir);
    if (removePathIfSafe(jobDir, workspaceRoot)) {
      removed.push(jobDir);
    }
  }

  appendTextLog(
    debugLogPath,
    `[WorkbenchRunRetry] cleaned latestRunId=${latestRun.id} latestJobId=${latestRun.jobId || ''} removed=${JSON.stringify(removed)}`
  );
  return { removed };
}

export async function handleRunCommandRoutes(
  request,
  response,
  {
    pathname,
    workspaceRoot,
    tempProjectsDir,
    runJobs,
    derived,
    spawnProcess,
    safeParseBody,
    writeJsonSafe,
  }
) {
  if (pathname !== '/api/runs') {
    return false;
  }

  const method = request.method || 'GET';
  if (method !== 'POST') {
    sendJson(
      response,
      200,
      runJobs.map((runJob) => ({
        id: runJob.id,
        runKey: runJob.runKey || null,
        projectId: runJob.projectId,
        scriptId: runJob.scriptId,
        episodeId: runJob.episodeId,
        scriptTitle: runJob.scriptTitle,
        episodeTitle: runJob.episodeTitle,
        status: derived.normalizeRunStatus(runJob, derived.qaOverviewsByRunId[runJob.id]),
        startedAt: runJob.startedAt,
        finishedAt: runJob.finishedAt,
        headline: derived.qaOverviewsByRunId[runJob.id]?.headline || '',
      }))
    );
    return true;
  }

  try {
    const body = await safeParseBody(request, response);
    if (body === null) return true;
    const locator = resolveRunLocatorFromBody(body, runJobs);
    const { projectId, scriptId, episodeId } = locator;
    const style = body.style;
    const mode = body.mode || (body.stopAt ? { kind: 'stop', stopAt: body.stopAt } : { kind: 'stop', stopAt: 'full' });

    if (!projectId || !scriptId || !episodeId) {
      sendJson(response, 400, { error: 'projectId, scriptId, episodeId are required, or provide a resolvable runId' });
      return true;
    }

    const baseTempDir = path.join(workspaceRoot, 'temp');

    if (mode.kind === 'submit_review_action') {
      const controlAction = await runHumanReviewControlPlaneAction({
        mode,
        projectId,
        scriptId,
        episodeId,
        runJobs,
        workspaceRoot,
        baseTempDir,
        writeJsonSafe,
      });
      sendJson(response, controlAction.statusCode, controlAction.payload);
      return true;
    }

    if (mode.kind === 'resume_runtime' || mode.kind === 'rerun_stage') {
      sendJson(response, 410, { error: 'Experimental runtime control plane has been removed (P2 单轨收敛)' });
      return true;
    }

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const runJobsDir = path.join(getEpisodeDir(projectId, scriptId, episodeId, baseTempDir), 'run-jobs');
    const debugLogPath = path.join(runJobsDir, `${runId}.log`);
    const requestedInputFormat = ['professional-script', 'raw-novel', 'auto'].includes(body.inputFormat)
      ? body.inputFormat
      : 'professional-script';
    const args = [
      'scripts/run.js',
      `--project=${projectId}`,
      `--script=${scriptId}`,
      `--episode=${episodeId}`,
      `--run-attempt-id=${runId}`,
      `--input-format=${requestedInputFormat}`,
    ];
    if (style) args.push(`--style=${style}`);

    let latestRun = null;
    if (mode.kind === 'retry') {
      latestRun = locator.runRef || findLatestRunJob(runJobs, projectId, scriptId, episodeId);
      cleanLatestFailedRun({
        latestRun,
        projectId,
        scriptId,
        episodeId,
        baseTempDir,
        workspaceRoot,
        debugLogPath,
      });
      invalidateRunJobCache();
      invalidateRouteContextCache();
      if (mode.stopAt && mode.stopAt !== 'full') {
        args.push(`--stop-at=${mode.stopAt}`);
      }
    } else if (mode.kind === 'continue') {
      args.push('--continue');
      latestRun = locator.runRef || findLatestRunJob(runJobs, projectId, scriptId, episodeId);
      if (latestRun?.jobId) {
        args.push(`--continue-job-id=${latestRun.jobId}`);
      }
      if (mode.stopAt === 'before_video') {
        args.push('--stop-at=before_video');
      }
    } else if (mode.stopAt && mode.stopAt !== 'full') {
      args.push(`--stop-at=${mode.stopAt}`);
    }

    const preflight = await ensureRunnableScriptForRun({
      projectId,
      scriptId,
      episodeId,
      tempProjectsDir,
      projectStoreBaseTempDir: baseTempDir,
      inputFormat: requestedInputFormat,
    });
    if (!preflight.episode) {
      sendJson(response, 404, { error: 'Episode not found. Please re-upload the script.' });
      return true;
    }

    if (!preflight.parseOk) {
      const now = new Date().toISOString();
      const error = preflight.parseError || '剧本解析失败，当前分集没有可运行分镜。';
      appendTextLog(
        debugLogPath,
        `[WorkbenchRunPreflight] project=${projectId} script=${scriptId} episode=${episodeId} parseOk=false shotCount=${preflight.shotCount} error=${error}`
      );
      createRunJob({
        id: runId,
        projectId,
        scriptId,
        episodeId,
        status: 'failed',
        style: style || null,
        scriptTitle: preflight.entry?.title || preflight.script?.title || scriptId,
        episodeTitle: preflight.episode?.title || episodeId,
        startedAt: now,
        finishedAt: now,
        error,
        debugLogPath,
        agentTaskRuns: [
          buildScriptParserTask({
            runId,
            error,
            startedAt: now,
            finishedAt: now,
          }),
        ],
      }, { baseTempDir });
      invalidateRunJobCache();
      invalidateRouteContextCache();
      sendJson(response, 200, {
        success: false,
        runId,
        status: 'failed',
        error,
        debugLogPath,
        message: 'Script parser preflight failed',
      });
      return true;
    }

    appendTextLog(
      debugLogPath,
      `[WorkbenchRunTrigger] project=${projectId} script=${scriptId} episode=${episodeId} mode=${JSON.stringify(mode)} style=${style || ''} shotCount=${preflight.shotCount} latestRunId=${latestRun?.id || ''} continueJobId=${latestRun?.jobId || ''} args=${JSON.stringify(args)}`
    );
    appendTextLog(
      debugLogPath,
      `[WorkbenchRunEnv] parent=${JSON.stringify(pickRuntimeEnvSnapshot(process.env))}`
    );

    try {
      createRunJob({
        id: runId,
        projectId,
        scriptId,
        episodeId,
        status: 'pending',
        style: style || null,
        scriptTitle: preflight.entry?.title || preflight.script?.title || scriptId,
        episodeTitle: preflight.episode?.title || episodeId,
        startedAt: new Date().toISOString(),
        debugLogPath,
      }, { baseTempDir });
      invalidateRunJobCache();
      invalidateRouteContextCache();
    } catch (preRegErr) {
      appendTextLog(debugLogPath, `[WorkbenchRunTrigger] preregister failed: ${preRegErr.message}`);
    }

    const stdoutFd = fs.openSync(debugLogPath, 'a');
    const stderrFd = fs.openSync(debugLogPath, 'a');
    try {
      const childEnv = {
        ...process.env,
      };
      const child = spawnProcess('node', args, {
        detached: true,
        stdio: ['ignore', stdoutFd, stderrFd],
        cwd: process.cwd(),
        env: childEnv,
      });
      child.unref();
      appendTextLog(
        debugLogPath,
        `[WorkbenchRunTrigger] spawned pid=${child.pid || 'unknown'} childEnv=${JSON.stringify(pickRuntimeEnvSnapshot(childEnv))}`
      );
    } finally {
      fs.closeSync(stdoutFd);
      fs.closeSync(stderrFd);
    }

    sendJson(response, 200, {
      success: true,
      runId,
      debugLogPath,
      message: 'Pipeline triggered',
    });
    return true;
  } catch (err) {
    if (err?.code === 'PATH_OUTSIDE_ROOT') {
      sendJson(response, 400, { error: err.message || 'Unsafe path outside workspace' });
      return true;
    }
    sendJson(response, 500, { error: `Failed to trigger run: ${err.message}` });
    return true;
  }
}
