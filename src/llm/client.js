/**
 * LLM 统一客户端
 * 支持多 Provider 切换：qwen | deepseek | claude
 * 通过 .env 中 LLM_PROVIDER / LLM_VISION_PROVIDER 控制
 */

import 'dotenv/config';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';

// ─── Provider 配置 ───────────────────────────────────────────
function getProviders() {
  return {
    deepseek: {
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      type: 'openai-compat',
    },
    qwen: {
      baseURL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: process.env.QWEN_API_KEY,
      model: process.env.QWEN_MODEL || 'qwen2.5-72b-instruct',
      visionModel: process.env.QWEN_VISION_MODEL || 'qwen-vl-max',
      type: 'openai-compat',
    },
    claude: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      visionModel: process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-6',
      type: 'anthropic',
    },
  };
}

// ─── OpenAI 兼容格式请求（DeepSeek / Qwen） ─────────────────
async function callOpenAICompat(provider, messages, options = {}) {
  const { baseURL, apiKey, model } = provider;
  const response = await axios.post(
    `${baseURL}/chat/completions`,
    {
      model: options.model || model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      response_format: options.jsonMode ? { type: 'json_object' } : undefined,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    }
  );

  // 响应格式校验，避免意外结构导致的 undefined 崩溃
  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`API 返回了意外的响应格式：${JSON.stringify(response.data).slice(0, 200)}`);
  }
  return content;
}

// ─── Anthropic Claude 格式请求 ───────────────────────────────
let _anthropicClient = null;
function getAnthropicClient() {
  if (!_anthropicClient) {
    _anthropicClient = new Anthropic({ apiKey: getProviders().claude.apiKey });
  }
  return _anthropicClient;
}

async function callClaude(messages, options = {}) {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: options.model || getProviders().claude.model,
    max_tokens: options.maxTokens ?? 4096,
    messages,
    temperature: options.temperature ?? 0.7,
  });

  // 响应格式校验
  const content = response.content?.[0]?.text;
  if (typeof content !== 'string') {
    throw new Error(`Claude 返回了意外的响应格式：${JSON.stringify(response.content).slice(0, 200)}`);
  }
  return content;
}

// ─── 统一对话接口 ────────────────────────────────────────────
/**
 * 调用文本 LLM
 * @param {Array} messages - [{role, content}]
 * @param {Object} options - { temperature, maxTokens, jsonMode, provider }
 * @returns {Promise<string>}
 */
export async function chat(messages, options = {}) {
  const providerName = options.provider || process.env.LLM_PROVIDER || 'qwen';
  const provider = getProviders()[providerName];
  if (!provider) throw new Error(`Unknown LLM provider: ${providerName}`);

  if (provider.type === 'anthropic') {
    return callClaude(messages, options);
  }
  return callOpenAICompat(provider, messages, options);
}

// ─── 视觉验证接口 ────────────────────────────────────────────
/**
 * 调用视觉 LLM（多模态）
 * @param {string} textPrompt - 分析指令
 * @param {Array<string>} imageUrls - 图像 URL 或 base64（data:image/...）
 * @param {Object} options
 * @returns {Promise<string>}
 */
export async function visionChat(textPrompt, imageUrls, options = {}) {
  const providerName = options.provider || process.env.LLM_VISION_PROVIDER || 'qwen';
  const provider = getProviders()[providerName];
  if (!provider) throw new Error(`Unknown vision provider: ${providerName}`);

  const imageContent = imageUrls.map((url) => ({
    type: 'image_url',
    image_url: { url },
  }));

  const messages = [
    {
      role: 'user',
      content: [
        ...imageContent,
        { type: 'text', text: textPrompt },
      ],
    },
  ];

  if (provider.type === 'anthropic') {
    // Claude 多模态格式略有不同
    const claudeMessages = [
      {
        role: 'user',
        content: [
          ...imageUrls.map((url) => {
            if (url.startsWith('data:')) {
              const [meta, data] = url.split(',');
              const mediaType = meta.replace('data:', '').replace(';base64', '');
              return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
            }
            return { type: 'image', source: { type: 'url', url } };
          }),
          { type: 'text', text: textPrompt },
        ],
      },
    ];
    return callClaude(claudeMessages, { ...options, model: getProviders().claude.visionModel });
  }

  return callOpenAICompat(
    { ...provider, model: provider.visionModel || provider.model },
    messages,
    options
  );
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
/**
 * 发送一个最小请求来检测 LLM API 是否可用
 * @returns {Promise<{ ok: boolean; provider: string; model: string; latencyMs: number; error?: string; hint?: string }>}
 */
export async function healthCheck(options = {}) {
  const providerName = options.provider || process.env.LLM_PROVIDER || 'qwen';
  const configuredModel = typeof options.model === 'string' && options.model.trim()
    ? options.model.trim()
    : null;
  const provider = getProviders()[providerName];
  if (!provider) {
    return { ok: false, provider: providerName, model: '', latencyMs: 0, error: `未知 Provider: ${providerName}`, hint: '请在 .env 中配置 LLM_PROVIDER' };
  }
  if (!provider.apiKey) {
    return { ok: false, provider: providerName, model: configuredModel || provider.model || '', latencyMs: 0, error: 'API Key 未配置', hint: `请在 .env 中设置 ${providerName.toUpperCase()}_API_KEY` };
  }

  const startMs = Date.now();
  try {
    const messages = [{ role: 'user', content: 'Hi' }];
    const HEALTH_CHECK_TIMEOUT_MS = 10000;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Health check timed out')), HEALTH_CHECK_TIMEOUT_MS)
    );

    let apiCall;
    if (provider.type === 'anthropic') {
      apiCall = callClaude(messages, { maxTokens: 8, temperature: 0, model: configuredModel || provider.model });
    } else {
      apiCall = callOpenAICompat(provider, messages, {
        maxTokens: 8,
        temperature: 0,
        model: configuredModel || provider.model,
      });
    }
    await Promise.race([apiCall, timeoutPromise]);
    return { ok: true, provider: providerName, model: configuredModel || provider.model || '', latencyMs: Date.now() - startMs };
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    const msg = String(err?.message || err);
    let hint = '';
    if (/401/.test(msg)) hint = 'API Key 无效或已过期，请到对应平台重新生成';
    else if (/403/.test(msg)) hint = 'API 访问被拒绝，请检查账户余额和模型权限';
    else if (/404/.test(msg)) hint = 'API 地址或模型名称不存在，请检查配置';
    else if (/429/.test(msg)) hint = '请求频率超限，请稍后重试';
    else if (/5\d{2}/.test(msg)) hint = '服务商端故障，通常几分钟后恢复';
    else if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg)) hint = '网络连接异常，请检查网络或 BASE_URL 配置';
    return { ok: false, provider: providerName, model: configuredModel || provider.model || '', latencyMs, error: msg, hint };
  }
}

export default { chat, visionChat, chatJSON, parseJSONResponse, healthCheck };
