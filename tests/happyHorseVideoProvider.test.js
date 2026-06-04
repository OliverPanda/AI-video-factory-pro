import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables as videoAdapterTestables } from '../src/apis/videoAdapters.js';
import { createUnifiedVideoProviderClient } from '../src/apis/unifiedVideoProviderClient.js';
import { resolveVideoGenerationConfig } from '../src/apis/videoGenerationConfig.js';
import { createDashScopeAsyncVideoTransport } from '../src/apis/videoTransports.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-happyhorse-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('buildDashScopeHappyHorseRequest maps public references into DashScope async body', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'reference.png');
    fs.writeFileSync(imagePath, Buffer.from('fake-png'));

    const requestBody = await videoAdapterTestables.buildDashScopeHappyHorseRequest({
      model: 'happyhorse-1.0-r2v',
      prompt: '[Image 1] turns toward camera',
      durationSec: 4,
      ratio: '9:16',
      referenceImages: [
        { path: imagePath, publicUrl: 'https://example.com/ref-1.png' },
        { publicUrl: 'https://example.com/ref-2.png' },
      ],
      params: {
        providerParams: {
          resolution: '720P',
          ratio: '9:16',
          watermark: false,
        },
      },
    });

    assert.equal(requestBody.model, 'happyhorse-1.0-r2v');
    assert.equal(requestBody.input.prompt, '[Image 1] turns toward camera');
    assert.equal(requestBody.input.media[0].type, 'reference_image');
    assert.equal(requestBody.input.media[0].url, 'https://example.com/ref-1.png');
    assert.equal(requestBody.input.media[1].url, 'https://example.com/ref-2.png');
    assert.deepEqual(requestBody.parameters, {
      resolution: '720P',
      ratio: '9:16',
      duration: 4,
      watermark: false,
    });
  });
});

test('buildDashScopeHappyHorseRequest requires public references unless data urls are explicitly allowed', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'reference.png');
    fs.writeFileSync(imagePath, Buffer.from('fake-png'));

    await assert.rejects(
      videoAdapterTestables.buildDashScopeHappyHorseRequest({
        model: 'happyhorse-1.0-r2v',
        prompt: '[Image 1] turns toward camera',
        durationSec: 4,
        referenceImages: [{ path: imagePath }],
        params: { providerParams: { allowDataUrlReferences: false } },
      }),
      /HTTP\/HTTPS URL/
    );

    const requestBody = await videoAdapterTestables.buildDashScopeHappyHorseRequest({
      model: 'happyhorse-1.0-r2v',
      prompt: '[Image 1] turns toward camera',
      durationSec: 4,
      referenceImages: [{ path: imagePath }],
      params: { providerParams: { allowDataUrlReferences: true } },
    });

    assert.match(requestBody.input.media[0].url, /^data:image\/png;base64,/);
  });
});

test('resolveVideoGenerationConfig routes happyhorse through dashscope async transport', () => {
  const config = resolveVideoGenerationConfig(
    {
      shotId: 'shot_hh_001',
      preferredProvider: 'happyhorse',
    },
    {},
    {
      VIDEO_PROVIDER: 'happyhorse',
      DASHSCOPE_API_KEY: 'dashscope-demo-key',
      HAPPYHORSE_RESOLUTION: '1080P',
      HAPPYHORSE_RATIO: '16:9',
      HAPPYHORSE_WATERMARK: 'true',
      HAPPYHORSE_SEED: '1234',
    }
  );

  assert.equal(config.provider, 'happyhorse');
  assert.equal(config.transport, 'dashscope_async');
  assert.equal(config.baseUrl, 'https://dashscope.aliyuncs.com');
  assert.equal(config.apiKey, 'dashscope-demo-key');
  assert.equal(config.model, 'happyhorse-1.0-r2v');
  assert.equal(config.submitPath, '/api/v1/services/aigc/video-generation/video-synthesis');
  assert.equal(config.pollPath, '/api/v1/tasks');
    assert.deepEqual(config.providerParams, {
      resolution: '1080P',
      ratio: '16:9',
      watermark: true,
      seed: 1234,
      allowDataUrlReferences: true,
    });
  });

test('dashscope async transport submits polls and downloads HappyHorse video tasks', async () => {
  await withTempRoot(async (tempRoot) => {
    const outputPath = path.join(tempRoot, 'happyhorse.mp4');
    const calls = [];
    const transport = createDashScopeAsyncVideoTransport({
      httpClient: {
        async post(url, body) {
          calls.push(['post', url, body.model]);
          return {
            data: {
              output: {
                task_status: 'PENDING',
                task_id: 'task_happyhorse_001',
              },
              request_id: 'req_hh_001',
            },
          };
        },
        async get(url) {
          calls.push(['get', url]);
          return {
            data: {
              output: {
                task_status: 'SUCCEEDED',
                video_url: 'https://example.com/happyhorse.mp4',
              },
              usage: {
                output_video_duration: 4,
              },
            },
          };
        },
      },
      binaryHttpClient: {
        async get(url) {
          calls.push(['download', url]);
          return { data: Buffer.from('fake-mp4') };
        },
      },
      sleep: async () => {},
      pollIntervalMs: 1,
      timeoutMs: 20,
    });

    const submitResult = await transport.submit(
      {
        model: 'happyhorse-1.0-r2v',
        input: { prompt: 'test', media: [{ type: 'reference_image', url: 'https://example.com/ref.png' }] },
        parameters: { duration: 4, ratio: '9:16', resolution: '720P' },
      },
      {
        baseUrl: 'https://dashscope.aliyuncs.com',
        apiKey: 'dashscope-demo-key',
      }
    );
    const pollResult = await transport.poll(submitResult.taskId, {
      baseUrl: 'https://dashscope.aliyuncs.com',
      apiKey: 'dashscope-demo-key',
    });
    await transport.download(pollResult.outputUrl, outputPath, {
      apiKey: 'dashscope-demo-key',
    });

    assert.equal(submitResult.taskId, 'task_happyhorse_001');
    assert.equal(pollResult.outputUrl, 'https://example.com/happyhorse.mp4');
    assert.equal(pollResult.actualDurationSec, 4);
    assert.equal(fs.existsSync(outputPath), true);
    assert.deepEqual(calls, [
      ['post', '/api/v1/services/aigc/video-generation/video-synthesis', 'happyhorse-1.0-r2v'],
      ['get', '/api/v1/tasks/task_happyhorse_001'],
      ['download', 'https://example.com/happyhorse.mp4'],
    ]);
  });
});

test('unified video client routes happyhorse packages through dashscope async transport', async () => {
  await withTempRoot(async (tempRoot) => {
    const outputPath = path.join(tempRoot, 'shot_hh_002.mp4');
    const calls = [];
    const client = createUnifiedVideoProviderClient({
      routerOptions: {
        dashScopeAsyncTransportOptions: {
          httpClient: {
            async post(url, body) {
              calls.push(['post', url, body.model, body.input.media.length, body.parameters.resolution, body.parameters.watermark]);
              return {
                data: {
                  output: {
                    task_status: 'PENDING',
                    task_id: 'task_happyhorse_unified',
                  },
                },
              };
            },
            async get(url) {
              calls.push(['get', url]);
              return {
                data: {
                  output: {
                    task_status: 'SUCCEEDED',
                    video_url: 'https://example.com/happyhorse-unified.mp4',
                  },
                  usage: { output_video_duration: 5 },
                },
              };
            },
          },
          binaryHttpClient: {
            async get(url) {
              calls.push(['download', url]);
              return { data: Buffer.from('fake-mp4') };
            },
          },
          sleep: async () => {},
          pollIntervalMs: 1,
          timeoutMs: 20,
        },
      },
    });

    const submitResult = await client.submit(
      {
        packageType: 'shot',
        shotId: 'shot_hh_002',
        preferredProvider: 'happyhorse',
        visualGoal: '[Image 1] turns toward camera',
        durationTargetSec: 5,
        cameraSpec: { ratio: '9:16' },
        referenceImages: [{ publicUrl: 'https://example.com/ref.png' }],
      },
      outputPath,
      {
        env: {
          VIDEO_PROVIDER: 'happyhorse',
          VIDEO_TRANSPORT_PROVIDER: 'dashscope_async',
          VIDEO_TRANSPORT_API_KEY: 'dashscope-demo-key',
          HAPPYHORSE_RESOLUTION: '1080P',
          HAPPYHORSE_WATERMARK: 'true',
        },
      }
    );
    const pollResult = await client.poll(submitResult.taskId);
    await client.download(pollResult.outputUrl, outputPath, {}, pollResult);

    assert.equal(submitResult.provider, 'happyhorse');
    assert.equal(submitResult.transport, 'dashscope_async');
    assert.equal(pollResult.outputUrl, 'https://example.com/happyhorse-unified.mp4');
    assert.equal(fs.existsSync(outputPath), true);
    assert.deepEqual(calls, [
      ['post', '/api/v1/services/aigc/video-generation/video-synthesis', 'happyhorse-1.0-r2v', 1, '1080P', true],
      ['get', '/api/v1/tasks/task_happyhorse_unified'],
      ['download', 'https://example.com/happyhorse-unified.mp4'],
    ]);
  });
});
