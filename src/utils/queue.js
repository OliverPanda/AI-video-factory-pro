/**
 * 并发队列控制
 * 使用 p-queue 限制并发数，防止API限流
 */

import PQueue from 'p-queue';

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getExecutionMode(options = {}) {
  if (options.mode) {
    return options.mode;
  }

  if (options.executionPolicy?.mode) {
    return options.executionPolicy.mode;
  }

  const env = options.env ?? process.env;

  if (env.QUEUE_EXECUTION_POLICY) {
    return env.QUEUE_EXECUTION_POLICY;
  }

  if (env.NODE_ENV === 'test') {
    return 'test';
  }

  return 'production';
}

export function getQueueConfig(queueType, options = {}) {
  const env = options.env ?? process.env;

  switch (queueType) {
    case 'image':
      return {
        concurrency: parseInteger(env.IMAGE_QUEUE_CONCURRENCY, 5),
        interval: parseInteger(env.IMAGE_QUEUE_INTERVAL_MS, 3000),
        intervalCap: parseInteger(env.IMAGE_QUEUE_INTERVAL_CAP, 5),
      };
    case 'tts':
      return {
        concurrency: parseInteger(env.TTS_QUEUE_CONCURRENCY, 3),
      };
    case 'llm':
      return {
        concurrency: parseInteger(env.LLM_QUEUE_CONCURRENCY, 5),
      };
    case 'video':
      return {
        concurrency: parseInteger(env.VIDEO_QUEUE_CONCURRENCY, 3),
      };
    case 'lipsync':
      return {
        concurrency: parseInteger(env.LIPSYNC_QUEUE_CONCURRENCY, 3),
      };
    default:
      throw new Error(`Unknown queue type: ${queueType}`);
  }
}

export function createExecutionPolicy(options = {}) {
  const mode = getExecutionMode(options);
  const env = options.env ?? process.env;
  const isTestMode = mode === 'test';

  return {
    mode,
    env,
    useRealQueue: options.useRealQueue ?? !isTestMode,
    useRealSleep: options.useRealSleep ?? !isTestMode,
    defaultMaxRetries: options.defaultMaxRetries ?? (isTestMode ? 1 : 3),
  };
}

export async function sleepWithPolicy(delay, policy = {}) {
  if (!policy.useRealSleep || delay <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delay));
}

function isRateLimitError(err) {
  const msg = String(err?.message || '');
  const status = err?.response?.status ?? err?.status ?? null;
  return status === 429 || msg.includes('429') || msg.includes('rate limit');
}

export function createRetryController(options = {}) {
  const policy = options.policy ?? createExecutionPolicy(options);
  const maxRetries = options.maxRetries ?? policy.defaultMaxRetries ?? 3;

  return {
    policy,
    maxRetries,
    shouldRetry(error, attempt, limit = maxRetries) {
      void error;
      return attempt < limit;
    },
    getDelay(error, attempt) {
      if (isRateLimitError(error)) {
        return Math.min(8000 * Math.pow(2, attempt - 1), 60000);
      }

      return Math.min(1000 * Math.pow(2, attempt - 1), 30000);
    },
    sleep(delay) {
      return sleepWithPolicy(delay, policy);
    },
  };
}

export const imageQueue = new PQueue(getQueueConfig('image')); // 图像生成队列
export const ttsQueue = new PQueue(getQueueConfig('tts')); // TTS队列
export const llmQueue = new PQueue(getQueueConfig('llm')); // LLM队列（避免RPM超限）
export const videoQueue = new PQueue(getQueueConfig('video')); // 视频生成队列
export const lipsyncQueue = new PQueue(getQueueConfig('lipsync')); // 口型同步队列

function getQueueByType(queueType) {
  switch (queueType) {
    case 'image':
      return imageQueue;
    case 'tts':
      return ttsQueue;
    case 'llm':
      return llmQueue;
    case 'video':
      return videoQueue;
    case 'lipsync':
      return lipsyncQueue;
    default:
      throw new Error(`Unknown queue type: ${queueType}`);
  }
}

export async function executeQueuedTask(queueType, fn, options = {}) {
  const policy = options.policy ?? createExecutionPolicy(options);
  const queue = options.queue ?? getQueueByType(queueType);

  if (!policy.useRealQueue) {
    return fn();
  }

  return queue.add(fn);
}

/**
 * 带重试的队列任务
 * @param {PQueue} queue
 * @param {Function} fn - 异步任务
 * @param {number} maxRetries
 * @param {string} taskName - 用于日志
 */
export async function queueWithRetry(queue, fn, maxRetries = 3, taskName = 'task', hooks = {}) {
  const policy = hooks.policy ?? createExecutionPolicy(hooks);
  const retry = createRetryController({
    ...hooks,
    policy,
    maxRetries,
  });
  const queueType = hooks.queueType;

  if (!queue && !queueType) {
    throw new Error('queueWithRetry requires a queue or queueType');
  }

  return executeQueuedTask(queueType, async () => {
    let lastError;
    for (let attempt = 1; attempt <= retry.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (retry.shouldRetry(err, attempt)) {
          const delay = retry.getDelay(err, attempt);
          hooks.onRetry?.({
            taskName,
            attempt,
            maxRetries: retry.maxRetries,
            delay,
            error: err,
          });
          console.warn(`[Queue] ${taskName} 失败，${delay / 1000}s 后重试 (${attempt}/${retry.maxRetries})：${err.message}`);
          await retry.sleep(delay);
        }
      }
    }
    throw new Error(`[Queue] ${taskName} 重试${retry.maxRetries}次后失败：${lastError.message}`);
  }, { ...hooks, policy, queue });
}
