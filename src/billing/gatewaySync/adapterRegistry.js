import { classifyBillingOperation } from '../operationClassifier.js';

function normalizeCurrency(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return 'CNY';
  }
  return value.trim().toUpperCase();
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractStatus(input = {}) {
  const candidate = String(
    input.status ||
    input.state ||
    input.billing_status ||
    input.billingStatus ||
    input.charge_status ||
    input.chargeStatus ||
    ''
  ).trim().toLowerCase();

  if (['billed', 'paid', 'charged', 'success', 'succeeded', 'completed'].includes(candidate)) return 'billed';
  if (['waived', 'free', 'waive'].includes(candidate)) return 'waived';
  if (['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(candidate)) return 'failed';
  return 'unknown';
}

function normalizeCommonEvent(raw = {}) {
  const usage = raw.usage && typeof raw.usage === 'object' ? raw.usage : {};
  const amount = [
    raw.amount,
    raw.price,
    raw.cost,
    raw.total_cost,
    raw.totalCost,
    usage.total_cost,
    usage.totalCost,
    usage.cost,
    usage.amount,
  ].map(toNumber).find((value) => value !== null) ?? null;

  return {
    requestId: raw.request_id || raw.requestId || raw.id || raw.task_id || raw.taskId || null,
    providerJobId: raw.provider_job_id || raw.providerJobId || raw.task_id || raw.taskId || null,
    idempotencyKey: raw.idempotency_key || raw.idempotencyKey || null,
    amount,
    currency: normalizeCurrency(raw.currency || usage.currency),
    status: extractStatus(raw),
    operation: classifyBillingOperation({
      operation: raw.operation,
      category: raw.category,
      requestPath: raw.request_path || raw.requestPath || raw.path,
      modelName: raw.model_name || raw.modelName,
      rawPayload: raw,
    }),
    timestamp: normalizeTimestamp(
      raw.finished_at || raw.finishedAt || raw.updated_at || raw.updatedAt || raw.created_at || raw.createdAt || null
    ),
    rawPayload: raw,
  };
}

function collectItems(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (payload.data && Array.isArray(payload.data.items)) return payload.data.items;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.logs)) return payload.logs;
  return [];
}

function normalizeFamily(value) {
  return String(value || '').trim().toLowerCase();
}

function buildGatewayUrl(baseUrl, pathValue, defaultPath, options = {}) {
  const candidatePath = String(pathValue || defaultPath || '').trim();
  const url = /^https?:\/\//i.test(candidatePath)
    ? new URL(candidatePath)
    : candidatePath.startsWith('/')
      ? new URL(candidatePath, String(baseUrl).replace(/\/+$/, '') + '/')
      : new URL(candidatePath, String(baseUrl).replace(/\/+$/, '') + '/');
  if (options.since) url.searchParams.set('since', options.since);
  if (options.until) url.searchParams.set('until', options.until);
  if (options.runId) url.searchParams.set('runId', options.runId);
  return url.toString();
}

function safeHostname(baseUrl) {
  try {
    return new URL(String(baseUrl || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function inferFamilyFromPayload(payload = {}) {
  const items = collectItems(payload);
  const first = items[0];
  if (!first || typeof first !== 'object') {
    return null;
  }

  if (first.other && typeof first.other === 'object') {
    if (first.other.request_id || first.other.model_price || first.other.billing_source) {
      return 'apilio_openai_compat';
    }
  }
  if (first.task_id || first.taskId) {
    return 'media_task';
  }
  if (first.output && typeof first.output === 'object' && first.output.task_id) {
    return 'dashscope_async';
  }
  return null;
}

function inferFamily({ baseUrl = '', path = '', payload } = {}) {
  const host = safeHostname(baseUrl);
  const normalizedPath = String(path || '').trim().toLowerCase();
  const fromPayload = inferFamilyFromPayload(payload);
  if (fromPayload) {
    return fromPayload;
  }
  if (host.includes('apilio.ai')) {
    return 'apilio_openai_compat';
  }
  if (normalizedPath.includes('/v1/media/')) {
    return 'media_task';
  }
  if (normalizedPath.includes('/api/v1/tasks/')) {
    return 'dashscope_async';
  }
  return 'openai_compat';
}

function createOpenAiCompatAdapter() {
  return {
    family: 'openai_compat',
    defaultPath: 'usage',
    buildUrl(baseUrl, options = {}) {
      return buildGatewayUrl(baseUrl, options.path, this.defaultPath, options);
    },
    normalize(payload = {}) {
      return collectItems(payload).map((item) => normalizeCommonEvent(item));
    },
  };
}

function createApilioOpenAiCompatAdapter() {
  return {
    family: 'apilio_openai_compat',
    defaultPath: 'usage',
    buildUrl(baseUrl, options = {}) {
      return buildGatewayUrl(baseUrl, options.path, this.defaultPath, options);
    },
    normalize(payload = {}) {
      return collectItems(payload).map((item) => {
        const usage = item?.usage && typeof item.usage === 'object' ? item.usage : {};
        const billing = item?.billing && typeof item.billing === 'object' ? item.billing : {};
        const other = item?.other && typeof item.other === 'object' ? item.other : {};
        const normalized = normalizeCommonEvent(item);
        return {
          ...normalized,
          requestId: normalized.requestId || other.request_id || item?.request?.id || item?.meta?.request_id || null,
          providerJobId: normalized.providerJobId || other.provider_job_id || item?.task?.id || item?.job?.id || null,
          idempotencyKey: normalized.idempotencyKey || other.idempotency_key || null,
          amount: normalized.amount
            ?? [other.model_price, billing.amount, billing.total, usage.total_price, usage.total_cost].map(toNumber).find((value) => value !== null)
            ?? null,
          currency: normalizeCurrency(other.currency || billing.currency || usage.currency || normalized.currency),
          status: normalized.status === 'unknown'
            ? (toNumber(other.model_price) !== null || String(other.billing_source || '').trim() ? 'billed' : extractStatus(billing))
            : normalized.status,
          operation: classifyBillingOperation({
            operation: normalized.operation,
            requestPath: other.request_path || other.path || item?.request_path || item?.path,
            modelName: item?.model_name || item?.modelName,
            rawPayload: item,
          }),
          timestamp: normalized.timestamp || normalizeTimestamp(item?.created_at),
        };
      });
    },
  };
}

function createMediaTaskAdapter() {
  return {
    family: 'media_task',
    defaultPath: '/v1/media/usage',
    buildUrl(baseUrl, options = {}) {
      return buildGatewayUrl(baseUrl, options.path, this.defaultPath, options);
    },
    normalize(payload = {}) {
      return collectItems(payload).map((item) => {
        const normalized = normalizeCommonEvent(item);
        return {
          ...normalized,
          requestId: normalized.requestId || item.task_id || item.taskId || null,
          providerJobId: normalized.providerJobId || item.task_id || item.taskId || null,
        };
      });
    },
  };
}

function createDashScopeAsyncAdapter() {
  return {
    family: 'dashscope_async',
    defaultPath: '/api/v1/tasks/usage',
    buildUrl(baseUrl, options = {}) {
      return buildGatewayUrl(baseUrl, options.path, this.defaultPath, options);
    },
    normalize(payload = {}) {
      return collectItems(payload).map((item) => {
        const normalized = normalizeCommonEvent(item);
        return {
          ...normalized,
          amount: normalized.amount ?? toNumber(item?.usage?.total_price),
          currency: normalizeCurrency(item?.usage?.currency || normalized.currency),
          providerJobId: normalized.providerJobId || item?.output?.task_id || null,
        };
      });
    },
  };
}

const registry = new Map([
  ['apilio_openai_compat', createApilioOpenAiCompatAdapter()],
  ['openai_compat', createOpenAiCompatAdapter()],
  ['media_task', createMediaTaskAdapter()],
  ['dashscope_async', createDashScopeAsyncAdapter()],
]);

export function getGatewaySyncAdapter(family = 'openai_compat') {
  const normalized = normalizeFamily(family || 'openai_compat');
  if (registry.has(normalized)) {
    return registry.get(normalized);
  }
  return registry.get('openai_compat');
}

export function resolveGatewaySyncAdapter({ family = 'auto', baseUrl = '', path = '', payload } = {}) {
  const normalized = normalizeFamily(family || 'auto');
  if (normalized && normalized !== 'auto' && registry.has(normalized)) {
    return registry.get(normalized);
  }
  return getGatewaySyncAdapter(inferFamily({ baseUrl, path, payload }));
}

export function listGatewaySyncFamilies() {
  return ['auto', ...Array.from(registry.keys())];
}

export default {
  getGatewaySyncAdapter,
  resolveGatewaySyncAdapter,
  listGatewaySyncFamilies,
};
