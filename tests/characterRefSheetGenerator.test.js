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
    basePromptTokens: 'slim, athletic, short black hair, scruffy beard, gray hoodie, cargo pants',
    visualDescription: 'young man, athletic build, short dark hair',
  };
  const result = buildCharacterRefSheetPrompt(character, 'realistic');

  assert.ok(result.prompt.includes('turnaround sheet'));
  assert.ok(result.prompt.includes('3 views'));
  assert.ok(result.prompt.includes('front'));
  assert.ok(result.prompt.includes('back'));
  assert.ok(result.prompt.includes('slim, athletic'));
  assert.ok(result.prompt.includes('photorealistic'));
  assert.ok(result.prompt.includes('one single male person'));
  assert.ok(result.negative.includes('cartoon'));
  assert.ok(result.negative.includes('landscape'));
  assert.ok(result.negative.includes('multiple people'));
});

test('buildCharacterRefSheetPrompt produces 3d style when requested', () => {
  const character = {
    name: '刀疤',
    basePromptTokens: 'tall, muscular, scarred face',
    visualDescription: 'intimidating man with scar',
  };
  const result = buildCharacterRefSheetPrompt(character, '3d');

  assert.ok(result.prompt.includes('Pixar style'));
  assert.ok(result.prompt.includes('turnaround sheet'));
  assert.ok(result.negative.includes('photograph'));
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

  const results = await generateCharacterRefSheets(registry, outputDir, {
    style: 'realistic',
    artifactContext,
    generateImage: async (prompt, negative, outputPath) => {
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

  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.characterCount, 2);
  assert.equal(manifest.successCount, 2);
});

test('generateCharacterRefSheets gracefully handles generation failure', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-refsheet-fail-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const registry = [
    { episodeCharacterId: 'char_fail', name: '测试角色', basePromptTokens: 'test', visualDescription: 'test' },
  ];

  const results = await generateCharacterRefSheets(registry, path.join(tempDir, 'ref'), {
    style: 'realistic',
    generateImage: async () => {
      throw new Error('API rate limit');
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].success, false);
  assert.ok(results[0].error.includes('API rate limit'));
  assert.equal(results[0].imagePath, null);
});
