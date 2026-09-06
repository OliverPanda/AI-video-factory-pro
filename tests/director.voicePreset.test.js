import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDirector } from '../src/agents/director.js';
import { makeManagedTempDir } from './helpers/testArtifacts.js';

function makeTempDir(t) {
  return makeManagedTempDir(t, 'director-voice-preset', 'tts-agent');
}

// 项目模式 harness：预置 project/script/episode 数据，直接驱动 runEpisodePipeline。
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

  const projectId = 'project-123';
  const scriptId = 'script-1';
  const episodeId = 'episode-1';

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
  const ensureVoiceCastCalls = [];
  const loadVoicePresetCalls = [];
  const loadPronunciationLexiconCalls = [];
  const qaCalls = [];
  let persistedState = null;
  const projectStore = new Map();
  const scriptStore = new Map();
  const episodeStore = new Map();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const project = { id: projectId, name: 'Voice Preset Demo', status: 'draft' };
  const script = {
    id: scriptId,
    projectId,
    title: 'Voice Preset Demo',
    sourceText: 'script content',
    characters: [{ name: 'Alice' }],
    status: 'draft',
  };
  const episode = {
    id: episodeId,
    projectId,
    scriptId,
    episodeNo: 1,
    title: 'Voice Preset Demo',
    summary: 'script content',
    shots,
    status: 'draft',
  };
  projectStore.set(project.id, clone(project));
  scriptStore.set(`${projectId}/${script.id}`, clone(script));
  episodeStore.set(`${projectId}/${scriptId}/${episode.id}`, clone(episode));

  const deps = {
    parseScript: async () => ({ title: 'Voice Preset Demo', shots, characters: [{ name: 'Alice' }] }),
    buildCharacterRegistry: async () => characterRegistry,
    generateCharacterRefSheets: async (cards) =>
      cards.map((card) => ({
        characterId: card.episodeCharacterId || card.name,
        characterName: card.name,
        imagePath: `/tmp/${card.name.toLowerCase()}-ref.png`,
        success: true,
        error: null,
      })),
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
    loadProject: (id) => projectStore.get(id) || null,
    loadScript: (id, scriptId2) => scriptStore.get(`${id}/${scriptId2}`) || null,
    loadEpisode: (id, scriptId2, episodeId2) => episodeStore.get(`${id}/${scriptId2}/${episodeId2}`) || null,
    saveProject: (value) => {
      const saved = clone(value);
      projectStore.set(saved.id, saved);
      return saved;
    },
    saveScript: (id, value) => {
      const saved = clone(value);
      scriptStore.set(`${id}/${saved.id}`, saved);
      return saved;
    },
    saveEpisode: (id, scriptId2, value) => {
      const saved = clone(value);
      episodeStore.set(`${id}/${scriptId2}/${saved.id}`, saved);
      return saved;
    },
    initDirs: () => dirs,
    generateJobId: () => 'job-123',
    createRunMetrics: () => ({ steps: {} }),
    finalizeRunMetrics: () => {},
    measureStep: async (_metrics, _key, _label, fn) => fn(),
    loadVoicePreset: (projectIdArg, voicePresetId, options = {}) => {
      loadVoicePresetCalls.push({ projectId: projectIdArg, voicePresetId, options });
      return { id: voicePresetId, voice: 'alice-voice' };
    },
    ensureProjectVoiceCast: (projectIdArg, registry, options = {}) => {
      ensureVoiceCastCalls.push({ projectId: projectIdArg, registry, options });
      return [
        {
          characterId: 'ep-alice',
          displayName: 'Alice',
          voiceProfile: {
            provider: 'minimax',
            voice: 'alice-minimax',
            rate: 0.96,
            pitch: 1,
            volume: 1,
          },
        },
      ];
    },
    loadPronunciationLexicon: (projectIdArg) => {
      loadPronunciationLexiconCalls.push(projectIdArg);
      return [{ source: 'Alice', target: '艾丽丝' }];
    },
    ...overrides,
  };

  const director = createDirector(deps);

  return {
    runEpisode: () =>
      director.runEpisodePipeline({
        projectId,
        scriptId,
        episodeId,
        options: {
          style: 'realistic',
          skipConsistencyCheck: true,
          storeOptions: { baseTempDir: tempRoot },
        },
      }),
    dirs,
    shots,
    characterRegistry,
    audioCalls,
    ensureVoiceCastCalls,
    qaCalls,
    loadVoicePresetCalls,
    loadPronunciationLexiconCalls,
  };
}

test('director passes projectId and a working voice preset loader into generateAllAudio', async (t) => {
  const harness = createDirectorHarness(t);

  await harness.runEpisode();

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

test('director ensures and reuses project voice cast before TTS generation', async (t) => {
  const harness = createDirectorHarness(t);

  await harness.runEpisode();

  assert.equal(harness.ensureVoiceCastCalls.length, 1);
  assert.equal(harness.ensureVoiceCastCalls[0].projectId, 'project-123');
  assert.equal(harness.ensureVoiceCastCalls[0].registry[0].name, 'Alice');
  assert.equal(harness.audioCalls[0].options.voiceCast[0].voiceProfile.provider, 'minimax');
  assert.equal(harness.audioCalls[0].options.voiceCast[0].voiceProfile.voice, 'alice-minimax');
});

test('director backfills reference images using characterName when no stable id is present', async (t) => {
  const harness = createDirectorHarness(t, {
    generateCharacterRefSheets: async () => [
      {
        characterId: null,
        characterName: 'Alice',
        imagePath: '/tmp/alice-ref.png',
        success: true,
        error: null,
      },
    ],
  });

  await harness.runEpisode();

  assert.equal(harness.audioCalls.length, 1);
  assert.equal(harness.audioCalls[0].options.voiceCast[0].displayName, 'Alice');
});

test('director blocks the pipeline when character ref sheet generation fails', async (t) => {
  const harness = createDirectorHarness(t, {
    generateCharacterRefSheets: async () => [
      {
        characterId: 'ep-alice',
        characterName: 'Alice',
        imagePath: null,
        success: false,
        error: 'ref sheet failed',
      },
    ],
  });

  await assert.rejects(() => harness.runEpisode(), /角色三视图生成失败/);

  assert.equal(harness.audioCalls.length, 0);
  assert.equal(harness.qaCalls.length, 0);
});
