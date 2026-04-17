import { createVercelAiGatewayImageTransport } from './transports/vercelAiGatewayImageTransport.js';
import { laozhangImageProvider } from './imageProviders/laozhangImageProvider.js';

function normalizeImageTransportProvider(provider) {
  if (!provider) return 'openai_compat';
  if (provider === 'laozhang') return 'openai_compat';
  return provider;
}

function createDefaultTransports() {
  return {
    openai_compat: laozhangImageProvider,
    vercel_ai_gateway: createVercelAiGatewayImageTransport(),
  };
}

export function createUnifiedImageProviderClient(options = {}) {
  const transports = {
    ...createDefaultTransports(),
    ...(options.transports || {}),
  };

  function selectTransport(provider) {
    const normalizedProvider = normalizeImageTransportProvider(provider);
    const transport = transports[normalizedProvider];
    if (!transport) {
      throw new Error(`未注册的图像 Transport：${normalizedProvider}`);
    }
    return { provider: normalizedProvider, transport };
  }

  return {
    async generate(request, runtimeOptions = {}) {
      const env = runtimeOptions.env || request.env || process.env;
      const provider = runtimeOptions.provider || request.transportProvider || env.IMAGE_TRANSPORT_PROVIDER || env.PRIMARY_API_PROVIDER;
      const { provider: normalizedProvider, transport } = selectTransport(provider);
      return {
        provider: normalizedProvider,
        outputPath: await transport.generate({
          ...request,
          env,
        }),
      };
    },
  };
}

export const __testables = {
  createDefaultTransports,
  normalizeImageTransportProvider,
};
