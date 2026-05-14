import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyShotConsistencyClass,
  resolveCharacterPriority,
  evaluateConsistencyDecision,
} from '../src/domain/consistencyQaPolicy.js';

test('lead + anchor warns below stricter threshold', () => {
  const decision = evaluateConsistencyDecision({
    overallScore: 8.2,
    characterPriority: 'lead',
    shotConsistencyClass: 'anchor',
    hardFailureReasons: [],
    softRiskTags: ['hair_drift'],
  });

  assert.equal(decision.status, 'warn');
  assert.equal(decision.threshold, 8.5);
  assert.equal(decision.regenStrategy, 'prompt_tighten');
});

test('hard identity failure blocks regardless of score', () => {
  const decision = evaluateConsistencyDecision({
    overallScore: 9.3,
    characterPriority: 'support',
    shotConsistencyClass: 'complex',
    hardFailureReasons: ['identity_swap'],
    softRiskTags: [],
  });

  assert.equal(decision.status, 'block');
  assert.equal(decision.regenStrategy, 'reanchor_regenerate');
});

test('support + complex can pass with moderate score when only soft risks exist', () => {
  const decision = evaluateConsistencyDecision({
    overallScore: 7.1,
    characterPriority: 'support',
    shotConsistencyClass: 'complex',
    hardFailureReasons: [],
    softRiskTags: ['palette_drift'],
  });

  assert.equal(decision.status, 'pass');
  assert.equal(decision.threshold, 7.0);
  assert.equal(decision.regenStrategy, 'none');
});

test('score equal to threshold should pass', () => {
  const decision = evaluateConsistencyDecision({
    overallScore: 8.0,
    characterPriority: 'support',
    shotConsistencyClass: 'anchor',
    hardFailureReasons: [],
  });

  assert.equal(decision.status, 'pass');
  assert.equal(decision.threshold, 8.0);
  assert.equal(decision.regenStrategy, 'none');
});

test('evaluateConsistencyDecision uses defaults for missing fields', () => {
  const decision = evaluateConsistencyDecision({});

  assert.equal(decision.status, 'warn');
  assert.equal(decision.threshold, 7.0);
  assert.equal(decision.regenStrategy, 'prompt_tighten');
});

test('non-array hardFailureReasons should not block', () => {
  const decision = evaluateConsistencyDecision({
    overallScore: 7.2,
    characterPriority: 'support',
    shotConsistencyClass: 'complex',
    hardFailureReasons: 'identity_swap',
  });

  assert.equal(decision.status, 'pass');
  assert.equal(decision.threshold, 7.0);
  assert.equal(decision.regenStrategy, 'none');
});

test('resolveCharacterPriority normalizes and falls back to support', () => {
  assert.equal(resolveCharacterPriority({ priority: 'lead' }), 'lead');
  assert.equal(resolveCharacterPriority({ priority: ' Lead ' }), 'lead');
  assert.equal(resolveCharacterPriority({ characterPriority: 'ANCHOR ' }), 'support');
  assert.equal(resolveCharacterPriority({ characterPriority: 'minor' }), 'support');
  assert.equal(resolveCharacterPriority({}), 'support');
});

test('classifyShotConsistencyClass identifies anchor and complex shots', () => {
  assert.equal(classifyShotConsistencyClass({ isFirstAppearance: true }), 'anchor');
  assert.equal(classifyShotConsistencyClass({ sceneType: 'action' }), 'complex');
  assert.equal(classifyShotConsistencyClass({}), 'standard');
});

test('anchor takes precedence when both anchor and complex signals exist', () => {
  const shotClass = classifyShotConsistencyClass({
    isFirstAppearance: true,
    isAction: true,
    sceneType: 'action',
  });

  assert.equal(shotClass, 'anchor');
});
