import 'dotenv/config';
import path from 'node:path';

import logger from '../utils/logger.js';
import { buildFunCineForgeRequest, lipsyncWithFunCineForge } from './providers/funcineforgeLipsyncApi.js';
import { lipsyncWithMock } from './providers/mockLipsyncApi.js';
import { createLipsyncPlaceholderProvider } from './providers/placeholderLipsyncApi.js';

const DEFAULT_PROVIDER_HANDLERS = {
  mock: lipsyncWithMock,
  funcineforge: lipsyncWithFunCineForge,
  'env-default': lipsyncWithMock,
  runway: createLipsyncPlaceholderProvider('runway'),
};

export function resolveLipsyncProvider(options = {}, env = process.env) {
  return options.provider || env.LIPSYNC_PROVIDER || 'mock';
}

export function resolveLipsyncFallbackProviders(options = {}, env = process.env) {
  if (Array.isArray(options.fallbackProviders)) {
    return options.fallbackProviders.filter(Boolean);
  }

  if (typeof options.fallbackProviders === 'string') {
    return options.fallbackProviders
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return String(env.LIPSYNC_FALLBACK_PROVIDERS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function resolveLipsyncProviderChain(options = {}, env = process.env) {
  return Array.from(
    new Set([
      resolveLipsyncProvider(options, env),
      ...resolveLipsyncFallbackProviders(options, env),
    ].filter(Boolean))
  );
}

export function shouldFallbackToNextProvider(error) {
  const category = String(error?.category || '').trim().toLowerCase();
  if (category) {
    return ['timeout', 'network_error', 'provider_5xx'].includes(category);
  }

  const code = String(error?.code || '').trim().toUpperCase();
  return code.includes('TIMEOUT') || code.includes('NETWORK');
}

export function getLipsyncProviderHandler(provider, providerHandlers = DEFAULT_PROVIDER_HANDLERS) {
  const handler = providerHandlers[provider];
  if (!handler) {
    throw new Error(`未知 Lip-sync Provider：${provider}`);
  }
  return handler;
}

export async function createLipsyncClip(input, outputPath, options = {}) {
  if (!outputPath || typeof outputPath !== 'string') {
    throw new Error('lip-sync 输出路径无效');
  }

  const providerChain = resolveLipsyncProviderChain(options);
  const providerHandlers = {
    ...DEFAULT_PROVIDER_HANDLERS,
    ...(options.providerHandlers || {}),
  };
  const attemptedProviders = [];
  const errors = [];

  for (const provider of providerChain) {
    const handler = getLipsyncProviderHandler(provider, providerHandlers);
    try {
      logger.info('LipSync', `生成口型片段 [${provider}]：${path.basename(outputPath)}`);
      const videoPath = await handler(input, outputPath, {
        ...options,
        provider,
      });
      return {
        provider,
        videoPath,
        attemptedProviders: [...attemptedProviders, provider],
        fallbackApplied: provider !== providerChain[0],
        fallbackFrom: provider !== providerChain[0] ? providerChain[0] : null,
      };
    } catch (error) {
      attemptedProviders.push(provider);
      errors.push({
        provider,
        message: error?.message || 'unknown error',
        code: error?.code || null,
        category: error?.category || null,
      });

      if (provider !== providerChain[providerChain.length - 1] && shouldFallbackToNextProvider(error)) {
        logger.warn('LipSync', `口型 provider ${provider} 失败，切换下一个 fallback：${error.message}`);
        continue;
      }

      error.attemptedProviders = attemptedProviders;
      error.providerErrors = errors;
      throw error;
    }
  }

  throw new Error('lip-sync provider chain 执行失败');
}

export const __testables = {
  resolveLipsyncProvider,
  resolveLipsyncFallbackProviders,
  resolveLipsyncProviderChain,
  shouldFallbackToNextProvider,
  getLipsyncProviderHandler,
  buildFunCineForgeRequest,
};
