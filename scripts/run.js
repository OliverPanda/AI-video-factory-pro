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
  --max-shots=<number>      仅处理前 N 个分镜（用于抽样验证）
  --provider=qwen|deepseek|claude  LLM提供商（覆盖.env设置）
  --project-id=<id>         为旧单文件入口指定 VoicePreset 所属项目
  --input-format=professional-script|raw-novel|auto
                             输入文本类型（默认：professional-script）
  --stop-at=full|after_ref_sheets|after_images|before_video
                             运行到指定阶段后停止（默认：full）
  --continue                 根据现有进度继续运行（复用最近一次的 jobId）
  --continue-job-id=<id>     继续运行时显式指定要复用的 jobId
  --run-attempt-id=<id>      指定本次运行 attempt ID（用于前后端状态对齐）

示例：
  node scripts/run.js samples/test_script.txt
  node scripts/run.js samples/test_script.txt --style=3d --skip-consistency
  node scripts/run.js samples/test_script.txt --project-id=demo-project
  node scripts/run.js --project=project-example --script=pilot --episode=episode-1 --style=realistic
  node scripts/run.js --project=project-example --script=pilot --episode=episode-1 --stop-at=after_images
  node scripts/run.js --project=project-example --script=pilot --episode=episode-1 --continue --stop-at=before_video
`.trim();

function getFlagValue(args, flagName) {
  return args.find((arg) => arg.startsWith(`--${flagName}=`))?.split('=').slice(1).join('=') ?? null;
}

function normalizeId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const INPUT_FORMATS = new Set(['professional-script', 'raw-novel', 'auto']);

function normalizeInputFormat(value) {
  const normalized = normalizeId(value) || 'professional-script';
  if (!INPUT_FORMATS.has(normalized)) {
    throw new Error('--input-format 必须是 professional-script、raw-novel 或 auto。');
  }
  return normalized;
}

function resolveStoreOptions() {
  const baseTempDir = process.env.TEMP_DIR || './temp';
  return { baseTempDir };
}

export function parseCliArgs(args) {
  const scriptFile = args.find((arg) => !arg.startsWith('--')) ?? null;
  const projectId = normalizeId(getFlagValue(args, 'project'));
  const scriptId = normalizeId(getFlagValue(args, 'script'));
  const episodeId = normalizeId(getFlagValue(args, 'episode'));
  const projectIdOverride = normalizeId(getFlagValue(args, 'project-id'));
  const style = normalizeId(getFlagValue(args, 'style'));
  const provider = normalizeId(getFlagValue(args, 'provider'));
  const maxShotsRaw = normalizeId(getFlagValue(args, 'max-shots'));
  const skipConsistencyCheck = args.includes('--skip-consistency');
  const stopAtFlag = normalizeId(getFlagValue(args, 'stop-at'));
  const continueRun = args.includes('--continue');
  const continueJobId = normalizeId(getFlagValue(args, 'continue-job-id'));
  const runAttemptId = normalizeId(getFlagValue(args, 'run-attempt-id'));
  const inputFormat = normalizeInputFormat(getFlagValue(args, 'input-format'));

  let maxShots = null;
  if (maxShotsRaw !== null) {
    const parsedMaxShots = Number.parseInt(maxShotsRaw, 10);
    if (!Number.isInteger(parsedMaxShots) || parsedMaxShots <= 0) {
      throw new Error('--max-shots 必须是大于 0 的整数。');
    }
    maxShots = parsedMaxShots;
  }

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

  let stopAt = stopAtFlag || 'full';

  return {
    mode: hasCompleteProjectMode ? 'project' : 'legacy',
    scriptFile,
    projectId,
    scriptId,
    episodeId,
    projectIdOverride,
    style,
    maxShots,
    skipConsistencyCheck,
    stopAt,
    continueRun,
    continueJobId,
    runAttemptId,
    provider,
    inputFormat,
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
            maxShots: parsedArgs.maxShots,
            skipConsistencyCheck: parsedArgs.skipConsistencyCheck,
            inputFormat: parsedArgs.inputFormat,
            stopAt: parsedArgs.stopAt,
            continue: parsedArgs.continueRun,
            continueJobId: parsedArgs.continueJobId,
            runAttemptId: parsedArgs.runAttemptId,
            storeOptions: resolveStoreOptions(),
          },
        });
        deps.writeSuccess(outputPath);
        return outputPath;
      }

      const result = await deps.runPipeline(deps.resolveScriptPath(parsedArgs.scriptFile), {
        style: parsedArgs.style || process.env.IMAGE_STYLE || 'realistic',
        maxShots: parsedArgs.maxShots,
        skipConsistencyCheck: parsedArgs.skipConsistencyCheck,
        stopAt: parsedArgs.stopAt,
        projectId: parsedArgs.projectIdOverride,
        inputFormat: parsedArgs.inputFormat,
        runAttemptId: parsedArgs.runAttemptId,
        storeOptions: resolveStoreOptions(),
      });
      if (parsedArgs.stopAt && parsedArgs.stopAt !== 'full') {
        deps.logger.info('Main', `已完成到 ${parsedArgs.stopAt} 阶段，提前退出`);
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
