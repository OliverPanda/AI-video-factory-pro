/**
 * TTS 配音 API 封装
 * 当前主实现：讯飞在线语音合成
 * 扩展方式：provider router + focused provider modules
 */

import 'dotenv/config';
import path from 'path';

import logger from '../utils/logger.js';
import { buildCosyVoiceRequest, ttsWithCosyVoice } from './providers/cosyvoiceTtsApi.js';
import { buildFishSpeechRequest, ttsWithFishSpeech } from './providers/fishSpeechTtsApi.js';
import {
  buildXfyunPayload,
  buildXfyunRequestUrl,
  normalizeXfyunBusinessValue,
  ttsWithXfyun,
} from './providers/xfyunTtsApi.js';
import { ttsWithMock } from './providers/mockTtsApi.js';
import { createPlaceholderProvider } from './providers/placeholderTtsApi.js';

const DEFAULT_PROVIDER_HANDLERS = {
  xfyun: ttsWithXfyun,
  'env-default': ttsWithXfyun,
  mock: ttsWithMock,
  cosyvoice: ttsWithCosyVoice,
  'fish-speech': ttsWithFishSpeech,
  tencent: createPlaceholderProvider('tencent'),
  volcengine: createPlaceholderProvider('volcengine'),
};

export function resolveTtsProvider(options = {}, env = process.env) {
  return options.provider || env.TTS_PROVIDER || 'xfyun';
}

export function getProviderHandler(provider, providerHandlers = DEFAULT_PROVIDER_HANDLERS) {
  const handler = providerHandlers[provider];
  if (!handler) {
    throw new Error(`未知 TTS Provider：${provider}`);
  }
  return handler;
}

/**
 * 文字转语音
 * @param {string} text - 台词文本
 * @param {string} outputPath - 音频保存路径（.mp3）
 * @param {Object} options - { gender: 'male'|'female', rate, pitch, volume, voice, provider }
 * @returns {Promise<string|null>} 音频文件路径
 */
export async function textToSpeech(text, outputPath, options = {}) {
  if (!text || text.trim() === '') {
    logger.debug('TTS', `跳过空台词：${path.basename(outputPath)}`);
    return null;
  }

  const provider = resolveTtsProvider(options);
  const providerHandlers = {
    ...DEFAULT_PROVIDER_HANDLERS,
    ...(options.providerHandlers || {}),
  };
  const handler = getProviderHandler(provider, providerHandlers);

  logger.info('TTS', `合成语音 [${provider}]：${text.slice(0, 30)}...`);
  return handler(text, outputPath, options);
}

/**
 * 批量合成（返回 null 表示该镜头无台词）
 */
export async function batchTTS(tasks) {
  return Promise.all(
    tasks.map(({ text, outputPath, options }) => textToSpeech(text, outputPath, options))
  );
}

export const __testables = {
  buildXfyunRequestUrl,
  buildXfyunPayload,
  buildCosyVoiceRequest,
  buildFishSpeechRequest,
  normalizeXfyunBusinessValue,
  resolveTtsProvider,
  getProviderHandler,
};
