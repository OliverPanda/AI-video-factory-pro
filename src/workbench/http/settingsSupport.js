import path from 'node:path';

import { healthCheck as llmHealthCheck } from '../../llm/client.js';
import { buildMiniMaxTtsRequest } from '../../apis/providers/minimaxTtsApi.js';
import { resolveImageRoute, resolveImageTransportProvider, IMAGE_TASK_TYPES } from '../../apis/imageApi.js';
import { resolveTtsProvider } from '../../apis/ttsApi.js';
import { resolveVideoGenerationConfig } from '../../apis/videoGenerationConfig.js';
import { readEnvFile } from '../../utils/envConfigStore.js';

function extractImageProviderEnv(env = process.env) {
  return {
    PRIMARY_API_PROVIDER: env.PRIMARY_API_PROVIDER,
    IMAGE_TRANSPORT_PROVIDER: env.IMAGE_TRANSPORT_PROVIDER,
    IMAGE_API_BASE_URL: env.IMAGE_API_BASE_URL,
    IMAGE_API_KEY: env.IMAGE_API_KEY,
    REALISTIC_IMAGE_MODEL: env.REALISTIC_IMAGE_MODEL,
    THREED_IMAGE_MODEL: env.THREED_IMAGE_MODEL,
    IMAGE_EDIT_MODEL: env.IMAGE_EDIT_MODEL,
  };
}

export const CONFIG_SECTIONS = [
  {
    id: 'llmText',
    title: '文本大模型',
    description: '负责写分镜、理解脚本、做文本推理。只要你想生成内容，这组通常都要先配好。',
    fields: [
      { key: 'LLM_PROVIDER', label: '默认文本模型供应商', kind: 'select', options: ['qwen', 'deepseek', 'claude'], required: true },
      { key: 'QWEN_API_KEY', label: 'Qwen API Key', kind: 'secret' },
      { key: 'QWEN_BASE_URL', label: 'Qwen 接口地址', kind: 'text' },
      { key: 'QWEN_MODEL', label: 'Qwen 文本模型', kind: 'text' },
      { key: 'DEEPSEEK_API_KEY', label: 'DeepSeek API Key', kind: 'secret' },
      { key: 'DEEPSEEK_BASE_URL', label: 'DeepSeek 接口地址', kind: 'text' },
      { key: 'DEEPSEEK_MODEL', label: 'DeepSeek 文本模型', kind: 'text' },
      { key: 'ANTHROPIC_API_KEY', label: 'Claude API Key', kind: 'secret' },
      { key: 'ANTHROPIC_MODEL', label: 'Claude 文本模型', kind: 'text' },
    ],
  },
  {
    id: 'llmVision',
    title: '视觉理解',
    description: '负责看图、做一致性检查、理解参考图。只有你启用了看图分析时才会用到。',
    fields: [
      { key: 'LLM_VISION_PROVIDER', label: '视觉模型供应商', kind: 'select', options: ['qwen', 'claude'], required: true },
      { key: 'QWEN_VISION_MODEL', label: 'Qwen 视觉模型', kind: 'text' },
      { key: 'ANTHROPIC_VISION_MODEL', label: 'Claude 视觉模型', kind: 'text' },
    ],
  },
  {
    id: 'image',
    title: '出图与图像编辑',
    description: '负责角色图、场景图、图像编辑。你要生成角色设定图或改图时，需要配置这组。',
    fields: [
      { key: 'PRIMARY_API_PROVIDER', label: '图像供应商类型', kind: 'select', options: ['openai_compat'] },
      { key: 'IMAGE_TRANSPORT_PROVIDER', label: '图像传输协议', kind: 'text' },
      { key: 'IMAGE_API_BASE_URL', label: '图像接口地址', kind: 'text', required: true },
      { key: 'IMAGE_API_KEY', label: '图像 API Key', kind: 'secret', required: true },
      { key: 'REALISTIC_IMAGE_MODEL', label: '写实出图模型', kind: 'text' },
      { key: 'THREED_IMAGE_MODEL', label: '3D 出图模型', kind: 'text' },
      { key: 'IMAGE_EDIT_MODEL', label: '图像编辑模型', kind: 'text' },
    ],
  },
  {
    id: 'tts',
    title: '配音',
    description: '负责把台词转成音频。要自动出旁白或角色台词，就需要这里。',
    fields: [
      { key: 'TTS_PROVIDER', label: '配音供应商', kind: 'select', options: ['minimax', 'openai_compat', 'mock'] },
      { key: 'TTS_TRANSPORT_PROVIDER', label: '配音传输供应商', kind: 'select', options: ['minimax', 'mock'] },
      { key: 'MINIMAX_API_KEY', label: 'MiniMax API Key', kind: 'secret' },
      { key: 'MINIMAX_GROUP_ID', label: 'MiniMax Group ID', kind: 'text' },
      { key: 'MINIMAX_TTS_BASE_URL', label: 'MiniMax 接口地址', kind: 'text' },
      { key: 'MINIMAX_TTS_REQUEST_PATH', label: 'MiniMax 请求路径', kind: 'text' },
      { key: 'MINIMAX_TTS_MODEL', label: 'MiniMax 模型', kind: 'text' },
      { key: 'MINIMAX_TTS_VOICE_FEMALE', label: '默认女声', kind: 'text' },
      { key: 'MINIMAX_TTS_VOICE_MALE', label: '默认男声', kind: 'text' },
    ],
  },
  {
    id: 'video',
    title: '视频生成',
    description: '负责把镜头图转成视频镜头。这一步最耗时，也最依赖供应商权限和模型配置。',
    fields: [
      { key: 'VIDEO_PROVIDER', label: '视频供应商', kind: 'select', options: ['happyhorse', 'seedance', 'sora'] },
      { key: 'VIDEO_TRANSPORT_PROVIDER', label: '视频传输方式', kind: 'select', options: ['dashscope_async', 'official', 'relay_media_task', 'relay_openai', 'gateway'] },
      { key: 'VIDEO_TRANSPORT_BASE_URL', label: '视频接口地址', kind: 'text' },
      { key: 'VIDEO_TRANSPORT_API_KEY', label: '视频 API Key', kind: 'secret' },
      { key: 'VIDEO_TRANSPORT_SUBMIT_PATH', label: '提交路径', kind: 'text' },
      { key: 'VIDEO_TRANSPORT_POLL_PATH', label: '轮询路径', kind: 'text' },
      { key: 'VIDEO_MODEL_SHOT', label: '单镜头模型', kind: 'text' },
      { key: 'VIDEO_MODEL_BRIDGE', label: '转场模型', kind: 'text' },
      { key: 'VIDEO_MODEL_SEQUENCE', label: '整段模型', kind: 'text' },
      { key: 'BAILIAN_API_KEY', label: '百炼 API Key', kind: 'secret' },
      { key: 'HAPPYHORSE_MODEL_ID', label: 'HappyHorse 默认模型', kind: 'text' },
    ],
  },
  {
    id: 'gatewaySync',
    title: '中转站对账补录',
    description: '用于从中转站日志接口同步真实计费与请求状态，回填本地账本。不会直接影响主流程，只用于对账补录。',
    fields: [
      { key: 'GATEWAY_SYNC_ENABLED', label: '启用对账补录', kind: 'select', options: ['true', 'false'] },
      { key: 'GATEWAY_SYNC_SCHEDULE_ENABLED', label: '启用定时同步', kind: 'select', options: ['true', 'false'] },
      { key: 'GATEWAY_SYNC_INTERVAL_MS', label: '定时间隔(ms)', kind: 'text' },
      { key: 'GATEWAY_SYNC_BASE_URL', label: '中转站日志接口根地址', kind: 'text' },
      { key: 'GATEWAY_SYNC_API_KEY', label: '中转站日志 API Key', kind: 'secret' },
      { key: 'GATEWAY_SYNC_PATH', label: '中转站日志路径', kind: 'text' },
    ],
  },
  {
    id: 'speechAndLipsync',
    title: '识别与口型',
    description: '负责语音识别和口型同步。现在大多是可选链路，不配也能先跑主流程。',
    fields: [
      { key: 'ASR_PROVIDER', label: '语音识别供应商', kind: 'select', options: ['mock'] },
      { key: 'LIPSYNC_PROVIDER', label: '口型同步供应商', kind: 'select', options: ['mock'] },
      { key: 'FUNCINEFORGE_BASE_URL', label: '口型服务地址', kind: 'text' },
      { key: 'FUNCINEFORGE_REQUEST_PATH', label: '口型请求路径', kind: 'text' },
      { key: 'FUNCINEFORGE_API_KEY', label: '口型 API Key', kind: 'secret' },
    ],
  },
];

const HIDDEN_SETTINGS_KEYS = new Set(['GATEWAY_SYNC_FAMILY']);
const ALLOWED_SETTINGS_KEYS = new Set([
  ...CONFIG_SECTIONS.flatMap((section) => section.fields.map((field) => field.key)),
  ...HIDDEN_SETTINGS_KEYS,
]);

function maskSecret(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.length <= 8) return '已配置';
  return `${normalized.slice(0, 4)}****${normalized.slice(-4)}`;
}

function pickEnvValue(values, key, fallback = '') {
  if (Object.prototype.hasOwnProperty.call(values, key)) {
    return values[key];
  }
  return process.env[key] || fallback;
}

export function buildSettingsPayload(workspaceRoot) {
  const envState = readEnvFile(path.join(workspaceRoot, '.env'), {
    allowedRoot: workspaceRoot,
    expectedBaseName: '.env',
  });
  const sections = CONFIG_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    description: section.description,
    fields: section.fields.map((field) => {
      const rawValue = pickEnvValue(envState.values, field.key);
      const configured = String(rawValue || '').trim().length > 0;
      return {
        key: field.key,
        label: field.label,
        kind: field.kind,
        required: Boolean(field.required),
        options: field.options || [],
        value: field.kind === 'secret' ? '' : rawValue,
        configured,
        maskedValue: field.kind === 'secret' ? maskSecret(rawValue) : undefined,
      };
    }),
  }));

  return {
    mode: 'configurable-workbench',
    workbenchApiBase: `http://127.0.0.1:${process.env.WORKBENCH_PORT || 4180}/api`,
    frontendDevServer: process.env.FRONTEND_DEV_SERVER || null,
    note: '这里管理当前工作台真正使用的本地 .env 配置。密钥字段不会回显明文，留空保存表示保持原值。',
    sections,
  };
}

export function collectSettingsUpdates(sections = []) {
  const updates = {};
  for (const section of sections) {
    for (const field of section.fields || []) {
      if (!field || !field.key) continue;
      if (!ALLOWED_SETTINGS_KEYS.has(field.key)) continue;
      const nextValue = typeof field.value === 'string' ? field.value : '';
      const shouldUpdateSecret = field.kind !== 'secret' || nextValue.trim() !== '';
      if (!shouldUpdateSecret) continue;
      updates[field.key] = nextValue;
    }
  }
  return updates;
}

export async function runBatchProviderPrecheck(options = {}) {
  const imageLiveProbe = options.imageLiveProbe;
  const llmTextProvider = process.env.LLM_PROVIDER || 'qwen';
  const llmTextModel = process.env.LLM_MODEL
    || (llmTextProvider === 'qwen' ? process.env.QWEN_MODEL : '')
    || (llmTextProvider === 'deepseek' ? process.env.DEEPSEEK_MODEL : '')
    || (llmTextProvider === 'claude' ? process.env.ANTHROPIC_MODEL : '');
  const llmVisionProvider = process.env.LLM_VISION_PROVIDER || 'qwen';
  const llmVisionModel = llmVisionProvider === 'claude'
    ? (process.env.ANTHROPIC_VISION_MODEL || process.env.ANTHROPIC_MODEL || '')
    : (process.env.QWEN_VISION_MODEL || process.env.QWEN_MODEL || '');

  const safeConfigResult = (sectionId, sectionTitle, factory) => {
    try {
      return factory();
    } catch (err) {
      return {
        sectionId,
        sectionTitle,
        checkType: 'config',
        provider: '',
        model: '',
        ok: false,
        latencyMs: 0,
        message: err.message || '配置解析失败',
        hint: '请先保存正确的配置，再重新执行预检。',
      };
    }
  };

  return {
    checkedAt: new Date().toISOString(),
    results: [
      await llmHealthCheck({ provider: llmTextProvider, model: llmTextModel }).then((result) => ({
        sectionId: 'llmText',
        sectionTitle: '文本大模型',
        checkType: 'live',
        provider: result.provider,
        model: result.model,
        ok: result.ok,
        latencyMs: result.latencyMs,
        message: result.ok ? '文本模型连通性正常' : (result.error || '文本模型预检失败'),
        hint: result.hint || '',
      })),
      await llmHealthCheck({ provider: llmVisionProvider, model: llmVisionModel }).then((result) => ({
        sectionId: 'llmVision',
        sectionTitle: '视觉理解',
        checkType: 'live',
        provider: result.provider,
        model: result.model,
        ok: result.ok,
        latencyMs: result.latencyMs,
        message: result.ok ? '视觉模型连通性正常' : (result.error || '视觉模型预检失败'),
        hint: result.hint || '',
      })),
      await (async () => {
        const imageRoute = resolveImageRoute(IMAGE_TASK_TYPES.REALISTIC_IMAGE);
        const imageTransport = resolveImageTransportProvider();
        if (typeof imageLiveProbe === 'function') {
          try {
            const result = await imageLiveProbe({
              provider: imageTransport,
              model: imageRoute.model,
              env: extractImageProviderEnv(process.env),
            });
            return {
              sectionId: 'image',
              sectionTitle: '出图与图像编辑',
              checkType: 'live',
              provider: result?.provider || imageTransport,
              model: result?.model || imageRoute.model,
              ok: Boolean(result?.ok),
              latencyMs: Number(result?.latencyMs || 0),
              message: result?.message || (result?.ok ? '图像鉴权与模型权限正常' : '图像预检失败'),
              hint: result?.hint || '',
            };
          } catch (err) {
            return {
              sectionId: 'image',
              sectionTitle: '出图与图像编辑',
              checkType: 'live',
              provider: imageTransport,
              model: imageRoute.model,
              ok: false,
              latencyMs: 0,
              message: err.message || '图像预检失败',
              hint: '请检查图像 API Key、模型权限和供应商账户状态。',
            };
          }
        }
        const ok = Boolean(process.env.IMAGE_API_BASE_URL && process.env.IMAGE_API_KEY);
        return {
          sectionId: 'image',
          sectionTitle: '出图与图像编辑',
          checkType: 'config',
          provider: imageTransport,
          model: imageRoute.model,
          ok,
          latencyMs: 0,
          message: ok ? '已检测到图像接口地址和 API Key' : '图像接口地址或 API Key 缺失',
          hint: '当前先做配置完整性检查，避免误触发真实出图计费。',
        };
      })(),
      safeConfigResult('tts', '配音', () => {
        const ttsProvider = resolveTtsProvider();
        const ttsRequest = buildMiniMaxTtsRequest('预检', {}, process.env);
        const ok = Boolean(ttsRequest.url && ttsRequest.headers.Authorization && ttsRequest.headers.Authorization !== 'Bearer ');
        return {
          sectionId: 'tts',
          sectionTitle: '配音',
          checkType: 'config',
          provider: ttsProvider,
          model: process.env.MINIMAX_TTS_MODEL || '',
          ok,
          latencyMs: 0,
          message: ok ? '已检测到配音请求所需的基础配置' : '缺少 MiniMax API Key',
          hint: '当前先校验请求是否可组装，避免在设置页直接发起真实配音任务。',
        };
      }),
      safeConfigResult('video', '视频生成', () => {
        const videoConfig = resolveVideoGenerationConfig({ packageId: 'precheck-shot', packageType: 'shot' });
        const ok = Boolean(videoConfig.baseUrl && videoConfig.apiKey && videoConfig.submitPath);
        return {
          sectionId: 'video',
          sectionTitle: '视频生成',
          checkType: 'config',
          provider: videoConfig.provider,
          model: videoConfig.model,
          ok,
          latencyMs: 0,
          message: ok ? '已检测到视频生成请求所需的基础配置' : '视频生成配置不完整',
          hint: '当前先校验配置是否完整，避免在设置页直接提交真实视频任务。',
        };
      }),
      {
        sectionId: 'gatewaySync',
        sectionTitle: '中转站对账补录',
        checkType: 'config',
        provider: process.env.GATEWAY_SYNC_FAMILY || 'auto',
        model: '',
        ok: String(process.env.GATEWAY_SYNC_ENABLED || 'false') !== 'true'
          || Boolean(process.env.GATEWAY_SYNC_BASE_URL && process.env.GATEWAY_SYNC_API_KEY),
        latencyMs: 0,
        message:
          String(process.env.GATEWAY_SYNC_ENABLED || 'false') === 'true'
            ? (process.env.GATEWAY_SYNC_BASE_URL && process.env.GATEWAY_SYNC_API_KEY
              ? '已检测到中转站日志同步所需基础配置'
              : '中转站日志同步配置不完整')
            : '当前未启用中转站对账补录',
        hint: String(process.env.GATEWAY_SYNC_SCHEDULE_ENABLED || 'false') === 'true'
          ? '已启用定时同步；该链路只用于对账补录，不会替代本地账本查询。'
          : '该配置只用于对账补录，不会自动替代本地账本。',
      },
    ],
  };
}
