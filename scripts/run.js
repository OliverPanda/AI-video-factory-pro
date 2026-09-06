#!/usr/bin/env node
/**
 * 项目主入口（CLI Entry）
 * package.json 的 start 指向这里：`npm start` / `node scripts/run.js`
 *
 * v1.2（D1）起仅保留项目模式入口：
 *   node scripts/run.js --project=<projectId> --script=<scriptId> --episode=<episodeId> [选项]
 * 兼容单文件模式（位置参数剧本直跑）已整体移除。
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import logger from '../src/utils/logger.js';

const USAGE = `
用法：
  node scripts/run.js --project=<projectId> --script=<scriptId> --episode=<episodeId> [选项]

选项：
  --style=realistic|3d      视觉风格（默认：realistic）
  --skip-consistency        跳过一致性验证（加速测试）
  --max-shots=<number>      仅处理前 N 个分镜（用于抽样验证）
  --provider=qwen|deepseek|claude  LLM提供商（覆盖.env设置）
  --input-format=professional-script|raw-novel|auto
                             输入文本类型（默认：professional-script）
  --stop-at=full|after_ref_sheets|after_images|before_video
                             运行到指定阶段后停止（默认：full）
  --continue                 根据现有进度继续运行（复用最近一次的 jobId）
  --continue-job-id=<id>     继续运行时显式指定要复用的 jobId
  --run-attempt-id=<id>      指定本次运行 attempt ID（用于前后端状态对齐）

示例：
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

function logRuntimeImageEnv() {
  const snapshot = {
    IMAGE_API_BASE_URL: String(process.env.IMAGE_API_BASE_URL || '').trim(),
    REALISTIC_IMAGE_MODEL: String(process.env.REALISTIC_IMAGE_MODEL || '').trim(),
    IMAGE_EDIT_MODEL: String(process.env.IMAGE_EDIT_MODEL || '').trim(),
    PRIMARY_API_PROVIDER: String(process.env.PRIMARY_API_PROVIDER || '').trim(),
  };
  logger.info('Main', `runtime image env ${JSON.stringify(snapshot)}`);
}

export function parseCliArgs(args) {
  const positionalArgs = args.filter((arg) => !arg.startsWith('--'));
  if (positionalArgs.length > 0) {
    throw new Error(
      `位置参数剧本文件（${positionalArgs[0]}）已不再支持：请使用项目模式 --project/--script/--episode。\n\n${USAGE}`
    );
  }
  if (args.some((arg) => arg.startsWith('--project-id='))) {
    throw new Error(
      '--project-id 已随兼容单文件模式整体移除（v1.2 / D1）：语音 preset 归属由项目模式的项目 id 决定。'
    );
  }

  const projectId = normalizeId(getFlagValue(args, 'project'));
  const scriptId = normalizeId(getFlagValue(args, 'script'));
  const episodeId = normalizeId(getFlagValue(args, 'episode'));
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

  const hasCompleteProjectMode = Boolean(projectId && scriptId && episodeId);
  if (projectId || scriptId || episodeId) {
    if (!hasCompleteProjectMode) {
      throw new Error('项目模式必须同时提供 --project、--script 和 --episode。');
    }
  } else {
    throw new Error(USAGE);
  }

  let stopAt = stopAtFlag || 'full';

  return {
    projectId,
    scriptId,
    episodeId,
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
    // 入口层只做参数解析和运行时选择；
    // 真正的主流程编排都下沉到 director，避免 CLI 自己持有业务状态机。
    runEpisodePipeline: async (...args) => {
      const director = await import('../src/agents/director.js');
      return director.runEpisodePipeline(...args);
    },
    logger,
    cwd: () => process.cwd(),
    exit: (code) => process.exit(code),
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
      logRuntimeImageEnv();

      const payload = {
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
      };
      const outputPath = await deps.runEpisodePipeline(payload);
      deps.writeSuccess(outputPath);
      return outputPath;
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
