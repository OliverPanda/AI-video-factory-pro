import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCharacterAssetGovernanceReport,
  classifyCharacterAssetPolicy,
  collectCanonicalReferences,
} from '../src/domain/characterAssetGovernance.js';

test('lead characters without a character bible are blocked for reusable asset governance', () => {
  const policy = classifyCharacterAssetPolicy({
    id: 'ep_char_1',
    name: '沈清',
    priority: 'lead',
  });

  assert.equal(policy.governanceStatus, 'blocked');
  assert.equal(policy.reusePolicy, 'strong_bind');
  assert.match(policy.blockers[0], /characterBibleId/);
});

test('temporary characters can stay episode-local without canonical refs', () => {
  const policy = classifyCharacterAssetPolicy({
    id: 'ep_char_temp',
    name: '路人甲',
    roleType: 'temporary',
  });

  assert.equal(policy.governanceStatus, 'approved');
  assert.equal(policy.reusePolicy, 'episode_local');
  assert.deepEqual(policy.canonicalReferences, []);
});

test('canonical references include bible references, selected best frame, and generated ref sheet', () => {
  const refs = collectCanonicalReferences(
    {
      id: 'ep_char_1',
      name: '沈清',
      referenceImages: [{ path: '/tmp/ref-a.png' }, '/tmp/ref-b.png'],
      bestFramePath: '/tmp/best.png',
    },
    [{ characterId: 'ep_char_1', imagePath: '/tmp/ref-sheet.png', success: true }]
  );

  assert.deepEqual(refs, ['/tmp/ref-a.png', '/tmp/ref-b.png', '/tmp/best.png', '/tmp/ref-sheet.png']);
});

test('governance report emits review items and audit entries', () => {
  const report = buildCharacterAssetGovernanceReport({
    projectId: 'project_1',
    scriptId: 'script_1',
    episodeId: 'episode_1',
    characterRegistry: [
      {
        id: 'ep_char_1',
        name: '沈清',
        priority: 'lead',
      },
      {
        id: 'ep_char_2',
        name: '掌柜',
        characterBibleId: 'bible_shopkeeper',
        priority: 'support',
        referenceImages: ['/tmp/shopkeeper.png'],
      },
    ],
    now: '2026-06-06T00:00:00.000Z',
  });

  assert.equal(report.status, 'block');
  assert.equal(report.summary.characterCount, 2);
  assert.equal(report.summary.blockedCount, 1);
  assert.equal(report.reviewItems.length, 1);
  assert.equal(report.auditEntries.length, 2);
});
