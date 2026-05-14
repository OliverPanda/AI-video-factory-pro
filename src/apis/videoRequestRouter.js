import {
  createGatewayVideoTransport,
  createOfficialSeedanceVideoTransport,
  createRelayOpenAiVideoTransport,
  createRelaySeedanceV2VideoTransport,
} from './videoTransports.js';
import { seedanceAdapter, soraAdapter, veoAdapter } from './videoAdapters.js';
import { createVideoRouteError, normalizeVideoProvider, normalizeVideoTransport } from './videoGenerationContract.js';

function buildRouteKey(provider, transport) {
  return `${normalizeVideoProvider(provider)}::${normalizeVideoTransport(transport)}`;
}

export function createVideoRequestRouter(options = {}) {
  const adapters = options.adapters || {
    seedance: seedanceAdapter,
    veo: veoAdapter,
    sora: soraAdapter,
  };
  const transports = options.transports || {
    official: createOfficialSeedanceVideoTransport(options.officialSeedanceTransportOptions),
    relay_openai: createRelayOpenAiVideoTransport(options.relayOpenAiTransportOptions),
    relay_seedance_v2: createRelaySeedanceV2VideoTransport(options.relaySeedanceV2TransportOptions),
    gateway: createGatewayVideoTransport(options.gatewayTransportOptions),
  };
  const routeTable = new Map(
    (options.routes || [
      ['seedance', 'official'],
      ['seedance', 'relay_openai'],
      ['seedance', 'relay_seedance_v2'],
      ['seedance', 'gateway'],
      ['veo', 'relay_openai'],
      ['veo', 'gateway'],
      ['sora', 'relay_openai'],
      ['sora', 'gateway'],
    ]).map(([provider, transport]) => [buildRouteKey(provider, transport), { provider, transport }])
  );

  return {
    resolve(request) {
      const key = buildRouteKey(request?.provider, request?.transport);
      const route = routeTable.get(key);
      if (!route) {
        throw createVideoRouteError(
          `未找到视频路由：provider=${request?.provider || ''}, model=${request?.model || ''}, transport=${request?.transport || ''}, packageType=${request?.packageType || ''}`,
          {
            details: {
              provider: request?.provider || null,
              model: request?.model || null,
              transport: request?.transport || null,
              packageType: request?.packageType || null,
            },
          }
        );
      }

      const adapter = adapters[normalizeVideoProvider(route.provider)];
      const transport = transports[normalizeVideoTransport(route.transport)];
      if (!adapter || !transport) {
        throw createVideoRouteError(
          `视频路由缺少 adapter 或 transport：provider=${route.provider}, transport=${route.transport}`,
          {
            code: 'VIDEO_ROUTE_REGISTRY_MISSING',
            details: route,
          }
        );
      }

      return {
        adapter,
        transport,
        resolvedProvider: normalizeVideoProvider(route.provider),
        resolvedTransport: normalizeVideoTransport(route.transport),
      };
    },
  };
}

export const __testables = {
  buildRouteKey,
};
