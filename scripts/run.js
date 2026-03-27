#!/usr/bin/env node
/**
 * 入口脚本
 * 用法：node scripts/run.js <剧本文件路径> [选项]
 *
 * 选项：
 *   --style=realistic|3d      视觉风格（默认：realistic）
 *   --skip-consistency        跳过一致性验证（加速测试）
 *   --provider=deepseek|qwen  LLM提供商（覆盖.env设置）
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { runPipeline } from '../src/agents/director.js';
import logger from '../src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 解析命令行参数 ──────────────────────────────────────────
const args = process.argv.slice(2);
const scriptArg = args.find((a) => !a.startsWith('--'));
const styleArg = args.find((a) => a.startsWith('--style='))?.split('=')[1];
const skipConsistency = args.includes('--skip-consistency');
const providerArg = args.find((a) => a.startsWith('--provider='))?.split('=')[1];

if (!scriptArg) {
  console.error(`
用法：node scripts/run.js <剧本文件路径> [选项]

选项：
  --style=realistic|3d      视觉风格（默认：realistic）
  --skip-consistency        跳过一致性验证（加速测试）
  --provider=deepseek|qwen  LLM提供商（覆盖.env设置）

示例：
  node scripts/run.js samples/test_script.txt
  node scripts/run.js samples/test_script.txt --style=3d --skip-consistency
`);
  process.exit(1);
}

// 命令行参数覆盖环境变量
if (providerArg) process.env.LLM_PROVIDER = providerArg;

const scriptPath = path.isAbsolute(scriptArg)
  ? scriptArg
  : path.resolve(process.cwd(), scriptArg);

// ─── 运行 ───────────────────────────────────────────────────
console.log(`
╔════════════════════════════════════════╗
║    AI漫剧自动化生成系统 v1.0.0         ║
╚════════════════════════════════════════╝
`);

runPipeline(scriptPath, {
  style: styleArg || process.env.IMAGE_STYLE || 'realistic',
  skipConsistencyCheck: skipConsistency,
})
  .then((outputPath) => {
    console.log(`\n🎬 视频生成完成：${outputPath}`);
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Main', `生成失败：${err.message}`);
    process.exit(1);
  });
