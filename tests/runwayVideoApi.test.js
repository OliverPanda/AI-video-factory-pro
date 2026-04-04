import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, runwayImageToVideo } from '../src/apis/runwayVideoApi.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-runway-api-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('buildRunwayImageToVideoRequest maps shot package into phase1 runway request', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const request = __testables.buildRunwayImageToVideoRequest(
      {
        durationTargetSec: 4,
        visualGoal: '皇城长廊里人物缓慢回头',
        cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
      },
      {
        RUNWAY_IMAGE_TO_VIDEO_MODEL: 'gen4_turbo',
      }
    );

    assert.equal(request.model, 'gen4_turbo');
    assert.equal(request.duration, 5);
    assert.equal(request.ratio, '9:16');
    assert.match(request.promptText, /camera motion: slow_dolly/);
    assert.match(request.promptImage, /^data:image\/jpeg;base64,/);
  });
});

test('classifyRunwayError categorizes auth rate-limit invalid-request timeout and server errors', () => {
  assert.equal(
    __testables.classifyRunwayError({ message: 'unauthorized', response: { status: 401, data: {} } }).category,
    'provider_auth_error'
  );
  assert.equal(
    __testables.classifyRunwayError({ message: 'slow down', response: { status: 429, data: {} } }).category,
    'provider_rate_limit'
  );
  assert.equal(
    __testables.classifyRunwayError({ message: 'bad request', response: { status: 400, data: {} } }).category,
    'provider_invalid_request'
  );
  assert.equal(
    __testables.classifyRunwayError({ message: 'timeout', code: 'ECONNABORTED' }).category,
    'provider_timeout'
  );
  assert.equal(
    __testables.classifyRunwayError({ message: 'server boom', response: { status: 500, data: {} } }).category,
    'provider_generation_failed'
  );
});

test('runwayImageToVideo submits, polls, downloads and writes mp4 file', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    const outputPath = path.join(tempRoot, 'shot.mp4');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const calls = [];
    const httpClient = {
      async post(url, body) {
        calls.push(['post', url, body.duration]);
        return { data: { id: 'task_123' } };
      },
      async get(url) {
        calls.push(['get', url]);
        return { data: { status: 'SUCCEEDED', output: ['https://example.com/video.mp4'] } };
      },
    };
    const binaryHttpClient = {
      async get(url) {
        calls.push(['download', url]);
        return { data: Buffer.from('fake-mp4') };
      },
    };

    const result = await runwayImageToVideo(
      {
        durationTargetSec: 3,
        visualGoal: '人物回身拔剑',
        cameraSpec: { moveType: 'tracking_pan', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
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

    assert.equal(result.provider, 'runway');
    assert.equal(result.taskId, 'task_123');
    assert.equal(fs.existsSync(outputPath), true);
    assert.deepEqual(calls.map((item) => item[0]), ['post', 'get', 'download']);
  });
});

test('runwayImageToVideo throws timeout category when polling exceeds deadline', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    await assert.rejects(
      () =>
        runwayImageToVideo(
          {
            durationTargetSec: 3,
            visualGoal: '人物慢慢转头',
            cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
            referenceImages: [{ path: imagePath }],
          },
          path.join(tempRoot, 'timeout.mp4'),
          {
            apiKey: 'demo-key',
            httpClient: {
              async post() {
                return { data: { id: 'task_timeout' } };
              },
              async get() {
                return { data: { status: 'RUNNING' } };
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
