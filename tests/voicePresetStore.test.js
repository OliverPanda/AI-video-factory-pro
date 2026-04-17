import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveVoicePreset, loadVoicePreset } from '../src/utils/voicePresetStore.js';

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-preset-store-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('saveVoicePreset writes preset JSON under the project voice preset directory', (t) => {
  const baseTempDir = makeTempDir(t);
  const preset = { id: 'preset-1', name: 'Narrator A', provider: 'minimax' };

  saveVoicePreset('project-123', preset, { baseTempDir });

  const filePath = path.join(
    baseTempDir,
    'projects',
    'project-123',
    'voice-presets',
    'preset-1.json'
  );
  assert.equal(fs.existsSync(filePath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf-8')), preset);
});

test('loadVoicePreset round-trips a saved preset', (t) => {
  const baseTempDir = makeTempDir(t);
  const preset = {
    id: 'preset-2',
    projectId: 'project-123',
    name: 'Narrator B',
    provider: 'custom-provider',
  };

  saveVoicePreset('project-123', preset, { baseTempDir });

  const loaded = loadVoicePreset('project-123', 'preset-2', { baseTempDir });

  assert.deepEqual(loaded, preset);
});

test('loadVoicePreset returns null when the preset file is missing', (t) => {
  const baseTempDir = makeTempDir(t);

  const loaded = loadVoicePreset('project-123', 'missing-preset', { baseTempDir });

  assert.equal(loaded, null);
});

test('saveVoicePreset rejects missing preset ids', (t) => {
  const baseTempDir = makeTempDir(t);

  assert.throws(
    () => saveVoicePreset('project-123', { name: 'Narrator A' }, { baseTempDir }),
    /preset\.id/i
  );
});

test('voice preset store rejects unsafe path segments', (t) => {
  const baseTempDir = makeTempDir(t);
  const preset = { id: '../preset-3', name: 'Narrator C' };

  assert.throws(
    () => saveVoicePreset('../project-123', preset, { baseTempDir }),
    /unsafe/i
  );
  assert.throws(
    () => loadVoicePreset('project-123', '../preset-3', { baseTempDir }),
    /unsafe/i
  );
});
