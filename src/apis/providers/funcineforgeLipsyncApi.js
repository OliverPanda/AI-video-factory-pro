export function buildFunCineForgeRequest(input, outputPath, options = {}, env = process.env) {
  const baseUrl = String(options.baseUrl || env.FUNCINEFORGE_BASE_URL || 'http://127.0.0.1:7860').replace(/\/+$/, '');
  const requestPath = options.requestPath || env.FUNCINEFORGE_REQUEST_PATH || '/v1/lipsync';
  const url = `${baseUrl}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`;
  const payload = {
    shot_id: options.shotId || input?.shotId || null,
    image_path: options.imagePath || input?.imagePath || null,
    audio_path: options.audioPath || input?.audioPath || null,
    output_path: outputPath,
    speaker: options.speaker || input?.speaker || null,
    provider: 'funcineforge',
  };

  return {
    url,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
      ...(options.apiKey || env.FUNCINEFORGE_API_KEY
        ? { authorization: `Bearer ${options.apiKey || env.FUNCINEFORGE_API_KEY}` }
        : {}),
    },
    body: JSON.stringify(payload),
  };
}

function resolveFetchImpl(options = {}) {
  if (typeof options.fetchImpl === 'function') {
    return options.fetchImpl;
  }

  if (typeof fetch === 'function') {
    return fetch;
  }

  throw new Error('Fun-CineForge lipsync provider 缺少可用 fetch 实现');
}

function toInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getTimeoutMs(options = {}, env = process.env) {
  return Math.max(1, toInteger(options.timeoutMs ?? env.FUNCINEFORGE_TIMEOUT_MS, 30000));
}

function getMaxRetries(options = {}, env = process.env) {
  return Math.max(0, toInteger(options.maxRetries ?? env.FUNCINEFORGE_MAX_RETRIES, 1));
}

function getRetryDelayMs(options = {}, env = process.env) {
  return Math.max(0, toInteger(options.retryDelayMs ?? env.FUNCINEFORGE_RETRY_DELAY_MS, 500));
}

function createProviderError(message, details = {}) {
  const error = new Error(message);
  error.provider = 'funcineforge';
  error.code = details.code || 'FUNCINEFORGE_ERROR';
  error.category = details.category || 'provider_error';
  error.retryable = details.retryable === true;
  error.statusCode = details.statusCode ?? null;
  error.detail = details.detail ?? null;
  error.cause = details.cause;
  return error;
}

async function delay(ms) {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResponseDetail(response) {
  if (!response) {
    return '';
  }

  try {
    if (typeof response.text === 'function') {
      return await response.text();
    }
  } catch {
    return '';
  }

  return '';
}

async function requestWithTimeout(fetchImpl, request, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeoutId = null;
  let didTimeout = false;

  const fetchPromise = fetchImpl(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    ...(controller ? { signal: controller.signal } : {}),
  });

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      if (controller) {
        controller.abort();
      }
      reject(
        createProviderError(`Fun-CineForge lip-sync 请求超时（>${timeoutMs}ms）`, {
          code: 'FUNCINEFORGE_TIMEOUT',
          category: 'timeout',
          retryable: true,
        })
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    if (didTimeout || error?.code === 'FUNCINEFORGE_TIMEOUT' || error?.name === 'AbortError') {
      throw createProviderError(`Fun-CineForge lip-sync 请求超时（>${timeoutMs}ms）`, {
        code: 'FUNCINEFORGE_TIMEOUT',
        category: 'timeout',
        retryable: true,
        cause: error,
      });
    }

    throw createProviderError(`Fun-CineForge lip-sync 网络异常：${error?.message || 'unknown error'}`, {
      code: 'FUNCINEFORGE_NETWORK_ERROR',
      category: 'network_error',
      retryable: true,
      cause: error,
    });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function parseResponse(response, outputPath) {
  const data = typeof response.json === 'function' ? await response.json() : {};
  const videoPath = data?.output_path || data?.video_path || data?.data?.output_path || data?.data?.video_path || outputPath;

  if (!videoPath) {
    throw createProviderError('Fun-CineForge lip-sync 响应缺少 output_path/video_path', {
      code: 'FUNCINEFORGE_INVALID_RESPONSE',
      category: 'invalid_response',
      retryable: false,
    });
  }

  return videoPath;
}

export async function lipsyncWithFunCineForge(input, outputPath, options = {}, env = process.env) {
  const request = buildFunCineForgeRequest(input, outputPath, options, env);
  const fetchImpl = resolveFetchImpl(options);
  const timeoutMs = getTimeoutMs(options, env);
  const maxRetries = getMaxRetries(options, env);
  const retryDelayMs = getRetryDelayMs(options, env);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await requestWithTimeout(fetchImpl, request, timeoutMs);

      if (!response?.ok) {
        const detail = await readResponseDetail(response);
        const statusCode = response?.status || null;
        throw createProviderError(`Fun-CineForge lip-sync 请求失败：${statusCode || 'unknown'} ${detail}`.trim(), {
          code: 'FUNCINEFORGE_HTTP_ERROR',
          category: statusCode >= 500 ? 'provider_5xx' : 'provider_4xx',
          retryable: statusCode >= 500,
          statusCode,
          detail,
        });
      }

      return await parseResponse(response, outputPath);
    } catch (error) {
      const normalizedError =
        error?.provider === 'funcineforge'
          ? error
          : createProviderError(`Fun-CineForge lip-sync 调用失败：${error?.message || 'unknown error'}`, {
              code: 'FUNCINEFORGE_UNKNOWN_ERROR',
              category: 'provider_error',
              retryable: false,
              cause: error,
            });

      if (!normalizedError.retryable || attempt >= maxRetries) {
        throw normalizedError;
      }

      await delay(retryDelayMs * (attempt + 1));
    }
  }

  throw createProviderError('Fun-CineForge lip-sync 调用失败：超出最大重试次数', {
    code: 'FUNCINEFORGE_RETRY_EXHAUSTED',
    category: 'provider_error',
    retryable: false,
  });
}

export const __testables = {
  resolveFetchImpl,
  getTimeoutMs,
  getMaxRetries,
  getRetryDelayMs,
};
