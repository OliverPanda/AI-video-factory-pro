import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTtsEvalSamples } from '../scripts/preview-tts-samples.js';

test('parseTtsEvalSamples groups labeled blocks into text samples', () => {
  const samples = parseTtsEvalSamples(`
平静叙述
今天的事，到此为止。

男女对话切换
女：你终于肯来了。
男：我不是不来，我是在等你先开口。
`);

  assert.deepEqual(samples, [
    { label: '平静叙述', text: '今天的事，到此为止。' },
    { label: '男女对话切换', text: '女：你终于肯来了。 男：我不是不来，我是在等你先开口。' },
  ]);
});

test('parseTtsEvalSamples keeps single-line samples intact', () => {
  const samples = parseTtsEvalSamples('今天的事，到此为止。');
  assert.deepEqual(samples, [
    { label: null, text: '今天的事，到此为止。' },
  ]);
});
