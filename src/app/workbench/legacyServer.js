import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

import { listRunJobs } from '../../workbench/dataSources/runJobRepository.js';
import { loadQaOverview } from '../../workbench/dataSources/qaOverviewRepository.js';
import { getArtifactDirectorySummary } from '../../workbench/dataSources/runArtifactRepository.js';
import { buildWorkbenchViewModel } from '../../workbench/transformers/workbenchViewModel.js';
import { getCachedRouteContext, setCachedRouteContext } from '../../workbench/dataSources/routeContextCache.js';
import { loadJSON, saveJSON } from '../../utils/fileHelper.js';
import { chat as llmChat, healthCheck as llmHealthCheck } from '../../llm/client.js';
import { updateEnvFile } from '../../utils/envConfigStore.js';
import { sendJson, sendFile } from '../../workbench/http/httpResponseHelpers.js';
import { buildSettingsPayload, collectSettingsUpdates, runBatchProviderPrecheck } from '../../workbench/http/settingsSupport.js';
import { safeParseBody } from '../../workbench/http/bodyParser.js';
import { handleProjectRoutes } from '../../workbench/http/projectRoutes.js';
import { handleEpisodeRoutes } from '../../workbench/http/episodeRoutes.js';
import { handleScriptRoutes } from '../../workbench/http/scriptRoutes.js';
import { handleSettingsRoutes } from '../../workbench/http/settingsRoutes.js';
import { handleRunReadRoutes } from '../../workbench/http/runReadRoutes.js';
import { handleRunCommandRoutes } from '../../workbench/http/runCommandRoutes.js';
import { handleExportRoutes } from '../../workbench/http/exportRoutes.js';
import { handleLogRoutes } from '../../workbench/http/logRoutes.js';
import { reconcileRunJobs, defaultIsProcessAlive } from '../../workbench/http/runJobReconciler.js';
import { safeExists, resolvePathInside } from '../../workbench/http/pathSecurity.js';
import { friendlyError } from '../../utils/errors.js';

const runWriteQueues = new Map();

function withRunLock(runId, fn) {
  if (!runWriteQueues.has(runId)) {
    runWriteQueues.set(runId, Promise.resolve());
  }
  const prev = runWriteQueues.get(runId);
  const next = prev.then(fn, fn);
  runWriteQueues.set(runId, next);
  return next;
}

function writeJsonSafe(filePath, payload) {
  saveJSON(filePath, payload);
}

async function probeImageProviderAuth({ provider, model, env }) {
  const baseUrl = String(env?.IMAGE_API_BASE_URL || '').trim();
  const apiKey = String(env?.IMAGE_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    return {
      provider,
      model,
      ok: false,
      latencyMs: 0,
      message: '图像接口地址或 API Key 缺失',
      hint: '请先保存图像接口地址和 API Key。',
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const latencyMs = Date.now() - startedAt;
    const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
    const raw = await response.text();
    let parsed = null;
    if (contentType.includes('application/json')) {
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }
    }

    const looksLikeOpenAiModels =
      parsed &&
      typeof parsed === 'object' &&
      parsed.object === 'list' &&
      Array.isArray(parsed.data);

    if (response.ok && looksLikeOpenAiModels) {
      return {
        provider,
        model,
        ok: true,
        latencyMs,
        message: '图像鉴权连通性正常',
        hint: '已完成图像供应商鉴权探测。',
      };
    }

    const invalidPayloadMessage = response.ok
      ? `status code ${response.status} invalid provider payload content-type=${contentType || 'unknown'} body=${raw.slice(0, 300)}`
      : `status code ${response.status} ${raw}`.trim();
    const translated = friendlyError(invalidPayloadMessage);
    return {
      provider,
      model,
      ok: false,
      latencyMs,
      message: response.ok ? '图像接口返回了网页或非模型列表，不是可用的 OpenAI 兼容图像 API。' : translated.friendly,
      hint: response.ok
        ? '请把 IMAGE_API_BASE_URL 改成真正的 API 根路径，例如能返回 /models JSON 列表的地址。'
        : translated.hint,
    };
  } catch (error) {
    const translated = friendlyError(error?.message || '图像预检失败');
    return {
      provider,
      model,
      ok: false,
      latencyMs: Date.now() - startedAt,
      message: translated.friendly,
      hint: translated.hint,
    };
  }
}

function normalizeRunStatus(runJob, qaOverview) {
  const status = String(runJob?.status || '').toLowerCase();
  if (qaOverview?.blockCount > 0) return 'block';
  if (qaOverview?.warnCount > 0) return 'warn';
  if (status === 'completed') return 'pass';
  if (status === 'failed' || status === 'error' || status === 'blocked') return 'block';
  return 'running';
}

function resolveProjectStoreBaseTempDir(tempProjectsDir) {
  const absolute = path.resolve(tempProjectsDir);
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

  const projectsMap = new Map();
  for (const runJob of runJobs) {
    const qa = qaOverviewsByRunId[runJob.id];
    if (!projectsMap.has(runJob.projectId)) {
      projectsMap.set(runJob.projectId, {
        id: runJob.projectId,
        title: runJob.scriptTitle || runJob.projectId,
        latestRunId: runJob.id,
        latestRunKey: runJob.runKey || null,
        scripts: new Map(),
        runCount: 0,
      });
    }

    const project = projectsMap.get(runJob.projectId);
    project.runCount += 1;

    if (!project.scripts.has(runJob.scriptId)) {
      project.scripts.set(runJob.scriptId, {
        id: runJob.scriptId,
        title: runJob.scriptTitle || runJob.scriptId,
        episodes: new Map(),
      });
    }

    const script = project.scripts.get(runJob.scriptId);
    if (!script.episodes.has(runJob.episodeId)) {
      script.episodes.set(runJob.episodeId, {
        id: runJob.episodeId,
        title: runJob.episodeTitle || runJob.episodeId,
        latestRunId: runJob.id,
        latestRunKey: runJob.runKey || null,
        runs: [],
      });
    }

    const episode = script.episodes.get(runJob.episodeId);
    episode.runs.push({
      id: runJob.id,
      runKey: runJob.runKey || null,
      status: normalizeRunStatus(runJob, qa),
      headline: qa.headline || '',
      startedAt: runJob.startedAt,
      finishedAt: runJob.finishedAt,
    });
  }

  const projects = [...projectsMap.values()].map((project) => ({
    id: project.id,
    title: project.title,
    latestRunId: project.latestRunId,
    latestRunKey: project.latestRunKey,
    runCount: project.runCount,
    scripts: [...project.scripts.values()].map((script) => ({
      id: script.id,
      title: script.title,
      episodes: [...script.episodes.values()].map((episode) => ({
        id: episode.id,
        title: episode.title,
        latestRunId: episode.latestRunId || null,
        latestRunKey: episode.latestRunKey || null,
        runs: episode.runs,
      })),
    })),
  }));

  return {
    qaOverviewsByRunId,
    artifactSummariesByRunId,
    projects,
  };
}

function safeStaticPath(requestPath, workspaceRoot) {
  const pathname = decodeURIComponent(requestPath.split('?')[0]);
  const segments = pathname.split(/[\\/]+/).filter(Boolean);
  if (segments.includes('..')) {
    return null;
  }
  const allowedStaticExtensions = new Set([
    '.html',
    '.js',
    '.mjs',
    '.css',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.ico',
    '.webp',
    '.woff',
    '.woff2',
    '.ttf',
    '.map',
  ]);
  const extension = path.extname(pathname).toLowerCase();
  if (!allowedStaticExtensions.has(extension)) {
    return null;
  }
  let absolute = null;
  try {
    absolute = resolvePathInside(workspaceRoot, `.${pathname}`, 'workspace');
  } catch {
    return null;
  }
  return absolute;
}

export function createLegacyWorkbenchServer({
  workspaceRoot,
  tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects'),
  spawnProcess = spawn,
  isProcessAlive = defaultIsProcessAlive,
  scriptProfessionalizeChat = llmChat,
} = {}) {
  const projectStoreBaseTempDir = resolveProjectStoreBaseTempDir(tempProjectsDir);
  return http.createServer(async (request, response) => {
    const workbenchToken = process.env.WORKBENCH_TOKEN;
    if (workbenchToken) {
      const method = (request.method || 'GET').toUpperCase();
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        const authHeader = request.headers.authorization || '';
        if (authHeader !== `Bearer ${workbenchToken}`) {
          return sendJson(response, 401, { error: 'Unauthorized' });
        }
      }
    }

    const requestPath = request.url || '/';
    const requestUrl = new URL(requestPath, 'http://127.0.0.1');
    const searchParams = requestUrl.searchParams;
    const pathname = decodeURIComponent(requestUrl.pathname);

    const cacheKey = tempProjectsDir;
    let routeCtx = getCachedRouteContext(cacheKey);
    if (!routeCtx) {
      const runJobs = reconcileRunJobs(listRunJobs({ tempProjectsDir }), { workspaceRoot, projectStoreBaseTempDir, isProcessAlive });
      const derived = buildDerivedData(runJobs, workspaceRoot);
      routeCtx = { runJobs, derived };
      setCachedRouteContext(cacheKey, routeCtx);
    }
    const { runJobs, derived } = routeCtx;
    const workbenchModel = buildWorkbenchViewModel({
      runJobs,
      qaOverviewsByRunId: derived.qaOverviewsByRunId,
      artifactSummariesByRunId: derived.artifactSummariesByRunId,
    });

    if (pathname === '/api/workbench') {
      return sendJson(response, 200, workbenchModel);
    }

    if (await handleProjectRoutes(request, response, { pathname, method: request.method, tempProjectsDir, derived })) return;

    if (await handleScriptRoutes(request, response, {
      pathname, method: request.method, tempProjectsDir, workspaceRoot, projectStoreBaseTempDir,
      scriptProfessionalizeChat,
    })) {
      return;
    }

    if (await handleEpisodeRoutes(request, response, {
      pathname,
      method: request.method || 'GET',
      searchParams,
      projectStoreBaseTempDir,
      runJobs,
      workspaceRoot,
      withRunLock,
    })) {
      return;
    }

    if (await handleRunCommandRoutes(request, response, {
      pathname,
      workspaceRoot,
      tempProjectsDir,
      runJobs,
      derived: {
        ...derived,
        normalizeRunStatus,
      },
      spawnProcess,
      safeParseBody,
      writeJsonSafe,
    })) {
      return;
    }

    if (await handleRunReadRoutes(request, response, {
      pathname,
      workspaceRoot,
      projectStoreBaseTempDir,
      runJobs,
      derived,
      withRunLock,
      safeParseBody,
      writeJsonSafe,
    })) {
      return;
    }

    if (await handleLogRoutes(request, response, {
      pathname,
      searchParams,
      workspaceRoot,
      projectStoreBaseTempDir,
      runJobs,
    })) {
      return;
    }

    if (await handleExportRoutes(request, response, {
      pathname,
      workspaceRoot,
      runJobs,
    })) {
      return;
    }

    if (await handleSettingsRoutes(request, response, {
      pathname,
      workspaceRoot,
      workbenchModel,
      runJobs,
      derived,
      llmHealthCheck,
      buildSettingsPayload,
      safeParseBody,
      collectSettingsUpdates,
      updateEnvFile,
      runBatchProviderPrecheck: (options = {}) => runBatchProviderPrecheck({
        imageLiveProbe: probeImageProviderAuth,
        ...options,
      }),
    })) {
      return;
    }

    const staticPath = safeStaticPath(requestPath, workspaceRoot);
    if (!staticPath || !safeExists(staticPath) || fs.statSync(staticPath).isDirectory()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    sendFile(response, staticPath);
  });
}

export default {
  createLegacyWorkbenchServer,
};
