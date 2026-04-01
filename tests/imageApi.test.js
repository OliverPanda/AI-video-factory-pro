import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import {
  IMAGE_TASK_TYPES,
  __testables,
  generateImage,
  normalizeStyleToTaskType,
  resolveImageRoute,
  resolveImageTaskType,
} from '../src/apis/imageApi.js';

test('style 会映射到新的任务类型', () => {
  assert.equal(normalizeStyleToTaskType('realistic'), IMAGE_TASK_TYPES.REALISTIC_IMAGE);
  assert.equal(normalizeStyleToTaskType('3d'), IMAGE_TASK_TYPES.THREED_IMAGE);
  assert.equal(resolveImageTaskType({ style: 'realistic' }), IMAGE_TASK_TYPES.REALISTIC_IMAGE);
  assert.equal(resolveImageTaskType({ style: '3d' }), IMAGE_TASK_TYPES.THREED_IMAGE);
});

test('默认路由只返回老张平台模型', () => {
  const realisticRoute = resolveImageRoute(IMAGE_TASK_TYPES.REALISTIC_IMAGE, {
    PRIMARY_API_PROVIDER: 'laozhang',
    REALISTIC_IMAGE_MODEL: 'flux-kontext-pro',
  });
  const threedRoute = resolveImageRoute(IMAGE_TASK_TYPES.THREED_IMAGE, {
    PRIMARY_API_PROVIDER: 'laozhang',
    THREED_IMAGE_MODEL: 'gpt-image-1',
  });

  assert.deepEqual(realisticRoute, {
    provider: 'laozhang',
    model: 'flux-kontext-pro',
  });
  assert.deepEqual(threedRoute, {
    provider: 'laozhang',
    model: 'gpt-image-1',
  });
});

test('不允许默认回落到 together', () => {
  assert.throws(
    () =>
      resolveImageRoute(IMAGE_TASK_TYPES.REALISTIC_IMAGE, {
        PRIMARY_API_PROVIDER: 'together',
      }),
    /仅支持 laozhang/
  );
});

test('图像 provider 解析走策略注册表', () => {
  const provider = __testables.resolveImageProvider('laozhang');
  assert.equal(provider.name, 'laozhang');
  assert.equal(typeof provider.generate, 'function');
});

test('未知图像 provider 会被拒绝', () => {
  assert.throws(() => __testables.resolveImageProvider('unknown'), /未注册的图像 Provider/);
});

test('老张返回 url 时会立即下载并落盘', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-api-'));
  const outputPath = path.join(tempDir, 'result.png');
  const originalPost = axios.post;
  const originalGet = axios.get;
  const originalApiKey = process.env.LAOZHANG_API_KEY;

  process.env.LAOZHANG_API_KEY = 'test-key';
  axios.post = async () => ({
    data: {
      data: [{ url: 'https://example.com/result.png' }],
    },
  });
  axios.get = async () => ({
    data: Buffer.from('fake-png-binary'),
  });

  try {
    const savedPath = await generateImage('hello world', '', outputPath, {
      style: 'realistic',
    });
    assert.equal(savedPath, outputPath);
    assert.equal(fs.existsSync(outputPath), true);
    assert.equal(fs.readFileSync(outputPath).toString(), 'fake-png-binary');
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
    if (originalApiKey === undefined) {
      delete process.env.LAOZHANG_API_KEY;
    } else {
      process.env.LAOZHANG_API_KEY = originalApiKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('老张 prompt 构造会保留负向约束', () => {
  assert.equal(__testables.buildLaozhangPrompt('main prompt', ''), 'main prompt');
  assert.match(
    __testables.buildLaozhangPrompt('main prompt', 'blurry, extra hands'),
    /Avoid or suppress/
  );
});
