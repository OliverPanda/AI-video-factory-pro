import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCharacterRegistry } from '../src/agents/characterRegistry.js';
import { generateAllPrompts } from '../src/agents/promptEngineer.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { withManagedTempRoot } from './helpers/testArtifacts.js';

test('character registry writes registry outputs metrics and manifest when artifactContext is present', async (t) => {
  await withManagedTempRoot(t, 'aivf-character-registry-artifacts', async (tempRoot) => {
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
      [{ id: 'char_1', name: '小红', gender: 'female', characterBibleId: 'bible_red' }],
      '咖啡馆日常',
      'realistic',
      {
        artifactContext: ctx.agents.characterRegistry,
        mainCharacterTemplates: [
          {
            id: 'tpl_red',
            name: '小红',
            gender: 'female',
            basePromptTokens: 'young cafe worker',
          },
        ],
        episodeCharacters: [
          {
            id: 'char_1',
            name: '小红',
            gender: 'female',
            mainCharacterTemplateId: 'tpl_red',
            characterBibleId: 'bible_red',
          },
        ],
        characterBibles: [
          {
            id: 'bible_red',
            basePromptTokens: 'short hair, cafe apron',
            negativeDriftTokens: 'different hairstyle',
            coreTraits: { hairStyle: 'short hair', skinTone: 'fair skin' },
          },
        ],
      }
    );

    const sourceCharactersPath = path.join(ctx.agents.characterRegistry.inputsDir, 'source-characters.json');
    const characterBiblesPath = path.join(ctx.agents.characterRegistry.inputsDir, 'character-bibles.json');
    const templatesPath = path.join(
      ctx.agents.characterRegistry.inputsDir,
      'main-character-templates.json'
    );
    const registryPath = path.join(ctx.agents.characterRegistry.outputsDir, 'character-registry.json');
    const markdownPath = path.join(ctx.agents.characterRegistry.outputsDir, 'character-registry.md');
    const mappingPath = path.join(ctx.agents.characterRegistry.outputsDir, 'character-name-mapping.json');
    const metricsPath = path.join(ctx.agents.characterRegistry.metricsDir, 'character-metrics.json');
    const manifestPath = ctx.agents.characterRegistry.manifestPath;

    assert.equal(fs.existsSync(sourceCharactersPath), true);
    assert.equal(fs.existsSync(characterBiblesPath), true);
    assert.equal(fs.existsSync(templatesPath), true);

    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    assert.equal(registry.length, 1);
    assert.equal(registry[0].name, '小红');
    assert.equal(registry[0].basePromptTokens, 'short hair, cafe apron');
    assert.equal(registry[0].characterBibleId, 'bible_red');
    assert.equal(registry[0].negativeDriftTokens, 'different hairstyle');

    const markdown = fs.readFileSync(markdownPath, 'utf-8');
    assert.match(markdown, /## 小红/);
    assert.match(markdown, /Visual: short hair, cafe apron/);
    assert.match(markdown, /Negative Drift Tokens: different hairstyle/);

    const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
    assert.deepEqual(mapping, [
      {
        sourceId: 'char_1',
        sourceEpisodeCharacterId: 'char_1',
        sourceName: '小红',
        registryId: 'char_1',
        registryEpisodeCharacterId: 'char_1',
        registryName: '小红',
        generatedName: null,
        matchedBy: 'source_fallback',
        hasUsefulProfile: true,
      },
    ]);

    const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
    assert.deepEqual(metrics, {
      character_count: 1,
      registry_coverage_rate: 1,
      fallback_merged_count: 1,
      missing_profile_count: 0,
      character_bible_linked_count: 1,
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.deepEqual(manifest, {
      status: 'completed',
      characterCount: 1,
      outputFiles: [
        'character-registry.json',
        'character-registry.md',
        'character-name-mapping.json',
        'character-metrics.json',
      ],
    });
  }, 'character-registry');
});

test('prompt engineer writes prompt outputs metrics fallback evidence and manifest when artifactContext is present', async (t) => {
  await withManagedTempRoot(t, 'aivf-prompt-engineer-artifacts', async (tempRoot) => {
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
      {
        id: 'shot_001',
        scene: '咖啡馆',
        action: '整理咖啡杯',
        characters: ['小红'],
        camera_type: '中景',
        continuityState: {
          sceneLighting: 'warm indoor morning',
          continuityRiskTags: ['prop continuity'],
        },
      },
      {
        id: 'shot_002',
        scene: '吧台',
        action: '抬头微笑',
        dialogue: '你好',
        speaker: '小红',
        characters: ['小红'],
        camera_type: '特写',
        continuityState: {
          carryOverFromShotId: 'shot_001',
          sceneLighting: 'warm indoor morning',
          propStates: [{ name: 'coffee_cup', holderEpisodeCharacterId: 'char_1' }],
          continuityRiskTags: ['prop continuity'],
        },
      },
    ];
    const registry = [
      {
        id: 'char_1',
        episodeCharacterId: 'char_1',
        name: '小红',
        visualDescription: 'short hair, cafe apron',
        basePromptTokens: 'short hair, cafe apron',
        negativeDriftTokens: 'different hairstyle',
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
    assert.match(prompts[0].image_prompt_en, /warm cafe counter scene/);
    assert.equal(prompts[0].image_prompt, prompts[0].image_prompt_en);
    assert.equal(prompts[0].negative_prompt, prompts[0].negative_prompt_en);
    assert.match(prompts[0].display_prompt_zh, /场景：咖啡馆/);
    assert.match(prompts[0].display_prompt_zh, /动作：整理咖啡杯/);
    assert.match(prompts[0].display_negative_prompt_zh, /避免/);
    assert.match(prompts[0].image_prompt, /warm cafe counter scene/);
    assert.match(prompts[0].image_prompt, /warm indoor morning/);
    assert.equal(prompts[1].shotId, 'shot_002');
    assert.equal(prompts[1].image_prompt, prompts[1].image_prompt_en);
    assert.equal(prompts[1].negative_prompt, prompts[1].negative_prompt_en);
    assert.equal(/[\u3400-\u9FFF]/.test(prompts[1].image_prompt_en), false);
    assert.match(prompts[1].image_prompt_en, /warm indoor morning/);
    assert.match(prompts[1].image_prompt, /warm indoor morning/);
    assert.match(prompts[1].display_prompt_zh, /场景：吧台/);
    assert.match(prompts[1].display_prompt_zh, /动作：抬头微笑/);
    assert.match(prompts[1].display_negative_prompt_zh, /避免/);
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
    assert.match(
      promptsTable,
      /\| Shot ID \| Source \| Display Prompt ZH \| Execution Prompt EN \| Negative Prompt EN \| Style Notes \|/
    );
    assert.match(promptsTable, /\| shot_001 \| llm \|/);
    assert.match(promptsTable, /\| shot_002 \| fallback \|/);
    assert.match(promptsTable, /场景：咖啡馆/);
    assert.match(promptsTable, /warm cafe counter scene/);
    assert.match(promptsTable, /blurry/);

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
    assert.equal(/[\u3400-\u9FFF]/.test(fallbackEvidence.fallbackPrompt.image_prompt_en), false);
    assert.match(fallbackEvidence.fallbackPrompt.display_prompt_zh, /场景：吧台/);
    assert.equal(
      fallbackEvidence.fallbackPrompt.image_prompt,
      fallbackEvidence.fallbackPrompt.image_prompt_en
    );

    const promptManifest = JSON.parse(
      fs.readFileSync(ctx.agents.promptEngineer.manifestPath, 'utf-8')
    );
    assert.deepEqual(promptManifest, {
      status: 'completed',
      promptCount: 2,
      outputFiles: ['prompts.json', 'prompt-sources.json', 'prompts.table.md', 'prompt-metrics.json'],
    });
  }, 'prompt-engineer');
});

test('prompt engineer keeps bilingual LLM fields and legacy aliases together', async () => {
  const shots = [
    {
      id: 'shot_bilingual_001',
      scene: '仓库门口',
      action: '抬手示意停下',
      characters: ['陈默'],
      camera_type: '近景',
    },
  ];
  const registry = [
    {
      id: 'char_chen',
      episodeCharacterId: 'char_chen',
      name: '陈默',
      visualDescription: 'black tactical jacket, stern expression',
      basePromptTokens: 'black tactical jacket, stern expression',
    },
  ];

  const prompts = await generateAllPrompts(shots, registry, 'realistic', {
    chatJSON: async () => ({
      image_prompt_en: 'cinematic warehouse gate standoff',
      negative_prompt_en: 'blurry',
      display_prompt_zh: '仓库门口对峙，陈默抬手示意停下',
      display_negative_prompt_zh: '避免模糊、肢体畸形',
      style_notes: '强调压迫感和紧张停顿',
    }),
  });

  assert.equal(prompts.length, 1);
  assert.match(prompts[0].image_prompt_en, /cinematic warehouse gate standoff/);
  assert.match(prompts[0].negative_prompt_en, /blurry/);
  assert.equal(prompts[0].display_prompt_zh, '仓库门口对峙，陈默抬手示意停下');
  assert.equal(prompts[0].display_negative_prompt_zh, '避免模糊、肢体畸形');
  assert.equal(prompts[0].image_prompt, prompts[0].image_prompt_en);
  assert.equal(prompts[0].negative_prompt, prompts[0].negative_prompt_en);
});

test('prompt engineer removes scene-prop identity pollution from generated prompts', async () => {
  const shots = [
    {
      id: 'shot_001',
      scene: '废弃仓库',
      action: '阿鬼举刀逼近',
      characters: ['阿鬼'],
      camera_type: '近景',
      continuityState: {
        sceneLighting: 'dim warehouse night',
      },
    },
  ];

  const registry = [
    {
      id: 'char_ghost',
      episodeCharacterId: 'char_ghost',
      name: '阿鬼',
      visualDescription: 'man in gray hoodie standing on a metal ladder',
      basePromptTokens: 'man, 28, gray hoodie, hood up, three-sided dagger, metal ladder, concrete pillar',
    },
  ];

  const prompts = await generateAllPrompts(shots, registry, 'realistic', {
    chatJSON: async () => ({
      image_prompt: 'gray hoodie assassin lunging forward, close-up shot, close-up shot',
      negative_prompt: 'blurry, blurry',
      style_notes: '强调动作主体',
    }),
  });

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].image_prompt.includes('metal ladder'), false);
  assert.equal(prompts[0].image_prompt.includes('concrete pillar'), false);
  assert.match(prompts[0].image_prompt, /gray hoodie/);
  assert.match(prompts[0].image_prompt, /single subject emphasis/);
  assert.equal(prompts[0].image_prompt.includes('close-up shot, close-up shot'), false);
  assert.equal(prompts[0].negative_prompt.includes('blurry, blurry'), false);
  assert.match(prompts[0].display_prompt_zh, /场景：废弃仓库/);
  assert.match(prompts[0].display_prompt_zh, /动作：阿鬼举刀逼近/);
});
