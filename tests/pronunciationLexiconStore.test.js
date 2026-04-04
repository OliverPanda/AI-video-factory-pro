import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  loadPronunciationLexicon,
  savePronunciationLexicon,
} from '../src/utils/pronunciationLexiconStore.js';
import { makeManagedTempDir } from './helpers/testArtifacts.js';

function makeTempDir(t) {
  return makeManagedTempDir(t, 'pronunciation-lexicon-store', 'tts-agent');
}

test('savePronunciationLexicon writes the project pronunciation lexicon file', (t) => {
  const baseTempDir = makeTempDir(t);
  const lexicon = [
    { source: 'AI', target: 'A I' },
    { source: 'TTS', target: 'T T S' },
  ];

  savePronunciationLexicon('project-123', lexicon, { baseTempDir });

  const filePath = path.join(baseTempDir, 'projects', 'project-123', 'pronunciation-lexicon.json');
  assert.equal(fs.existsSync(filePath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf-8')), lexicon);
});

test('loadPronunciationLexicon returns a saved project pronunciation lexicon', (t) => {
  const baseTempDir = makeTempDir(t);
  const lexicon = [{ source: 'OpenAI', target: 'Open A I' }];

  savePronunciationLexicon('project-123', lexicon, { baseTempDir });

  assert.deepEqual(loadPronunciationLexicon('project-123', { baseTempDir }), lexicon);
});

test('loadPronunciationLexicon returns an empty list when the file is missing', (t) => {
  const baseTempDir = makeTempDir(t);

  assert.deepEqual(loadPronunciationLexicon('project-123', { baseTempDir }), []);
});

test('pronunciation lexicon store rejects unsafe project ids', (t) => {
  const baseTempDir = makeTempDir(t);

  assert.throws(
    () => savePronunciationLexicon('../project-123', [], { baseTempDir }),
    /unsafe/i
  );
  assert.throws(
    () => loadPronunciationLexicon('../project-123', { baseTempDir }),
    /unsafe/i
  );
});
