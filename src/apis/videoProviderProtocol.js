function sanitizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value ?? null;
  }
  return JSON.parse(JSON.stringify(value));
}

export function normalizeVideoProviderRequest({
  provider,
  request = null,
  metadata = null,
} = {}) {
  return {
    provider: provider || 'unknown',
    providerRequest: sanitizeObject(request),
    providerMetadata: sanitizeObject(metadata),
  };
}

export function normalizeVideoProviderError({
  message,
  code,
  category,
  status = null,
  details = null,
} = {}) {
  const error = new Error(message || 'video provider error');
  error.code = code || 'VIDEO_PROVIDER_ERROR';
  error.category = category || 'provider_generation_failed';
  error.status = status;
  error.details = details ?? null;
  return error;
}

export function normalizeVideoProviderResult({
  provider,
  shotId = null,
  preferredProvider = null,
  status = 'completed',
  videoPath = null,
  outputUrl = null,
  taskId = null,
  providerJobId = null,
  targetDurationSec = null,
  actualDurationSec = null,
  request = null,
  providerRequest = null,
  metadata = null,
  providerMetadata = null,
  extra = {},
} = {}) {
  const normalizedTaskId = taskId || providerJobId || null;
  return {
    shotId,
    preferredProvider: preferredProvider || provider || null,
    provider: provider || 'unknown',
    status,
    videoPath,
    outputUrl,
    taskId: normalizedTaskId,
    providerJobId: providerJobId || normalizedTaskId,
    providerRequest: sanitizeObject(providerRequest ?? request),
    providerMetadata: sanitizeObject(providerMetadata ?? metadata),
    targetDurationSec,
    actualDurationSec,
    ...sanitizeObject(extra),
  };
}

export const __testables = {
  sanitizeObject,
};
