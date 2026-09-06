/**
 * AI SDK 视频生成统一客户端
 * 支持两种模式：
 * 1. AI SDK 原生 video generation（FAL/Google 等）
 * 2. OpenAI 兼容 API（中转站，如 apilio.ai）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';

/**
 * 支持的 AI SDK 视频模型映射
 */
const AI_SDK_VIDEO_MODELS = {
  'fal/minimax-video': '@ai-sdk/fal/minimax-video',
  'fal/luma-ray-2': '@ai-sdk/fal/luma-dream-machine/ray-2',
  'google/veo-2': '@ai-sdk/google/veo-2.0-generate-001',
  'google/veo-3': '@ai-sdk/google/veo-3.0-generate-001',
  'google/veo-3.1': '@ai-sdk/google/veo-3.1-generate-001',
  'openai/sora-2': '@ai-sdk/openai/sora-2',
};

function parseAiSdkModel(modelStr) {
  if (!modelStr) return null;
  if (AI_SDK_VIDEO_MODELS[modelStr]) {
    const fullId = AI_SDK_VIDEO_MODELS[modelStr];
    const [provider, ...rest] = fullId.replace('@ai-sdk/', '').split('/');
    return { provider, modelId: rest.join('/') };
  }
  if (modelStr.includes('/')) {
    const [provider, ...rest] = modelStr.split('/');
    return { provider, modelId: rest.join('/') };
  }
  return null;
}

export function shouldUseAiSdk(env = process.env) {
  const model = env.VIDEO_MODEL;
  if (!model) return false;
  return model.startsWith('fal/') || model.startsWith('google/') || model.startsWith('openai/');
}

/**
 * 使用 OpenAI 兼容 API 生成视频（中转站模式）
 */
async function generateVideoViaOpenAiCompat(options) {
  const {
    model,
    prompt,
    imageUrl,
    aspectRatio = '9:16',
    duration = 5,
    seed,
    outputPath,
    env = process.env,
  } = options;

  const baseURL = env.OPENAI_COMPAT_BASE_URL || env.IMAGE_API_BASE_URL;
  const apiKey = env.OPENAI_COMPAT_API_KEY || env.IMAGE_API_KEY;

  if (!baseURL || !apiKey) {
    throw new Error('缺少 OPENAI_COMPAT_BASE_URL 或 OPENAI_COMPAT_API_KEY');
  }

  // 1. 提交视频生成请求
  const submitPayload = {
    model: model,
    prompt: prompt,
    n: 1,
    ...(duration && { seconds: String(duration) }),
  };

  // 如果有参考图，使用 media 数组格式（Wan3.0 API 格式）
  if (imageUrl) {
    submitPayload.media = [
      {
        type: 'first_frame',
        url: imageUrl,
      },
    ];
  }

  let submitResponse;
  try {
    submitResponse = await axios.post(`${baseURL}/video/generations`, submitPayload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    });
  } catch (error) {
    // 捕获详细的错误信息
    const errorData = error.response?.data || {};
    const errorMessage = errorData.message || errorData.error || error.message;
    const errorCode = errorData.code || error.code;
    const errorStatus = error.response?.status;

    throw new Error(`视频生成请求失败: ${errorMessage} (status=${errorStatus})`);
  }

  // 检查响应状态
  if (submitResponse.status >= 400) {
    console.error('[AiSdkVideoClient] API 返回错误:', {
      status: submitResponse.status,
      data: submitResponse.data,
    });
    throw new Error(`视频生成请求失败: ${submitResponse.data?.message || submitResponse.data?.error || 'Unknown error'} (status=${submitResponse.status})`);
  }

  const taskId = submitResponse.data.task_id || submitResponse.data.id;
  if (!taskId) {
    throw new Error('视频生成请求未返回 task_id');
  }

  // 2. 轮询等待完成
  const pollInterval = parseInt(env.VIDEO_FALLBACK_POLL_INTERVAL_MS || '5000', 10);
  const pollTimeout = parseInt(env.VIDEO_FALLBACK_TIMEOUT_MS || '600000', 10);
  const startTime = Date.now();

  while (Date.now() - startTime < pollTimeout) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    let pollResponse;
    let lastPollError;
    for (let retry = 0; retry < 3; retry++) {
      try {
        pollResponse = await axios.get(`${baseURL}/video/generations/${taskId}`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          timeout: 60000,
        });
        break;
      } catch (pollErr) {
        lastPollError = pollErr;
        if (retry < 2) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }

    if (!pollResponse) {
      // 轮询网络错误，继续等待
      continue;
    }

    // 中转站响应格式：{ code, data: { status, data: { video_url } } }
    const outerData = pollResponse.data?.data || pollResponse.data;
    const status = outerData?.status || outerData?.data?.status;
    const videoUrl = outerData?.data?.video_url || outerData?.video_url || outerData?.url;

    if (status === 'completed' || status === 'succeeded' || status === 'SUCCESS') {
      // 3. 下载视频
      if (!videoUrl) {
        throw new Error('视频生成完成但未返回 video_url');
      }

      const videoResponse = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 120000,
      });

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, Buffer.from(videoResponse.data));

      return {
        videoPath: outputPath,
        providerMetadata: {
          taskId,
          model,
          duration: pollResponse.data.seconds || duration,
        },
        model,
      };
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(`视频生成失败: ${pollResponse.data.error || 'unknown error'}`);
    }
  }

  throw new Error(`视频生成超时（${pollTimeout}ms）`);
}

/**
 * 使用 AI SDK 原生 video generation
 */
async function generateVideoViaAiSdk(options) {
  const { experimental_generateVideo: generateVideo } = await import('ai');

  const {
    prompt,
    imageUrl,
    aspectRatio = '9:16',
    duration,
    seed,
    outputPath,
    env = process.env,
  } = options;

  const modelStr = env.VIDEO_MODEL;
  const parsed = parseAiSdkModel(modelStr);
  if (!parsed) {
    throw new Error(`无法解析 AI SDK 模型: ${modelStr}`);
  }

  let provider;
  switch (parsed.provider) {
    case 'fal': {
      const { fal } = await import('@ai-sdk/fal');
      provider = fal;
      break;
    }
    case 'google': {
      const { google } = await import('@ai-sdk/google');
      provider = google;
      break;
    }
    default:
      throw new Error(`AI SDK 原生模式不支持 provider: ${parsed.provider}`);
  }

  const model = provider.video(parsed.modelId);
  const promptConfig = imageUrl ? { image: imageUrl, text: prompt } : prompt;

  const pollInterval = parseInt(env.VIDEO_FALLBACK_POLL_INTERVAL_MS || '5000', 10);
  const pollTimeout = parseInt(env.VIDEO_FALLBACK_TIMEOUT_MS || '600000', 10);

  const result = await generateVideo({
    model,
    prompt: promptConfig,
    aspectRatio,
    ...(duration && { duration }),
    ...(seed && { seed }),
    poll: { intervalMs: pollInterval, timeoutMs: pollTimeout },
  });

  const videoData = result.video?.uint8Array || result.video?.base64;
  if (!videoData) {
    throw new Error('AI SDK 未返回视频数据');
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  if (result.video?.uint8Array) {
    await fs.writeFile(outputPath, Buffer.from(result.video.uint8Array));
  } else if (result.video?.base64) {
    await fs.writeFile(outputPath, Buffer.from(result.video.base64, 'base64'));
  }

  return {
    videoPath: outputPath,
    providerMetadata: result.providerMetadata || {},
    model: `${parsed.provider}/${parsed.modelId}`,
  };
}

/**
 * 生成视频（自动选择模式）
 */
export async function generateVideoClip(options) {
  const env = options.env || process.env;
  const modelStr = env.VIDEO_MODEL;

  // OpenAI 兼容模式（中转站）
  if (modelStr && !AI_SDK_VIDEO_MODELS[modelStr]) {
    // 提取模型 ID（去掉 provider 前缀，如 openai/wan3.0-video -> wan3.0-video）
    const modelForApi = modelStr.includes('/') ? modelStr.split('/').pop() : modelStr;
    return generateVideoViaOpenAiCompat({ ...options, model: modelForApi });
  }

  // AI SDK 原生模式
  return generateVideoViaAiSdk(options);
}

/**
 * 创建 AI SDK 视频客户端（兼容 unifiedVideoProviderClient 接口）
 */
export function createAiSdkVideoClient(options = {}) {
  const env = options.env || process.env;
  const taskRegistry = new Map();

  return {
    async submit(videoPackage, outputPath = null, submitOptions = {}) {
      const pkgEnv = submitOptions.env || env;
      const prompt = normalizePrompt(videoPackage);
      const imageUrl = await resolveReferenceImage(videoPackage);
      const aspectRatio = videoPackage.cameraSpec?.ratio || pkgEnv.HAPPYHORSE_RATIO || '9:16';
      const duration = videoPackage.durationTargetSec || parseInt(pkgEnv.VIDEO_FALLBACK_SECONDS || '5', 10);
      const seed = pkgEnv.HAPPYHORSE_SEED ? parseInt(pkgEnv.HAPPYHORSE_SEED, 10) : undefined;

      const taskId = `ai_sdk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const finalOutputPath = outputPath || videoPackage.outputPath || path.join(process.cwd(), `${taskId}.mp4`);

      taskRegistry.set(taskId, {
        videoPackage,
        outputPath: finalOutputPath,
        prompt,
        imageUrl,
        aspectRatio,
        duration,
        seed,
        env: pkgEnv,
        status: 'pending',
        result: null,
        error: null,
      });

      return {
        requestId: `req_${taskId}`,
        taskId,
        provider: 'ai_sdk',
        model: pkgEnv.VIDEO_MODEL,
        transport: 'ai_sdk',
        outputUrl: null,
        packageType: videoPackage.packageType || 'shot',
        packageId: videoPackage.packageId || taskId,
        providerRequest: { prompt, imageUrl, aspectRatio, duration },
        providerMetadata: { aiSdk: true, model: pkgEnv.VIDEO_MODEL },
      };
    },

    async poll(taskId, ...rest) {
      const entry = taskRegistry.get(taskId);
      if (!entry) {
        throw new Error(`Unknown AI SDK video task: ${taskId}`);
      }

      if (entry.status === 'completed') {
        return { status: 'completed', outputUrl: entry.result?.videoPath, taskId };
      }
      if (entry.status === 'failed') {
        throw entry.error || new Error('Video generation failed');
      }

      try {
        entry.status = 'processing';
        const result = await generateVideoClip({
          model: entry.env.VIDEO_MODEL,
          prompt: entry.prompt,
          imageUrl: entry.imageUrl,
          aspectRatio: entry.aspectRatio,
          duration: entry.duration,
          seed: entry.seed,
          outputPath: entry.outputPath,
          env: entry.env,
        });

        entry.status = 'completed';
        entry.result = result;

        return {
          status: 'completed',
          outputUrl: result.videoPath,
          taskId,
          providerMetadata: result.providerMetadata,
        };
      } catch (error) {
        entry.status = 'failed';
        entry.error = error;
        throw error;
      }
    },

    async download(outputUrl, outputPath, _videoPackage, pollResult) {
      const taskId = pollResult?.taskId;
      const entry = taskId ? taskRegistry.get(taskId) : null;

      if (entry?.status === 'completed' && entry.result?.videoPath) {
        if (entry.result.videoPath !== outputPath) {
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.copyFile(entry.result.videoPath, outputPath);
        }
        return { videoPath: outputPath };
      }

      return { videoPath: outputPath };
    },
  };
}

function normalizePrompt(videoPackage = {}) {
  if (Array.isArray(videoPackage.seedancePromptBlocks) && videoPackage.seedancePromptBlocks.length > 0) {
    return videoPackage.seedancePromptBlocks
      .map((block) => String(block?.text || '').trim())
      .filter(Boolean)
      .join('. ');
  }

  if (Array.isArray(videoPackage.promptDirectives) && videoPackage.promptDirectives.length > 0) {
    return videoPackage.promptDirectives.map((item) => String(item || '').trim()).filter(Boolean).join('. ');
  }

  return [
    videoPackage.visualGoal,
    videoPackage.sequenceContextSummary,
    videoPackage.providerRequestHints?.sequenceGoal,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('. ');
}

function resolveReferenceImage(videoPackage = {}) {
  const refs = videoPackage.referenceImages || [];
  if (refs.length === 0) return null;

  const firstRef = refs[0];
  if (firstRef.url) return firstRef.url;
  if (firstRef.dataUrl) return firstRef.dataUrl;
  if (firstRef.path) {
    // 本地文件路径，转换为 data URL（但限制大小）
    return localPathToDataUrl(firstRef.path);
  }

  return null;
}

/**
 * 将本地文件路径转换为 data URL（限制最大 1MB，压缩大图）
 */
async function localPathToDataUrl(filePath) {
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // 解析相对路径
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    // 检查文件大小（限制 1MB）
    const stat = await fs.stat(resolvedPath);
    const MAX_SIZE = 1 * 1024 * 1024; // 1MB
    if (stat.size > MAX_SIZE) {
      return null;
    }

    const data = await fs.readFile(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeType = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    }[ext] || 'image/png';

    return `data:${mimeType};base64,${data.toString('base64')}`;
  } catch (error) {
    // 如果文件读取失败，返回 null
    return null;
  }
}

export const __testables = {
  parseAiSdkModel,
  normalizePrompt,
  resolveReferenceImage,
  AI_SDK_VIDEO_MODELS,
};
