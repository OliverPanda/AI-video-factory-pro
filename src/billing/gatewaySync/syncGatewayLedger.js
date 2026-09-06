import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, saveJSON } from '../../utils/fileHelper.js';
import { readBillingLedger, updateBillingLedgerEntry } from '../billingLedger.js';
import { resolveGatewaySyncAdapter } from './adapterRegistry.js';
import { findLedgerMatch } from './gatewayMatch.js';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_UNMATCHED_EVENTS = 100;

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildHeaders(apiKey) {
  return {
    Accept: 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function buildSyncConfigurationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

async function fetchGatewayPayload(url, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(apiKey),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`gateway_sync_http_${response.status}${text ? `:${text.slice(0, 200)}` : ''}`);
    }
    const contentType = String(
      typeof response.headers?.get === 'function'
        ? response.headers.get('content-type')
        : response.headers?.['content-type'] || response.headers?.['Content-Type'] || 'application/json'
    ).toLowerCase();
    const text = typeof response.text === 'function' ? await response.text() : null;
    if (!contentType.includes('application/json')) {
      throw buildSyncConfigurationError(
        'gateway_sync_expected_json',
        `中转站日志接口返回了非 JSON 内容：${url}`,
        {
          attemptedUrl: url,
          contentType,
          hint: '当前地址更像站点页面而不是消费日志接口。请在设置中把 GATEWAY_SYNC_BASE_URL / GATEWAY_SYNC_PATH 改成真实账单 JSON 接口。',
        }
      );
    }
    try {
      if (text !== null) {
        return JSON.parse(text);
      }
      if (typeof response.json === 'function') {
        return await response.json();
      }
      throw new Error('missing_json_reader');
    } catch {
      throw buildSyncConfigurationError(
        'gateway_sync_invalid_json',
        `中转站日志接口返回内容不是合法 JSON：${url}`,
        {
          attemptedUrl: url,
          hint: '请确认中转站账单接口会直接返回 JSON，而不是网页或下载内容。',
        }
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

function collectRunDirs(runJobs = []) {
  return runJobs
    .map((runJob) => ({
      runId: runJob.id,
      runKey: runJob.runKey || null,
      projectId: runJob.projectId || null,
      runDir: runJob.artifactRunDir || null,
    }))
    .filter((entry) => entry.runDir);
}

function buildEventArtifactPath(runDir) {
  return path.join(runDir, 'gateway-sync-unmatched.json');
}

function persistUnmatched(runDir, payload) {
  ensureDir(runDir);
  saveJSON(buildEventArtifactPath(runDir), payload);
}

function buildGatewaySyncPatch(matched, event, gatewayFamily) {
  return {
    amount: event.amount,
    currency: event.currency || matched.currency || 'CNY',
    status: event.status || matched.status || 'unknown',
    finishedAt: event.timestamp || matched.finishedAt || null,
    metadata: {
      ...(matched.metadata || {}),
      gatewaySync: {
        family: gatewayFamily,
        syncedAt: new Date().toISOString(),
        requestId: event.requestId || null,
        providerJobId: event.providerJobId || null,
        operation: event.operation || 'unknown',
        rawPayload: event.rawPayload || null,
      },
    },
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

export async function syncGatewayLedger({
  runJobs = [],
  projectId = '',
  runId = null,
  gatewayFamily = 'auto',
  gatewayBaseUrl,
  gatewayApiKey = '',
  gatewayPath = '',
  since = '',
  until = '',
} = {}) {
  const baseUrl = normalizeBaseUrl(gatewayBaseUrl);
  if (!baseUrl) {
    throw new Error('gateway_base_url_missing');
  }
  if (!String(gatewayApiKey || '').trim()) {
    throw new Error('gateway_api_key_missing');
  }

  const scopedRuns = collectRunDirs(runJobs).filter((entry) => {
    if (projectId && entry.projectId !== projectId) return false;
    if (runId && entry.runId !== runId && entry.runKey !== runId) return false;
    return true;
  });

  const provisionalAdapter = resolveGatewaySyncAdapter({
    family: gatewayFamily,
    baseUrl,
    path: gatewayPath,
  });
  const attemptedUrl = provisionalAdapter.buildUrl(baseUrl, { path: gatewayPath, since, until, runId });
  const payload = await fetchGatewayPayload(
    attemptedUrl,
    gatewayApiKey
  );
  const adapter = resolveGatewaySyncAdapter({
    family: gatewayFamily,
    baseUrl,
    path: gatewayPath || provisionalAdapter.defaultPath,
    payload,
  });
  const events = adapter.normalize(payload);
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('gateway_sync_empty_payload');
  }

  const results = [];
  const unmatched = [];

  for (const run of scopedRuns) {
    const ledgerEntries = readBillingLedger(run.runDir);
    for (const event of events) {
      const matched = findLedgerMatch(ledgerEntries, event);
      if (!matched) {
        continue;
      }

      const updated = updateBillingLedgerEntry(
        run.runDir,
        matched.id,
        buildGatewaySyncPatch(matched, event, adapter.family || gatewayFamily)
      );

      if (updated) {
        results.push({
          runId: run.runId,
          ledgerEntryId: updated.id,
          requestId: event.requestId || null,
          providerJobId: event.providerJobId || null,
          status: updated.status,
          amount: updated.amount,
          currency: updated.currency,
        });
      }
    }
  }

  const allKnownTokens = new Set(
    results.flatMap((item) => [item.requestId, item.providerJobId].filter(Boolean))
  );
  for (const event of events) {
    const token = event.requestId || event.providerJobId || event.idempotencyKey || null;
    if (!token || allKnownTokens.has(token)) continue;
    unmatched.push(event);
  }

  for (const run of scopedRuns) {
    if (unmatched.length > 0) {
      persistUnmatched(run.runDir, {
        syncedAt: new Date().toISOString(),
        gatewayFamily: adapter.family || gatewayFamily,
        gatewayBaseUrl: baseUrl,
        scannedEventCount: events.length,
        unmatchedCount: unmatched.length,
        unmatched: unmatched.slice(0, MAX_UNMATCHED_EVENTS),
      });
    }
  }

  return {
    gatewayFamily: adapter.family || gatewayFamily,
    syncedAt: new Date().toISOString(),
    attemptedUrl,
    scannedEventCount: events.length,
    matchedCount: results.length,
    unmatchedCount: unmatched.length,
    results,
  };
}

export default {
  syncGatewayLedger,
};
