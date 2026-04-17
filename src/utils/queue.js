/**
 * 并发队列控制
 * 使用 p-queue 限制并发数，防止API限流
 */

import PQueue from 'p-queue';

export const imageQueue = new PQueue({ // 图像生成队列（并发1 + 请求间隔，防止限流）
  concurrency: 1,
  interval: parseInt(process.env.IMAGE_QUEUE_INTERVAL_MS || '3000', 10),
  intervalCap: 1,
});

export const ttsQueue = new PQueue({ concurrency: 3 }); // TTS队列
export const llmQueue = new PQueue({ concurrency: 5 }); // LLM队列（避免RPM超限）

/**
 * 带重试的队列任务
 * @param {PQueue} queue
 * @param {Function} fn - 异步任务
 * @param {number} maxRetries
 * @param {string} taskName - 用于日志
 */
function isRateLimitError(err) {
  const msg = String(err?.message || '');
  const status = err?.response?.status ?? err?.status ?? null;
  return status === 429 || msg.includes('429') || msg.includes('rate limit');
}

export async function queueWithRetry(queue, fn, maxRetries = 3, taskName = 'task', hooks = {}) {
  return queue.add(async () => {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const baseDelay = isRateLimitError(err)
            ? Math.min(8000 * Math.pow(2, attempt - 1), 60000)
            : Math.min(1000 * Math.pow(2, attempt - 1), 30000);
          const delay = baseDelay;
          hooks.onRetry?.({
            taskName,
            attempt,
            maxRetries,
            delay,
            error: err,
          });
          console.warn(`[Queue] ${taskName} 失败，${delay / 1000}s 后重试 (${attempt}/${maxRetries})：${err.message}`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw new Error(`[Queue] ${taskName} 重试${maxRetries}次后失败：${lastError.message}`);
  });
}
