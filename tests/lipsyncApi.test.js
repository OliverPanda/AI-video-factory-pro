import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, createLipsyncClip } from '../src/apis/lipsyncApi.js';
import { lipsyncWithMock } from '../src/apis/providers/mockLipsyncApi.js';
import { lipsyncWithFunCineForge } from '../src/apis/providers/funcineforgeLipsyncApi.js';

test('lipsync provider router resolves placeholder providers explicitly', () => {
  const provider = __testables.resolveLipsyncProvider({ provider: 'runway' }, {});
  const handler = __testables.getLipsyncProviderHandler(provider);

  assert.equal(provider, 'runway');
  assert.equal(typeof handler, 'function');
  assert.rejects(
    () => handler({}, 'out.mp4', {}),
    /尚未接入|not implemented/i
  );
});

test('createLipsyncClip dispatches mock provider through the router', async () => {
  const calls = [];
  const result = await createLipsyncClip(
    { shotId: 'shot_001', imagePath: 'in.png', audioPath: 'in.mp3' },
    'tmp-output.mp4',
    {
      provider: 'mock',
      providerHandlers: {
        mock: async (input, outputPath, options) => {
          calls.push({ input, outputPath, options });
          return outputPath;
        },
      },
    }
  );

  assert.equal(result.videoPath, 'tmp-output.mp4');
  assert.equal(result.provider, 'mock');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.shotId, 'shot_001');
});

test('default mock lipsync provider does not write fake mp4 artifacts', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-mock-lipsync-'));

  try {
    const outputPath = path.join(tempRoot, 'shot_001.mp4');
    const providerResult = await lipsyncWithMock(
      { shotId: 'shot_001', imagePath: 'in.png', audioPath: 'in.mp3' },
      outputPath,
      { provider: 'mock' }
    );
    const routedResult = await createLipsyncClip(
      { shotId: 'shot_001', imagePath: 'in.png', audioPath: 'in.mp3' },
      outputPath,
      { provider: 'mock' }
    );

    assert.equal(providerResult, null);
    assert.equal(routedResult.provider, 'mock');
    assert.equal(routedResult.videoPath, null);
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('createLipsyncClip falls back to the next provider when primary provider fails', async () => {
  const result = await createLipsyncClip(
    { shotId: 'shot_fallback', imagePath: 'in.png', audioPath: 'in.mp3' },
    'tmp-fallback-output.mp4',
    {
      provider: 'funcineforge',
      fallbackProviders: ['mock'],
      providerHandlers: {
        funcineforge: async () => {
          const error = new Error('primary provider failed');
          error.provider = 'funcineforge';
          error.category = 'provider_5xx';
          throw error;
        },
        mock: async (_input, outputPath) => outputPath,
      },
    }
  );

  assert.equal(result.provider, 'mock');
  assert.equal(result.videoPath, 'tmp-fallback-output.mp4');
  assert.deepEqual(result.attemptedProviders, ['funcineforge', 'mock']);
  assert.equal(result.fallbackApplied, true);
  assert.equal(result.fallbackFrom, 'funcineforge');
});

test('createLipsyncClip does not fall back on non-retryable 4xx provider errors', async () => {
  await assert.rejects(
    () =>
      createLipsyncClip(
        { shotId: 'shot_no_fallback', imagePath: 'in.png', audioPath: 'in.mp3' },
        'tmp-no-fallback.mp4',
        {
          provider: 'funcineforge',
          fallbackProviders: ['mock'],
          providerHandlers: {
            funcineforge: async () => {
              const error = new Error('invalid request');
              error.provider = 'funcineforge';
              error.category = 'provider_4xx';
              error.code = 'FUNCINEFORGE_HTTP_ERROR';
              throw error;
            },
            mock: async () => {
              throw new Error('should not be called');
            },
          },
        }
      ),
    (error) => {
      assert.deepEqual(error.attemptedProviders, ['funcineforge']);
      assert.equal(error.providerErrors.length, 1);
      assert.equal(error.providerErrors[0].category, 'provider_4xx');
      return true;
    }
  );
});

test('createLipsyncClip exposes provider chain errors after all fallbacks fail', async () => {
  await assert.rejects(
    () =>
      createLipsyncClip(
        { shotId: 'shot_chain_fail', imagePath: 'in.png', audioPath: 'in.mp3' },
        'tmp-chain-fail.mp4',
        {
          provider: 'funcineforge',
          fallbackProviders: ['runway'],
          providerHandlers: {
            funcineforge: async () => {
              const error = new Error('funcineforge failed');
              error.provider = 'funcineforge';
              error.code = 'FUNCINEFORGE_HTTP_ERROR';
              error.category = 'provider_5xx';
              throw error;
            },
            runway: async () => {
              throw new Error('runway failed');
            },
          },
        }
      ),
    (error) => {
      assert.deepEqual(error.attemptedProviders, ['funcineforge', 'runway']);
      assert.equal(Array.isArray(error.providerErrors), true);
      assert.equal(error.providerErrors.length, 2);
      assert.equal(error.providerErrors[0].provider, 'funcineforge');
      assert.equal(error.providerErrors[1].provider, 'runway');
      return true;
    }
  );
});

test('Fun-CineForge request builder uses configured endpoint and payload shape', () => {
  const request = __testables.buildFunCineForgeRequest(
    {
      shotId: 'shot_001',
      imagePath: 'images/shot_001.png',
      audioPath: 'audio/shot_001.mp3',
      speaker: '沈清',
    },
    'lipsync/shot_001.mp4',
    {
      baseUrl: 'http://127.0.0.1:7860/',
      apiKey: 'demo-key',
    },
    {}
  );

  assert.equal(request.url, 'http://127.0.0.1:7860/v1/lipsync');
  assert.equal(request.headers.authorization, 'Bearer demo-key');
  const body = JSON.parse(request.body);
  assert.equal(body.shot_id, 'shot_001');
  assert.equal(body.image_path, 'images/shot_001.png');
  assert.equal(body.audio_path, 'audio/shot_001.mp3');
  assert.equal(body.output_path, 'lipsync/shot_001.mp4');
});

test('Fun-CineForge provider returns output path from JSON response', async () => {
  const calls = [];
  const result = await lipsyncWithFunCineForge(
    {
      shotId: 'shot_002',
      imagePath: 'images/shot_002.png',
      audioPath: 'audio/shot_002.mp3',
    },
    'lipsync/shot_002.mp4',
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          json: async () => ({ output_path: 'generated/shot_002.mp4' }),
        };
      },
    }
  );

  assert.equal(result, 'generated/shot_002.mp4');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
});

test('Fun-CineForge provider classifies timeout as retryable error', async () => {
  await assert.rejects(
    () =>
      lipsyncWithFunCineForge(
        {
          shotId: 'shot_timeout',
          imagePath: 'images/shot_timeout.png',
          audioPath: 'audio/shot_timeout.mp3',
        },
        'lipsync/shot_timeout.mp4',
        {
          timeoutMs: 10,
          maxRetries: 0,
          fetchImpl: () => new Promise(() => {}),
        }
      ),
    (error) => {
      assert.equal(error.provider, 'funcineforge');
      assert.equal(error.code, 'FUNCINEFORGE_TIMEOUT');
      assert.equal(error.category, 'timeout');
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test('Fun-CineForge provider surfaces non-OK response with status metadata', async () => {
  await assert.rejects(
    () =>
      lipsyncWithFunCineForge(
        {
          shotId: 'shot_http',
          imagePath: 'images/shot_http.png',
          audioPath: 'audio/shot_http.mp3',
        },
        'lipsync/shot_http.mp4',
        {
          maxRetries: 0,
          fetchImpl: async () => ({
            ok: false,
            status: 422,
            text: async () => 'validation failed',
          }),
        }
      ),
    (error) => {
      assert.equal(error.provider, 'funcineforge');
      assert.equal(error.code, 'FUNCINEFORGE_HTTP_ERROR');
      assert.equal(error.category, 'provider_4xx');
      assert.equal(error.statusCode, 422);
      assert.equal(error.retryable, false);
      assert.match(error.message, /422/);
      return true;
    }
  );
});

test('Fun-CineForge provider retries retryable 5xx response and eventually succeeds', async () => {
  let attempts = 0;
  const result = await lipsyncWithFunCineForge(
    {
      shotId: 'shot_retry',
      imagePath: 'images/shot_retry.png',
      audioPath: 'audio/shot_retry.mp3',
    },
    'lipsync/shot_retry.mp4',
    {
      maxRetries: 1,
      retryDelayMs: 0,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            ok: false,
            status: 503,
            text: async () => 'temporary unavailable',
          };
        }

        return {
          ok: true,
          json: async () => ({ video_path: 'generated/shot_retry.mp4' }),
        };
      },
    }
  );

  assert.equal(attempts, 2);
  assert.equal(result, 'generated/shot_retry.mp4');
});
