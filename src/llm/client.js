/**
 * LLM 统一客户端
 * 支持多 Provider 切换：qwen | deepseek | claude
 * 通过 .env 中 LLM_PROVIDER / LLM_VISION_PROVIDER 控制
 */

import 'dotenv/config';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';

// ─── Provider 配置 ───────────────────────────────────────────
const PROVIDERS = {
  deepseek: {
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-chat',
    type: 'openai-compat',
  },
  qwen: {
    baseURL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.QWEN_API_KEY,
    model: 'qwen2.5-72b-instruct',
    visionModel: 'qwen-vl-max',
    type: 'openai-compat',
  },
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
    visionModel: 'claude-sonnet-4-6',
    type: 'anthropic',
  },
};

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
    _anthropicClient = new Anthropic({ apiKey: PROVIDERS.claude.apiKey });
  }
  return _anthropicClient;
}

async function callClaude(messages, options = {}) {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: options.model || PROVIDERS.claude.model,
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
  const provider = PROVIDERS[providerName];
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
  const provider = PROVIDERS[providerName];
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
    return callClaude(claudeMessages, { ...options, model: PROVIDERS.claude.visionModel });
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

export default { chat, visionChat, chatJSON, parseJSONResponse };
