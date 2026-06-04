import {
  VIDEO_TRANSPORT_ALIASES,
  createVideoRouteError,
  normalizeVideoProvider,
  normalizeVideoTransport,
  resolveVideoPackageId,
  resolveVideoPackageType,
} from './videoGenerationContract.js';

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function normalizeInteger(value) {
  if (normalizeString(value) == null) return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

const DEFAULT_SEEDANCE_MODEL = 'doubao-seedance-2-0-260128';
const DEFAULT_SORA_MODEL = 'sora-2';
const DEFAULT_HAPPYHORSE_MODEL = 'happyhorse-1.0-r2v';
const MEDIA_TASK_DEFAULT_SUBMIT_PATH = '/v1/media/generate';
const MEDIA_TASK_DEFAULT_POLL_PATH = '/v1/media/status';

function resolveKnownTransportAlias(value) {
  const normalized = normalizeString(value)?.toLowerCase() || null;
  if (!normalized || !VIDEO_TRANSPORT_ALIASES.has(normalized)) {
    return null;
  }
  return normalizeVideoTransport(normalized);
}

function inferModelFromEnv(packageType, env = process.env) {
  if (packageType === 'sequence') {
    return normalizeString(
      env.VIDEO_MODEL_SEQUENCE || env.VIDEO_FALLBACK_MODEL || env.SEEDANCE_MODEL_ID || DEFAULT_SEEDANCE_MODEL
    );
  }
  if (packageType === 'bridge') {
    return normalizeString(
      env.VIDEO_MODEL_BRIDGE || env.VIDEO_FALLBACK_MODEL || env.SEEDANCE_MODEL_ID || DEFAULT_SEEDANCE_MODEL
    );
  }
  return normalizeString(
    env.VIDEO_MODEL_SHOT || env.VIDEO_FALLBACK_MODEL || env.SEEDANCE_MODEL_ID || DEFAULT_SEEDANCE_MODEL
  );
}

function inferProviderAwareModel(provider, packageType, env = process.env) {
  if (provider === 'sora') {
    if (packageType === 'sequence') {
      return normalizeString(env.VIDEO_MODEL_SEQUENCE || env.ZDAI_SORA2_MODEL || env.VIDEO_FALLBACK_MODEL || DEFAULT_SORA_MODEL);
    }
    if (packageType === 'bridge') {
      return normalizeString(env.VIDEO_MODEL_BRIDGE || env.ZDAI_SORA2_MODEL || env.VIDEO_FALLBACK_MODEL || DEFAULT_SORA_MODEL);
    }
    return normalizeString(env.VIDEO_MODEL_SHOT || env.ZDAI_SORA2_MODEL || env.VIDEO_FALLBACK_MODEL || DEFAULT_SORA_MODEL);
  }

  if (provider === 'happyhorse') {
    if (packageType === 'sequence') {
      return normalizeString(env.VIDEO_MODEL_SEQUENCE || env.HAPPYHORSE_MODEL_ID || env.VIDEO_FALLBACK_MODEL || DEFAULT_HAPPYHORSE_MODEL);
    }
    if (packageType === 'bridge') {
      return normalizeString(env.VIDEO_MODEL_BRIDGE || env.HAPPYHORSE_MODEL_ID || env.VIDEO_FALLBACK_MODEL || DEFAULT_HAPPYHORSE_MODEL);
    }
    return normalizeString(env.VIDEO_MODEL_SHOT || env.HAPPYHORSE_MODEL_ID || env.VIDEO_FALLBACK_MODEL || DEFAULT_HAPPYHORSE_MODEL);
  }

  return inferModelFromEnv(packageType, env);
}

function inferBaseUrl(transport, env = process.env) {
  if (transport === 'gateway') {
    return normalizeString(env.VIDEO_TRANSPORT_BASE_URL || env.VERCEL_AI_GATEWAY_BASE_URL);
  }
  if (transport === 'official') {
    return normalizeString(env.VIDEO_TRANSPORT_BASE_URL || env.SEEDANCE_API_BASE_URL);
  }
  if (transport === 'dashscope_async') {
    return normalizeString(env.VIDEO_TRANSPORT_BASE_URL || env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com');
  }
  return normalizeString(
    env.VIDEO_TRANSPORT_BASE_URL ||
    env.ZDAI_SORA2_BASE_URL ||
    env.LINGKEAI_BASE_URL ||
    env.VIDEO_FALLBACK_BASE_URL
  );
}

function inferApiKey(transport, provider, env = process.env) {
  if (transport === 'gateway') {
    return normalizeString(env.VIDEO_TRANSPORT_API_KEY || env.VERCEL_AI_GATEWAY_API_KEY || env.AI_GATEWAY_API_KEY);
  }
  if (transport === 'official' && provider === 'seedance') {
    return normalizeString(env.VIDEO_TRANSPORT_API_KEY || env.SEEDANCE_API_KEY || env.ARK_API_KEY);
  }
  if (transport === 'dashscope_async') {
    return normalizeString(env.VIDEO_TRANSPORT_API_KEY || env.DASHSCOPE_API_KEY || env.BAILIAN_API_KEY);
  }
  return normalizeString(
    env.VIDEO_TRANSPORT_API_KEY ||
      env.ZDAI_SORA2_API_KEY ||
      env.LINGKEAI_API_KEY ||
      env.VIDEO_FALLBACK_API_KEY ||
      (normalizeString(env.VIDEO_FALLBACK_BASE_URL)?.toLowerCase().includes('laozhang')
        ? env.LAOZHANG_API_KEY
        : null)
  );
}

function inferLegacyTransport(provider, model, env = process.env) {
  const explicitBaseUrl = normalizeString(
    env.VIDEO_TRANSPORT_BASE_URL ||
    env.ZDAI_SORA2_BASE_URL ||
    env.LINGKEAI_BASE_URL ||
    env.VIDEO_FALLBACK_BASE_URL ||
    env.SEEDANCE_API_BASE_URL
  );
  const lowerBaseUrl = explicitBaseUrl?.toLowerCase() || '';
  const lowerModel = String(model || '').toLowerCase();

  if (normalizeString(env.VIDEO_TRANSPORT_PROVIDER)) {
    return resolveKnownTransportAlias(env.VIDEO_TRANSPORT_PROVIDER);
  }

  if (lowerBaseUrl.includes('ai-gateway.vercel.sh') || normalizeString(env.VERCEL_AI_GATEWAY_BASE_URL)) {
    return 'gateway';
  }

  if (lowerBaseUrl.includes('api.lingkeai.ai') || lowerBaseUrl.includes('zdai88.com')) {
    return 'relay_media_task';
  }

  if (lowerBaseUrl.includes('api.lk888.ai') || lowerBaseUrl.includes('api.lk666.ai')) {
    return 'relay_media_task';
  }

  if (provider === 'seedance' && (lowerBaseUrl.includes('ark.') || lowerBaseUrl.endsWith('/api/v3'))) {
    return 'official';
  }

  if (
    provider === 'happyhorse' ||
    lowerBaseUrl.includes('dashscope.aliyuncs.com') ||
    lowerBaseUrl.includes('maas.aliyuncs.com')
  ) {
    return 'dashscope_async';
  }

  if (lowerBaseUrl.includes('ai.t8star.cn') && lowerModel.includes('seedance')) {
    return 'relay_seedance_v2';
  }

  if (lowerBaseUrl.includes('/v1') || lowerBaseUrl.includes('yunwu.ai') || lowerBaseUrl.includes('laozhang')) {
    return 'relay_openai';
  }

  return provider === 'seedance' ? 'official' : 'relay_openai';
}

function validateTransportCompatibility({ provider, transport, baseUrl }) {
  const lowerBaseUrl = String(baseUrl || '').toLowerCase();
  if (transport === 'official') {
    if (!lowerBaseUrl) {
      return;
    }
    if (lowerBaseUrl.includes('/v1') || lowerBaseUrl.includes('yunwu.ai') || lowerBaseUrl.includes('laozhang')) {
      throw createVideoRouteError(`official transport 与当前 baseUrl 不兼容：${baseUrl}`, {
        code: 'VIDEO_TRANSPORT_BASEURL_MISMATCH',
        details: { provider, transport, baseUrl },
      });
    }
  }
}

function buildProviderParams(provider, env = process.env) {
  if (provider !== 'happyhorse') {
    return {};
  }
  return {
    resolution: normalizeString(env.HAPPYHORSE_RESOLUTION) || '720P',
    ratio: normalizeString(env.HAPPYHORSE_RATIO) || '9:16',
    watermark: normalizeBoolean(env.HAPPYHORSE_WATERMARK, false),
    seed: normalizeInteger(env.HAPPYHORSE_SEED),
    allowDataUrlReferences: normalizeBoolean(env.HAPPYHORSE_ALLOW_DATA_URL_REFERENCES, true),
  };
}

export function resolveVideoGenerationConfig(videoPackage = {}, options = {}, env = process.env) {
  const packageType = resolveVideoPackageType(videoPackage);
  const packageId = resolveVideoPackageId(videoPackage, packageType);
  const rawPreferredProvider =
    normalizeString(videoPackage.preferredProvider) ||
    normalizeString(options.provider) ||
    normalizeString(env.VIDEO_PROVIDER);
  const preferredTransport = resolveKnownTransportAlias(rawPreferredProvider);
  const provider =
    normalizeVideoProvider(videoPackage.provider) ||
    (preferredTransport === 'gateway' ? null : normalizeVideoProvider(videoPackage.preferredProvider)) ||
    (preferredTransport === 'gateway' ? null : normalizeVideoProvider(options.provider)) ||
    normalizeVideoProvider(env.VIDEO_PROVIDER) ||
    'seedance';
  const model = normalizeString(videoPackage.model || options.model) || inferProviderAwareModel(provider, packageType, env);
  const transport =
    normalizeVideoTransport(videoPackage.transport || options.transport) ||
    preferredTransport ||
    inferLegacyTransport(provider, model, env);
  const baseUrl = inferBaseUrl(transport, env);
  const apiKey = inferApiKey(transport, provider, env);
  const protocol =
    normalizeString(env.VIDEO_TRANSPORT_PROTOCOL) ||
    (transport === 'relay_seedance_v2'
      ? 'relay_seedance_v2'
      : transport === 'relay_openai'
        ? 'openai_videos'
        : transport === 'relay_media_task'
          ? 'media_task'
          : transport === 'dashscope_async'
            ? 'dashscope_async'
          : null);
  const submitPath =
    normalizeString(env.VIDEO_TRANSPORT_SUBMIT_PATH) ||
    (transport === 'gateway'
      ? env.VERCEL_AI_GATEWAY_VIDEO_SUBMIT_PATH
      : transport === 'official'
        ? '/contents/generations/tasks'
        : transport === 'relay_media_task'
          ? MEDIA_TASK_DEFAULT_SUBMIT_PATH
        : transport === 'relay_seedance_v2'
          ? '/api/v1/tasks/generations'
          : transport === 'dashscope_async'
            ? '/api/v1/services/aigc/video-generation/video-synthesis'
        : '/videos');
  const pollPath =
    normalizeString(env.VIDEO_TRANSPORT_POLL_PATH) ||
    (transport === 'relay_seedance_v2'
      ? '/api/v1/tasks/generations'
      : transport === 'dashscope_async'
        ? '/api/v1/tasks'
      : transport === 'relay_media_task'
        ? MEDIA_TASK_DEFAULT_POLL_PATH
        : null);
  const downloadPath = normalizeString(env.VIDEO_TRANSPORT_DOWNLOAD_PATH);

  if (!model) {
    throw createVideoRouteError(`视频模型缺失：${provider}/${packageType}/${packageId}`, {
      code: 'VIDEO_MODEL_MISSING',
      details: { provider, packageType, packageId },
    });
  }

  validateTransportCompatibility({ provider, transport, baseUrl });

  return {
    packageType,
    packageId,
    provider,
    model,
    transport,
    baseUrl,
    apiKey,
    protocol,
    submitPath,
    pollPath,
    downloadPath,
    providerParams: buildProviderParams(provider, env),
  };
}

