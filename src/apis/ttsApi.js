/**
 * TTS 配音 API 封装
 * 支持：阿里云语音合成 | Azure Speech
 * 通过 TTS_PROVIDER 环境变量控制
 */

import 'dotenv/config';
import axios from 'axios';
import path from 'path';
import { saveBuffer } from '../utils/fileHelper.js';
import logger from '../utils/logger.js';

const DEFAULT_PROVIDER = process.env.TTS_PROVIDER || 'aliyun';

// ─── 阿里云 TTS ───────────────────────────────────────────────
// 文档：https://help.aliyun.com/zh/isi/developer-reference/overview-of-real-time-speech-synthesis
async function ttsWithAliyun(text, outputPath, options = {}) {
  const appKey = process.env.ALIYUN_TTS_APP_KEY;
  const token = process.env.ALIYUN_TTS_TOKEN;
  if (!appKey || !token) throw new Error('缺少 ALIYUN_TTS_APP_KEY 或 ALIYUN_TTS_TOKEN');

  const voice = options.voice || (options.gender === 'female' ? 'zhixiaobai' : 'zhimiao_emo');
  const baseUrl = process.env.ALIYUN_TTS_BASE_URL || 'https://nls-gateway.cn-shanghai.aliyuncs.com';

  const params = new URLSearchParams({
    appkey: appKey,
    token,
    text: text.slice(0, 300), // 阿里云单次限制300字
    voice,
    format: 'mp3',
    sample_rate: '16000',
    speech_rate: String(options.rate || 0),
    pitch_rate: String(options.pitch || 0),
  });

  const response = await axios.get(`${baseUrl}/stream/v1/tts?${params}`, {
    responseType: 'arraybuffer',
    timeout: 30000,
  });

  saveBuffer(outputPath, Buffer.from(response.data));
  logger.debug('TTS', `阿里云TTS完成：${path.basename(outputPath)}`);
  return outputPath;
}

// ─── Azure Speech ────────────────────────────────────────────
async function ttsWithAzure(text, outputPath, options = {}) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'eastasia';
  if (!key) throw new Error('缺少 AZURE_SPEECH_KEY');

  const voice = options.voice || (options.gender === 'female' ? 'zh-CN-XiaoxiaoNeural' : 'zh-CN-YunxiNeural');
  const ssml = `
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
  <voice name="${voice}">
    <prosody rate="${options.rate || '0%'}" pitch="${options.pitch || '0%'}">
      ${text}
    </prosody>
  </voice>
</speak>`.trim();

  const response = await axios.post(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    ssml,
    {
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-48khz-192kbitrate-mono-mp3',
      },
      responseType: 'arraybuffer',
      timeout: 30000,
    }
  );

  saveBuffer(outputPath, Buffer.from(response.data));
  logger.debug('TTS', `Azure TTS完成：${path.basename(outputPath)}`);
  return outputPath;
}

// ─── 统一接口 ────────────────────────────────────────────────
/**
 * 文字转语音
 * @param {string} text - 台词文本
 * @param {string} outputPath - 音频保存路径（.mp3）
 * @param {Object} options - { gender: 'male'|'female', rate, pitch, voice, provider }
 * @returns {Promise<string>} 音频文件路径
 */
export async function textToSpeech(text, outputPath, options = {}) {
  if (!text || text.trim() === '') {
    logger.debug('TTS', `跳过空台词：${path.basename(outputPath)}`);
    return null;
  }

  const provider = options.provider || DEFAULT_PROVIDER;
  logger.info('TTS', `合成语音 [${provider}]：${text.slice(0, 30)}...`);

  if (provider === 'azure') {
    return ttsWithAzure(text, outputPath, options);
  }
  return ttsWithAliyun(text, outputPath, options);
}

/**
 * 批量合成（返回 null 表示该镜头无台词）
 */
export async function batchTTS(tasks) {
  return Promise.all(
    tasks.map(({ text, outputPath, options }) => textToSpeech(text, outputPath, options))
  );
}
