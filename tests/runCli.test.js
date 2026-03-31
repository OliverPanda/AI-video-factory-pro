import test from 'node:test';
import assert from 'node:assert/strict';

import { createCli, parseCliArgs } from '../scripts/run.js';

test('parseCliArgs keeps legacy single-script mode intact', () => {
  const result = parseCliArgs(['samples/test_script.txt', '--style=3d', '--skip-consistency']);

  assert.deepEqual(result, {
    mode: 'legacy',
    scriptFile: 'samples/test_script.txt',
    projectId: null,
    scriptId: null,
    episodeId: null,
    style: '3d',
    skipConsistencyCheck: true,
    provider: null,
  });
});

test('parseCliArgs accepts project mode identifiers', () => {
  const result = parseCliArgs([
    '--project=demo-project',
    '--script=pilot-script',
    '--episode=episode-01',
    '--provider=qwen',
  ]);

  assert.deepEqual(result, {
    mode: 'project',
    scriptFile: null,
    projectId: 'demo-project',
    scriptId: 'pilot-script',
    episodeId: 'episode-01',
    style: null,
    skipConsistencyCheck: false,
    provider: 'qwen',
  });
});

test('parseCliArgs rejects incomplete project mode arguments', () => {
  assert.throws(
    () => parseCliArgs(['--project=demo-project', '--script=pilot-script']),
    /必须同时提供 --project、--script 和 --episode/
  );
});

test('parseCliArgs rejects mixed legacy and project mode arguments', () => {
  assert.throws(
    () => parseCliArgs(['samples/test_script.txt', '--project=demo-project', '--script=pilot', '--episode=e1']),
    /不能同时提供剧本文件路径和 --project\/--script\/--episode/
  );
});

test('createCli dispatches legacy mode to runPipeline', async () => {
  const calls = [];
  const cli = createCli({
    runPipeline: async (scriptPath, options) => {
      calls.push({ type: 'legacy', scriptPath, options });
      return '/tmp/legacy.mp4';
    },
    runEpisodePipeline: async () => {
      throw new Error('should not run episode mode');
    },
    exit: () => {
      throw new Error('exit should not be called');
    },
    resolveScriptPath: (scriptPath) => scriptPath,
    writeBanner: () => {},
    writeSuccess: () => {},
  });

  const outputPath = await cli.run(['samples/test_script.txt', '--style=3d', '--skip-consistency']);

  assert.equal(outputPath, '/tmp/legacy.mp4');
  assert.deepEqual(calls, [
    {
      type: 'legacy',
      scriptPath: 'samples/test_script.txt',
      options: { style: '3d', skipConsistencyCheck: true },
    },
  ]);
});

test('createCli dispatches project mode to runEpisodePipeline', async () => {
  const calls = [];
  const cli = createCli({
    runPipeline: async () => {
      throw new Error('should not run legacy mode');
    },
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
  ]);

  assert.equal(outputPath, '/tmp/project.mp4');
  assert.deepEqual(calls, [
    {
      projectId: 'demo-project',
      scriptId: 'pilot-script',
      episodeId: 'episode-01',
      options: { style: 'realistic', skipConsistencyCheck: true },
    },
  ]);
});

test('createCli exits with usage for invalid mixed arguments', async () => {
  const usageMessages = [];
  const exitCodes = [];
  const cli = createCli({
    runPipeline: async () => {
      throw new Error('should not run legacy mode');
    },
    runEpisodePipeline: async () => {
      throw new Error('should not run project mode');
    },
    writeUsage: (message) => usageMessages.push(message),
    writeBanner: () => {
      throw new Error('banner should not be written for invalid input');
    },
    exit: (code) => exitCodes.push(code),
  });

  const result = await cli.run([
    'samples/test_script.txt',
    '--project=demo-project',
    '--script=pilot-script',
    '--episode=episode-01',
  ]);

  assert.equal(result, null);
  assert.deepEqual(exitCodes, [1]);
  assert.equal(usageMessages.length, 1);
  assert.match(usageMessages[0], /不能同时提供剧本文件路径和 --project\/--script\/--episode/);
});

test('createCli exits with usage when no valid mode is provided', async () => {
  const usageMessages = [];
  const exitCodes = [];
  const cli = createCli({
    runPipeline: async () => {
      throw new Error('should not run legacy mode');
    },
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
