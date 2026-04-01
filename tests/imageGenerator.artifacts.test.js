import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateAllImages } from '../src/agents/imageGenerator.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-image-generator-artifacts-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('image generator writes provider config index metrics retry log manifest and per-shot errors when artifactContext is present', async () => {
  await withTempRoot(async (tempRoot) => {
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

    assert.equal(
      fs.existsSync(path.join(ctx.agents.imageGenerator.inputsDir, 'provider-config.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.imageGenerator.outputsDir, 'images.index.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.imageGenerator.metricsDir, 'image-metrics.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.imageGenerator.errorsDir, 'retry-log.json')),
      true
    );
    assert.equal(fs.existsSync(ctx.agents.imageGenerator.manifestPath), true);

    const errorFiles = fs.readdirSync(ctx.agents.imageGenerator.errorsDir);
    assert.equal(errorFiles.some((fileName) => /shot_002/i.test(fileName)), true);
  });
});
