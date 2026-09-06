/**
 * LLM 统一客户端
 * 支持多 Provider 切换：qwen | deepseek | claude
 * 通过 .env 中 LLM_PROVIDER / LLM_VISION_PROVIDER 控制
 *
 * v1.2 / P1c：传输层迁移到 Vercel AI SDK（`ai` + `@ai-sdk/openai-compatible` + `@ai-sdk/anthropic`）。
 * v1.3 / P1d：共享队列出口 callWithPolicy 下沉至此（全仓唯一 LLM 入队点），观测日志统一在此记录。
 * 导出契约保持不变：chat / visionChat / chatJSON / parseJSONResponse / healthCheck / default。
 */

import 'dotenv/config';
import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { anthropic } from '@ai-sdk/anthropic';
import { createExecutionPolicy, executeQueuedTask } from '../utils/queue.js';
import logger from '../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

// ─── Provider 配置 ───────────────────────────────────────────
function getProviders() {
  return {
    openai_compat: {
      baseURL: process.env.OPENAI_COMPAT_BASE_URL || process.env.IMAGE_API_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_COMPAT_API_KEY || process.env.IMAGE_API_KEY,
      model: process.env.LLM_MODEL || 'glm-5.3-flash',
      visionModel: process.env.LLM_VISION_MODEL || process.env.LLM_MODEL || 'glm-5.3-flash',
      kind: 'openai-compat',
    },
    deepseek: {
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      visionModel: process.env.DEEPSEEK_VISION_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      kind: 'openai-compat',
    },
    qwen: {
      baseURL:
        process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: process.env.QWEN_API_KEY,
      model: process.env.QWEN_MODEL || 'qwen2.5-72b-instruct',
      visionModel: process.env.QWEN_VISION_MODEL || 'qwen-vl-max',
      kind: 'openai-compat',
    },
    claude: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      visionModel: process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-6',
      kind: 'anthropic',
    },
  };
}

// openai-compatible provider 按 (name, baseURL) 缓存，避免重复构造
const oacCache = new Map();
function getOpenAIProvider(name, baseURL, apiKey) {
  const key = `${name}:${baseURL}`;
  if (!oacCache.has(key)) {
    oacCache.set(key, createOpenAICompatible({ name, baseURL, apiKey }));
  }
  return oacCache.get(key);
}

function resolveLanguageModel(providerName, { modelOverride } = {}) {
  const provider = getProviders()[providerName];
  if (!provider) {
    throw new Error(`Unknown LLM provider: ${providerName}`);
  }
  const modelId = modelOverride || provider.model;
  if (provider.kind === 'anthropic') {
    return anthropic(modelId);
  }
  return getOpenAIProvider(providerName, provider.baseURL, provider.apiKey)(modelId);
}

// ─── 通用 generateText 选项 ──────────────────────────────────
// 保留旧版默认：temperature 0.7 / maxOutputTokens 4096 / 120s 超时
// jsonMode=true 时仅对 openai-compat 注入 response_format（Claude 无该字段，保持旧语义）
function baseGenerateOptions(options, { jsonMode = false } = {}) {
  const out = {
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    maxOutputTokens: options.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };
  if (jsonMode) {
    out.responseFormat = { type: 'json' };
  }
  return out;
}

// ─── 共享 LLM 队列出口（P1d / D1）───────────────────────────
// 全仓唯一的 LLM 入队点：chat / visionChat / chatJSON 统一经此限流。
// 策略化/test 路径（QUEUE_EXECUTION_POLICY=test 等）下 useRealQueue=false 直跑，不发队列。
// 队列并发配置：src/utils/queue.js getQueueConfig('llm')（默认 concurrency 5，LLM_QUEUE_CONCURRENCY 可调）。
export async function callWithPolicy(fn, options = {}, meta = {}) {
  const policy = options.executionPolicy ?? createExecutionPolicy({ env: process.env });
  const startMs = Date.now();
  try {
    const result = await executeQueuedTask('llm', fn, { policy });
    logger.debug('LLMClient', {
      ...meta,
      latencyMs: Date.now() - startMs,
      finishReason: result?.finishReason,
      usage: result?.usage,
    });
    return result;
  } catch (err) {
    logger.debug('LLMClient', {
      ...meta,
      latencyMs: Date.now() - startMs,
      error: String(err?.message || err),
    });
    throw err;
  }
}

// ─── 统一对话接口 ────────────────────────────────────────────
/**
 * 调用文本 LLM
 * @param {Array} messages - [{role, content}]
 * @param {Object} options - { temperature, maxTokens, jsonMode, provider, model, timeoutMs }
 * @returns {Promise<string>}
 */
export async function chat(messages, options = {}) {
  const providerName = options.provider || process.env.LLM_PROVIDER || 'qwen';
  const model = resolveLanguageModel(providerName, { modelOverride: options.model });

  // AI SDK v7+ 不允许 system 消息在 messages 数组中，需提取为 instructions
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');
  const instructions = systemMessages.length > 0
    ? systemMessages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n\n')
    : undefined;

  const result = await callWithPolicy(
    () =>
      generateText({
        model,
        messages: nonSystemMessages,
        ...(instructions ? { instructions } : {}),
        ...baseGenerateOptions(options, { jsonMode: !!options.jsonMode }),
      }),
    options,
    { op: 'chat', provider: providerName, model: model.modelId }
  );
  return result.text;
}

// ─── 视觉验证接口 ────────────────────────────────────────────
/**
 * 调用视觉 LLM（多模态）
 * @param {string} textPrompt - 分析指令
 * @param {Array<string>} imageUrls - http(s) URL 或 `data:image/...;base64,...`
 * @param {Object} options - { temperature, maxTokens, provider, model, timeoutMs }
 * @returns {Promise<string>}
 */
export async function visionChat(textPrompt, imageUrls, options = {}) {
  const providerName = options.provider || process.env.LLM_VISION_PROVIDER || 'qwen';
  const provider = getProviders()[providerName];
  if (!provider) {
    throw new Error(`Unknown vision provider: ${providerName}`);
  }
  const modelId = options.model || provider.visionModel || provider.model;
  const model =
    provider.kind === 'anthropic'
      ? anthropic(modelId)
      : getOpenAIProvider(providerName, provider.baseURL, provider.apiKey)(modelId);

  // AI SDK ImagePart 同时接受 http URL、base64 data URL 与裸 base64/Buffer。
  // 我们保留旧版「data URL 提取 mediaType」的轻量优化以便走 image/* 透传
  const imageContent = imageUrls.map((url) => {
    if (typeof url === 'string' && url.startsWith('data:')) {
      const semi = url.indexOf(';');
      const mediaType = url.substring(5, semi > 0 ? semi : undefined);
      return { type: 'image', image: url, mediaType };
    }
    return { type: 'image', image: url };
  });

  const messages = [
    {
      role: 'user',
      content: [...imageContent, { type: 'text', text: textPrompt }],
    },
  ];

  const result = await callWithPolicy(
    () => generateText({ model, messages, ...baseGenerateOptions(options) }),
    options,
    { op: 'vision', provider: providerName, model: modelId }
  );
  return result.text;
}

// ─── JSON 解析助手 ───────────────────────────────────────────
/**
 * 调用 LLM 并解析 JSON 响应
 * 自动处理 markdown 代码块包裹的情况
 */
export async function chatJSON(messages, options = {}) {
  const raw = await chat(messages, { ...options, jsonMode: true });
  return parseJSONResponse(raw);
}

export function parseJSONResponse(raw) {
  // 去除 markdown 代码块（支持多种包裹形式）
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // 第一步：直接解析
  try {
    return JSON.parse(cleaned);
  } catch {
    // 第二步：非贪心匹配第一个完整 JSON 对象或数组
    // 使用非贪心量词，避免跨对象匹配
    const objMatch = cleaned.match(/\{(?:[^{}]|(?:\{[^{}]*\}))*\}/s);
    const arrMatch = cleaned.match(/\[(?:[^\[\]]|(?:\[[^\[\]]*\]))*\]/s);

    // 优先取更靠前的匹配
    const candidates = [objMatch, arrMatch]
      .filter(Boolean)
      .sort((a, b) => cleaned.indexOf(a[0]) - cleaned.indexOf(b[0]));

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate[0]);
      } catch {
        // 继续尝试下一个
      }
    }

    // 第三步：记录原始响应便于调试
    throw new Error(`LLM 返回了无效的 JSON（已尝试所有解析策略）:\n${raw.slice(0, 500)}`);
  }
}

// ─── 健康检查 ──────────────────────────────────────────────
// 将错误→hint 映射抽成纯函数，便于单测（参见 tests/llmClient.test.js）
export function hintForMessage(msg) {
  if (/401/.test(msg)) return 'API Key 无效或已过期，请到对应平台重新生成';
  if (/403/.test(msg)) return 'API 访问被拒绝，请检查账户余额和模型权限';
  if (/404/.test(msg)) return 'API 地址或模型名称不存在，请检查配置';
  if (/429/.test(msg)) return '请求频率超限，请稍后重试';
  if (/5\d{2}/.test(msg)) return '服务商端故障，通常几分钟后恢复';
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg)) {
    return '网络连接异常，请检查网络或 BASE_URL 配置';
  }
  return '';
}

/**
 * 发送一个最小请求来检测 LLM API 是否可用
 * @returns {Promise<{ ok: boolean; provider: string; model: string; latencyMs: number; error?: string; hint?: string }>}
 */
export async function healthCheck(options = {}) {
  const providerName = options.provider || process.env.LLM_PROVIDER || 'qwen';
  const configuredModel =
    typeof options.model === 'string' && options.model.trim() ? options.model.trim() : null;
  const provider = getProviders()[providerName];
  if (!provider) {
    return {
      ok: false,
      provider: providerName,
      model: '',
      latencyMs: 0,
      error: `未知 Provider: ${providerName}`,
      hint: '请在 .env 中配置 LLM_PROVIDER',
    };
  }
  if (!provider.apiKey) {
    return {
      ok: false,
      provider: providerName,
      model: configuredModel || provider.model || '',
      latencyMs: 0,
      error: 'API Key 未配置',
      hint: `请在 .env 中设置 ${providerName.toUpperCase()}_API_KEY`,
    };
  }

  const startMs = Date.now();
  try {
    const model =
      provider.kind === 'anthropic'
        ? anthropic(configuredModel || provider.model)
        : getOpenAIProvider(
            providerName,
            provider.baseURL,
            provider.apiKey,
          )(configuredModel || provider.model);

    await generateText({
      model,
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0,
      maxOutputTokens: 8,
      abortSignal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    return {
      ok: true,
      provider: providerName,
      model: configuredModel || provider.model || '',
      latencyMs: Date.now() - startMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    const msg = String(err?.message || err);
    return {
      ok: false,
      provider: providerName,
      model: configuredModel || provider.model || '',
      latencyMs,
      error: msg,
      hint: hintForMessage(msg),
    };
  }
}

// 内部测试钩子（不影响默认契约）
export const __testables = {
  resolveLanguageModel,
  getProviders,
  getOpenAIProvider,
  baseGenerateOptions,
  hintForMessage,
  callWithPolicy,
  oacCache,
};

export default { chat, visionChat, chatJSON, parseJSONResponse, healthCheck };