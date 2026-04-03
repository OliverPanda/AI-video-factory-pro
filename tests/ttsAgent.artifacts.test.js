import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { runConsistencyCheck } from '../src/agents/consistencyChecker.js';
import { generateAllAudio } from '../src/agents/ttsAgent.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { withManagedTempRoot } from './helpers/testArtifacts.js';

test('consistency checker writes report flagged shots metrics and manifest when artifactContext is present', async (t) => {
  await withManagedTempRoot(t, 'aivf-tts-artifacts', async (tempRoot) => {
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
          identityDriftTags: ['hair_drift', 'outfit_drift'],
          anchorSummary: {
            hair: 'hairstyle changed slightly',
            outfit: 'apron missing',
          },
          problematicImageIndices: [1],
          suggestion: 'match costume',
        }),
      }
    );

    const registryInputPath = path.join(ctx.agents.consistencyChecker.inputsDir, 'character-registry.json');
    const imageResultsInputPath = path.join(ctx.agents.consistencyChecker.inputsDir, 'image-results.json');
    const reportPath = path.join(ctx.agents.consistencyChecker.outputsDir, 'consistency-report.json');
    const markdownPath = path.join(ctx.agents.consistencyChecker.outputsDir, 'consistency-report.md');
    const flaggedPath = path.join(ctx.agents.consistencyChecker.outputsDir, 'flagged-shots.json');
    const metricsPath = path.join(ctx.agents.consistencyChecker.metricsDir, 'consistency-metrics.json');
    const manifestPath = ctx.agents.consistencyChecker.manifestPath;

    assert.equal(fs.existsSync(registryInputPath), true);
    assert.equal(fs.existsSync(imageResultsInputPath), true);
    assert.equal(fs.existsSync(reportPath), true);
    assert.equal(fs.existsSync(markdownPath), true);
    assert.equal(fs.existsSync(flaggedPath), true);
    assert.equal(fs.existsSync(metricsPath), true);
    assert.equal(fs.existsSync(manifestPath), true);

    const registryInput = JSON.parse(fs.readFileSync(registryInputPath, 'utf-8'));
    assert.equal(registryInput.length, 1);
    assert.equal(registryInput[0].name, '小红');

    const imageResultsInput = JSON.parse(fs.readFileSync(imageResultsInputPath, 'utf-8'));
    assert.equal(imageResultsInput.length, 2);
    assert.equal(imageResultsInput[1].shotId, 'shot_002');

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    assert.equal(report.length, 1);
    assert.equal(report[0].character, '小红');
    assert.equal(report[0].overallScore, 6);

    const markdown = fs.readFileSync(markdownPath, 'utf-8');
    assert.match(markdown, /# Consistency Report/);
    assert.match(markdown, /## 小红/);
    assert.match(markdown, /Overall Score: 6/);
    assert.match(markdown, /Identity Drift Tags: hair_drift, outfit_drift/);

    const flaggedShots = JSON.parse(fs.readFileSync(flaggedPath, 'utf-8'));
    assert.deepEqual(flaggedShots, [
      {
        shotId: 'shot_002',
        reason: '小红 一致性评分 6/10',
        suggestion: 'match costume',
      },
    ]);

    const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
    assert.deepEqual(metrics, {
      checked_character_count: 1,
      checked_shot_count: 2,
      flagged_shot_count: 1,
      avg_consistency_score: 6,
      identity_drift_tag_counts: {
        hair_drift: 1,
        outfit_drift: 1,
      },
      regeneration_count: 1,
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.deepEqual(manifest, {
      status: 'completed',
      checkedCharacterCount: 1,
      flaggedShotCount: 1,
      outputFiles: [
        'consistency-report.json',
        'consistency-report.md',
        'flagged-shots.json',
        'consistency-metrics.json',
      ],
    });
  });
});

test('tts agent writes voice resolution audio index dialogue table metrics manifest and per-shot error files when artifactContext is present', async (t) => {
  await withManagedTempRoot(t, 'aivf-tts-artifacts', async (tempRoot) => {
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
    assert.equal(
      fs.existsSync(path.join(ctx.agents.ttsAgent.metricsDir, 'qa-summary.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.ttsAgent.outputsDir, 'qa-summary.md')),
      true
    );
    assert.equal(fs.existsSync(ctx.agents.ttsAgent.manifestPath), true);

    const voiceResolution = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.ttsAgent.inputsDir, 'voice-resolution.json'), 'utf-8')
    );
    assert.equal(voiceResolution.length, 3);
    assert.deepEqual(voiceResolution[0], {
      shotId: 'shot_001',
      hasDialogue: true,
      dialogue: '你好。',
      speakerName: '小红',
      resolvedGender: 'female',
      ttsOptions: {
        gender: 'female',
        voice: 'preset-red-voice',
        rate: 65,
      },
      usedDefaultVoiceFallback: false,
      status: 'synthesized',
      audioPath: path.join(audioDir, 'shot_001.mp3'),
      voicePresetId: 'preset-red',
      voiceSource: 'voice_preset',
    });
    assert.equal(voiceResolution[1].shotId, 'shot_002');
    assert.equal(voiceResolution[1].status, 'failed');
    assert.equal(voiceResolution[1].usedDefaultVoiceFallback, true);
    assert.equal(voiceResolution[1].voicePresetId, null);
    assert.equal(voiceResolution[2].shotId, 'shot_003');
    assert.equal(voiceResolution[2].status, 'skipped');
    assert.equal(voiceResolution[2].voicePresetId, null);

    const audioIndex = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.ttsAgent.outputsDir, 'audio.index.json'), 'utf-8')
    );
    assert.deepEqual(audioIndex, [
      { shotId: 'shot_001', audioPath: path.join(audioDir, 'shot_001.mp3'), hasDialogue: true },
      {
        shotId: 'shot_002',
        audioPath: null,
        hasDialogue: true,
        error: '[Queue] shot_002 重试3次后失败：tts synth failed',
      },
      { shotId: 'shot_003', audioPath: null, hasDialogue: false },
    ]);

    const dialogueTable = fs.readFileSync(
      path.join(ctx.agents.ttsAgent.outputsDir, 'dialogue-table.md'),
      'utf-8'
    );
    assert.match(dialogueTable, /\| Shot ID \| Speaker \| Voice \| Dialogue \| Status \| Audio Path \|/);
    assert.match(dialogueTable, /\| shot_001 \| 小红 \| preset-red-voice \| 你好。 \| synthesized \|/);
    assert.match(dialogueTable, /\| shot_002 \| 店长 \| male \| 出错了。 \| failed \|/);
    assert.match(dialogueTable, /\| shot_003 \|  \|  \|  \| skipped \|  \|/);

    const metrics = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.ttsAgent.metricsDir, 'tts-metrics.json'), 'utf-8')
    );
    assert.deepEqual(metrics, {
      dialogue_shot_count: 2,
      synthesized_count: 1,
      skipped_count: 1,
      failure_count: 1,
      default_voice_fallback_count: 1,
      unique_voice_count: 1,
      voice_usage: {
        'preset-red-voice': 1,
        male: 1,
        unresolved: 1,
      },
    });

    const manifest = JSON.parse(fs.readFileSync(ctx.agents.ttsAgent.manifestPath, 'utf-8'));
    assert.deepEqual(manifest, {
      status: 'completed_with_errors',
      dialogueShotCount: 2,
      synthesizedCount: 1,
      skippedCount: 1,
      failureCount: 1,
      outputFiles: [
        'voice-resolution.json',
        'audio.index.json',
        'dialogue-table.md',
        'tts-metrics.json',
      ],
    });

    const qaSummary = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.ttsAgent.metricsDir, 'qa-summary.json'), 'utf-8')
    );
    assert.equal(qaSummary.agentName, 'TTS Agent');
    assert.equal(qaSummary.status, 'warn');
    assert.match(qaSummary.headline, /没有成功生成音频/);

    const errorFiles = fs.readdirSync(ctx.agents.ttsAgent.errorsDir);
    assert.equal(errorFiles.some((fileName) => /shot_002/i.test(fileName)), true);

    const terminalErrorPath = errorFiles.find((fileName) => /shot_002/i.test(fileName));
    const terminalError = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.ttsAgent.errorsDir, terminalErrorPath), 'utf-8')
    );
    assert.equal(terminalError.shotId, 'shot_002');
    assert.equal(terminalError.error, '[Queue] shot_002 重试3次后失败：tts synth failed');
    assert.equal(terminalError.voiceResolution.speakerName, '店长');
  });
});
