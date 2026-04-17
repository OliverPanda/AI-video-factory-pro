/**
 * 图像生成 API 封装
 * 支持任意 OpenAI 兼容图像 API（老张、zhenzhen、t8star 等），通过 IMAGE_API_BASE_URL + IMAGE_API_KEY 配置。
 */

import 'dotenv/config';
import path from 'path';
import logger from '../utils/logger.js';
import {
  __testables as providerTestables,
  laozhangImageProvider,
} from './imageProviders/laozhangImageProvider.js';
import { createUnifiedImageProviderClient } from './unifiedImageProviderClient.js';

const DEFAULT_STYLE = process.env.IMAGE_STYLE || 'realistic';

export const IMAGE_TASK_TYPES = Object.freeze({
  REALISTIC_IMAGE: 'realistic_image',
  THREED_IMAGE: 'threed_image',
  IMAGE_EDIT: 'image_edit',
  REALISTIC_VIDEO: 'realistic_video',
  THREED_VIDEO: 'threed_video',
});

export function normalizeStyleToTaskType(style = DEFAULT_STYLE) {
  return style === '3d' ? IMAGE_TASK_TYPES.THREED_IMAGE : IMAGE_TASK_TYPES.REALISTIC_IMAGE;
}

export function resolveImageTaskType(options = {}) {
  return options.taskType || normalizeStyleToTaskType(options.style || DEFAULT_STYLE);
}

export function resolveImageRoute(taskType, env = process.env) {
  const provider = env.PRIMARY_API_PROVIDER || 'openai_compat';

  const routes = {
    [IMAGE_TASK_TYPES.REALISTIC_IMAGE]: {
      provider,
      model: env.REALISTIC_IMAGE_MODEL || 'flux-kontext-pro',
    },
    [IMAGE_TASK_TYPES.THREED_IMAGE]: {
      provider,
      model: env.THREED_IMAGE_MODEL || 'gpt-image-1',
    },
    [IMAGE_TASK_TYPES.IMAGE_EDIT]: {
      provider,
      model: env.IMAGE_EDIT_MODEL || 'qwen-image-edit-max',
    },
    [IMAGE_TASK_TYPES.REALISTIC_VIDEO]: {
      provider,
      model: env.REALISTIC_VIDEO_MODEL || 'veo',
    },
    [IMAGE_TASK_TYPES.THREED_VIDEO]: {
      provider,
      model: env.THREED_VIDEO_MODEL || 'sora',
    },
  };

  const route = routes[taskType];
  if (!route) {
    throw new Error(`未知图像任务类型：${taskType}`);
  }

  return route;
}

export function resolveImageTransportProvider(env = process.env) {
  return env.IMAGE_TRANSPORT_PROVIDER || env.PRIMARY_API_PROVIDER || 'openai_compat';
}

export function resolveImageProvider(provider = 'laozhang') {
  if (provider === 'laozhang' || provider === 'openai_compat') {
    return laozhangImageProvider;
  }
  throw new Error(`未注册的图像 Provider：${provider}`);
}

/**
 * 生成单张图像
 * @param {string} prompt - 正向提示词
 * @param {string} negativePrompt - 负向提示词
 * @param {string} outputPath - 保存路径（含文件名）
 * @param {Object} options - { style?: 'realistic' | '3d', taskType?: string }
 * @returns {Promise<string>} 图像文件路径
 */
export async function generateImage(prompt, negativePrompt, outputPath, options = {}) {
  const taskType = resolveImageTaskType(options);
  const route = resolveImageRoute(taskType, options.env);
  const env = options.env || process.env;
  const transportProvider = options.transportProvider || resolveImageTransportProvider(env);
  const provider = resolveImageProvider(route.provider);
  const imageClient = options.imageClient || createUnifiedImageProviderClient({
    transports: {
      openai_compat: provider,
      ...(options.transports || {}),
    },
  });

  logger.info(
    'ImageAPI',
    `生成图像 [${transportProvider}/${route.model}/${taskType}]：${path.basename(outputPath)}`
  );

  const result = await imageClient.generate({
    prompt,
    negativePrompt,
    outputPath,
    route,
    env,
    size: options.size || null,
    transportProvider,
    references: options.references || [],
  });
  return result.outputPath;
}

/**
 * 批量生成图像（由外部队列控制并发）
 * @param {Array<{prompt, negativePrompt, outputPath, options}>} tasks
 * @returns {Promise<Array<string>>}
 */
export async function batchGenerateImages(tasks) {
  return Promise.all(
    tasks.map(({ prompt, negativePrompt, outputPath, options }) =>
      generateImage(prompt, negativePrompt, outputPath, options)
    )
  );
}

export const __testables = {
  buildLaozhangPrompt: providerTestables.buildLaozhangPrompt,
  buildImagePrompt: providerTestables.buildImagePrompt,
  extractGeneratedImage: providerTestables.extractGeneratedImage,
  downloadImageFromUrl: providerTestables.downloadImageFromUrl,
  getImageApiBaseUrl: providerTestables.getImageApiBaseUrl,
  getLaozhangBaseUrl: providerTestables.getLaozhangBaseUrl,
  resolveImageProvider,
  resolveImageTransportProvider,
};
