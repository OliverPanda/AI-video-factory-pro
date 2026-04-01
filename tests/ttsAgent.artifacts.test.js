import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { runConsistencyCheck } from '../src/agents/consistencyChecker.js';
import { generateAllAudio } from '../src/agents/ttsAgent.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-tts-artifacts-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('consistency checker writes report flagged shots metrics and manifest when artifactContext is present', async () => {
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
      runJobId: 'run_consistency_artifacts',
      startedAt: '2026-04-01T09:00:00.000Z',
    });

    const imageDir = path.join(tempRoot, 'images');
    fs.mkdirSync(imageDir, { recursive: true });
    const imagePath = path.join(imageDir, 'shot_001.png');
    fs.writeFileSync(imagePath, 'fake');

    await runConsistencyCheck(
      [{ name: '小红', visualDescription: 'short hair', basePromptTokens: 'short hair' }],
      [
        { shotId: 'shot_001', imagePath, success: true, characters: ['小红'] },
        { shotId: 'shot_002', imagePath, success: true, characters: ['小红'] },
      ],
      {
        artifactContext: ctx.agents.consistencyChecker,
        checkCharacterConsistency: async () => ({
          character: '小红',
          overallScore: 6,
          problematicImageIndices: [1],
          suggestion: 'match costume',
        }),
      }
    );

    assert.equal(
      fs.existsSync(path.join(ctx.agents.consistencyChecker.outputsDir, 'consistency-report.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.consistencyChecker.outputsDir, 'flagged-shots.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.consistencyChecker.metricsDir, 'consistency-metrics.json')),
      true
    );
    assert.equal(fs.existsSync(ctx.agents.consistencyChecker.manifestPath), true);
  });
});

test('tts agent writes voice resolution audio index dialogue table metrics manifest and per-shot error files when artifactContext is present', async () => {
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
      runJobId: 'run_tts_artifacts',
      startedAt: '2026-04-01T09:00:00.000Z',
    });
    const audioDir = path.join(tempRoot, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });

    const shots = [
      { id: 'shot_001', dialogue: '你好。', speaker: '小红', characters: ['小红'] },
      { id: 'shot_002', dialogue: '出错了。', speaker: '店长', characters: ['店长'] },
      { id: 'shot_003', dialogue: '', characters: ['小红'] },
    ];
    const registry = [
      { name: '小红', gender: 'female', voicePresetId: 'preset-red' },
      { name: '店长', gender: 'male' },
    ];

    await generateAllAudio(shots, registry, audioDir, {
      artifactContext: ctx.agents.ttsAgent,
      projectId: 'project-123',
      voicePresetLoader: async (voicePresetId) => ({
        voice: `${voicePresetId}-voice`,
        rate: 65,
      }),
      textToSpeech: async (text, outputPath) => {
        if (text === '出错了。') {
          throw new Error('tts synth failed');
        }
        fs.writeFileSync(outputPath, text);
        return outputPath;
      },
    });

    assert.equal(
      fs.existsSync(path.join(ctx.agents.ttsAgent.inputsDir, 'voice-resolution.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.ttsAgent.outputsDir, 'audio.index.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.ttsAgent.outputsDir, 'dialogue-table.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.ttsAgent.metricsDir, 'tts-metrics.json')),
      true
    );
    assert.equal(fs.existsSync(ctx.agents.ttsAgent.manifestPath), true);

    const errorFiles = fs.readdirSync(ctx.agents.ttsAgent.errorsDir);
    assert.equal(errorFiles.some((fileName) => /shot_002/i.test(fileName)), true);
  });
});
