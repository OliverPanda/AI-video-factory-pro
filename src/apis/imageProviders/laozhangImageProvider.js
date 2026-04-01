import axios from 'axios';
import path from 'path';
import { saveBuffer } from '../../utils/fileHelper.js';
import logger from '../../utils/logger.js';

export function getLaozhangBaseUrl(env = process.env) {
  return env.LAOZHANG_BASE_URL || 'https://api.laozhang.ai/v1';
}

export function buildLaozhangPrompt(prompt, negativePrompt) {
  if (!negativePrompt) return prompt;
  return `${prompt}\n\nAvoid or suppress the following elements: ${negativePrompt}`;
}

export function extractGeneratedImage(responseData) {
  const imageData = responseData?.data?.[0];
  if (!imageData) {
    throw new Error(`老张中转站返回了空图像结果：${JSON.stringify(responseData).slice(0, 300)}`);
  }

  if (typeof imageData.b64_json === 'string') {
    return {
      kind: 'b64',
      value: imageData.b64_json,
    };
  }

  if (typeof imageData.url === 'string') {
    return {
      kind: 'url',
      value: imageData.url,
    };
  }

  throw new Error(`老张中转站返回了未知图像格式：${JSON.stringify(imageData).slice(0, 300)}`);
}

async function downloadImageFromUrl(url, outputPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
  });

  saveBuffer(outputPath, Buffer.from(response.data));
  return outputPath;
}

function getImageGenerationSize(env = process.env) {
  const width = parseInt(env.VIDEO_WIDTH || '1080', 10);
  const height = parseInt(env.VIDEO_HEIGHT || '1920', 10);
  return {
    width,
    height,
    size: `${width}x${height}`,
  };
}

export const laozhangImageProvider = {
  name: 'laozhang',
  async generate({ prompt, negativePrompt, outputPath, route, env = process.env }) {
    const apiKey = env.LAOZHANG_API_KEY;
    if (!apiKey) throw new Error('缺少 LAOZHANG_API_KEY');

    const { size } = getImageGenerationSize(env);
    const response = await axios.post(
      `${getLaozhangBaseUrl(env)}/images/generations`,
      {
        model: route.model,
        prompt: buildLaozhangPrompt(prompt, negativePrompt),
        size,
        n: 1,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      }
    );

    const generated = extractGeneratedImage(response.data);
    if (generated.kind === 'b64') {
      saveBuffer(outputPath, Buffer.from(generated.value, 'base64'));
      logger.debug('ImageAPI', `老张中转站生成完成（base64）：${path.basename(outputPath)}`);
      return outputPath;
    }

    const savedPath = await downloadImageFromUrl(generated.value, outputPath);
    logger.debug('ImageAPI', `老张中转站生成完成（url）：${path.basename(outputPath)}`);
    return savedPath;
  },
};

export const __testables = {
  buildLaozhangPrompt,
  extractGeneratedImage,
  downloadImageFromUrl,
  getLaozhangBaseUrl,
  getImageGenerationSize,
};
