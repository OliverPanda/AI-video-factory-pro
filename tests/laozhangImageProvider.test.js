import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables, getImageApiBaseUrl, laozhangImageProvider } from '../src/apis/imageProviders/laozhangImageProvider.js';

test('getImageApiBaseUrl trims trailing slashes', () => {
  assert.equal(
    getImageApiBaseUrl({ IMAGE_API_BASE_URL: 'https://api.apilio.ai/v1/' }),
    'https://api.apilio.ai/v1'
  );
  assert.equal(
    getImageApiBaseUrl({ IMAGE_API_BASE_URL: 'https://api.apilio.ai/v1//' }),
    'https://api.apilio.ai/v1'
  );
});

test('laozhangImageProvider wraps generation auth failures with provider context', async () => {
  const originalPost = laozhangImageProvider.generate;
  void originalPost;

  const axios = await import('axios');
  const originalAxiosPost = axios.default.post;

  axios.default.post = async () => {
    const error = new Error('Request failed with status code 403');
    error.response = {
      status: 403,
      data: { error: { message: 'model forbidden' } },
    };
    throw error;
  };

  try {
    await assert.rejects(
      laozhangImageProvider.generate({
        prompt: 'demo prompt',
        negativePrompt: '',
        outputPath: 'temp/demo.png',
        route: { model: 'gpt-image-2' },
        env: {
          IMAGE_API_KEY: 'demo-key',
          IMAGE_API_BASE_URL: 'https://image.example/v1',
          IMAGE_REFERENCE_MODE: 'prompt_only',
        },
      }),
      (error) => {
        assert.match(error.message, /provider=https:\/\/image\.example\/v1/);
        assert.match(error.message, /endpoint=\/images\/generations/);
        assert.match(error.message, /model=gpt-image-2/);
        assert.match(error.message, /status=403/);
        return true;
      },
    );
  } finally {
    axios.default.post = originalAxiosPost;
  }
});

test('laozhangImageProvider honors request timeout override for generation calls', async () => {
  const axios = await import('axios');
  const originalAxiosPost = axios.default.post;
  const seenTimeouts = [];

  axios.default.post = async (_url, _body, config) => {
    seenTimeouts.push(config.timeout);
    return {
      data: {
        data: [{ b64_json: Buffer.from('fake-image').toString('base64') }],
      },
    };
  };

  try {
    await laozhangImageProvider.generate({
      prompt: 'demo prompt',
      negativePrompt: '',
      outputPath: 'temp/demo-timeout.png',
      route: { model: 'gpt-image-2' },
      timeoutMs: 345678,
      env: {
        IMAGE_API_KEY: 'demo-key',
        IMAGE_API_BASE_URL: 'https://image.example/v1',
        IMAGE_REFERENCE_MODE: 'prompt_only',
      },
    });
  } finally {
    axios.default.post = originalAxiosPost;
  }

  assert.deepEqual(seenTimeouts, [345678]);
});

test('resolveRequestTimeoutMs prefers request override over env timeout', () => {
  assert.equal(
    __testables.resolveRequestTimeoutMs(
      { timeoutMs: 345678 },
      { IMAGE_REQUEST_TIMEOUT_MS: '120000' }
    ),
    345678
  );
  assert.equal(
    __testables.resolveRequestTimeoutMs(
      {},
      { IMAGE_REQUEST_TIMEOUT_MS: '210000' }
    ),
    210000
  );
});
