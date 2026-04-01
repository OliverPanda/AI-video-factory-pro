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

    assert.equal(
      fs.existsSync(path.join(ctx.agents.characterRegistry.outputsDir, 'character-registry.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.characterRegistry.outputsDir, 'character-registry.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.characterRegistry.outputsDir, 'character-name-mapping.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.characterRegistry.metricsDir, 'character-metrics.json')),
      true
    );
    assert.equal(fs.existsSync(ctx.agents.characterRegistry.manifestPath), true);
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

    assert.equal(
      fs.existsSync(path.join(ctx.agents.promptEngineer.outputsDir, 'prompts.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.promptEngineer.outputsDir, 'prompt-sources.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.promptEngineer.outputsDir, 'prompts.table.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.promptEngineer.metricsDir, 'prompt-metrics.json')),
      true
    );
    assert.equal(fs.existsSync(ctx.agents.promptEngineer.manifestPath), true);

    const errorFiles = fs.readdirSync(ctx.agents.promptEngineer.errorsDir);
    assert.equal(errorFiles.some((fileName) => /shot_002/i.test(fileName)), true);
  });
});
