import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleepTimeout } from 'node:timers/promises';

import axios from 'axios';

import logger from '../utils/logger.js';
import { saveBuffer } from '../utils/fileHelper.js';
import { ensureEnglishPrompt } from '../utils/translatePrompt.js';
import {
  normalizeVideoProviderError,
  normalizeVideoProviderRequest,
  normalizeVideoProviderResult,
} from './videoProviderProtocol.js';

const DEFAULT_VIDEO_FALLBACK_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_VIDEO_FALLBACK_MODEL = 'veo-3.0-fast-generate-001';
const DEFAULT_VIDEO_FALLBACK_SECONDS = 5;
const DEFAULT_VIDEO_FALLBACK_PORTRAIT_SIZE = '720x1280';
const DEFAULT_VIDEO_FALLBACK_LANDSCAPE_SIZE = '1280x720';
const SEQUENCE_RETRY_SECONDS = [6, 4];
const DEFAULT_SEQUENCE_RETRY_ATTEMPTS = 2;
const FALLBACK_VIDEO_DEFAULT_POLL_INTERVAL_MS = Number.parseInt(process.env.VIDEO_FALLBACK_POLL_INTERVAL_MS || '5000', 10);
const FALLBACK_VIDEO_DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.VIDEO_FALLBACK_TIMEOUT_MS || '300000', 10);
const FALLBACK_VIDEO_PROTOCOL_OPENAI = 'openai_videos';
const FALLBACK_VIDEO_PROTOCOL_RELAY_SEEDANCE_V2 = 'relay_seedance_v2';

function resolveVideoFallbackBaseUrl(options = {}, env = process.env) {
  return options.baseUrl || env.VIDEO_FALLBACK_BASE_URL || DEFAULT_VIDEO_FALLBACK_BASE_URL;
}

function stripKnownApiSuffix(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
  for (const suffix of ['/v1', '/v2', '/api/v3']) {
    if (normalized.toLowerCase().endsWith(suffix)) {
      return normalized.slice(0, -suffix.length);
    }
  }
  return normalized;
}

function autoDetectFallbackVideoProtocol(options = {}, env = process.env) {
  const baseUrl = String(resolveVideoFallbackBaseUrl(options, env)).toLowerCase();
  const model = String(options.model || env.VIDEO_FALLBACK_MODEL || '').trim().toLowerCase();
  if (baseUrl.includes('ai.t8star.cn') && model.includes('seedance')) {
    return FALLBACK_VIDEO_PROTOCOL_RELAY_SEEDANCE_V2;
  }
  return FALLBACK_VIDEO_PROTOCOL_OPENAI;
}

function resolveFallbackVideoProtocol(options = {}, env = process.env) {
  const configured = String(options.protocol || env.VIDEO_FALLBACK_PROTOCOL || '').trim().toLowerCase();
  if (configured === FALLBACK_VIDEO_PROTOCOL_OPENAI || configured === FALLBACK_VIDEO_PROTOCOL_RELAY_SEEDANCE_V2) {
    return configured;
  }
  return autoDetectFallbackVideoProtocol(options, env);
}

function shouldUsePresetResolution(model, options = {}, env = process.env) {
  const baseUrl = String(resolveVideoFallbackBaseUrl(options, env)).toLowerCase();
  const normalizedModel = String(model || '').trim().toLowerCase();
  return baseUrl.includes('ai.t8star.cn') && normalizedModel.includes('grok');
}

function resolveFallbackVideoApiKey(options = {}, env = process.env) {
  if (options.apiKey) {
    return options.apiKey;
  }
  if (env.VIDEO_FALLBACK_API_KEY) {
    return env.VIDEO_FALLBACK_API_KEY;
  }
  const baseUrl = String(resolveVideoFallbackBaseUrl(options, env)).toLowerCase();
  if (baseUrl.includes('laozhang')) {
    return env.LAOZHANG_API_KEY || null;
  }
  return null;
}

function createProviderError(message, extras = {}) {
  return normalizeVideoProviderError({
    message,
    code: extras.code || 'SORA2_VIDEO_ERROR',
    category: extras.category || 'provider_generation_failed',
    status: extras.status || null,
    details: extras.details || null,
  });
}

function normalizeDurationBucket(durationTargetSec) {
  const target = Number(durationTargetSec);
  if (!Number.isFinite(target) || target <= 10) {
    return 10;
  }
  return 15;
}

function inferRatio(shotPackage, env = process.env) {
  if (shotPackage?.cameraSpec?.ratio) {
    return shotPackage.cameraSpec.ratio;
  }
  if (env.VIDEO_ASPECT_RATIO) {
    return env.VIDEO_ASPECT_RATIO;
  }
  return '9:16';
}

function isLandscapeRatio(ratio) {
  return String(ratio || '').trim() === '16:9';
}

function resolveFallbackVideoModel(shotPackage, env = process.env) {
  return String(env.VIDEO_FALLBACK_MODEL || DEFAULT_VIDEO_FALLBACK_MODEL).trim();
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function inferVideoSize(shotPackage, env = process.env) {
  if (env.VIDEO_FALLBACK_SIZE) return env.VIDEO_FALLBACK_SIZE;

  const outputWidth = parsePositiveInt(env.VIDEO_WIDTH);
  const outputHeight = parsePositiveInt(env.VIDEO_HEIGHT);
  if (outputWidth && outputHeight) {
    return `${outputWidth}x${outputHeight}`;
  }

  const ratio = inferRatio(shotPackage, env);
  return isLandscapeRatio(ratio) ? DEFAULT_VIDEO_FALLBACK_LANDSCAPE_SIZE : DEFAULT_VIDEO_FALLBACK_PORTRAIT_SIZE;
}

function normalizeVideoFallbackSize(size, options = {}, env = process.env) {
  const normalized = String(size || '').trim();
  if (!normalized) {
    return normalized;
  }

  const model = options.model || env.VIDEO_FALLBACK_MODEL || DEFAULT_VIDEO_FALLBACK_MODEL;
  if (!shouldUsePresetResolution(model, options, env)) {
    return normalized;
  }

  const canonical = normalized.toLowerCase();
  if (canonical === '720x1280' || canonical === '1280x720' || canonical === '720p') {
    return '720P';
  }
  if (canonical === '1080x1920' || canonical === '1920x1080' || canonical === '1080p') {
    return '1080P';
  }

  return normalized;
}

function resolveRequestedSeconds(shotPackage, env = process.env) {
  if (isSequencePackage(shotPackage)) {
    const explicitSequence = Number(env.VIDEO_FALLBACK_SEQUENCE_SECONDS);
    if (Number.isFinite(explicitSequence) && explicitSequence > 0) {
      return explicitSequence;
    }

    const sequenceTarget = Number(shotPackage?.durationTargetSec);
    if (Number.isFinite(sequenceTarget) && sequenceTarget > 0) {
      return Math.max(Math.round(sequenceTarget), 1);
    }

    return DEFAULT_VIDEO_FALLBACK_SECONDS;
  }

  const explicit = Number(env.VIDEO_FALLBACK_SECONDS);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const target = Number(shotPackage?.durationTargetSec);
  if (Number.isFinite(target) && target > 0) {
    return Math.max(Math.round(target), 1);
  }

  return DEFAULT_VIDEO_FALLBACK_SECONDS;
}

function parseModelCandidateList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildFallbackVideoModelCandidates(shotPackage, env = process.env) {
  const primaryModel = resolveFallbackVideoModel(shotPackage, env);
  const configuredCandidates = isSequencePackage(shotPackage)
    ? parseModelCandidateList(env.VIDEO_FALLBACK_SEQUENCE_MODEL_CANDIDATES || env.VIDEO_FALLBACK_MODEL_CANDIDATES)
    : parseModelCandidateList(env.VIDEO_FALLBACK_MODEL_CANDIDATES);

  return [...new Set([primaryModel, ...configuredCandidates].filter(Boolean))];
}

function isSequencePackage(shotPackage) {
  return Boolean(shotPackage?.sequenceId);
}

async function buildPromptText(shotPackage) {
  const rawPrompt = [
    shotPackage?.visualGoal || '',
    shotPackage?.cameraSpec?.moveType ? `camera motion: ${shotPackage.cameraSpec.moveType}` : '',
    shotPackage?.cameraSpec?.framing ? `framing: ${shotPackage.cameraSpec.framing}` : '',
  ]
    .filter(Boolean)
    .join('. ');

  return ensureEnglishPrompt(rawPrompt);
}

export async function buildFallbackVideoRequest(shotPackage, env = process.env) {
  const referenceImage = shotPackage?.referenceImages?.[0]?.path || null;
  const ratio = inferRatio(shotPackage, env);
  const size = normalizeVideoFallbackSize(inferVideoSize(shotPackage, env), {}, env);

  return {
    model: resolveFallbackVideoModel(shotPackage, env),
    prompt: await buildPromptText(shotPackage),
    imagePath: referenceImage,
    ratio,
    duration: normalizeDurationBucket(shotPackage?.durationTargetSec),
    seconds: resolveRequestedSeconds(shotPackage, env),
    size,
  };
}

async function buildFallbackVideoRequestCandidates(shotPackage, env = process.env) {
  const baseRequest = await buildFallbackVideoRequest(shotPackage, env);
  const candidates = [baseRequest];

  if (!isSequencePackage(shotPackage)) {
    return candidates;
  }

  const explicitSeconds = Number(env.VIDEO_FALLBACK_SEQUENCE_SECONDS);
  if (Number.isFinite(explicitSeconds) && explicitSeconds > 0) {
    return candidates;
  }

  for (const seconds of SEQUENCE_RETRY_SECONDS) {
    if (seconds >= Number(baseRequest.seconds || 0)) {
      continue;
    }
    candidates.push({
      ...baseRequest,
      seconds,
      duration: normalizeDurationBucket(seconds),
    });
  }

  return candidates;
}

function resolveSequenceRetryAttempts(shotPackage, env = process.env) {
  const globalRetries = Number.parseInt(env.VIDEO_FALLBACK_RETRY_ATTEMPTS || '', 10);
  if (!isSequencePackage(shotPackage)) {
    return Number.isFinite(globalRetries) && globalRetries > 0 ? globalRetries : 2;
  }

  const configured = Number.parseInt(env.VIDEO_FALLBACK_SEQUENCE_RETRY_ATTEMPTS || '', 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_SEQUENCE_RETRY_ATTEMPTS;
}

async function buildFallbackVideoAttemptPlans(shotPackage, env = process.env) {
  const requestCandidates = await buildFallbackVideoRequestCandidates(shotPackage, env);
  const modelCandidates = buildFallbackVideoModelCandidates(shotPackage, env);
  const retryAttempts = resolveSequenceRetryAttempts(shotPackage, env);
  const plans = [];

  for (let requestIndex = 0; requestIndex < requestCandidates.length; requestIndex += 1) {
    for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
      for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
        plans.push({
          requestIndex,
          modelIndex,
          attempt,
          request: {
            ...requestCandidates[requestIndex],
            model: modelCandidates[modelIndex],
          },
        });
      }
    }
  }

  return plans;
}

function isUnavailableChannelError(error) {
  const message = String(
    error?.response?.data?.error?.message ||
      error?.details?.error?.message ||
      error?.message ||
      ''
  );
  return message.includes('无可用渠道');
}

export function classifyFallbackVideoError(error) {
  const status = error?.response?.status ?? error?.status ?? null;

  if (error?.category) {
    return createProviderError(error.message || 'Sora2 生成失败', {
      code: error.code || 'SORA2_VIDEO_ERROR',
      category: error.category,
      status,
      details: error.details || error?.response?.data || null,
    });
  }

  if (status === 401 || status === 403) {
    return createProviderError(error.message || 'Sora2 鉴权失败', {
      code: 'SORA2_AUTH_ERROR',
      category: 'provider_auth_error',
      status,
      details: error?.response?.data || null,
    });
  }

  if (status === 429) {
    return createProviderError(error.message || 'Sora2 限流', {
      code: 'SORA2_RATE_LIMIT',
      category: 'provider_rate_limit',
      status,
      details: error?.response?.data || null,
    });
  }

  if (status >= 400 && status < 500) {
    return createProviderError(error.message || 'Sora2 请求参数错误', {
      code: 'SORA2_INVALID_REQUEST',
      category: 'provider_invalid_request',
      status,
      details: error?.response?.data || null,
    });
  }

  if (status >= 500) {
    return createProviderError(error.message || 'Sora2 服务端异常', {
      code: 'SORA2_SERVER_ERROR',
      category: 'provider_generation_failed',
      status,
      details: error?.response?.data || null,
    });
  }

  if (error?.code === 'ECONNABORTED' || String(error?.message || '').toLowerCase().includes('timeout')) {
    return createProviderError(error.message || 'Sora2 请求超时', {
      code: 'SORA2_TIMEOUT',
      category: 'provider_timeout',
      status,
    });
  }

  return createProviderError(error?.message || 'Sora2 生成失败', {
    code: error?.code || 'SORA2_UNKNOWN_ERROR',
    category: 'provider_generation_failed',
    status,
    details: error?.response?.data || null,
  });
}

function buildMultipartBody(request) {
  const form = new FormData();
  form.append('model', request.model);
  if (request.prompt) {
    form.append('prompt', request.prompt);
  }
  if (request.seconds) {
    form.append('seconds', String(request.seconds));
  }
  if (request.size) {
    form.append('size', String(request.size));
  }
  if (request.imagePath) {
    const buffer = fs.readFileSync(request.imagePath);
    form.append('image', new Blob([buffer]), path.basename(request.imagePath));
  }
  return form;
}

function createDefaultHttpClient(apiKey, options = {}, env = process.env) {
  const baseUrl = resolveVideoFallbackBaseUrl(options, env);
  const timeoutMs = options.timeoutMs || FALLBACK_VIDEO_DEFAULT_TIMEOUT_MS;

  return {
    async postMultipart(url, formData) {
      const response = await fetch(`${baseUrl}${url}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw { message: data?.error?.message || `HTTP ${response.status}`, response: { status: response.status, data } };
      }
      return { data };
    },
    async get(url) {
      return axios.get(url.startsWith('http') ? url : `${baseUrl}${url}`, {
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
    },
    async postJson(url, body) {
      return axios.post(url.startsWith('http') ? url : `${baseUrl}${url}`, body, {
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    },
    async getBinary(url) {
      return axios.get(url.startsWith('http') ? url : `${baseUrl}${url}`, {
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
    },
  };
}

function normalizeTaskStatus(task) {
  return String(task?.status || task?.state || '').trim().toUpperCase();
}

function normalizeRelaySeedanceTaskStatus(task) {
  return String(task?.status || '').trim().toUpperCase();
}

function buildRelaySeedanceV2Body(request) {
  const payload = {
    model: request.model,
    prompt: request.prompt,
  };
  if (request.imagePath) {
    payload.image_url = `data:image/png;base64,${fs.readFileSync(request.imagePath).toString('base64')}`;
  }
  return payload;
}

function extractRelaySeedanceVideoUrl(task) {
  return task?.data?.output || task?.data?.video_url || task?.video_url || null;
}

function buildAttemptMetadata(shotPackage, attemptPlan, requestBody) {
  return {
    model: requestBody.model,
    duration: requestBody.duration,
    seconds: requestBody.seconds,
    size: requestBody.size,
    ratio: requestBody.ratio,
    requestIndex: attemptPlan.requestIndex,
    modelIndex: attemptPlan.modelIndex,
    attempt: attemptPlan.attempt,
    protocol: requestBody.protocol || null,
    shotId: shotPackage?.shotId || null,
    sequenceId: shotPackage?.sequenceId || null,
  };
}

function buildFallbackRequestSummary(shotPackage, requestBody) {
  return normalizeVideoProviderRequest({
    provider: 'sora2',
    request: {
      model: requestBody.model,
      duration: requestBody.duration,
      seconds: requestBody.seconds,
      size: requestBody.size,
      ratio: requestBody.ratio,
      prompt: requestBody.prompt,
      hasReferenceImage: Boolean(requestBody.imagePath),
    },
    metadata: {
      shotId: shotPackage?.shotId || null,
      sequenceId: shotPackage?.sequenceId || null,
      referenceImageCount: Array.isArray(shotPackage?.referenceImages) ? shotPackage.referenceImages.length : 0,
      protocol: requestBody.protocol || FALLBACK_VIDEO_PROTOCOL_OPENAI,
    },
  });
}

function buildFallbackVideoResult(shotPackage, requestBody, outputPath, taskId, outputUrl, requestSummary, attemptedModels, attemptedRequests, extraMetadata = {}) {
  return normalizeVideoProviderResult({
    provider: 'sora2',
    shotId: shotPackage?.shotId || null,
    preferredProvider: shotPackage?.preferredProvider || 'sora2',
    model: requestBody.model,
    videoPath: outputPath,
    outputUrl,
    taskId,
    providerJobId: taskId,
    targetDurationSec: shotPackage?.durationTargetSec || requestBody.duration,
    actualDurationSec: requestBody.duration,
    providerRequest: requestSummary.providerRequest,
    providerMetadata: {
      ...requestSummary.providerMetadata,
      ...extraMetadata,
    },
    extra: {
      model: requestBody.model,
      attemptedModels,
      attemptedRequests,
      requestBody: {
        model: requestBody.model,
        duration: requestBody.duration,
        seconds: requestBody.seconds,
        size: requestBody.size,
        ratio: requestBody.ratio,
        protocol: requestBody.protocol || FALLBACK_VIDEO_PROTOCOL_OPENAI,
      },
    },
  });
}

function shouldRetryWithNextRequestVariant(error) {
  return (
    error?.category === 'provider_generation_failed' ||
    error?.category === 'provider_timeout' ||
    error?.category === 'provider_rate_limit'
  );
}

export async function fallbackImageToVideo(shotPackage, outputPath, options = {}, env = process.env) {
  const apiKey = resolveFallbackVideoApiKey(options, env);
  if (!apiKey) {
    throw createProviderError('缺少 VIDEO_FALLBACK_API_KEY（或 laozhang 场景下的 LAOZHANG_API_KEY），无法生成备选动态镜头', {
      code: 'SORA2_AUTH_MISSING',
      category: 'provider_auth_error',
    });
  }

  const attemptPlans = await buildFallbackVideoAttemptPlans(shotPackage, env);
  const protocol = resolveFallbackVideoProtocol(options, env);

  const httpClient = options.httpClient || createDefaultHttpClient(apiKey, options, env);
  const sleep = options.sleep || ((ms) => sleepTimeout(ms));
  const pollIntervalMs = options.pollIntervalMs || FALLBACK_VIDEO_DEFAULT_POLL_INTERVAL_MS;
  const overallTimeoutMs = options.overallTimeoutMs || FALLBACK_VIDEO_DEFAULT_TIMEOUT_MS;
  const attemptedModels = [];
  const attemptedRequests = [];

  try {
    let lastClassifiedError = null;
    for (let planIndex = 0; planIndex < attemptPlans.length; planIndex += 1) {
      const attemptPlan = attemptPlans[planIndex];
      const requestBody = {
        ...attemptPlan.request,
        protocol,
      };
      attemptedModels.push(requestBody.model);
      attemptedRequests.push(buildAttemptMetadata(shotPackage, attemptPlan, requestBody));

      try {
        if (protocol === FALLBACK_VIDEO_PROTOCOL_RELAY_SEEDANCE_V2) {
          const baseHost = stripKnownApiSuffix(resolveVideoFallbackBaseUrl(options, env));
          const createResponse = await httpClient.postJson(`${baseHost}/v2/videos/generations`, buildRelaySeedanceV2Body(requestBody));
          const taskId = createResponse?.data?.task_id || createResponse?.data?.id || null;
          if (!taskId) {
            throw createProviderError('Relay Seedance v2 未返回任务 ID', {
              code: 'SORA2_INVALID_RESPONSE',
              category: 'provider_generation_failed',
              details: createResponse?.data || null,
            });
          }

          const startedAt = Date.now();
          while (Date.now() - startedAt < overallTimeoutMs) {
            await sleep(pollIntervalMs);
            const taskResponse = await httpClient.get(`${baseHost}/v2/videos/generations/${taskId}`);
            const task = taskResponse?.data || {};
            const status = normalizeRelaySeedanceTaskStatus(task);

            if (status === 'SUCCESS') {
              const videoUrl = extractRelaySeedanceVideoUrl(task);
              if (!videoUrl) {
                throw createProviderError('Relay Seedance v2 任务成功但未返回视频地址', {
                  code: 'SORA2_MISSING_OUTPUT',
                  category: 'provider_generation_failed',
                  details: task,
                });
              }
              const binary = await httpClient.getBinary(videoUrl);
              saveBuffer(outputPath, Buffer.from(binary.data));
              const requestSummary = buildFallbackRequestSummary(shotPackage, requestBody);
              return buildFallbackVideoResult(
                shotPackage,
                requestBody,
                outputPath,
                taskId,
                videoUrl,
                requestSummary,
                attemptedModels,
                attemptedRequests,
                { progress: task?.progress || null }
              );
            }

            if (status === 'FAIL' || status === 'FAILED' || status === 'ERROR') {
              throw createProviderError(task?.fail_reason || task?.error?.message || `Relay Seedance v2 任务${status}`, {
                code: task?.error?.code || 'SORA2_TASK_FAILED',
                category: 'provider_generation_failed',
                details: task,
              });
            }
          }

          throw createProviderError('Relay Seedance v2 任务轮询超时', {
            code: 'SORA2_TIMEOUT',
            category: 'provider_timeout',
          });
        }

        const createResponse = await httpClient.postMultipart('/videos', buildMultipartBody(requestBody));

        const taskId = createResponse?.data?.id || createResponse?.data?.taskId || null;
        if (!taskId) {
          throw createProviderError('Sora2 未返回任务 ID', {
            code: 'SORA2_INVALID_RESPONSE',
            category: 'provider_generation_failed',
            details: createResponse?.data || null,
          });
        }

        const startedAt = Date.now();
        while (Date.now() - startedAt < overallTimeoutMs) {
          await sleep(pollIntervalMs);
          const taskResponse = await httpClient.get(`/videos/${taskId}`);
          const task = taskResponse?.data || {};
          const status = normalizeTaskStatus(task);

          if (status === 'SUCCEEDED' || status === 'COMPLETED') {
            const binary = await httpClient.getBinary(`/videos/${taskId}/content`);
            saveBuffer(outputPath, Buffer.from(binary.data));
            const requestSummary = buildFallbackRequestSummary(shotPackage, requestBody);
            return buildFallbackVideoResult(
              shotPackage,
              requestBody,
              outputPath,
              taskId,
              `/videos/${taskId}/content`,
              requestSummary,
              attemptedModels,
              attemptedRequests
            );
          }

          if (status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED') {
            throw createProviderError(task?.error?.message || `Sora2 任务${status}`, {
              code: task?.error?.code || 'SORA2_TASK_FAILED',
              category: status === 'EXPIRED' ? 'provider_timeout' : 'provider_generation_failed',
              details: task,
            });
          }
        }

        throw createProviderError('Sora2 任务轮询超时', {
          code: 'SORA2_TIMEOUT',
          category: 'provider_timeout',
        });
      } catch (error) {
        const classifiedError = classifyFallbackVideoError(error);
        classifiedError.attemptedModels = attemptedModels;
        classifiedError.attemptedRequests = attemptedRequests;
        lastClassifiedError = classifiedError;

        const hasNextAttemptPlan = planIndex < attemptPlans.length - 1;
        if (!hasNextAttemptPlan || !shouldRetryWithNextRequestVariant(classifiedError)) {
          throw classifiedError;
        }

        const retryDelay = 5000 * (planIndex + 1);
        logger.info('FallbackVideo', `重试第 ${planIndex + 1} 次（${retryDelay / 1000}s 后）：${classifiedError.message || 'unknown error'}`);
        await sleep(retryDelay);
      }
    }

    throw lastClassifiedError || createProviderError('Sora2 生成失败', {
      code: 'SORA2_UNKNOWN_ERROR',
      category: 'provider_generation_failed',
    });
  } catch (error) {
    const classifiedError = error?.category ? error : classifyFallbackVideoError(error);
    classifiedError.attemptedModels = classifiedError.attemptedModels || attemptedModels;
    classifiedError.attemptedRequests = classifiedError.attemptedRequests || attemptedRequests;
    throw classifiedError;
  }
}

export async function createFallbackVideoClip(shotPackage, outputPath, options = {}) {
  logger.info('FallbackVideo', `生成备选动态镜头 [sora2]：${path.basename(outputPath)}`);
  return fallbackImageToVideo(shotPackage, outputPath, options, options.env || process.env);
}

export const __testables = {
  buildPromptText,
  buildFallbackVideoRequest,
  buildFallbackVideoAttemptPlans,
  buildFallbackVideoRequestCandidates,
  buildFallbackVideoModelCandidates,
  classifyFallbackVideoError,
  createProviderError,
  inferRatio,
  inferVideoSize,
  isSequencePackage,
  isUnavailableChannelError,
  normalizeDurationBucket,
  normalizeVideoFallbackSize,
  parsePositiveInt,
  resolveRequestedSeconds,
  resolveFallbackVideoApiKey,
  resolveVideoFallbackBaseUrl,
  resolveFallbackVideoModel,
  resolveSequenceRetryAttempts,
  shouldRetryWithNextRequestVariant,
};
