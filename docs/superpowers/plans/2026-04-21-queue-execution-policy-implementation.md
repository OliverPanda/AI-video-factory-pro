# Queue Execution Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立全项目统一的队列执行策略层，让测试环境不再走真实排队与真实退避，同时把所有走 `imageQueue` 的图像任务生产并发统一提升到 5。

**Architecture:** 在 `src/utils/queue.js` 中引入 environment-aware execution policy，把“队列执行、重试判定、延迟等待”从 agent 里抽离为 shared executor。图像相关 agent 统一改走 image executor；测试态通过 policy 关闭真实 `PQueue` 与真实 `sleep`，但保留失败/重试语义覆盖。

**Tech Stack:** Node.js, ESM, p-queue, node:test, assert/strict

---

## File Map

### Core Runtime

- Modify: `src/utils/queue.js`
  - 责任：定义生产/测试两套 queue execution policy，暴露 shared queue executor、retry controller、sleep abstraction。

### Image Agents

- Modify: `src/agents/characterRefSheetGenerator.js`
  - 责任：切到 shared image executor，不再直接依赖生产级 `imageQueue` 细节。
- Modify: `src/agents/imageGenerator.js`
  - 责任：切到 shared image executor，保持 artifact / retry log / timeout 行为不变。

### Tests

- Modify: `tests/characterRefSheetGenerator.test.js`
  - 责任：验证测试态不真实等待，并覆盖失败路径快速返回。
- Modify: `tests/imageGenerator.artifacts.test.js`
  - 责任：验证 image executor 接入后 artifact 不回归。
- Create or Modify: `tests/queue.test.js`
  - 责任：覆盖 policy、retry、sleep、imageQueue 默认并发 5。

### Optional Smoke / CLI Coverage

- Modify: `tests/runCli.test.js`
  - 责任：如有必要，覆盖 CLI 路径下 policy 注入不破坏现有参数处理。

## Task 1: Define Queue Execution Policy Surface

**Files:**
- Modify: `src/utils/queue.js`
- Test: `tests/queue.test.js`

- [ ] **Step 1: Write failing tests for policy selection and image queue defaults**

Add tests that assert:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExecutionPolicy,
  createRetryController,
  getQueueConfig,
} from '../src/utils/queue.js';

test('production image queue defaults to concurrency 5', () => {
  const config = getQueueConfig('image', { env: {} });
  assert.equal(config.concurrency, 5);
});

test('test policy disables real queueing and sleep', async () => {
  const policy = createExecutionPolicy({ mode: 'test' });
  assert.equal(policy.useRealQueue, false);
  assert.equal(policy.useRealSleep, false);
});
```

- [ ] **Step 2: Run the new queue tests and verify they fail**

Run: `node --test tests/queue.test.js`
Expected: FAIL because `createExecutionPolicy` / `getQueueConfig` are not implemented yet.

- [ ] **Step 3: Implement minimal policy and config helpers in `src/utils/queue.js`**

Add focused exports for:

```js
export function getExecutionMode(options = {}) {}
export function getQueueConfig(queueType, options = {}) {}
export function createExecutionPolicy(options = {}) {}
export function createRetryController(options = {}) {}
export async function sleepWithPolicy(delay, policy) {}
```

Requirements:
- image queue production defaults:
  - `concurrency: 5`
  - `interval: parseInt(process.env.IMAGE_QUEUE_INTERVAL_MS || '3000', 10)`
  - `intervalCap: parseInt(process.env.IMAGE_QUEUE_INTERVAL_CAP || '5', 10)`
- test policy:
  - `useRealQueue: false`
  - `useRealSleep: false`
  - `defaultMaxRetries: 1`

- [ ] **Step 4: Keep backward-compatible exports while introducing policy helpers**

Preserve existing exports:
- `imageQueue`
- `ttsQueue`
- `llmQueue`

But construct them from `getQueueConfig(...)` so default production parameters come from one place.

- [ ] **Step 5: Run queue tests and verify pass**

Run: `node --test tests/queue.test.js`
Expected: PASS

- [ ] **Step 6: Commit Task 1**

```bash
git add src/utils/queue.js tests/queue.test.js
git commit -m "feat: add queue execution policy primitives"
```

## Task 2: Move Retry and Sleep Into Shared Controller

**Files:**
- Modify: `src/utils/queue.js`
- Test: `tests/queue.test.js`

- [ ] **Step 1: Write failing tests for retry behavior without real sleep in test mode**

Add tests like:

```js
test('retry controller does not perform real sleep in test mode', async () => {
  const policy = createExecutionPolicy({ mode: 'test' });
  const retry = createRetryController({ policy });
  const start = Date.now();
  await retry.sleep(8000);
  assert.ok(Date.now() - start < 100);
});

test('retry controller still computes rate-limit delay', () => {
  const retry = createRetryController({ policy: createExecutionPolicy({ mode: 'production' }) });
  const delay = retry.getDelay(new Error('rate limit'), 1);
  assert.equal(delay, 8000);
});
```

- [ ] **Step 2: Run queue tests to verify fail**

Run: `node --test tests/queue.test.js`
Expected: FAIL on retry controller assertions.

- [ ] **Step 3: Refactor `queueWithRetry` to use retry controller and policy sleep**

Requirements:
- extract current delay logic into `getDelay(error, attempt)`
- preserve `onRetry` hook shape
- preserve existing error messages
- use policy-provided `sleep`
- keep default production behavior unchanged

- [ ] **Step 4: Add an execution wrapper for queued vs direct execution**

Implement a shared helper, e.g.:

```js
export async function executeQueuedTask(queueType, fn, options = {}) {}
```

Behavior:
- production: run via actual `PQueue#add`
- test: execute `fn()` directly

- [ ] **Step 5: Run queue tests and verify pass**

Run: `node --test tests/queue.test.js`
Expected: PASS

- [ ] **Step 6: Commit Task 2**

```bash
git add src/utils/queue.js tests/queue.test.js
git commit -m "refactor: move queue retry and sleep into shared policy"
```

## Task 3: Connect Character Ref Sheet Generation To Shared Image Executor

**Files:**
- Modify: `src/agents/characterRefSheetGenerator.js`
- Modify: `tests/characterRefSheetGenerator.test.js`
- Test: `tests/queue.test.js`

- [ ] **Step 1: Add a failing test that proves failure path returns quickly under test policy**

In `tests/characterRefSheetGenerator.test.js`, add a timing-safe assertion:

```js
test('generateCharacterRefSheets failure path does not incur production backoff in test policy', async () => {
  const startedAt = Date.now();
  await generateCharacterRefSheets([...], outputDir, {
    executionPolicy: { mode: 'test' },
    generateImage: async () => {
      throw new Error('API rate limit');
    },
  });
  assert.ok(Date.now() - startedAt < 1000);
});
```

- [ ] **Step 2: Run only the new ref-sheet test and verify fail**

Run: `node --test tests/characterRefSheetGenerator.test.js --test-name-pattern "does not incur production backoff"`
Expected: FAIL because current implementation still uses production queue/backoff.

- [ ] **Step 3: Update `characterRefSheetGenerator` to use shared image execution helpers**

Requirements:
- replace direct `queueWithRetry(imageQueue, ...)`
- route through shared image executor from `src/utils/queue.js`
- allow `options.executionPolicy` override for tests
- keep:
  - output structure
  - manifest format
  - QA summary behavior

- [ ] **Step 4: Re-run focused ref-sheet tests**

Run:
- `node --test tests/characterRefSheetGenerator.test.js --test-name-pattern "buildCharacterRefSheetPrompt|does not incur production backoff|gracefully handles generation failure|generates one ref sheet per character"`

Expected: PASS quickly, without 124s timeout.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/agents/characterRefSheetGenerator.js tests/characterRefSheetGenerator.test.js
git commit -m "refactor: route character ref sheets through shared image executor"
```

## Task 4: Connect Image Generator To Shared Image Executor

**Files:**
- Modify: `src/agents/imageGenerator.js`
- Modify: `tests/imageGenerator.artifacts.test.js`

- [ ] **Step 1: Add a failing test that asserts test policy skips real queue waiting**

Add a focused artifact/integration-style test:

```js
test('generateAllImages failure path does not wait on production backoff in test policy', async () => {
  const startedAt = Date.now();
  const results = await generateAllImages([...], outDir, {
    executionPolicy: { mode: 'test' },
    generateImage: async () => {
      throw new Error('429');
    },
  });
  assert.ok(Date.now() - startedAt < 1000);
  assert.equal(results[0].success, false);
});
```

- [ ] **Step 2: Run focused image generator tests and verify fail**

Run: `node --test tests/imageGenerator.artifacts.test.js --test-name-pattern "does not wait on production backoff"`
Expected: FAIL before implementation.

- [ ] **Step 3: Update `imageGenerator.js` to use the shared image execution helper**

Requirements:
- replace both `generateAllImages` and `regenerateImage` direct queue usage
- preserve:
  - retry log shape
  - timeout handling
  - error artifact files
  - existing result schema

- [ ] **Step 4: Re-run image generator artifact tests**

Run: `node --test tests/imageGenerator.artifacts.test.js`
Expected: PASS

- [ ] **Step 5: Commit Task 4**

```bash
git add src/agents/imageGenerator.js tests/imageGenerator.artifacts.test.js
git commit -m "refactor: route image generation through shared image executor"
```

## Task 5: Validate Production Defaults And Backward Compatibility

**Files:**
- Modify: `tests/queue.test.js`
- Modify: `tests/runCli.test.js`

- [ ] **Step 1: Add focused tests for production default config**

Add tests to assert:
- image queue concurrency defaults to 5
- image queue interval cap defaults to 5
- existing CLI parsing is unaffected

- [ ] **Step 2: Run focused config and CLI tests**

Run:
- `node --test tests/queue.test.js`
- `node --test tests/runCli.test.js`

Expected: PASS

- [ ] **Step 3: Verify no public API regression in queue exports**

Check imports across repo:

Run: `rg -n "imageQueue|queueWithRetry|ttsQueue|llmQueue" src tests`

Expected:
- no unexpected broken imports
- remaining direct imports are intentional or migrated

- [ ] **Step 4: Commit Task 5**

```bash
git add tests/queue.test.js tests/runCli.test.js
git commit -m "test: cover queue production defaults and compatibility"
```

## Task 6: Full Regression Gate For Queue Policy Retrofit

**Files:**
- No new code expected unless regressions found

- [ ] **Step 1: Run core queue/image regression suite**

Run:

```bash
node --test tests/queue.test.js tests/characterRefSheetGenerator.test.js tests/imageGenerator.artifacts.test.js
```

Expected:
- all pass
- `tests/characterRefSheetGenerator.test.js` no longer times out

- [ ] **Step 2: Run prompt/image adjacent regression**

Run:

```bash
node --test tests/promptEngineer.artifacts.test.js tests/characterRegistry.test.js
```

Expected: PASS, confirming shared executor retrofit did not break upstream visual chain assumptions.

- [ ] **Step 3: Inspect git diff for scope discipline**

Run:

```bash
git diff --stat
git diff -- src/utils/queue.js src/agents/characterRefSheetGenerator.js src/agents/imageGenerator.js tests/queue.test.js tests/characterRefSheetGenerator.test.js tests/imageGenerator.artifacts.test.js tests/runCli.test.js
```

Expected:
- changes remain limited to queue policy retrofit scope

- [ ] **Step 4: Commit final regression-safe integration**

```bash
git add src/utils/queue.js src/agents/characterRefSheetGenerator.js src/agents/imageGenerator.js tests/queue.test.js tests/characterRefSheetGenerator.test.js tests/imageGenerator.artifacts.test.js tests/runCli.test.js
git commit -m "feat: add shared queue execution policy for test and production"
```

## Notes For Implementers

- Do not hardcode `NODE_ENV === 'test'` checks inside agents. The policy must stay centralized in `src/utils/queue.js`.
- Do not remove production retry/backoff semantics.
- Do not break artifact filenames, manifest schema, or QA summary output.
- Keep `queueWithRetry` backward-compatible where possible, because other modules may still import it during the migration.
- If `tests/characterRefSheetGenerator.test.js` is still slow after Task 3, treat it as a blocking bug in the policy abstraction before moving on.

## Suggested Verification Sequence

1. `node --test tests/queue.test.js`
2. `node --test tests/characterRefSheetGenerator.test.js`
3. `node --test tests/imageGenerator.artifacts.test.js`
4. `node --test tests/promptEngineer.artifacts.test.js tests/characterRegistry.test.js`

## Suggested Review Focus

1. 测试态是否真的完全绕开真实 sleep
2. 生产态 image queue 默认并发是否为 5
3. 重试日志和错误 artifact 是否保持兼容
4. agent 是否仍然残留直接依赖生产级 queue 实现细节
