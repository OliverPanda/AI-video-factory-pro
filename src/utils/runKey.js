import crypto from 'node:crypto';

function normalizeStringPart(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildRunKey(input = {}) {
  const explicit = normalizeStringPart(input.runKey);
  if (explicit) return explicit;

  const seed = [
    normalizeStringPart(input.id),
    normalizeStringPart(input.projectId),
    normalizeStringPart(input.scriptId),
    normalizeStringPart(input.episodeId),
    normalizeStringPart(input.startedAt),
  ].join('|');

  const digest = crypto.createHash('sha1').update(seed || String(Date.now())).digest('hex').slice(0, 12);
  return `rk_${digest}`;
}

export function attachRunKey(runJob) {
  if (!runJob || typeof runJob !== 'object') return runJob;
  return {
    ...runJob,
    runKey: buildRunKey(runJob),
  };
}

export function matchesRunLocator(runJob, locator) {
  const normalized = normalizeStringPart(locator);
  if (!normalized || !runJob) return false;
  return runJob.id === normalized || runJob.runKey === normalized;
}

