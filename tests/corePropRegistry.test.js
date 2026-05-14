import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCorePropRegistry } from '../src/agents/corePropRegistry.js';

test('buildCorePropRegistry extracts script-specific binding chain contract', () => {
  const shots = [
    {
      id: 'shot_005',
      characters: ['陆衍'],
      action: '陆衍的手腕被一道半透明的黑色锁链缠住，锁链另一端没入黑暗。',
    },
    {
      id: 'shot_006',
      characters: ['零'],
      action: '他手腕上缠着锁链的另一端。',
    },
    {
      id: 'shot_007',
      characters: ['陆衍', '零'],
      action: '双人近景。零与陆衍面对面，锁链绷直。',
    },
  ];

  const registry = buildCorePropRegistry(shots);

  assert.equal(registry.length, 1);
  assert.equal(registry[0].propId, 'binding_chain');
  assert.deepEqual(registry[0].aliases, ['锁链', '黑色锁链']);
  assert.equal(registry[0].placementPolicy.anchorType, 'wrist_endpoint_pair');
  assert.deepEqual(registry[0].placementPolicy.forbiddenAnchors, ['neck', 'collar', 'throat']);
  assert.deepEqual(registry[0].activeShotIds, ['shot_005', 'shot_006', 'shot_007']);
});

test('buildCorePropRegistry does not create a prop contract for one-off chain mentions', () => {
  const registry = buildCorePropRegistry([
    {
      id: 'shot_001',
      action: '远处有一条锁链落在地上。',
    },
  ]);

  assert.deepEqual(registry, []);
});
