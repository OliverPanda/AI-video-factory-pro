import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRunPipeline } from '../src/agents/director.js';
import { makeManagedTempDir } from './helpers/testArtifacts.js';

function makeTempDir(t) {
  return makeManagedTempDir(t, 'director-voice-preset', 'tts');
}

function createDirectorHarness(t, overrides = {}) {
  const tempRoot = makeTempDir(t);
  const dirs = {
    root: path.join(tempRoot, 'job'),
    images: path.join(tempRoot, 'images'),
    audio: path.join(tempRoot, 'audio'),
    output: path.join(tempRoot, 'output'),
  };

  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const shots = [
    {
      id: 'shot-1',
      dialogue: '你好。',
      speaker: 'Alice',
      characters: ['Alice'],
    },
  ];
  const characterRegistry = [
    { name: 'Alice', gender: 'female', voicePresetId: 'preset-alice' },
  ];
  const audioCalls = [];
  const loadVoicePresetCalls = [];
  const loadPronunciationLexiconCalls = [];
  const qaCalls = [];
  let persistedState = null;

  const deps = {
    parseScript: async () => ({ title: 'Voice Preset Demo', shots, characters: [{ name: 'Alice' }] }),
    buildCharacterRegistry: async () => characterRegistry,
    generateAllPrompts: async () => [{ shotId: 'shot-1', image_prompt: 'prompt', negative_prompt: '' }],
    generateAllImages: async () => [{ shotId: 'shot-1', success: true, imagePath: path.join(dirs.images, 'shot-1.png') }],
    regenerateImage: async () => path.join(dirs.images, 'shot-1.png'),
    runConsistencyCheck: async () => ({ needsRegeneration: [] }),
    generateAllAudio: async (inputShots, inputRegistry, audioDir, options = {}) => {
      audioCalls.push({ inputShots, inputRegistry, audioDir, options });
      return [{ shotId: 'shot-1', audioPath: path.join(audioDir, 'shot-1.mp3'), hasDialogue: true }];
    },
    runTtsQa: async (inputShots, audioResults, voiceResolution, options = {}) => {
      qaCalls.push({ inputShots, audioResults, voiceResolution, options });
      return { status: 'pass', blockers: [], warnings: [] };
    },
    composeVideo: async (inputShots, imageResults, audioResults, outputPath) => {
      fs.writeFileSync(outputPath, JSON.stringify({ inputShots, imageResults, audioResults }), 'utf8');
      return outputPath;
    },
    saveJSON: (_filePath, state) => {
      persistedState = JSON.parse(JSON.stringify(state));
    },
    loadJSON: () => persistedState,
    initDirs: () => dirs,
    generateJobId: () => 'job-123',
    readTextFile: () => 'script content',
    createRunMetrics: () => ({ steps: {} }),
    finalizeRunMetrics: () => {},
    measureStep: async (_metrics, _key, _label, fn) => fn(),
    loadVoicePreset: (projectId, voicePresetId, options = {}) => {
      loadVoicePresetCalls.push({ projectId, voicePresetId, options });
      return { id: voicePresetId, voice: 'alice-voice' };
    },
    loadPronunciationLexicon: (projectId) => {
      loadPronunciationLexiconCalls.push(projectId);
      return [{ source: 'Alice', target: '艾丽丝' }];
    },
    ...overrides,
  };

  return {
    runPipeline: createRunPipeline(deps),
    dirs,
    shots,
    characterRegistry,
    audioCalls,
    qaCalls,
    loadVoicePresetCalls,
    loadPronunciationLexiconCalls,
  };
}

test('director passes projectId and a working voice preset loader into generateAllAudio', async (t) => {
  const harness = createDirectorHarness(t);

  await harness.runPipeline('script.txt', {
    projectId: 'project-123',
    skipConsistencyCheck: true,
  });

  assert.equal(harness.audioCalls.length, 1);
  const audioCall = harness.audioCalls[0];
  assert.equal(audioCall.audioDir, harness.dirs.audio);
  assert.equal(audioCall.options.projectId, 'project-123');
  assert.equal(typeof audioCall.options.voicePresetLoader, 'function');
  assert.equal(audioCall.inputShots[0].dialogue, '你好。');
  assert.equal(Number.isFinite(audioCall.inputShots[0].dialogueDurationMs), true);
  assert.deepEqual(audioCall.inputShots[0].dialogueSegments, ['你好。']);
  assert.deepEqual(harness.loadPronunciationLexiconCalls, ['project-123']);

  assert.equal(harness.qaCalls.length, 1);
  assert.equal(Number.isFinite(harness.qaCalls[0].inputShots[0].dialogueDurationMs), true);

  const preset = await audioCall.options.voicePresetLoader('preset-alice', { fromTest: true });
  assert.deepEqual(preset, { id: 'preset-alice', voice: 'alice-voice' });
  assert.deepEqual(harness.loadVoicePresetCalls, [
    {
      projectId: 'project-123',
      voicePresetId: 'preset-alice',
      options: { fromTest: true },
    },
  ]);
});

test('director keeps audio generation backward-compatible when projectId is absent', async (t) => {
  const harness = createDirectorHarness(t);

  await harness.runPipeline('script.txt', {
    skipConsistencyCheck: true,
  });

  assert.equal(harness.audioCalls.length, 1);
  assert.equal(typeof harness.audioCalls[0].options, 'object');
  assert.ok(harness.audioCalls[0].options.artifactContext);
  assert.equal('projectId' in harness.audioCalls[0].options, false);
  assert.equal('voicePresetLoader' in harness.audioCalls[0].options, false);
  assert.deepEqual(harness.loadVoicePresetCalls, []);
});

test('director invalidates cached audio when projectId changes', async (t) => {
  const harness = createDirectorHarness(t);

  await harness.runPipeline('script.txt', {
    projectId: 'project-123',
    skipConsistencyCheck: true,
  });

  await harness.runPipeline('script.txt', {
    projectId: 'project-456',
    skipConsistencyCheck: true,
  });

  assert.equal(harness.audioCalls.length, 2);
  assert.equal(harness.audioCalls[0].options.projectId, 'project-123');
  assert.equal(harness.audioCalls[1].options.projectId, 'project-456');
});
