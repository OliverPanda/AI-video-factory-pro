import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';

import { generateAllImages, regenerateImage } from '../src/agents/imageGenerator.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { withManagedTempRoot } from './helpers/testArtifacts.js';

test('image generator writes provider config index metrics retry log manifest and per-shot errors when artifactContext is present', async (t) => {
  await withManagedTempRoot(t, 'aivf-image-generator-artifacts', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_123',
      projectName: '咖啡馆相遇',
      scriptId: 'script_001',
      scriptTitle: '第一卷',
      episodeId: 'episode_001',
      episodeTitle: '试播集',
      episodeNo: 1,
      runJobId: 'run_image_artifacts',
      startedAt: '2026-04-01T09:00:00.000Z',
    });
    const imagesDir = path.join(tempRoot, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    const promptList = [
      { shotId: 'shot_001', image_prompt: 'prompt 1', negative_prompt: 'neg 1' },
      { shotId: 'shot_002', image_prompt: 'prompt 2', negative_prompt: 'neg 2' },
    ];

    await generateAllImages(promptList, imagesDir, {
      style: 'realistic',
      artifactContext: ctx.agents.imageGenerator,
      executionPolicy: {
        mode: 'test',
        useRealQueue: false,
        useRealSleep: false,
        defaultMaxRetries: 3,
      },
      generateImage: async (prompt, _negativePrompt, outputPath) => {
        if (prompt === 'prompt 1') {
          fs.writeFileSync(outputPath, 'fake-image');
          return outputPath;
        }

        throw new Error('503 upstream unavailable');
      },
    });

    const providerConfigPath = path.join(ctx.agents.imageGenerator.inputsDir, 'provider-config.json');
    const imageIndexPath = path.join(ctx.agents.imageGenerator.outputsDir, 'images.index.json');
    const imageMetricsPath = path.join(ctx.agents.imageGenerator.metricsDir, 'image-metrics.json');
    const retryLogPath = path.join(ctx.agents.imageGenerator.errorsDir, 'retry-log.json');
    const manifestPath = ctx.agents.imageGenerator.manifestPath;

    const providerConfig = JSON.parse(fs.readFileSync(providerConfigPath, 'utf-8'));
    assert.deepEqual(providerConfig, {
      style: 'realistic',
      taskType: 'realistic_image',
      provider: 'openai_compat',
      model: process.env.REALISTIC_IMAGE_MODEL || 'gpt-image-2',
    });

    const imageIndex = JSON.parse(fs.readFileSync(imageIndexPath, 'utf-8'));
    assert.equal(imageIndex.length, 2);
    assert.equal(imageIndex[0].shotId, 'shot_001');
    assert.equal(imageIndex[0].success, true);
    assert.equal(imageIndex[0].imagePath, path.join(imagesDir, 'shot_001.png'));
    assert.equal(imageIndex[1].shotId, 'shot_002');
    assert.equal(imageIndex[1].success, false);
    assert.match(imageIndex[1].error, /503 upstream unavailable/);
    assert.deepEqual(imageIndex[1].request, {
      shotId: 'shot_002',
      prompt: 'prompt 2',
      negativePrompt: 'neg 2',
      outputPath: path.join(imagesDir, 'shot_002.png'),
      providerConfig,
      referenceImages: [],
    });

    const imageMetrics = JSON.parse(fs.readFileSync(imageMetricsPath, 'utf-8'));
    assert.deepEqual(imageMetrics, {
      request_count: 2,
      success_count: 1,
      failure_count: 1,
      success_rate: 0.5,
      retry_count: 2,
      http_403_count: 0,
      http_429_count: 0,
      http_503_count: 1,
    });

    const retryLog = JSON.parse(fs.readFileSync(retryLogPath, 'utf-8'));
    assert.equal(retryLog.length, 2);
    assert.deepEqual(retryLog[0], {
      shotId: 'shot_002',
      prompt: 'prompt 2',
      negativePrompt: 'neg 2',
      outputPath: path.join(imagesDir, 'shot_002.png'),
      providerConfig,
      referenceImages: [],
      taskName: 'shot_002',
      attempt: 1,
      maxRetries: 3,
      delay: 1000,
      error: '503 upstream unavailable',
    });
    assert.deepEqual(retryLog[1], {
      shotId: 'shot_002',
      prompt: 'prompt 2',
      negativePrompt: 'neg 2',
      outputPath: path.join(imagesDir, 'shot_002.png'),
      providerConfig,
      referenceImages: [],
      taskName: 'shot_002',
      attempt: 2,
      maxRetries: 3,
      delay: 2000,
      error: '503 upstream unavailable',
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.deepEqual(manifest, {
      status: 'completed_with_errors',
      requestCount: 2,
      successCount: 1,
      failureCount: 1,
      outputFiles: ['provider-config.json', 'images.index.json', 'image-metrics.json', 'retry-log.json'],
    });

    const errorFiles = fs.readdirSync(ctx.agents.imageGenerator.errorsDir);
    const errorFileName = errorFiles.find((fileName) => /shot_002/i.test(fileName));
    assert.ok(errorFileName);

    const terminalError = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.imageGenerator.errorsDir, errorFileName), 'utf-8')
    );
    assert.equal(terminalError.shotId, 'shot_002');
    assert.equal(terminalError.success, false);
    assert.match(terminalError.error, /503 upstream unavailable/);
    assert.deepEqual(terminalError.request, {
      shotId: 'shot_002',
      prompt: 'prompt 2',
      negativePrompt: 'neg 2',
      outputPath: path.join(imagesDir, 'shot_002.png'),
      providerConfig,
      referenceImages: [],
    });
    assert.equal(Array.isArray(terminalError.retryHistory), true);
    assert.equal(terminalError.retryHistory.length, 2);
  }, 'image-generator');
});

test('regenerateImage retries transient failures and returns a failed result instead of throwing', async (t) => {
  await withManagedTempRoot(t, 'aivf-image-generator-regenerate', async (tempRoot) => {
    const imagesDir = path.join(tempRoot, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    let attempts = 0;

    const result = await regenerateImage('shot_009', 'regen prompt', 'regen neg', imagesDir, {
      style: 'realistic',
      executionPolicy: {
        mode: 'test',
        useRealQueue: false,
        useRealSleep: false,
        defaultMaxRetries: 3,
      },
      generateImage: async () => {
        attempts += 1;
        throw new Error('socket hang up');
      },
    });

    assert.equal(attempts, 3);
    assert.equal(result.shotId, 'shot_009');
    assert.equal(result.success, false);
    assert.equal(result.imagePath, null);
    assert.match(result.error, /socket hang up/);
    assert.equal(Array.isArray(result.retryHistory), true);
    assert.equal(result.retryHistory.length, 2);
    assert.deepEqual(result.request, {
      shotId: 'shot_009',
      prompt: 'regen prompt',
      negativePrompt: 'regen neg',
      outputPath: path.join(imagesDir, 'shot_009.png'),
      providerConfig: {
        style: 'realistic',
        taskType: 'realistic_image',
        provider: 'openai_compat',
        model: process.env.REALISTIC_IMAGE_MODEL || 'gpt-image-2',
      },
      referenceImages: [],
    });
  }, 'image-generator');
});

test('generateAllImages emits partial results and times out stuck image requests', async (t) => {
  await withManagedTempRoot(t, 'aivf-image-generator-timeout', async (tempRoot) => {
    const imagesDir = path.join(tempRoot, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    const partialResults = [];

    const results = await generateAllImages(
      [
        { shotId: 'shot_001', image_prompt: 'prompt 1', negative_prompt: 'neg 1' },
        { shotId: 'shot_002', image_prompt: 'prompt 2', negative_prompt: 'neg 2' },
      ],
      imagesDir,
      {
        timeoutMs: 20,
        executionPolicy: {
          mode: 'test',
          useRealQueue: false,
          useRealSleep: false,
          defaultMaxRetries: 3,
        },
        onResult: (result) => partialResults.push(result),
        generateImage: async (prompt, _negativePrompt, outputPath) => {
          if (prompt === 'prompt 1') {
            fs.writeFileSync(outputPath, 'fake-image');
            return outputPath;
          }
          await new Promise(() => {});
        },
      }
    );

    assert.equal(results.length, 2);
    assert.equal(partialResults.length, 2);
    assert.equal(results[0].shotId, 'shot_001');
    assert.equal(results[0].success, true);
    assert.equal(results[1].shotId, 'shot_002');
    assert.equal(results[1].success, false);
    assert.match(results[1].error, /图像生成超时/);
  }, 'image-generator');
});

test('generateAllImages forwards prompt-level reference images into the image request', async (t) => {
  await withManagedTempRoot(t, 'aivf-image-generator-forward-refs', async (tempRoot) => {
    const imagesDir = path.join(tempRoot, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    const calls = [];

    const results = await generateAllImages(
      [
        {
          shotId: 'shot_refs',
          image_prompt: 'prompt refs',
          negative_prompt: 'neg refs',
          referenceImages: ['refs/front.png', 'refs/ref-sheet.png'],
        },
      ],
      imagesDir,
      {
        executionPolicy: { mode: 'test' },
        generateImage: async (_prompt, _negativePrompt, outputPath, requestOptions) => {
          calls.push(requestOptions.references);
          fs.writeFileSync(outputPath, 'fake-image');
          return outputPath;
        },
      }
    );

    assert.equal(results[0].success, true);
    assert.deepEqual(calls, [['refs/front.png', 'refs/ref-sheet.png']]);
  }, 'image-generator');
});

test('generateAllImages failure path does not wait on production backoff in test policy', async (t) => {
  await withManagedTempRoot(t, 'aivf-image-generator-test-policy', async (tempRoot) => {
    const imagesDir = path.join(tempRoot, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    let attempts = 0;
    const startedAt = Date.now();

    const results = await generateAllImages(
      [{ shotId: 'shot_429', image_prompt: 'prompt 429', negative_prompt: 'neg 429' }],
      imagesDir,
      {
        executionPolicy: { mode: 'test' },
        generateImage: async () => {
          attempts += 1;
          throw new Error('429 rate limit');
        },
      }
    );

    assert.ok(Date.now() - startedAt < 1000);
    assert.equal(attempts, 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].shotId, 'shot_429');
    assert.equal(results[0].success, false);
    assert.match(results[0].error, /429 rate limit/);
  }, 'image-generator');
});

test('imageGenerator preserves full executionPolicy overrides', async (t) => {
  await withManagedTempRoot(t, 'aivf-image-generator-policy-overrides', async (tempRoot) => {
    const imagesDir = path.join(tempRoot, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    let attempts = 0;

    const results = await generateAllImages(
      [{ shotId: 'shot_policy', image_prompt: 'prompt policy', negative_prompt: 'neg policy' }],
      imagesDir,
      {
        executionPolicy: {
          mode: 'production',
          useRealQueue: false,
          useRealSleep: false,
          defaultMaxRetries: 1,
        },
        generateImage: async () => {
          attempts += 1;
          throw new Error('503 upstream unavailable');
        },
      }
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    assert.equal(attempts, 1);
  }, 'image-generator');
});

test('regenerateImage forwards reference images into the default openai_compat image payload as prompt-side anchor hints', async (t) => {
  await withManagedTempRoot(t, 'aivf-image-generator-reference-hints', async (tempRoot) => {
    const imagesDir = path.join(tempRoot, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    const requests = [];

    t.mock.method(axios, 'post', async (_url, body) => {
      requests.push(body);
      return {
        data: {
          data: [
            {
              b64_json: Buffer.from('fake-image').toString('base64'),
            },
          ],
        },
      };
    });

    const result = await regenerateImage('shot_020', 'regen prompt', 'regen neg', imagesDir, {
      style: 'realistic',
      referenceImages: ['ref/front.png', '/tmp/current.png'],
    });

    assert.equal(result.success, true);
    assert.equal(requests.length, 1);
    assert.match(requests[0].prompt, /Reference anchor images are provided/i);
    assert.match(requests[0].prompt, /Reference 1: ref\/front\.png/i);
    assert.match(requests[0].prompt, /Reference 2: \/tmp\/current\.png/i);
  }, 'image-generator');
});
