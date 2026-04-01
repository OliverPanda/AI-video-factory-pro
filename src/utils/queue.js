/**
 * 并发队列控制
 * 使用 p-queue 限制并发数，防止API限流
 */

import PQueue from 'p-queue';

// 图像生成队列（默认并发2）
// 注意：不混用 concurrency + intervalCap，两者语义会冲突
export const imageQueue = new PQueue({
  concurrency: parseInt(process.env.IMAGE_CONCURRENCY || '2', 10),
});

// TTS队列（较低并发）
export const ttsQueue = new PQueue({ concurrency: 3 });

// LLM队列（避免RPM超限）
export const llmQueue = new PQueue({ concurrency: 5 });

/**
 * 带重试的队列任务
 * @param {PQueue} queue
 * @param {Function} fn - 异步任务
 * @param {number} maxRetries
 * @param {string} taskName - 用于日志
 */
export async function queueWithRetry(queue, fn, maxRetries = 3, taskName = 'task', hooks = {}) {
  return queue.add(async () => {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // 指数退避：1s, 2s, 4s...最多30s
          hooks.onRetry?.({
            taskName,
            attempt,
            maxRetries,
            delay,
            error: err,
          });
          console.warn(`[Queue] ${taskName} 失败，${delay}ms 后重试 (${attempt}/${maxRetries})：${err.message}`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw new Error(`[Queue] ${taskName} 重试${maxRetries}次后失败：${lastError.message}`);
  });
}
