import fs from 'node:fs/promises';

import { saveBuffer } from '../../utils/fileHelper.js';

function normalizeBaseUrl(value) {
  return String(value || 'http://127.0.0.1:8080').replace(/\/+$/g, '');
}

function resolveRequestUrl(options = {}, env = process.env) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || env.FISH_SPEECH_BASE_URL);
  const endpointPath = options.endpointPath || env.FISH_SPEECH_REQUEST_PATH || '/v1/tts';
  return `${baseUrl}${endpointPath}`;
}

async function maybeReadReferenceAudioBase64(referenceAudio) {
  if (!referenceAudio) {
    return null;
  }

  const fileBuffer = await fs.readFile(referenceAudio);
  return fileBuffer.toString('base64');
}

export async function buildFishSpeechRequest(text, options = {}, env = process.env) {
  const payload = {
    text,
  };

  if (options.referenceId || env.FISH_SPEECH_REFERENCE_ID) {
    payload.reference_id = options.referenceId || env.FISH_SPEECH_REFERENCE_ID;
  }

  const referenceAudio = await maybeReadReferenceAudioBase64(options.referenceAudio);
  if (referenceAudio) {
    payload.reference_audio = referenceAudio;
  }

  if (options.referenceText) {
    payload.reference_text = options.referenceText;
  }

  if (options.maxNewTokens !== undefined) {
    payload.max_new_tokens = options.maxNewTokens;
  }

  if (options.chunkLength !== undefined) {
    payload.chunk_length = options.chunkLength;
  }

  if (options.topP !== undefined) {
    payload.top_p = options.topP;
  }

  if (options.repetitionPenalty !== undefined) {
    payload.repetition_penalty = options.repetitionPenalty;
  }

  if (options.temperature !== undefined) {
    payload.temperature = options.temperature;
  }

  if (options.format || env.FISH_SPEECH_AUDIO_FORMAT) {
    payload.format = options.format || env.FISH_SPEECH_AUDIO_FORMAT;
  }

  return {
    url: resolveRequestUrl(options, env),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.apiKey || env.FISH_SPEECH_API_KEY
        ? { Authorization: `Bearer ${options.apiKey || env.FISH_SPEECH_API_KEY}` }
        : {}),
      ...(options.headers || {}),
    },
    body: JSON.stringify(payload),
  };
}

async function readFishSpeechResponse(response, options = {}) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const payload = await response.json();
    const audioBase64 = payload?.audio || payload?.audio_base64 || payload?.data?.audio || null;
    const audioUrl = payload?.audio_url || payload?.url || payload?.data?.url || null;

    if (audioBase64) {
      return Buffer.from(audioBase64, 'base64');
    }

    if (audioUrl) {
      const fetchImpl = options.fetchImpl || fetch;
      const followUp = await fetchImpl(audioUrl);
      if (!followUp.ok) {
        throw new Error(`Fish Speech 音频下载失败：${followUp.status}`);
      }
      return Buffer.from(await followUp.arrayBuffer());
    }

    throw new Error('Fish Speech 响应中缺少音频数据');
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function ttsWithFishSpeech(text, outputPath, options = {}) {
  const request = await buildFishSpeechRequest(text, options);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  if (!response.ok) {
    throw new Error(`Fish Speech 请求失败：${response.status} ${response.statusText}`);
  }

  const audioBuffer = await readFishSpeechResponse(response, options);
  saveBuffer(outputPath, audioBuffer);
  return outputPath;
}
