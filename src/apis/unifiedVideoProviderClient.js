import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

import { createVideoGenerationResult, createVideoGenerationRequest, normalizeVideoProvider, resolveVideoPackageId, resolveVideoPackageType, summarizeReferenceBindings } from './videoGenerationContract.js';
import { resolveVideoGenerationConfig } from './videoGenerationConfig.js';
import { createVideoRequestRouter } from './videoRequestRouter.js';

function normalizeRequestPrompt(videoPackage = {}) {
  if (Array.isArray(videoPackage.seedancePromptBlocks) && videoPackage.seedancePromptBlocks.length > 0) {
    return videoPackage.seedancePromptBlocks
      .map((block) => String(block?.text || '').trim())
      .filter(Boolean)
      .join('. ');
  }

  if (Array.isArray(videoPackage.promptDirectives) && videoPackage.promptDirectives.length > 0) {
    return videoPackage.promptDirectives.map((item) => String(item || '').trim()).filter(Boolean).join('. ');
  }

  return [
    videoPackage.visualGoal,
    videoPackage.sequenceContextSummary,
    videoPackage.providerRequestHints?.sequenceGoal,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('. ');
}

function buildRequestMetadata(videoPackage = {}, resolvedConfig = {}) {
  return {
    requestedProvider: normalizeVideoProvider(videoPackage.provider || videoPackage.preferredProvider),
    requestedTransport: videoPackage.transport || null,
    packageType: resolvedConfig.packageType,
    packageId: resolvedConfig.packageId,
    referenceBindingSummary: summarizeReferenceBindings({
      referenceImages: videoPackage.referenceImages || [],
      referenceVideos: videoPackage.referenceVideos || [],
    }),
  };
}

function buildRequestDigest(requestBody = {}) {
  return createHash('sha1').update(JSON.stringify(requestBody)).digest('hex');
}

function createRegistryEntry({
  request,
  route,
  adapterResult,
  outputPath,
  submitResult,
}) {
  return {
    request,
    route,
    adapterResult,
    outputPath,
    submitResult,
    taskId: submitResult?.taskId || `task_${randomUUID()}`,
  };
}

function toContext(entry, override = {}) {
  return {
    request: entry.request,
    route: entry.route,
    baseUrl: override.baseUrl || entry.request.params?.baseUrl || null,
    apiKey: override.apiKey || entry.request.params?.apiKey || null,
    submitPath: override.submitPath || entry.request.params?.submitPath || null,
    pollPath: override.pollPath || entry.request.params?.pollPath || null,
    downloadPath: override.downloadPath || entry.request.params?.downloadPath || null,
    taskId: override.taskId || entry.taskId,
    providerRequest: entry.adapterResult.requestSummary?.providerRequest || null,
    providerMetadata: {
      ...(entry.adapterResult.requestSummary?.providerMetadata || {}),
      requestId: entry.request.requestId,
      resolvedAdapter: entry.route.adapter.name,
      resolvedTransport: entry.route.transport.name,
      requestBodyDigest: buildRequestDigest(entry.adapterResult.requestBody),
    },
    durationTargetSec: entry.request.durationSec,
  };
}

function selectInjectedHandlerBundle(options = {}, resolvedConfig = {}) {
  if (resolvedConfig.transport === 'gateway' && options.vercelHandlers) {
    return {
      kind: 'vercel',
      handlers: options.vercelHandlers,
      adapterName: 'InjectedVercelVideoAdapter',
      transportName: 'InjectedVercelVideoTransport',
    };
  }

  if (resolvedConfig.provider === 'sora' && options.fallbackHandlers) {
    return {
      kind: 'fallback',
      handlers: options.fallbackHandlers,
      adapterName: 'InjectedFallbackVideoAdapter',
      transportName: 'InjectedFallbackVideoTransport',
    };
  }

  if (resolvedConfig.provider === 'seedance' && options.seedanceHandlers) {
    return {
      kind: 'seedance',
      handlers: options.seedanceHandlers,
      adapterName: 'InjectedSeedanceVideoAdapter',
      transportName: 'InjectedSeedanceVideoTransport',
    };
  }

  return null;
}

function createInjectedRoute(bundle) {
  return {
    adapter: { name: bundle.adapterName },
    transport: { name: bundle.transportName },
    resolvedProvider: null,
    resolvedTransport: null,
  };
}

export function createUnifiedVideoProviderClient(options = {}) {
  const router = options.router || createVideoRequestRouter(options.routerOptions);
  const taskRegistry = new Map();
  const outputRegistry = new Map();

  return {
    async submit(videoPackage, outputPath = null, submitOptions = {}) {
      const env = submitOptions.env || process.env;
      const resolvedConfig = resolveVideoGenerationConfig(videoPackage, submitOptions, env);
      const request = createVideoGenerationRequest({
        packageType: resolvedConfig.packageType,
        packageId: resolvedConfig.packageId,
        provider: resolvedConfig.provider,
        model: resolvedConfig.model,
        transport: resolvedConfig.transport,
        prompt: normalizeRequestPrompt(videoPackage),
        referenceImages: Array.isArray(videoPackage.referenceImages) ? videoPackage.referenceImages : [],
        referenceVideos: Array.isArray(videoPackage.referenceVideos) ? videoPackage.referenceVideos : [],
        durationSec: videoPackage.durationTargetSec,
        ratio: videoPackage.cameraSpec?.ratio || null,
        outputPath: outputPath || videoPackage.outputPath || path.join(process.cwd(), `${resolvedConfig.packageId}.mp4`),
        params: {
          baseUrl: resolvedConfig.baseUrl,
          apiKey: resolvedConfig.apiKey,
          protocol: resolvedConfig.protocol,
          submitPath: resolvedConfig.submitPath,
          pollPath: resolvedConfig.pollPath,
          downloadPath: resolvedConfig.downloadPath,
        },
        metadata: buildRequestMetadata(videoPackage, resolvedConfig),
      });
      const injectedHandlerBundle = selectInjectedHandlerBundle(options, resolvedConfig);
      const route = injectedHandlerBundle ? createInjectedRoute(injectedHandlerBundle) : router.resolve(request);
      const adapterResult = injectedHandlerBundle
        ? {
            requestBody: videoPackage,
            requestSummary: {
              providerRequest: videoPackage,
              providerMetadata: {
                injectedHandler: injectedHandlerBundle.kind,
              },
            },
          }
        : route.adapter.buildProviderRequest(request);
      const submitResult = injectedHandlerBundle
        ? await injectedHandlerBundle.handlers.submitVideoGeneration(videoPackage, {
            request,
            outputPath: request.outputPath,
            submitOptions,
          })
        : await route.transport.submit(adapterResult.requestBody, {
            request,
            baseUrl: resolvedConfig.baseUrl,
            apiKey: resolvedConfig.apiKey,
            submitPath: resolvedConfig.submitPath,
            protocol: resolvedConfig.protocol,
          });
      const entry = createRegistryEntry({
        request,
        route,
        adapterResult,
        outputPath: request.outputPath,
        submitResult,
      });
      taskRegistry.set(entry.taskId, entry);
      if (submitResult?.outputUrl) {
        outputRegistry.set(submitResult.outputUrl, entry);
      }
      return {
        requestId: request.requestId,
        taskId: entry.taskId,
        provider: submitResult?.provider || request.provider,
        model: submitResult?.model || request.model,
        transport: request.transport,
        outputUrl: submitResult?.outputUrl || null,
        packageType: request.packageType,
        packageId: request.packageId,
        providerRequest: adapterResult.requestSummary?.providerRequest || null,
        providerMetadata: {
          ...(adapterResult.requestSummary?.providerMetadata || {}),
          resolvedAdapter: route.adapter.name,
          resolvedTransport: route.transport.name,
          requestBodyDigest: buildRequestDigest(adapterResult.requestBody),
          requestedProvider: request.metadata?.requestedProvider || request.provider,
          referenceBindingSummary: request.metadata?.referenceBindingSummary || summarizeReferenceBindings(request),
        },
      };
    },
    async poll(taskId, ...rest) {
      const entry = taskRegistry.get(taskId);
      if (!entry) {
        throw new Error(`Unknown unified video task: ${taskId}`);
      }
      const injectedHandlerKind = entry.adapterResult.requestSummary?.providerMetadata?.injectedHandler || null;
      const result = injectedHandlerKind
        ? await options[`${injectedHandlerKind}Handlers`].pollVideoGeneration(taskId, toContext(entry, { taskId }))
        : await entry.route.transport.poll(taskId, toContext(entry, { taskId }));
      if (result?.outputUrl) {
        outputRegistry.set(result.outputUrl, entry);
      }
      return {
        ...result,
        taskId,
        requestId: entry.request.requestId,
      };
    },
    async download(outputUrl, outputPath, _videoPackage, pollResult) {
      const entry =
        (pollResult?.taskId ? taskRegistry.get(pollResult.taskId) : null) ||
        (outputUrl ? outputRegistry.get(outputUrl) : null);
      if (!entry) {
        throw new Error(`Unknown unified video output: ${outputUrl || pollResult?.taskId || 'unknown'}`);
      }
      const injectedHandlerKind = entry.adapterResult.requestSummary?.providerMetadata?.injectedHandler || null;
      if (injectedHandlerKind) {
        await options[`${injectedHandlerKind}Handlers`].downloadVideoGeneration(
          outputUrl,
          outputPath,
          toContext(entry, {
            taskId: pollResult?.taskId || entry.taskId,
          })
        );
      } else {
        await entry.route.transport.download(outputUrl, outputPath, toContext(entry, {
          taskId: pollResult?.taskId || entry.taskId,
        }));
      }
      return createVideoGenerationResult({
        request: entry.request,
        status: 'completed',
        videoPath: outputPath,
        outputUrl,
        taskId: pollResult?.taskId || entry.taskId,
        providerRequest: entry.adapterResult.requestSummary?.providerRequest || null,
        providerResponse: pollResult?.providerResponse || entry.submitResult?.providerResponse || null,
        extra: {
          providerMetadata: {
            ...(entry.adapterResult.requestSummary?.providerMetadata || {}),
            resolvedAdapter: entry.route.adapter.name,
            resolvedTransport: entry.route.transport.name,
            requestBodyDigest: buildRequestDigest(entry.adapterResult.requestBody),
            requestedProvider: entry.request.metadata?.requestedProvider || entry.request.provider,
          },
        },
      });
    },
  };
}

export const __testables = {
  buildRequestDigest,
  normalizeRequestPrompt,
};
