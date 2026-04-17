import test from 'node:test';
import assert from 'node:assert/strict';

import { createUnifiedImageProviderClient } from '../src/apis/unifiedImageProviderClient.js';
import {
  __testables as imageApiTestables,
  generateImage,
  resolveImageRoute,
} from '../src/apis/imageApi.js';

test('unified image client defaults laozhang/openai_compat provider mapping', async () => {
  const calls = [];
  const client = createUnifiedImageProviderClient({
    transports: {
      openai_compat: {
        async generate(request) {
          calls.push(request.route.model);
          return request.outputPath;
        },
      },
    },
  });

  const result = await client.generate({
    prompt: 'hello',
    negativePrompt: '',
    outputPath: '/tmp/result.png',
    route: { model: 'flux-kontext-pro' },
  }, { provider: 'laozhang' });

  assert.equal(result.provider, 'openai_compat');
  assert.equal(result.outputPath, '/tmp/result.png');
  assert.deepEqual(calls, ['flux-kontext-pro']);
});

test('generateImage can route through injected vercel transport without changing taskType model routing', async () => {
  const calls = [];
  const savedPath = await generateImage('prompt', 'negative', '/tmp/vercel.png', {
    style: 'realistic',
    env: {
      PRIMARY_API_PROVIDER: 'openai_compat',
      IMAGE_TRANSPORT_PROVIDER: 'vercel_ai_gateway',
      REALISTIC_IMAGE_MODEL: 'openai/gpt-image-1',
    },
    transports: {
      vercel_ai_gateway: {
        async generate(request) {
          calls.push({
            transportProvider: request.transportProvider,
            model: request.route.model,
            outputPath: request.outputPath,
          });
          return request.outputPath;
        },
      },
    },
  });

  assert.equal(savedPath, '/tmp/vercel.png');
  assert.deepEqual(calls, [{
    transportProvider: 'vercel_ai_gateway',
    model: 'openai/gpt-image-1',
    outputPath: '/tmp/vercel.png',
  }]);
});

test('resolveImageRoute remains model-focused while transport provider is resolved separately', () => {
  const route = resolveImageRoute('realistic_image', {
    PRIMARY_API_PROVIDER: 'openai_compat',
    REALISTIC_IMAGE_MODEL: 'openai/gpt-image-1',
  });

  assert.deepEqual(route, {
    provider: 'openai_compat',
    model: 'openai/gpt-image-1',
  });
  assert.equal(imageApiTestables.resolveImageTransportProvider({
    IMAGE_TRANSPORT_PROVIDER: 'vercel_ai_gateway',
  }), 'vercel_ai_gateway');
});
