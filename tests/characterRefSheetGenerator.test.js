import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generateCharacterRefSheets } from '../src/agents/characterRefSheetGenerator.js';
import { buildCharacterRefSheetPrompt } from '../src/llm/prompts/promptEngineering.js';

test('buildCharacterRefSheetPrompt produces correct prompt structure for realistic style', () => {
  const character = {
    name: '阿坤',
    basePromptTokens: 'slim, athletic, short black hair, scruffy beard, gray hoodie, cargo pants, metal ladder',
    identityAnchor: 'slim, athletic, short black hair, scruffy beard',
    forbiddenIdentityTokens: 'different hairstyle',
    visualDescription: 'young man, athletic build, short dark hair',
  };
  const result = buildCharacterRefSheetPrompt(character, 'realistic');

  assert.ok(result.prompt.includes('use the provided reference image(s)'));
  assert.ok(result.prompt.includes('turnaround sheet'));
  assert.ok(result.prompt.includes('3 full-body core views'));
  assert.ok(result.prompt.includes('front'));
  assert.ok(result.prompt.includes('back'));
  assert.ok(result.prompt.includes('slim, athletic, short black hair, scruffy beard'));
  assert.ok(result.prompt.includes('photorealistic'));
  assert.ok(result.prompt.includes('one single male character reference sheet'));
  assert.ok(result.prompt.includes('pure white background'));
  assert.ok(result.prompt.includes('aspect ratio 1.25:1'));
  assert.ok(result.prompt.includes('facial close-up'));
  assert.ok(result.prompt.includes('golden ratio reference lines'));
  assert.ok(result.prompt.includes('no props'));
  assert.equal(result.prompt.includes('metal ladder'), false);
  assert.ok(result.negative.includes('cartoon'));
  assert.ok(result.negative.includes('multiple people'));
  assert.ok(result.negative.includes('ladder'));
  assert.ok(result.negative.includes('pillar'));
  assert.ok(result.negative.includes('different hairstyle'));
});

test('buildCharacterRefSheetPrompt produces 3d style when requested', () => {
  const character = {
    name: '刀疤',
    basePromptTokens: 'tall, muscular, scarred face',
    visualDescription: 'intimidating man with scar',
  };
  const result = buildCharacterRefSheetPrompt(character, '3d');

  assert.ok(result.prompt.includes('3D render'));
  assert.ok(result.prompt.includes('turnaround sheet'));
  assert.ok(result.prompt.includes('production-ready presentation board'));
  assert.ok(result.negative.includes('photograph'));
});

test('buildCharacterRefSheetPrompt does not leak scene props from visualDescription fallback', () => {
  const character = {
    name: '阿鬼',
    visualDescription: 'young man, gray hoodie, metal ladder, warehouse door',
  };

  const result = buildCharacterRefSheetPrompt(character, 'realistic');

  assert.ok(result.prompt.includes('young man'));
  assert.ok(result.prompt.includes('gray hoodie'));
  assert.equal(result.prompt.includes('metal ladder'), false);
  assert.equal(result.prompt.includes('warehouse door'), false);
});

test('generateCharacterRefSheets generates one ref sheet per character', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-refsheet-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const outputDir = path.join(tempDir, 'ref-sheets');
  const artifactDir = path.join(tempDir, 'artifacts');
  const artifactContext = {
    outputsDir: path.join(artifactDir, '1-outputs'),
    metricsDir: path.join(artifactDir, '2-metrics'),
    manifestPath: path.join(artifactDir, 'manifest.json'),
  };
  fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
  fs.mkdirSync(artifactContext.metricsDir, { recursive: true });

  const fakeImagePath = path.join(tempDir, 'fake.png');
  fs.writeFileSync(fakeImagePath, 'fake-image-data');

  const registry = [
    { episodeCharacterId: 'char_001', name: '阿坤', basePromptTokens: 'slim, athletic', visualDescription: 'young man' },
    { episodeCharacterId: 'char_002', name: '刀疤', basePromptTokens: 'tall, muscular', visualDescription: 'scarred man' },
  ];
  const generateCalls = [];

  const results = await generateCharacterRefSheets(registry, outputDir, {
    style: 'realistic',
    artifactContext,
    executionPolicy: { mode: 'test' },
    generateImage: async (prompt, negative, outputPath, requestOptions) => {
      generateCalls.push({ prompt, negative, outputPath, requestOptions });
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, 'mock-ref-sheet-data');
      return outputPath;
    },
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].characterId, 'char_001');
  assert.equal(results[0].success, true);
  assert.ok(results[0].imagePath);
  assert.equal(results[1].characterId, 'char_002');
  assert.equal(results[1].success, true);
  assert.equal(generateCalls[0].requestOptions.size, '1280x1024');
  assert.deepEqual(generateCalls[0].requestOptions.references, []);

  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.characterCount, 2);
  assert.equal(manifest.successCount, 2);
});

test('generateCharacterRefSheets forwards character reference images to image generation', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-refsheet-refs-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const calls = [];
  await generateCharacterRefSheets(
    [{
      episodeCharacterId: 'char_ref',
      name: '沈清',
      basePromptTokens: 'elegant woman',
      visualDescription: 'young woman',
      referenceImages: ['refs/front.png', { path: 'refs/side.png' }],
      referenceImagePath: 'refs/current.png',
    }],
    path.join(tempDir, 'ref'),
    {
      style: 'realistic',
      executionPolicy: { mode: 'test' },
      generateImage: async (_prompt, _negative, outputPath, requestOptions) => {
        calls.push(requestOptions);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, 'mock-ref-sheet-data');
        return outputPath;
      },
    }
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].references, ['refs/front.png', 'refs/side.png', 'refs/current.png']);
});

test('generateCharacterRefSheets gracefully handles generation failure', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-refsheet-fail-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const registry = [
    { episodeCharacterId: 'char_fail', name: '测试角色', basePromptTokens: 'test', visualDescription: 'test' },
  ];

  const results = await generateCharacterRefSheets(registry, path.join(tempDir, 'ref'), {
    style: 'realistic',
    executionPolicy: { mode: 'test' },
    generateImage: async () => {
      throw new Error('API rate limit');
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].success, false);
  assert.ok(results[0].error.includes('API rate limit'));
  assert.equal(results[0].imagePath, null);
});

test('generateCharacterRefSheets failure path does not incur production backoff in test policy', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-refsheet-backoff-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const registry = [
    { episodeCharacterId: 'char_fail_fast', name: '快速失败角色', basePromptTokens: 'test', visualDescription: 'test' },
  ];

  const startedAt = Date.now();
  const results = await generateCharacterRefSheets(registry, path.join(tempDir, 'ref'), {
    style: 'realistic',
    executionPolicy: { mode: 'test' },
    generateImage: async () => {
      throw new Error('API rate limit');
    },
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(results.length, 1);
  assert.equal(results[0].success, false);
  assert.ok(results[0].error.includes('API rate limit'));
  assert.ok(elapsedMs < 1000, `expected failure path to skip production backoff, got ${elapsedMs}ms`);
});

test('generateCharacterRefSheets preserves full executionPolicy overrides', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-refsheet-policy-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const executionPolicy = {
    mode: 'production',
    useRealQueue: false,
    useRealSleep: false,
    defaultMaxRetries: 1,
  };
  let attempts = 0;

  const results = await generateCharacterRefSheets(
    [{ episodeCharacterId: 'char_policy', name: '策略角色', basePromptTokens: 'test', visualDescription: 'test' }],
    path.join(tempDir, 'ref'),
    {
      style: 'realistic',
      executionPolicy,
      generateImage: async () => {
        attempts += 1;
        throw new Error('API rate limit');
      },
    }
  );

  assert.equal(results[0].success, false);
  assert.equal(attempts, 1);
});

test('generateCharacterRefSheets uses test policy retry budget instead of production retry count', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-refsheet-retries-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  let attempts = 0;
  const results = await generateCharacterRefSheets(
    [{ episodeCharacterId: 'char_retry', name: '预算角色', basePromptTokens: 'test', visualDescription: 'test' }],
    path.join(tempDir, 'ref'),
    {
      style: 'realistic',
      executionPolicy: { mode: 'test' },
      generateImage: async () => {
        attempts += 1;
        throw new Error('API rate limit');
      },
    }
  );

  assert.equal(results[0].success, false);
  assert.equal(attempts, 1);
});
