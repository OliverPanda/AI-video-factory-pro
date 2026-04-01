import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBible } from '../src/domain/characterBibleModel.js';

test('createCharacterBible sets stable defaults for project-level identity assets', () => {
  const bible = createCharacterBible({
    projectId: 'project-1',
    name: '小红',
  });

  assert.equal(bible.projectId, 'project-1');
  assert.equal(bible.name, '小红');
  assert.deepEqual(bible.aliases, []);
  assert.deepEqual(bible.referenceImages, []);
  assert.deepEqual(bible.coreTraits, {});
  assert.deepEqual(bible.wardrobeAnchor, {});
  assert.deepEqual(bible.lightingAnchor, {});
  assert.equal(bible.basePromptTokens, null);
  assert.equal(bible.negativeDriftTokens, null);
  assert.equal(bible.notes, null);
  assert.equal(bible.tier, 'supporting');
  assert.equal(bible.status, 'draft');
  assert.equal(typeof bible.id, 'string');
});

test('createCharacterBible preserves explicit core identity anchors', () => {
  const bible = createCharacterBible({
    id: 'char_bible_xiaohong',
    projectId: 'project-1',
    name: '小红',
    aliases: ['女主', '红红'],
    referenceImages: ['refs/front.png'],
    coreTraits: { hairStyle: 'long black hair' },
    wardrobeAnchor: { primaryColors: ['white', 'navy'] },
    lightingAnchor: { baseTone: 'soft natural light' },
    basePromptTokens: 'young woman, long black hair',
    negativeDriftTokens: 'different hairstyle',
    notes: '现代都市感',
    tier: 'lead',
  });

  assert.equal(bible.id, 'char_bible_xiaohong');
  assert.deepEqual(bible.aliases, ['女主', '红红']);
  assert.deepEqual(bible.referenceImages, ['refs/front.png']);
  assert.deepEqual(bible.coreTraits, { hairStyle: 'long black hair' });
  assert.deepEqual(bible.wardrobeAnchor, { primaryColors: ['white', 'navy'] });
  assert.deepEqual(bible.lightingAnchor, { baseTone: 'soft natural light' });
  assert.equal(bible.basePromptTokens, 'young woman, long black hair');
  assert.equal(bible.negativeDriftTokens, 'different hairstyle');
  assert.equal(bible.notes, '现代都市感');
  assert.equal(bible.tier, 'lead');
});
