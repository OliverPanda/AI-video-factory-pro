#!/usr/bin/env node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { createCli } from './run.js';
import { getEpisodeDir, getJobDir, loadJSON, saveJSON } from '../src/utils/fileHelper.js';
import logger from '../src/utils/logger.js';

const STEP_SEQUENCE = [
  'character_registry',
  'prompts',
  'images',
  'consistency',
  'continuity',
  'video',
  'dialogue',
  'audio',
  'lipsync',
  'compose',
];

const STEP_ALIASES = {
  character: 'character_registry',
  'character-registry': 'character_registry',
  character_registry: 'character_registry',
  registry: 'character_registry',
  prompts: 'prompts',
  prompt: 'prompts',
  'prompt-engineer': 'prompts',
  images: 'images',
  image: 'images',
  'image-generator': 'images',
  consistency: 'consistency',
  'consistency-checker': 'consistency',
  continuity: 'continuity',
  'continuity-checker': 'continuity',
  video: 'video',
  'video-generation': 'video',
  'performance-planner': 'video',
  'video-router': 'video',
  'runway-video-agent': 'video',
  'motion-enhancer': 'video',
  'shot-qa': 'video',
  dialogue: 'dialogue',
  'normalize-dialogue': 'dialogue',
  'dialogue-normalizer': 'dialogue',
  audio: 'audio',
  tts: 'audio',
  'tts-agent': 'audio',
  lipsync: 'lipsync',
  'lipsync-agent': 'lipsync',
  compose: 'compose',
  composer: 'compose',
  'video-composer': 'compose',
};

const STEP_STATE_KEYS = {
  character_registry: [
    'characterRegistry',
    'promptList',
    'imageResults',
    'consistencyCheckDone',
    'continuityCheckDone',
    'continuityReport',
    'continuityFlaggedTransitions',
    'motionPlan',
    'performancePlan',
    'shotPackages',
    'rawVideoResults',
    'enhancedVideoResults',
    'videoResults',
    'shotQaReport',
    'shotQaReportV2',
    'normalizedShots',
    'audioResults',
    'audioVoiceResolution',
    'audioProjectId',
    'lipsyncResults',
    'lipsyncReport',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
    'animationClips',
  ],
  prompts: [
    'promptList',
    'imageResults',
    'consistencyCheckDone',
    'continuityCheckDone',
    'continuityReport',
    'continuityFlaggedTransitions',
    'motionPlan',
    'performancePlan',
    'shotPackages',
    'rawVideoResults',
    'enhancedVideoResults',
    'videoResults',
    'shotQaReport',
    'shotQaReportV2',
    'normalizedShots',
    'audioResults',
    'audioVoiceResolution',
    'audioProjectId',
    'lipsyncResults',
    'lipsyncReport',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
    'animationClips',
  ],
  images: [
    'imageResults',
    'consistencyCheckDone',
    'continuityCheckDone',
    'continuityReport',
    'continuityFlaggedTransitions',
    'motionPlan',
    'performancePlan',
    'shotPackages',
    'rawVideoResults',
    'enhancedVideoResults',
    'videoResults',
    'shotQaReport',
    'shotQaReportV2',
    'normalizedShots',
    'audioResults',
    'audioVoiceResolution',
    'audioProjectId',
    'lipsyncResults',
    'lipsyncReport',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
    'animationClips',
  ],
  consistency: [
    'consistencyCheckDone',
    'continuityCheckDone',
    'continuityReport',
    'continuityFlaggedTransitions',
    'motionPlan',
    'performancePlan',
    'shotPackages',
    'rawVideoResults',
    'enhancedVideoResults',
    'videoResults',
    'shotQaReport',
    'shotQaReportV2',
    'normalizedShots',
    'audioResults',
    'audioVoiceResolution',
    'audioProjectId',
    'lipsyncResults',
    'lipsyncReport',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
    'animationClips',
  ],
  continuity: [
    'continuityCheckDone',
    'continuityReport',
    'continuityFlaggedTransitions',
    'motionPlan',
    'performancePlan',
    'shotPackages',
    'rawVideoResults',
    'enhancedVideoResults',
    'videoResults',
    'shotQaReport',
    'shotQaReportV2',
    'normalizedShots',
    'audioResults',
    'audioVoiceResolution',
    'audioProjectId',
    'lipsyncResults',
    'lipsyncReport',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
    'animationClips',
  ],
  video: [
    'performancePlan',
    'shotPackages',
    'rawVideoResults',
    'enhancedVideoResults',
    'videoResults',
    'shotQaReport',
    'shotQaReportV2',
    'normalizedShots',
    'audioResults',
    'audioVoiceResolution',
    'audioProjectId',
    'lipsyncResults',
    'lipsyncReport',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
    'bridgeShotPlan',
    'bridgeShotPackages',
    'bridgeClipResults',
    'bridgeQaReport',
    'actionSequencePlan',
    'actionSequencePackages',
    'sequenceClipResults',
    'sequenceQaReport',
  ],
  dialogue: [
    'normalizedShots',
    'audioResults',
    'audioVoiceResolution',
    'audioProjectId',
    'lipsyncResults',
    'lipsyncReport',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
  ],
  audio: [
    'audioResults',
    'audioVoiceResolution',
    'audioProjectId',
    'lipsyncResults',
    'lipsyncReport',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
  ],
  lipsync: [
    'lipsyncResults',
    'lipsyncReport',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
  ],
  compose: [
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
  ],
};

const STEP_PREREQUISITES = {
  prompts: ['characterRegistry'],
  images: ['characterRegistry', 'promptList'],
  consistency: ['characterRegistry', 'promptList', 'imageResults'],
  continuity: ['characterRegistry', 'promptList', 'imageResults'],
  video: ['characterRegistry', 'imageResults', 'motionPlan'],
  dialogue: ['characterRegistry', 'imageResults'],
  audio: ['characterRegistry', 'imageResults', 'normalizedShots'],
  lipsync: ['characterRegistry', 'imageResults', 'normalizedShots', 'audioResults'],
  compose: ['characterRegistry', 'imageResults', 'normalizedShots', 'audioResults'],
};

function usage() {
  return `
用法：
  node scripts/resume-from-step.js --step=<step> <剧本文件路径> [选项]
  node scripts/resume-from-step.js --step=<step> --project=<projectId> --script-id=<scriptId> --episode=<episodeId> [选项]

续跑 step：
  character_registry | prompts | images | consistency | continuity | video | dialogue | audio | lipsync | compose

选项：
  --prepare-only           只重置缓存，不自动重新执行
  --dry-run                仅打印将执行的动作，不写文件
  --run-id=<runJobId>      指定恢复某次历史 run（项目模式优先）
  --style=realistic|3d     续跑时覆盖风格
  --provider=<name>        续跑时覆盖 LLM provider
  --skip-consistency       续跑时传给主流程
  --project-id=<id>        legacy 单文件入口透传给 run.js
  --script-file=<path>     显式指定 legacy 剧本文件

示例：
  node scripts/resume-from-step.js --step=lipsync samples/寒烬宫变-pro.txt --style=realistic
  node scripts/resume-from-step.js --step=audio --project=demo --script-id=pilot --episode=episode-1
  node scripts/resume-from-step.js --step=compose samples/寒烬宫变-pro.txt --dry-run
`.trim();
}

function getFlagValue(args, name) {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;
}

function normalizeId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sanitizeFileSegment(value, fallback) {
  const normalized = String(value || fallback).replace(/[^\w\u4e00-\u9fa5]/g, '_');
  return normalized || fallback;
}

function buildLegacyBridgeIdentity(scriptFilePath) {
  const resolvedPath = path.resolve(scriptFilePath);
  const baseName = sanitizeFileSegment(path.basename(resolvedPath, path.extname(resolvedPath)), 'legacy');
  const digest = createHash('sha1').update(resolvedPath).digest('hex').slice(0, 12);
  const suffix = `${baseName}_${digest}`;

  return {
    resolvedPath,
    jobId: `legacy_${suffix}`,
    projectId: `legacy_project_${suffix}`,
    scriptId: `legacy_script_${suffix}`,
    episodeId: `legacy_episode_${suffix}`,
  };
}

function normalizeStepName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return STEP_ALIASES[normalized] || null;
}

function parseCliArgs(args) {
  const scriptFileArg = args.find((arg) => !arg.startsWith('--')) ?? null;
  const explicitScriptFile = normalizeId(getFlagValue(args, 'script-file'));
  const projectId = normalizeId(getFlagValue(args, 'project'));
  const scriptId = normalizeId(getFlagValue(args, 'script-id'));
  const episodeId = normalizeId(getFlagValue(args, 'episode'));
  const style = normalizeId(getFlagValue(args, 'style'));
  const provider = normalizeId(getFlagValue(args, 'provider'));
  const runId = normalizeId(getFlagValue(args, 'run-id'));
  const projectIdOverride = normalizeId(getFlagValue(args, 'project-id'));
  const step = normalizeStepName(getFlagValue(args, 'step'));
  const dryRun = args.includes('--dry-run');
  const prepareOnly = args.includes('--prepare-only');
  const skipConsistencyCheck = args.includes('--skip-consistency');
  const legacyScriptFile = explicitScriptFile || scriptFileArg;

  const hasProjectMode = Boolean(projectId || scriptId || episodeId || !legacyScriptFile);
  if (!step) {
    throw new Error(`缺少或无法识别 --step。\n\n${usage()}`);
  }

  if (hasProjectMode) {
    if (legacyScriptFile) {
      throw new Error('不能同时提供 legacy 剧本文件和项目模式参数。');
    }
    return {
      mode: 'project',
      projectId,
      scriptId,
      episodeId,
      style,
      provider,
      runId,
      dryRun,
      prepareOnly,
      skipConsistencyCheck,
      step,
    };
  }

  if (!legacyScriptFile) {
    throw new Error(usage());
  }

  return {
    mode: 'legacy',
    scriptFile: legacyScriptFile,
    style,
    provider,
    runId,
    dryRun,
    prepareOnly,
    skipConsistencyCheck,
    projectIdOverride,
    step,
  };
}

function listProjectChoices(baseTempDir = process.env.TEMP_DIR || './temp') {
  const projectsRoot = path.join(baseTempDir, 'projects');
  if (!fs.existsSync(projectsRoot)) {
    return [];
  }

  return fs
    .readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsRoot, entry.name, 'project.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => loadJSON(filePath))
    .filter((item) => item?.id)
    .sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id), 'zh-CN'));
}

function listScriptChoices(projectId, baseTempDir = process.env.TEMP_DIR || './temp') {
  const scriptsDir = path.join(baseTempDir, 'projects', projectId, 'scripts');
  if (!fs.existsSync(scriptsDir)) {
    return [];
  }

  return fs
    .readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(scriptsDir, entry.name, 'script.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => loadJSON(filePath))
    .filter((item) => item?.id)
    .sort((left, right) => String(left.title || left.id).localeCompare(String(right.title || right.id), 'zh-CN'));
}

function listEpisodeChoices(projectId, scriptId, baseTempDir = process.env.TEMP_DIR || './temp') {
  const episodesDir = path.join(baseTempDir, 'projects', projectId, 'scripts', scriptId, 'episodes');
  if (!fs.existsSync(episodesDir)) {
    return [];
  }

  return fs
    .readdirSync(episodesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(episodesDir, entry.name, 'episode.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => loadJSON(filePath))
    .filter((item) => item?.id)
    .sort((left, right) => Number(left.episodeNo || 0) - Number(right.episodeNo || 0));
}

async function promptForChoice(label, items, display) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`没有可选的${label}`);
  }

  if (items.length === 1) {
    logger.info('Resume', `${label}唯一候选，自动选择：${display(items[0])}`);
    return items[0];
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    logger.info(
      'Resume',
      `${label}可选项：\n${items.map((item, index) => `${index + 1}. ${display(item)}`).join('\n')}`
    );

    while (true) {
      const answer = await rl.question(`请选择${label}编号 (1-${items.length}): `);
      const selectedIndex = Number.parseInt(String(answer).trim(), 10);
      if (Number.isFinite(selectedIndex) && selectedIndex >= 1 && selectedIndex <= items.length) {
        return items[selectedIndex - 1];
      }
      logger.warn('Resume', `无效选择：${answer}`);
    }
  } finally {
    rl.close();
  }
}

async function resolveInteractiveProjectSelection(parsed, baseTempDir = process.env.TEMP_DIR || './temp') {
  if (parsed.mode !== 'project') {
    return parsed;
  }

  let projectId = parsed.projectId;
  let scriptId = parsed.scriptId;
  let episodeId = parsed.episodeId;

  if (!projectId) {
    const project = await promptForChoice(
      '项目',
      listProjectChoices(baseTempDir),
      (item) => `${item.name || item.id} [${item.id}]`
    );
    projectId = project.id;
  }

  if (!scriptId) {
    const script = await promptForChoice(
      '剧本',
      listScriptChoices(projectId, baseTempDir),
      (item) => `${item.title || item.id} [${item.id}]`
    );
    scriptId = script.id;
  }

  if (!episodeId) {
    const episode = await promptForChoice(
      '分集',
      listEpisodeChoices(projectId, scriptId, baseTempDir),
      (item) => `第${String(item.episodeNo || 1).padStart(2, '0')}集 ${item.title || item.id} [${item.id}]`
    );
    episodeId = episode.id;
  }

  return {
    ...parsed,
    projectId,
    scriptId,
    episodeId,
  };
}

function listRunJobFiles(projectId, scriptId, episodeId, baseTempDir = process.env.TEMP_DIR || './temp') {
  const runJobsDir = path.join(getEpisodeDir(projectId, scriptId, episodeId, baseTempDir), 'run-jobs');
  if (!fs.existsSync(runJobsDir)) {
    return [];
  }

  return fs
    .readdirSync(runJobsDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => path.join(runJobsDir, fileName))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

function getArtifactRunDir(runJob) {
  if (typeof runJob?.artifactRunDir === 'string' && runJob.artifactRunDir.trim()) {
    return path.resolve(runJob.artifactRunDir);
  }
  if (typeof runJob?.artifactManifestPath === 'string' && runJob.artifactManifestPath.trim()) {
    return path.dirname(path.resolve(runJob.artifactManifestPath));
  }
  return null;
}

function getStateSnapshotPath(runJob) {
  const runDir = getArtifactRunDir(runJob);
  if (!runDir) {
    return null;
  }
  const snapshotPath = path.join(runDir, 'state.snapshot.json');
  return fs.existsSync(snapshotPath) ? snapshotPath : null;
}

function hasRecoverableState(runJob, baseTempDir = process.env.TEMP_DIR || './temp') {
  const liveStatePath = path.join(getJobDir(runJob.jobId, baseTempDir), 'state.json');
  return fs.existsSync(liveStatePath) || Boolean(getStateSnapshotPath(runJob));
}

function resolveLatestRunJob(projectId, scriptId, episodeId, runId = null, baseTempDir = process.env.TEMP_DIR || './temp') {
  const runJobFiles = listRunJobFiles(projectId, scriptId, episodeId, baseTempDir);
  if (runJobFiles.length === 0) {
    return null;
  }

  if (runId) {
    const exactFile = runJobFiles.find((filePath) => path.basename(filePath, '.json') === runId);
    if (!exactFile) {
      throw new Error(`未找到指定 run-id：${runId}`);
    }
    return loadJSON(exactFile);
  }

  const runJobs = runJobFiles.map((filePath) => loadJSON(filePath)).filter(Boolean);
  const recoverableRun = runJobs.find((runJob) => hasRecoverableState(runJob, baseTempDir));
  return recoverableRun || runJobs[0];
}

function resolveResumeContext(parsed, baseTempDir = process.env.TEMP_DIR || './temp') {
  if (parsed.mode === 'legacy') {
    const identity = buildLegacyBridgeIdentity(parsed.scriptFile);
    const runJob = resolveLatestRunJob(identity.projectId, identity.scriptId, identity.episodeId, parsed.runId, baseTempDir);
    const snapshotPath = runJob ? getStateSnapshotPath(runJob) : null;
    return {
      mode: 'legacy',
      statePath: path.join(getJobDir(identity.jobId, baseTempDir), 'state.json'),
      snapshotPath,
      jobId: identity.jobId,
      projectId: identity.projectId,
      scriptId: identity.scriptId,
      episodeId: identity.episodeId,
      scriptFile: identity.resolvedPath,
      runJob,
      baseTempDir,
    };
  }

  const runJob = resolveLatestRunJob(parsed.projectId, parsed.scriptId, parsed.episodeId, parsed.runId, baseTempDir);
  if (!runJob) {
    throw new Error(`未找到 run-jobs：${parsed.projectId}/${parsed.scriptId}/${parsed.episodeId}`);
  }
  const snapshotPath = getStateSnapshotPath(runJob);

  return {
    mode: 'project',
    statePath: path.join(getJobDir(runJob.jobId, baseTempDir), 'state.json'),
    snapshotPath,
    jobId: runJob.jobId,
    projectId: parsed.projectId,
    scriptId: parsed.scriptId,
    episodeId: parsed.episodeId,
    runJob,
    baseTempDir,
  };
}

function getStateKeysToDelete(step) {
  const keys = STEP_STATE_KEYS[step];
  if (!keys) {
    throw new Error(`未定义 step 重置规则：${step}`);
  }
  return [...keys];
}

function collectShotIds(state) {
  const fromNormalizedShots = Array.isArray(state?.normalizedShots)
    ? state.normalizedShots.map((item) => item?.id || item?.shotId).filter(Boolean)
    : [];
  const fromImageResults = Array.isArray(state?.imageResults)
    ? state.imageResults.map((item) => item?.shotId).filter(Boolean)
    : [];
  const fromLipsync = Array.isArray(state?.lipsyncResults)
    ? state.lipsyncResults.map((item) => item?.shotId).filter(Boolean)
    : [];
  const fromVideo = Array.isArray(state?.videoResults)
    ? state.videoResults.map((item) => item?.shotId).filter(Boolean)
    : [];
  const fromRawVideo = Array.isArray(state?.rawVideoResults)
    ? state.rawVideoResults.map((item) => item?.shotId).filter(Boolean)
    : [];
  const fromEnhancedVideo = Array.isArray(state?.enhancedVideoResults)
    ? state.enhancedVideoResults.map((item) => item?.shotId).filter(Boolean)
    : [];

  return Array.from(
    new Set([
      ...fromNormalizedShots,
      ...fromImageResults,
      ...fromLipsync,
      ...fromVideo,
      ...fromRawVideo,
      ...fromEnhancedVideo,
    ])
  );
}

function buildAllowedDeleteRoots(dirs, baseTempDir = process.env.TEMP_DIR || './temp') {
  const outputRoot = process.env.OUTPUT_DIR || './output';
  const roots = [
    path.join(baseTempDir, 'lipsync'),
    dirs?.images,
    dirs?.video,
    dirs?.audio,
    dirs?.images ? path.dirname(dirs.images) : null,
    dirs?.video ? path.dirname(dirs.video) : null,
    dirs?.audio ? path.dirname(dirs.audio) : null,
    outputRoot,
  ]
    .filter(Boolean)
    .map((root) => path.resolve(root));

  return Array.from(new Set(roots));
}

function isPathWithinAllowedRoots(targetPath, allowedRoots) {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    return false;
  }

  const resolvedTarget = path.resolve(targetPath);
  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

function collectFilesToRemove(step, state, dirs, baseTempDir = process.env.TEMP_DIR || './temp') {
  const files = [];
  const shotIds = collectShotIds(state);

  if (STEP_SEQUENCE.indexOf(step) <= STEP_SEQUENCE.indexOf('images')) {
    files.push(dirs.images);
  }

  if (STEP_SEQUENCE.indexOf(step) <= STEP_SEQUENCE.indexOf('audio')) {
    files.push(dirs.audio);
  }

  if (STEP_SEQUENCE.indexOf(step) <= STEP_SEQUENCE.indexOf('video')) {
    const videoPaths = Array.isArray(state?.videoResults)
      ? state.videoResults.map((item) => item?.videoPath).filter(Boolean)
      : [];
    const rawVideoPaths = Array.isArray(state?.rawVideoResults)
      ? state.rawVideoResults.map((item) => item?.videoPath).filter(Boolean)
      : [];
    const enhancedVideoPaths = Array.isArray(state?.enhancedVideoResults)
      ? state.enhancedVideoResults
          .map((item) => item?.enhancedVideoPath || item?.videoPath)
          .filter(Boolean)
      : [];
    files.push(dirs.video);
    files.push(...videoPaths);
    files.push(...rawVideoPaths);
    files.push(...enhancedVideoPaths);
  }

  if (STEP_SEQUENCE.indexOf(step) <= STEP_SEQUENCE.indexOf('lipsync')) {
    const lipsyncPaths = Array.isArray(state?.lipsyncResults)
      ? state.lipsyncResults.map((item) => item?.videoPath).filter(Boolean)
      : [];

    files.push(...lipsyncPaths);

    const sharedLipsyncDir = path.join(baseTempDir, 'lipsync');
    for (const shotId of shotIds) {
      files.push(path.join(sharedLipsyncDir, `${shotId}.mp4`));
    }
  }

  if (STEP_SEQUENCE.indexOf(step) <= STEP_SEQUENCE.indexOf('compose')) {
    const outputPath = state?.outputPath || state?.composeResult?.outputVideo?.uri || null;
    const deliverySummaryPath = state?.deliverySummaryPath || null;
    if (outputPath) files.push(outputPath);
    if (deliverySummaryPath) files.push(deliverySummaryPath);
  }

  const allowedRoots = buildAllowedDeleteRoots(dirs, baseTempDir);

  return Array.from(
    new Set(
      files
        .filter(Boolean)
        .map((filePath) => path.resolve(filePath))
        .filter((filePath) => isPathWithinAllowedRoots(filePath, allowedRoots))
    )
  );
}

function removePathSafe(targetPath, allowedRoots = []) {
  if (!isPathWithinAllowedRoots(targetPath, allowedRoots)) {
    return false;
  }
  const resolvedTarget = path.resolve(targetPath);
  if (!fs.existsSync(resolvedTarget)) {
    return false;
  }
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
  return true;
}

function backupStateFile(statePath, state) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const backupPath = `${statePath}.resume-backup-${timestamp}.json`;
  saveJSON(backupPath, state);
  return backupPath;
}

function buildRunArgs(parsed, context) {
  const args = [];
  if (context.mode === 'legacy') {
    args.push(context.scriptFile);
    if (parsed.projectIdOverride) {
      args.push(`--project-id=${parsed.projectIdOverride}`);
    }
  } else {
    args.push(`--project=${context.projectId}`);
    args.push(`--script=${context.scriptId}`);
    args.push(`--episode=${context.episodeId}`);
  }

  if (parsed.style) args.push(`--style=${parsed.style}`);
  if (parsed.provider) args.push(`--provider=${parsed.provider}`);
  if (parsed.skipConsistencyCheck) args.push('--skip-consistency');

  return args;
}

async function executeResumeRun(parsed, context) {
  if (parsed.provider) {
    process.env.LLM_PROVIDER = parsed.provider;
  }

  const cli = createCli({
    runPipeline: async (scriptFilePath, options = {}) => {
      const director = await import('../src/agents/director.js');
      return director.runPipeline(scriptFilePath, {
        ...options,
      });
    },
    runEpisodePipeline: async ({ projectId, scriptId, episodeId, options = {} }) => {
      const director = await import('../src/agents/director.js');
      return director.runEpisodePipeline({
        projectId,
        scriptId,
        episodeId,
        options: {
          ...options,
          jobId: context.jobId,
        },
      });
    },
  });

  if (context.mode === 'legacy') {
    return cli.run([
      context.scriptFile,
      ...(parsed.style ? [`--style=${parsed.style}`] : []),
      ...(parsed.provider ? [`--provider=${parsed.provider}`] : []),
      ...(parsed.skipConsistencyCheck ? ['--skip-consistency'] : []),
      ...(parsed.projectIdOverride ? [`--project-id=${parsed.projectIdOverride}`] : []),
    ]);
  }

  return cli.run([
    `--project=${context.projectId}`,
    `--script=${context.scriptId}`,
    `--episode=${context.episodeId}`,
    ...(parsed.style ? [`--style=${parsed.style}`] : []),
    ...(parsed.provider ? [`--provider=${parsed.provider}`] : []),
    ...(parsed.skipConsistencyCheck ? ['--skip-consistency'] : []),
  ]);
}

function describeResumePlan(parsed, context, stateKeysToDelete, filesToRemove) {
  const lines = [
    `模式：${context.mode}`,
    `step：${parsed.step}`,
    `jobId：${context.jobId}`,
    `state：${context.statePath}`,
  ];

  if (context.runJob?.id) {
    lines.push(`runJob：${context.runJob.id}`);
    lines.push(`runJob 状态：${context.runJob.status}`);
  }
  if (context.snapshotPath) {
    lines.push(`历史快照：${context.snapshotPath}`);
  }

  lines.push(`删除 state 字段：${stateKeysToDelete.join(', ') || '无'}`);
  lines.push(`清理文件/目录数：${filesToRemove.length}`);
  return lines.join('\n');
}

function collectMissingPrerequisites(step, state) {
  const prerequisites = STEP_PREREQUISITES[step] || [];
  return prerequisites.filter((key) => {
    const value = state?.[key];
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    return value === undefined || value === null || value === false;
  });
}

export async function resumeFromStep(args, overrides = {}) {
  const initialParsed = parseCliArgs(args);
  const baseTempDir = overrides.baseTempDir || process.env.TEMP_DIR || './temp';
  const parsed = await resolveInteractiveProjectSelection(initialParsed, baseTempDir);
  const context = resolveResumeContext(parsed, baseTempDir);
  let state = null;
  let stateSource = 'live-state';

  if (parsed.runId && context.snapshotPath) {
    state = loadJSON(context.snapshotPath);
    stateSource = 'run-snapshot';
  } else {
    state = loadJSON(context.statePath);
    if (!state && context.snapshotPath) {
      state = loadJSON(context.snapshotPath);
      stateSource = 'run-snapshot';
    }
  }
  if (!state) {
    throw new Error(`未找到可恢复的 state.json：${context.statePath}`);
  }

  const stateKeysToDelete = getStateKeysToDelete(parsed.step);
  const filesToRemove = collectFilesToRemove(parsed.step, state, {
    images: path.join(getJobDir(context.jobId, baseTempDir), 'images'),
    video: path.join(getJobDir(context.jobId, baseTempDir), 'video'),
    audio: path.join(getJobDir(context.jobId, baseTempDir), 'audio'),
  }, baseTempDir);
  const allowedDeleteRoots = buildAllowedDeleteRoots(
    {
      images: path.join(getJobDir(context.jobId, baseTempDir), 'images'),
      video: path.join(getJobDir(context.jobId, baseTempDir), 'video'),
      audio: path.join(getJobDir(context.jobId, baseTempDir), 'audio'),
    },
    baseTempDir
  );
  const missingPrerequisites = collectMissingPrerequisites(parsed.step, state);

  const planSummary = describeResumePlan(parsed, context, stateKeysToDelete, filesToRemove);
  logger.info('Resume', `准备续跑：\n${planSummary}\nstate 来源：${stateSource}`);
  if (missingPrerequisites.length > 0) {
    logger.warn(
      'Resume',
      `当前 state 缺少前置缓存：${missingPrerequisites.join(', ')}。这次实际会从更早步骤重新开始。`
    );
  }

  if (parsed.dryRun) {
    return {
      parsed,
      context,
      planSummary,
      stateKeysToDelete,
      filesToRemove,
      missingPrerequisites,
      executed: false,
    };
  }

  const backupPath = backupStateFile(context.statePath, state);
  const nextState = structuredClone(state);
  for (const key of stateKeysToDelete) {
    delete nextState[key];
  }
  saveJSON(context.statePath, nextState);

  const removedPaths = [];
  for (const filePath of filesToRemove) {
    if (removePathSafe(filePath, allowedDeleteRoots)) {
      removedPaths.push(filePath);
    }
  }

  if (parsed.prepareOnly) {
    return {
      parsed,
      context,
      planSummary,
      backupPath,
      stateKeysToDelete,
      removedPaths,
      missingPrerequisites,
      executed: false,
    };
  }

  await executeResumeRun(parsed, context);

  return {
    parsed,
    context,
    planSummary,
    backupPath,
    stateKeysToDelete,
    removedPaths,
    missingPrerequisites,
    executed: true,
  };
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  resumeFromStep(process.argv.slice(2)).catch((error) => {
    logger.error('Resume', error.message);
    process.exit(1);
  });
}

export const __testables = {
  parseCliArgs,
  normalizeStepName,
  getStateKeysToDelete,
  collectShotIds,
  collectFilesToRemove,
  buildLegacyBridgeIdentity,
  resolveResumeContext,
  buildRunArgs,
  collectMissingPrerequisites,
  listProjectChoices,
  listScriptChoices,
  listEpisodeChoices,
  executeResumeRun,
};
