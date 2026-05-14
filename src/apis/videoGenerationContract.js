import { createHash, randomUUID } from 'node:crypto';

import { normalizeVideoProviderError } from './videoProviderProtocol.js';

export const VIDEO_PROVIDER_ALIASES = new Map([
  ['seedance', 'seedance'],
  ['veo', 'veo'],
  ['sora', 'sora'],
  ['sora2', 'sora'],
  ['runway', 'sora'],
  ['fallback_video', 'sora'],
]);

export const VIDEO_TRANSPORT_ALIASES = new Map([
  ['official', 'official'],
  ['relay_openai', 'relay_openai'],
  ['openai_videos', 'relay_openai'],
  ['relay_seedance_v2', 'relay_seedance_v2'],
  ['gateway', 'gateway'],
  ['vercel', 'gateway'],
  ['vercel_ai_gateway', 'gateway'],
]);

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function resolveVideoPackageType(videoPackage = {}) {
  if (videoPackage.packageType) return String(videoPackage.packageType);
  if (videoPackage.sequenceId) return 'sequence';
  if (videoPackage.bridgeId) return 'bridge';
  return 'shot';
}

export function resolveVideoPackageId(videoPackage = {}, packageType = resolveVideoPackageType(videoPackage)) {
  if (packageType === 'sequence') return normalizeString(videoPackage.sequenceId);
  if (packageType === 'bridge') return normalizeString(videoPackage.bridgeId);
  return normalizeString(videoPackage.shotId);
}

export function normalizeVideoProvider(value) {
  const normalized = normalizeString(value)?.toLowerCase() || null;
  return normalized ? VIDEO_PROVIDER_ALIASES.get(normalized) || normalized : null;
}

export function normalizeVideoTransport(value) {
  const normalized = normalizeString(value)?.toLowerCase() || null;
  return normalized ? VIDEO_TRANSPORT_ALIASES.get(normalized) || normalized : null;
}

export function buildVideoRequestId(parts = {}) {
  const digest = createHash('sha1')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 12);
  return `video_req_${digest}_${randomUUID().slice(0, 8)}`;
}

export function summarizeReferenceBindings(request = {}) {
  return {
    imageCount: Array.isArray(request.referenceImages) ? request.referenceImages.length : 0,
    videoCount: Array.isArray(request.referenceVideos) ? request.referenceVideos.length : 0,
    hasFirstFrame: Boolean(
      (Array.isArray(request.referenceImages) ? request.referenceImages : []).some(
        (entry) => entry?.role === 'first_frame' || entry?.role === 'first_frame_keyframe'
      )
    ),
    hasLastFrame: Boolean(
      (Array.isArray(request.referenceImages) ? request.referenceImages : []).some(
        (entry) => entry?.role === 'last_frame' || entry?.role === 'last_frame_keyframe'
      )
    ),
  };
}

export function createVideoRouteError(message, extras = {}) {
  return normalizeVideoProviderError({
    message: message || 'Video route not found',
    code: extras.code || 'VIDEO_ROUTE_NOT_FOUND',
    category: extras.category || 'provider_invalid_request',
    status: extras.status || null,
    details: extras.details || null,
  });
}

export function createVideoGenerationRequest({
  packageType,
  packageId,
  provider,
  model,
  transport,
  prompt = '',
  referenceImages = [],
  referenceVideos = [],
  durationSec = null,
  ratio = null,
  outputPath = null,
  params = {},
  metadata = {},
  requestId = null,
} = {}) {
  const normalizedProvider = normalizeVideoProvider(provider);
  const normalizedTransport = normalizeVideoTransport(transport);
  const normalizedModel = normalizeString(model);
  const normalizedPackageType = normalizeString(packageType);
  const normalizedPackageId = normalizeString(packageId);

  if (!normalizedProvider || !normalizedModel || !normalizedTransport || !normalizedPackageType || !normalizedPackageId) {
    throw createVideoRouteError('VideoGenerationRequest 缺少关键字段 provider/model/transport/packageType/packageId', {
      code: 'VIDEO_REQUEST_INVALID',
      details: {
        provider: normalizedProvider,
        model: normalizedModel,
        transport: normalizedTransport,
        packageType: normalizedPackageType,
        packageId: normalizedPackageId,
      },
    });
  }

  const nextMetadata = {
    requestedProvider: normalizedProvider,
    ...metadata,
  };

  return {
    requestId:
      requestId ||
      buildVideoRequestId({
        packageType: normalizedPackageType,
        packageId: normalizedPackageId,
        provider: normalizedProvider,
        model: normalizedModel,
        transport: normalizedTransport,
      }),
    packageType: normalizedPackageType,
    packageId: normalizedPackageId,
    provider: normalizedProvider,
    model: normalizedModel,
    transport: normalizedTransport,
    prompt: normalizeString(prompt) || '',
    referenceImages: Array.isArray(referenceImages) ? referenceImages : [],
    referenceVideos: Array.isArray(referenceVideos) ? referenceVideos : [],
    durationSec: Number.isFinite(Number(durationSec)) ? Number(durationSec) : null,
    ratio: normalizeString(ratio),
    outputPath: normalizeString(outputPath),
    params: params && typeof params === 'object' ? params : {},
    metadata: nextMetadata,
  };
}

export function createVideoGenerationResult({
  request,
  status = 'failed',
  videoPath = null,
  outputUrl = null,
  taskId = null,
  providerRequest = null,
  providerResponse = null,
  failureCategory = null,
  errorCode = null,
  errorStatus = null,
  errorDetails = null,
  extra = {},
} = {}) {
  return {
    requestId: request?.requestId || null,
    packageType: request?.packageType || null,
    packageId: request?.packageId || null,
    provider: request?.provider || null,
    model: request?.model || null,
    transport: request?.transport || null,
    status,
    videoPath: normalizeString(videoPath),
    outputUrl: normalizeString(outputUrl),
    taskId: normalizeString(taskId),
    providerRequest: providerRequest || null,
    providerResponse: providerResponse || null,
    failureCategory: normalizeString(failureCategory),
    errorCode: normalizeString(errorCode),
    errorStatus: Number.isFinite(Number(errorStatus)) ? Number(errorStatus) : null,
    errorDetails: errorDetails ?? null,
    referenceBindingSummary: summarizeReferenceBindings(request),
    fallbackReason: null,
    ...extra,
  };
}

