import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

import { listRunJobs } from '../dataSources/runJobRepository.js';
import { loadQaOverview } from '../dataSources/qaOverviewRepository.js';
import { getArtifactDirectorySummary } from '../dataSources/runArtifactRepository.js';
import { buildWorkbenchViewModel } from '../transformers/workbenchViewModel.js';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.md': 'text/plain; charset=utf-8',
};

function safeExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
  });
  fs.createReadStream(filePath).pipe(response);
}

function normalizeRunStatus(runJob, qaOverview) {
  const status = String(runJob?.status || '').toLowerCase();
  if (qaOverview?.blockCount > 0) return 'block';
  if (qaOverview?.warnCount > 0) return 'warn';
  if (status === 'completed') return 'pass';
  if (status === 'failed' || status === 'error' || status === 'blocked') return 'block';
  return 'running';
}

function buildDerivedData(runJobs, workspaceRoot) {
  const qaOverviewsByRunId = {};
  const artifactSummariesByRunId = {};

  for (const runJob of runJobs) {
    qaOverviewsByRunId[runJob.id] = loadQaOverview(runJob, { workspaceRoot });
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
        runs: [],
      });
    }

    script.episodes.get(runJob.episodeId).runs.push({
      id: runJob.id,
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
    runCount: project.runCount,
    scripts: [...project.scripts.values()].map((script) => ({
      id: script.id,
      title: script.title,
      episodes: [...script.episodes.values()].map((episode) => ({
        id: episode.id,
        title: episode.title,
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
  const normalized = pathname === '/' ? '/views/ai-video-factory-ui-visual-draft.html' : pathname;
  const absolute = path.normalize(path.join(workspaceRoot, normalized));
  if (!absolute.startsWith(workspaceRoot)) {
    return null;
  }
  return absolute;
}

export function createWorkbenchServer({
  workspaceRoot,
  tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects'),
} = {}) {
  return http.createServer((request, response) => {
    const requestPath = request.url || '/';
    const pathname = decodeURIComponent(requestPath.split('?')[0]);
    const runJobs = listRunJobs({ tempProjectsDir });
    const derived = buildDerivedData(runJobs, workspaceRoot);
    const workbenchModel = buildWorkbenchViewModel({
      runJobs,
      qaOverviewsByRunId: derived.qaOverviewsByRunId,
      artifactSummariesByRunId: derived.artifactSummariesByRunId,
    });

    if (pathname === '/api/workbench') {
      return sendJson(response, 200, workbenchModel);
    }

    if (pathname === '/api/projects') {
      return sendJson(
        response,
        200,
        derived.projects.map((project) => ({
          id: project.id,
          title: project.title,
          latestRunId: project.latestRunId,
          runCount: project.runCount,
          scriptCount: project.scripts.length,
          episodeCount: project.scripts.reduce((total, script) => total + script.episodes.length, 0),
        }))
      );
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch) {
      const project = derived.projects.find((item) => item.id === projectMatch[1]);
      return sendJson(response, project ? 200 : 404, project || { error: 'Project not found' });
    }

    const episodeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/episodes\/([^/]+)$/);
    if (episodeMatch) {
      const [, projectId, scriptId, episodeId] = episodeMatch;
      const project = derived.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      const episode = script?.episodes.find((item) => item.id === episodeId);
      return sendJson(response, episode ? 200 : 404, episode || { error: 'Episode not found' });
    }

    if (pathname === '/api/runs') {
      return sendJson(
        response,
        200,
        runJobs.map((runJob) => ({
          id: runJob.id,
          projectId: runJob.projectId,
          scriptId: runJob.scriptId,
          episodeId: runJob.episodeId,
          scriptTitle: runJob.scriptTitle,
          episodeTitle: runJob.episodeTitle,
          status: normalizeRunStatus(runJob, derived.qaOverviewsByRunId[runJob.id]),
          startedAt: runJob.startedAt,
          finishedAt: runJob.finishedAt,
          headline: derived.qaOverviewsByRunId[runJob.id]?.headline || '',
        }))
      );
    }

    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch) {
      const run = runJobs.find((item) => item.id === runMatch[1]);
      if (!run) {
        return sendJson(response, 404, { error: 'Run not found' });
      }
      return sendJson(response, 200, {
        ...run,
        qaOverview: derived.qaOverviewsByRunId[run.id] || null,
        artifacts: derived.artifactSummariesByRunId[run.id] || null,
      });
    }

    const runQaMatch = pathname.match(/^\/api\/runs\/([^/]+)\/qa$/);
    if (runQaMatch) {
      const qa = derived.qaOverviewsByRunId[runQaMatch[1]];
      return sendJson(response, qa ? 200 : 404, qa || { error: 'Run QA not found' });
    }

    const runArtifactsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/artifacts$/);
    if (runArtifactsMatch) {
      const artifacts = derived.artifactSummariesByRunId[runArtifactsMatch[1]];
      return sendJson(response, artifacts ? 200 : 404, artifacts || { error: 'Run artifacts not found' });
    }

    if (pathname === '/api/assets/characters') {
      return sendJson(response, 200, {
        source: 'filesystem-artifacts',
        items: [
          {
            title: workbenchModel.currentRun.displayTitle,
            summary: '角色资产页当前从运行上下文聚合入口，后续接入真实角色档案文件。',
          },
        ],
      });
    }

    if (pathname === '/api/assets/videos') {
      return sendJson(response, 200, {
        source: 'filesystem-artifacts',
        items: runJobs.slice(0, 12).map((runJob) => ({
          id: runJob.id,
          title: `${runJob.scriptTitle || '未命名脚本'} / ${runJob.episodeTitle || runJob.episodeId || '未命名分集'}`,
          status: normalizeRunStatus(runJob, derived.qaOverviewsByRunId[runJob.id]),
          artifactRunDir: runJob.artifactRunDir,
        })),
      });
    }

    if (pathname === '/api/settings/providers') {
      return sendJson(response, 200, {
        workbenchApiBase: 'http://127.0.0.1:4178/api',
        frontendDevServer: 'http://127.0.0.1:5174',
        mode: 'readonly-workbench',
        note: '当前只读展示本地运行产物，不直接改写核心生成链路。',
      });
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
  createWorkbenchServer,
};
