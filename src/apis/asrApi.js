import { transcribeWithMock } from './providers/mockAsrApi.js';

function createPlaceholderProvider(provider) {
  return async () => {
    throw new Error(`ASR provider "${provider}" 尚未接入，当前仅保留 provider routing 插槽`);
  };
}

const DEFAULT_PROVIDER_HANDLERS = {
  mock: transcribeWithMock,
  openai: createPlaceholderProvider('openai'),
  xfyun: createPlaceholderProvider('xfyun'),
};

export function resolveAsrProvider(options = {}, env = process.env) {
  return options.provider || env.ASR_PROVIDER || 'mock';
}

export function getAsrProviderHandler(provider, providerHandlers = DEFAULT_PROVIDER_HANDLERS) {
  const handler = providerHandlers[provider];
  if (!handler) {
    throw new Error(`未知 ASR Provider：${provider}`);
  }
  return handler;
}

export async function transcribeAudio(audioPath, options = {}) {
  const provider = resolveAsrProvider(options);
  const providerHandlers = {
    ...DEFAULT_PROVIDER_HANDLERS,
    ...(options.providerHandlers || {}),
  };
  const handler = getAsrProviderHandler(provider, providerHandlers);
  return handler(audioPath, options);
}

export const __testables = {
  resolveAsrProvider,
  getAsrProviderHandler,
};
