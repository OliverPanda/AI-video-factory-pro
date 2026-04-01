import fs from 'fs';

const TEXT_PROVIDER_KEYS = {
  deepseek: ['DEEPSEEK_API_KEY'],
  qwen: ['QWEN_API_KEY'],
  claude: ['ANTHROPIC_API_KEY'],
};

const VISION_PROVIDER_KEYS = {
  qwen: ['QWEN_API_KEY'],
  claude: ['ANTHROPIC_API_KEY'],
};

export function getMissingEnvKeys(env, keys) {
  return keys.filter((key) => !env[key] || String(env[key]).trim() === '');
}

export function validateStartupEnv(options = {}, env = process.env) {
  const errors = [];
  const llmProvider = env.LLM_PROVIDER || 'qwen';
  const visionProvider = env.LLM_VISION_PROVIDER || 'qwen';
  const imagePlatform = env.PRIMARY_API_PROVIDER || 'laozhang';

  const requiredTextKeys = TEXT_PROVIDER_KEYS[llmProvider];
  if (!requiredTextKeys) {
    errors.push(`未知文本 LLM Provider：${llmProvider}`);
  } else {
    errors.push(...getMissingEnvKeys(env, requiredTextKeys).map((key) => `缺少 ${key}`));
  }

  if (!options.skipConsistencyCheck) {
    const requiredVisionKeys = VISION_PROVIDER_KEYS[visionProvider];
    if (!requiredVisionKeys) {
      errors.push(`未知视觉 LLM Provider：${visionProvider}`);
    } else {
      errors.push(...getMissingEnvKeys(env, requiredVisionKeys).map((key) => `缺少 ${key}`));
    }
  }

  errors.push(
    ...getMissingEnvKeys(env, ['XFYUN_TTS_APP_ID', 'XFYUN_TTS_API_KEY', 'XFYUN_TTS_API_SECRET']).map(
      (key) => `缺少 ${key}`
    )
  );

  if (imagePlatform !== 'laozhang') {
    errors.push(`当前仅支持 laozhang 作为图像主平台，收到：${imagePlatform}`);
  } else {
    errors.push(...getMissingEnvKeys(env, ['LAOZHANG_API_KEY']).map((key) => `缺少 ${key}`));
  }

  if (options.scriptPath && !fs.existsSync(options.scriptPath)) {
    errors.push(`剧本文件不存在：${options.scriptPath}`);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertStartupEnv(options = {}, env = process.env) {
  const result = validateStartupEnv(options, env);
  if (!result.ok) {
    throw new Error(`启动前校验失败：\n- ${result.errors.join('\n- ')}`);
  }
}
