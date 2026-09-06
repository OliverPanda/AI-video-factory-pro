import fs from 'node:fs';
import path from 'node:path';

import { loadEpisode } from '../../utils/projectStore.js';
import { getEpisodeDir } from '../../utils/fileHelper.js';
import { sendJson } from './httpResponseHelpers.js';
import { sendVideoFile } from './videoResponses.js';
import { safeExists, resolvePathInside, createPathSecurityError } from './pathSecurity.js';
import {
  resolveTrustedAbsoluteFinalVideoPath,
  resolveRunDir,
  loadRunArtifactJson,
  buildReviewClips,
} from './reviewSupport.js';
import { loadRunLiveState } from './episodeHelpers.js';
import { resolveRunState } from '../dataSources/runStateResolver.js';
import { applyHumanReviewTaskAction, loadReviewArtifactsWithLiveFallback } from './humanReviewActions.js';
import { buildRuntimeControlPlaneView } from './runtimeControlPlaneView.js';
import { matchesRunLocator } from '../../utils/runKey.js';

function findRunJob(runJobs, locator) {
  return (Array.isArray(runJobs) ? runJobs : []).find((item) => matchesRunLocator(item, locator)) || null;
}

export async function handleRunReadRoutes(
  request,
  response,
  {
    pathname,
    workspaceRoot,
    projectStoreBaseTempDir,
    runJobs,
    derived,
    withRunLock,
    safeParseBody,
    writeJsonSafe,
  }
) {
  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch) {
    const run = findRunJob(runJobs, decodeURIComponent(runMatch[1]));
    if (!run) {
      sendJson(response, 404, { error: 'Run not found' });
      return true;
    }
    const resolvedRunState = resolveRunState(run, { workspaceRoot, projectStoreBaseTempDir });
    sendJson(response, 200, {
      ...run,
      qaOverview: derived.qaOverviewsByRunId[run.id] || null,
      artifacts: derived.artifactSummariesByRunId[run.id] || null,
      runState: resolvedRunState.runState || null,
      runtimeJournal: resolvedRunState.runtimeJournal || null,
      controlPlane: buildRuntimeControlPlaneView({
        run,
        runState: resolvedRunState.runState,
        runtimeJournal: resolvedRunState.runtimeJournal,
      }),
      debug: resolvedRunState.locator.debug,
    });
    return true;
  }

  const runReviewMatch = pathname.match(/^\/api\/runs\/([^/]+)\/review$/);
  if (runReviewMatch) {
    if ((request.method || 'GET') !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }

    const run = findRunJob(runJobs, decodeURIComponent(runReviewMatch[1]));
    if (!run) {
      sendJson(response, 404, { error: 'Run not found' });
      return true;
    }

    const { liveState, postComposeReview, editTaskPack, humanReviewQueue } =
      loadReviewArtifactsWithLiveFallback(run, workspaceRoot, { projectStoreBaseTempDir });
    sendJson(response, 200, {
      run: {
        id: run.id,
        runKey: run.runKey || null,
        projectId: run.projectId,
        scriptId: run.scriptId,
        episodeId: run.episodeId,
        scriptTitle: run.scriptTitle,
        episodeTitle: run.episodeTitle,
        status: liveState?.completedAt ? 'completed' : run.status,
        startedAt: run.startedAt,
        finishedAt: liveState?.completedAt || run.finishedAt,
      },
      qaOverview: derived.qaOverviewsByRunId[run.id] || null,
      postComposeReview: postComposeReview.data,
      editTaskPack: editTaskPack.data,
      humanReviewQueue: humanReviewQueue.data,
    });
    return true;
  }

  const runReviewClipsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/review\/clips$/);
  if (runReviewClipsMatch) {
    if ((request.method || 'GET') !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }

    const run = findRunJob(runJobs, decodeURIComponent(runReviewClipsMatch[1]));
    if (!run) {
      sendJson(response, 404, { error: 'Run not found' });
      return true;
    }

    const { liveState, snapshot } = resolveRunState(run, { workspaceRoot, projectStoreBaseTempDir });
    const { editTaskPack } = loadReviewArtifactsWithLiveFallback(run, workspaceRoot, {
      projectStoreBaseTempDir,
    });
    const episode = loadEpisode(run.projectId, run.scriptId, run.episodeId, {
      baseTempDir: projectStoreBaseTempDir,
    });
    sendJson(response, 200, {
      runId: run.id,
      runKey: run.runKey || null,
      clips: buildReviewClips({
        snapshot: snapshot || liveState,
        editTaskPack: editTaskPack.data,
        episode,
      }),
    });
    return true;
  }

  const runReviewTaskMatch = pathname.match(/^\/api\/runs\/([^/]+)\/review\/tasks\/([^/]+)$/);
  if (runReviewTaskMatch) {
    if ((request.method || 'GET') !== 'PUT') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }

    const runId = decodeURIComponent(runReviewTaskMatch[1]);
    await withRunLock(runId, async () => {
      const run = findRunJob(runJobs, runId);
      if (!run) {
        sendJson(response, 404, { error: 'Run not found' });
        return;
      }

      const editTaskPack = loadRunArtifactJson(run, workspaceRoot, 'edit-task-pack.json');
      if (!editTaskPack.data || !editTaskPack.filePath) {
        sendJson(response, 404, { error: 'Edit task pack not found' });
        return;
      }

      const body = await safeParseBody(request, response);
      if (body === null) return;
      const nextStatus = String(body.status || '').trim();
      const allowedStatuses = new Set(['approved', 'rejected', 'needs_changes', 'skipped', 'manual_review']);
      if (!allowedStatuses.has(nextStatus)) {
        sendJson(response, 400, { error: 'Invalid task review status' });
        return;
      }

      const taskId = runReviewTaskMatch[2];
      const actionResult = await applyHumanReviewTaskAction({
        run,
        taskId,
        nextStatus,
        workspaceRoot,
        projectStoreBaseTempDir,
        writeJsonSafe,
      });
      sendJson(response, actionResult.statusCode, actionResult.payload);
    });
    return true;
  }

  const runReviewVideoMatch = pathname.match(/^\/api\/runs\/([^/]+)\/review\/video$/);
  if (runReviewVideoMatch) {
    if ((request.method || 'GET') !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }

    const run = findRunJob(runJobs, decodeURIComponent(runReviewVideoMatch[1]));
    if (!run) {
      sendJson(response, 404, { error: 'Run not found' });
      return true;
    }

    const { runDir, liveState, snapshot } = resolveRunState(run, { workspaceRoot, projectStoreBaseTempDir });
    const { editTaskPack } = loadReviewArtifactsWithLiveFallback(run, workspaceRoot, {
      projectStoreBaseTempDir,
    });
    const finalVideoRefs = [
      editTaskPack.data?.finalVideoRef,
      snapshot?.outputPath,
      liveState?.outputPath,
      'output/final.mp4',
    ].filter(Boolean);
    if (!runDir) {
      sendJson(response, 404, { error: 'Run artifact directory not found' });
      return true;
    }

    let finalVideoPath = null;
    let invalidFinalVideoRef = null;
    for (const finalVideoRef of finalVideoRefs) {
      try {
        const candidatePath = path.isAbsolute(finalVideoRef)
          ? resolveTrustedAbsoluteFinalVideoPath(finalVideoRef, workspaceRoot)
          : resolvePathInside(runDir, finalVideoRef, 'run directory');
        if (path.isAbsolute(finalVideoRef) && !candidatePath) {
          invalidFinalVideoRef = {
            ref: finalVideoRef,
            error: createPathSecurityError(
              `Resolved path is outside run directory: ${finalVideoRef}`
            ),
          };
          continue;
        }
        if (candidatePath && safeExists(candidatePath)) {
          finalVideoPath = candidatePath;
          break;
        }
      } catch (err) {
        if (err?.code === 'PATH_OUTSIDE_ROOT') {
          const trustedPath = resolveTrustedAbsoluteFinalVideoPath(finalVideoRef, workspaceRoot);
          if (trustedPath && safeExists(trustedPath)) {
            finalVideoPath = trustedPath;
            break;
          }
          invalidFinalVideoRef = { ref: finalVideoRef, error: err };
        } else {
          throw err;
        }
      }
    }

    if (invalidFinalVideoRef) {
      sendJson(response, 400, {
        error:
          invalidFinalVideoRef.error?.message || 'Final video path is outside run directory',
      });
      return true;
    }

    if (!finalVideoPath) {
      const unsafeRef = finalVideoRefs.find((finalVideoRef) => {
        if (!path.isAbsolute(finalVideoRef)) return false;
        return !resolveTrustedAbsoluteFinalVideoPath(finalVideoRef, workspaceRoot);
      });
      if (unsafeRef) {
        try {
          resolvePathInside(runDir, unsafeRef, 'run directory');
        } catch (err) {
          sendJson(response, 400, {
            error: err.message || 'Final video path is outside run directory',
          });
          return true;
        }
      }
      sendJson(response, 404, { error: 'Final video not found' });
      return true;
    }

    sendVideoFile(response, finalVideoPath, request.headers || {});
    return true;
  }

  const runStreamMatch = pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
  if (runStreamMatch) {
    const runId = decodeURIComponent(runStreamMatch[1]);

    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }

    const run = findRunJob(runJobs, runId);
    if (!run) {
      sendJson(response, 404, { error: 'Run not found' });
      return true;
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const terminalStatuses = new Set(['completed', 'failed', 'error', 'blocked', 'cancelled']);
    const isTerminal = (status) => terminalStatuses.has(String(status || '').toLowerCase());

    function sendSseEvent(eventType, data) {
      try {
        response.write(`event: ${eventType}\n`);
        response.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {}
    }

    sendSseEvent('status', {
      id: run.id,
      status: run.status,
      scriptTitle: run.scriptTitle,
      episodeTitle: run.episodeTitle,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      error: run.error,
      agentTaskRuns: run.agentTaskRuns || [],
    });

    if (isTerminal(run.status)) {
      sendSseEvent('done', { id: run.id, status: run.status });
      response.end();
      return true;
    }

    const baseTempDir = path.join(workspaceRoot, 'temp');
    const episodeDir = getEpisodeDir(run.projectId, run.scriptId, run.episodeId, baseTempDir);
    const runJobFilePath = path.join(episodeDir, 'run-jobs', `${run.id}.json`);

    let watcher = null;
    let debounceTimer = null;
    let closed = false;

    function cleanup() {
      if (closed) return;
      closed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (watcher) {
        try {
          watcher.close();
        } catch {}
        watcher = null;
      }
    }

    function pushUpdate() {
      if (closed) return;
      const data = JSON.parse(fs.readFileSync(runJobFilePath, 'utf8'));
      if (!data) return;

      sendSseEvent('status', {
        id: data.id,
        status: data.status,
        scriptTitle: data.scriptTitle,
        episodeTitle: data.episodeTitle,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        error: data.error,
        artifactRunDir: data.artifactRunDir,
        agentTaskRuns: data.agentTaskRuns || [],
      });

      if (isTerminal(data.status)) {
        sendSseEvent('done', { id: data.id, status: data.status });
        cleanup();
        response.end();
      }
    }

    if (safeExists(runJobFilePath)) {
      try {
        watcher = fs.watch(runJobFilePath, () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(pushUpdate, 300);
        });
      } catch {
        const fallbackInterval = setInterval(() => {
          if (closed) {
            clearInterval(fallbackInterval);
            return;
          }
          pushUpdate();
        }, 3000);
      }
    } else {
      const probeInterval = setInterval(() => {
        if (closed) {
          clearInterval(probeInterval);
          return;
        }
        if (safeExists(runJobFilePath)) {
          clearInterval(probeInterval);
          pushUpdate();
          try {
            watcher = fs.watch(runJobFilePath, () => {
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(pushUpdate, 300);
            });
          } catch {}
        }
      }, 2000);

      setTimeout(() => {
        clearInterval(probeInterval);
        if (!closed && !watcher) {
          sendSseEvent('error', { id: runId, message: 'Run job file never appeared' });
          cleanup();
          response.end();
        }
      }, 120000);
    }

    request.on('close', cleanup);
    request.on('error', cleanup);
    return true;
  }

  const runQaMatch = pathname.match(/^\/api\/runs\/([^/]+)\/qa$/);
  if (runQaMatch) {
    const run = findRunJob(runJobs, decodeURIComponent(runQaMatch[1]));
    const qa = run ? derived.qaOverviewsByRunId[run.id] : null;
    sendJson(response, qa ? 200 : 404, qa || { error: 'Run QA not found' });
    return true;
  }

  const runArtifactsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/artifacts$/);
  if (runArtifactsMatch) {
    const run = findRunJob(runJobs, decodeURIComponent(runArtifactsMatch[1]));
    const artifacts = run ? derived.artifactSummariesByRunId[run.id] : null;
    sendJson(response, artifacts ? 200 : 404, artifacts || { error: 'Run artifacts not found' });
    return true;
  }

  return false;
}

export default {
  handleRunReadRoutes,
};
