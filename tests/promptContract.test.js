import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPromptContract,
  mergePromptPresets,
  serializePromptContract,
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

test('mergePromptPresets merges arrays uniquely and later objects override scalar fields', () => {
  const contract = mergePromptPresets(
    {
      taskRole: 'base',
      hardConstraints: ['one', 'two'],
      softPreferences: ['prefer clarity'],
      negativeRules: ['avoid blur'],
      referenceBinding: { image1: 'base frame' },
      outputSchema: { type: 'base' },
    },
    {
      taskRole: 'override',
      hardConstraints: ['two', 'three'],
      softPreferences: ['prefer clarity', 'prefer identity'],
      negativeRules: ['avoid blur', 'avoid drift'],
      referenceBinding: { image2: 'target frame' },
      outputSchema: { version: 2 },
    }
  );

  assert.equal(contract.taskRole, 'override');
  assert.deepEqual(contract.hardConstraints, ['one', 'two', 'three']);
  assert.deepEqual(contract.softPreferences, ['prefer clarity', 'prefer identity']);
  assert.deepEqual(contract.negativeRules, ['avoid blur', 'avoid drift']);
  assert.deepEqual(contract.referenceBinding, { image1: 'base frame', image2: 'target frame' });
  assert.deepEqual(contract.outputSchema, { type: 'base', version: 2 });
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

test('serializePromptContract emits a deterministic contract text', () => {
  const text = serializePromptContract({
    version: 'v1',
    taskRole: 'image_prompt',
    displayZh: '中文展示',
    executionEn: 'english execution',
    hardConstraints: ['keep identity'],
    negativeRules: ['avoid drift'],
    referenceBinding: { image1: 'first frame' },
  });

  assert.match(text, /display_zh: 中文展示/);
  assert.match(text, /execution_en: english execution/);
  assert.match(text, /task_role: image_prompt/);
  assert.match(text, /hard_constraints: keep identity/);
  assert.match(text, /negative_rules: avoid drift/);
  assert.match(text, /reference_binding:/);
  assert.match(text, /version: v1/);
});

test('serializePromptContract canonicalizes object key ordering', () => {
  const a = serializePromptContract({
    referenceBinding: { b: 2, a: 1, nested: [{ y: 2, x: 1 }] },
    outputSchema: { z: true, a: false, nested: [{ m: 2, n: 1 }] },
  });
  const b = serializePromptContract({
    referenceBinding: { a: 1, b: 2, nested: [{ x: 1, y: 2 }] },
    outputSchema: { a: false, z: true, nested: [{ n: 1, m: 2 }] },
  });

  assert.equal(a, b);
  assert.match(a, /"a":1/);
  assert.match(a, /"b":2/);
  assert.match(a, /"x":1/);
  assert.match(a, /"y":2/);
  assert.match(a, /"m":2/);
  assert.match(a, /"n":1/);
  assert.match(a, /"a":false/);
  assert.match(a, /"z":true/);
});
