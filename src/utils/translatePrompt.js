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
        content: [
          'You are a professional translator specializing in AI image and video generation prompts.',
          'Translate the following text to English with strict rules:',
          '',
          'RULES:',
          '1. Output ONLY the translated English text — no explanation, no quotes, no markdown, no preamble.',
          '2. PRESERVE these terms EXACTLY as-is (do NOT translate, do NOT modify):',
          '   - Camera terms: close-up, medium shot, wide shot, extreme close-up, establishing shot, over-the-shoulder, POV, two-shot, group shot, single shot, master shot',
          '   - Movement terms: dolly zoom, whip pan, rack focus, tracking shot, steadicam, handheld, locked-off, push-in, pull-out, crane up, crane down, dutch angle, low angle, high angle, birds-eye view, worms-eye view',
          '   - Technical terms: depth of field, bokeh, shallow focus, deep focus, rule of thirds, leading lines, negative space, frame within frame, symmetrical composition, golden ratio',
          '   - Transition terms: match cut, jump cut, fade, dissolve, wipe, crossfade',
          '   - Quality terms: photorealistic, cinematic, film grain, 35mm, anamorphic, HDR, key light, rim light, fill light, volumetric light, global illumination, subsurface scattering',
          '   - Model names: Seedance, HappyHorse, Flux, SD3, Sora, Kling',
          '3. Translate Chinese descriptive text naturally into cinematic English.',
          '4. Keep ALL existing English words, technical terms, proper nouns, and numbers unchanged.',
          '5. Maintain the original STRUCTURE: if input is comma-separated tags, output comma-separated tags; if input is natural language prose, output natural language prose.',
          '6. For character names in Chinese, romanize them (pinyin) rather than translating their meaning.',
        ].join('\n'),
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
