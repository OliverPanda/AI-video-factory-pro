import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertStartupEnv, getMissingEnvKeys, validateStartupEnv } from '../src/utils/envValidator.js';

test('getMissingEnvKeys 只返回缺失项', () => {
  assert.deepEqual(getMissingEnvKeys({ A: '1', B: ' ' }, ['A', 'B', 'C']), ['B', 'C']);
});

test('validateStartupEnv 在最小讯飞配置下通过', () => {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-validator-'));
  const scriptPath = path.join(scriptDir, 'script.txt');
  fs.writeFileSync(scriptPath, 'demo');

  try {
    const result = validateStartupEnv(
      { scriptPath, skipConsistencyCheck: true },
      {
        LLM_PROVIDER: 'deepseek',
        DEEPSEEK_API_KEY: 'x',
        XFYUN_TTS_APP_ID: 'appid',
        XFYUN_TTS_API_KEY: 'key',
        XFYUN_TTS_API_SECRET: 'secret',
        PRIMARY_API_PROVIDER: 'laozhang',
        LAOZHANG_API_KEY: 'k',
      }
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  } finally {
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test('validateStartupEnv 会拦截非老张图像平台', () => {
  const result = validateStartupEnv(
    { skipConsistencyCheck: true },
    {
      LLM_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'x',
      XFYUN_TTS_APP_ID: 'appid',
      XFYUN_TTS_API_KEY: 'key',
      XFYUN_TTS_API_SECRET: 'secret',
        PRIMARY_API_PROVIDER: 'together',
        LAOZHANG_API_KEY: 'k',
      }
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /仅支持 laozhang/);
});

test('assertStartupEnv 会输出清晰错误', () => {
  assert.throws(
    () =>
      assertStartupEnv(
        { skipConsistencyCheck: false, scriptPath: path.join(process.cwd(), 'missing.txt') },
        {
          LLM_PROVIDER: 'deepseek',
          PRIMARY_API_PROVIDER: 'laozhang',
        }
      ),
    /缺少 DEEPSEEK_API_KEY[\s\S]*缺少 QWEN_API_KEY[\s\S]*缺少 XFYUN_TTS_APP_ID[\s\S]*剧本文件不存在/
  );
});
