import 'dotenv/config';
import path from 'node:path';
import { setTimeout as sleepTimeout } from 'node:timers/promises';

import axios from 'axios';

import logger from '../utils/logger.js';
import { imageToBase64, saveBuffer } from '../utils/fileHelper.js';

const RUNWAY_API_BASE_URL = process.env.RUNWAY_API_BASE_URL || 'https://api.dev.runwayml.com/v1';
const RUNWAY_API_VERSION = process.env.RUNWAY_API_VERSION || '2024-11-06';
const RUNWAY_DEFAULT_MODEL = process.env.RUNWAY_IMAGE_TO_VIDEO_MODEL || 'gen4_turbo';
const RUNWAY_DEFAULT_POLL_INTERVAL_MS = Number.parseInt(process.env.RUNWAY_POLL_INTERVAL_MS || '5000', 10);
const RUNWAY_DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.RUNWAY_TIMEOUT_MS || '300000', 10);

function createProviderError(message, extras = {}) {
  const error = new Error(message);
  error.code = extras.code || 'RUNWAY_VIDEO_ERROR';
  error.category = extras.category || 'provider_generation_failed';
  error.status = extras.status || null;
  error.details = extras.details || null;
  return error;
}

function normalizeDurationBucket(durationTargetSec) {
  const target = Number(durationTargetSec);
  if (!Number.isFinite(target) || target <= 5) {
    return 5;
  }
  return 10;
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

function buildPromptText(shotPackage) {
  return [
    shotPackage?.visualGoal || '',
    shotPackage?.cameraSpec?.moveType ? `camera motion: ${shotPackage.cameraSpec.moveType}` : '',
    shotPackage?.cameraSpec?.framing ? `framing: ${shotPackage.cameraSpec.framing}` : '',
  ]
    .filter(Boolean)
    .join('. ');
}

export function buildRunwayImageToVideoRequest(shotPackage, env = process.env) {
  const referenceImage = shotPackage?.referenceImages?.[0]?.path;
  if (!referenceImage) {
    throw createProviderError('缺少 Runway image-to-video 参考图', {
      code: 'RUNWAY_MISSING_REFERENCE',
      category: 'provider_invalid_request',
    });
  }

  return {
    model: env.RUNWAY_IMAGE_TO_VIDEO_MODEL || RUNWAY_DEFAULT_MODEL,
    promptImage: imageToBase64(referenceImage),
    promptText: buildPromptText(shotPackage),
    duration: normalizeDurationBucket(shotPackage?.durationTargetSec),
    ratio: inferRatio(shotPackage, env),
  };
}

export function classifyRunwayError(error) {
  const status = error?.response?.status ?? error?.status ?? null;

  if (error?.category) {
    return createProviderError(error.message || 'Runway 生成失败', {
      code: error.code || 'RUNWAY_VIDEO_ERROR',
      category: error.category,
      status,
      details: error.details || error?.response?.data || null,
    });
  }

  if (!process.env.RUNWAY_API_KEY && !error?.response && String(error?.code || '').includes('RUNWAY_AUTH_MISSING')) {
    return createProviderError(error.message, {
      code: 'RUNWAY_AUTH_MISSING',
      category: 'provider_auth_error',
      status,
    });
  }

  if (status === 401 || status === 403) {
    return createProviderError(error.message || 'Runway 鉴权失败', {
      code: 'RUNWAY_AUTH_ERROR',
      category: 'provider_auth_error',
      status,
      details: error?.response?.data || null,
    });
  }

  if (status === 429) {
    return createProviderError(error.message || 'Runway 限流', {
      code: 'RUNWAY_RATE_LIMIT',
      category: 'provider_rate_limit',
      status,
      details: error?.response?.data || null,
    });
  }

  if (status >= 400 && status < 500) {
    return createProviderError(error.message || 'Runway 请求参数错误', {
      code: 'RUNWAY_INVALID_REQUEST',
      category: 'provider_invalid_request',
      status,
      details: error?.response?.data || null,
    });
  }

  if (status >= 500) {
    return createProviderError(error.message || 'Runway 生成失败', {
      code: 'RUNWAY_SERVER_ERROR',
      category: 'provider_generation_failed',
      status,
      details: error?.response?.data || null,
    });
  }

  if (error?.code === 'ECONNABORTED' || String(error?.message || '').toLowerCase().includes('timeout')) {
    return createProviderError(error.message || 'Runway 请求超时', {
      code: 'RUNWAY_TIMEOUT',
      category: 'provider_timeout',
      status,
    });
  }

  return createProviderError(error?.message || 'Runway 生成失败', {
    code: error?.code || 'RUNWAY_UNKNOWN_ERROR',
    category: 'provider_generation_failed',
    status,
    details: error?.response?.data || null,
  });
}

export function resolveRunwayTaskOutputUrl(taskData) {
  const outputs = taskData?.output || taskData?.outputs || taskData?.artifacts || [];
  if (Array.isArray(outputs)) {
    for (const item of outputs) {
      if (typeof item === 'string' && item.trim()) {
        return item;
      }
      if (item?.url) {
        return item.url;
      }
    }
  }
  if (typeof outputs === 'string' && outputs.trim()) {
    return outputs;
  }
  return taskData?.url || null;
}

export async function runwayImageToVideo(shotPackage, outputPath, options = {}, env = process.env) {
  const apiKey = options.apiKey || env.RUNWAY_API_KEY;
  if (!apiKey) {
    throw createProviderError('缺少 RUNWAY_API_KEY，无法生成动态镜头', {
      code: 'RUNWAY_AUTH_MISSING',
      category: 'provider_auth_error',
    });
  }

  const requestBody = buildRunwayImageToVideoRequest(shotPackage, env);
  const httpClient = options.httpClient || axios.create({
    baseURL: options.baseUrl || env.RUNWAY_API_BASE_URL || RUNWAY_API_BASE_URL,
    timeout: options.timeoutMs || RUNWAY_DEFAULT_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Runway-Version': options.apiVersion || env.RUNWAY_API_VERSION || RUNWAY_API_VERSION,
    },
  });
  const binaryClient = options.binaryHttpClient || axios;
  const sleep = options.sleep || ((ms) => sleepTimeout(ms));
  const pollIntervalMs = options.pollIntervalMs || RUNWAY_DEFAULT_POLL_INTERVAL_MS;
  const overallTimeoutMs = options.overallTimeoutMs || RUNWAY_DEFAULT_TIMEOUT_MS;

  try {
    const createResponse = await httpClient.post('/image_to_video', requestBody);
    const taskId = createResponse?.data?.id || createResponse?.data?.taskId;
    if (!taskId) {
      throw createProviderError('Runway 未返回任务 ID', {
        code: 'RUNWAY_INVALID_RESPONSE',
        category: 'provider_generation_failed',
        details: createResponse?.data || null,
      });
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < overallTimeoutMs) {
      await sleep(pollIntervalMs);
      const taskResponse = await httpClient.get(`/tasks/${taskId}`);
      const task = taskResponse?.data || {};
      const status = String(task.status || task.state || '').trim().toUpperCase();

      if (status === 'SUCCEEDED' || status === 'COMPLETED') {
        const outputUrl = resolveRunwayTaskOutputUrl(task);
        if (!outputUrl) {
          throw createProviderError('Runway 任务成功但未返回视频地址', {
            code: 'RUNWAY_MISSING_OUTPUT',
            category: 'provider_generation_failed',
            details: task,
          });
        }

        const binary = await binaryClient.get(outputUrl, { responseType: 'arraybuffer' });
        saveBuffer(outputPath, Buffer.from(binary.data));
        return {
          provider: 'runway',
          taskId,
          videoPath: outputPath,
          outputUrl,
        };
      }

      if (status === 'FAILED' || status === 'CANCELLED') {
        throw createProviderError(task.failure || task.error || 'Runway 任务失败', {
          code: 'RUNWAY_TASK_FAILED',
          category: 'provider_generation_failed',
          details: task,
        });
      }
    }

    throw createProviderError('Runway 任务轮询超时', {
      code: 'RUNWAY_TIMEOUT',
      category: 'provider_timeout',
    });
  } catch (error) {
    throw classifyRunwayError(error);
  }
}

export async function createRunwayVideoClip(shotPackage, outputPath, options = {}) {
  logger.info('RunwayVideo', `生成动态镜头 [runway]：${path.basename(outputPath)}`);
  return runwayImageToVideo(shotPackage, outputPath, options, options.env || process.env);
}

export const __testables = {
  buildRunwayImageToVideoRequest,
  classifyRunwayError,
  createProviderError,
  inferRatio,
  normalizeDurationBucket,
  resolveTaskOutputUrl: resolveRunwayTaskOutputUrl,
};
