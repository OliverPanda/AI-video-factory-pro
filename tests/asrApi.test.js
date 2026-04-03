import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables, transcribeAudio } from '../src/apis/asrApi.js';

test('ASR provider router resolves placeholder providers explicitly', () => {
  const provider = __testables.resolveAsrProvider({ provider: 'openai' }, {});
  const handler = __testables.getAsrProviderHandler(provider);

  assert.equal(provider, 'openai');
  assert.equal(typeof handler, 'function');
  assert.rejects(
    () => handler('demo.wav', {}),
    /尚未接入|not implemented/i
  );
});

test('transcribeAudio dispatches mock provider through the router', async () => {
  const calls = [];
  const transcript = await transcribeAudio('demo.wav', {
    provider: 'mock',
    providerHandlers: {
      mock: async (audioPath, options) => {
        calls.push({ audioPath, options });
        return '这是 mock 转写';
      },
    },
  });

  assert.equal(transcript, '这是 mock 转写');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].audioPath, 'demo.wav');
});
