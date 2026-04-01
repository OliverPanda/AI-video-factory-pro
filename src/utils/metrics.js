import logger from './logger.js';

function nowIso() {
  return new Date().toISOString();
}

export function createRunMetrics(existingMetrics = {}) {
  return {
    startedAt: existingMetrics.startedAt || nowIso(),
    steps: existingMetrics.steps || {},
    summary: existingMetrics.summary || {
      totalDurationMs: 0,
      totalDurationSec: 0,
      cost: null,
    },
  };
}

export async function measureStep(metrics, stepKey, label, fn, options = {}) {
  const step = {
    label,
    startedAt: nowIso(),
    status: 'running',
    cost: options.cost ?? null,
    meta: options.meta || {},
  };
  metrics.steps[stepKey] = step;

  const startedAtMs = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAtMs;
    metrics.steps[stepKey] = {
      ...step,
      finishedAt: nowIso(),
      status: 'success',
      durationMs,
      durationSec: Number((durationMs / 1000).toFixed(3)),
      meta: {
        ...step.meta,
        ...(options.onSuccessMeta ? options.onSuccessMeta(result) : {}),
      },
    };
    logger.info('Metrics', `${label} 完成，耗时 ${durationMs}ms`);
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAtMs;
    metrics.steps[stepKey] = {
      ...step,
      finishedAt: nowIso(),
      status: 'failed',
      durationMs,
      durationSec: Number((durationMs / 1000).toFixed(3)),
      error: error.message,
    };
    logger.warn('Metrics', `${label} 失败，耗时 ${durationMs}ms`);
    throw error;
  }
}

export function finalizeRunMetrics(metrics) {
  const startedAtMs = Date.parse(metrics.startedAt);
  const totalDurationMs = Math.max(0, Date.now() - startedAtMs);
  metrics.summary = {
    totalDurationMs,
    totalDurationSec: Number((totalDurationMs / 1000).toFixed(3)),
    cost: null,
  };
  metrics.finishedAt = nowIso();
  return metrics;
}
