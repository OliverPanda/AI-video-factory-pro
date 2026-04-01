import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCharacterRegistry } from '../src/agents/characterRegistry.js';
import { generateAllPrompts } from '../src/agents/promptEngineer.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-registry-prompt-artifacts-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('character registry writes registry outputs metrics and manifest when artifactContext is present', async () => {
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
      runJobId: 'run_registry_artifacts',
      startedAt: '2026-04-01T09:00:00.000Z',
    });

    await buildCharacterRegistry(
      [
        { id: 'char_1', name: '小红', gender: 'female' },
        { id: 'char_2', name: '店长', gender: 'male' },
      ],
      '咖啡馆日常',
      'realistic',
      {
        chatJSON: async () => ({
          characters: [
            {
              name: '小红',
              visualDescription: 'short hair, cafe apron',
              basePromptTokens: 'short hair, cafe apron',
              personality: '开朗',
            },
          ],
        }),
        artifactContext: ctx.agents.characterRegistry,
      }
    );

    const registryPath = path.join(ctx.agents.characterRegistry.outputsDir, 'character-registry.json');
    const markdownPath = path.join(ctx.agents.characterRegistry.outputsDir, 'character-registry.md');
    const mappingPath = path.join(ctx.agents.characterRegistry.outputsDir, 'character-name-mapping.json');
    const metricsPath = path.join(ctx.agents.characterRegistry.metricsDir, 'character-metrics.json');
    const manifestPath = ctx.agents.characterRegistry.manifestPath;

    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    assert.equal(registry.length, 2);
    assert.equal(registry[0].name, '小红');
    assert.equal(registry[0].basePromptTokens, 'short hair, cafe apron');
    assert.equal(registry[1].name, '店长');

    const markdown = fs.readFileSync(markdownPath, 'utf-8');
    assert.match(markdown, /## 小红/);
    assert.match(markdown, /Visual: short hair, cafe apron/);
    assert.match(markdown, /## 店长/);

    const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
    assert.deepEqual(mapping, [
      {
        sourceId: 'char_1',
        sourceEpisodeCharacterId: 'char_1',
        sourceName: '小红',
        registryId: 'char_1',
        registryEpisodeCharacterId: 'char_1',
        registryName: '小红',
        generatedName: '小红',
        matchedBy: 'generated_name',
        hasUsefulProfile: true,
      },
      {
        sourceId: 'char_2',
        sourceEpisodeCharacterId: 'char_2',
        sourceName: '店长',
        registryId: 'char_2',
        registryEpisodeCharacterId: 'char_2',
        registryName: '店长',
        generatedName: null,
        matchedBy: 'source_fallback',
        hasUsefulProfile: false,
      },
    ]);

    const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
    assert.deepEqual(metrics, {
      character_count: 2,
      registry_coverage_rate: 0.5,
      fallback_merged_count: 1,
      missing_profile_count: 1,
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.deepEqual(manifest, {
      status: 'completed',
      characterCount: 2,
      outputFiles: [
        'character-registry.json',
        'character-registry.md',
        'character-name-mapping.json',
        'character-metrics.json',
      ],
    });
  });
});

test('prompt engineer writes prompt outputs metrics fallback evidence and manifest when artifactContext is present', async () => {
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
      runJobId: 'run_prompt_artifacts',
      startedAt: '2026-04-01T09:00:00.000Z',
    });

    const shots = [
      { id: 'shot_001', scene: '咖啡馆', action: '整理咖啡杯', characters: ['小红'], camera_type: '中景' },
      { id: 'shot_002', scene: '吧台', action: '抬头微笑', dialogue: '你好', speaker: '小红', characters: ['小红'], camera_type: '特写' },
    ];
    const registry = [
      {
        id: 'char_1',
        episodeCharacterId: 'char_1',
        name: '小红',
        visualDescription: 'short hair, cafe apron',
        basePromptTokens: 'short hair, cafe apron',
      },
    ];
    let callCount = 0;

    await generateAllPrompts(shots, registry, 'realistic', {
      chatJSON: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            image_prompt: 'warm cafe counter scene',
            negative_prompt: 'blurry',
            style_notes: '',
          };
        }

        throw new Error('invalid llm output');
      },
      artifactContext: ctx.agents.promptEngineer,
    });

    const errorFiles = fs.readdirSync(ctx.agents.promptEngineer.errorsDir);
    const errorFileName = errorFiles.find((fileName) => /shot_002/i.test(fileName));
    assert.ok(errorFileName);

    const prompts = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.promptEngineer.outputsDir, 'prompts.json'), 'utf-8')
    );
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0].shotId, 'shot_001');
    assert.match(prompts[0].image_prompt, /warm cafe counter scene/);
    assert.equal(prompts[1].shotId, 'shot_002');
    assert.match(prompts[1].image_prompt, /吧台, 抬头微笑/);
    assert.equal(prompts[1].style_notes, '降级生成（LLM调用失败）');

    const promptSources = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.promptEngineer.outputsDir, 'prompt-sources.json'), 'utf-8')
    );
    assert.deepEqual(promptSources, [
      { shotId: 'shot_001', source: 'llm' },
      { shotId: 'shot_002', source: 'fallback', error: 'invalid llm output' },
    ]);

    const promptsTable = fs.readFileSync(
      path.join(ctx.agents.promptEngineer.outputsDir, 'prompts.table.md'),
      'utf-8'
    );
    assert.match(promptsTable, /\| Shot ID \| Source \| Image Prompt \| Negative Prompt \| Style Notes \|/);
    assert.match(promptsTable, /\| shot_001 \| llm \|/);
    assert.match(promptsTable, /\| shot_002 \| fallback \|/);

    const promptMetrics = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.promptEngineer.metricsDir, 'prompt-metrics.json'), 'utf-8')
    );
    assert.equal(promptMetrics.prompt_count, 2);
    assert.equal(promptMetrics.llm_success_count, 1);
    assert.equal(promptMetrics.fallback_count, 1);
    assert.equal(promptMetrics.fallback_rate, 0.5);
    assert.equal(promptMetrics.avg_prompt_length > 0, true);

    const fallbackEvidence = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.promptEngineer.errorsDir, errorFileName), 'utf-8')
    );
    assert.equal(fallbackEvidence.shotId, 'shot_002');
    assert.equal(fallbackEvidence.style, 'realistic');
    assert.deepEqual(fallbackEvidence.shot, shots[1]);
    assert.equal(fallbackEvidence.error, 'invalid llm output');
    assert.equal(fallbackEvidence.source, 'fallback');
    assert.equal(fallbackEvidence.fallbackPrompt.shotId, 'shot_002');
    assert.match(fallbackEvidence.fallbackPrompt.image_prompt, /吧台, 抬头微笑/);

    const promptManifest = JSON.parse(
      fs.readFileSync(ctx.agents.promptEngineer.manifestPath, 'utf-8')
    );
    assert.deepEqual(promptManifest, {
      status: 'completed',
      promptCount: 2,
      outputFiles: ['prompts.json', 'prompt-sources.json', 'prompts.table.md', 'prompt-metrics.json'],
    });
  });
});
