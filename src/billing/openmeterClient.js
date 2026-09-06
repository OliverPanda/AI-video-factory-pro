import 'dotenv/config';

const DEFAULT_OPENMETER_EVENTS_PATH = '/api/v1/events';
const DEFAULT_TIMEOUT_MS = 15000;

function isOpenMeterConfigured(env = process.env) {
  return Boolean(env.OPENMETER_API_KEY && env.OPENMETER_BASE_URL);
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildSubject(entry = {}) {
  return entry.projectId || entry.runId || 'unknown';
}

function buildMeterType(entry = {}) {
  if (entry.category === 'image') return 'ai_video_factory.image_requests';
  if (entry.category === 'video') return 'ai_video_factory.video_requests';
  return 'ai_video_factory.unknown_requests';
}

function buildCloudEvent(entry = {}) {
  const timestamp = entry.timestamp || new Date().toISOString();
  return {
    specversion: '1.0',
    id: entry.idempotencyKey || entry.requestId || `${buildMeterType(entry)}:${entry.runId || 'run'}:${entry.shotId || 'shot'}:${timestamp}`,
    source: 'ai-video-factory-pro',
    type: buildMeterType(entry),
    subject: buildSubject(entry),
    time: timestamp,
    datacontenttype: 'application/json',
    data: {
      value: 1,
      category: entry.category || 'unknown',
      provider: entry.provider || 'unknown',
      operation: entry.operation || 'unknown',
      runId: entry.runId || '',
      shotId: entry.shotId || null,
      status: entry.status || 'unknown',
      amount: Number.isFinite(Number(entry.amount)) ? Number(entry.amount) : null,
      currency: entry.currency || 'CNY',
      requestId: entry.requestId || null,
      billingRef: entry.billingRef || null,
    },
  };
}

async function postJson(url, body, env = process.env) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENMETER_API_KEY}`,
        'Content-Type': 'application/cloudevents+json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenMeter HTTP ${response.status}${text ? `: ${text}` : ''}`);
    }

    return { sent: true, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

export async function emitOpenMeterEvent(entry, env = process.env) {
  if (!isOpenMeterConfigured(env)) {
    return { sent: false, reason: 'not_configured' };
  }

  const baseUrl = normalizeBaseUrl(env.OPENMETER_BASE_URL);
  if (!baseUrl) {
    return { sent: false, reason: 'base_url_missing' };
  }

  const event = buildCloudEvent(entry);
  try {
    return await postJson(`${baseUrl}${DEFAULT_OPENMETER_EVENTS_PATH}`, event, env);
  } catch (error) {
    return {
      sent: false,
      reason: error?.message || 'openmeter_error',
      eventId: event.id,
      eventType: event.type,
    };
  }
}

export default {
  emitOpenMeterEvent,
};
