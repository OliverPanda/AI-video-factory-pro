import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoicePreset } from '../src/domain/voicePresetModel.js';

test('createVoicePreset returns a project-scoped preset with defaults', () => {
  const preset = createVoicePreset({
    projectId: 'project-123',
    name: 'Narrator A',
  });

  assert.equal(preset.projectId, 'project-123');
  assert.equal(preset.name, 'Narrator A');
  assert.equal(preset.provider, 'xfyun');
  assert.deepEqual(preset.tags, []);
  assert.equal(preset.sampleAudioPath, null);
  assert.equal(preset.status, 'draft');
  assert.equal(preset.createdAt, preset.updatedAt);
});

test('createVoicePreset preserves optional tuning fields', () => {
  const preset = createVoicePreset({
    projectId: 'project-123',
    name: 'Narrator A',
    rate: 1.1,
    pitch: -2,
    volume: 0.8,
  });

  assert.equal(preset.rate, 1.1);
  assert.equal(preset.pitch, -2);
  assert.equal(preset.volume, 0.8);
});

test('createVoicePreset preserves caller-supplied values for defaulted fields', () => {
  const tags = ['hero', 'warm'];
  const preset = createVoicePreset({
    projectId: 'project-123',
    name: 'Narrator A',
    provider: 'custom-provider',
    tags,
    sampleAudioPath: '/tmp/sample.wav',
    status: 'ready',
  });

  assert.equal(preset.provider, 'custom-provider');
  assert.deepEqual(preset.tags, ['hero', 'warm']);
  assert.notEqual(preset.tags, tags);
  assert.equal(preset.sampleAudioPath, '/tmp/sample.wav');
  assert.equal(preset.status, 'ready');
});

test('createVoicePreset generates ids and timestamps', () => {
  const preset = createVoicePreset({
    projectId: 'project-123',
    name: 'Narrator A',
  });

  assert.equal(typeof preset.id, 'string');
  assert.ok(preset.id.length > 0);
  assert.equal(typeof preset.createdAt, 'string');
  assert.equal(typeof preset.updatedAt, 'string');
  assert.match(preset.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(preset.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(preset.createdAt, preset.updatedAt);
});
