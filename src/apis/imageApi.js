/**
 * 图像生成 API 封装
 * 当前默认使用老张中转站，按任务类型路由不同模型。
 */

import 'dotenv/config';
import path from 'path';
import logger from '../utils/logger.js';
import {
  __testables as laozhangTestables,
  laozhangImageProvider,
} from './imageProviders/laozhangImageProvider.js';

const DEFAULT_STYLE = process.env.IMAGE_STYLE || 'realistic';
const PRIMARY_API_PROVIDER = process.env.PRIMARY_API_PROVIDER || 'laozhang';
function getLaozhangBaseUrl(env = process.env) {
  return laozhangTestables.getLaozhangBaseUrl(env);
}

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
  const provider = env.PRIMARY_API_PROVIDER || PRIMARY_API_PROVIDER;
  if (provider !== 'laozhang') {
    throw new Error(`当前仅支持 laozhang 作为图像主平台，收到：${provider}`);
  }

  const routes = {
    [IMAGE_TASK_TYPES.REALISTIC_IMAGE]: {
      provider: 'laozhang',
      model: env.REALISTIC_IMAGE_MODEL || 'flux-kontext-pro',
    },
    [IMAGE_TASK_TYPES.THREED_IMAGE]: {
      provider: 'laozhang',
      model: env.THREED_IMAGE_MODEL || 'gpt-image-1',
    },
    [IMAGE_TASK_TYPES.IMAGE_EDIT]: {
      provider: 'laozhang',
      model: env.IMAGE_EDIT_MODEL || 'qwen-image-edit-max',
    },
    [IMAGE_TASK_TYPES.REALISTIC_VIDEO]: {
      provider: 'laozhang',
      model: env.REALISTIC_VIDEO_MODEL || 'veo',
    },
    [IMAGE_TASK_TYPES.THREED_VIDEO]: {
      provider: 'laozhang',
      model: env.THREED_VIDEO_MODEL || 'sora',
    },
  };

  const route = routes[taskType];
  if (!route) {
    throw new Error(`未知图像任务类型：${taskType}`);
  }

  return route;
}

const IMAGE_PROVIDER_STRATEGIES = Object.freeze({
  laozhang: laozhangImageProvider,
});

export function resolveImageProvider(providerName) {
  const provider = IMAGE_PROVIDER_STRATEGIES[providerName];
  if (!provider) {
    throw new Error(`未注册的图像 Provider：${providerName}`);
  }
  return provider;
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
  const provider = resolveImageProvider(route.provider);

  logger.info(
    'ImageAPI',
    `生成图像 [${route.provider}/${route.model}/${taskType}]：${path.basename(outputPath)}`
  );

  return provider.generate({
    prompt,
    negativePrompt,
    outputPath,
    route,
    env: options.env || process.env,
  });
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
  buildLaozhangPrompt: laozhangTestables.buildLaozhangPrompt,
  extractGeneratedImage: laozhangTestables.extractGeneratedImage,
  downloadImageFromUrl: laozhangTestables.downloadImageFromUrl,
  getLaozhangBaseUrl,
  resolveImageProvider,
};
