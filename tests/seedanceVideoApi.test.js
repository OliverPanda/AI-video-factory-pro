import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, seedanceImageToVideo } from '../src/apis/seedanceVideoApi.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-seedance-api-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('buildSeedanceVideoRequest maps shot package into official create-task payload', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const request = __testables.buildSeedanceVideoRequest(
      {
        shotId: 'shot_001',
        durationTargetSec: 4,
        visualGoal: '皇城长廊里人物缓慢回头',
        cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
        sequenceContextSummary: 'sequence type: fight_exchange_sequence | shot coverage: shot_001 -> shot_002',
        providerRequestHints: {
          referenceTier: 'image',
          hasAudioBeatHints: true,
          audioBeatHints: ['beat_1'],
        },
      },
      {
        SEEDANCE_MODEL_ID: 'doubao-seedance-2-0-260128',
      }
    );

    assert.equal(request.model, 'doubao-seedance-2-0-260128');
    assert.equal(request.duration, 4);
    assert.equal(request.ratio, '9:16');
    assert.equal(request.generate_audio, false);
    assert.equal(request.content[0].type, 'text');
    assert.equal(request.content[1].type, 'image_url');
    assert.equal(request.content[1].role, 'first_frame');
    assert.match(request.content[1].image_url.url, /^data:image\/jpeg;base64,/);
    assert.match(request.content[0].text, /sequence type: fight_exchange_sequence/i);
    assert.match(request.content[0].text, /reference tier: image/i);
    assert.match(request.content[0].text, /audio beat hints: beat_1/i);
  });
});

test('classifySeedanceError categorizes auth rate-limit invalid-request timeout and server errors', () => {
  assert.equal(
    __testables.classifySeedanceError({ message: 'unauthorized', response: { status: 401, data: {} } }).category,
    'provider_auth_error'
  );
  assert.equal(
    __testables.classifySeedanceError({ message: 'slow down', response: { status: 429, data: {} } }).category,
    'provider_rate_limit'
  );
  assert.equal(
    __testables.classifySeedanceError({ message: 'bad request', response: { status: 400, data: {} } }).category,
    'provider_invalid_request'
  );
  assert.equal(
    __testables.classifySeedanceError({ message: 'timeout', code: 'ECONNABORTED' }).category,
    'provider_timeout'
  );
  assert.equal(
    __testables.classifySeedanceError({ message: 'server boom', response: { status: 500, data: {} } }).category,
    'provider_generation_failed'
  );
});

test('seedanceImageToVideo submits, polls, downloads and writes mp4 file', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    const outputPath = path.join(tempRoot, 'shot.mp4');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const calls = [];
    const httpClient = {
      async post(url, body) {
        calls.push(['post', url, body.model]);
        return { data: { id: 'cgt-2026-demo' } };
      },
      async get(url) {
        calls.push(['get', url]);
        return {
          data: {
            id: 'cgt-2026-demo',
            status: 'succeeded',
            duration: 4,
            ratio: '9:16',
            resolution: '720p',
            content: { video_url: 'https://example.com/seedance.mp4' },
          },
        };
      },
    };
    const binaryHttpClient = {
      async get(url) {
        calls.push(['download', url]);
        return { data: Buffer.from('fake-mp4') };
      },
    };

    const result = await seedanceImageToVideo(
      {
        sequenceId: 'seq_001',
        shotId: 'shot_001',
        preferredProvider: 'seedance',
        durationTargetSec: 4,
        visualGoal: '人物回身拔剑',
        cameraSpec: { moveType: 'tracking_pan', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
        referenceStrategy: 'image_first',
        providerRequestHints: {
          referenceTier: 'image',
          referenceCount: 1,
        },
      },
      outputPath,
      {
        apiKey: 'demo-key',
        httpClient,
        binaryHttpClient,
        sleep: async () => {},
        pollIntervalMs: 1,
        overallTimeoutMs: 50,
      },
      {}
    );

    assert.equal(result.provider, 'seedance');
    assert.equal(result.providerJobId, 'cgt-2026-demo');
    assert.equal(result.taskId, 'cgt-2026-demo');
    assert.equal(result.providerRequest.model, 'doubao-seedance-2-0-260128');
    assert.equal(result.providerMetadata.shotId, 'shot_001');
    assert.equal(result.providerMetadata.sequenceId, 'seq_001');
    assert.equal(result.providerMetadata.referenceTier, 'image');
    assert.equal(result.providerMetadata.referenceStrategy, 'image_first');
    assert.equal(fs.existsSync(outputPath), true);
    assert.deepEqual(calls.map((item) => item[0]), ['post', 'get', 'download']);
  });
});

test('seedanceImageToVideo throws timeout category when polling exceeds deadline', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    await assert.rejects(
      () =>
        seedanceImageToVideo(
          {
            shotId: 'shot_001',
            preferredProvider: 'seedance',
            durationTargetSec: 4,
            visualGoal: '人物慢慢转头',
            cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
            referenceImages: [{ path: imagePath }],
          },
          path.join(tempRoot, 'timeout.mp4'),
          {
            apiKey: 'demo-key',
            httpClient: {
              async post() {
                return { data: { id: 'cgt-timeout' } };
              },
              async get() {
                return { data: { status: 'running' } };
              },
            },
            sleep: async () => {},
            pollIntervalMs: 1,
            overallTimeoutMs: 1,
          },
          {}
        ),
      (error) => error?.category === 'provider_timeout'
    );
  });
});
