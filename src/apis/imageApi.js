/**
 * 图像生成 API 封装
 * 支持：Together AI (Flux Pro) | Stability AI
 * 通过 IMAGE_STYLE 环境变量或参数控制
 */

import 'dotenv/config';
import axios from 'axios';
import path from 'path';
import { saveBuffer } from '../utils/fileHelper.js';
import logger from '../utils/logger.js';

const DEFAULT_STYLE = process.env.IMAGE_STYLE || 'realistic';

// ─── Together AI (Flux Pro) ───────────────────────────────────
async function generateWithTogether(prompt, negativePrompt, outputPath) {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('缺少 TOGETHER_API_KEY');

  const response = await axios.post(
    'https://api.together.xyz/v1/images/generations',
    {
      model: 'black-forest-labs/FLUX.1-pro',
      prompt,
      negative_prompt: negativePrompt || undefined,
      width: parseInt(process.env.VIDEO_WIDTH || '1080'),
      height: parseInt(process.env.VIDEO_HEIGHT || '1920'),
      steps: 28,
      n: 1,
      response_format: 'b64_json',
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    }
  );

  const b64 = response.data.data[0].b64_json;
  const buffer = Buffer.from(b64, 'base64');
  saveBuffer(outputPath, buffer);
  logger.debug('ImageAPI', `Together AI 生成完成：${path.basename(outputPath)}`);
  return outputPath;
}

// ─── Stability AI ────────────────────────────────────────────
async function generateWithStability(prompt, negativePrompt, outputPath) {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) throw new Error('缺少 STABILITY_API_KEY');

  const width = parseInt(process.env.VIDEO_WIDTH || '1080');
  const height = parseInt(process.env.VIDEO_HEIGHT || '1920');

  const response = await axios.post(
    'https://api.stability.ai/v2beta/stable-image/generate/sd3',
    {
      prompt,
      negative_prompt: negativePrompt || undefined,
      aspect_ratio: `${width}:${height}`,
      output_format: 'png',
      mode: 'text-to-image',
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'image/*',
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 120000,
    }
  );

  saveBuffer(outputPath, Buffer.from(response.data));
  logger.debug('ImageAPI', `Stability AI 生成完成：${path.basename(outputPath)}`);
  return outputPath;
}

// ─── 统一接口 ────────────────────────────────────────────────
/**
 * 生成单张图像
 * @param {string} prompt - 正向提示词
 * @param {string} negativePrompt - 负向提示词
 * @param {string} outputPath - 保存路径（含文件名）
 * @param {Object} options - { style: 'realistic' | '3d', provider: 'together' | 'stability' }
 * @returns {Promise<string>} 图像文件路径
 */
export async function generateImage(prompt, negativePrompt, outputPath, options = {}) {
  const style = options.style || DEFAULT_STYLE;
  // 3D风格默认用Stability，写实用Together
  const provider = options.provider || (style === '3d' ? 'stability' : 'together');

  logger.info('ImageAPI', `生成图像 [${provider}/${style}]：${path.basename(outputPath)}`);

  if (provider === 'stability') {
    return generateWithStability(prompt, negativePrompt, outputPath);
  }
  return generateWithTogether(prompt, negativePrompt, outputPath);
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
