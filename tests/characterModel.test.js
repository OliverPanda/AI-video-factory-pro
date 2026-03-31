import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEpisodeCharacter,
  createMainCharacterTemplate,
  createShotCharacter,
} from '../src/domain/characterModel.js';

test('createMainCharacterTemplate sets default status and timestamps', () => {
  const character = createMainCharacterTemplate({
    projectId: 'p1',
    name: '主角',
    visualDescription: 'young hero',
  });

  assert.equal(character.projectId, 'p1');
  assert.equal(character.name, '主角');
  assert.equal(character.visualDescription, 'young hero');
  assert.equal(character.status, 'draft');
  assert.equal(typeof character.id, 'string');
});

test('createEpisodeCharacter defaults mainCharacterTemplateId to null', () => {
  const character = createEpisodeCharacter({
    projectId: 'p1',
    scriptId: 's1',
    episodeId: 'e1',
    name: '店员',
  });

  assert.equal(character.projectId, 'p1');
  assert.equal(character.scriptId, 's1');
  assert.equal(character.episodeId, 'e1');
  assert.equal(character.name, '店员');
  assert.equal(character.mainCharacterTemplateId, null);
  assert.equal(character.status, 'draft');
});

test('createShotCharacter preserves speaker and ordering flags', () => {
  const relation = createShotCharacter({
    shotId: 'sh1',
    episodeCharacterId: 'c1',
    isSpeaker: true,
    isPrimary: false,
    sortOrder: 3,
  });

  assert.equal(relation.shotId, 'sh1');
  assert.equal(relation.episodeCharacterId, 'c1');
  assert.equal(relation.isSpeaker, true);
  assert.equal(relation.isPrimary, false);
  assert.equal(relation.sortOrder, 3);
  assert.equal(typeof relation.id, 'string');
  assert.equal(relation.status, 'draft');
  assert.equal(typeof relation.createdAt, 'string');
  assert.equal(typeof relation.updatedAt, 'string');
  assert.equal(relation.createdAt, relation.updatedAt);
});
