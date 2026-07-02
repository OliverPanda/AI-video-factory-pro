import fs from 'node:fs';
import axios from 'axios';
import path from 'path';
import { saveBuffer } from '../../utils/fileHelper.js';
import logger from '../../utils/logger.js';
import { resolveSingleReferenceAsset } from '../../utils/referenceImageAsset.js';

export function getImageApiBaseUrl(env = process.env) {
  const raw = env.IMAGE_API_BASE_URL || env.LAOZHANG_BASE_URL || 'https://api.laozhang.ai/v1';
  return String(raw).trim().replace(/\/+$/, '');
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

function flattenGroupedReferences(references = [], referenceGroups = null) {
  const grouped = referenceGroups && typeof referenceGroups === 'object'
    ? [
      ...(Array.isArray(referenceGroups.character) ? referenceGroups.character : []),
      ...(Array.isArray(referenceGroups.scene) ? referenceGroups.scene : []),
      ...(Array.isArray(referenceGroups.props) ? referenceGroups.props : []),
    ]
    : [];
  return normalizeReferenceImages(grouped.length > 0 ? grouped : references);
}

function buildReferencesByType(referencesByType = {}, referenceGroups = null, references = []) {
  const character = normalizeReferenceImages(
    referencesByType?.character || referenceGroups?.character || []
  );
  const scene = normalizeReferenceImages(
    referencesByType?.scene || referenceGroups?.scene || []
  );
  const props = normalizeReferenceImages(
    referencesByType?.props || referenceGroups?.props || []
  );
  const flattened = flattenGroupedReferences(references, referenceGroups);
  return {
    character,
    scene,
    props,
    flattened: normalizeReferenceImages([
      ...character,
      ...scene,
      ...props,
      ...flattened,
    ]),
  };
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

function summarizeProviderError(error, context = {}) {
  const status = error?.response?.status ?? error?.status ?? null;
  const responseData = error?.response?.data;
  const responseText =
    typeof responseData === 'string'
      ? responseData
      : responseData
        ? JSON.stringify(responseData).slice(0, 400)
        : '';
  const parts = [
    error?.message || '图像请求失败',
    context.baseUrl ? `provider=${context.baseUrl}` : '',
    context.endpoint ? `endpoint=${context.endpoint}` : '',
    context.model ? `model=${context.model}` : '',
    status ? `status=${status}` : '',
    responseText ? `response=${responseText}` : '',
  ].filter(Boolean);
  const wrapped = new Error(parts.join(' | '));
  if (status !== null) {
    wrapped.status = status;
  }
  if (error?.response) {
    wrapped.response = error.response;
  }
  if (error?.code) {
    wrapped.code = error.code;
  }
  return wrapped;
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

function resolveRequestTimeoutMs(request = {}, env = process.env) {
  const rawValue =
    request.timeoutMs ||
    env.IMAGE_REQUEST_TIMEOUT_MS ||
    env.IMAGE_GENERATION_TIMEOUT_MS ||
    '120000';
  const timeoutMs = Number.parseInt(String(rawValue), 10);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000;
}

async function downloadImageFromUrlWithTimeout(url, outputPath, timeoutMs, signal = undefined) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: timeoutMs,
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
    timeoutMs: timeoutOverride,
    signal = undefined,
    references = [],
    referenceGroups = null,
    referencesByType = null,
    characterPriority = null,
  }) {
    const apiKey = getImageApiKey(env);
    if (!apiKey) throw new Error('缺少 IMAGE_API_KEY 或 LAOZHANG_API_KEY');

    const baseUrl = getImageApiBaseUrl(env);
    const size = sizeOverride || getImageGenerationSize(env).size;
    const timeoutMs = resolveRequestTimeoutMs({ timeoutMs: timeoutOverride }, env);
    const providerLabel = new URL(baseUrl).hostname;
    const typedReferences = buildReferencesByType(referencesByType || {}, referenceGroups, references);
    const prioritizedReferences = typedReferences.flattened;
    const useReferenceEdit = prioritizedReferences.length > 0 && String(env.IMAGE_REFERENCE_MODE || 'edit').toLowerCase() !== 'prompt_only';

    if (useReferenceEdit) {
      try {
        const referenceAsset = await resolveSingleReferenceAsset(prioritizedReferences, {
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
            timeout: timeoutMs,
            signal,
          });

          const generated = extractGeneratedImage(response.data);
          if (generated.kind === 'b64') {
            saveBuffer(outputPath, Buffer.from(generated.value, 'base64'));
            logger.debug('ImageAPI', `[${providerLabel}] 参考图编辑完成（base64）：${path.basename(outputPath)}`);
            return outputPath;
          }

          const savedPath = await downloadImageFromUrlWithTimeout(generated.value, outputPath, timeoutMs, signal);
          logger.debug('ImageAPI', `[${providerLabel}] 参考图编辑完成（url）：${path.basename(outputPath)}`);
          return savedPath;
        }
      } catch (error) {
        const wrapped = summarizeProviderError(error, {
          baseUrl,
          endpoint: '/images/edits',
          model: env.IMAGE_EDIT_MODEL || route.model,
        });
        logger.warn('ImageAPI', `[${providerLabel}] 参考图编辑失败，回退到 prompt hints：${wrapped.message}`);
      }
    }

    let response;
    try {
          response = await axios.post(
        `${baseUrl}/images/generations`,
        {
          model: route.model,
          prompt: buildImagePrompt(appendReferenceHints([
            prompt,
            characterPriority ? `character reference priority: ${characterPriority}` : '',
            'character references have higher priority than scene references when identity conflicts exist.',
            typedReferences.character.length > 0 ? `character reference count: ${typedReferences.character.length}` : '',
            typedReferences.scene.length > 0 ? `scene reference count: ${typedReferences.scene.length}` : '',
            typedReferences.props.length > 0 ? `prop reference count: ${typedReferences.props.length}` : '',
          ].filter(Boolean).join('\n'), prioritizedReferences), negativePrompt),
          size,
          n: 1,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: timeoutMs,
          signal,
        }
      );
    } catch (error) {
      throw summarizeProviderError(error, {
        baseUrl,
        endpoint: '/images/generations',
        model: route.model,
      });
    }

    const generated = extractGeneratedImage(response.data);
    if (generated.kind === 'b64') {
      saveBuffer(outputPath, Buffer.from(generated.value, 'base64'));
      logger.debug('ImageAPI', `[${providerLabel}] 生成完成（base64）：${path.basename(outputPath)}`);
      return outputPath;
    }

    const savedPath = await downloadImageFromUrlWithTimeout(generated.value, outputPath, timeoutMs, signal);
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
  downloadImageFromUrlWithTimeout,
  getLaozhangBaseUrl,
  getImageApiBaseUrl,
  getImageApiKey,
  getImageGenerationSize,
  resolveRequestTimeoutMs,
};
