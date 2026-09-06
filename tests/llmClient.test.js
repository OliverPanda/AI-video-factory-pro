import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chat,
  chatJSON,
  healthCheck,
  parseJSONResponse,
  __testables,
} from '../src/llm/client.js';

// P1a：LLM 客户端测试护栏（零网络）。
// 覆盖纯函数 parseJSONResponse 与 provider 路由的离线拒绝路径，
// 为 P1c 传输层替换（→ Vercel AI SDK）提供行为基线。

test('parseJSONResponse 直接解析纯 JSON 对象', () => {
  assert.deepEqual(parseJSONResponse('{"ok":true,"shots":[1,2]}'), { ok: true, shots: [1, 2] });
});

test('parseJSONResponse 剥去 ```json 代码块包裹', () => {
  const raw = '```json\n{"title":"第一集","shots":[]}\n```';
  assert.deepEqual(parseJSONResponse(raw), { title: '第一集', shots: [] });
});

test('parseJSONResponse 剥去不带语言标记的 ``` 包裹', () => {
  const raw = '```\n{"a":1}\n```';
  assert.deepEqual(parseJSONResponse(raw), { a: 1 });
});

test('parseJSONResponse 从带前后缀文本中提取首个 JSON 对象（单层嵌套边界）', () => {
  // 现实现支持一层嵌套递归；二层嵌套（对象内再含数组对象）超出其能力，属已知边界
  const raw = '以下是解析结果：\n{"episode":{"id":"ep_1"}}\n请查收。';
  const parsed = parseJSONResponse(raw);
  assert.equal(parsed.episode.id, 'ep_1');
});

test('parseJSONResponse 从文本中提取数组', () => {
  const raw = '角色列表：\n[{"name":"陆衍"},{"name":"沈清"}] 共 2 人';
  const parsed = parseJSONResponse(raw);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].name, '沈清');
});

test('parseJSONResponse 无有效 JSON 时抛出含原文的错误', () => {
  assert.throws(() => parseJSONResponse('这不是 JSON'), /无效的 JSON/);
  assert.throws(() => parseJSONResponse(''), /无效的 JSON/);
});

test('chat 拒绝未知 provider（离线，不发请求）', async () => {
  await assert.rejects(
    () => chat([{ role: 'user', content: 'hi' }], { provider: 'no_such_provider' }),
    /Unknown LLM provider: no_such_provider/
  );
});

test('chatJSON 对未知 provider 同样在调用前拒绝', async () => {
  await assert.rejects(
    () => chatJSON([{ role: 'user', content: 'hi' }], { provider: 'no_such_provider' }),
    /Unknown LLM provider: no_such_provider/
  );
});

test('healthCheck 对未知 provider 返回 ok:false 与提示而非抛错', async () => {
  const result = await healthCheck({ provider: 'no_such_provider' });
  assert.equal(result.ok, false);
  assert.match(result.error, /未知 Provider/);
  assert.match(result.hint, /LLM_PROVIDER/);
});

// P1d：callWithPolicy 共享队列出口 —— test/策略化路径直跑，生产路径经 llmQueue（均不真连网）
test('callWithPolicy 在直跑策略（useRealQueue=false）下不排队直接执行并返回原值', async () => {
  const { callWithPolicy } = __testables;
  let calls = 0;
  const result = await callWithPolicy(
    async () => {
      calls += 1;
      return { text: 'direct', finishReason: 'stop' };
    },
    {},
    { op: 'chat', provider: 'qwen', model: 'mock' }
  );
  assert.equal(calls, 1);
  assert.equal(result.text, 'direct');
});

test('callWithPolicy 在生产策略（useRealQueue=true）下经 llmQueue 执行并返回原值', async () => {
  const { callWithPolicy } = __testables;
  let calls = 0;
  const policy = {
    mode: 'production',
    useRealQueue: true,
    useRealSleep: true,
    defaultMaxRetries: 1,
    env: process.env,
  };
  const result = await callWithPolicy(
    async () => {
      calls += 1;
      return { text: 'queued', finishReason: 'stop' };
    },
    { executionPolicy: policy },
    { op: 'chat', provider: 'qwen', model: 'mock' }
  );
  assert.equal(calls, 1);
  assert.equal(result.text, 'queued');
});
