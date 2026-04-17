import { chat } from '../llm/client.js';
import logger from './logger.js';

const cache = new Map();
const CHINESE_REGEX = /[\u4e00-\u9fff]/;

/**
 * 检测文本是否包含中文并翻译为英文。
 * 纯英文直接返回，含中文时调用 LLM 翻译。
 * 内存缓存避免重复翻译。
 */
export async function ensureEnglishPrompt(text) {
  if (!text || !CHINESE_REGEX.test(text)) return text || '';
  if (cache.has(text)) return cache.get(text);

  try {
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

    const translated = (result || '').trim();
    if (translated) {
      cache.set(text, translated);
      logger.debug('TranslatePrompt', `中→英：${text.substring(0, 50)}... → ${translated.substring(0, 50)}...`);
      return translated;
    }
  } catch (error) {
    logger.error('TranslatePrompt', `翻译失败，使用原文：${error.message}`);
  }

  return text;
}
