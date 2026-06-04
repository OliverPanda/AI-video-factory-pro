import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureEnglishPrompt, __testables } from '../src/utils/translatePrompt.js';

test('ensureEnglishPrompt bypasses pure English text', async () => {
  const result = await ensureEnglishPrompt('already english prompt');
  assert.equal(result, 'already english prompt');
});

test('ensureEnglishPrompt supports libretranslate-compatible free translation endpoint', async () => {
  const translated = await ensureEnglishPrompt('红光警报，角色抬眼', {
    provider: 'libretranslate',
    baseUrl: 'https://translate.example.com',
    fetchImpl: async (url, request) => {
      assert.equal(url, 'https://translate.example.com/translate');
      const body = JSON.parse(request.body);
      assert.equal(body.q, '红光警报，角色抬眼');
      assert.equal(body.target, 'en');
      return {
        ok: true,
        json: async () => ({ translatedText: 'red warning light, character looks up' }),
      };
    },
  });

  assert.equal(translated, 'red warning light, character looks up');
});

test('resolveTranslationProvider falls back to generic env contract before sora2-specific env', () => {
  const previousGeneric = process.env.PROMPT_TRANSLATION_PROVIDER;
  const previousLegacy = process.env.SORA2_TRANSLATION_PROVIDER;
  process.env.PROMPT_TRANSLATION_PROVIDER = 'libretranslate';
  process.env.SORA2_TRANSLATION_PROVIDER = 'llm';

  try {
    assert.equal(__testables.resolveTranslationProvider({}), 'libretranslate');
  } finally {
    if (previousGeneric == null) {
      delete process.env.PROMPT_TRANSLATION_PROVIDER;
    } else {
      process.env.PROMPT_TRANSLATION_PROVIDER = previousGeneric;
    }
    if (previousLegacy == null) {
      delete process.env.SORA2_TRANSLATION_PROVIDER;
    } else {
      process.env.SORA2_TRANSLATION_PROVIDER = previousLegacy;
    }
  }
});
