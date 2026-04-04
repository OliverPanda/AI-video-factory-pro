import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

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
      provider: 'laozhang',
      model: process.env.REALISTIC_IMAGE_MODEL || 'flux-kontext-pro',
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
        provider: 'laozhang',
        model: process.env.REALISTIC_IMAGE_MODEL || 'flux-kontext-pro',
      },
    });
  }, 'image-generator');
});
