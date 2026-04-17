import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE_URL = String(process.env.VIDEO_FALLBACK_BASE_URL || 'https://api.laozhang.ai/v1').replace(/\/+$/, '');
const API_KEY = process.env.VIDEO_FALLBACK_API_KEY || process.env.LAOZHANG_API_KEY || '';
const MODEL = process.env.VIDEO_FALLBACK_MODEL || 'veo-3.0-fast-generate-001';
const SECONDS = String(process.env.VIDEO_FALLBACK_SECONDS || '4');
const POLL_INTERVAL_MS = Number.parseInt(process.env.VIDEO_FALLBACK_POLL_INTERVAL_MS || '5000', 10);
const OUTPUT_DIR = path.resolve(process.cwd(), 'temp', 'video-fallback-min-test');
const VIDEO_WIDTH = Number.parseInt(process.env.VIDEO_WIDTH || '', 10);
const VIDEO_HEIGHT = Number.parseInt(process.env.VIDEO_HEIGHT || '', 10);

function inferSize() {
  if (process.env.VIDEO_FALLBACK_SIZE) {
    return process.env.VIDEO_FALLBACK_SIZE;
  }
  if (Number.isFinite(VIDEO_WIDTH) && VIDEO_WIDTH > 0 && Number.isFinite(VIDEO_HEIGHT) && VIDEO_HEIGHT > 0) {
    return `${VIDEO_WIDTH}x${VIDEO_HEIGHT}`;
  }
  return '720x1280';
}

const SIZE = inferSize();

function sanitizeFileSegment(value, fallback = 'video') {
  const normalized = String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
  return normalized || fallback;
}

function shouldUsePresetResolution(baseUrl) {
  return String(baseUrl || '').toLowerCase().includes('ai.t8star.cn') && String(MODEL || '').toLowerCase().includes('grok');
}

function normalizeSize(size, baseUrl) {
  const normalized = String(size || '').trim();
  if (!normalized) {
    return normalized;
  }

  if (!shouldUsePresetResolution(baseUrl)) {
    return normalized;
  }

  const canonical = normalized.toLowerCase();
  if (canonical === '720x1280' || canonical === '1280x720' || canonical === '720p') {
    return '720P';
  }
  if (canonical === '1080x1920' || canonical === '1920x1080' || canonical === '1080p') {
    return '1080P';
  }

  return normalized;
}

function requireConfig() {
  if (!API_KEY) {
    throw new Error('缺少 VIDEO_FALLBACK_API_KEY（或老张场景下的 LAOZHANG_API_KEY）');
  }
}

function buildBody() {
  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', '一只可爱的小狗狗在路上自然向前走，轻微镜头跟拍，白天，真实风格。');
  form.append('size', normalizeSize(SIZE, BASE_URL));
  form.append('seconds', SECONDS);
  return form;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...(options.headers || {}),
    },
  });

  const rawText = await response.text();
  if (rawText && /^\s*</.test(rawText)) {
    throw new Error(`收到 HTML 而不是 JSON，请检查 VIDEO_FALLBACK_BASE_URL 是否应为 API 根路径（例如补上 /v1）：${url}`);
  }
  const data = rawText ? JSON.parse(rawText) : {};
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function requestBinary(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`下载失败 HTTP ${response.status} ${text}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  requireConfig();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`[video-fallback-min] baseUrl=${BASE_URL}`);
  console.log(`[video-fallback-min] model=${MODEL} size=${normalizeSize(SIZE, BASE_URL)} seconds=${SECONDS}`);

  const created = await requestJson(`${BASE_URL}/videos`, {
    method: 'POST',
    body: buildBody(),
  });

  const videoId = created?.id || created?.taskId || null;
  if (!videoId) {
    throw new Error(`创建成功但未返回任务 ID: ${JSON.stringify(created)}`);
  }

  console.log(`[video-fallback-min] created videoId=${videoId}`);

  while (true) {
    await sleep(POLL_INTERVAL_MS);
    const task = await requestJson(`${BASE_URL}/videos/${videoId}`);
    const status = String(task?.status || task?.state || '').trim().toUpperCase();
    console.log(`[video-fallback-min] status=${status || 'UNKNOWN'}`);

    if (status === 'SUCCEEDED' || status === 'COMPLETED') {
      const buffer = await requestBinary(`${BASE_URL}/videos/${videoId}/content`);
      const outputBaseName = sanitizeFileSegment(videoId, 'video_fallback_min');
      const outputPath = path.join(OUTPUT_DIR, `${outputBaseName}.mp4`);
      fs.writeFileSync(outputPath, buffer);
      console.log(`[video-fallback-min] ok -> ${outputPath}`);
      return;
    }

    if (status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED') {
      throw new Error(`任务失败: ${JSON.stringify(task)}`);
    }
  }
}

main().catch((error) => {
  console.error(`[video-fallback-min] ${error.message}`);
  process.exitCode = 1;
});
