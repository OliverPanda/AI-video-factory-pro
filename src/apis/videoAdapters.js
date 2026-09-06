import fs from 'node:fs';

import { normalizeVideoProviderError, normalizeVideoProviderRequest } from './videoProviderProtocol.js';
import { ensureEnglishPrompt } from '../utils/translatePrompt.js';
import { resolveSingleReferenceAsset, selectSoraReferenceImages } from '../utils/referenceImageAsset.js';
import { normalizeMediaTaskDuration } from '../utils/normalization.js';

function ensurePrompt(request) {
  return String(request?.prompt || '').trim();
}

async function resolveReferenceAsset(request, outputMode = 'path') {
  const selectedReferenceImages =
    request?.provider === 'sora'
      ? selectSoraReferenceImages(request?.referenceImages || [])
      : (Array.isArray(request?.referenceImages) ? request.referenceImages : []);
  return resolveSingleReferenceAsset(selectedReferenceImages, {
    tempDir: request?.params?.tempDir,
    preferDataUrl: outputMode === 'data_url',
    forceComposite: selectedReferenceImages.length > 1,
  });
}

function resolveReferenceUrl(referenceImage) {
  const candidates = [
    referenceImage?.url,
    referenceImage?.publicUrl,
    referenceImage?.remoteUrl,
    referenceImage?.sourceUrl,
    referenceImage?.path,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      return normalized;
    }
  }
  return null;
}

async function encodeReferenceImageToDataUrl(imagePath) {
  return `data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`;
}

function inferOrientation(request) {
  return String(request?.ratio || '9:16').trim() === '16:9' ? 'landscape' : 'portrait';
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

async function buildRelayOpenAiRequest(request) {
  const prompt = await ensureEnglishPrompt(ensurePrompt(request));
  const referenceAsset = await resolveReferenceAsset(request, 'path');
  const imagePath = referenceAsset?.path || null;
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

async function buildRelaySeedanceV2Request(request) {
  const prompt = await ensureEnglishPrompt(ensurePrompt(request));
  const referenceAsset = await resolveReferenceAsset(request, 'path');
  const imagePath = referenceAsset?.path || null;
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

async function buildRelayMediaTaskRequest(request) {
  const prompt = await ensureEnglishPrompt(ensurePrompt(request));
  const selectedReferenceImages = selectSoraReferenceImages(request?.referenceImages || []);
  const referenceAsset = await resolveReferenceAsset(request, 'data_url');
  const firstReferenceImage = selectedReferenceImages[0] || null;
  const referenceUrl = referenceAsset?.url || referenceAsset?.dataUrl || resolveReferenceUrl(firstReferenceImage);

  return {
    model: request.model,
    prompt,
    params: {
      duration: normalizeMediaTaskDuration(request.durationSec),
      orientation: inferOrientation(request),
      ...(referenceUrl ? { input_reference: referenceUrl } : {}),
    },
  };
}

async function buildDashScopeHappyHorseRequest(request) {
  const prompt = await ensureEnglishPrompt(ensurePrompt(request));
  const referenceImages = Array.isArray(request.referenceImages) ? request.referenceImages.slice(0, 9) : [];
  const providerParams = request.params?.providerParams || {};
  if (!prompt || referenceImages.length === 0) {
    throw createAdapterError('happyhorse 需要 prompt 和至少一张 reference image', {
      requestId: request?.requestId || null,
      packageId: request?.packageId || null,
    });
  }

  const media = [];
  for (const referenceImage of referenceImages) {
    const resolvedUrl = resolveReferenceUrl(referenceImage);
    const localPath =
      providerParams.allowDataUrlReferences && referenceImage?.path && fs.existsSync(referenceImage.path)
        ? referenceImage.path
        : null;
    const url = resolvedUrl || (localPath ? await encodeReferenceImageToDataUrl(localPath) : null);
    if (url) {
      media.push({
        type: 'reference_image',
        url,
      });
    }
  }

  if (media.length === 0) {
    throw createAdapterError('happyhorse reference image 需要可访问的 HTTP/HTTPS URL', {
      requestId: request?.requestId || null,
      packageId: request?.packageId || null,
      allowDataUrlReferences: Boolean(providerParams.allowDataUrlReferences),
    });
  }

  return {
    model: request.model,
    input: {
      prompt,
      media,
    },
    parameters: {
      resolution: providerParams.resolution || '720P',
      ratio: request.ratio || providerParams.ratio || '9:16',
      duration: Number.isFinite(Number(request.durationSec))
        ? Math.min(Math.max(Math.round(Number(request.durationSec)), 3), 15)
        : 5,
      watermark: providerParams.watermark === true,
      ...(Number.isInteger(providerParams.seed) ? { seed: providerParams.seed } : {}),
    },
  };
}

export const seedanceAdapter = {
  name: 'SeedanceAdapter',
  supportedProviders: ['seedance'],
  async buildProviderRequest(request) {
    if (request.transport === 'official') {
      const prompt = await ensureEnglishPrompt(ensurePrompt(request));
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
      const requestBody = await buildRelayOpenAiRequest(request);
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
      const requestBody = await buildRelaySeedanceV2Request(request);
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

async function buildOpenAiRelayAdapter(provider, request) {
  const requestBody = await buildRelayOpenAiRequest(request);
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
  async buildProviderRequest(request) {
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
  async buildProviderRequest(request) {
    if (request.transport === 'relay_media_task') {
      const requestBody = await buildRelayMediaTaskRequest(request);
      return {
        requestBody,
        requestSummary: normalizeVideoProviderRequest({
          provider: 'sora',
          request: requestBody,
          metadata: {
            resolvedAdapter: 'SoraAdapter',
            transport: request.transport,
            protocol: 'media_task',
          },
        }),
      };
    }
    if (request.transport === 'relay_openai' || request.transport === 'gateway') {
      return buildOpenAiRelayAdapter('sora', request);
    }
    throw createAdapterError(`SoraAdapter 不支持 transport=${request.transport}`, {
      requestId: request?.requestId || null,
      packageId: request?.packageId || null,
    });
  },
};

export const happyHorseAdapter = {
  name: 'HappyHorseAdapter',
  supportedProviders: ['happyhorse'],
  async buildProviderRequest(request) {
    if (request.transport === 'dashscope_async') {
      const requestBody = await buildDashScopeHappyHorseRequest(request);
      return {
        requestBody,
        requestSummary: normalizeVideoProviderRequest({
          provider: 'happyhorse',
          request: requestBody,
          metadata: {
            resolvedAdapter: 'HappyHorseAdapter',
            transport: request.transport,
            protocol: 'dashscope_async',
          },
        }),
      };
    }
    throw createAdapterError(`HappyHorseAdapter 不支持 transport=${request.transport}`, {
      requestId: request?.requestId || null,
      packageId: request?.packageId || null,
    });
  },
};

export const __testables = {
  buildDashScopeHappyHorseRequest,
};

