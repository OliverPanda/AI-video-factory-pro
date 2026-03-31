import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateAllAudio } from '../src/agents/ttsAgent.js';

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-agent-voice-preset-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
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
