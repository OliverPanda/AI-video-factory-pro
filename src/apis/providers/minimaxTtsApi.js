import { saveBuffer } from '../../utils/fileHelper.js';

function normalizeBaseUrl(value) {
  return String(value || 'https://api.minimax.io').replace(/\/+$/g, '');
}

function normalizeRate(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  if (numericValue > 0 && numericValue <= 3) {
    return Math.min(Math.max(numericValue, 0.5), 2);
  }
  return Math.min(Math.max(Number((numericValue / 50).toFixed(2)), 0.5), 2);
}

function normalizePitch(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  if (numericValue >= -12 && numericValue <= 12) {
    return numericValue;
  }
  return Math.min(Math.max(Number((((numericValue - 50) / 50) * 12).toFixed(2)), -12), 12);
}

function normalizeVolume(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  if (numericValue > 0 && numericValue <= 10) {
    return Math.min(Math.max(numericValue, 0.1), 10);
  }
  return Math.min(Math.max(Number((numericValue / 10).toFixed(2)), 0.1), 10);
}

function resolveDefaultVoice(options = {}, env = process.env) {
  if (options.voice) return options.voice;
  if (options.gender === 'male') {
    return env.MINIMAX_TTS_VOICE_MALE || env.MINIMAX_TTS_VOICE || 'Reliable_Executive';
  }
  return env.MINIMAX_TTS_VOICE_FEMALE || env.MINIMAX_TTS_VOICE || 'Warm_Girl';
}

export function buildMiniMaxTtsRequest(text, options = {}, env = process.env) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || env.MINIMAX_TTS_BASE_URL);
  const endpointPath = options.endpointPath || env.MINIMAX_TTS_REQUEST_PATH || '/v1/t2a_v2';
  const groupId = options.groupId || env.MINIMAX_GROUP_ID || '';
  const url = new URL(`${baseUrl}${endpointPath}`);
  if (groupId) {
    url.searchParams.set('GroupId', groupId);
  }

  const payload = {
    model: options.model || env.MINIMAX_TTS_MODEL || 'speech-2.5-hd-preview',
    text,
    stream: false,
    subtitle_enable: false,
    voice_setting: {
      voice_id: resolveDefaultVoice(options, env),
      speed: normalizeRate(options.rate, Number(env.MINIMAX_TTS_SPEED || '1')),
      vol: normalizeVolume(options.volume, Number(env.MINIMAX_TTS_VOLUME || '1')),
      pitch: normalizePitch(options.pitch, Number(env.MINIMAX_TTS_PITCH || '0')),
    },
    audio_setting: {
      sample_rate: Number.parseInt(options.sampleRate || env.MINIMAX_TTS_SAMPLE_RATE || '32000', 10),
      bitrate: Number.parseInt(options.bitrate || env.MINIMAX_TTS_BITRATE || '128000', 10),
      format: options.format || env.MINIMAX_TTS_AUDIO_FORMAT || 'mp3',
      channel: Number.parseInt(options.channel || env.MINIMAX_TTS_CHANNEL || '1', 10),
    },
  };

  if (options.emotion || env.MINIMAX_TTS_EMOTION) {
    payload.voice_setting.emotion = options.emotion || env.MINIMAX_TTS_EMOTION;
  }

  return {
    url: url.toString(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey || env.MINIMAX_API_KEY || ''}`,
      ...(options.headers || {}),
    },
    body: JSON.stringify(payload),
  };
}

function readMiniMaxAudioBuffer(payload) {
  const hexAudio = payload?.data?.audio || payload?.audio || null;
  if (!hexAudio || typeof hexAudio !== 'string') {
    throw new Error('MiniMax TTS 响应中缺少 audio 十六进制数据');
  }
  return Buffer.from(hexAudio, 'hex');
}

export async function ttsWithMiniMax(text, outputPath, options = {}) {
  const request = buildMiniMaxTtsRequest(text, options);
  if (!request.headers.Authorization || request.headers.Authorization === 'Bearer ') {
    throw new Error('缺少 MINIMAX_API_KEY');
  }

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  if (!response.ok) {
    throw new Error(`MiniMax TTS 请求失败：${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload?.base_resp?.status_code && payload.base_resp.status_code !== 0) {
    throw new Error(payload.base_resp.status_msg || `MiniMax TTS 返回错误：${payload.base_resp.status_code}`);
  }

  const audioBuffer = readMiniMaxAudioBuffer(payload);
  saveBuffer(outputPath, audioBuffer);
  return outputPath;
}

export const __testables = {
  buildMiniMaxTtsRequest,
  normalizeBaseUrl,
  normalizePitch,
  normalizeRate,
  normalizeVolume,
  readMiniMaxAudioBuffer,
  resolveDefaultVoice,
};
