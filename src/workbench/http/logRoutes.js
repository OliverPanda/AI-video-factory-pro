import { sendJson } from './httpResponseHelpers.js';
import { buildLogsOverview, buildProjectRunOptions } from '../../billing/logAggregation.js';
import { syncGatewayLedger } from '../../billing/gatewaySync/syncGatewayLedger.js';
import { safeParseBody } from './bodyParser.js';

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

function deriveGatewaySyncHint(baseUrl, attemptedUrl, gatewayPath) {
  const trimmedBaseUrl = String(baseUrl || '').trim();
  const trimmedPath = String(gatewayPath || '').trim();
  if (/apilio\.ai/i.test(trimmedBaseUrl) && (!trimmedPath || trimmedPath === '/usage' || trimmedPath === 'usage')) {
    return '当前 apilio 公开首页和文档没有暴露消费日志 JSON 端点；请把 GATEWAY_SYNC_PATH 改成该站后台真实消费日志接口后再同步。';
  }
  return '请确认当前配置指向的是中转站消费日志 JSON 接口，而不是站点首页或 OpenAI 业务接口。';
}

export async function handleLogRoutes(
  request,
  response,
  {
    pathname,
    searchParams,
    workspaceRoot,
    projectStoreBaseTempDir,
    runJobs,
  }
) {
  if (pathname === '/api/logs/sync' && String(request.method || 'GET').toUpperCase() === 'POST') {
    const body = await safeParseBody(request);
    const projectId = String(body?.projectId || '').trim();
    const runId = typeof body?.runId === 'string' && body.runId.trim() ? body.runId.trim() : null;

    try {
      const gatewayConfig = resolveGatewaySyncRuntimeConfig();
      const payload = await syncGatewayLedger({
        runJobs,
        projectId,
        runId,
        gatewayFamily: gatewayConfig.gatewayFamily,
        gatewayBaseUrl: gatewayConfig.gatewayBaseUrl,
        gatewayApiKey: gatewayConfig.gatewayApiKey,
        gatewayPath: gatewayConfig.gatewayPath,
      });
      sendJson(response, 200, payload);
    } catch (error) {
      const details = error?.details && typeof error.details === 'object' ? error.details : null;
      const attemptedUrl = details?.attemptedUrl || null;
      const gatewayConfig = resolveGatewaySyncRuntimeConfig();
      sendJson(response, 500, {
        error: error?.message || 'gateway_sync_failed',
        code: error?.code || 'gateway_sync_failed',
        attemptedUrl,
        hint: details?.hint || deriveGatewaySyncHint(gatewayConfig.gatewayBaseUrl, attemptedUrl, gatewayConfig.gatewayPath),
      });
    }
    return true;
  }

  if (pathname === '/api/logs') {
    const projectId = searchParams.get('projectId') || '';
    const runId = searchParams.get('runId') || null;

    sendJson(response, 200, buildLogsOverview({
      runJobs,
      workspaceRoot,
      projectStoreBaseTempDir,
      projectId,
      runId,
    }));
    return true;
  }

  if (pathname === '/api/logs/runs') {
    const projectId = searchParams.get('projectId') || '';
    sendJson(response, 200, projectId ? buildProjectRunOptions(runJobs, projectId) : []);
    return true;
  }

  return false;
}

export default {
  handleLogRoutes,
};
