import fs from 'node:fs';
import { setTimeout as sleepTimeout } from 'node:timers/promises';

import axios from 'axios';
import sharp from 'sharp';

import { normalizeVideoProviderError } from './videoProviderProtocol.js';
import { createVercelAiGatewayVideoTransport } from './transports/vercelAiGatewayVideoTransport.js';

function normalizeError(error, fallbackCode, fallbackMessage) {
  const status = error?.response?.status ?? error?.status ?? null;
  return normalizeVideoProviderError({
    message: error?.message || fallbackMessage,
    code: error?.code || fallbackCode,
    category:
      status && status >= 400 && status < 500
        ? 'provider_invalid_request'
        : status === 401 || status === 403
          ? 'provider_auth_error'
          : status === 429
            ? 'provider_rate_limit'
            : error?.category || 'provider_generation_failed',
    status,
    details: error?.response?.data || error?.details || null,
  });
}

function buildAxiosClient(baseURL, apiKey, timeoutMs, extraHeaders = {}) {
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...extraHeaders,
    },
  });
}

export function createOfficialSeedanceVideoTransport(options = {}) {
  const env = options.env || process.env;
  const timeoutMs = options.timeoutMs || Number.parseInt(env.SEEDANCE_TIMEOUT_MS || '600000', 10);
  const pollIntervalMs = options.pollIntervalMs || Number.parseInt(env.SEEDANCE_POLL_INTERVAL_MS || '10000', 10);
  const sleep = options.sleep || ((ms) => sleepTimeout(ms));

  return {
    name: 'OfficialSeedanceTransport',
    async submit(requestBody, context = {}) {
      const httpClient = options.httpClient || buildAxiosClient(context.baseUrl, context.apiKey, timeoutMs, {
        'Content-Type': 'application/json',
      });
      try {
        const response = await httpClient.post(context.submitPath || '/contents/generations/tasks', requestBody);
        return {
          taskId: response?.data?.id || null,
          outputUrl: response?.data?.content?.video_url || null,
          providerResponse: response?.data || null,
        };
      } catch (error) {
        throw normalizeError(error, 'SEEDANCE_SERVER_ERROR', 'Seedance official submit failed');
      }
    },
    async poll(taskId, context = {}) {
      const httpClient = options.httpClient || buildAxiosClient(context.baseUrl, context.apiKey, timeoutMs, {
        'Content-Type': 'application/json',
      });
      const startedAt = Date.now();
      try {
        while (Date.now() - startedAt < timeoutMs) {
          await sleep(pollIntervalMs);
          const response = await httpClient.get(`${context.pollPath || '/contents/generations/tasks'}/${taskId}`);
          const task = response?.data || {};
          const status = String(task.status || '').toLowerCase();
          if (status === 'succeeded') {
            return {
              status: 'COMPLETED',
              taskId,
              outputUrl: task?.content?.video_url || null,
              actualDurationSec: task?.duration || null,
              providerResponse: task,
            };
          }
          if (status === 'failed' || status === 'expired' || status === 'cancelled') {
            throw normalizeVideoProviderError({
              message: task?.error?.message || `Seedance task ${status}`,
              code: task?.error?.code || 'SEEDANCE_TASK_FAILED',
              category: status === 'expired' ? 'provider_timeout' : 'provider_generation_failed',
              details: task,
            });
          }
        }
        throw normalizeVideoProviderError({
          message: 'Seedance official poll timeout',
          code: 'SEEDANCE_TIMEOUT',
          category: 'provider_timeout',
        });
      } catch (error) {
        throw normalizeError(error, 'SEEDANCE_SERVER_ERROR', 'Seedance official poll failed');
      }
    },
    async download(outputUrl, outputPath, context = {}) {
      try {
        const response = await (options.binaryHttpClient || axios).get(outputUrl, {
          responseType: 'arraybuffer',
          headers: context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : undefined,
        });
        fs.writeFileSync(outputPath, Buffer.from(response.data));
        return { outputPath };
      } catch (error) {
        throw normalizeError(error, 'SEEDANCE_DOWNLOAD_FAILED', 'Seedance official download failed');
      }
    },
  };
}

function buildMultipartBody(requestBody) {
  const form = new FormData();
  form.append('model', requestBody.model);
  if (requestBody.prompt) {
    form.append('prompt', requestBody.prompt);
  }
  if (requestBody.seconds) {
    form.append('seconds', String(requestBody.seconds));
  }
  if (requestBody.size) {
    form.append('size', String(requestBody.size));
  }
  if (requestBody.imagePath) {
    const buffer = fs.readFileSync(requestBody.imagePath);
    form.append('image', new Blob([buffer]), 'reference.png');
  }
  return form;
}

export function createRelayOpenAiVideoTransport(options = {}) {
  const env = options.env || process.env;
  const timeoutMs = options.timeoutMs || Number.parseInt(env.VIDEO_FALLBACK_TIMEOUT_MS || '300000', 10);
  const pollIntervalMs = options.pollIntervalMs || Number.parseInt(env.VIDEO_FALLBACK_POLL_INTERVAL_MS || '5000', 10);
  const sleep = options.sleep || ((ms) => sleepTimeout(ms));

  return {
    name: 'RelayOpenAiVideoTransport',
    async submit(requestBody, context = {}) {
      try {
        const response = await fetch(`${String(context.baseUrl).replace(/\/+$/, '')}${context.submitPath || '/videos'}`, {
          method: 'POST',
          headers: {
            ...(context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : {}),
          },
          body: buildMultipartBody(requestBody),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw { message: data?.error?.message || `HTTP ${response.status}`, response: { status: response.status, data } };
        }
        return {
          taskId: data?.id || data?.taskId || null,
          outputUrl: data?.outputUrl || data?.url || null,
          providerResponse: data,
        };
      } catch (error) {
        throw normalizeError(error, 'RELAY_OPENAI_SUBMIT_FAILED', 'Relay OpenAI submit failed');
      }
    },
    async poll(taskId, context = {}) {
      const httpClient = options.httpClient || buildAxiosClient(context.baseUrl, context.apiKey, timeoutMs);
      const startedAt = Date.now();
      try {
        while (Date.now() - startedAt < timeoutMs) {
          await sleep(pollIntervalMs);
          const response = await httpClient.get(`${context.pollPath || '/videos'}/${taskId}`);
          const task = response?.data || {};
          const status = String(task?.status || task?.state || '').trim().toUpperCase();
          if (status === 'SUCCEEDED' || status === 'COMPLETED') {
            return {
              status: 'COMPLETED',
              taskId,
              outputUrl: task?.outputUrl || task?.url || `${context.downloadPath || '/videos'}/${taskId}/content`,
              actualDurationSec: task?.durationSec || null,
              providerResponse: task,
            };
          }
          if (status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED') {
            throw normalizeVideoProviderError({
              message: task?.error?.message || `Relay OpenAI task ${status}`,
              code: task?.error?.code || 'RELAY_OPENAI_TASK_FAILED',
              category: status === 'EXPIRED' ? 'provider_timeout' : 'provider_generation_failed',
              details: task,
            });
          }
        }
        throw normalizeVideoProviderError({
          message: 'Relay OpenAI poll timeout',
          code: 'RELAY_OPENAI_TIMEOUT',
          category: 'provider_timeout',
        });
      } catch (error) {
        throw normalizeError(error, 'RELAY_OPENAI_POLL_FAILED', 'Relay OpenAI poll failed');
      }
    },
    async download(outputUrl, outputPath, context = {}) {
      try {
        const resolvedUrl = String(outputUrl || '').startsWith('http')
          ? outputUrl
          : `${String(context.baseUrl).replace(/\/+$/, '')}${outputUrl}`;
        const response = await (options.binaryHttpClient || axios).get(resolvedUrl, {
          responseType: 'arraybuffer',
          headers: context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : undefined,
        });
        fs.writeFileSync(outputPath, Buffer.from(response.data));
        return { outputPath };
      } catch (error) {
        throw normalizeError(error, 'RELAY_OPENAI_DOWNLOAD_FAILED', 'Relay OpenAI download failed');
      }
    },
  };
}

async function encodeRelaySeedanceReferenceImage(imagePath) {
  const source = fs.readFileSync(imagePath);
  const compressed = await sharp(source)
    .rotate()
    .resize({
      width: 768,
      height: 768,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 70,
      mozjpeg: true,
    })
    .toBuffer();
  return `data:image/jpeg;base64,${compressed.toString('base64')}`;
}

async function buildRelaySeedanceV2Body(requestBody) {
  const payload = {
    model: requestBody.model,
    content: [],
    generate_audio: false,
    resolution: requestBody.resolution || '720p',
    ratio: requestBody.ratio || '9:16',
    duration: Number.isFinite(Number(requestBody.duration))
      ? Math.min(Math.max(Math.round(Number(requestBody.duration)), 4), 15)
      : 5,
    watermark: false,
  };
  if (requestBody.prompt) {
    payload.content.push({
      type: 'text',
      text: requestBody.prompt,
    });
  }
  if (requestBody.imagePath) {
    payload.content.push({
      type: 'image_url',
      role: 'first_frame',
      image_url: {
        url: await encodeRelaySeedanceReferenceImage(requestBody.imagePath),
      },
    });
  }
  return payload;
}

function extractRelaySeedanceVideoUrl(task) {
  return (
    task?.data?.data?.video_urls?.[0] ||
    task?.data?.video_urls?.[0] ||
    task?.data?.data?.video_url ||
    task?.data?.video_url ||
    task?.data?.data?.output ||
    task?.data?.output ||
    task?.video_url ||
    null
  );
}

export function createRelaySeedanceV2VideoTransport(options = {}) {
  const env = options.env || process.env;
  const timeoutMs = options.timeoutMs || Number.parseInt(env.VIDEO_FALLBACK_TIMEOUT_MS || '300000', 10);
  const pollIntervalMs = options.pollIntervalMs || Number.parseInt(env.VIDEO_FALLBACK_POLL_INTERVAL_MS || '5000', 10);
  const sleep = options.sleep || ((ms) => sleepTimeout(ms));
  const defaultSubmitPath = '/api/v1/tasks/generations';
  const defaultPollPath = '/api/v1/tasks/generations';

  return {
    name: 'RelaySeedanceV2Transport',
    async submit(requestBody, context = {}) {
      const httpClient = options.httpClient || buildAxiosClient(context.baseUrl, context.apiKey, timeoutMs, {
        'Content-Type': 'application/json',
      });
      try {
        const response = await httpClient.post(
          context.submitPath || defaultSubmitPath,
          await buildRelaySeedanceV2Body(requestBody)
        );
        return {
          taskId: response?.data?.data?.request_id || response?.data?.data?.task_id || response?.data?.task_id || response?.data?.id || null,
          outputUrl: null,
          providerResponse: response?.data || null,
        };
      } catch (error) {
        throw normalizeError(error, 'RELAY_SEEDANCE_V2_SUBMIT_FAILED', 'Relay Seedance v2 submit failed');
      }
    },
    async poll(taskId, context = {}) {
      const httpClient = options.httpClient || buildAxiosClient(context.baseUrl, context.apiKey, timeoutMs);
      const startedAt = Date.now();
      try {
        while (Date.now() - startedAt < timeoutMs) {
          await sleep(pollIntervalMs);
          const response = await httpClient.get(`${context.pollPath || defaultPollPath}/${taskId}`);
          const task = response?.data || {};
          const taskData = task?.data || {};
          const status = String(taskData?.status || task?.status || '').trim().toUpperCase();
          if (status === 'SUCCESS' || status === 'COMPLETED') {
            return {
              status: 'COMPLETED',
              taskId,
              outputUrl: extractRelaySeedanceVideoUrl(task),
              actualDurationSec: Number.isFinite(Number(taskData?.duration)) ? Number(taskData.duration) : null,
              providerResponse: task,
            };
          }
          if (status === 'FAILED' || status === 'FAIL' || status === 'ERROR') {
            throw normalizeVideoProviderError({
              message: taskData?.fail_reason || task?.message || task?.fail_reason || task?.error?.message || `Relay Seedance v2 task ${status}`,
              code: task?.code || task?.error?.code || 'RELAY_SEEDANCE_V2_TASK_FAILED',
              category: 'provider_generation_failed',
              details: task,
            });
          }
        }
        throw normalizeVideoProviderError({
          message: 'Relay Seedance v2 poll timeout',
          code: 'RELAY_SEEDANCE_V2_TIMEOUT',
          category: 'provider_timeout',
        });
      } catch (error) {
        throw normalizeError(error, 'RELAY_SEEDANCE_V2_POLL_FAILED', 'Relay Seedance v2 poll failed');
      }
    },
    async download(outputUrl, outputPath, context = {}) {
      try {
        const response = await (options.binaryHttpClient || axios).get(outputUrl, {
          responseType: 'arraybuffer',
          headers: context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : undefined,
        });
        fs.writeFileSync(outputPath, Buffer.from(response.data));
        return { outputPath };
      } catch (error) {
        throw normalizeError(error, 'RELAY_SEEDANCE_V2_DOWNLOAD_FAILED', 'Relay Seedance v2 download failed');
      }
    },
  };
}

export const __testables = {
  buildRelaySeedanceV2Body,
  encodeRelaySeedanceReferenceImage,
};

export function createGatewayVideoTransport(options = {}) {
  const gatewayTransport = createVercelAiGatewayVideoTransport(options);

  return {
    name: 'GatewayVideoTransport',
    async submit(requestBody, context = {}) {
      const response = await gatewayTransport.submitVideoGeneration(
        {
          packageType: context?.request?.packageType,
          model: requestBody?.model,
          promptDirectives: requestBody?.prompt ? [requestBody.prompt] : [],
          durationTargetSec: requestBody?.durationSec || null,
          cameraSpec: {
            ratio: requestBody?.aspectRatio || null,
          },
          referenceImages: Array.isArray(requestBody?.references)
            ? requestBody.references
                .filter((entry) => entry?.type === 'image')
                .map((entry) => ({
                  path: entry?.path || null,
                  role: entry?.role || null,
                  shotId: entry?.shotId || null,
                }))
            : [],
          referenceVideos: Array.isArray(requestBody?.references)
            ? requestBody.references
                .filter((entry) => entry?.type === 'video')
                .map((entry) => ({
                  path: entry?.path || null,
                  role: entry?.role || null,
                  shotId: entry?.shotId || null,
                }))
            : [],
          preferredProvider: context?.request?.provider || null,
        },
        {
          env: options.env || process.env,
        }
      );

      return {
        taskId: response?.taskId || null,
        outputUrl: response?.outputUrl || null,
        providerResponse: null,
      };
    },
    async poll(taskId, _context = {}) {
      const response = await gatewayTransport.pollVideoGeneration(taskId);
      return {
        status: response?.status || null,
        taskId,
        outputUrl: response?.outputUrl || null,
        actualDurationSec: response?.actualDurationSec || null,
        providerResponse: response || null,
      };
    },
    async download(outputUrl, outputPath, context = {}) {
      const response = await gatewayTransport.downloadVideoGeneration(outputUrl, outputPath, {
        preferredProvider: context?.request?.provider || null,
        shotId: context?.request?.packageType === 'shot' ? context?.request?.packageId : null,
        sequenceId: context?.request?.packageType === 'sequence' ? context?.request?.packageId : null,
        bridgeId: context?.request?.packageType === 'bridge' ? context?.request?.packageId : null,
        taskId: context?.taskId || null,
        actualDurationSec: context?.durationTargetSec || null,
        providerRequest: context?.providerRequest || null,
        providerMetadata: context?.providerMetadata || null,
      });
      return {
        outputPath: response?.videoPath || outputPath,
      };
    },
  };
}
