import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadVoiceCast, saveVoiceCast } from '../src/utils/voiceCastStore.js';
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
