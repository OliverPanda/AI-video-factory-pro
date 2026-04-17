import 'dotenv/config';
import path from 'node:path';
import { setTimeout as sleepTimeout } from 'node:timers/promises';

import axios from 'axios';

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

import logger from '../utils/logger.js';
import { ensureEnglishPrompt } from '../utils/translatePrompt.js';
import { imageToBase64, saveBuffer } from '../utils/fileHelper.js';
import {
  normalizeVideoProviderError,
  normalizeVideoProviderRequest,
  normalizeVideoProviderResult,
} from './videoProviderProtocol.js';

const SEEDANCE_API_BASE_URL = process.env.SEEDANCE_API_BASE_URL || process.env.VIDEO_FALLBACK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const SEEDANCE_DEFAULT_MODEL = process.env.SEEDANCE_MODEL_ID || 'doubao-seedance-2-0-260128';
const SEEDANCE_DEFAULT_POLL_INTERVAL_MS = Number.parseInt(process.env.SEEDANCE_POLL_INTERVAL_MS || '10000', 10);
const SEEDANCE_DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.SEEDANCE_TIMEOUT_MS || '600000', 10);
const SEEDANCE_DEFAULT_RATIO = process.env.SEEDANCE_VIDEO_RATIO || '9:16';
const SEEDANCE_DEFAULT_DURATION_SEC = Number.parseInt(process.env.SEEDANCE_DEFAULT_DURATION_SEC || '5', 10);

function createProviderError(message, extras = {}) {
  return normalizeVideoProviderError({
    message,
    code: extras.code || 'SEEDANCE_VIDEO_ERROR',
    category: extras.category || 'provider_generation_failed',
    status: extras.status || null,
    details: extras.details || null,
  });
}

function normalizeSeedanceDuration(durationTargetSec) {
  const target = Number(durationTargetSec);
  if (!Number.isFinite(target)) return SEEDANCE_DEFAULT_DURATION_SEC;
  if (target < 4) return 4;
  if (target > 15) return 15;
  return Math.round(target);
}

function inferRatio(shotPackage, env = process.env) {
  if (shotPackage?.cameraSpec?.ratio) {
    return shotPackage.cameraSpec.ratio;
  }
  return env.SEEDANCE_VIDEO_RATIO || env.VIDEO_ASPECT_RATIO || SEEDANCE_DEFAULT_RATIO;
}

function buildSequencePromptHint(shotPackage = {}) {
  const summary = String(shotPackage?.sequenceContextSummary || '');
  const inferredSequenceType = summary.match(/sequence type:\s*([a-z_]+)/i)?.[1] || null;
  const sequenceType =
    shotPackage?.providerRequestHints?.sequenceType ||
    shotPackage?.sequenceType ||
    inferredSequenceType ||
    null;
  switch (sequenceType) {
    case 'fight_exchange_sequence':
      return 'continuous attack-and-defense exchange, preserve weapon path, keep body momentum coherent, match the incoming attack pose at the opening, and end on a readable defensive handoff';
    case 'chase_run_sequence':
      return 'sustain forward chase momentum, keep acceleration coherent, avoid broken travel direction, open on the incoming run line, and exit with a stable forward handoff';
    case 'dialogue_move_sequence':
      return 'sustain walking dialogue pressure, keep conversational pacing stable, maintain blocking continuity, keep the dialogue rhythm connected, and exit on a clean conversational handoff';
    default:
      return '';
  }
}

function normalizeStringArray(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
}

function normalizePromptBlockKey(value) {
  return String(value || '').trim().toLowerCase();
}

function buildReferenceBindingInstructions(shotPackage = {}) {
  const instructions = [];
  const referenceImages = Array.isArray(shotPackage?.referenceImages) ? shotPackage.referenceImages : [];
  const referenceVideos = Array.isArray(shotPackage?.referenceVideos) ? shotPackage.referenceVideos : [];

  referenceImages.slice(0, 9).forEach((image, index) => {
    const refName = `image${index + 1}`;
    const role = String(image?.role || (index === 0 ? 'first frame keyframe' : 'supporting reference')).replace(/_/g, ' ');
    const shotRef = image?.shotId ? ` for shot ${image.shotId}` : '';
    instructions.push(`${refName} is the ${role}${shotRef}`.trim());
  });

  referenceVideos.slice(0, 3).forEach((video, index) => {
    const refName = `video${index + 1}`;
    const role = String(video?.type || 'motion reference').replace(/_/g, ' ');
    const shotRef = video?.shotId ? ` for shot ${video.shotId}` : '';
    instructions.push(`${refName} is the ${role}${shotRef}`.trim());
  });

  if (shotPackage?.continuationVideoRef?.path) {
    instructions.push(`video${referenceVideos.length + 1 || 1} is the continuation tail reference for motion handoff`);
  }

  return instructions;
}

function formatStructuredPromptBlocks(promptBlocks = []) {
  const blocksByKey = new Map(
    promptBlocks.map((block) => [normalizePromptBlockKey(block?.key), String(block?.text || '').trim()]).filter(([, text]) => Boolean(text))
  );

  const orderedSections = [
    ['subject_action', 'subject and action'],
    ['scene_environment', 'scene and style'],
    ['cinematography', 'camera and timing'],
    ['reference_binding', 'reference binding'],
    ['cinematic_intent', 'cinematic intent'],
    ['shot_goal', 'narrative goal'],
    ['entry_exit', 'entry and exit'],
    ['timecoded_beats', 'action beats'],
    ['camera_plan', 'camera plan'],
    ['blocking', 'blocking'],
    ['continuity_locks', 'continuity locks'],
    ['negative_rules', 'negative rules'],
    ['quality_target', 'quality target'],
  ];

  const usedKeys = new Set();
  const sections = [];
  for (const [key, label] of orderedSections) {
    const text = blocksByKey.get(key);
    if (!text) continue;
    usedKeys.add(key);
    sections.push(`${label}: ${text}`);
  }

  for (const block of promptBlocks) {
    const key = normalizePromptBlockKey(block?.key);
    const text = String(block?.text || '').trim();
    if (!text || usedKeys.has(key)) continue;
    const label = key ? key.replace(/_/g, ' ') : 'Additional direction';
    sections.push(`${label}: ${text}`);
  }

  return sections.join('. ');
}

async function buildPromptText(shotPackage) {
  const promptBlocks = Array.isArray(shotPackage?.seedancePromptBlocks)
    ? shotPackage.seedancePromptBlocks.map((block) => String(block?.text || '').trim()).filter(Boolean)
    : [];
  if (Array.isArray(shotPackage?.seedancePromptBlocks) && shotPackage.seedancePromptBlocks.length > 0) {
    return ensureEnglishPrompt(formatStructuredPromptBlocks(shotPackage.seedancePromptBlocks));
  }

  const providerRequestHints = shotPackage?.providerRequestHints;
  const audioBeatHints = Array.isArray(providerRequestHints?.audioBeatHints)
    ? providerRequestHints.audioBeatHints
    : Array.isArray(shotPackage?.audioBeatHints)
      ? shotPackage.audioBeatHints
      : [];
  const continuityTargets = normalizeStringArray(providerRequestHints?.continuityTargets);
  const preserveElements = normalizeStringArray(providerRequestHints?.preserveElements);
  const hardContinuityRules = normalizeStringArray(providerRequestHints?.hardContinuityRules);
  const referenceBindings = buildReferenceBindingInstructions(shotPackage);
  const sceneAndStyleFallback = [
    continuityTargets.length > 0 ? `environment continuity: ${continuityTargets.join(', ')}` : '',
    preserveElements.length > 0 ? `preserve elements: ${preserveElements.join(', ')}` : '',
    shotPackage?.continuitySpec ? `continuity spec: ${shotPackage.continuitySpec}` : '',
  ].filter(Boolean).join('. ');

  const subjectAndAction = [
    shotPackage?.visualGoal || '',
    providerRequestHints?.sequenceGoal ? `sequence goal: ${providerRequestHints.sequenceGoal}` : '',
    shotPackage?.sequenceContextSummary || '',
    buildSequencePromptHint(shotPackage),
  ].filter(Boolean).join('. ');

  const sceneAndStyle = [
    shotPackage?.generationPack?.space_anchor ? `location: ${shotPackage.generationPack.space_anchor}` : '',
    providerRequestHints?.sceneGoal ? `scene goal: ${providerRequestHints.sceneGoal}` : '',
    providerRequestHints?.dramaticQuestion ? `dramatic question: ${providerRequestHints.dramaticQuestion}` : '',
    sceneAndStyleFallback,
  ].filter(Boolean).join('. ');

  const cameraAndTiming = [
    shotPackage?.cameraSpec?.moveType ? `camera motion: ${shotPackage.cameraSpec.moveType}` : '',
    shotPackage?.cameraSpec?.framing ? `framing: ${shotPackage.cameraSpec.framing}` : '',
    providerRequestHints?.cameraFlowIntent ? `camera flow intent: ${providerRequestHints.cameraFlowIntent}` : '',
    audioBeatHints.length > 0 ? `audio beat hints: ${audioBeatHints.join(', ')}` : '',
  ].filter(Boolean).join('. ');

  const referenceBinding = [
    providerRequestHints?.referenceTier ? `reference tier: ${providerRequestHints.referenceTier}` : '',
    referenceBindings.length > 0 ? referenceBindings.join('. ') : '',
  ].filter(Boolean).join('. ');

  const rawPrompt = [
    subjectAndAction ? `subject and action: ${subjectAndAction}` : '',
    sceneAndStyle ? `scene and style: ${sceneAndStyle}` : '',
    cameraAndTiming ? `camera and timing: ${cameraAndTiming}` : '',
    referenceBinding ? `reference binding: ${referenceBinding}` : '',
    providerRequestHints?.entryConstraint ? `entry anchor: ${providerRequestHints.entryConstraint}` : shotPackage?.entryFrameHint ? `entry anchor: ${shotPackage.entryFrameHint}` : '',
    providerRequestHints?.exitConstraint ? `exit anchor: ${providerRequestHints.exitConstraint}` : shotPackage?.exitFrameHint ? `exit anchor: ${shotPackage.exitFrameHint}` : '',
    continuityTargets.length > 0 ? `continuity locks: ${continuityTargets.join(', ')}` : shotPackage?.continuitySpec ? `continuity locks: ${shotPackage.continuitySpec}` : '',
    hardContinuityRules.length > 0 ? `hard continuity rules: ${hardContinuityRules.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('. ');

  return ensureEnglishPrompt(rawPrompt);
}

function toSeedanceImageContent(referenceImage, index = 0, roleOverride = null) {
  return {
    type: 'image_url',
    image_url: {
      url: imageToBase64(referenceImage.path),
    },
    role: roleOverride || (index === 0 ? 'first_frame' : 'reference_image'),
  };
}

export async function buildSeedanceVideoRequest(shotPackage, env = process.env) {
  const referenceImages = (Array.isArray(shotPackage?.referenceImages) ? shotPackage.referenceImages : []).slice(0, 9);
  const promptText = await buildPromptText(shotPackage);

  if (!promptText && referenceImages.length === 0) {
    throw createProviderError('缺少 Seedance 输入内容，至少需要文本或参考图', {
      code: 'SEEDANCE_MISSING_INPUT',
      category: 'provider_invalid_request',
    });
  }

  const content = [];
  if (promptText) {
    content.push({ type: 'text', text: promptText });
  }
  for (const [index, referenceImage] of referenceImages.entries()) {
    content.push(toSeedanceImageContent(referenceImage, index));
  }

  return {
    model: env.SEEDANCE_MODEL_ID || SEEDANCE_DEFAULT_MODEL,
    content,
    ratio: inferRatio(shotPackage, env),
    duration: normalizeSeedanceDuration(shotPackage?.durationTargetSec),
    generate_audio: false,
    watermark: false,
  };
}

export function classifySeedanceError(error) {
  const status = error?.response?.status ?? error?.status ?? null;
  const responseData = error?.response?.data || null;

  if (error?.category) {
    return createProviderError(error.message || 'Seedance 生成失败', {
      code: error.code || 'SEEDANCE_VIDEO_ERROR',
      category: error.category,
      status,
      details: error.details || responseData,
    });
  }

  if (status === 401 || status === 403) {
    return createProviderError(error.message || 'Seedance 鉴权失败', {
      code: 'SEEDANCE_AUTH_ERROR',
      category: 'provider_auth_error',
      status,
      details: responseData,
    });
  }

  if (status === 429) {
    return createProviderError(error.message || 'Seedance 限流', {
      code: 'SEEDANCE_RATE_LIMIT',
      category: 'provider_rate_limit',
      status,
      details: responseData,
    });
  }

  if (status >= 400 && status < 500) {
    return createProviderError(error.message || 'Seedance 请求参数错误', {
      code: 'SEEDANCE_INVALID_REQUEST',
      category: 'provider_invalid_request',
      status,
      details: responseData,
    });
  }

  if (status >= 500) {
    return createProviderError(error.message || 'Seedance 服务端异常', {
      code: 'SEEDANCE_SERVER_ERROR',
      category: 'provider_generation_failed',
      status,
      details: responseData,
    });
  }

  if (error?.code === 'ECONNABORTED' || String(error?.message || '').toLowerCase().includes('timeout')) {
    return createProviderError(error.message || 'Seedance 请求超时', {
      code: 'SEEDANCE_TIMEOUT',
      category: 'provider_timeout',
      status,
      details: responseData,
    });
  }

  return createProviderError(error?.message || 'Seedance 生成失败', {
    code: error?.code || 'SEEDANCE_UNKNOWN_ERROR',
    category: 'provider_generation_failed',
    status,
    details: responseData,
  });
}

function extractVideoTail(videoPath, tailSec = 3) {
  const tempPath = path.join(os.tmpdir(), `seedance_tail_${Date.now()}.mp4`);
  try {
    execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', videoPath,
    ], { encoding: 'utf-8', timeout: 10000 });
  } catch {
    return null;
  }
  try {
    const durationStr = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', videoPath,
    ], { encoding: 'utf-8', timeout: 10000 }).trim();
    const duration = parseFloat(durationStr);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const startTime = Math.max(0, duration - tailSec);
    execFileSync('ffmpeg', [
      '-y', '-ss', String(startTime), '-i', videoPath,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-an', tempPath,
    ], { timeout: 30000 });
    if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
      return tempPath;
    }
    return null;
  } catch {
    return null;
  }
}

function toSeedanceVideoContent(videoPath) {
  const videoData = fs.readFileSync(videoPath);
  const base64 = videoData.toString('base64');
  return {
    type: 'video_url',
    video_url: { url: `data:video/mp4;base64,${base64}` },
    role: 'reference_video',
  };
}

function resolveSeedanceApiKey(options = {}, env = process.env) {
  return options.apiKey || env.SEEDANCE_API_KEY || env.VIDEO_FALLBACK_API_KEY || env.ARK_API_KEY || null;
}

function createSeedanceHttpClients(options = {}, env = process.env) {
  const apiKey = resolveSeedanceApiKey(options, env);
  if (!apiKey) {
    throw createProviderError('缺少 SEEDANCE_API_KEY / VIDEO_FALLBACK_API_KEY / ARK_API_KEY，无法生成动态镜头', {
      code: 'SEEDANCE_AUTH_MISSING',
      category: 'provider_auth_error',
    });
  }

  return {
    httpClient: options.httpClient || axios.create({
      baseURL: options.baseUrl || env.SEEDANCE_API_BASE_URL || env.VIDEO_FALLBACK_BASE_URL || SEEDANCE_API_BASE_URL,
      timeout: options.timeoutMs || SEEDANCE_DEFAULT_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }),
    binaryClient: options.binaryHttpClient || axios,
  };
}

async function submitSeedanceTask(requestBody, options = {}, env = process.env) {
  const { httpClient } = createSeedanceHttpClients(options, env);
  try {
    const createResponse = await httpClient.post('/contents/generations/tasks', requestBody);
    const taskId = createResponse?.data?.id || null;
    if (!taskId) {
      throw createProviderError('Seedance 未返回任务 ID', {
        code: 'SEEDANCE_INVALID_RESPONSE',
        category: 'provider_generation_failed',
        details: createResponse?.data || null,
      });
    }
    return {
      taskId,
      provider: 'seedance',
      outputUrl: createResponse?.data?.content?.video_url || null,
      response: createResponse?.data || null,
    };
  } catch (error) {
    throw classifySeedanceError(error);
  }
}

async function pollSeedanceTask(taskId, options = {}, env = process.env) {
  const { httpClient } = createSeedanceHttpClients(options, env);
  const sleep = options.sleep || ((ms) => sleepTimeout(ms));
  const pollIntervalMs = options.pollIntervalMs || SEEDANCE_DEFAULT_POLL_INTERVAL_MS;
  const overallTimeoutMs = options.overallTimeoutMs || SEEDANCE_DEFAULT_TIMEOUT_MS;

  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < overallTimeoutMs) {
      await sleep(pollIntervalMs);
      const taskResponse = await httpClient.get(`/contents/generations/tasks/${taskId}`);
      const task = taskResponse?.data || {};
      const status = String(task.status || '').trim().toLowerCase();

      if (status === 'succeeded') {
        const outputUrl = task?.content?.video_url || null;
        if (!outputUrl) {
          throw createProviderError('Seedance 任务成功但未返回视频地址', {
            code: 'SEEDANCE_MISSING_OUTPUT',
            category: 'provider_generation_failed',
            details: task,
          });
        }
        return {
          status: 'COMPLETED',
          outputUrl,
          actualDurationSec: task?.duration || null,
          task,
        };
      }

      if (status === 'failed' || status === 'expired' || status === 'cancelled') {
        throw createProviderError(task?.error?.message || `Seedance 任务${status}`, {
          code: task?.error?.code || 'SEEDANCE_TASK_FAILED',
          category: status === 'expired' ? 'provider_timeout' : 'provider_generation_failed',
          details: task,
        });
      }
    }

    throw createProviderError('Seedance 任务轮询超时', {
      code: 'SEEDANCE_TIMEOUT',
      category: 'provider_timeout',
    });
  } catch (error) {
    throw classifySeedanceError(error);
  }
}

async function downloadSeedanceTask(outputUrl, outputPath, options = {}) {
  const binaryClient = options.binaryHttpClient || axios;
  try {
    const binary = await binaryClient.get(outputUrl, { responseType: 'arraybuffer' });
    saveBuffer(outputPath, Buffer.from(binary.data));
    return {
      outputPath,
    };
  } catch (error) {
    throw classifySeedanceError(error);
  }
}

export function createSeedanceVideoTransport(options = {}) {
  const env = options.env || process.env;
  return {
    name: 'seedance',
    async submitVideoGeneration(videoPackage, submitOptions = {}) {
      const runtimeEnv = submitOptions.env || env;
      const requestBody = submitOptions.requestBody || null;
      const requestSummary = submitOptions.requestSummary || null;
      if (!requestBody || !requestSummary) {
        throw createProviderError('缺少 Seedance transport 提交所需的 requestBody 或 requestSummary', {
          code: 'SEEDANCE_TRANSPORT_REQUEST_MISSING',
          category: 'provider_invalid_request',
        });
      }
      const result = await submitSeedanceTask(requestBody, { ...options, ...submitOptions }, runtimeEnv);
      return {
        taskId: result.taskId,
        provider: 'seedance',
        model: requestBody.model,
        outputUrl: result.outputUrl,
        providerRequest: requestSummary.providerRequest,
        providerMetadata: requestSummary.providerMetadata,
      };
    },
    async pollVideoGeneration(taskId, pollOptions = {}) {
      return pollSeedanceTask(taskId, { ...options, ...pollOptions }, pollOptions.env || env);
    },
    async downloadVideoGeneration(outputUrl, outputPath, downloadOptions = {}) {
      await downloadSeedanceTask(outputUrl, outputPath, { ...options, ...downloadOptions });
      return {
        outputPath,
      };
    },
  };
}

async function executeSeedanceTask(requestBody, requestSummary, outputPath, entityRef, options = {}, env = process.env) {
  const apiKey = options.apiKey || env.SEEDANCE_API_KEY || env.VIDEO_FALLBACK_API_KEY || env.ARK_API_KEY;
  if (!apiKey) {
    throw createProviderError('缺少 SEEDANCE_API_KEY / VIDEO_FALLBACK_API_KEY / ARK_API_KEY，无法生成动态镜头', {
      code: 'SEEDANCE_AUTH_MISSING',
      category: 'provider_auth_error',
    });
  }

  try {
    const transport = createSeedanceVideoTransport({
      ...options,
      env,
    });
    const submitResult = await transport.submitVideoGeneration({}, {
      ...options,
      env,
      requestBody,
      requestSummary,
    });
    const pollResult = await transport.pollVideoGeneration(submitResult.taskId, {
      ...options,
      env,
    });
    await transport.downloadVideoGeneration(pollResult.outputUrl, outputPath, {
      ...options,
      env,
    });

    return normalizeVideoProviderResult({
      provider: 'seedance',
      shotId: entityRef.shotId || null,
      preferredProvider: entityRef.preferredProvider || 'seedance',
      videoPath: outputPath,
      outputUrl: pollResult.outputUrl,
      taskId: submitResult.taskId,
      providerJobId: submitResult.taskId,
      targetDurationSec: entityRef.durationTargetSec || pollResult.task?.duration || null,
      actualDurationSec: pollResult.actualDurationSec || entityRef.durationTargetSec || null,
      providerRequest: requestSummary.providerRequest,
      providerMetadata: {
        ...requestSummary.providerMetadata,
        resolution: pollResult.task?.resolution || null,
        ratio: pollResult.task?.ratio || requestBody.ratio,
        framesPerSecond: pollResult.task?.framespersecond || null,
        lastFrameUrl: pollResult.task?.content?.last_frame_url || null,
        serviceTier: pollResult.task?.service_tier || null,
      },
      extra: {
        requestBody,
        seed: pollResult.task?.seed ?? null,
      },
    });
  } catch (error) {
    throw classifySeedanceError(error);
  }
}

export async function seedanceImageToVideo(shotPackage, outputPath, options = {}, env = process.env) {
  const requestBody = await buildSeedanceVideoRequest(shotPackage, env);
  const requestSummary = normalizeVideoProviderRequest({
    provider: 'seedance',
    request: {
      model: requestBody.model,
      ratio: requestBody.ratio,
      duration: requestBody.duration,
      generate_audio: requestBody.generate_audio,
      watermark: requestBody.watermark,
      contentTypes: requestBody.content.map((item) => `${item.type}:${item.role || 'default'}`),
      promptText: requestBody.content.find((item) => item.type === 'text')?.text || null,
    },
    metadata: {
      shotId: shotPackage?.shotId || null,
      sequenceId: shotPackage?.sequenceId || null,
      referenceImageCount: (shotPackage?.referenceImages || []).length,
      referenceTier: shotPackage?.providerRequestHints?.referenceTier || null,
      referenceCount: shotPackage?.providerRequestHints?.referenceCount ?? (shotPackage?.referenceImages || []).length,
      referenceStrategy: shotPackage?.referenceStrategy || null,
    },
  });
  const entityRef = {
    shotId: shotPackage?.shotId || null,
    preferredProvider: shotPackage?.preferredProvider || 'seedance',
    durationTargetSec: shotPackage?.durationTargetSec || null,
  };
  return executeSeedanceTask(requestBody, requestSummary, outputPath, entityRef, options, env);
}

export function buildSeedanceBridgeRequest(bridgePackage, env = process.env) {
  const promptText = (Array.isArray(bridgePackage?.promptDirectives) ? bridgePackage.promptDirectives : [])
    .filter(Boolean)
    .join('. ');

  const content = [];
  if (promptText) {
    content.push({ type: 'text', text: promptText });
  }
  if (bridgePackage?.fromReferenceImage) {
    content.push(toSeedanceImageContent({ path: bridgePackage.fromReferenceImage }, 0, 'first_frame'));
  }
  if (bridgePackage?.toReferenceImage) {
    content.push(toSeedanceImageContent({ path: bridgePackage.toReferenceImage }, 1, 'last_frame'));
  }

  if (!promptText && content.length <= 0) {
    throw createProviderError('缺少桥接镜头输入内容，至少需要文本或参考图', {
      code: 'SEEDANCE_MISSING_BRIDGE_INPUT',
      category: 'provider_invalid_request',
    });
  }

  return {
    model: env.SEEDANCE_MODEL_ID || SEEDANCE_DEFAULT_MODEL,
    content,
    ratio: env.SEEDANCE_VIDEO_RATIO || SEEDANCE_DEFAULT_RATIO,
    duration: normalizeSeedanceDuration(bridgePackage?.durationTargetSec),
    generate_audio: false,
    watermark: false,
  };
}

export async function seedanceBridgeToVideo(bridgePackage, outputPath, options = {}, env = process.env) {
  const requestBody = buildSeedanceBridgeRequest(bridgePackage, env);
  const requestSummary = normalizeVideoProviderRequest({
    provider: 'seedance',
    request: {
      model: requestBody.model,
      ratio: requestBody.ratio,
      duration: requestBody.duration,
      contentTypes: requestBody.content.map((item) => `${item.type}:${item.role || 'default'}`),
      promptText: requestBody.content.find((item) => item.type === 'text')?.text || null,
    },
    metadata: {
      bridgeId: bridgePackage?.bridgeId || null,
      fromShotId: bridgePackage?.fromShotRef?.shotId || null,
      toShotId: bridgePackage?.toShotRef?.shotId || null,
      firstLastFrameMode: bridgePackage?.firstLastFrameMode || null,
    },
  });
  const entityRef = {
    shotId: bridgePackage?.bridgeId || null,
    preferredProvider: 'seedance',
    durationTargetSec: bridgePackage?.durationTargetSec || null,
  };
  return executeSeedanceTask(requestBody, requestSummary, outputPath, entityRef, options, env);
}

export async function buildSeedanceMultiShotRequest(sequencePackage, env = process.env) {
  const referenceImages = (Array.isArray(sequencePackage?.referenceImages) ? sequencePackage.referenceImages : []).slice(0, 9);
  let promptText = await buildPromptText(sequencePackage);

  if (referenceImages.length > 1) {
    const imageAnnotations = referenceImages
      .map((img, i) => `@image${i + 1} represents shot ${img.shotId || i + 1}`)
      .join('. ');
    promptText = promptText ? `${promptText}. ${imageAnnotations}` : imageAnnotations;
  }

  const content = [];
  if (promptText) {
    content.push({ type: 'text', text: promptText });
  }
  for (const [index, img] of referenceImages.entries()) {
    content.push(toSeedanceImageContent(img, index));
  }

  if (sequencePackage?.continuationVideoRef?.path) {
    const tailSec = parseInt(env.SEEDANCE_CONTINUATION_TAIL_SEC || '3', 10);
    const tailPath = extractVideoTail(sequencePackage.continuationVideoRef.path, tailSec);
    if (tailPath) {
      try {
        content.push(toSeedanceVideoContent(tailPath));
      } finally {
        try { fs.unlinkSync(tailPath); } catch { /* ignore cleanup errors */ }
      }
    }
  }

  if (!promptText && content.length <= 0) {
    throw createProviderError('缺少多镜头叙事输入内容，至少需要文本或参考图', {
      code: 'SEEDANCE_MISSING_MULTISHOT_INPUT',
      category: 'provider_invalid_request',
    });
  }

  return {
    model: env.SEEDANCE_MODEL_ID || SEEDANCE_DEFAULT_MODEL,
    content,
    ratio: inferRatio(sequencePackage, env),
    duration: normalizeSeedanceDuration(sequencePackage?.durationTargetSec),
    generate_audio: false,
    watermark: false,
  };
}

export async function seedanceMultiShotToVideo(sequencePackage, outputPath, options = {}, env = process.env) {
  const requestBody = await buildSeedanceMultiShotRequest(sequencePackage, env);
  const requestSummary = normalizeVideoProviderRequest({
    provider: 'seedance',
    request: {
      model: requestBody.model,
      ratio: requestBody.ratio,
      duration: requestBody.duration,
      contentTypes: requestBody.content.map((item) => `${item.type}:${item.role || 'default'}`),
      promptText: requestBody.content.find((item) => item.type === 'text')?.text || null,
    },
    metadata: {
      sequenceId: sequencePackage?.sequenceId || null,
      multiShotMode: true,
      referenceImageCount: (sequencePackage?.referenceImages || []).length,
      referenceTier: sequencePackage?.providerRequestHints?.referenceTier || null,
      referenceStrategy: sequencePackage?.referenceStrategy || null,
    },
  });
  const entityRef = {
    shotId: sequencePackage?.sequenceId || null,
    preferredProvider: 'seedance',
    durationTargetSec: sequencePackage?.durationTargetSec || null,
  };
  return executeSeedanceTask(requestBody, requestSummary, outputPath, entityRef, options, env);
}

export async function createSeedanceMultiShotClip(sequencePackage, outputPath, options = {}) {
  logger.info('SeedanceVideo', `生成多镜头叙事 [seedance multi-shot]：${path.basename(outputPath)}`);
  return seedanceMultiShotToVideo(sequencePackage, outputPath, options, options.env || process.env);
}

export async function createSeedanceBridgeClip(bridgePackage, outputPath, options = {}) {
  logger.info('SeedanceVideo', `生成桥接镜头 [seedance bridge]：${path.basename(outputPath)}`);
  return seedanceBridgeToVideo(bridgePackage, outputPath, options, options.env || process.env);
}

export async function createSeedanceVideoClip(shotPackage, outputPath, options = {}) {
  logger.info('SeedanceVideo', `生成动态镜头 [seedance]：${path.basename(outputPath)}`);
  return seedanceImageToVideo(shotPackage, outputPath, options, options.env || process.env);
}

export const __testables = {
  buildPromptText,
  buildSeedanceVideoRequest,
  buildSeedanceBridgeRequest,
  buildSeedanceMultiShotRequest,
  buildSequencePromptHint,
  classifySeedanceError,
  createSeedanceHttpClients,
  createSeedanceVideoTransport,
  createProviderError,
  inferRatio,
  normalizeSeedanceDuration,
  downloadSeedanceTask,
  pollSeedanceTask,
  resolveSeedanceApiKey,
  submitSeedanceTask,
  toSeedanceImageContent,
};
