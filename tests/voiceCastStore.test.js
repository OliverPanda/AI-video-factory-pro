import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ensureProjectVoiceCast, loadVoiceCast, saveVoiceCast } from '../src/utils/voiceCastStore.js';
import { makeManagedTempDir } from './helpers/testArtifacts.js';

function makeTempDir(t) {
  return makeManagedTempDir(t, 'voice-cast-store', 'tts-agent');
}

test('saveVoiceCast writes the project voice-cast file', (t) => {
  const baseTempDir = makeTempDir(t);
  const voiceCast = [
    {
      characterId: 'ep-hero',
      displayName: '沈清',
      voiceProfile: {
        provider: 'cosyvoice',
        voice: 'shenqing_v1',
      },
    },
  ];

  saveVoiceCast('project-123', voiceCast, { baseTempDir });

  const filePath = path.join(baseTempDir, 'projects', 'project-123', 'voice-cast.json');
  assert.equal(fs.existsSync(filePath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf-8')), voiceCast);
});

test('loadVoiceCast round-trips a saved project voice cast', (t) => {
  const baseTempDir = makeTempDir(t);
  const voiceCast = [
    {
      characterId: 'ep-hero',
      displayName: '沈清',
      voiceProfile: {
        provider: 'fish-speech',
        voice: 'hero_angry',
        rate: 45,
      },
    },
  ];

  saveVoiceCast('project-123', voiceCast, { baseTempDir });

  const loaded = loadVoiceCast('project-123', { baseTempDir });

  assert.deepEqual(loaded, voiceCast);
});

test('loadVoiceCast returns null when the project voice-cast file is missing', (t) => {
  const baseTempDir = makeTempDir(t);

  const loaded = loadVoiceCast('project-123', { baseTempDir });

  assert.equal(loaded, null);
});

test('voice cast store rejects unsafe project ids', (t) => {
  const baseTempDir = makeTempDir(t);

  assert.throws(
    () => saveVoiceCast('../project-123', [], { baseTempDir }),
    /unsafe/i
  );
  assert.throws(
    () => loadVoiceCast('../project-123', { baseTempDir }),
    /unsafe/i
  );
});

test('ensureProjectVoiceCast creates a persistent minimax binding from the registry on first run', (t) => {
  const baseTempDir = makeTempDir(t);
  const characterRegistry = [
    {
      id: 'ep-hero',
      episodeCharacterId: 'ep-hero',
      name: '沈清',
      gender: 'female',
      personality: '冷静',
      roleType: 'lead',
    },
    {
      id: 'ep-support',
      episodeCharacterId: 'ep-support',
      name: '阿泽',
      gender: 'male',
      personality: '开朗',
      roleType: 'supporting',
    },
  ];

  const voiceCast = ensureProjectVoiceCast('project-123', characterRegistry, { baseTempDir });

  assert.equal(voiceCast.length, 2);
  assert.deepEqual(voiceCast.map((entry) => entry.characterId), ['ep-hero', 'ep-support']);
  assert.equal(voiceCast[0].voiceProfile.provider, 'minimax');
  assert.equal(voiceCast[1].voiceProfile.provider, 'minimax');
  assert.equal(fs.existsSync(path.join(baseTempDir, 'projects', 'project-123', 'voice-cast.json')), true);

  const persisted = JSON.parse(
    fs.readFileSync(path.join(baseTempDir, 'projects', 'project-123', 'voice-cast.json'), 'utf-8')
  );
  assert.deepEqual(persisted, voiceCast);
});

test('ensureProjectVoiceCast reuses stored project voice cast and preserves manual minimax overrides', (t) => {
  const baseTempDir = makeTempDir(t);
  const storedVoiceCast = [
    {
      characterId: 'ep-hero',
      displayName: '沈清',
      voiceProfile: {
        provider: 'minimax',
        voice: 'Custom_Girl',
        rate: 0.92,
        pitch: -1,
        volume: 1,
      },
    },
    {
      characterId: 'ep-villain',
      displayName: '老秦',
      voiceProfile: {
        provider: 'fish-speech',
        voice: 'legacy_voice',
      },
    },
  ];

  saveVoiceCast('project-123', storedVoiceCast, { baseTempDir });

  const voiceCast = ensureProjectVoiceCast(
    'project-123',
    [
      {
        id: 'ep-hero',
        episodeCharacterId: 'ep-hero',
        name: '沈清',
        gender: 'female',
        personality: '热血',
        roleType: 'lead',
      },
      {
        id: 'ep-villain',
        episodeCharacterId: 'ep-villain',
        name: '老秦',
        gender: 'male',
        personality: '阴沉',
        roleType: 'villain',
      },
    ],
    { baseTempDir }
  );

  assert.equal(voiceCast.length, 2);
  assert.equal(voiceCast[0].voiceProfile.provider, 'minimax');
  assert.equal(voiceCast[0].voiceProfile.voice, 'Custom_Girl');
  assert.equal(voiceCast[0].voiceProfile.rate, 0.92);
  assert.equal(voiceCast[1].voiceProfile.provider, 'minimax');
  assert.equal(voiceCast[1].voiceProfile.voice, 'Reliable_Executive');
});

test('ensureProjectVoiceCast does not reuse legacy entries that only match by display name', (t) => {
  const baseTempDir = makeTempDir(t);
  saveVoiceCast(
    'project-123',
    [
      {
        displayName: '沈清',
        name: '沈清',
        voiceProfile: {
          provider: 'minimax',
          voice: 'Legacy_Name_Only',
          rate: 0.88,
          pitch: -2,
          volume: 1,
        },
      },
    ],
    { baseTempDir }
  );

  const [entry] = ensureProjectVoiceCast(
    'project-123',
    [
      {
        id: 'ep-hero',
        episodeCharacterId: 'ep-hero',
        name: '沈清',
        gender: 'female',
        personality: '冷静',
      },
    ],
    { baseTempDir }
  );

  assert.equal(entry.characterId, 'ep-hero');
  assert.equal(entry.voiceProfile.provider, 'minimax');
  assert.notEqual(entry.voiceProfile.voice, 'Legacy_Name_Only');
});

test('ensureProjectVoiceCast reuses legacy name-only entries when the registry also lacks stable ids', (t) => {
  const baseTempDir = makeTempDir(t);
  const legacyVoiceCast = [
    {
      displayName: '沈清',
      name: '沈清',
      voiceProfile: {
        provider: 'minimax',
        voice: 'Legacy_Name_Only',
        rate: 0.88,
        pitch: -2,
        volume: 1,
      },
    },
  ];

  saveVoiceCast('project-123', legacyVoiceCast, { baseTempDir });

  const voiceCast = ensureProjectVoiceCast(
    'project-123',
    [
      {
        name: '沈清',
        gender: 'female',
        personality: '冷静',
      },
    ],
    { baseTempDir }
  );

  assert.equal(voiceCast.length, 1);
  assert.equal(voiceCast[0].voiceProfile.voice, 'Legacy_Name_Only');
  assert.equal(voiceCast[0].characterId, null);
});
