import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createLegacyWorkbenchServer } from './legacyServer.js';
import { listRunJobs } from '../../workbench/dataSources/runJobRepository.js';
import { loadQaOverview } from '../../workbench/dataSources/qaOverviewRepository.js';
import { getArtifactDirectorySummary } from '../../workbench/dataSources/runArtifactRepository.js';
import { buildWorkbenchViewModel } from '../../workbench/transformers/workbenchViewModel.js';
import { defaultIsProcessAlive, reconcileRunJobs } from '../../workbench/http/runJobReconciler.js';
import { professionalizeScriptContent } from '../../workbench/http/scriptHelpers.js';
import { resolveRunState } from '../../workbench/dataSources/runStateResolver.js';
import { buildRuntimeControlPlaneView } from '../../workbench/http/runtimeControlPlaneView.js';
import { loadEpisode } from '../../utils/projectStore.js';
import { chat as llmChat } from '../../llm/client.js';
import {
  buildReviewClips,
  loadRunArtifactJson,
  resolveTrustedAbsoluteFinalVideoPath,
} from '../../workbench/http/reviewSupport.js';
import { resolvePathInside, safeExists, createPathSecurityError } from '../../workbench/http/pathSecurity.js';
import { sendVideoFile } from '../../workbench/http/videoResponses.js';
import { matchesRunLocator } from '../../utils/runKey.js';
import { buildLogsOverview, buildProjectRunOptions } from '../../billing/logAggregation.js';
import { syncGatewayLedger } from '../../billing/gatewaySync/syncGatewayLedger.js';
import { startGatewaySyncScheduler } from '../../billing/gatewaySync/gatewaySyncScheduler.js';
import { getCachedRouteContext, setCachedRouteContext, invalidateRouteContextCache } from '../../workbench/dataSources/routeContextCache.js';

function resolveGatewaySyncRuntimeConfig() {
  const gatewayBaseUrl = process.env.GATEWAY_SYNC_BASE_URL || process.env.IMAGE_API_BASE_URL || '';
  const gatewayApiKey = process.env.GATEWAY_SYNC_API_KEY || process.env.IMAGE_API_KEY || '';
  const gatewayPath = process.env.GATEWAY_SYNC_PATH || '/usage';
  const gatewayFamily = process.env.GATEWAY_SYNC_FAMILY || 'auto';
  return {
    gatewayFamily,
    gatewayBaseUrl,
    gatewayApiKey,
    gatewayPath,
  };
}

function findRunJob(runJobs, locator) {
  return (Array.isArray(runJobs) ? runJobs : []).find((item) => matchesRunLocator(item, locator)) || null;
}

function normalizeMethod(method) {
  return String(method || 'GET').toUpperCase();
}

function hasPathTraversalSegment(rawUrl = '') {
  const rawPath = String(rawUrl || '').split('?')[0];
  const candidates = new Set([rawPath]);
  try {
    candidates.add(decodeURIComponent(rawPath));
  } catch {}
  for (const candidate of candidates) {
    if (candidate.split(/[\\/]+/).includes('..')) {
      return true;
    }
  }
  return false;
}

function shouldProtectWithWorkbenchToken(method) {
  return ['POST', 'PUT', 'DELETE', 'PATCH'].includes(normalizeMethod(method));
}

function normalizeRunStatus(runJob, qaOverview) {
  const status = String(runJob?.status || '').toLowerCase();
  if (qaOverview?.blockCount > 0) return 'block';
  if (qaOverview?.warnCount > 0) return 'warn';
  if (status === 'completed') return 'pass';
  if (status === 'failed' || status === 'error' || status === 'blocked') return 'block';
  return 'running';
}

function resolveProjectStoreBaseTempDir(tempProjectsDir, workspaceRoot) {
  const absolute = path.resolve(tempProjectsDir || path.join(workspaceRoot, 'temp', 'projects'));
  return path.basename(absolute) === 'projects' ? path.dirname(absolute) : absolute;
}

function buildRunErrorQaFallback(runJob) {
  if (!runJob?.error) return null;
  const error = String(runJob.error);
  const summary = `剧本解析失败：${error}。请在剧本管理中使用一键优化，或补齐【画面N】、场景、人物、动作、对白、时长后再运行。`;
  return {
    status: 'block',
    releasable: false,
    headline: error.includes('professional-script') || error.includes('【画面')
      ? '剧本解析失败'
      : '运行启动失败',
    summary,
    passCount: 0,
    warnCount: 0,
    blockCount: 1,
    agentSummaries: [
      {
        agentKey: 'scriptParser',
        agentName: 'Script Parser',
        status: 'block',
        headline: '剧本解析失败',
        summary,
        passItems: [],
        warnItems: [],
        blockItems: [error],
        nextAction: '回到剧本管理，使用一键优化或按专业剧本格式补齐画面字段。',
      },
    ],
    topIssues: [
      {
        title: '剧本解析失败',
        summary: error,
        agentKey: 'scriptParser',
        status: 'block',
      },
    ],
    runDebug: {
      fallback: true,
      source: 'run.error',
      runId: runJob.id,
    },
  };
}

function shouldUseRunErrorQaFallback(qaOverview, runJob) {
  if (!runJob?.error) return false;
  if (!runJob?.artifactRunDir) return true;
  const hasRealQaSignal = Boolean(
    qaOverview?.headline ||
    qaOverview?.summary ||
    qaOverview?.agentSummaries?.length ||
    qaOverview?.topIssues?.length ||
    Number(qaOverview?.passCount || 0) > 0 ||
    Number(qaOverview?.warnCount || 0) > 0 ||
    Number(qaOverview?.blockCount || 0) > 0
  );
  return !hasRealQaSignal;
}

function buildDerivedData(runJobs, workspaceRoot) {
  const qaOverviewsByRunId = {};
  const artifactSummariesByRunId = {};

  for (const runJob of runJobs) {
    const loadedQaOverview = loadQaOverview(runJob, { workspaceRoot });
    qaOverviewsByRunId[runJob.id] = shouldUseRunErrorQaFallback(loadedQaOverview, runJob)
      ? buildRunErrorQaFallback(runJob)
      : loadedQaOverview;
    artifactSummariesByRunId[runJob.id] = getArtifactDirectorySummary(runJob, { workspaceRoot });
  }

  return {
    qaOverviewsByRunId,
    artifactSummariesByRunId,
  };
}

function loadReviewArtifactsWithLiveFallback(runJob, workspaceRoot, { projectStoreBaseTempDir }) {
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

function getRouteContext({ workspaceRoot, tempProjectsDir, isProcessAlive }) {
  const projectStoreBaseTempDir = resolveProjectStoreBaseTempDir(tempProjectsDir, workspaceRoot);
  const cacheKey = tempProjectsDir;
  const cached = getCachedRouteContext(cacheKey);
  if (cached) return cached;

  const runJobs = reconcileRunJobs(listRunJobs({ tempProjectsDir }), {
    workspaceRoot,
    projectStoreBaseTempDir,
    isProcessAlive,
  });
  const derived = buildDerivedData(runJobs, workspaceRoot);
  const result = {
    projectStoreBaseTempDir,
    runJobs,
    derived,
  };
  setCachedRouteContext(cacheKey, result);
  return result;
}

async function sendNodeResponse(reply, response) {
  if (reply.sent) {
    return;
  }
  const statusCode = response.statusCode || 200;
  const headers = response.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      reply.header(key, value);
    }
  }
  reply.code(statusCode).send(response.body);
}

async function executeLegacyHandler(legacyServer, request, reply) {
  const syntheticRequest = createLegacyRequest(request);
  const response = await new Promise((resolve, reject) => {
    let resolved = false;
    const rawReply = reply.raw;
    const responseEvents = new EventEmitter();
    const flushHeaders = () => {
      if (!resolved) {
        resolved = true;
        rawReply.statusCode = mockResponse.statusCode;
        for (const [key, value] of Object.entries(mockResponse.headers)) {
          if (value !== undefined) {
            rawReply.setHeader(key, value);
          }
        }
      }
      return rawReply;
    };
    const shouldStreamResponse = () => {
      const contentType = String(mockResponse.headers['Content-Type'] || mockResponse.headers['content-type'] || '');
      return contentType.includes('text/event-stream') || mockResponse.streaming === true;
    };
    const mockResponse = {
      statusCode: 200,
      headers: {},
      bodyChunks: [],
      finished: false,
      streaming: false,
      writeHead(statusCode, headers = {}) {
        this.statusCode = statusCode;
        this.headers = { ...this.headers, ...headers };
        if (shouldStreamResponse()) {
          flushHeaders();
        }
      },
      setHeader(key, value) {
        this.headers[key] = value;
        if (shouldStreamResponse()) {
          flushHeaders();
        }
      },
      getHeader(key) {
        return this.headers[key];
      },
      on(event, handler) {
        responseEvents.on(event, handler);
        return this;
      },
      once(event, handler) {
        responseEvents.once(event, handler);
        return this;
      },
      emit(event, ...args) {
        return responseEvents.emit(event, ...args);
      },
      removeListener(event, handler) {
        responseEvents.removeListener(event, handler);
        return this;
      },
      write(chunk) {
        if (shouldStreamResponse()) {
          this.streaming = true;
          const writable = flushHeaders();
          if (chunk !== undefined && chunk !== null) {
            writable.write(chunk);
          }
          this.emit('drain');
          return true;
        }
        if (chunk !== undefined && chunk !== null) {
          this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        this.emit('drain');
        return true;
      },
      end(chunk) {
        if (shouldStreamResponse()) {
          this.streaming = true;
          const writable = flushHeaders();
          if (chunk !== undefined && chunk !== null) {
            writable.write(chunk);
          }
          this.finished = true;
          writable.end();
          this.emit('finish');
          this.emit('close');
          resolve(null);
          return;
        }
        if (chunk !== undefined && chunk !== null) {
          this.write(chunk);
        }
        this.finished = true;
        this.emit('finish');
        this.emit('close');
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(this.bodyChunks),
        });
      },
    };

    try {
      legacyServer.emit('request', syntheticRequest, mockResponse);
    } catch (error) {
      reject(error);
    }
  });

  if (response === null) {
    return;
  }
  await sendNodeResponse(reply, response);
}

function createLegacyRequest(request) {
  const syntheticRequest = new PassThrough();
  syntheticRequest.method = request.raw.method;
  syntheticRequest.url = request.raw.url;
  syntheticRequest.headers = { ...request.raw.headers };
  syntheticRequest.httpVersion = request.raw.httpVersion;
  syntheticRequest.socket = request.raw.socket;
  syntheticRequest.connection = request.raw.connection;

  const rawBody = request.raw?.body;
  if (Buffer.isBuffer(rawBody) || typeof rawBody === 'string') {
    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    syntheticRequest.headers['content-length'] = String(bodyBuffer.length);
    process.nextTick(() => {
      syntheticRequest.write(bodyBuffer);
      syntheticRequest.end();
    });
    return syntheticRequest;
  }

  if (request.body !== undefined && request.body !== null) {
    const contentType = String(syntheticRequest.headers['content-type'] || '');
    let bodyBuffer = null;
    if (Buffer.isBuffer(request.body)) {
      bodyBuffer = request.body;
    } else if (typeof request.body === 'string') {
      bodyBuffer = Buffer.from(request.body);
    } else if (contentType.includes('application/json')) {
      bodyBuffer = Buffer.from(JSON.stringify(request.body));
    }
    if (bodyBuffer) {
      syntheticRequest.headers['content-length'] = String(bodyBuffer.length);
      process.nextTick(() => {
        syntheticRequest.write(bodyBuffer);
        syntheticRequest.end();
      });
      return syntheticRequest;
    }
  }

  process.nextTick(() => syntheticRequest.end());
  return syntheticRequest;
}

export function createWorkbenchServer({
  workspaceRoot,
  tempProjectsDir,
  spawnProcess,
  isProcessAlive,
  scriptProfessionalizeChat = llmChat,
} = {}) {
  const resolvedTempProjectsDir = tempProjectsDir || path.join(workspaceRoot, 'temp', 'projects');
  const app = Fastify({ logger: false });
  const scheduler = startGatewaySyncScheduler({
    workspaceRoot,
    tempProjectsDir: resolvedTempProjectsDir,
    logger: console,
  });
  app.addHook('onClose', async () => {
    scheduler.stop();
  });
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      request.raw.body = body;
      try {
        done(null, body ? JSON.parse(body) : {});
      } catch (error) {
        done(error, undefined);
      }
    }
  );
  const legacyServer = createLegacyWorkbenchServer({
    workspaceRoot,
    tempProjectsDir: resolvedTempProjectsDir,
    spawnProcess,
    isProcessAlive,
    scriptProfessionalizeChat,
  });

  app.addHook('onRequest', async (request, reply) => {
    const workbenchToken = process.env.WORKBENCH_TOKEN;
    if (!workbenchToken || !shouldProtectWithWorkbenchToken(request.method)) {
      return;
    }
    const authHeader = request.headers.authorization || '';
    if (authHeader !== `Bearer ${workbenchToken}`) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/api/runs/:runId', async (request, reply) => {
    try {
      const { runJobs, derived, projectStoreBaseTempDir } = getRouteContext({
        workspaceRoot,
        tempProjectsDir: resolvedTempProjectsDir,
        isProcessAlive,
      });
      const run = findRunJob(runJobs, request.params.runId);
      if (!run) {
        reply.code(404).send({ error: 'Run not found' });
        return;
      }
      const resolvedRunState = resolveRunState(run, { workspaceRoot, projectStoreBaseTempDir });
      reply.send({
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
    } catch (err) {
      reply.code(500).send({ error: err?.message || 'Internal server error' });
    }
  });

  app.get('/api/runs/:runId/review', async (request, reply) => {
    const { runJobs, derived, projectStoreBaseTempDir } = getRouteContext({
      workspaceRoot,
      tempProjectsDir: resolvedTempProjectsDir,
      isProcessAlive,
    });
    const run = findRunJob(runJobs, request.params.runId);
    if (!run) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const { liveState, postComposeReview, editTaskPack, humanReviewQueue } =
      loadReviewArtifactsWithLiveFallback(run, workspaceRoot, { projectStoreBaseTempDir });
    reply.send({
      run: {
        id: run.id,
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
  });

  app.get('/api/runs/:runId/review/clips', async (request, reply) => {
    const { runJobs, projectStoreBaseTempDir } = getRouteContext({
      workspaceRoot,
      tempProjectsDir: resolvedTempProjectsDir,
      isProcessAlive,
    });
    const run = findRunJob(runJobs, request.params.runId);
    if (!run) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const { liveState, snapshot } = resolveRunState(run, { workspaceRoot, projectStoreBaseTempDir });
    const { editTaskPack } = loadReviewArtifactsWithLiveFallback(run, workspaceRoot, {
      projectStoreBaseTempDir,
    });
    const episode = loadEpisode(run.projectId, run.scriptId, run.episodeId, {
      baseTempDir: projectStoreBaseTempDir,
    });
    reply.send({
      runId: run.id,
      clips: buildReviewClips({
        snapshot: snapshot || liveState,
        editTaskPack: editTaskPack.data,
        episode,
      }),
    });
  });

  app.get('/api/logs', async (request, reply) => {
    const { runJobs, projectStoreBaseTempDir } = getRouteContext({
      workspaceRoot,
      tempProjectsDir: resolvedTempProjectsDir,
      isProcessAlive,
    });
    const projectId = String(request.query.projectId || '').trim();
      const runId = typeof request.query.runId === 'string' && request.query.runId.trim()
        ? request.query.runId.trim()
        : null;

      reply.send(buildLogsOverview({
        runJobs,
      workspaceRoot,
      projectStoreBaseTempDir,
      projectId,
      runId,
    }));
  });

  app.get('/api/logs/runs', async (request, reply) => {
    const { runJobs } = getRouteContext({
      workspaceRoot,
      tempProjectsDir: resolvedTempProjectsDir,
      isProcessAlive,
    });
    const projectId = String(request.query.projectId || '').trim();
    reply.send(projectId ? buildProjectRunOptions(runJobs, projectId) : []);
  });

  app.post('/api/logs/sync', async (request, reply) => {
    const { runJobs } = getRouteContext({
      workspaceRoot,
      tempProjectsDir: resolvedTempProjectsDir,
      isProcessAlive,
    });
    const projectId = String(request.body?.projectId || '').trim();
    const runId = typeof request.body?.runId === 'string' && request.body.runId.trim()
      ? request.body.runId.trim()
      : null;

      try {
      const gatewayConfig = resolveGatewaySyncRuntimeConfig();
      reply.send(await syncGatewayLedger({
        runJobs,
        projectId,
        runId,
        gatewayFamily: gatewayConfig.gatewayFamily,
        gatewayBaseUrl: gatewayConfig.gatewayBaseUrl,
        gatewayApiKey: gatewayConfig.gatewayApiKey,
        gatewayPath: gatewayConfig.gatewayPath,
      }));
    } catch (error) {
      const details = error?.details && typeof error.details === 'object' ? error.details : null;
      const attemptedUrl = details?.attemptedUrl || null;
      reply.code(500).send({
        error: error?.message || 'gateway_sync_failed',
        code: error?.code || 'gateway_sync_failed',
        attemptedUrl,
        hint: details?.hint || deriveGatewaySyncHint(
          process.env.GATEWAY_SYNC_BASE_URL || process.env.IMAGE_API_BASE_URL || '',
          attemptedUrl,
          process.env.GATEWAY_SYNC_PATH || '/usage'
        ),
      });
    }
  });

  app.get('/api/runs/:runId/review/video', async (request, reply) => {
    const { runJobs, projectStoreBaseTempDir } = getRouteContext({
      workspaceRoot,
      tempProjectsDir: resolvedTempProjectsDir,
      isProcessAlive,
    });
    const run = findRunJob(runJobs, request.params.runId);
    if (!run) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }

    const { runDir, liveState, snapshot } = resolveRunState(run, { workspaceRoot, projectStoreBaseTempDir });
    const { editTaskPack } = loadReviewArtifactsWithLiveFallback(run, workspaceRoot, { projectStoreBaseTempDir });
    const finalVideoRefs = [
      editTaskPack.data?.finalVideoRef,
      snapshot?.outputPath,
      liveState?.outputPath,
      'output/final.mp4',
    ].filter(Boolean);

    if (!runDir) {
      reply.code(404).send({ error: 'Run artifact directory not found' });
      return;
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
            error: createPathSecurityError(`Resolved path is outside run directory: ${finalVideoRef}`),
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
      reply.code(400).send({
        error: invalidFinalVideoRef.error?.message || 'Final video path is outside run directory',
      });
      return;
    }

    if (!finalVideoPath) {
      reply.code(404).send({ error: 'Final video not found' });
      return;
    }

    reply.hijack();
    await new Promise((resolve) => {
      sendVideoFile(reply.raw, finalVideoPath, request.headers || {});
      reply.raw.once('finish', resolve);
    });
  });

  app.get('/api/runs/:runId/artifacts/file', async (request, reply) => {
    const { runJobs, projectStoreBaseTempDir } = getRouteContext({
      workspaceRoot,
      tempProjectsDir: resolvedTempProjectsDir,
      isProcessAlive,
    });
    const run = findRunJob(runJobs, request.params.runId);
    if (!run) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const relativePath = String(request.query?.path || '').trim();
    if (!relativePath) {
      reply.code(400).send({ error: 'Missing artifact path' });
      return;
    }
    const { runDir } = resolveRunState(run, { workspaceRoot, projectStoreBaseTempDir });
    if (!runDir) {
      reply.code(404).send({ error: 'Run artifact directory not found' });
      return;
    }
    let filePath = null;
    try {
      filePath = resolvePathInside(runDir, relativePath, 'run directory');
    } catch (err) {
      reply.code(400).send({ error: err?.message || 'Invalid artifact path' });
      return;
    }
    if (!safeExists(filePath) || fs.statSync(filePath).isDirectory()) {
      reply.code(404).send({ error: 'Artifact file not found' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') {
      const raw = fs.readFileSync(filePath, 'utf8');
      reply.header('Content-Type', 'application/json; charset=utf-8').send(raw);
      return;
    }
    reply.hijack();
    fs.createReadStream(filePath).pipe(reply.raw);
  });

  app.post('/api/scripts/professionalize', async (request, reply) => {
    try {
      const body = request.body || {};
      const optimized = await professionalizeScriptContent({
        title: body.title,
        content: body.content,
        workspaceRoot,
        chatText: scriptProfessionalizeChat,
      });
      reply.send({
        content: optimized.content,
        charCount: optimized.content.length,
        source: optimized.source,
        cached: optimized.cached === true,
        parseOk: true,
      });
    } catch (err) {
      reply.code(400).send({ error: err.message || '剧本优化失败' });
    }
  });

  app.all('/*', async (request, reply) => {
    if (hasPathTraversalSegment(request.raw?.url || request.url)) {
      reply.code(400).send({ error: 'Invalid path' });
      return;
    }
    await executeLegacyHandler(legacyServer, request, reply);
  });

  return {
    listen(port, host, callback) {
      const done = typeof host === 'function' ? host : callback;
      const listenHost = typeof host === 'string' ? host : undefined;
      const promise = app.listen({ port, host: listenHost });
      if (typeof done === 'function') {
        promise.then(
          (address) => done(null, address),
          (error) => done(error)
        );
      }
      return promise;
    },
    close(callback) {
      const promise = app.close();
      if (typeof callback === 'function') {
        promise.then(
          () => callback(null),
          (error) => callback(error)
        );
      }
      return promise;
    },
    address() {
      return app.server.address();
    },
    get raw() {
      return app.server;
    },
  };
}

export default {
  createWorkbenchServer,
};
