import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateAllAudio } from '../src/agents/ttsAgent.js';
import { makeManagedTempDir } from './helpers/testArtifacts.js';

function makeTempDir(t) {
  return makeManagedTempDir(t, 'tts-agent-voice-preset', 'tts');
}

test('TTS agent resolves speaker voice from voicePresetId and forwards voice tuning options', async (t) => {
  const audioDir = makeTempDir(t);
  const calls = [];
  const shots = [
    {
      id: 'shot-1',
      dialogue: '你好，我来了。',
      speaker: 'Alice',
      characters: ['Alice', 'Bob'],
    },
  ];
  const characterRegistry = [
    { name: 'Alice', gender: 'female', voicePresetId: 'preset-alice' },
  ];
  const voicePresetLoader = async (voicePresetId, context) => {
    assert.equal(voicePresetId, 'preset-alice');
    assert.equal(context.projectId, 'project-123');
    assert.equal(context.speakerName, 'Alice');
    assert.equal(context.shot.id, 'shot-1');
    return {
      voice: 'alice-voice',
      rate: 65,
      pitch: 40,
      volume: 72,
    };
  };
  const textToSpeech = async (text, outputPath, options) => {
    calls.push({ text, outputPath, options });
    return outputPath;
  };

  await generateAllAudio(shots, characterRegistry, audioDir, {
    projectId: 'project-123',
    voicePresetLoader,
    textToSpeech,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, '你好，我来了。');
  assert.equal(calls[0].outputPath, path.join(audioDir, 'shot-1.mp3'));
  assert.deepEqual(calls[0].options, {
    gender: 'female',
    voice: 'alice-voice',
    rate: 65,
    pitch: 40,
    volume: 72,
  });
});

test('TTS agent prefers project voice cast over voicePresetId when both are available', async (t) => {
  const audioDir = makeTempDir(t);
  const shots = [
    {
      id: 'shot_1',
      dialogue: '我来处理。',
      shotCharacters: [{ episodeCharacterId: 'ep-alice', isSpeaker: true }],
      characters: ['Alice'],
    },
  ];
  const characterRegistry = [
    { id: 'ep-alice', episodeCharacterId: 'ep-alice', name: 'Alice', gender: 'female', voicePresetId: 'preset-alice' },
  ];

  const calls = [];
  await generateAllAudio(shots, characterRegistry, audioDir, {
    voicePresetLoader: async () => ({
      voice: 'preset-voice',
      rate: 55,
    }),
    voiceCast: [
      {
        characterId: 'ep-alice',
        displayName: 'Alice',
        voiceProfile: {
          provider: 'fish-speech',
          voice: 'voice-cast-hero',
          rate: 42,
          pitch: 60,
        },
      },
    ],
    textToSpeech: async (text, outputPath, options) => {
      calls.push({ text, outputPath, options });
      return outputPath;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.provider, 'fish-speech');
  assert.equal(calls[0].options.voice, 'voice-cast-hero');
  assert.equal(calls[0].options.rate, 42);
  assert.equal(calls[0].options.pitch, 60);
});

test('TTS agent forwards cosyvoice-specific voice cast fields for zero-shot synthesis', async (t) => {
  const audioDir = makeTempDir(t);
  const shots = [
    {
      id: 'shot_cosyvoice',
      dialogue: '这一句要更像本人。',
      shotCharacters: [{ episodeCharacterId: 'ep-alice', isSpeaker: true }],
      characters: ['Alice'],
    },
  ];
  const characterRegistry = [
    { id: 'ep-alice', episodeCharacterId: 'ep-alice', name: 'Alice', gender: 'female' },
  ];

  const calls = [];
  await generateAllAudio(shots, characterRegistry, audioDir, {
    voiceCast: [
      {
        characterId: 'ep-alice',
        displayName: 'Alice',
        voiceProfile: {
          provider: 'cosyvoice',
          mode: 'zero_shot',
          voice: 'alice_zero',
          referenceAudio: 'assets/voices/alice-ref.wav',
          promptText: '你好，我是 Alice。',
          zeroShotSpeakerId: 'alice-demo',
        },
      },
    ],
    textToSpeech: async (text, outputPath, options) => {
      calls.push({ text, outputPath, options });
      return outputPath;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.provider, 'cosyvoice');
  assert.equal(calls[0].options.mode, 'zero_shot');
  assert.equal(calls[0].options.referenceAudio, 'assets/voices/alice-ref.wav');
  assert.equal(calls[0].options.promptText, '你好，我是 Alice。');
  assert.equal(calls[0].options.zeroShotSpeakerId, 'alice-demo');
});

test('TTS agent forwards fish-speech-specific reference fields from voice cast', async (t) => {
  const audioDir = makeTempDir(t);
  const shots = [
    {
      id: 'shot_fish_speech',
      dialogue: '这句要更有情绪。',
      shotCharacters: [{ episodeCharacterId: 'ep-alice', isSpeaker: true }],
      characters: ['Alice'],
    },
  ];
  const characterRegistry = [
    { id: 'ep-alice', episodeCharacterId: 'ep-alice', name: 'Alice', gender: 'female' },
  ];

  const calls = [];
  await generateAllAudio(shots, characterRegistry, audioDir, {
    voiceCast: [
      {
        characterId: 'ep-alice',
        displayName: 'Alice',
        voiceProfile: {
          provider: 'fish-speech',
          referenceId: 'alice-reference',
          referenceAudio: 'assets/voices/alice-ref.wav',
          referenceText: '你好，我是 Alice。',
        },
      },
    ],
    textToSpeech: async (text, outputPath, options) => {
      calls.push({ text, outputPath, options });
      return outputPath;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.provider, 'fish-speech');
  assert.equal(calls[0].options.referenceId, 'alice-reference');
  assert.equal(calls[0].options.referenceAudio, 'assets/voices/alice-ref.wav');
  assert.equal(calls[0].options.referenceText, '你好，我是 Alice。');
});

test('TTS agent falls back to gender defaults when voicePresetId is missing', async (t) => {
  const audioDir = makeTempDir(t);
  const calls = [];
  const shots = [
    {
      id: 'shot-2',
      dialogue: '准备出发。',
      characters: ['Bob'],
    },
  ];
  const characterRegistry = [
    { name: 'Bob', gender: 'male' },
  ];
  const textToSpeech = async (text, outputPath, options) => {
    calls.push({ text, outputPath, options });
    return outputPath;
  };

  await generateAllAudio(shots, characterRegistry, audioDir, {
    projectId: 'project-123',
    textToSpeech,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { gender: 'male' });
});

test('TTS agent falls back to gender defaults when a preset cannot be loaded', async (t) => {
  const audioDir = makeTempDir(t);
  const calls = [];
  const shots = [
    {
      id: 'shot-3',
      dialogue: '计划有变。',
      speaker: 'Carol',
      characters: ['Carol'],
    },
  ];
  const characterRegistry = [
    { name: 'Carol', gender: 'female', voicePresetId: 'preset-carol' },
  ];
  const textToSpeech = async (text, outputPath, options) => {
    calls.push({ text, outputPath, options });
    return outputPath;
  };

  await generateAllAudio(shots, characterRegistry, audioDir, {
    projectId: 'project-123',
    voicePresetLoader: async () => {
      throw new Error('preset missing');
    },
    textToSpeech,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { gender: 'female' });
});
