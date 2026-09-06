import path from 'node:path';

import { loadEpisode } from '../../utils/projectStore.js';
import { sendJson } from './httpResponseHelpers.js';

function resolveLlmPrecheckConfig({ projectId, scriptId, episodeId, baseTempDir }) {
  const episode = loadEpisode(projectId, scriptId, episodeId, { baseTempDir });
  const snapshotProvider = String(
    episode?.llmProvider ||
      episode?.provider ||
      process.env.LLM_PROVIDER ||
      'qwen'
  ).trim();
  return {
    provider: snapshotProvider || 'qwen',
    model: episode?.llmModel || process.env.LLM_MODEL || undefined,
  };
}

export async function handleSettingsRoutes(
  request,
  response,
  {
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
    runBatchProviderPrecheck,
  }
) {
  if (pathname === '/api/assets/characters') {
    sendJson(response, 200, {
      source: 'filesystem-artifacts',
      items: [
        {
          title: workbenchModel.currentRun.displayTitle,
          summary: '角色资产页当前从运行上下文聚合入口，后续接入真实角色档案文件。',
        },
      ],
    });
    return true;
  }

  if (pathname === '/api/assets/videos') {
    sendJson(response, 200, {
      source: 'filesystem-artifacts',
      items: runJobs.slice(0, 12).map((runJob) => ({
        id: runJob.id,
        title: `${runJob.scriptTitle || '未命名脚本'} / ${runJob.episodeTitle || runJob.episodeId || '未命名分集'}`,
        status: derived.qaOverviewsByRunId[runJob.id]?.blockCount > 0
          ? 'block'
          : derived.qaOverviewsByRunId[runJob.id]?.warnCount > 0
            ? 'warn'
            : String(runJob?.status || '').toLowerCase() === 'completed'
              ? 'pass'
              : ['failed', 'error', 'blocked'].includes(String(runJob?.status || '').toLowerCase())
                ? 'block'
                : 'running',
        artifactRunDir: runJob.artifactRunDir,
      })),
    });
    return true;
  }

  if (pathname === '/api/health/llm') {
    if ((request.method || 'GET') !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const url = new URL(request.url || '/api/health/llm', 'http://127.0.0.1');
      const projectId = url.searchParams.get('projectId');
      const scriptId = url.searchParams.get('scriptId');
      const episodeId = url.searchParams.get('episodeId');
      const baseTempDir = path.join(workspaceRoot, 'temp');
      const config =
        projectId && scriptId && episodeId
          ? resolveLlmPrecheckConfig({ projectId, scriptId, episodeId, baseTempDir })
          : {
              provider: process.env.LLM_PROVIDER || 'qwen',
              model: process.env.LLM_MODEL || undefined,
            };
      const result = await llmHealthCheck(config);
      sendJson(response, 200, result);
      return true;
    } catch (err) {
      sendJson(response, 200, {
        ok: false,
        provider: process.env.LLM_PROVIDER || 'qwen',
        model: '',
        latencyMs: 0,
        error: err.message || 'Health check failed',
      });
      return true;
    }
  }

  if (pathname === '/api/settings/providers') {
    const method = request.method || 'GET';
    if (method === 'GET') {
      sendJson(response, 200, buildSettingsPayload(workspaceRoot));
      return true;
    }
    if (method === 'PUT') {
      try {
        const body = await safeParseBody(request, response);
        if (body === null) return true;
        const updates = collectSettingsUpdates(body.sections || []);
        updateEnvFile(path.join(workspaceRoot, '.env'), updates, {
          allowedRoot: workspaceRoot,
          expectedBaseName: '.env',
        });
        sendJson(response, 200, buildSettingsPayload(workspaceRoot));
        return true;
      } catch (err) {
        sendJson(response, 500, { error: err.message || '保存配置失败' });
        return true;
      }
    }
    sendJson(response, 405, { error: 'Method not allowed' });
    return true;
  }

  if (pathname === '/api/settings/providers/precheck') {
    if ((request.method || 'GET') !== 'POST') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const payload = await runBatchProviderPrecheck();
      sendJson(response, 200, payload);
      return true;
    } catch (err) {
      sendJson(response, 500, { error: err.message || '批量预检失败' });
      return true;
    }
  }

  if (pathname === '/') {
    sendJson(response, 200, {
      name: 'AI Video Factory Workbench API',
      mode: 'api-only-workbench',
      endpoints: ['/api/workbench', '/api/projects', '/api/runs', '/api/settings/providers'],
    });
    return true;
  }

  return false;
}

export default {
  handleSettingsRoutes,
};
