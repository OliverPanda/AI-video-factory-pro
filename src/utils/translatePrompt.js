import { chat } from '../llm/client.js';
import logger from './logger.js';

const cache = new Map();
const CHINESE_REGEX = /[\u4e00-\u9fff]/;

function resolveTranslationProvider(options = {}) {
  if (options.provider) return options.provider;
  if (options.baseUrl) return 'libretranslate';
  return process.env.PROMPT_TRANSLATION_PROVIDER || process.env.SORA2_TRANSLATION_PROVIDER || 'llm';
}

async function translateWithLibreTranslate(text, options = {}) {
  const baseUrl =
    options.baseUrl ||
    process.env.PROMPT_TRANSLATION_BASE_URL ||
    process.env.SORA2_TRANSLATION_BASE_URL ||
    '';
  if (!baseUrl) {
    throw new Error('missing libretranslate base url');
  }

  const fetchImpl = options.fetchImpl || fetch;
  const apiKey =
    options.apiKey ||
    process.env.PROMPT_TRANSLATION_API_KEY ||
    process.env.SORA2_TRANSLATION_API_KEY ||
    '';
  const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/g, '')}/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: text,
      source: options.source || process.env.PROMPT_TRANSLATION_SOURCE_LANG || 'auto',
      target: options.target || process.env.PROMPT_TRANSLATION_TARGET_LANG || 'en',
      format: 'text',
      ...(apiKey ? { api_key: apiKey } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.translatedText) {
    throw new Error(payload?.error || `libretranslate http ${response.status}`);
  }
  return String(payload.translatedText || '').trim();
}

async function translateWithLlm(text) {
  const result = await chat(
    [
      {
        role: 'system',
        content:
          'You are a translator for AI image/video generation prompts. Translate the following text to English. Keep all English words, technical terms, and proper nouns unchanged. Output ONLY the translated text, no explanation, no quotes.',
      },
      { role: 'user', content: text },
    ],
    { temperature: 0 }
  );
  return (result || '').trim();
}

/**
 * 检测文本是否包含中文并翻译为英文。
 * 纯英文直接返回，含中文时调用 LLM 翻译。
 * 内存缓存避免重复翻译。
 */
export async function ensureEnglishPrompt(text, options = {}) {
  if (!text || !CHINESE_REGEX.test(text)) return text || '';
  const provider = resolveTranslationProvider(options);
  const cacheKey = `${provider}:${text}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  try {
    const translated = provider === 'libretranslate'
      ? await translateWithLibreTranslate(text, options)
      : await translateWithLlm(text);
    if (translated) {
      cache.set(cacheKey, translated);
      logger.debug('TranslatePrompt', `中→英：${text.substring(0, 50)}... → ${translated.substring(0, 50)}...`);
      return translated;
    }
  } catch (error) {
    logger.error('TranslatePrompt', `翻译失败，provider=${provider}，使用原文：${error.message}`);
    if (provider !== 'llm' && options.disableFallback !== true) {
      try {
        const fallbackTranslated = await translateWithLlm(text);
        if (fallbackTranslated) {
          cache.set(cacheKey, fallbackTranslated);
          return fallbackTranslated;
        }
      } catch (fallbackError) {
        logger.error('TranslatePrompt', `LLM 回退翻译失败，使用原文：${fallbackError.message}`);
      }
    }
  }

  return text;
}

export const __testables = {
  resolveTranslationProvider,
  translateWithLibreTranslate,
  translateWithLlm,
};
