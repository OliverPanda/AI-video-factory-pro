import fs from 'node:fs';

import { normalizeVideoProviderError, normalizeVideoProviderRequest } from './videoProviderProtocol.js';

function ensurePrompt(request) {
  return String(request?.prompt || '').trim();
}

function ensureFirstImagePath(request) {
  return request?.referenceImages?.[0]?.path || null;
}

function inferVideoSize(request) {
  const ratio = String(request?.ratio || '9:16').trim();
  if (ratio === '16:9') {
    return '1280x720';
  }
  return '1080x1920';
}

function createAdapterError(message, details = null) {
  return normalizeVideoProviderError({
    message,
    code: 'VIDEO_ADAPTER_INVALID_REQUEST',
    category: 'provider_invalid_request',
    details,
  });
}

function buildRelayOpenAiRequest(request) {
  const prompt = ensurePrompt(request);
  const imagePath = ensureFirstImagePath(request);
  if (!imagePath) {
    throw createAdapterError('relay_openai 需要至少一张 reference image', {
      requestId: request?.requestId || null,
      packageId: request?.packageId || null,
    });
  }

  return {
    model: request.model,
    prompt,
    imagePath,
    ratio: request.ratio || '9:16',
    duration: Number.isFinite(request.durationSec) ? request.durationSec : 5,
    seconds: Number.isFinite(request.durationSec) ? Math.max(Math.round(request.durationSec), 1) : 5,
    size: inferVideoSize(request),
  };
}

function buildRelaySeedanceV2Request(request) {
  const prompt = ensurePrompt(request);
  const imagePath = ensureFirstImagePath(request);
  if (!imagePath) {
    throw createAdapterError('relay_seedance_v2 需要至少一张 reference image', {
      requestId: request?.requestId || null,
      packageId: request?.packageId || null,
    });
  }

  return {
    model: request.model,
    prompt,
    imagePath,
    ratio: request.ratio || '9:16',
    duration: Number.isFinite(request.durationSec) ? Math.max(Math.round(request.durationSec), 4) : 5,
    resolution: '720p',
  };
}

export const seedanceAdapter = {
  name: 'SeedanceAdapter',
  supportedProviders: ['seedance'],
  buildProviderRequest(request) {
    if (request.transport === 'official') {
      const prompt = ensurePrompt(request);
      const content = [];
      if (prompt) {
        content.push({ type: 'text', text: prompt });
      }
      for (const [index, referenceImage] of (Array.isArray(request.referenceImages) ? request.referenceImages : []).entries()) {
        if (!referenceImage?.path) continue;
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${fs.readFileSync(referenceImage.path).toString('base64')}`,
          },
          role: referenceImage.role || (index === 0 ? 'first_frame' : 'reference_image'),
        });
      }
      if (content.length === 0) {
        throw createAdapterError('Seedance official 需要 prompt 或 reference image', {
          requestId: request?.requestId || null,
          packageId: request?.packageId || null,
        });
      }

      const requestBody = {
        model: request.model,
        content,
        ratio: request.ratio || '9:16',
        duration: Number.isFinite(request.durationSec) ? Math.max(Math.round(request.durationSec), 4) : 5,
        generate_audio: false,
        watermark: false,
      };

      return {
        requestBody,
        requestSummary: normalizeVideoProviderRequest({
          provider: 'seedance',
          request: requestBody,
          metadata: {
            resolvedAdapter: 'SeedanceAdapter',
            transport: request.transport,
          },
        }),
      };
    }

    if (request.transport === 'relay_openai') {
      const requestBody = buildRelayOpenAiRequest(request);
      return {
        requestBody,
        requestSummary: normalizeVideoProviderRequest({
          provider: 'seedance',
          request: requestBody,
          metadata: {
            resolvedAdapter: 'SeedanceAdapter',
            transport: request.transport,
            protocol: 'openai_videos',
          },
        }),
      };
    }

    if (request.transport === 'relay_seedance_v2') {
      const requestBody = buildRelaySeedanceV2Request(request);
      return {
        requestBody,
        requestSummary: normalizeVideoProviderRequest({
          provider: 'seedance',
          request: requestBody,
          metadata: {
            resolvedAdapter: 'SeedanceAdapter',
            transport: request.transport,
            protocol: 'relay_seedance_v2',
          },
        }),
      };
    }

    if (request.transport === 'gateway') {
      const requestBody = {
        model: request.model,
        packageType: request.packageType,
        entityId: request.packageId,
        prompt: ensurePrompt(request),
        durationSec: request.durationSec || null,
        aspectRatio: request.ratio || '9:16',
        references: [
          ...(request.referenceImages || []).map((entry, index) => ({
            type: 'image',
            role: entry.role || (index === 0 ? 'first_frame' : 'reference_image'),
            path: entry.path || null,
            shotId: entry.shotId || null,
          })),
          ...(request.referenceVideos || []).map((entry) => ({
            type: 'video',
            role: entry.role || 'reference_video',
            path: entry.path || null,
            shotId: entry.shotId || null,
          })),
        ],
      };
      return {
        requestBody,
        requestSummary: normalizeVideoProviderRequest({
          provider: 'seedance',
          request: requestBody,
          metadata: {
            resolvedAdapter: 'SeedanceAdapter',
            transport: request.transport,
          },
        }),
      };
    }

    throw createAdapterError(`SeedanceAdapter 不支持 transport=${request.transport}`, {
      requestId: request?.requestId || null,
      packageId: request?.packageId || null,
    });
  },
};

function buildOpenAiRelayAdapter(provider, request) {
  const requestBody = buildRelayOpenAiRequest(request);
  return {
    requestBody,
    requestSummary: normalizeVideoProviderRequest({
      provider,
      request: requestBody,
      metadata: {
        resolvedAdapter: provider === 'veo' ? 'VeoAdapter' : 'SoraAdapter',
        transport: request.transport,
        protocol: 'openai_videos',
      },
    }),
  };
}

export const veoAdapter = {
  name: 'VeoAdapter',
  supportedProviders: ['veo'],
  buildProviderRequest(request) {
    if (request.transport === 'relay_openai' || request.transport === 'gateway') {
      return buildOpenAiRelayAdapter('veo', request);
    }
    throw createAdapterError(`VeoAdapter 不支持 transport=${request.transport}`, {
      requestId: request?.requestId || null,
      packageId: request?.packageId || null,
    });
  },
};

export const soraAdapter = {
  name: 'SoraAdapter',
  supportedProviders: ['sora'],
  buildProviderRequest(request) {
    if (request.transport === 'relay_openai' || request.transport === 'gateway') {
      return buildOpenAiRelayAdapter('sora', request);
    }
    throw createAdapterError(`SoraAdapter 不支持 transport=${request.transport}`, {
      requestId: request?.requestId || null,
      packageId: request?.packageId || null,
    });
  },
};

