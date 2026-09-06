import test from 'node:test';
import assert from 'node:assert/strict';

import { createCli, parseCliArgs } from '../scripts/run.js';

test('parseCliArgs accepts project mode identifiers', () => {
  const result = parseCliArgs([
    '--project=demo-project',
    '--script=pilot-script',
    '--episode=episode-01',
    '--max-shots=5',
    '--provider=qwen',
  ]);

  assert.deepEqual(result, {
    projectId: 'demo-project',
    scriptId: 'pilot-script',
    episodeId: 'episode-01',
    style: null,
    maxShots: 5,
    skipConsistencyCheck: false,
    stopAt: 'full',
    continueRun: false,
    continueJobId: null,
    runAttemptId: null,
    provider: 'qwen',
    inputFormat: 'professional-script',
  });
});

test('parseCliArgs rejects positional script file arguments (D1 removed legacy mode)', () => {
  assert.throws(
    () => parseCliArgs(['samples/test_script.txt', '--style=3d', '--skip-consistency']),
    /位置参数剧本文件（samples\/test_script\.txt）已不再支持/
  );
});

test('parseCliArgs rejects legacy --project-id flag (D1 removed legacy mode)', () => {
  assert.throws(
    () => parseCliArgs(['--project-id=demo-project', '--project=demo', '--script=pilot', '--episode=e1']),
    /--project-id 已随兼容单文件模式整体移除/
  );
});

test('parseCliArgs defaults inputFormat to professional-script', () => {
  const result = parseCliArgs(['--project=demo-project', '--script=pilot-script', '--episode=episode-01']);
  assert.equal(result.inputFormat, 'professional-script');
});

test('parseCliArgs accepts raw-novel input format', () => {
  const result = parseCliArgs([
    '--project=demo-project',
    '--script=pilot-script',
    '--episode=episode-01',
    '--input-format=raw-novel',
  ]);
  assert.equal(result.inputFormat, 'raw-novel');
});

test('parseCliArgs accepts auto input format', () => {
  const result = parseCliArgs([
    '--project=demo-project',
    '--script=pilot-script',
    '--episode=episode-01',
    '--input-format=auto',
  ]);
  assert.equal(result.inputFormat, 'auto');
});

test('parseCliArgs rejects invalid input format', () => {
  assert.throws(
    () =>
      parseCliArgs([
        '--project=demo-project',
        '--script=pilot-script',
        '--episode=episode-01',
        '--input-format=wild',
      ]),
    /--input-format 必须是 professional-script、raw-novel 或 auto/
  );
});

test('parseCliArgs rejects invalid max-shots arguments', () => {
  assert.throws(
    () =>
      parseCliArgs([
        '--project=demo-project',
        '--script=pilot-script',
        '--episode=episode-01',
        '--max-shots=0',
      ]),
    /--max-shots 必须是大于 0 的整数/
  );
});

test('parseCliArgs rejects incomplete project mode arguments', () => {
  assert.throws(
    () => parseCliArgs(['--project=demo-project', '--script=pilot-script']),
    /必须同时提供 --project、--script 和 --episode/
  );
});

test('parseCliArgs rejects when nothing is provided', () => {
  assert.throws(() => parseCliArgs([]), /用法：/);
});

test('parseCliArgs remains compatible when queue execution policy env is set', () => {
  const originalPolicy = process.env.QUEUE_EXECUTION_POLICY;
  process.env.QUEUE_EXECUTION_POLICY = 'test';

  try {
    const result = parseCliArgs(['--project=demo-project', '--script=pilot-script', '--episode=episode-01']);
    assert.equal(result.projectId, 'demo-project');
    assert.equal(result.episodeId, 'episode-01');
  } finally {
    process.env.QUEUE_EXECUTION_POLICY = originalPolicy;
  }
});

test('createCli dispatches project mode to runEpisodePipeline', async () => {
  const originalTempDir = process.env.TEMP_DIR;
  process.env.TEMP_DIR = '/tmp/aivf-project-temp';
  const calls = [];
  try {
    const cli = createCli({
      runEpisodePipeline: async (payload) => {
        calls.push(payload);
        return '/tmp/project.mp4';
      },
      exit: () => {
        throw new Error('exit should not be called');
      },
      writeBanner: () => {},
      writeSuccess: () => {},
    });

    const outputPath = await cli.run([
      '--project=demo-project',
      '--script=pilot-script',
      '--episode=episode-01',
      '--style=realistic',
      '--skip-consistency',
      '--max-shots=5',
    ]);

    assert.equal(outputPath, '/tmp/project.mp4');
    assert.deepEqual(calls, [
      {
        projectId: 'demo-project',
        scriptId: 'pilot-script',
        episodeId: 'episode-01',
        options: {
          style: 'realistic',
          maxShots: 5,
          skipConsistencyCheck: true,
          inputFormat: 'professional-script',
          stopAt: 'full',
          continue: false,
          continueJobId: null,
          runAttemptId: null,
          storeOptions: { baseTempDir: '/tmp/aivf-project-temp' },
        },
      },
    ]);
  } finally {
    process.env.TEMP_DIR = originalTempDir;
  }
});

test('createCli passes explicit raw-novel input format into runEpisodePipeline options', async () => {
  const calls = [];
  const cli = createCli({
    runEpisodePipeline: async (payload) => {
      calls.push(payload);
      return '/tmp/raw-novel.mp4';
    },
    exit: () => {
      throw new Error('exit should not be called');
    },
    writeBanner: () => {},
    writeSuccess: () => {},
  });

  await cli.run([
    '--project=demo-project',
    '--script=pilot-script',
    '--episode=episode-01',
    '--input-format=raw-novel',
  ]);

  assert.equal(calls[0].options.inputFormat, 'raw-novel');
});

test('createCli exits with usage for positional script file', async () => {
  const usageMessages = [];
  const exitCodes = [];
  const cli = createCli({
    runEpisodePipeline: async () => {
      throw new Error('should not run project mode');
    },
    writeUsage: (message) => usageMessages.push(message),
    writeBanner: () => {
      throw new Error('banner should not be written for invalid input');
    },
    exit: (code) => exitCodes.push(code),
  });

  const result = await cli.run(['samples/test_script.txt', '--style=3d']);

  assert.equal(result, null);
  assert.deepEqual(exitCodes, [1]);
  assert.equal(usageMessages.length, 1);
  assert.match(usageMessages[0], /位置参数剧本文件/);
});

test('createCli exits with usage when no valid mode is provided', async () => {
  const usageMessages = [];
  const exitCodes = [];
  const cli = createCli({
    runEpisodePipeline: async () => {
      throw new Error('should not run project mode');
    },
    writeUsage: (message) => usageMessages.push(message),
    writeBanner: () => {
      throw new Error('banner should not be written for invalid input');
    },
    exit: (code) => exitCodes.push(code),
  });

  const result = await cli.run([]);

  assert.equal(result, null);
  assert.deepEqual(exitCodes, [1]);
  assert.equal(usageMessages.length, 1);
  assert.match(usageMessages[0], /用法：/);
  assert.match(usageMessages[0], /--project=<projectId>/);
});
