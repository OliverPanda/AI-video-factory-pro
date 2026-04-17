import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createFallbackVideoClip } from './fallbackVideoApi.js';
import {
  createSeedanceBridgeClip,
  createSeedanceMultiShotClip,
  createSeedanceVideoClip,
} from './seedanceVideoApi.js';

function normalizeProvider(provider) {
  if (provider === 'fallback_video' || provider === 'runway') {
    return 'sora2';
  }
  if (provider === 'vercel' || provider === 'vercel_ai_gateway') {
    return 'vercel_ai_gateway';
  }
  return provider || 'seedance';
}

function resolveTransportProvider(videoPackage = {}, runtimeOptions = {}) {
  const env = runtimeOptions.env || process.env;
  const rawProvider =
    runtimeOptions.transportProvider ||
    videoPackage.transportProvider ||
    env.VIDEO_TRANSPORT_PROVIDER ||
    videoPackage.preferredProvider;
  return normalizeProvider(rawProvider);
}

function resolvePackageType(videoPackage = {}) {
  if (videoPackage.packageType) {
    return videoPackage.packageType;
  }
  if (videoPackage.sequenceId) {
    return 'sequence';
  }
  if (videoPackage.bridgeId) {
    return 'bridge';
  }
  return 'shot';
}

function resolvePackageId(videoPackage = {}, packageType = resolvePackageType(videoPackage)) {
  if (packageType === 'sequence') {
    return videoPackage.sequenceId || null;
  }
  if (packageType === 'bridge') {
    return videoPackage.bridgeId || null;
  }
  return videoPackage.shotId || null;
}

function buildTempOutputPath(videoPackage = {}) {
  const packageType = resolvePackageType(videoPackage);
  const packageId = resolvePackageId(videoPackage, packageType) || randomUUID();
  return path.join(os.tmpdir(), `aivf-unified-${packageType}-${packageId}.mp4`);
}

function copyIfNeeded(sourcePath, outputPath) {
  if (!sourcePath || !outputPath || sourcePath === outputPath) {
    return;
  }
  fs.copyFileSync(sourcePath, outputPath);
}

function createImmediateHandler(runGeneration) {
  const taskRegistry = new Map();
  const outputRegistry = new Map();

  return {
    async submitVideoGeneration(videoPackage, options = {}) {
      const outputPath = options.outputPath || buildTempOutputPath(videoPackage);
      const run = await runGeneration(videoPackage, outputPath, options);
      const taskId = run?.taskId || `task_${randomUUID()}`;
      const outputUrl = run?.outputUrl || run?.videoPath || outputPath;
      const taskEntry = {
        run,
        outputPath,
        outputUrl,
      };
      taskRegistry.set(taskId, taskEntry);
      if (outputUrl) {
        outputRegistry.set(outputUrl, taskEntry);
      }
      return {
        taskId,
        provider: run?.provider || normalizeProvider(videoPackage?.preferredProvider),
        model: run?.model || null,
        outputUrl,
      };
    },
    async pollVideoGeneration(taskId) {
      const taskEntry = taskRegistry.get(taskId);
      if (!taskEntry) {
        throw new Error(`Unknown unified video task: ${taskId}`);
      }
      return {
        status: 'COMPLETED',
        outputUrl: taskEntry.outputUrl,
        actualDurationSec: taskEntry.run?.actualDurationSec || null,
      };
    },
    async downloadVideoGeneration(outputUrl, outputPath) {
      const taskEntry = outputRegistry.get(outputUrl);
      if (!taskEntry) {
        throw new Error(`Unknown unified video output: ${outputUrl}`);
      }
      copyIfNeeded(taskEntry.run?.videoPath || taskEntry.outputPath, outputPath);
      return { outputPath };
    },
  };
}

function createDefaultSeedanceHandlers() {
  return createImmediateHandler((videoPackage, outputPath, options) => {
    const packageType = resolvePackageType(videoPackage);
    if (packageType === 'sequence') {
      return createSeedanceMultiShotClip(videoPackage, outputPath, options);
    }
    if (packageType === 'bridge') {
      return createSeedanceBridgeClip(videoPackage, outputPath, options);
    }
    return createSeedanceVideoClip(videoPackage, outputPath, options);
  });
}

function createDefaultFallbackHandlers() {
  return createImmediateHandler((videoPackage, outputPath, options) =>
    createFallbackVideoClip(videoPackage, outputPath, options)
  );
}

export function createUnifiedVideoProviderClient(options = {}) {
  const seedanceHandlers = options.seedanceHandlers || createDefaultSeedanceHandlers();
  const fallbackHandlers = options.fallbackHandlers || createDefaultFallbackHandlers();
  const vercelHandlers = options.vercelHandlers || null;
  const taskRegistry = new Map();

  function selectHandlers(videoPackage = {}, runtimeOptions = {}) {
    const provider = resolveTransportProvider(videoPackage, runtimeOptions);
    if (provider === 'vercel_ai_gateway') {
      return {
        provider,
        handlers: vercelHandlers || seedanceHandlers,
      };
    }
    return {
      provider,
      handlers: provider === 'seedance' ? seedanceHandlers : fallbackHandlers,
    };
  }

  return {
    async submit(videoPackage, outputPath = null, submitOptions = {}) {
      const packageType = resolvePackageType(videoPackage);
      const packageId = resolvePackageId(videoPackage, packageType);
      const { provider, handlers } = selectHandlers(videoPackage, submitOptions);
      const submitResult = await handlers.submitVideoGeneration(videoPackage, {
        ...submitOptions,
        outputPath,
      });
      const taskId = submitResult?.taskId || `task_${randomUUID()}`;
      taskRegistry.set(taskId, { handlers, provider });
      return {
        ...submitResult,
        taskId,
        provider: submitResult?.provider || provider,
        packageType,
        packageId,
      };
    },
    async poll(taskId, ...rest) {
      const taskEntry = taskRegistry.get(taskId);
      if (!taskEntry) {
        throw new Error(`Unknown unified video task: ${taskId}`);
      }
      return taskEntry.handlers.pollVideoGeneration(taskId, ...rest);
    },
    async download(outputUrl, outputPath, ...rest) {
      const providerHint = rest[0] ? resolveTransportProvider(rest[0], rest[2] || {}) : null;
      const handlers =
        providerHint === 'seedance'
          ? seedanceHandlers
          : providerHint === 'vercel_ai_gateway'
            ? (vercelHandlers || seedanceHandlers)
            : providerHint === 'sora2'
              ? fallbackHandlers
              : null;

      if (handlers?.downloadVideoGeneration) {
        return handlers.downloadVideoGeneration(outputUrl, outputPath, ...rest);
      }

      if (seedanceHandlers.downloadVideoGeneration) {
        try {
          return await seedanceHandlers.downloadVideoGeneration(outputUrl, outputPath, ...rest);
        } catch {
          // Try fallback handler next.
        }
      }

      if (vercelHandlers?.downloadVideoGeneration) {
        try {
          return await vercelHandlers.downloadVideoGeneration(outputUrl, outputPath, ...rest);
        } catch {
          // Try fallback handler next.
        }
      }

      return fallbackHandlers.downloadVideoGeneration(outputUrl, outputPath, ...rest);
    },
  };
}

export const __testables = {
  normalizeProvider,
  resolveTransportProvider,
  resolvePackageId,
  resolvePackageType,
};
