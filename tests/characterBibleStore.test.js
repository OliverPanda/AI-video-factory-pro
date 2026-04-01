import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  listCharacterBibles,
  loadCharacterBible,
  saveCharacterBible,
} from '../src/utils/characterBibleStore.js';

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'character-bible-store-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('saveCharacterBible writes JSON under the project character-bibles directory', (t) => {
  const baseTempDir = makeTempDir(t);
  const bible = { id: 'char-bible-1', projectId: 'project-123', name: '小红' };

  saveCharacterBible('project-123', bible, { baseTempDir });

  const filePath = path.join(
    baseTempDir,
    'projects',
    'project-123',
    'character-bibles',
    'char-bible-1.json'
  );
  assert.equal(fs.existsSync(filePath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf-8')), bible);
});

test('loadCharacterBible round-trips a saved asset', (t) => {
  const baseTempDir = makeTempDir(t);
  const bible = { id: 'char-bible-2', projectId: 'project-123', name: '店长' };

  saveCharacterBible('project-123', bible, { baseTempDir });

  const loaded = loadCharacterBible('project-123', 'char-bible-2', { baseTempDir });

  assert.deepEqual(loaded, bible);
});

test('listCharacterBibles returns sorted JSON assets under the project character-bibles directory', (t) => {
  const baseTempDir = makeTempDir(t);
  saveCharacterBible('project-123', { id: 'b-char', name: 'B' }, { baseTempDir });
  saveCharacterBible('project-123', { id: 'a-char', name: 'A' }, { baseTempDir });

  const listed = listCharacterBibles('project-123', { baseTempDir });

  assert.deepEqual(listed.map((item) => item.id), ['a-char', 'b-char']);
});

test('loadCharacterBible returns null when the file is missing', (t) => {
  const baseTempDir = makeTempDir(t);

  const loaded = loadCharacterBible('project-123', 'missing-bible', { baseTempDir });

  assert.equal(loaded, null);
});

test('character bible store rejects missing ids and unsafe path segments', (t) => {
  const baseTempDir = makeTempDir(t);

  assert.throws(
    () => saveCharacterBible('project-123', { name: '小红' }, { baseTempDir }),
    /characterBible\.id/i
  );
  assert.throws(
    () => saveCharacterBible('../project-123', { id: 'char-1', name: '小红' }, { baseTempDir }),
    /unsafe/i
  );
  assert.throws(
    () => loadCharacterBible('project-123', '../char-1', { baseTempDir }),
    /unsafe/i
  );
  assert.throws(
    () => listCharacterBibles('../project-123', { baseTempDir }),
    /unsafe/i
  );
});
