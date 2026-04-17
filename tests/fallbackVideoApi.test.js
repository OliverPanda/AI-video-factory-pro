import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, fallbackImageToVideo } from '../src/apis/fallbackVideoApi.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-sora2-api-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('buildFallbackVideoRequest maps shot package into generic fallback video request fields', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const request = await __testables.buildFallbackVideoRequest(
      {
        durationTargetSec: 12,
        visualGoal: '仓库里人物急速回身反击',
        cameraSpec: { moveType: 'tracking_pan', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
      },
      {
        VIDEO_FALLBACK_MODEL: 'veo-3.0-fast-generate-001',
        VIDEO_FALLBACK_SECONDS: '4',
        VIDEO_FALLBACK_SIZE: '720x1280',
      }
    );

    assert.equal(request.model, 'veo-3.0-fast-generate-001');
    assert.equal(request.duration, 15);
    assert.equal(request.seconds, 4);
    assert.equal(request.size, '720x1280');
    assert.equal(request.ratio, '9:16');
    assert.equal(request.imagePath, imagePath);
    assert.match(request.prompt, /camera motion: tracking_pan/);
  });
});

test('buildFallbackVideoRequest prefers generic fallback config when provided', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const request = await __testables.buildFallbackVideoRequest(
      {
        durationTargetSec: 12,
        visualGoal: '角色转身后快速奔跑',
        cameraSpec: { moveType: 'tracking_pan', framing: 'medium', ratio: '16:9' },
        referenceImages: [{ path: imagePath }],
      },
      {
        VIDEO_FALLBACK_MODEL: 'veo-3.0-fast-generate-001',
        VIDEO_FALLBACK_SECONDS: '4',
        VIDEO_FALLBACK_SIZE: '1280x720',
      }
    );

    assert.equal(request.model, 'veo-3.0-fast-generate-001');
    assert.equal(request.seconds, 4);
    assert.equal(request.size, '1280x720');
  });
});

test('buildFallbackVideoRequest infers size from final video dimensions when VIDEO_FALLBACK_SIZE is not configured', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const request = await __testables.buildFallbackVideoRequest(
      {
        durationTargetSec: 12,
        visualGoal: '角色转身后快速奔跑',
        cameraSpec: { moveType: 'tracking_pan', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
      },
      {
        VIDEO_FALLBACK_MODEL: 'veo-3.0-fast-generate-001',
        VIDEO_FALLBACK_SECONDS: '4',
        VIDEO_WIDTH: '1080',
        VIDEO_HEIGHT: '1920',
      }
    );

    assert.equal(request.size, '1080x1920');
  });
});

test('buildFallbackVideoRequest falls back to ratio defaults when final video dimensions are unavailable', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const portraitRequest = await __testables.buildFallbackVideoRequest(
      {
        durationTargetSec: 12,
        visualGoal: '角色慢慢抬头',
        cameraSpec: { moveType: 'static', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
      },
      {
        VIDEO_FALLBACK_MODEL: 'veo-3.0-fast-generate-001',
        VIDEO_FALLBACK_SECONDS: '4',
      }
    );

    const landscapeRequest = await __testables.buildFallbackVideoRequest(
      {
        durationTargetSec: 12,
        visualGoal: '角色慢慢抬头',
        cameraSpec: { moveType: 'static', framing: 'medium', ratio: '16:9' },
        referenceImages: [{ path: imagePath }],
      },
      {
        VIDEO_FALLBACK_MODEL: 'veo-3.0-fast-generate-001',
        VIDEO_FALLBACK_SECONDS: '4',
      }
    );

    assert.equal(portraitRequest.size, '720x1280');
    assert.equal(landscapeRequest.size, '1280x720');
  });
});

test('normalizeVideoFallbackSize maps dimension-style sizes to preset resolutions for t8star-style providers', () => {
  assert.equal(
    __testables.normalizeVideoFallbackSize('720x1280', {}, { VIDEO_FALLBACK_BASE_URL: 'https://ai.t8star.cn/v1', VIDEO_FALLBACK_MODEL: 'grok-video-3' }),
    '720P'
  );
  assert.equal(
    __testables.normalizeVideoFallbackSize('1280x720', {}, { VIDEO_FALLBACK_BASE_URL: 'https://ai.t8star.cn/v1', VIDEO_FALLBACK_MODEL: 'grok-video-3' }),
    '720P'
  );
  assert.equal(
    __testables.normalizeVideoFallbackSize('1080x1920', {}, { VIDEO_FALLBACK_BASE_URL: 'https://ai.t8star.cn/v1', VIDEO_FALLBACK_MODEL: 'grok-video-3' }),
    '1080P'
  );
  assert.equal(
    __testables.normalizeVideoFallbackSize('720x1280', {}, { VIDEO_FALLBACK_BASE_URL: 'https://api.laozhang.ai/v1' }),
    '720x1280'
  );
  assert.equal(
    __testables.normalizeVideoFallbackSize('720x1280', {}, { VIDEO_FALLBACK_BASE_URL: 'https://ai.t8star.cn/v1', VIDEO_FALLBACK_MODEL: 'veo3.1-fast' }),
    '720x1280'
  );
});

test('buildFallbackVideoRequest converts generic size into preset resolution for t8star-style providers', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const request = await __testables.buildFallbackVideoRequest(
      {
        durationTargetSec: 12,
        visualGoal: '角色保持静止以验证清晰度映射',
        cameraSpec: { moveType: 'static', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
      },
      {
        VIDEO_FALLBACK_BASE_URL: 'https://ai.t8star.cn/v1',
        VIDEO_FALLBACK_MODEL: 'grok-video-3',
        VIDEO_FALLBACK_SECONDS: '4',
        VIDEO_FALLBACK_SIZE: '720x1280',
      }
    );

    assert.equal(request.size, '720P');
  });
});

test('buildFallbackVideoRequest keeps dimension size for non-grok models on t8star-style providers', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const request = await __testables.buildFallbackVideoRequest(
      {
        durationTargetSec: 12,
        visualGoal: '角色保持静止以验证非 grok 尺寸兼容',
        cameraSpec: { moveType: 'static', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
      },
      {
        VIDEO_FALLBACK_BASE_URL: 'https://ai.t8star.cn/v1',
        VIDEO_FALLBACK_MODEL: 'veo3.1-fast',
        VIDEO_FALLBACK_SECONDS: '4',
        VIDEO_FALLBACK_SIZE: '720x1280',
      }
    );

    assert.equal(request.size, '720x1280');
  });
});

test('classifyFallbackVideoError categorizes auth rate-limit invalid-request timeout and server errors', () => {
  assert.equal(
    __testables.classifyFallbackVideoError({ message: 'unauthorized', response: { status: 401, data: {} } }).category,
    'provider_auth_error'
  );
  assert.equal(
    __testables.classifyFallbackVideoError({ message: 'slow down', response: { status: 429, data: {} } }).category,
    'provider_rate_limit'
  );
  assert.equal(
    __testables.classifyFallbackVideoError({ message: 'bad request', response: { status: 400, data: {} } }).category,
    'provider_invalid_request'
  );
  assert.equal(
    __testables.classifyFallbackVideoError({ message: 'timeout', code: 'ECONNABORTED' }).category,
    'provider_timeout'
  );
  assert.equal(
    __testables.classifyFallbackVideoError({ message: 'server boom', response: { status: 500, data: {} } }).category,
    'provider_generation_failed'
  );
});

test('resolveFallbackVideoApiKey prefers dedicated key and only falls back to laozhang for laozhang base url', () => {
  assert.equal(
    __testables.resolveFallbackVideoApiKey(
      {},
      {
        VIDEO_FALLBACK_API_KEY: 'vf-key',
        LAOZHANG_API_KEY: 'lz-key',
        VIDEO_FALLBACK_BASE_URL: 'https://api.winfull.cloud-ip.cc/v1',
      }
    ),
    'vf-key'
  );

  assert.equal(
    __testables.resolveFallbackVideoApiKey(
      {},
      {
        LAOZHANG_API_KEY: 'lz-key',
        VIDEO_FALLBACK_BASE_URL: 'https://api.laozhang.ai/v1',
      }
    ),
    'lz-key'
  );

  assert.equal(
    __testables.resolveFallbackVideoApiKey(
      {},
      {
        LAOZHANG_API_KEY: 'lz-key',
        VIDEO_FALLBACK_BASE_URL: 'https://api.winfull.cloud-ip.cc/v1',
      }
    ),
    null
  );
});

test('resolveVideoFallbackBaseUrl prefers generic config with legacy fallback', () => {
  assert.equal(
    __testables.resolveVideoFallbackBaseUrl({}, { VIDEO_FALLBACK_BASE_URL: 'https://api.laozhang.ai/v1' }),
    'https://api.laozhang.ai/v1'
  );
});

test('buildFallbackVideoModelCandidates returns single generic model when VIDEO_FALLBACK_MODEL is configured', () => {
  assert.deepEqual(
    __testables.buildFallbackVideoModelCandidates(
      { durationTargetSec: 12, cameraSpec: { ratio: '16:9' } },
      { VIDEO_FALLBACK_MODEL: 'veo-3.0-fast-generate-001' }
    ),
    ['veo-3.0-fast-generate-001']
  );
});

test('buildFallbackVideoModelCandidates prepends primary model and de-duplicates configured sequence candidates', () => {
  assert.deepEqual(
    __testables.buildFallbackVideoModelCandidates(
      { sequenceId: 'action_sequence_001', durationTargetSec: 12, cameraSpec: { ratio: '9:16' } },
      {
        VIDEO_FALLBACK_MODEL: 'veo3.1-fast',
        VIDEO_FALLBACK_SEQUENCE_MODEL_CANDIDATES: 'grok-video-3, veo3.1-fast, grok-video-3',
      }
    ),
    ['veo3.1-fast', 'grok-video-3']
  );
});

test('buildFallbackVideoRequestCandidates degrades long sequence requests to shorter retries', async () => {
  const candidates = await __testables.buildFallbackVideoRequestCandidates(
    {
      sequenceId: 'action_sequence_001',
      durationTargetSec: 12,
      visualGoal: '仓库里连续攻防',
      cameraSpec: { ratio: '9:16' },
      referenceImages: [{ path: '/tmp/seq.png' }],
    },
    {}
  );

  assert.deepEqual(
    candidates.map((item) => ({ seconds: item.seconds, duration: item.duration })),
    [
      { seconds: 12, duration: 15 },
      { seconds: 6, duration: 10 },
      { seconds: 4, duration: 10 },
    ]
  );
});

test('buildFallbackVideoRequest ignores VIDEO_FALLBACK_SECONDS for sequences and follows sequence target by default', async () => {
  const request = await __testables.buildFallbackVideoRequest(
    {
      sequenceId: 'action_sequence_001',
      durationTargetSec: 12,
      visualGoal: '仓库里连续攻防',
      cameraSpec: { ratio: '9:16' },
      referenceImages: [{ path: '/tmp/seq.png' }],
    },
    {
      VIDEO_FALLBACK_SECONDS: '4',
      VIDEO_FALLBACK_SIZE: '720x1280',
    }
  );

  assert.equal(request.seconds, 12);
  assert.equal(request.duration, 15);
});

test('buildFallbackVideoRequest respects VIDEO_FALLBACK_SEQUENCE_SECONDS when explicitly configured', async () => {
  const request = await __testables.buildFallbackVideoRequest(
    {
      sequenceId: 'action_sequence_001',
      durationTargetSec: 12,
      visualGoal: '仓库里连续攻防',
      cameraSpec: { ratio: '9:16' },
      referenceImages: [{ path: '/tmp/seq.png' }],
    },
    {
      VIDEO_FALLBACK_SECONDS: '4',
      VIDEO_FALLBACK_SEQUENCE_SECONDS: '6',
      VIDEO_FALLBACK_SIZE: '720x1280',
    }
  );

  assert.equal(request.seconds, 6);
  assert.equal(request.duration, 15);
});

test('buildFallbackVideoAttemptPlans expands sequence retries across models and request variants', async () => {
  const plans = await __testables.buildFallbackVideoAttemptPlans(
    {
      sequenceId: 'action_sequence_001',
      durationTargetSec: 12,
      visualGoal: '仓库里连续攻防',
      cameraSpec: { ratio: '9:16' },
      referenceImages: [{ path: '/tmp/seq.png' }],
    },
    {
      VIDEO_FALLBACK_MODEL: 'veo3.1-fast',
      VIDEO_FALLBACK_SEQUENCE_MODEL_CANDIDATES: 'grok-video-3',
      VIDEO_FALLBACK_SEQUENCE_RETRY_ATTEMPTS: '2',
    }
  );

  assert.deepEqual(
    plans.map((item) => ({
      seconds: item.request.seconds,
      model: item.request.model,
      attempt: item.attempt,
    })),
    [
      { seconds: 12, model: 'veo3.1-fast', attempt: 1 },
      { seconds: 12, model: 'veo3.1-fast', attempt: 2 },
      { seconds: 12, model: 'grok-video-3', attempt: 1 },
      { seconds: 12, model: 'grok-video-3', attempt: 2 },
      { seconds: 6, model: 'veo3.1-fast', attempt: 1 },
      { seconds: 6, model: 'veo3.1-fast', attempt: 2 },
      { seconds: 6, model: 'grok-video-3', attempt: 1 },
      { seconds: 6, model: 'grok-video-3', attempt: 2 },
      { seconds: 4, model: 'veo3.1-fast', attempt: 1 },
      { seconds: 4, model: 'veo3.1-fast', attempt: 2 },
      { seconds: 4, model: 'grok-video-3', attempt: 1 },
      { seconds: 4, model: 'grok-video-3', attempt: 2 },
    ]
  );
});

test('fallbackImageToVideo submits polls downloads and writes mp4 file', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    const outputPath = path.join(tempRoot, 'shot.mp4');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const calls = [];
    const httpClient = {
      async postMultipart(url, body) {
        calls.push(['post', url, body.get('model'), body.get('seconds'), body.get('size')]);
        return { data: { id: 'task_123' } };
      },
      async get(url) {
        calls.push(['get', url]);
        return { data: { status: 'SUCCEEDED' } };
      },
      async getBinary(url) {
        calls.push(['download', url]);
        return { data: Buffer.from('fake-mp4') };
      },
    };

    const result = await fallbackImageToVideo(
      {
        durationTargetSec: 8,
        visualGoal: '人物回身拔剑',
        cameraSpec: { moveType: 'tracking_pan', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
      },
      outputPath,
      {
        apiKey: 'demo-key',
        httpClient,
        sleep: async () => {},
        pollIntervalMs: 1,
        overallTimeoutMs: 50,
      },
      {
        VIDEO_FALLBACK_MODEL: 'veo-3.0-fast-generate-001',
        VIDEO_FALLBACK_SECONDS: '4',
        VIDEO_FALLBACK_SIZE: '720x1280',
      }
    );

    assert.equal(result.provider, 'sora2');
    assert.equal(result.model, 'veo-3.0-fast-generate-001');
    assert.equal(result.providerJobId, 'task_123');
    assert.equal(result.taskId, 'task_123');
    assert.equal(result.providerMetadata.shotId, null);
    assert.equal(fs.existsSync(outputPath), true);
    assert.deepEqual(calls, [
      ['post', '/videos', 'veo-3.0-fast-generate-001', '4', '720x1280'],
      ['get', '/videos/task_123'],
      ['download', '/videos/task_123/content'],
    ]);
  });
});

test('fallbackImageToVideo surfaces upstream unavailable-channel error when generic fallback model fails', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    const outputPath = path.join(tempRoot, 'shot.mp4');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const calls = [];
    let createAttempts = 0;
    const httpClient = {
      async postMultipart(url, body) {
        createAttempts += 1;
        const model = body.get('model');
        calls.push(['post', url, model]);
        if (createAttempts === 1) {
          throw {
            message: '当前分组 sora_official 下对于模型 sora_video2 计费模式 [按次计费,按量计费] 无可用渠道',
            response: {
              status: 503,
              data: {
                error: {
                  message: '当前分组 sora_official 下对于模型 sora_video2 计费模式 [按次计费,按量计费] 无可用渠道',
                },
              },
            },
          };
        }
        return { data: { id: 'task_retry_ok' } };
      },
      async get() {
        throw new Error('should not poll after create failure');
      },
      async getBinary() {
        throw new Error('should not download after create failure');
      },
    };

    await assert.rejects(
      () =>
        fallbackImageToVideo(
          {
            durationTargetSec: 8,
            visualGoal: '人物迅速回头并冲刺',
            cameraSpec: { moveType: 'tracking_pan', framing: 'medium', ratio: '9:16' },
            referenceImages: [{ path: imagePath }],
          },
          outputPath,
          {
            apiKey: 'demo-key',
            httpClient,
            sleep: async () => {},
            pollIntervalMs: 1,
            overallTimeoutMs: 50,
          },
          {
            VIDEO_FALLBACK_MODEL: 'sora_video2',
          }
        ),
      (error) => {
        assert.equal(error.code, 'SORA2_SERVER_ERROR');
        assert.deepEqual(error.attemptedModels, ['sora_video2']);
        return true;
      }
    );

    assert.deepEqual(calls, [['post', '/videos', 'sora_video2']]);
  });
});

test('fallbackImageToVideo retries shorter sequence requests after provider generation failure', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'seq.jpg');
    const outputPath = path.join(tempRoot, 'sequence.mp4');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const calls = [];
    let taskIndex = 0;
    const httpClient = {
      async postMultipart(url, body) {
        taskIndex += 1;
        calls.push(['post', url, Number(body.get('seconds')), body.get('size')]);
        return { data: { id: `task_${taskIndex}` } };
      },
      async get(url) {
        calls.push(['get', url]);
        if (url === '/videos/task_1') {
          return { data: { status: 'FAILED', error: { message: 'generation failed' } } };
        }
        return { data: { status: 'SUCCEEDED' } };
      },
      async getBinary(url) {
        calls.push(['download', url]);
        return { data: Buffer.from('fake-mp4') };
      },
    };

    const result = await fallbackImageToVideo(
      {
        sequenceId: 'action_sequence_001',
        durationTargetSec: 12,
        visualGoal: '仓库里连续攻防',
        cameraSpec: { moveType: 'orbit', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
      },
      outputPath,
      {
        apiKey: 'demo-key',
        httpClient,
        sleep: async () => {},
        pollIntervalMs: 1,
        overallTimeoutMs: 50,
      },
      {
        VIDEO_FALLBACK_SEQUENCE_RETRY_ATTEMPTS: '1',
      }
    );

    assert.equal(result.provider, 'sora2');
    assert.deepEqual(calls, [
      ['post', '/videos', 12, '720x1280'],
      ['get', '/videos/task_1'],
      ['post', '/videos', 6, '720x1280'],
      ['get', '/videos/task_2'],
      ['download', '/videos/task_2/content'],
    ]);
    assert.deepEqual(
      result.attemptedRequests.map((item) => ({ seconds: item.seconds, duration: item.duration })),
      [
        { seconds: 12, duration: 15 },
        { seconds: 6, duration: 10 },
      ]
    );
  });
});

test('fallbackImageToVideo retries the same sequence request before degrading to the next variant', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'seq.jpg');
    const outputPath = path.join(tempRoot, 'sequence.mp4');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const calls = [];
    let taskIndex = 0;
    const httpClient = {
      async postMultipart(url, body) {
        taskIndex += 1;
        calls.push(['post', url, Number(body.get('seconds')), body.get('model')]);
        return { data: { id: `task_${taskIndex}` } };
      },
      async get(url) {
        calls.push(['get', url]);
        if (url === '/videos/task_1') {
          return { data: { status: 'FAILED', error: { message: 'generation failed' } } };
        }
        return { data: { status: 'SUCCEEDED' } };
      },
      async getBinary(url) {
        calls.push(['download', url]);
        return { data: Buffer.from('fake-mp4') };
      },
    };

    const result = await fallbackImageToVideo(
      {
        sequenceId: 'action_sequence_001',
        durationTargetSec: 12,
        visualGoal: '仓库里连续攻防',
        cameraSpec: { moveType: 'orbit', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
      },
      outputPath,
      {
        apiKey: 'demo-key',
        httpClient,
        sleep: async () => {},
        pollIntervalMs: 1,
        overallTimeoutMs: 50,
      },
      {}
    );

    assert.equal(result.provider, 'sora2');
    assert.deepEqual(calls, [
      ['post', '/videos', 12, 'veo-3.0-fast-generate-001'],
      ['get', '/videos/task_1'],
      ['post', '/videos', 12, 'veo-3.0-fast-generate-001'],
      ['get', '/videos/task_2'],
      ['download', '/videos/task_2/content'],
    ]);
    assert.deepEqual(
      result.attemptedRequests.map((item) => ({ seconds: item.seconds, attempt: item.attempt })),
      [
        { seconds: 12, attempt: 1 },
        { seconds: 12, attempt: 2 },
      ]
    );
  });
});
