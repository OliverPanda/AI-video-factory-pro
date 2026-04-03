import crypto from 'crypto';
import path from 'path';
import WebSocket from 'ws';

import { saveBuffer } from '../../utils/fileHelper.js';
import logger from '../../utils/logger.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeXfyunBusinessValue(value, fallback = 50) {
  if (value === undefined || value === null || value === '') return fallback;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue === 0) return fallback;

  if (numericValue >= 0 && numericValue <= 100) {
    return Math.round(numericValue);
  }

  return clamp(Math.round(50 + numericValue / 2), 0, 100);
}

export function buildXfyunRequestUrl({
  apiKey,
  apiSecret,
  host = process.env.XFYUN_TTS_HOST || 'tts-api.xfyun.cn',
  pathName = process.env.XFYUN_TTS_PATH || '/v2/tts',
  date = new Date().toUTCString(),
}) {
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${pathName} HTTP/1.1`;
  const signatureSha = crypto
    .createHmac('sha256', apiSecret)
    .update(signatureOrigin)
    .digest('base64');
  const authorizationOrigin =
    `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`;
  const authorization = Buffer.from(authorizationOrigin).toString('base64');

  const params = new URLSearchParams({
    authorization,
    date,
    host,
  });

  return `wss://${host}${pathName}?${params.toString()}`;
}

export function buildXfyunPayload(text, options = {}, env = process.env) {
  const femaleVoice = env.XFYUN_TTS_VOICE_FEMALE || env.XFYUN_TTS_VOICE || 'xiaoyan';
  const maleVoice = env.XFYUN_TTS_VOICE_MALE || env.XFYUN_TTS_VOICE || 'xiaofeng';

  return {
    common: {
      app_id: env.XFYUN_TTS_APP_ID,
    },
    business: {
      aue: env.XFYUN_TTS_AUDIO_ENCODING || 'lame',
      auf: env.XFYUN_TTS_AUDIO_FORMAT || 'audio/L16;rate=16000',
      sfl: 1,
      tte: env.XFYUN_TTS_TEXT_ENCODING || 'UTF8',
      vcn: options.voice || (options.gender === 'female' ? femaleVoice : maleVoice),
      speed: normalizeXfyunBusinessValue(options.rate, 50),
      volume: normalizeXfyunBusinessValue(options.volume, 50),
      pitch: normalizeXfyunBusinessValue(options.pitch, 50),
    },
    data: {
      status: 2,
      text: Buffer.from(text).toString('base64'),
    },
  };
}

export async function ttsWithXfyun(text, outputPath, options = {}) {
  const appId = process.env.XFYUN_TTS_APP_ID;
  const apiKey = process.env.XFYUN_TTS_API_KEY;
  const apiSecret = process.env.XFYUN_TTS_API_SECRET;

  if (!appId || !apiKey || !apiSecret) {
    throw new Error('缺少 XFYUN_TTS_APP_ID、XFYUN_TTS_API_KEY 或 XFYUN_TTS_API_SECRET');
  }

  const url = buildXfyunRequestUrl({ apiKey, apiSecret });
  const payload = buildXfyunPayload(text, options);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const audioChunks = [];
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('讯飞 TTS 超时'));
    }, 30000);

    const cleanup = () => clearTimeout(timeout);

    ws.on('open', () => {
      ws.send(JSON.stringify(payload));
    });

    ws.on('message', (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());
        if (message.code !== 0) {
          throw new Error(message.message || `讯飞 TTS 返回错误码：${message.code}`);
        }

        const audioBase64 = message.data?.audio;
        if (audioBase64) {
          audioChunks.push(Buffer.from(audioBase64, 'base64'));
        }

        if (message.data?.status === 2) {
          saveBuffer(outputPath, Buffer.concat(audioChunks));
          cleanup();
          ws.close();
          logger.debug('TTS', `讯飞TTS完成：${path.basename(outputPath)}`);
          resolve(outputPath);
        }
      } catch (error) {
        cleanup();
        ws.terminate();
        reject(error);
      }
    });

    ws.on('error', (error) => {
      cleanup();
      reject(new Error(`讯飞 TTS 连接失败：${error.message}`));
    });

    ws.on('close', () => {
      cleanup();
    });
  });
}
