import fs from 'node:fs';
import axios from 'axios';
import path from 'path';
import { saveBuffer } from '../../utils/fileHelper.js';
import logger from '../../utils/logger.js';
import { resolveSingleReferenceAsset } from '../../utils/referenceImageAsset.js';

export function getImageApiBaseUrl(env = process.env) {
  return env.IMAGE_API_BASE_URL || env.LAOZHANG_BASE_URL || 'https://api.laozhang.ai/v1';
}

export function getImageApiKey(env = process.env) {
  return env.IMAGE_API_KEY || env.LAOZHANG_API_KEY || null;
}

// 保留旧名称兼容
export function getLaozhangBaseUrl(env = process.env) {
  return getImageApiBaseUrl(env);
}

export function buildImagePrompt(prompt, negativePrompt) {
  if (!negativePrompt) return prompt;
  return `${prompt}\n\nAvoid or suppress the following elements: ${negativePrompt}`;
}

function normalizeReferenceImages(references = []) {
  return (Array.isArray(references) ? references : [])
    .map((reference) => {
      if (typeof reference === 'string') {
        return reference.trim();
      }
      if (reference && typeof reference === 'object') {
        return String(reference.path || reference.url || '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function appendReferenceHints(prompt, references = []) {
  const normalizedReferences = normalizeReferenceImages(references);
  if (normalizedReferences.length === 0) {
    return prompt;
  }

  return [
    prompt,
    '',
    'Reference anchor images are provided and must be strictly followed for identity consistency.',
    ...normalizedReferences.map((referencePath, index) => `Reference ${index + 1}: ${referencePath}`),
  ].join('\n');
}

// 保留旧名称兼容
export const buildLaozhangPrompt = buildImagePrompt;

export function extractGeneratedImage(responseData) {
  const imageData = responseData?.data?.[0];
  if (!imageData) {
    throw new Error(`图像 API 返回了空结果：${JSON.stringify(responseData).slice(0, 300)}`);
  }

  if (typeof imageData.b64_json === 'string') {
    return { kind: 'b64', value: imageData.b64_json };
  }

  if (typeof imageData.url === 'string') {
    return { kind: 'url', value: imageData.url };
  }

  throw new Error(`图像 API 返回了未知格式：${JSON.stringify(imageData).slice(0, 300)}`);
}

async function downloadImageFromUrl(url, outputPath, signal = undefined) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    signal,
  });
  saveBuffer(outputPath, Buffer.from(response.data));
  return outputPath;
}

function getImageGenerationSize(env = process.env) {
  const width = parseInt(env.VIDEO_WIDTH || '1080', 10);
  const height = parseInt(env.VIDEO_HEIGHT || '1920', 10);
  return { width, height, size: `${width}x${height}` };
}

export const laozhangImageProvider = {
  name: 'openai_compat',
  async generate({
    prompt,
    negativePrompt,
    outputPath,
    route,
    env = process.env,
    size: sizeOverride,
    signal = undefined,
    references = [],
  }) {
    const apiKey = getImageApiKey(env);
    if (!apiKey) throw new Error('缺少 IMAGE_API_KEY 或 LAOZHANG_API_KEY');

    const baseUrl = getImageApiBaseUrl(env);
    const size = sizeOverride || getImageGenerationSize(env).size;
    const providerLabel = new URL(baseUrl).hostname;
    const useReferenceEdit = normalizeReferenceImages(references).length > 0 && String(env.IMAGE_REFERENCE_MODE || 'edit').toLowerCase() !== 'prompt_only';

    if (useReferenceEdit) {
      try {
        const referenceAsset = await resolveSingleReferenceAsset(references, {
          tempDir: path.join(process.env.TEMP_DIR || './temp', 'image-reference-assets'),
        });
        if (referenceAsset?.path) {
          const form = new FormData();
          form.append('model', env.IMAGE_EDIT_MODEL || route.model);
          form.append('prompt', buildImagePrompt(prompt, negativePrompt));
          form.append('size', size);
          form.append('n', '1');
          form.append('image', new Blob([fs.readFileSync(referenceAsset.path)]), path.basename(referenceAsset.path));

          const response = await axios.post(`${baseUrl}/images/edits`, form, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            timeout: 120000,
            signal,
          });

          const generated = extractGeneratedImage(response.data);
          if (generated.kind === 'b64') {
            saveBuffer(outputPath, Buffer.from(generated.value, 'base64'));
            logger.debug('ImageAPI', `[${providerLabel}] 参考图编辑完成（base64）：${path.basename(outputPath)}`);
            return outputPath;
          }

          const savedPath = await downloadImageFromUrl(generated.value, outputPath, signal);
          logger.debug('ImageAPI', `[${providerLabel}] 参考图编辑完成（url）：${path.basename(outputPath)}`);
          return savedPath;
        }
      } catch (error) {
        logger.warn('ImageAPI', `[${providerLabel}] 参考图编辑失败，回退到 prompt hints：${error.message}`);
      }
    }

    const response = await axios.post(
      `${baseUrl}/images/generations`,
      {
        model: route.model,
        prompt: buildImagePrompt(appendReferenceHints(prompt, references), negativePrompt),
        size,
        n: 1,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 120000,
        signal,
      }
    );

    const generated = extractGeneratedImage(response.data);
    if (generated.kind === 'b64') {
      saveBuffer(outputPath, Buffer.from(generated.value, 'base64'));
      logger.debug('ImageAPI', `[${providerLabel}] 生成完成（base64）：${path.basename(outputPath)}`);
      return outputPath;
    }

    const savedPath = await downloadImageFromUrl(generated.value, outputPath, signal);
    logger.debug('ImageAPI', `[${providerLabel}] 生成完成（url）：${path.basename(outputPath)}`);
    return savedPath;
  },
};

export const __testables = {
  buildLaozhangPrompt,
  buildImagePrompt,
  appendReferenceHints,
  extractGeneratedImage,
  downloadImageFromUrl,
  getLaozhangBaseUrl,
  getImageApiBaseUrl,
  getImageApiKey,
  getImageGenerationSize,
};
