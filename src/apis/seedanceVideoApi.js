import 'dotenv/config';
import path from 'node:path';
import { setTimeout as sleepTimeout } from 'node:timers/promises';

import axios from 'axios';

import logger from '../utils/logger.js';
import { imageToBase64, saveBuffer } from '../utils/fileHelper.js';
import {
  normalizeVideoProviderError,
  normalizeVideoProviderRequest,
  normalizeVideoProviderResult,
} from './videoProviderProtocol.js';

const SEEDANCE_API_BASE_URL = process.env.SEEDANCE_API_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const SEEDANCE_DEFAULT_MODEL = process.env.SEEDANCE_MODEL_ID || 'doubao-seedance-2-0-260128';
const SEEDANCE_DEFAULT_POLL_INTERVAL_MS = Number.parseInt(process.env.SEEDANCE_POLL_INTERVAL_MS || '10000', 10);
const SEEDANCE_DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.SEEDANCE_TIMEOUT_MS || '600000', 10);
const SEEDANCE_DEFAULT_RATIO = process.env.SEEDANCE_VIDEO_RATIO || '9:16';
const SEEDANCE_DEFAULT_DURATION_SEC = Number.parseInt(process.env.SEEDANCE_DEFAULT_DURATION_SEC || '5', 10);

function createProviderError(message, extras = {}) {
  return normalizeVideoProviderError({
    message,
    code: extras.code || 'SEEDANCE_VIDEO_ERROR',
    category: extras.category || 'provider_generation_failed',
    status: extras.status || null,
    details: extras.details || null,
  });
}

function normalizeSeedanceDuration(durationTargetSec) {
  const target = Number(durationTargetSec);
  if (!Number.isFinite(target)) return SEEDANCE_DEFAULT_DURATION_SEC;
  if (target < 4) return 4;
  if (target > 15) return 15;
  return Math.round(target);
}

function inferRatio(shotPackage, env = process.env) {
  if (shotPackage?.cameraSpec?.ratio) {
    return shotPackage.cameraSpec.ratio;
  }
  return env.SEEDANCE_VIDEO_RATIO || env.VIDEO_ASPECT_RATIO || SEEDANCE_DEFAULT_RATIO;
}

function buildPromptText(shotPackage) {
  return [
    shotPackage?.visualGoal || '',
    shotPackage?.cameraSpec?.moveType ? `camera motion: ${shotPackage.cameraSpec.moveType}` : '',
    shotPackage?.cameraSpec?.framing ? `framing: ${shotPackage.cameraSpec.framing}` : '',
  ]
    .filter(Boolean)
    .join('. ');
}

function toSeedanceImageContent(referenceImage, index = 0) {
  return {
    type: 'image_url',
    image_url: {
      url: imageToBase64(referenceImage.path),
    },
    role: index === 0 ? 'first_frame' : 'reference_image',
  };
}

export function buildSeedanceVideoRequest(shotPackage, env = process.env) {
  const referenceImages = Array.isArray(shotPackage?.referenceImages) ? shotPackage.referenceImages : [];
  const promptText = buildPromptText(shotPackage);

  if (!promptText && referenceImages.length === 0) {
    throw createProviderError('缺少 Seedance 输入内容，至少需要文本或参考图', {
      code: 'SEEDANCE_MISSING_INPUT',
      category: 'provider_invalid_request',
    });
  }

  const content = [];
  if (promptText) {
    content.push({ type: 'text', text: promptText });
  }
  for (const [index, referenceImage] of referenceImages.entries()) {
    content.push(toSeedanceImageContent(referenceImage, index));
  }

  return {
    model: env.SEEDANCE_MODEL_ID || SEEDANCE_DEFAULT_MODEL,
    content,
    ratio: inferRatio(shotPackage, env),
    duration: normalizeSeedanceDuration(shotPackage?.durationTargetSec),
    generate_audio: false,
    watermark: false,
  };
}

export function classifySeedanceError(error) {
  const status = error?.response?.status ?? error?.status ?? null;
  const responseData = error?.response?.data || null;

  if (error?.category) {
    return createProviderError(error.message || 'Seedance 生成失败', {
      code: error.code || 'SEEDANCE_VIDEO_ERROR',
      category: error.category,
      status,
      details: error.details || responseData,
    });
  }

  if (status === 401 || status === 403) {
    return createProviderError(error.message || 'Seedance 鉴权失败', {
      code: 'SEEDANCE_AUTH_ERROR',
      category: 'provider_auth_error',
      status,
      details: responseData,
    });
  }

  if (status === 429) {
    return createProviderError(error.message || 'Seedance 限流', {
      code: 'SEEDANCE_RATE_LIMIT',
      category: 'provider_rate_limit',
      status,
      details: responseData,
    });
  }

  if (status >= 400 && status < 500) {
    return createProviderError(error.message || 'Seedance 请求参数错误', {
      code: 'SEEDANCE_INVALID_REQUEST',
      category: 'provider_invalid_request',
      status,
      details: responseData,
    });
  }

  if (status >= 500) {
    return createProviderError(error.message || 'Seedance 服务端异常', {
      code: 'SEEDANCE_SERVER_ERROR',
      category: 'provider_generation_failed',
      status,
      details: responseData,
    });
  }

  if (error?.code === 'ECONNABORTED' || String(error?.message || '').toLowerCase().includes('timeout')) {
    return createProviderError(error.message || 'Seedance 请求超时', {
      code: 'SEEDANCE_TIMEOUT',
      category: 'provider_timeout',
      status,
      details: responseData,
    });
  }

  return createProviderError(error?.message || 'Seedance 生成失败', {
    code: error?.code || 'SEEDANCE_UNKNOWN_ERROR',
    category: 'provider_generation_failed',
    status,
    details: responseData,
  });
}

export async function seedanceImageToVideo(shotPackage, outputPath, options = {}, env = process.env) {
  const apiKey = options.apiKey || env.SEEDANCE_API_KEY || env.ARK_API_KEY;
  if (!apiKey) {
    throw createProviderError('缺少 SEEDANCE_API_KEY 或 ARK_API_KEY，无法生成动态镜头', {
      code: 'SEEDANCE_AUTH_MISSING',
      category: 'provider_auth_error',
    });
  }

  const requestBody = buildSeedanceVideoRequest(shotPackage, env);
  const requestSummary = normalizeVideoProviderRequest({
    provider: 'seedance',
    request: {
      model: requestBody.model,
      ratio: requestBody.ratio,
      duration: requestBody.duration,
      generate_audio: requestBody.generate_audio,
      watermark: requestBody.watermark,
      contentTypes: requestBody.content.map((item) => `${item.type}:${item.role || 'default'}`),
      promptText: requestBody.content.find((item) => item.type === 'text')?.text || null,
    },
    metadata: {
      shotId: shotPackage?.shotId || null,
      referenceImageCount: (shotPackage?.referenceImages || []).length,
    },
  });

  const httpClient = options.httpClient || axios.create({
    baseURL: options.baseUrl || env.SEEDANCE_API_BASE_URL || SEEDANCE_API_BASE_URL,
    timeout: options.timeoutMs || SEEDANCE_DEFAULT_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  const binaryClient = options.binaryHttpClient || axios;
  const sleep = options.sleep || ((ms) => sleepTimeout(ms));
  const pollIntervalMs = options.pollIntervalMs || SEEDANCE_DEFAULT_POLL_INTERVAL_MS;
  const overallTimeoutMs = options.overallTimeoutMs || SEEDANCE_DEFAULT_TIMEOUT_MS;

  try {
    const createResponse = await httpClient.post('/contents/generations/tasks', requestBody);
    const taskId = createResponse?.data?.id || null;
    if (!taskId) {
      throw createProviderError('Seedance 未返回任务 ID', {
        code: 'SEEDANCE_INVALID_RESPONSE',
        category: 'provider_generation_failed',
        details: createResponse?.data || null,
      });
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < overallTimeoutMs) {
      await sleep(pollIntervalMs);
      const taskResponse = await httpClient.get(`/contents/generations/tasks/${taskId}`);
      const task = taskResponse?.data || {};
      const status = String(task.status || '').trim().toLowerCase();

      if (status === 'succeeded') {
        const outputUrl = task?.content?.video_url || null;
        if (!outputUrl) {
          throw createProviderError('Seedance 任务成功但未返回视频地址', {
            code: 'SEEDANCE_MISSING_OUTPUT',
            category: 'provider_generation_failed',
            details: task,
          });
        }

        const binary = await binaryClient.get(outputUrl, { responseType: 'arraybuffer' });
        saveBuffer(outputPath, Buffer.from(binary.data));
        return normalizeVideoProviderResult({
          provider: 'seedance',
          shotId: shotPackage?.shotId || null,
          preferredProvider: shotPackage?.preferredProvider || 'seedance',
          videoPath: outputPath,
          outputUrl,
          taskId,
          providerJobId: taskId,
          targetDurationSec: shotPackage?.durationTargetSec || task?.duration || null,
          actualDurationSec: task?.duration || shotPackage?.durationTargetSec || null,
          providerRequest: requestSummary.providerRequest,
          providerMetadata: {
            ...requestSummary.providerMetadata,
            resolution: task?.resolution || null,
            ratio: task?.ratio || requestBody.ratio,
            framesPerSecond: task?.framespersecond || null,
            lastFrameUrl: task?.content?.last_frame_url || null,
            serviceTier: task?.service_tier || null,
          },
          extra: {
            requestBody,
            seed: task?.seed ?? null,
          },
        });
      }

      if (status === 'failed' || status === 'expired' || status === 'cancelled') {
        throw createProviderError(task?.error?.message || `Seedance 任务${status}`, {
          code: task?.error?.code || 'SEEDANCE_TASK_FAILED',
          category: status === 'expired' ? 'provider_timeout' : 'provider_generation_failed',
          details: task,
        });
      }
    }

    throw createProviderError('Seedance 任务轮询超时', {
      code: 'SEEDANCE_TIMEOUT',
      category: 'provider_timeout',
    });
  } catch (error) {
    throw classifySeedanceError(error);
  }
}

export async function createSeedanceVideoClip(shotPackage, outputPath, options = {}) {
  logger.info('SeedanceVideo', `生成动态镜头 [seedance]：${path.basename(outputPath)}`);
  return seedanceImageToVideo(shotPackage, outputPath, options, options.env || process.env);
}

export const __testables = {
  buildPromptText,
  buildSeedanceVideoRequest,
  classifySeedanceError,
  createProviderError,
  inferRatio,
  normalizeSeedanceDuration,
};
