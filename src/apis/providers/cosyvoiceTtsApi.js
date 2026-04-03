import fs from 'node:fs/promises';
import path from 'node:path';

import { saveBuffer } from '../../utils/fileHelper.js';

function normalizeBaseUrl(value) {
  return String(value || 'http://127.0.0.1:50000').replace(/\/+$/g, '');
}

function normalizeMode(options = {}, env = process.env) {
  if (options.mode) {
    return options.mode;
  }

  if (options.referenceAudio) {
    return 'zero_shot';
  }

  return env.COSYVOICE_MODE || 'sft';
}

function resolveRequestPath(mode, options = {}, env = process.env) {
  return options.endpointPath || env.COSYVOICE_REQUEST_PATH || `/inference_${mode}`;
}

async function buildRequestBody(text, options = {}, env = process.env) {
  const mode = normalizeMode(options, env);
  const form = new FormData();
  form.append('tts_text', text);

  if (mode === 'sft') {
    form.append('spk_id', options.voice || env.COSYVOICE_SPK_ID || '');
    return { mode, body: form };
  }

  if (mode === 'zero_shot') {
    form.append('prompt_text', options.promptText || options.referenceText || '');
    form.append('zero_shot_spk_id', options.zeroShotSpeakerId || options.voice || '');

    if (!options.referenceAudio) {
      throw new Error('CosyVoice zero_shot 模式需要 referenceAudio');
    }

    const fileBuffer = await fs.readFile(options.referenceAudio);
    const fileName = path.basename(options.referenceAudio);
    form.append('prompt_speech_16k', new Blob([fileBuffer]), fileName);
    return { mode, body: form };
  }

  if (mode === 'cross_lingual') {
    if (!options.referenceAudio) {
      throw new Error('CosyVoice cross_lingual 模式需要 referenceAudio');
    }

    const fileBuffer = await fs.readFile(options.referenceAudio);
    const fileName = path.basename(options.referenceAudio);
    form.append('zero_shot_spk_id', options.zeroShotSpeakerId || options.voice || '');
    form.append('prompt_speech_16k', new Blob([fileBuffer]), fileName);
    return { mode, body: form };
  }

  if (mode === 'instruct') {
    form.append('spk_id', options.voice || env.COSYVOICE_SPK_ID || '');
    form.append('instruct_text', options.instructText || options.promptText || '');
    return { mode, body: form };
  }

  throw new Error(`未知 CosyVoice mode：${mode}`);
}

export async function buildCosyVoiceRequest(text, options = {}, env = process.env) {
  const { mode, body } = await buildRequestBody(text, options, env);
  const baseUrl = normalizeBaseUrl(options.baseUrl || env.COSYVOICE_BASE_URL);
  const requestPath = resolveRequestPath(mode, options, env);

  return {
    mode,
    url: `${baseUrl}${requestPath}`,
    method: 'POST',
    body,
  };
}

async function readAudioResponse(response, options = {}) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const payload = await response.json();
    const audioBase64 = payload?.audio || payload?.audioBase64 || payload?.data?.audio || null;
    const audioUrl = payload?.audio_url || payload?.audioUrl || payload?.url || payload?.data?.url || null;

    if (audioBase64) {
      return Buffer.from(audioBase64, 'base64');
    }

    if (audioUrl) {
      const fetchImpl = options.fetchImpl || fetch;
      const followUp = await fetchImpl(audioUrl);
      if (!followUp.ok) {
        throw new Error(`CosyVoice 音频下载失败：${followUp.status}`);
      }
      return Buffer.from(await followUp.arrayBuffer());
    }

    throw new Error('CosyVoice 响应中缺少音频数据');
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function ttsWithCosyVoice(text, outputPath, options = {}) {
  const request = await buildCosyVoiceRequest(text, options);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(request.url, {
    method: request.method,
    body: request.body,
    headers: options.headers,
  });

  if (!response.ok) {
    throw new Error(`CosyVoice 请求失败：${response.status} ${response.statusText}`);
  }

  const audioBuffer = await readAudioResponse(response, options);
  saveBuffer(outputPath, audioBuffer);
  return outputPath;
}

export const __testables = {
  normalizeMode,
  resolveRequestPath,
};
