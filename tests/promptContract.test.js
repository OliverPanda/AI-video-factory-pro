import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPromptContract,
} from '../src/domain/promptContract.js';

test('buildPromptContract normalizes execution/display separation and defaults', () => {
  const contract = buildPromptContract({
    version: 'v2',
    taskRole: 'shot_prompt',
    displayZh: '中文展示',
    displayNegativeZh: '中文负向',
    executionEn: 'english execution',
    executionNegativeEn: 'english negative',
    hardConstraints: ['keep identity', 'keep space'],
    softPreferences: ['prefer readable framing'],
    referenceBinding: { image1: 'first frame' },
    negativeRules: ['avoid drift'],
    outputSchema: { type: 'json' },
    tokenBudget: 1200,
  });

  assert.equal(contract.version, 'v2');
  assert.equal(contract.taskRole, 'shot_prompt');
  assert.equal(contract.displayZh, '中文展示');
  assert.equal(contract.displayNegativeZh, '中文负向');
  assert.equal(contract.executionEn, 'english execution');
  assert.equal(contract.executionNegativeEn, 'english negative');
  assert.deepEqual(contract.hardConstraints, ['keep identity', 'keep space']);
  assert.deepEqual(contract.softPreferences, ['prefer readable framing']);
  assert.deepEqual(contract.referenceBinding, { image1: 'first frame' });
  assert.deepEqual(contract.negativeRules, ['avoid drift']);
  assert.deepEqual(contract.outputSchema, { type: 'json' });
  assert.equal(contract.tokenBudget, 1200);
});


test('buildPromptContract safely normalizes scalar and invalid inputs', () => {
  const contract = buildPromptContract({
    hardConstraints: 'keep identity',
    softPreferences: 42,
    negativeRules: null,
    referenceBinding: ['invalid'],
    outputSchema: 'invalid',
    displayZh: { text: 'bad' },
  });

  assert.deepEqual(contract.hardConstraints, ['keep identity']);
  assert.deepEqual(contract.softPreferences, ['42']);
  assert.deepEqual(contract.negativeRules, []);
  assert.equal(contract.referenceBinding, null);
  assert.equal(contract.outputSchema, null);
  assert.equal(contract.displayZh, '');
});
