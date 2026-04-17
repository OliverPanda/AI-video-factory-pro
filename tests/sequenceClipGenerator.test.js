import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, generateSequenceClips } from '../src/agents/sequenceClipGenerator.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-sequence-generator-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('generateSequenceClips submits polls downloads and writes the minimum sequenceClipResults structure for seedance', async (t) => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = {
      outputsDir: path.join(tempRoot, '1-outputs'),
      metricsDir: path.join(tempRoot, '2-metrics'),
      errorsDir: path.join(tempRoot, '3-errors'),
      manifestPath: path.join(tempRoot, 'manifest.json'),
    };
    fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
    fs.mkdirSync(artifactContext.metricsDir, { recursive: true });
    fs.mkdirSync(artifactContext.errorsDir, { recursive: true });

    const calls = [];
    const providerClient = {
      async submit(sequencePackage) {
        calls.push(['submit', sequencePackage.sequenceId]);
        return {
          taskId: 'task_seq_001',
          provider: 'seedance',
          model: 'doubao-seedance-2-0-260128',
        };
      },
      async poll(taskId) {
        calls.push(['poll', taskId]);
        return {
          status: 'COMPLETED',
          outputUrl: 'https://example.com/sequence.mp4',
        };
      },
      async download(outputUrl, outputPath) {
        calls.push(['download', outputUrl, outputPath]);
        fs.writeFileSync(outputPath, Buffer.from('00000018667479706d703432', 'hex'));
        return { outputPath };
      },
    };

    const run = await generateSequenceClips(
      [
        {
          sequenceId: 'seq_001',
          shotIds: ['shot_001', 'shot_002'],
          durationTargetSec: 6.4,
          preferredProvider: 'seedance',
          referenceStrategy: 'image_first',
          fallbackProviders: ['bridge'],
          referenceImages: [{ path: '/tmp/shot_001.png' }],
          referenceVideos: [],
          bridgeReferences: [],
          visualGoal: '连续动作保持节奏',
          cameraSpec: 'handheld_follow',
          continuitySpec: 'keep_direction_and_subject',
          sequenceContextSummary: 'sequence type: fight_exchange_sequence | shot coverage: shot_001 -> shot_002',
          providerRequestHints: { referenceTier: 'image', referenceCount: 1 },
          entryFrameHint: 'enter_from_left',
          exitFrameHint: 'exit_to_right',
          audioBeatHints: ['beat_1'],
          qaRules: ['qa_pass_required'],
        },
      ],
      path.join(tempRoot, 'video'),
      {
        artifactContext,
        providerClient,
      }
    );

    assert.deepEqual(calls, [
      ['submit', 'seq_001'],
      ['poll', 'task_seq_001'],
      ['download', 'https://example.com/sequence.mp4', path.join(tempRoot, 'video', 'seq_001.mp4')],
    ]);
    assert.deepEqual(run.results[0], {
      sequenceId: 'seq_001',
      status: 'completed',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      videoPath: path.join(tempRoot, 'video', 'seq_001.mp4'),
      coveredShotIds: ['shot_001', 'shot_002'],
      targetDurationSec: 6.4,
      actualDurationSec: null,
      failureCategory: null,
      error: null,
    });
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'sequence-clip-results.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'sequence-generation-context.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'sequence-clip-generation-report.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'qa-summary.md')), true);
    assert.equal(fs.existsSync(artifactContext.manifestPath), true);
    const context = JSON.parse(fs.readFileSync(path.join(artifactContext.outputsDir, 'sequence-generation-context.json'), 'utf-8'));
    assert.equal(context[0].referenceStrategy, 'image_first');
    assert.equal(context[0].referenceTier, 'image');
    assert.match(context[0].sequenceContextSummary, /fight_exchange_sequence/);
    const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
    assert.equal(manifest.status, 'completed');
    assert.deepEqual(manifest.outputFiles, [
      'sequence-clip-results.json',
      'sequence-generation-context.json',
      'sequence-clip-generation-report.json',
      'sequence-clip-report.md',
    ]);
  });
});

test('generateSequenceClips lets providerClient handle a non-runway provider on the success path', async () => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = {
      outputsDir: path.join(tempRoot, '1-outputs'),
      metricsDir: path.join(tempRoot, '2-metrics'),
      errorsDir: path.join(tempRoot, '3-errors'),
      manifestPath: path.join(tempRoot, 'manifest.json'),
    };
    fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
    fs.mkdirSync(artifactContext.metricsDir, { recursive: true });
    fs.mkdirSync(artifactContext.errorsDir, { recursive: true });

    const providerClient = {
      async submit(sequencePackage) {
        assert.equal(sequencePackage.preferredProvider, 'custom_provider');
        return {
          taskId: 'task_custom_001',
          provider: 'custom_provider',
          model: 'custom-model',
        };
      },
      async poll(taskId) {
        assert.equal(taskId, 'task_custom_001');
        return {
          status: 'COMPLETED',
          outputUrl: 'https://example.com/custom-sequence.mp4',
        };
      },
      async download(_outputUrl, outputPath) {
        fs.writeFileSync(outputPath, Buffer.from('00000018667479706d703432', 'hex'));
      },
    };

    const run = await generateSequenceClips(
      [
        {
          sequenceId: 'seq_custom',
          shotIds: ['shot_101', 'shot_102'],
          durationTargetSec: 5.2,
          preferredProvider: 'custom_provider',
          fallbackProviders: ['bridge'],
          referenceImages: [{ path: '/tmp/shot_101.png' }],
          referenceVideos: [],
          bridgeReferences: [],
          visualGoal: '连续动作由自定义 provider 生成',
          cameraSpec: 'custom_follow',
          continuitySpec: 'keep_motion_flow',
          entryFrameHint: 'entry',
          exitFrameHint: 'exit',
          audioBeatHints: [],
          qaRules: [],
        },
      ],
      path.join(tempRoot, 'video'),
      {
        artifactContext,
        providerClient,
      }
    );

    assert.equal(run.results[0].status, 'completed');
    assert.equal(run.results[0].provider, 'custom_provider');
    assert.equal(run.results[0].actualDurationSec, null);
    assert.equal(fs.existsSync(path.join(tempRoot, 'video', 'seq_custom.mp4')), true);
  });
});

test('generateSequenceClips keeps explicit runway compatibility when requested', async () => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = {
      outputsDir: path.join(tempRoot, '1-outputs'),
      metricsDir: path.join(tempRoot, '2-metrics'),
      errorsDir: path.join(tempRoot, '3-errors'),
      manifestPath: path.join(tempRoot, 'manifest.json'),
    };
    fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
    fs.mkdirSync(artifactContext.metricsDir, { recursive: true });
    fs.mkdirSync(artifactContext.errorsDir, { recursive: true });

    const providerClient = {
      async submit(sequencePackage) {
        assert.equal(sequencePackage.preferredProvider, 'runway');
        return {
          taskId: 'task_runway_001',
          provider: 'runway',
          model: 'gen4_turbo',
        };
      },
      async poll() {
        return {
          status: 'COMPLETED',
          outputUrl: 'https://example.com/runway-sequence.mp4',
        };
      },
      async download(_outputUrl, outputPath) {
        fs.writeFileSync(outputPath, Buffer.from('00000018667479706d703432', 'hex'));
      },
    };

    const run = await generateSequenceClips(
      [
        {
          sequenceId: 'seq_runway',
          shotIds: ['shot_301', 'shot_302'],
          durationTargetSec: 5.2,
          preferredProvider: 'runway',
          fallbackProviders: ['bridge'],
          referenceImages: [{ path: '/tmp/shot_301.png' }],
          referenceVideos: [],
          bridgeReferences: [],
          visualGoal: '显式兼容 runway',
          cameraSpec: 'tracking',
          continuitySpec: 'keep_motion_flow',
          entryFrameHint: 'entry',
          exitFrameHint: 'exit',
          audioBeatHints: [],
          qaRules: [],
        },
      ],
      path.join(tempRoot, 'video'),
      {
        artifactContext,
        providerClient,
      }
    );

    assert.equal(run.results[0].status, 'completed');
    assert.equal(run.results[0].provider, 'runway');
  });
});

test('classifySequenceProviderError categorizes auth rate-limit timeout invalid-request and generation failures', () => {
  assert.equal(
    __testables.classifySequenceProviderError({ message: 'unauthorized', response: { status: 401, data: {} } }).category,
    'provider_auth_error'
  );
  assert.equal(
    __testables.classifySequenceProviderError({ message: 'slow down', response: { status: 429, data: {} } }).category,
    'provider_rate_limit'
  );
  assert.equal(
    __testables.classifySequenceProviderError({ message: 'bad request', response: { status: 400, data: {} } }).category,
    'provider_invalid_request'
  );
  assert.equal(
    __testables.classifySequenceProviderError({ message: 'timeout', code: 'ECONNABORTED' }).category,
    'provider_timeout'
  );
  assert.equal(
    __testables.classifySequenceProviderError({ message: 'server boom', response: { status: 500, data: {} } }).category,
    'provider_generation_failed'
  );
});

test('resolveSequenceWorkflow defaults to unified seedance client when sequence package does not declare provider', () => {
  const previousVideoProvider = process.env.VIDEO_PROVIDER;
  delete process.env.VIDEO_PROVIDER;

  try {
    const workflow = __testables.resolveSequenceWorkflow(
      {
        sequenceId: 'seq_default_provider',
      },
      {}
    );

    assert.equal(workflow.kind, 'unified_seedance_client');
  } finally {
    if (previousVideoProvider == null) {
      delete process.env.VIDEO_PROVIDER;
    } else {
      process.env.VIDEO_PROVIDER = previousVideoProvider;
    }
  }
});

test('resolveSequenceWorkflow follows fallback_video override when sequence package omits provider', () => {
  const workflow = __testables.resolveSequenceWorkflow(
    {
      sequenceId: 'seq_default_fallback_provider',
    },
    {
      videoProvider: 'fallback_video',
    }
  );

  assert.equal(workflow.kind, 'sora2');
});

test('resolveSequenceWorkflow treats seedance main-path sequences as unified client work instead of legacy seedance workflow', () => {
  const previousVideoProvider = process.env.VIDEO_PROVIDER;
  process.env.VIDEO_PROVIDER = 'seedance';

  try {
    const workflow = __testables.resolveSequenceWorkflow(
      {
        sequenceId: 'seq_unified_seedance',
        preferredProvider: 'seedance',
      },
      {}
    );

    assert.equal(workflow.kind, 'unified_seedance_client');
  } finally {
    if (previousVideoProvider == null) {
      delete process.env.VIDEO_PROVIDER;
    } else {
      process.env.VIDEO_PROVIDER = previousVideoProvider;
    }
  }
});

test('generateSequenceClips surfaces providerClient polling timeout as provider_timeout', async () => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = {
      outputsDir: path.join(tempRoot, '1-outputs'),
      metricsDir: path.join(tempRoot, '2-metrics'),
      errorsDir: path.join(tempRoot, '3-errors'),
      manifestPath: path.join(tempRoot, 'manifest.json'),
    };
    fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
    fs.mkdirSync(artifactContext.metricsDir, { recursive: true });
    fs.mkdirSync(artifactContext.errorsDir, { recursive: true });

    const providerClient = {
      async submit() {
        return {
          taskId: 'task_timeout_001',
          provider: 'custom_provider',
          model: 'custom-model',
        };
      },
      async poll() {
        return {
          status: 'RUNNING',
        };
      },
      async download() {
        throw new Error('should not download on timeout');
      },
    };

    const run = await generateSequenceClips(
      [
        {
          sequenceId: 'seq_timeout',
          shotIds: ['shot_201', 'shot_202'],
          durationTargetSec: 4.8,
          preferredProvider: 'custom_provider',
          fallbackProviders: ['bridge'],
          referenceImages: [{ path: '/tmp/shot_201.png' }],
          referenceVideos: [],
          bridgeReferences: [],
          visualGoal: '超时场景',
          cameraSpec: 'custom_follow',
          continuitySpec: 'keep_motion_flow',
          entryFrameHint: 'entry',
          exitFrameHint: 'exit',
          audioBeatHints: [],
          qaRules: [],
        },
      ],
      path.join(tempRoot, 'video'),
      {
        artifactContext,
        providerClient,
        overallTimeoutMs: 1,
        pollIntervalMs: 0,
        sleep: async () => {},
      }
    );

    assert.equal(run.results[0].status, 'failed');
    assert.equal(run.results[0].failureCategory, 'provider_timeout');
    assert.equal(fs.existsSync(path.join(artifactContext.errorsDir, 'seq_timeout-sequence-error.json')), true);
  });
});

test('generateSequenceClips does not mark empty or pseudo downloads as successful', async (t) => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = {
      outputsDir: path.join(tempRoot, '1-outputs'),
      metricsDir: path.join(tempRoot, '2-metrics'),
      errorsDir: path.join(tempRoot, '3-errors'),
      manifestPath: path.join(tempRoot, 'manifest.json'),
    };
    fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
    fs.mkdirSync(artifactContext.metricsDir, { recursive: true });
    fs.mkdirSync(artifactContext.errorsDir, { recursive: true });

    const providerClient = {
      async submit() {
        return {
          taskId: 'task_bad_001',
          provider: 'seedance',
          model: 'doubao-seedance-2-0-260128',
        };
      },
      async poll() {
        return {
          status: 'COMPLETED',
          outputUrl: 'https://example.com/bad-sequence.mp4',
        };
      },
      async download(_outputUrl, outputPath) {
        fs.writeFileSync(outputPath, '');
      },
    };

    const run = await generateSequenceClips(
      [
        {
          sequenceId: 'seq_bad',
          shotIds: ['shot_010', 'shot_011'],
          durationTargetSec: 4.8,
          preferredProvider: 'seedance',
          fallbackProviders: ['bridge'],
          referenceImages: [{ path: '/tmp/shot_010.png' }],
          referenceVideos: [],
          bridgeReferences: [],
          visualGoal: '连续动作',
          cameraSpec: 'follow',
          continuitySpec: 'keep_subject',
          entryFrameHint: 'entry',
          exitFrameHint: 'exit',
          audioBeatHints: [],
          qaRules: [],
        },
      ],
      path.join(tempRoot, 'video'),
      {
        artifactContext,
        providerClient,
      }
    );

    assert.equal(run.results[0].status, 'failed');
    assert.equal(run.results[0].failureCategory, 'provider_generation_failed');
    assert.equal(run.results[0].provider, 'seedance');
    assert.equal(run.results[0].videoPath, null);
    assert.equal(fs.existsSync(run.results[0].videoPath || ''), false);
    assert.equal(fs.existsSync(path.join(artifactContext.errorsDir, 'seq_bad-sequence-error.json')), true);
    const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
    assert.equal(manifest.status, 'completed_with_errors');
  });
});
