import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createExecutionPolicy,
  createRetryController,
  executeQueuedTask,
  getExecutionMode,
  getQueueConfig,
  imageQueue,
  llmQueue,
  queueWithRetry,
  sleepWithPolicy,
  ttsQueue,
} from '../src/utils/queue.js';

test('getExecutionMode prefers explicit mode over environment', () => {
  const mode = getExecutionMode({
    mode: 'test',
    env: { QUEUE_EXECUTION_POLICY: 'production', NODE_ENV: 'production' },
  });

  assert.equal(mode, 'test');
});

test('production image queue defaults to concurrency 5 with interval settings', () => {
  const config = getQueueConfig('image', { env: {} });

  assert.equal(config.concurrency, 5);
  assert.equal(config.interval, 3000);
  assert.equal(config.intervalCap, 5);
});

test('production image queue config remains environment-overridable for backward compatibility', () => {
  const config = getQueueConfig('image', {
    env: {
      IMAGE_QUEUE_CONCURRENCY: '7',
      IMAGE_QUEUE_INTERVAL_MS: '4500',
      IMAGE_QUEUE_INTERVAL_CAP: '3',
    },
  });

  assert.deepEqual(config, {
    concurrency: 7,
    interval: 4500,
    intervalCap: 3,
  });
});

test('test execution policy disables real queueing and sleep', () => {
  const policy = createExecutionPolicy({ mode: 'test' });

  assert.equal(policy.mode, 'test');
  assert.equal(policy.useRealQueue, false);
  assert.equal(policy.useRealSleep, false);
  assert.equal(policy.defaultMaxRetries, 1);
});

test('retry controller uses policy defaults and skips real sleep in test mode', async () => {
  const retry = createRetryController({
    policy: createExecutionPolicy({ mode: 'test' }),
  });

  const startedAt = Date.now();
  await retry.sleep(50);

  assert.equal(retry.maxRetries, 1);
  assert.ok(Date.now() - startedAt < 25);
});

test('retry controller does not perform real sleep in test mode', async () => {
  const retry = createRetryController({
    policy: createExecutionPolicy({ mode: 'test' }),
  });

  const startedAt = Date.now();
  await retry.sleep(8000);

  assert.ok(Date.now() - startedAt < 100);
});

test('retry controller still computes rate-limit delay', () => {
  const retry = createRetryController({
    policy: createExecutionPolicy({ mode: 'production' }),
  });

  const delay = retry.getDelay(new Error('rate limit'), 1);

  assert.equal(delay, 8000);
});

test('executeQueuedTask uses real queue in production mode', async () => {
  let addCalls = 0;
  let executed = false;
  const queue = {
    add(fn) {
      addCalls += 1;
      return Promise.resolve().then(fn);
    },
  };

  const result = await executeQueuedTask(
    'image',
    async () => {
      executed = true;
      return 'queued-result';
    },
    {
      policy: createExecutionPolicy({ mode: 'production' }),
      queue,
    },
  );

  assert.equal(result, 'queued-result');
  assert.equal(addCalls, 1);
  assert.equal(executed, true);
});

test('executeQueuedTask executes directly in test mode', async () => {
  let addCalls = 0;
  const queue = {
    add() {
      addCalls += 1;
      throw new Error('should not use queue.add in test mode');
    },
  };

  const result = await executeQueuedTask(
    'image',
    async () => 'direct-result',
    {
      policy: createExecutionPolicy({ mode: 'test' }),
      queue,
    },
  );

  assert.equal(result, 'direct-result');
  assert.equal(addCalls, 0);
});

test('queueWithRetry uses the provided queue and preserves retry hook shape', async () => {
  let addCalls = 0;
  let attempts = 0;
  const retries = [];
  const queue = {
    add(fn) {
      addCalls += 1;
      return Promise.resolve().then(fn);
    },
  };

  const result = await queueWithRetry(
    queue,
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('rate limit');
      }

      return 'ok';
    },
    2,
    'image-task',
    {
      policy: createExecutionPolicy({ mode: 'production', useRealSleep: false }),
      onRetry(info) {
        retries.push(info);
      },
    },
  );

  assert.equal(result, 'ok');
  assert.equal(addCalls, 1);
  assert.equal(attempts, 2);
  assert.deepEqual(retries, [
    {
      taskName: 'image-task',
      attempt: 1,
      maxRetries: 2,
      delay: 8000,
      error: new Error('rate limit'),
    },
  ]);
});

test('queueWithRetry wraps final error with legacy message semantics', async () => {
  const queue = {
    add(fn) {
      return Promise.resolve().then(fn);
    },
  };

  await assert.rejects(
    queueWithRetry(
      queue,
      async () => {
        throw new Error('boom');
      },
      2,
      'failing-task',
      {
        policy: createExecutionPolicy({ mode: 'production', useRealSleep: false }),
      },
    ),
    (error) => {
      assert.equal(error.message, '[Queue] failing-task 重试2次后失败：boom');
      return true;
    },
  );
});

test('queueWithRetry fails fast when neither queue nor queueType is provided', async () => {
  await assert.rejects(
    queueWithRetry(
      undefined,
      async () => 'unused',
      1,
      'missing-queue',
      {
        policy: createExecutionPolicy({ mode: 'production' }),
      },
    ),
    /queueWithRetry requires a queue or queueType/,
  );
});

test('queueWithRetry contract in test mode still retries while bypassing queue.add', async () => {
  let addCalls = 0;
  let attempts = 0;
  const queue = {
    add() {
      addCalls += 1;
      throw new Error('test mode should bypass queue.add');
    },
  };

  const result = await queueWithRetry(
    queue,
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('rate limit');
      }

      return 'recovered';
    },
    2,
    'test-mode-task',
    {
      policy: createExecutionPolicy({ mode: 'test', defaultMaxRetries: 2 }),
    },
  );

  assert.equal(result, 'recovered');
  assert.equal(addCalls, 0);
  assert.equal(attempts, 2);
});

test('queueWithRetry supports queueType-only routing without falling back to image queue', async () => {
  const originalImageAdd = imageQueue.add.bind(imageQueue);
  const originalTtsAdd = ttsQueue.add.bind(ttsQueue);
  let imageAddCalls = 0;
  let ttsAddCalls = 0;

  imageQueue.add = () => {
    imageAddCalls += 1;
    throw new Error('should not route queueType-only task to image queue');
  };

  ttsQueue.add = (fn, options) => {
    ttsAddCalls += 1;
    return originalTtsAdd(fn, options);
  };

  try {
    const result = await queueWithRetry(
      undefined,
      async () => 'tts-routed',
      1,
      'tts-only-task',
      {
        queueType: 'tts',
        policy: createExecutionPolicy({ mode: 'production', useRealSleep: false }),
      },
    );

    assert.equal(result, 'tts-routed');
    assert.equal(ttsAddCalls, 1);
    assert.equal(imageAddCalls, 0);
  } finally {
    imageQueue.add = originalImageAdd;
    ttsQueue.add = originalTtsAdd;
  }
});

test('sleepWithPolicy resolves immediately when policy disables real sleep', async () => {
  const startedAt = Date.now();
  await sleepWithPolicy(100, { useRealSleep: false });

  assert.ok(Date.now() - startedAt < 25);
});

test('backward-compatible queue exports remain available', () => {
  assert.equal(typeof imageQueue.add, 'function');
  assert.equal(typeof ttsQueue.add, 'function');
  assert.equal(typeof llmQueue.add, 'function');
  assert.equal(imageQueue.concurrency, 5);
});
