#!/usr/bin/env node
/**
 * CLI 入口
 * 兼容旧用法：node scripts/run.js <剧本文件路径> [选项]
 * 项目模式：node scripts/run.js --project=<projectId> --script=<scriptId> --episode=<episodeId> [选项]
 */

import 'dotenv/config';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import logger from '../src/utils/logger.js';

const USAGE = `
用法：
  node scripts/run.js <剧本文件路径> [选项]
  node scripts/run.js --project=<projectId> --script=<scriptId> --episode=<episodeId> [选项]

选项：
  --style=realistic|3d      视觉风格（默认：realistic）
  --skip-consistency        跳过一致性验证（加速测试）
  --provider=qwen|deepseek|claude  LLM提供商（覆盖.env设置）
  --project-id=<id>         为旧单文件入口指定 VoicePreset 所属项目

示例：
  node scripts/run.js samples/test_script.txt
  node scripts/run.js samples/test_script.txt --style=3d --skip-consistency
  node scripts/run.js samples/test_script.txt --project-id=demo-project
  node scripts/run.js --project=project-example --script=pilot --episode=episode-1 --style=realistic
`.trim();

function getFlagValue(args, flagName) {
  return args.find((arg) => arg.startsWith(`--${flagName}=`))?.split('=').slice(1).join('=') ?? null;
}

function normalizeId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseCliArgs(args) {
  const scriptFile = args.find((arg) => !arg.startsWith('--')) ?? null;
  const projectId = normalizeId(getFlagValue(args, 'project'));
  const scriptId = normalizeId(getFlagValue(args, 'script'));
  const episodeId = normalizeId(getFlagValue(args, 'episode'));
  const projectIdOverride = normalizeId(getFlagValue(args, 'project-id'));
  const style = normalizeId(getFlagValue(args, 'style'));
  const provider = normalizeId(getFlagValue(args, 'provider'));
  const skipConsistencyCheck = args.includes('--skip-consistency');
  const stopAfterImages = args.includes('--stop-after-images');
  const stopBeforeVideo = args.includes('--stop-before-video');

  const hasProjectModeFlags = projectId || scriptId || episodeId;
  const hasCompleteProjectMode = projectId && scriptId && episodeId;

  if (scriptFile && hasProjectModeFlags) {
    throw new Error('不能同时提供剧本文件路径和 --project/--script/--episode。');
  }

  if (hasProjectModeFlags && !hasCompleteProjectMode) {
    throw new Error('项目模式必须同时提供 --project、--script 和 --episode。');
  }

  if (!scriptFile && !hasCompleteProjectMode) {
    throw new Error(USAGE);
  }

  return {
    mode: hasCompleteProjectMode ? 'project' : 'legacy',
    scriptFile,
    projectId,
    scriptId,
    episodeId,
    projectIdOverride,
    style,
    skipConsistencyCheck,
    stopAfterImages,
    stopBeforeVideo,
    provider,
  };
}

export function createCli(overrides = {}) {
  const deps = {
    runPipeline: async (...args) => {
      const director = await import('../src/agents/director.js');
      return director.runPipeline(...args);
    },
    runEpisodePipeline: async (...args) => {
      const director = await import('../src/agents/director.js');
      return director.runEpisodePipeline(...args);
    },
    logger,
    cwd: () => process.cwd(),
    exit: (code) => process.exit(code),
    resolveScriptPath: (scriptFile) =>
      path.isAbsolute(scriptFile) ? scriptFile : path.resolve(process.cwd(), scriptFile),
    writeUsage: (message) => console.error(`\n${message}\n`),
    writeBanner: () =>
      console.log(`
╔════════════════════════════════════════╗
║    AI漫剧自动化生成系统 v1.0.0         ║
╚════════════════════════════════════════╝
`),
    writeSuccess: (outputPath) => console.log(`\n🎬 视频生成完成：${outputPath}`),
    ...overrides,
  };

  return {
    async run(args) {
      let parsedArgs;

      try {
        parsedArgs = parseCliArgs(args);
      } catch (error) {
        deps.writeUsage(error.message);
        deps.exit(1);
        return null;
      }

      if (parsedArgs.provider) {
        process.env.LLM_PROVIDER = parsedArgs.provider;
      }

      deps.writeBanner();

      if (parsedArgs.mode === 'project') {
        const outputPath = await deps.runEpisodePipeline({
          projectId: parsedArgs.projectId,
          scriptId: parsedArgs.scriptId,
          episodeId: parsedArgs.episodeId,
          options: {
            style: parsedArgs.style || process.env.IMAGE_STYLE || 'realistic',
            skipConsistencyCheck: parsedArgs.skipConsistencyCheck,
          },
        });
        deps.writeSuccess(outputPath);
        return outputPath;
      }

      const result = await deps.runPipeline(deps.resolveScriptPath(parsedArgs.scriptFile), {
        style: parsedArgs.style || process.env.IMAGE_STYLE || 'realistic',
        skipConsistencyCheck: parsedArgs.skipConsistencyCheck,
        stopAfterImages: parsedArgs.stopAfterImages,
        stopBeforeVideo: parsedArgs.stopBeforeVideo,
        projectId: parsedArgs.projectIdOverride,
      });
      if (parsedArgs.stopAfterImages) {
        deps.logger.info('Main', '已完成到出图阶段，跳过视频生成');
        return result;
      }
      if (parsedArgs.stopBeforeVideo) {
        deps.logger.info('Main', '已完成到视频前阶段，跳过视频生成');
        return result;
      }
      deps.writeSuccess(result);
      return result;
    },

    async runAndExit(args) {
      try {
        await this.run(args);
        deps.exit(0);
      } catch (error) {
        deps.logger.error('Main', `生成失败：${error.message}`);
        deps.exit(1);
      }
    },
  };
}

const cli = createCli();

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  cli.runAndExit(process.argv.slice(2));
}
