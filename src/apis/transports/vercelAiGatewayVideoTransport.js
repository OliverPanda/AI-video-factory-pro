import fs from 'node:fs';

import axios from 'axios';

import {
  normalizeVideoProviderError,
  normalizeVideoProviderRequest,
  normalizeVideoProviderResult,
} from '../videoProviderProtocol.js';

const DEFAULT_BASE_URL = 'https://ai-gateway.vercel.sh';
const DEFAULT_SUBMIT_PATH = '/v1/video/generations';
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 600000;

function resolvePackageType(videoPackage = {}) {
  if (videoPackage.packageType) return videoPackage.packageType;
  if (videoPackage.sequenceId) return 'sequence';
  if (videoPackage.bridgeId) return 'bridge';
  return 'shot';
}

function resolveEntityId(videoPackage = {}, packageType = resolvePackageType(videoPackage)) {
  if (packageType === 'sequence') return videoPackage.sequenceId || null;
  if (packageType === 'bridge') return videoPackage.bridgeId || null;
  return videoPackage.shotId || null;
}

function resolveModel(videoPackage = {}, env = process.env) {
  const packageType = resolvePackageType(videoPackage);
  if (videoPackage.model) return videoPackage.model;

  if (packageType === 'sequence') {
    return env.VIDEO_MODEL_SEQUENCE || env.VIDEO_MODEL_SHOT || 'bytedance/seedance-v1.5-pro';
  }
  if (packageType === 'bridge') {
    return env.VIDEO_MODEL_BRIDGE || env.VIDEO_MODEL_SHOT || 'bytedance/seedance-v1.5-pro';
  }
  return env.VIDEO_MODEL_SHOT || 'bytedance/seedance-v1.5-pro';
}

function toReferenceDescriptor(reference = {}, fallbackRole) {
  return {
    type: reference.type || 'image',
    role: reference.role || fallbackRole || 'reference',
    path: reference.path || null,
    shotId: reference.shotId || null,
  };
}

function buildPromptText(videoPackage = {}) {
  if (Array.isArray(videoPackage.seedancePromptBlocks) && videoPackage.seedancePromptBlocks.length > 0) {
    return videoPackage.seedancePromptBlocks
      .map((block) => String(block?.text || '').trim())
      .filter(Boolean)
      .join('. ');
  }

  if (Array.isArray(videoPackage.promptDirectives) && videoPackage.promptDirectives.length > 0) {
    return videoPackage.promptDirectives.filter(Boolean).join('. ');
  }

  return [
    videoPackage.visualGoal,
    videoPackage.sequenceContextSummary,
    videoPackage.providerRequestHints?.sequenceGoal,
  ]
    .filter(Boolean)
    .join('. ');
}

export function buildVercelAiGatewayVideoRequest(videoPackage = {}, env = process.env) {
  const packageType = resolvePackageType(videoPackage);
  const entityId = resolveEntityId(videoPackage, packageType);
  const model = resolveModel(videoPackage, env);
  const prompt = buildPromptText(videoPackage);
  const references = [];

  for (const [index, referenceImage] of (videoPackage.referenceImages || []).entries()) {
    references.push(toReferenceDescriptor(referenceImage, index === 0 ? 'first_frame' : 'reference_image'));
  }

  for (const referenceVideo of videoPackage.referenceVideos || []) {
    references.push(toReferenceDescriptor(referenceVideo, 'reference_video'));
  }

  if (videoPackage.fromReferenceImage) {
    references.push({
      type: 'image',
      role: 'first_frame',
      path: videoPackage.fromReferenceImage,
      shotId: videoPackage.fromShotRef?.shotId || null,
    });
  }

  if (videoPackage.toReferenceImage) {
    references.push({
      type: 'image',
      role: 'last_frame',
      path: videoPackage.toReferenceImage,
      shotId: videoPackage.toShotRef?.shotId || null,
    });
  }

  return {
    model,
    packageType,
    entityId,
    prompt,
    durationSec: videoPackage.durationTargetSec || null,
    aspectRatio: videoPackage.cameraSpec?.ratio || env.SEEDANCE_VIDEO_RATIO || env.VIDEO_ASPECT_RATIO || '9:16',
    references,
    providerRequestHints: videoPackage.providerRequestHints || null,
  };
}

export function classifyVercelAiGatewayVideoError(error) {
  const status = error?.response?.status ?? error?.status ?? null;
  const details = error?.response?.data || error?.details || null;

  if (error?.category) {
    return normalizeVideoProviderError({
      message: error.message,
      code: error.code || 'VERCEL_AI_GATEWAY_VIDEO_ERROR',
      category: error.category,
      status,
      details,
    });
  }

  if (status === 401 || status === 403) {
    return normalizeVideoProviderError({
      message: error?.message || 'Vercel AI Gateway 鉴权失败',
      code: 'VERCEL_AI_GATEWAY_AUTH_ERROR',
      category: 'provider_auth_error',
      status,
      details,
    });
  }

  if (status >= 400 && status < 500) {
    return normalizeVideoProviderError({
      message: error?.message || 'Vercel AI Gateway 请求参数错误',
      code: 'VERCEL_AI_GATEWAY_INVALID_REQUEST',
      category: 'provider_invalid_request',
      status,
      details,
    });
  }

  if (error?.code === 'ECONNABORTED' || String(error?.message || '').toLowerCase().includes('timeout')) {
    return normalizeVideoProviderError({
      message: error?.message || 'Vercel AI Gateway 请求超时',
      code: 'VERCEL_AI_GATEWAY_TIMEOUT',
      category: 'provider_timeout',
      status,
      details,
    });
  }

  return normalizeVideoProviderError({
    message: error?.message || 'Vercel AI Gateway 视频生成失败',
    code: error?.code || 'VERCEL_AI_GATEWAY_VIDEO_ERROR',
    category: 'provider_generation_failed',
    status,
    details,
  });
}

export function createVercelAiGatewayVideoTransport(options = {}) {
  const env = options.env || process.env;
  const apiKey = options.apiKey || env.VERCEL_AI_GATEWAY_API_KEY || env.AI_GATEWAY_API_KEY || null;
  const httpClient = options.httpClient || axios.create({
    baseURL: options.baseUrl || env.VERCEL_AI_GATEWAY_BASE_URL || DEFAULT_BASE_URL,
    timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': 'application/json',
    },
  });
  const binaryHttpClient = options.binaryHttpClient || axios;
  const sleep = options.sleep || (async (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const submitPath = options.submitPath || env.VERCEL_AI_GATEWAY_VIDEO_SUBMIT_PATH || DEFAULT_SUBMIT_PATH;
  const pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  const overallTimeoutMs = options.overallTimeoutMs || DEFAULT_TIMEOUT_MS;
  const taskRegistry = new Map();

  return {
    async submitVideoGeneration(videoPackage, submitOptions = {}) {
      const requestBody = buildVercelAiGatewayVideoRequest(videoPackage, submitOptions.env || env);
      const requestSummary = normalizeVideoProviderRequest({
        provider: 'vercel_ai_gateway',
        request: requestBody,
        metadata: {
          packageType: requestBody.packageType,
          entityId: requestBody.entityId,
          preferredProvider: videoPackage.preferredProvider || null,
          model: requestBody.model,
        },
      });

      try {
        const response = await httpClient.post(submitPath, requestBody);
        const taskId = response?.data?.id || response?.data?.taskId || null;
        if (!taskId) {
          throw normalizeVideoProviderError({
            message: 'Vercel AI Gateway 未返回任务 ID',
            code: 'VERCEL_AI_GATEWAY_INVALID_RESPONSE',
            category: 'provider_generation_failed',
            details: response?.data || null,
          });
        }

        taskRegistry.set(taskId, {
          videoPackage,
          requestBody,
          requestSummary,
        });

        return {
          taskId,
          provider: 'vercel_ai_gateway',
          model: requestBody.model,
          outputUrl: response?.data?.outputUrl || response?.data?.url || null,
          providerRequest: requestSummary.providerRequest,
          providerMetadata: requestSummary.providerMetadata,
        };
      } catch (error) {
        throw classifyVercelAiGatewayVideoError(error);
      }
    },

    async pollVideoGeneration(taskId) {
      const taskEntry = taskRegistry.get(taskId);
      if (!taskEntry) {
        throw new Error(`Unknown Vercel AI Gateway task: ${taskId}`);
      }

      const startedAt = Date.now();
      while (Date.now() - startedAt < overallTimeoutMs) {
        try {
          const response = await httpClient.get(`${submitPath}/${taskId}`);
          const payload = response?.data || {};
          const status = String(payload.status || '').toUpperCase();
          if (status === 'SUCCEEDED' || status === 'COMPLETED') {
            return {
              status: 'COMPLETED',
              outputUrl: payload.outputUrl || payload.url || payload.output?.videoUrl || null,
              actualDurationSec: payload.actualDurationSec || payload.durationSec || null,
            };
          }
          if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
            throw normalizeVideoProviderError({
              message: payload.error?.message || `Vercel AI Gateway 任务${status}`,
              code: payload.error?.code || 'VERCEL_AI_GATEWAY_TASK_FAILED',
              category: 'provider_generation_failed',
              details: payload,
            });
          }
        } catch (error) {
          throw classifyVercelAiGatewayVideoError(error);
        }

        await sleep(pollIntervalMs);
      }

      throw normalizeVideoProviderError({
        message: 'Vercel AI Gateway 任务轮询超时',
        code: 'VERCEL_AI_GATEWAY_TIMEOUT',
        category: 'provider_timeout',
      });
    },

    async downloadVideoGeneration(outputUrl, outputPath, context = {}) {
      const preferredProvider = context.preferredProvider || 'vercel_ai_gateway';
      const entityId = context.shotId || context.sequenceId || context.bridgeId || null;

      try {
        const response = await binaryHttpClient.get(outputUrl, {
          responseType: 'arraybuffer',
        });
        fs.writeFileSync(outputPath, Buffer.from(response.data));

        return normalizeVideoProviderResult({
          provider: 'vercel_ai_gateway',
          shotId: entityId,
          preferredProvider,
          videoPath: outputPath,
          outputUrl,
          taskId: context.taskId || null,
          providerJobId: context.taskId || null,
          targetDurationSec: context.durationTargetSec || null,
          actualDurationSec: context.actualDurationSec || null,
          providerRequest: context.providerRequest || null,
          providerMetadata: context.providerMetadata || null,
        });
      } catch (error) {
        throw classifyVercelAiGatewayVideoError(error);
      }
    },
  };
}

export const __testables = {
  buildVercelAiGatewayVideoRequest,
  classifyVercelAiGatewayVideoError,
  resolveEntityId,
  resolveModel,
  resolvePackageType,
};
