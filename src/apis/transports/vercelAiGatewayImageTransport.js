import axios from 'axios';

import { saveBuffer } from '../../utils/fileHelper.js';

const DEFAULT_BASE_URL = 'https://ai-gateway.vercel.sh';
const DEFAULT_IMAGE_PATH = '/v1/images/generations';

function classifyImageError(error) {
  const status = error?.response?.status ?? error?.status ?? null;
  if (status === 401 || status === 403) {
    const authError = new Error(error?.message || 'Vercel AI Gateway 图像鉴权失败');
    authError.code = 'VERCEL_AI_GATEWAY_IMAGE_AUTH_ERROR';
    authError.status = status;
    return authError;
  }
  if (status >= 400 && status < 500) {
    const requestError = new Error(error?.message || 'Vercel AI Gateway 图像请求参数错误');
    requestError.code = 'VERCEL_AI_GATEWAY_IMAGE_INVALID_REQUEST';
    requestError.status = status;
    return requestError;
  }
  if (error?.code === 'ECONNABORTED' || String(error?.message || '').toLowerCase().includes('timeout')) {
    const timeoutError = new Error(error?.message || 'Vercel AI Gateway 图像请求超时');
    timeoutError.code = 'VERCEL_AI_GATEWAY_IMAGE_TIMEOUT';
    timeoutError.status = status;
    return timeoutError;
  }
  return error;
}

export function buildVercelAiGatewayImageRequest({ prompt, negativePrompt, outputPath, route, size, references = [] } = {}) {
  return {
    model: route?.model || null,
    prompt,
    negativePrompt: negativePrompt || '',
    outputPath,
    size: size || null,
    references,
  };
}

export function createVercelAiGatewayImageTransport(options = {}) {
  const env = options.env || process.env;
  const apiKey = options.apiKey || env.VERCEL_AI_GATEWAY_API_KEY || env.AI_GATEWAY_API_KEY || null;
  const httpClient = options.httpClient || axios.create({
    baseURL: options.baseUrl || env.VERCEL_AI_GATEWAY_BASE_URL || DEFAULT_BASE_URL,
    timeout: options.timeoutMs || 120000,
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': 'application/json',
    },
  });
  const binaryHttpClient = options.binaryHttpClient || axios;
  const submitPath = options.submitPath || env.VERCEL_AI_GATEWAY_IMAGE_SUBMIT_PATH || DEFAULT_IMAGE_PATH;

  return {
    name: 'vercel_ai_gateway',
    async generate({ prompt, negativePrompt, outputPath, route, env: runtimeEnv = env, size = null, references = [] }) {
      const requestBody = buildVercelAiGatewayImageRequest({
        prompt,
        negativePrompt,
        outputPath,
        route,
        size,
        references,
      });

      try {
        const response = await httpClient.post(submitPath, requestBody);
        const payload = response?.data || {};
        if (typeof payload.b64_json === 'string') {
          saveBuffer(outputPath, Buffer.from(payload.b64_json, 'base64'));
          return outputPath;
        }

        const url = payload.url || payload.data?.[0]?.url || null;
        if (!url) {
          throw new Error('Vercel AI Gateway 图像返回为空');
        }

        const binary = await binaryHttpClient.get(url, { responseType: 'arraybuffer' });
        saveBuffer(outputPath, Buffer.from(binary.data));
        return outputPath;
      } catch (error) {
        throw classifyImageError(error);
      }
    },
  };
}

export const __testables = {
  buildVercelAiGatewayImageRequest,
};
