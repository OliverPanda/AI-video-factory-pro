import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

import { listRunJobs } from '../dataSources/runJobRepository.js';
import { loadQaOverview } from '../dataSources/qaOverviewRepository.js';
import { getArtifactDirectorySummary } from '../dataSources/runArtifactRepository.js';
import { buildWorkbenchViewModel } from '../transformers/workbenchViewModel.js';
import { createProject, createEpisode } from '../../domain/projectModel.js';
import { saveEpisode, loadEpisode, saveScript } from '../../utils/projectStore.js';
import { createRunJob, finishRunJob } from '../../utils/jobStore.js';
import { getEpisodeDir, getJobDir, loadJSON, saveJSON } from '../../utils/fileHelper.js';
import { chat as llmChat, healthCheck as llmHealthCheck } from '../../llm/client.js';
import { updateEnvFile } from '../../utils/envConfigStore.js';
import { sendVideoFile } from './videoResponses.js';
import { buildSettingsPayload, collectSettingsUpdates, runBatchProviderPrecheck } from './settingsSupport.js';
import { parseScript } from '../../agents/scriptParser.js';
import {
  resolveTrustedAbsoluteFinalVideoPath,
  resolveRunDir,
  findArtifactFileByName,
  loadRunArtifactJson,
  buildReviewClips,
  syncEditTaskPackStatusFields,
  syncPostComposeReviewStatusFields,
  syncHumanReviewQueueStatusFields,
} from './reviewSupport.js';

const DEFAULT_EPISODE_DURATION_SEC = 120;
const SCRIPT_PROFESSIONALIZER_SKILL_PATH = path.join('skills', 'project', 'script-professionalizer', 'SKILL.md');
const scriptProfessionalizeCache = new Map();

const runWriteQueues = new Map();
function withRunLock(runId, fn) {
  if (!runWriteQueues.has(runId)) {
    runWriteQueues.set(runId, Promise.resolve());
  }
  const prev = runWriteQueues.get(runId);
  const next = prev.then(fn, fn);
  runWriteQueues.set(runId, next);
  return next;
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.md': 'text/plain; charset=utf-8',
};


function safeExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readJsonSafe(filePath) {
  return loadJSON(filePath);
}

function writeJsonSafe(filePath, payload) {
  saveJSON(filePath, payload);
}

function loadRunLiveState(runJob, { projectStoreBaseTempDir }) {
  if (!runJob?.jobId) return null;
  try {
    validatePathSegment(runJob.jobId, 'jobId');
  } catch {
    return null;
  }
  if (new Set(['projects', 'uploads']).has(String(runJob.jobId).toLowerCase())) {
    return null;
  }
  const baseTempDir = path.resolve(projectStoreBaseTempDir);
  const statePath = path.join(baseTempDir, runJob.jobId, 'state.json');
  if (!isPathInside(baseTempDir, statePath)) return null;
  return readJsonSafe(statePath);
}

function loadReviewArtifactsWithLiveFallback(runJob, workspaceRoot, { projectStoreBaseTempDir }) {
  const liveState = loadRunLiveState(runJob, { projectStoreBaseTempDir });
  const postComposeReview = loadRunArtifactJson(runJob, workspaceRoot, 'post-compose-review.json');
  const editTaskPack = loadRunArtifactJson(runJob, workspaceRoot, 'edit-task-pack.json');
  const humanReviewQueue = loadRunArtifactJson(runJob, workspaceRoot, 'human-review-queue.json');

  return {
    liveState,
    postComposeReview: {
      ...postComposeReview,
      data: postComposeReview.data || liveState?.postComposeReview?.report || null,
    },
    editTaskPack: {
      ...editTaskPack,
      data: editTaskPack.data || liveState?.postComposeReview?.editTaskPack || null,
    },
    humanReviewQueue: {
      ...humanReviewQueue,
      data: humanReviewQueue.data || liveState?.humanReviewQueue || liveState?.postComposeReview?.editTaskPack?.humanReview || null,
    },
  };
}

function createPathSecurityError(message) {
  const error = new Error(message);
  error.code = 'PATH_OUTSIDE_ROOT';
  return error;
}

function isPathInside(basePath, candidatePath) {
  const absoluteBase = path.resolve(basePath);
  const absoluteCandidate = path.resolve(candidatePath);
  const relative = path.relative(absoluteBase, absoluteCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolvePathInside(basePath, targetPath, rootLabel = 'root directory') {
  const candidatePath = path.resolve(basePath, targetPath);
  if (!isPathInside(basePath, candidatePath)) {
    throw createPathSecurityError(`Resolved path is outside ${rootLabel}: ${targetPath}`);
  }
  return candidatePath;
}

function validatePathSegment(value, label) {
  if (!value || typeof value !== 'string') {
    throw new Error(`Invalid ${label}: empty or missing`);
  }
  if (value.length > 255) {
    throw new Error(`Invalid ${label}: too long`);
  }
  if (value.includes('..') || value.includes('\\') || value.includes('\0') || value.includes('/')) {
    throw new Error(`Invalid ${label}: contains disallowed characters`);
  }
  if (/[\x00-\x1f]/.test(value)) {
    throw new Error(`Invalid ${label}: contains control characters`);
  }
  return value;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
  });
  fs.createReadStream(filePath).pipe(response);
}

function appendTextLog(filePath, message) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${new Date().toISOString()} ${message}\n`, 'utf8');
}

function removePathIfSafe(targetPath, workspaceRoot) {
  if (!targetPath) return false;
  const absoluteTarget = resolvePathInside(workspaceRoot, targetPath, 'workspace');
  if (!safeExists(absoluteTarget)) return false;
  fs.rmSync(absoluteTarget, { recursive: true, force: true });
  return true;
}

function cleanLatestFailedRun({ latestRun, projectId, scriptId, episodeId, baseTempDir, workspaceRoot, debugLogPath }) {
  if (!latestRun) {
    appendTextLog(debugLogPath, '[WorkbenchRunRetry] no previous run found to clean');
    return { removed: [] };
  }

  const removed = [];
  const episodeDir = getEpisodeDir(projectId, scriptId, episodeId, baseTempDir);
  const runJobFilePath = path.join(episodeDir, 'run-jobs', `${latestRun.id}.json`);

  if (removePathIfSafe(runJobFilePath, workspaceRoot)) {
    removed.push(runJobFilePath);
  }
  if (latestRun.artifactRunDir && removePathIfSafe(latestRun.artifactRunDir, workspaceRoot)) {
    removed.push(latestRun.artifactRunDir);
  }
  if (latestRun.jobId) {
    const jobDir = getJobDir(latestRun.jobId, baseTempDir);
    if (removePathIfSafe(jobDir, workspaceRoot)) {
      removed.push(jobDir);
    }
  }

  appendTextLog(
    debugLogPath,
    `[WorkbenchRunRetry] cleaned latestRunId=${latestRun.id} latestJobId=${latestRun.jobId || ''} removed=${JSON.stringify(removed)}`
  );
  return { removed };
}

function parseBody(request, maxSize = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        request.destroy();
        reject(new Error('REQUEST_BODY_TOO_LARGE'));
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    request.on('error', () => resolve({}));
  });
}

async function safeParseBody(request, response) {
  try {
    return await parseBody(request);
  } catch (err) {
    if (err?.message === 'REQUEST_BODY_TOO_LARGE') {
      sendJson(response, 413, { error: 'Request body too large' });
      return null;
    }
    sendJson(response, 400, { error: 'Invalid request body' });
    return null;
  }
}

function listManualProjects(tempProjectsDir) {
  const projects = [];
  if (!safeExists(tempProjectsDir)) return projects;
  const entries = safeReadDir(tempProjectsDir);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectJsonPath = path.join(tempProjectsDir, entry.name, 'project.json');
    const data = readJsonSafe(projectJsonPath);
    if (data) {
      projects.push({ ...data, id: data.id || entry.name });
    }
  }
  return projects;
}

function loadProjectById(projectId, tempProjectsDir) {
  const filePath = path.join(tempProjectsDir, projectId, 'project.json');
  return readJsonSafe(filePath);
}

function saveProjectById(project, tempProjectsDir) {
  const projectDir = path.join(tempProjectsDir, project.id);
  if (!safeExists(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  const filePath = path.join(projectDir, 'project.json');
  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');
}

function normalizeRunStatus(runJob, qaOverview) {
  const status = String(runJob?.status || '').toLowerCase();
  if (qaOverview?.blockCount > 0) return 'block';
  if (qaOverview?.warnCount > 0) return 'warn';
  if (status === 'completed') return 'pass';
  if (status === 'failed' || status === 'error' || status === 'blocked') return 'block';
  return 'running';
}

function isTerminalRunStatus(status) {
  return ['completed', 'failed', 'error', 'blocked', 'cancelled'].includes(String(status || '').toLowerCase());
}

function resolveRunJobLogPath(runJob, workspaceRoot) {
  const configuredPath = String(runJob?.debugLogPath || '').trim();
  if (configuredPath) {
    if (path.isAbsolute(configuredPath)) {
      return configuredPath;
    }
    try {
      return resolvePathInside(workspaceRoot, configuredPath, 'workspace');
    } catch {
      return null;
    }
  }

  try {
    const baseTempDir = path.join(workspaceRoot, 'temp');
    const episodeDir = getEpisodeDir(runJob.projectId, runJob.scriptId, runJob.episodeId, baseTempDir);
    return path.join(episodeDir, 'run-jobs', `${runJob.id}.log`);
  } catch {
    return null;
  }
}

function readSpawnedPidFromRunLog(logPath) {
  if (!logPath || !safeExists(logPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const matches = [...content.matchAll(/\[WorkbenchRunTrigger\] spawned pid=(\d+)/g)];
    const lastMatch = matches.at(-1);
    if (!lastMatch) {
      return null;
    }
    const pid = Number.parseInt(lastMatch[1], 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function readFailureFromRunLog(logPath) {
  if (!logPath || !safeExists(logPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const mainErrorMatches = [...content.matchAll(/ERROR \[Main\]\u001b\[0m 生成失败：([^\r\n]+)/g)];
    const directorErrorMatches = [...content.matchAll(/ERROR \[Director\]\u001b\[0m 任务失败：([^\r\n]+)/g)];
    const plainMainErrorMatches = [...content.matchAll(/\[Main\].*生成失败：([^\r\n]+)/g)];
    const plainDirectorErrorMatches = [...content.matchAll(/\[Director\].*任务失败：([^\r\n]+)/g)];
    const match = [
      ...mainErrorMatches,
      ...directorErrorMatches,
      ...plainMainErrorMatches,
      ...plainDirectorErrorMatches,
    ].at(-1);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function reconcileRunJobs(
  runJobs,
  {
    workspaceRoot,
    projectStoreBaseTempDir = path.join(workspaceRoot, 'temp'),
    isProcessAlive = defaultIsProcessAlive,
  } = {}
) {
  for (const runJob of Array.isArray(runJobs) ? runJobs : []) {
    if (!runJob || isTerminalRunStatus(runJob.status) || runJob.finishedAt) {
      continue;
    }

    const liveState = loadRunLiveState(runJob, { projectStoreBaseTempDir });
    if (liveState?.completedAt) {
      const finishedRun = finishRunJob(runJob, {
        status: 'completed',
        finishedAt: liveState.completedAt,
      }, { baseTempDir: projectStoreBaseTempDir });
      Object.assign(runJob, finishedRun);
      continue;
    }

    if (liveState?.failedAt || liveState?.lastError) {
      const failedRun = finishRunJob(runJob, {
        status: 'failed',
        finishedAt: liveState.failedAt || new Date().toISOString(),
        error: liveState.lastError || 'Run failed before terminal status was persisted',
      }, { baseTempDir: projectStoreBaseTempDir });
      Object.assign(runJob, failedRun);
      continue;
    }

    const runDir = resolveRunDir(runJob, workspaceRoot);
    const stateSnapshot = runDir ? readJsonSafe(path.join(runDir, 'state.snapshot.json')) : null;
    if (stateSnapshot?.completedAt) {
      const finishedRun = finishRunJob(runJob, {
        status: 'completed',
        finishedAt: stateSnapshot.completedAt,
      }, { baseTempDir: projectStoreBaseTempDir });
      Object.assign(runJob, finishedRun);
      continue;
    }

    if (stateSnapshot?.failedAt || stateSnapshot?.lastError) {
      const failedRun = finishRunJob(runJob, {
        status: 'failed',
        finishedAt: stateSnapshot.failedAt || new Date().toISOString(),
        error: stateSnapshot.lastError || 'Run failed before terminal status was persisted',
      }, { baseTempDir: projectStoreBaseTempDir });
      Object.assign(runJob, failedRun);
      continue;
    }

    const logPath = resolveRunJobLogPath(runJob, workspaceRoot);
    const logFailure = readFailureFromRunLog(logPath);
    if (logFailure) {
      const failedRun = finishRunJob(runJob, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: logFailure,
      }, { baseTempDir: projectStoreBaseTempDir });
      Object.assign(runJob, failedRun);
      continue;
    }

    const spawnedPid = readSpawnedPidFromRunLog(logPath);
    if (!spawnedPid || isProcessAlive(spawnedPid)) {
      continue;
    }

    const failedRun = finishRunJob(runJob, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: 'Run process exited before writing a terminal run state',
    }, { baseTempDir: projectStoreBaseTempDir });
    Object.assign(runJob, failedRun);
  }

  return runJobs;
}

function findLatestRunJob(runJobs, projectId, scriptId, episodeId) {
  const matches = runJobs.filter(
    (job) => job.projectId === projectId && job.scriptId === scriptId && job.episodeId === episodeId
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
  return matches[0];
}

function resolveProjectStoreBaseTempDir(tempProjectsDir) {
  const absolute = path.resolve(tempProjectsDir);
  return path.basename(absolute) === 'projects' ? path.dirname(absolute) : absolute;
}

function loadStoryboardPayload(projectId, scriptId, episodeId, { projectStoreBaseTempDir }) {
  const episode = loadEpisode(projectId, scriptId, episodeId, { baseTempDir: projectStoreBaseTempDir });
  if (!episode) {
    return { episode: null, snapshot: null, episodeDir: null, filePath: null, source: null };
  }
  const episodeDir = getEpisodeDir(projectId, scriptId, episodeId, projectStoreBaseTempDir);
  const snapshot = readJsonSafe(path.join(episodeDir, 'state.snapshot.json'));
  return {
    episode,
    snapshot,
    episodeDir,
    filePath: path.join(episodeDir, 'episode.json'),
    source: 'project_store',
  };
}

function synthesizeEpisodeFromArtifacts(runDir, projectId, scriptId, episodeId, matchedRun = null) {
  if (!runDir) return null;

  const shotPackagesPath = findArtifactFileByName(runDir, 'shot-packages.json');
  const dialogueNormalizedPath = findArtifactFileByName(runDir, 'dialogue-normalized.json');
  const shotPackages = readJsonSafe(shotPackagesPath) || [];
  const dialogueNormalized = readJsonSafe(dialogueNormalizedPath) || [];

  if (!Array.isArray(shotPackages) || shotPackages.length === 0) {
    return null;
  }

  const dialogueByShotId = new Map(
    (Array.isArray(dialogueNormalized) ? dialogueNormalized : []).map((item) => [String(item?.id || ''), item])
  );
  const characterMap = new Map();
  const sceneMap = new Map();

  const shots = shotPackages.map((pkg, index) => {
    const shotId = String(pkg?.shotId || `shot_${index + 1}`);
    const dialogueEntry = dialogueByShotId.get(shotId) || {};
    const sceneName = String(
      pkg?.providerRequestHints?.scene
        || dialogueEntry?.scene
        || pkg?.generationPack?.space_anchor
        || '未标注场景'
    );
    const sceneId = String(pkg?.generationPack?.scene_id || pkg?.providerRequestHints?.sceneId || '');
    const characters = Array.isArray(dialogueEntry?.characters)
      ? dialogueEntry.characters.map(String)
      : Array.isArray(pkg?.generationPack?.character_locks)
        ? pkg.generationPack.character_locks.map(String)
        : [];

    for (const characterName of characters) {
      if (!characterMap.has(characterName)) {
        characterMap.set(characterName, {
          id: characterName,
          name: characterName,
          roleType: 'unknown',
          personality: '',
        });
      }
    }

    if (!sceneMap.has(sceneId || sceneName)) {
      sceneMap.set(sceneId || sceneName, {
        id: sceneId || sceneName,
        title: sceneName,
        name: sceneName,
      });
    }

    return {
      id: shotId,
      title: `镜头 ${String(index + 1).padStart(2, '0')}`,
      scene: sceneName,
      sceneId: sceneId || null,
      characters,
      action: String(pkg?.visualGoal || ''),
      dialogue: String(dialogueEntry?.dialogue || ''),
      emotion: '',
      speaker: '',
      durationSec: Number(pkg?.durationTargetSec || 0),
      duration: Number(pkg?.durationTargetSec || 0),
      cameraType: String(pkg?.cameraSpec?.framing || pkg?.shotType || ''),
      prompt: pkg?.seedancePrompt || null,
      negativePrompt: pkg?.providerRequestHints?.negativePrompt || null,
      provider: pkg?.preferredProvider || null,
      imagePath: Array.isArray(pkg?.referenceImages) ? pkg.referenceImages[0]?.path || null : null,
      status: 'ready',
    };
  });

  return {
    id: episodeId,
    projectId,
    scriptId,
    episodeId,
    title: matchedRun?.episodeTitle || episodeId,
    episodeTitle: matchedRun?.episodeTitle || episodeId,
    shots,
    episodeCharacters: Array.from(characterMap.values()),
    characters: Array.from(characterMap.values()),
    scenes: Array.from(sceneMap.values()),
    voices: [],
    updatedAt: matchedRun?.finishedAt || matchedRun?.startedAt || new Date().toISOString(),
  };
}

function pickLatestRunJobByEpisode(runJobs = [], projectId, scriptId, episodeId) {
  return (Array.isArray(runJobs) ? runJobs : [])
    .filter((runJob) => (
      runJob?.projectId === projectId
      && runJob?.scriptId === scriptId
      && runJob?.episodeId === episodeId
      && runJob?.artifactRunDir
    ))
    .sort((left, right) => {
      const leftTime = Date.parse(left?.finishedAt || left?.startedAt || 0) || 0;
      const rightTime = Date.parse(right?.finishedAt || right?.startedAt || 0) || 0;
      return rightTime - leftTime;
    })[0] || null;
}

function pickRunJobById(runJobs = [], runId) {
  if (!runId) return null;
  return (Array.isArray(runJobs) ? runJobs : []).find((runJob) => runJob?.id === runId) || null;
}

function resolveEpisodePayload(projectId, scriptId, episodeId, { projectStoreBaseTempDir, runJobs, workspaceRoot, runId = null }) {
  const direct = loadStoryboardPayload(projectId, scriptId, episodeId, { projectStoreBaseTempDir });
  if (direct.episode) {
    return direct;
  }

  const runById = pickRunJobById(runJobs, runId);
  const matchedRun = runById && runById.projectId === projectId && runById.scriptId === scriptId && runById.episodeId === episodeId
    ? runById
    : pickLatestRunJobByEpisode(runJobs, projectId, scriptId, episodeId);
  const runDir = matchedRun ? resolveRunDir(matchedRun, workspaceRoot) : null;
  if (!runDir) {
    return direct;
  }

  const actualEpisodeDir = path.resolve(runDir, '..', '..');
  const filePath = path.join(actualEpisodeDir, 'episode.json');
  const snapshotPath = path.join(runDir, 'state.snapshot.json');
  const snapshot = readJsonSafe(snapshotPath) || loadRunLiveState(matchedRun, { projectStoreBaseTempDir });
  const episode = readJsonSafe(filePath);
  if (!episode) {
    const syntheticEpisode = synthesizeEpisodeFromArtifacts(runDir, projectId, scriptId, episodeId, matchedRun);
    if (!syntheticEpisode) {
      return direct;
    }
    return {
      episode: syntheticEpisode,
      snapshot,
      episodeDir: actualEpisodeDir,
      filePath,
      source: 'run_artifact_synthesized',
    };
  }

  return {
    episode,
    snapshot,
    episodeDir: actualEpisodeDir,
    filePath,
    source: 'run_artifact',
  };
}

function persistResolvedEpisode(projectId, scriptId, resolvedEpisodePayload, nextEpisode, { projectStoreBaseTempDir }) {
  if (resolvedEpisodePayload?.source === 'project_store') {
    saveEpisode(projectId, scriptId, nextEpisode, { baseTempDir: projectStoreBaseTempDir });
    return;
  }

  if (resolvedEpisodePayload?.filePath) {
    writeJsonSafe(resolvedEpisodePayload.filePath, nextEpisode);
  }
}

function findEpisodeEntity(episode, entityType, entityId) {
  const candidates = {
    shots: ['shots'],
    characters: ['episodeCharacters', 'characters'],
    scenes: ['scenes'],
    voices: ['voices'],
  }[entityType] || [];

  for (const key of candidates) {
    const list = Array.isArray(episode?.[key]) ? episode[key] : null;
    if (!list) continue;
    const index = list.findIndex((item) => item?.id === entityId || item?.episodeCharacterId === entityId);
    if (index >= 0) {
      return { key, list, index, entity: list[index] };
    }
  }

  return null;
}

function sanitizeEntityUpdate(body = {}) {
  const next = { ...body };
  delete next.id;
  delete next.projectId;
  delete next.scriptId;
  delete next.episodeId;
  return next;
}

function syncEpisodeCharacterCopies(episode, nextEntity) {
  if (!episode || !nextEntity) return;

  for (const key of ['episodeCharacters', 'characters']) {
    const list = Array.isArray(episode[key]) ? episode[key] : null;
    if (!list) continue;
    const index = list.findIndex((item) => item?.id === nextEntity.id || item?.episodeCharacterId === nextEntity.id);
    if (index >= 0) {
      list[index] = {
        ...list[index],
        ...nextEntity,
      };
      episode[key] = list;
    }
  }
}

function resolveLlmPrecheckConfig({ projectId, scriptId, episodeId, baseTempDir }) {
  const episode = loadEpisode(projectId, scriptId, episodeId, { baseTempDir });
  const snapshotProvider = String(
    episode?.llmProvider
      || episode?.provider
      || process.env.LLM_PROVIDER
      || 'qwen'
  ).trim();
  const snapshotModel = String(
    episode?.llmModel
      || episode?.model
      || process.env.LLM_MODEL
      || ''
  ).trim();

  return {
    provider: snapshotProvider || 'qwen',
    model: snapshotModel || undefined,
  };
}

function loadScriptProfessionalizerSkill(workspaceRoot) {
  const skillPath = path.join(workspaceRoot, SCRIPT_PROFESSIONALIZER_SKILL_PATH);
  try {
    return fs.readFileSync(skillPath, 'utf8');
  } catch {
    return [
      '# Script Professionalizer',
      'Convert rough story text into professional-script format for an AI drama pipeline.',
      'Output only Chinese script text split by 【画面N】.',
    ].join('\n');
  }
}

function buildScriptProfessionalizerSystemPrompt(workspaceRoot) {
  const skill = loadScriptProfessionalizerSkill(workspaceRoot);
  const outputContract = skill.match(/## Output Contract[\s\S]*?(?=\n## |\n# |$)/)?.[0] || '';
  const rewriteRules = skill.match(/## Rewrite Rules[\s\S]*?(?=\n## |\n# |$)/)?.[0] || '';
  return [
    '# 剧本专业化改造',
    outputContract,
    rewriteRules,
    '只返回可被 professional-script 解析器识别的中文剧本文本。',
    '禁止解释、评分、表格、代码块、自检清单或任何前后缀。',
  ].filter(Boolean).join('\n\n');
}

function stripMarkdownCodeFence(text) {
  return String(text || '')
    .replace(/^```(?:markdown|md|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function normalizeProfessionalScriptText(content, options = {}) {
  let text = String(content || '').trim();
  if (!text) return '';

  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\s*画面\s*(\d+)[：:.\s、-]*/gm, '【画面$1】\n')
    .replace(/^\s*镜头\s*(\d+)[：:.\s、-]*/gm, '【画面$1】\n')
    .replace(/【\s*画面\s*(\d+)\s*】/g, '【画面$1】')
    .replace(/[ \t]+$/gm, '');

  if (!/【画面\s*\d+】/.test(text)) {
    return '';
  }

  if (!/^第\s*\d+\s*集/m.test(text)) {
    const safeTitle = String(options.title || '优化剧本').trim().replace(/[《》]/g, '') || '优化剧本';
    text = `第1集《${safeTitle}》\n${text}`;
  }

  let shotIndex = 0;
  text = text.replace(/【画面\s*\d+】/g, () => `【画面${++shotIndex}】`);
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function canFastNormalizeProfessionalScript(content, options = {}) {
  const normalized = normalizeProfessionalScriptText(content, options);
  if (!normalized) return null;

  const blocks = normalized
    .split(/(?=【画面\d+】)/)
    .map((block) => block.trim())
    .filter((block) => /^【画面\d+】/.test(block));

  if (blocks.length === 0) return null;
  const requiredFields = ['场景', '人物', '动作', '对白', '时长'];
  const validBlocks = blocks.filter((block) => requiredFields.every((field) => new RegExp(`${field}\\s*[：:]`).test(block)));
  if (validBlocks.length !== blocks.length) return null;

  return normalized;
}

function buildScriptProfessionalizeConfig() {
  const provider = String(process.env.SCRIPT_PROFESSIONALIZER_PROVIDER || process.env.LLM_PROVIDER || 'qwen').trim();
  const model = String(process.env.SCRIPT_PROFESSIONALIZER_MODEL || process.env.LLM_MODEL || '').trim();
  const maxTokens = Number.parseInt(process.env.SCRIPT_PROFESSIONALIZER_MAX_TOKENS || '3000', 10);

  return {
    provider: provider || 'qwen',
    model: model || undefined,
    maxTokens: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : 3000,
  };
}

function buildScriptProfessionalizeCacheKey({ title, content, config }) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      title: String(title || '').trim(),
      content: String(content || '').trim(),
      provider: config.provider,
      model: config.model || '',
      maxTokens: config.maxTokens,
      skillVersion: 'script-professionalizer:v1',
    }))
    .digest('hex');
}

function readScriptProfessionalizeCache(cacheKey) {
  const cached = scriptProfessionalizeCache.get(cacheKey);
  if (!cached) return null;
  return {
    ...cached,
    cached: true,
  };
}

function writeScriptProfessionalizeCache(cacheKey, result) {
  if (scriptProfessionalizeCache.size > 100) {
    const firstKey = scriptProfessionalizeCache.keys().next().value;
    if (firstKey) scriptProfessionalizeCache.delete(firstKey);
  }
  scriptProfessionalizeCache.set(cacheKey, {
    ...result,
    cached: false,
  });
}

async function professionalizeScriptContent({ title, content, workspaceRoot, chatText = llmChat }) {
  const cleanContent = String(content || '').trim();
  if (!cleanContent) {
    throw new Error('剧本内容不能为空');
  }
  if (cleanContent.length > 30000) {
    throw new Error('剧本内容过长，请先拆分后再优化');
  }

  const fastNormalized = canFastNormalizeProfessionalScript(cleanContent, { title });
  if (fastNormalized) {
    return {
      content: fastNormalized,
      source: 'local-normalize',
      cached: false,
    };
  }

  const config = buildScriptProfessionalizeConfig();
  const cacheKey = buildScriptProfessionalizeCacheKey({ title, content: cleanContent, config });
  const cached = readScriptProfessionalizeCache(cacheKey);
  if (cached) {
    return cached;
  }

  const systemPrompt = buildScriptProfessionalizerSystemPrompt(workspaceRoot);
  const messages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: `请把下面的草稿改造成 AI 漫剧系统可直接运行的 professional-script。

硬性格式：
1. 每个镜头必须以【画面1】、【画面2】递增开头。
2. 每个画面必须包含：场景、人物、动作、对白、时长。
3. 动作必须画面化，避免“痛苦、紧张、关系冷淡”这类抽象词单独出现。
4. 对白要符合人物身份，并推动关系或情节。
5. 时长使用“X秒”，单镜头建议 4-10 秒。
6. 只返回改造后的剧本文本。

标题：${String(title || '未命名剧本').trim()}

原始内容：
${cleanContent}`,
    },
  ];

  const optimized = stripMarkdownCodeFence(await chatText(messages, {
    provider: config.provider,
    model: config.model,
    temperature: 0.25,
    maxTokens: config.maxTokens,
  }));

  if (!/【画面\s*1】/.test(optimized)) {
    throw new Error('优化结果不是专业剧本格式，请调整原文后重试');
  }

  const result = {
    content: normalizeProfessionalScriptText(optimized, { title }) || optimized,
    source: 'llm',
    cached: false,
  };
  writeScriptProfessionalizeCache(cacheKey, result);
  return result;
}

function buildScriptParseMetadata({ ok, shotCount = 0, error = null, parsedAt = new Date().toISOString() } = {}) {
  return {
    parseOk: Boolean(ok),
    parseError: error ? String(error) : null,
    shotCount: Number.isFinite(Number(shotCount)) ? Number(shotCount) : 0,
    lastParsedAt: parsedAt,
  };
}

function applyScriptParseMetadata(entry, metadata = {}) {
  if (!entry || !metadata) return entry;
  entry.parseOk = metadata.parseOk === true;
  entry.parseError = metadata.parseError || null;
  entry.shotCount = Number(metadata.shotCount || 0);
  entry.lastParsedAt = metadata.lastParsedAt || new Date().toISOString();
  return entry;
}

function getScriptParseMetadataFromScript(script = {}) {
  const parserMetadata = script?.parserMetadata || {};
  if (Object.prototype.hasOwnProperty.call(script, 'parseOk')) {
    return buildScriptParseMetadata({
      ok: script.parseOk === true,
      error: script.parseError || parserMetadata.lastParseError || null,
      shotCount: script.shotCount || 0,
      parsedAt: script.lastParsedAt || parserMetadata.lastParseErrorAt || script.updatedAt,
    });
  }
  if (parserMetadata.lastParseError) {
    return buildScriptParseMetadata({
      ok: false,
      error: parserMetadata.lastParseError,
      shotCount: 0,
      parsedAt: parserMetadata.lastParseErrorAt || script.updatedAt,
    });
  }
  return buildScriptParseMetadata({
    ok: Number(script.shotCount || 0) > 0,
    shotCount: script.shotCount || 0,
    parsedAt: script.updatedAt,
  });
}

function buildScriptParserTask({ runId, error, startedAt, finishedAt } = {}) {
  const message = String(error || '剧本解析失败，请检查是否包含【画面1】、场景、人物、动作、对白、时长。');
  return {
    id: `${runId || 'run'}_script_parser_failed`,
    step: 'script_parser',
    agent: 'Script Parser',
    status: 'failed',
    detail: '剧本解析失败',
    startedAt: startedAt || new Date().toISOString(),
    finishedAt: finishedAt || startedAt || new Date().toISOString(),
    error: message,
  };
}

function buildRunErrorQaFallback(runJob) {
  if (!runJob?.error) return null;
  const error = String(runJob.error);
  const summary = `剧本解析失败：${error}。请在剧本管理中使用一键优化，或补齐【画面N】、场景、人物、动作、对白、时长后再运行。`;
  return {
    status: 'block',
    releasable: false,
    headline: error.includes('professional-script') || error.includes('【画面')
      ? '剧本解析失败'
      : '运行启动失败',
    summary,
    passCount: 0,
    warnCount: 0,
    blockCount: 1,
    agentSummaries: [
      {
        agentKey: 'scriptParser',
        agentName: 'Script Parser',
        status: 'block',
        headline: '剧本解析失败',
        summary,
        passItems: [],
        warnItems: [],
        blockItems: [error],
        nextAction: '回到剧本管理，使用一键优化或按专业剧本格式补齐画面字段。',
      },
    ],
    topIssues: [
      {
        title: '剧本解析失败',
        summary: error,
        agentKey: 'scriptParser',
        status: 'block',
      },
    ],
    runDebug: {
      fallback: true,
      source: 'run.error',
      runId: runJob.id,
    },
  };
}

function shouldUseRunErrorQaFallback(qaOverview, runJob) {
  if (!runJob?.error) return false;
  if (!runJob?.artifactRunDir) return true;
  const hasRealQaSignal = Boolean(
    qaOverview?.headline ||
    qaOverview?.summary ||
    qaOverview?.agentSummaries?.length ||
    qaOverview?.topIssues?.length ||
    Number(qaOverview?.passCount || 0) > 0 ||
    Number(qaOverview?.warnCount || 0) > 0 ||
    Number(qaOverview?.blockCount || 0) > 0
  );
  return !hasRealQaSignal;
}

function readProjectScriptJson(projectStoreBaseTempDir, projectId, scriptId) {
  return readJsonSafe(path.join(
    projectStoreBaseTempDir,
    'projects',
    projectId,
    'scripts',
    scriptId,
    'script.json'
  ));
}

function enrichScriptEntryWithParseState(entry, projectStoreBaseTempDir, projectId) {
  if (!entry?.id) return entry;
  const scriptJson = readProjectScriptJson(projectStoreBaseTempDir, projectId, entry.id);
  if (!scriptJson) return entry;
  const metadata = getScriptParseMetadataFromScript(scriptJson);
  if (metadata.parseOk !== true && entry.episodeId) {
    const episode = loadEpisode(projectId, entry.id, entry.episodeId, { baseTempDir: projectStoreBaseTempDir });
    const shotCount = Array.isArray(episode?.shots) ? episode.shots.length : 0;
    if (shotCount > 0 && !metadata.parseError) {
      return applyScriptParseMetadata(entry, buildScriptParseMetadata({
        ok: true,
        shotCount,
        parsedAt: scriptJson.updatedAt || episode.updatedAt,
      }));
    }
  }
  return applyScriptParseMetadata(entry, metadata);
}

function readScriptIndexEntry(tempProjectsDir, projectId, scriptId) {
  const scriptsIndex = path.join(tempProjectsDir, projectId, 'scripts.json');
  const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];
  const entryIndex = index.findIndex((item) => item?.id === scriptId);
  return {
    scriptsIndex,
    index,
    entryIndex,
    entry: entryIndex >= 0 ? index[entryIndex] : null,
  };
}

async function ensureRunnableScriptForRun({
  projectId,
  scriptId,
  episodeId,
  tempProjectsDir,
  projectStoreBaseTempDir,
  inputFormat = 'professional-script',
}) {
  const { scriptsIndex, index, entryIndex, entry } = readScriptIndexEntry(tempProjectsDir, projectId, scriptId);
  const scriptJson = readProjectScriptJson(projectStoreBaseTempDir, projectId, scriptId) || {};
  const contentFile = path.join(tempProjectsDir, projectId, 'uploaded-scripts', `${scriptId}.txt`);
  const fileContent = safeExists(contentFile) ? fs.readFileSync(contentFile, 'utf8') : '';
  const currentContent = fileContent || scriptJson.sourceText || scriptJson.content || '';
  const scriptEntry = {
    ...(entry || {}),
    id: scriptId,
    title: entry?.title || scriptJson.title || scriptId,
    createdAt: entry?.createdAt || scriptJson.createdAt || new Date().toISOString(),
    updatedAt: entry?.updatedAt || scriptJson.updatedAt || new Date().toISOString(),
    charCount: currentContent.length,
    episodeId: entry?.episodeId || episodeId,
  };
  const existingEpisode = loadEpisode(projectId, scriptId, episodeId, { baseTempDir: projectStoreBaseTempDir });
  const scriptParseState = getScriptParseMetadataFromScript(scriptJson);
  const scriptContent = String(scriptJson.sourceText || scriptJson.content || '');
  const needsSync =
    !existingEpisode ||
    !Array.isArray(existingEpisode.shots) ||
    existingEpisode.shots.length === 0 ||
    scriptParseState.parseOk !== true ||
    (fileContent && fileContent !== scriptContent);

  let syncResult = {
    ...scriptParseState,
    content: currentContent,
    script: scriptJson,
  };
  if (needsSync) {
    syncResult = await syncRunnableScriptFiles({
      projectId,
      scriptEntry,
      content: currentContent,
      projectStoreBaseTempDir,
      inputFormat,
    });
    if (entryIndex >= 0) {
      index[entryIndex] = scriptEntry;
      fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');
    }
  }

  const episode = loadEpisode(projectId, scriptId, episodeId, { baseTempDir: projectStoreBaseTempDir });
  const shotCount = Array.isArray(episode?.shots) ? episode.shots.length : 0;
  return {
    episode,
    script: readProjectScriptJson(projectStoreBaseTempDir, projectId, scriptId) || syncResult.script || scriptJson,
    entry: scriptEntry,
    parseOk: syncResult.parseOk === true && shotCount > 0,
    parseError: syncResult.parseError || (shotCount > 0 ? null : '剧本解析后没有得到任何分镜'),
    shotCount,
  };
}

async function syncRunnableScriptFiles({
  projectId,
  scriptEntry,
  content,
  projectStoreBaseTempDir,
  inputFormat = 'professional-script',
}) {
  if (!scriptEntry?.id) return;

  const now = new Date().toISOString();
  let parseMetadata = buildScriptParseMetadata({ ok: false, parsedAt: now });
  const runnableContent = inputFormat === 'professional-script'
    ? (normalizeProfessionalScriptText(content, { title: scriptEntry.title }) || content)
    : content;
  const existingScript = readJsonSafe(path.join(
    projectStoreBaseTempDir,
    'projects',
    projectId,
    'scripts',
    scriptEntry.id,
    'script.json'
  )) || {};

  const nextScript = {
    ...existingScript,
    id: scriptEntry.id,
    projectId,
    title: scriptEntry.title,
    content: runnableContent,
    sourceText: runnableContent,
    characters: Array.isArray(existingScript.characters) ? existingScript.characters : [],
    mainCharacterTemplates: Array.isArray(existingScript.mainCharacterTemplates) ? existingScript.mainCharacterTemplates : [],
    createdAt: existingScript.createdAt || scriptEntry.createdAt || now,
    updatedAt: now,
  };

  try {
    const parsed = await parseScript(runnableContent, { inputFormat, title: scriptEntry.title });
    nextScript.title = parsed.title || nextScript.title;
    nextScript.characters = Array.isArray(parsed.characters) ? parsed.characters : nextScript.characters;
    parseMetadata = buildScriptParseMetadata({
      ok: true,
      shotCount: Array.isArray(parsed.shots) ? parsed.shots.length : 0,
      parsedAt: now,
    });
    nextScript.parserMetadata = {
      ...(parsed.parserMetadata || nextScript.parserMetadata || {}),
      lastParseError: null,
      lastParseErrorAt: null,
    };
    nextScript.professionalStructure = parsed.professionalStructure || nextScript.professionalStructure;

    const episodeId = scriptEntry.episodeId;
    if (episodeId) {
      const existingEpisode = loadEpisode(projectId, scriptEntry.id, episodeId, { baseTempDir: projectStoreBaseTempDir }) || {};
      const nextEpisode = createEpisode({
        ...existingEpisode,
        id: episodeId,
        projectId,
        scriptId: scriptEntry.id,
        title: parsed.title || scriptEntry.title || existingEpisode.title,
        summary: existingEpisode.summary || null,
        targetDurationSec: existingEpisode.targetDurationSec || DEFAULT_EPISODE_DURATION_SEC,
        shots: Array.isArray(parsed.shots) ? parsed.shots : [],
        characters: Array.isArray(parsed.characters) ? parsed.characters : [],
        updatedAt: now,
      });
      saveEpisode(projectId, scriptEntry.id, nextEpisode, { baseTempDir: projectStoreBaseTempDir });
    }
  } catch (err) {
    parseMetadata = buildScriptParseMetadata({
      ok: false,
      error: err.message || String(err),
      parsedAt: now,
    });
    nextScript.parserMetadata = {
      ...(nextScript.parserMetadata || {}),
      lastParseError: err.message || String(err),
      lastParseErrorAt: now,
      inputFormat,
    };
    const episodeId = scriptEntry.episodeId;
    if (episodeId) {
      const existingEpisode = loadEpisode(projectId, scriptEntry.id, episodeId, { baseTempDir: projectStoreBaseTempDir }) || {};
      const nextEpisode = createEpisode({
        ...existingEpisode,
        id: episodeId,
        projectId,
        scriptId: scriptEntry.id,
        title: scriptEntry.title || existingEpisode.title,
        summary: existingEpisode.summary || null,
        targetDurationSec: existingEpisode.targetDurationSec || DEFAULT_EPISODE_DURATION_SEC,
        shots: [],
        characters: [],
        updatedAt: now,
      });
      saveEpisode(projectId, scriptEntry.id, nextEpisode, { baseTempDir: projectStoreBaseTempDir });
    }
  }

  nextScript.parseOk = parseMetadata.parseOk;
  nextScript.parseError = parseMetadata.parseError;
  nextScript.shotCount = parseMetadata.shotCount;
  nextScript.lastParsedAt = parseMetadata.lastParsedAt;
  applyScriptParseMetadata(scriptEntry, parseMetadata);
  saveScript(projectId, nextScript, { baseTempDir: projectStoreBaseTempDir });
  return {
    ...parseMetadata,
    content: runnableContent,
    script: nextScript,
  };
}

function buildDerivedData(runJobs, workspaceRoot) {
  const qaOverviewsByRunId = {};
  const artifactSummariesByRunId = {};

  for (const runJob of runJobs) {
    const loadedQaOverview = loadQaOverview(runJob, { workspaceRoot });
    qaOverviewsByRunId[runJob.id] = shouldUseRunErrorQaFallback(loadedQaOverview, runJob)
      ? buildRunErrorQaFallback(runJob)
      : loadedQaOverview;
    artifactSummariesByRunId[runJob.id] = getArtifactDirectorySummary(runJob, { workspaceRoot });
  }

  const projectsMap = new Map();
  for (const runJob of runJobs) {
    const qa = qaOverviewsByRunId[runJob.id];
    if (!projectsMap.has(runJob.projectId)) {
      projectsMap.set(runJob.projectId, {
        id: runJob.projectId,
        title: runJob.scriptTitle || runJob.projectId,
        latestRunId: runJob.id,
        scripts: new Map(),
        runCount: 0,
      });
    }

    const project = projectsMap.get(runJob.projectId);
    project.runCount += 1;

    if (!project.scripts.has(runJob.scriptId)) {
      project.scripts.set(runJob.scriptId, {
        id: runJob.scriptId,
        title: runJob.scriptTitle || runJob.scriptId,
        episodes: new Map(),
      });
    }

    const script = project.scripts.get(runJob.scriptId);
    if (!script.episodes.has(runJob.episodeId)) {
      script.episodes.set(runJob.episodeId, {
        id: runJob.episodeId,
        title: runJob.episodeTitle || runJob.episodeId,
        runs: [],
      });
    }

    script.episodes.get(runJob.episodeId).runs.push({
      id: runJob.id,
      status: normalizeRunStatus(runJob, qa),
      headline: qa.headline || '',
      startedAt: runJob.startedAt,
      finishedAt: runJob.finishedAt,
    });
  }

  const projects = [...projectsMap.values()].map((project) => ({
    id: project.id,
    title: project.title,
    latestRunId: project.latestRunId,
    runCount: project.runCount,
    scripts: [...project.scripts.values()].map((script) => ({
      id: script.id,
      title: script.title,
      episodes: [...script.episodes.values()].map((episode) => ({
        id: episode.id,
        title: episode.title,
        runs: episode.runs,
      })),
    })),
  }));

  return {
    qaOverviewsByRunId,
    artifactSummariesByRunId,
    projects,
  };
}

function safeStaticPath(requestPath, workspaceRoot) {
  const pathname = decodeURIComponent(requestPath.split('?')[0]);
  let absolute = null;
  try {
    absolute = resolvePathInside(workspaceRoot, `.${pathname}`, 'workspace');
  } catch {
    return null;
  }
  return absolute;
}

export function createWorkbenchServer({
  workspaceRoot,
  tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects'),
  spawnProcess = spawn,
  isProcessAlive = defaultIsProcessAlive,
  scriptProfessionalizeChat = llmChat,
} = {}) {
  const projectStoreBaseTempDir = resolveProjectStoreBaseTempDir(tempProjectsDir);
  return http.createServer(async (request, response) => {
    const workbenchToken = process.env.WORKBENCH_TOKEN;
    if (workbenchToken) {
      const method = (request.method || 'GET').toUpperCase();
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        const authHeader = request.headers.authorization || '';
        if (authHeader !== `Bearer ${workbenchToken}`) {
          return sendJson(response, 401, { error: 'Unauthorized' });
        }
      }
    }

    const requestPath = request.url || '/';
    const requestUrl = new URL(requestPath, 'http://127.0.0.1');
    const searchParams = requestUrl.searchParams;
    const pathname = decodeURIComponent(requestUrl.pathname);
    const runJobs = reconcileRunJobs(listRunJobs({ tempProjectsDir }), { workspaceRoot, projectStoreBaseTempDir, isProcessAlive });
    const derived = buildDerivedData(runJobs, workspaceRoot);
    const workbenchModel = buildWorkbenchViewModel({
      runJobs,
      qaOverviewsByRunId: derived.qaOverviewsByRunId,
      artifactSummariesByRunId: derived.artifactSummariesByRunId,
    });

    if (pathname === '/api/workbench') {
      return sendJson(response, 200, workbenchModel);
    }

    if (pathname === '/api/projects') {
      const method = request.method || 'GET';

      if (method === 'POST') {
        try {
          const body = await safeParseBody(request, response); if (body === null) return;
          if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
            return sendJson(response, 400, { error: '项目名称不能为空' });
          }
          const project = createProject({
            title: body.title.trim(),
            description: (body.description || '').trim() || null,
            genre: body.genre || null,
            style: body.style || null,
            coverUrl: body.coverUrl || null,
            aspectRatio: body.aspectRatio || '9:16',
          });
          saveProjectById(project, tempProjectsDir);
          return sendJson(response, 201, project);
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to create project: ${err.message}` });
        }
      }

      // GET
      const manualProjects = listManualProjects(tempProjectsDir);
      const derivedIds = new Set(derived.projects.map(p => p.id));

      const allProjects = [...derived.projects.map((project) => ({
        id: project.id,
        title: project.title,
        latestRunId: project.latestRunId,
        runCount: project.runCount,
        scriptCount: project.scripts.length,
        episodeCount: project.scripts.reduce((total, script) => total + script.episodes.length, 0),
      }))];

      for (const mp of manualProjects) {
        if (!derivedIds.has(mp.id)) {
          allProjects.push({
            id: mp.id,
            title: mp.title || mp.id,
            latestRunId: null,
            runCount: 0,
            scriptCount: 0,
            episodeCount: 0,
            description: mp.description || '',
            genre: mp.genre || null,
            style: mp.style || null,
            coverUrl: mp.coverUrl || null,
            aspectRatio: mp.aspectRatio || '9:16',
            status: mp.status || 'draft',
          });
        }
      }

      return sendJson(response, 200, allProjects);
    }

    if (pathname === '/api/scripts/professionalize' && request.method === 'POST') {
      try {
        const body = await safeParseBody(request, response); if (body === null) return;
        const optimized = await professionalizeScriptContent({
          title: body.title,
          content: body.content,
          workspaceRoot,
          chatText: scriptProfessionalizeChat,
        });
        return sendJson(response, 200, {
          content: optimized.content,
          charCount: optimized.content.length,
          source: optimized.source,
          cached: optimized.cached === true,
        });
      } catch (err) {
        return sendJson(response, 400, { error: err.message || '剧本优化失败' });
      }
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch) {
      let projectId;
      try {
        projectId = validatePathSegment(projectMatch[1], 'projectId');
      } catch (err) {
        return sendJson(response, 400, { error: err.message || 'Invalid projectId' });
      }
      const method = request.method || 'GET';

      if (method === 'PUT') {
        try {
          const body = await safeParseBody(request, response); if (body === null) return;
          const existing = loadProjectById(projectId, tempProjectsDir);
          if (!existing) {
            return sendJson(response, 404, { error: 'Project not found' });
          }
          const updated = {
            ...existing,
            ...(body.title != null && { title: body.title }),
            ...(body.description != null && { description: body.description }),
            ...(body.genre != null && { genre: body.genre }),
            ...(body.style != null && { style: body.style }),
            ...(body.coverUrl != null && { coverUrl: body.coverUrl }),
            ...(body.aspectRatio != null && { aspectRatio: body.aspectRatio }),
            updatedAt: new Date().toISOString(),
          };
          saveProjectById(updated, tempProjectsDir);
          return sendJson(response, 200, updated);
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to update project: ${err.message}` });
        }
      }

      if (method === 'DELETE') {
        try {
          const projectDir = resolvePathInside(tempProjectsDir, projectId, 'temp-projects');
          if (!safeExists(projectDir)) {
            return sendJson(response, 404, { error: 'Project not found' });
          }
          fs.rmSync(projectDir, { recursive: true, force: true });
          return sendJson(response, 200, { success: true, id: projectId });
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to delete project: ${err.message}` });
        }
      }

      // GET
      const project = derived.projects.find((item) => item.id === projectId);
      if (project) {
        return sendJson(response, 200, project);
      }

      const manualProject = loadProjectById(projectId, tempProjectsDir);
      if (manualProject) {
        return sendJson(response, 200, {
          id: manualProject.id || projectId,
          title: manualProject.title || projectId,
          description: manualProject.description || '',
          genre: manualProject.genre || null,
          style: manualProject.style || null,
          coverUrl: manualProject.coverUrl || null,
          aspectRatio: manualProject.aspectRatio || '9:16',
          latestRunId: null,
          runCount: 0,
          scripts: [],
        });
      }

      return sendJson(response, 404, { error: 'Project not found' });
    }

    const storyboardMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/episodes\/([^/]+)\/storyboard$/);
    if (storyboardMatch) {
      if ((request.method || 'GET') !== 'GET') {
        return sendJson(response, 405, { error: 'Method not allowed' });
      }

      let projectId;
      let scriptId;
      let episodeId;
      try {
        projectId = validatePathSegment(storyboardMatch[1], 'projectId');
        scriptId = validatePathSegment(storyboardMatch[2], 'scriptId');
        episodeId = validatePathSegment(storyboardMatch[3], 'episodeId');
      } catch (err) {
        return sendJson(response, 400, { error: err.message || 'Invalid storyboard locator' });
      }
      const requestedRunId = searchParams.get('runId') || searchParams.get('run') || null;
      const { episode, snapshot } = resolveEpisodePayload(projectId, scriptId, episodeId, {
        projectStoreBaseTempDir,
        runJobs,
        workspaceRoot,
        runId: requestedRunId,
      });
      if (!episode) {
        return sendJson(response, 404, { error: 'Episode not found' });
      }
      const requestedRun = pickRunJobById(runJobs, requestedRunId);
      const liveSnapshot = requestedRun
        && requestedRun.projectId === projectId
        && requestedRun.scriptId === scriptId
        && requestedRun.episodeId === episodeId
        ? loadRunLiveState(requestedRun, { projectStoreBaseTempDir })
        : null;

      return sendJson(response, 200, {
        ...episode,
        shots: Array.isArray(episode.shots) ? episode.shots : (snapshot?.scriptData?.shots || liveSnapshot?.scriptData?.shots || []),
        characters: Array.isArray(episode.episodeCharacters)
          ? episode.episodeCharacters
          : (Array.isArray(episode.characters) ? episode.characters : []),
        scenes: Array.isArray(episode.scenes) ? episode.scenes : [],
        voices: Array.isArray(episode.voices) ? episode.voices : [],
        snapshot: snapshot || liveSnapshot || null,
      });
    }

    const storyboardEntityMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/episodes\/([^/]+)\/(shots|characters|scenes|voices)\/([^/]+)$/
    );
    if (storyboardEntityMatch) {
      if ((request.method || 'GET') !== 'PUT') {
        return sendJson(response, 405, { error: 'Method not allowed' });
      }

      let projectId;
      let scriptId;
      let episodeId;
      let entityId;
      const [, , , , entityType, rawEntityId] = storyboardEntityMatch;
      try {
        projectId = validatePathSegment(storyboardEntityMatch[1], 'projectId');
        scriptId = validatePathSegment(storyboardEntityMatch[2], 'scriptId');
        episodeId = validatePathSegment(storyboardEntityMatch[3], 'episodeId');
        entityId = validatePathSegment(rawEntityId, `${entityType.slice(0, -1)}Id`);
      } catch (err) {
        return sendJson(response, 400, { error: err.message || 'Invalid storyboard entity locator' });
      }
      const episodeLockKey = `${projectId}/${scriptId}/${episodeId}`;
      return withRunLock(episodeLockKey, async () => {
        const requestedRunId = searchParams.get('runId') || searchParams.get('run') || null;
        const resolvedEpisodePayload = resolveEpisodePayload(projectId, scriptId, episodeId, {
          projectStoreBaseTempDir,
          runJobs,
          workspaceRoot,
          runId: requestedRunId,
        });
        const { episode } = resolvedEpisodePayload;
        if (!episode) {
          return sendJson(response, 404, { error: 'Episode not found' });
        }

        const body = await safeParseBody(request, response); if (body === null) return;
        const updates = sanitizeEntityUpdate(body);
        const target = findEpisodeEntity(episode, entityType, entityId);
        let nextEntity = null;
        if (!target) {
          if (entityType !== 'voices') {
            return sendJson(response, 404, { error: `${entityType.slice(0, -1)} not found` });
          }
          nextEntity = {
            id: entityId,
            name: updates.name || entityId,
            ...updates,
          };
          const voices = Array.isArray(episode.voices) ? episode.voices : [];
          voices.push(nextEntity);
          episode.voices = voices;
        } else {
          nextEntity = {
            ...target.entity,
            ...updates,
          };
          target.list[target.index] = nextEntity;
          episode[target.key] = target.list;
        }
        if (entityType === 'shots' && Object.prototype.hasOwnProperty.call(updates, 'durationSec')) {
          nextEntity.duration = updates.durationSec;
        }
        if (entityType === 'characters') {
          syncEpisodeCharacterCopies(episode, nextEntity);
        }
        episode.updatedAt = new Date().toISOString();
        persistResolvedEpisode(projectId, scriptId, resolvedEpisodePayload, episode, { projectStoreBaseTempDir });

        return sendJson(response, 200, {
          success: true,
          entityType,
          entity: nextEntity,
        });
      });
    }

    const episodeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/episodes\/([^/]+)$/);
    if (episodeMatch) {
      let projectId;
      let scriptId;
      let episodeId;
      try {
        projectId = validatePathSegment(episodeMatch[1], 'projectId');
        scriptId = validatePathSegment(episodeMatch[2], 'scriptId');
        episodeId = validatePathSegment(episodeMatch[3], 'episodeId');
      } catch (err) {
        return sendJson(response, 400, { error: err.message || 'Invalid episode locator' });
      }
      const requestedRunId = searchParams.get('runId') || searchParams.get('run') || null;
      const { episode } = resolveEpisodePayload(projectId, scriptId, episodeId, {
        projectStoreBaseTempDir,
        runJobs,
        workspaceRoot,
        runId: requestedRunId,
      });
      return sendJson(response, episode ? 200 : 404, episode || { error: 'Episode not found' });
    }

    // ── Script CRUD ──────────────────────────────────────────
    const scriptsListMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts$/);
    if (scriptsListMatch && !pathname.includes('/episodes/')) {
      let targetProjectId;
      try {
        targetProjectId = validatePathSegment(scriptsListMatch[1], 'projectId');
      } catch (err) {
        return sendJson(response, 400, { error: err.message || 'Invalid projectId' });
      }
      const method = request.method || 'GET';

      const projectDir = path.join(tempProjectsDir, targetProjectId);
      const scriptsIndex = path.join(projectDir, 'scripts.json');
      const scriptsDir = path.join(projectDir, 'uploaded-scripts');

      if (method === 'POST') {
        try {
          const body = await safeParseBody(request, response); if (body === null) return;
          if (!body.title || typeof body.title !== 'string') {
            return sendJson(response, 400, { error: '剧本标题不能为空' });
          }
          if (!body.content || typeof body.content !== 'string') {
            return sendJson(response, 400, { error: '剧本内容不能为空' });
          }

          const scriptId = `script_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const episodeId = `episode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const now = new Date().toISOString();
          const entry = { 
            id: scriptId, 
            title: body.title.trim(), 
            createdAt: now, 
            updatedAt: now, 
            charCount: body.content.length,
            episodeId
          };

          // Ensure directories & index
          if (!safeExists(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
          const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];
          index.push(entry);
          fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');

          // Write content file
          fs.writeFileSync(path.join(scriptsDir, `${scriptId}.txt`), body.content, 'utf8');

          // Create minimal episode structure for pipeline
          const episode = createEpisode({
            id: episodeId,
            projectId: targetProjectId,
            scriptId: scriptId,
            title: body.title.trim(),
            summary: null,
            targetDurationSec: DEFAULT_EPISODE_DURATION_SEC,
            shots: [],
          });
          
          // Save episode using projectStore
          const baseTempDir = path.join(workspaceRoot, 'temp');
          saveEpisode(targetProjectId, scriptId, episode, { baseTempDir });

          // Save script.json for pipeline (loadScript expects this)
          const scriptData = {
            id: scriptId,
            projectId: targetProjectId,
            title: body.title.trim(),
            content: body.content,
            sourceText: body.content,
            characters: [],
            mainCharacterTemplates: [],
            createdAt: now,
            updatedAt: now,
          };
          saveScript(targetProjectId, scriptData, { baseTempDir });
          await syncRunnableScriptFiles({
            projectId: targetProjectId,
            scriptEntry: entry,
            content: body.content,
            projectStoreBaseTempDir: baseTempDir,
          });
          index[index.length - 1] = entry;
          fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');

          return sendJson(response, 201, entry);
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to upload script: ${err.message}` });
        }
      }

      // GET — list scripts
      const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];

      // Migration: Create episode + script.json for scripts missing them
      // Guards: only write when the target file doesn't exist, avoiding
      // unnecessary disk I/O on every dashboard load.
      const baseTempDir = path.join(workspaceRoot, 'temp');
      let migrationNeeded = false;
      for (const script of index) {
        const scriptDir = path.join(tempProjectsDir, targetProjectId, 'scripts', script.id);
        const scriptJsonPath = path.join(scriptDir, 'script.json');

        // Ensure episodeId exists
        if (!script.episodeId) {
          const episodeId = `episode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          script.episodeId = episodeId;
          migrationNeeded = true;
        }

        // Ensure episode.json exists (skip write if already present)
        const episodePath = path.join(getEpisodeDir(targetProjectId, script.id, script.episodeId, baseTempDir), 'episode.json');
        if (!safeExists(episodePath)) {
          const episode = createEpisode({
            id: script.episodeId,
            projectId: targetProjectId,
            scriptId: script.id,
            title: script.title,
            summary: null,
            targetDurationSec: DEFAULT_EPISODE_DURATION_SEC,
            shots: [],
          });
          saveEpisode(targetProjectId, script.id, episode, { baseTempDir });
          migrationNeeded = true;
        }

        // Ensure script.json exists
        if (!safeExists(scriptJsonPath)) {
          const contentFile = path.join(tempProjectsDir, targetProjectId, 'uploaded-scripts', `${script.id}.txt`);
          let content = '';
          try {
            if (safeExists(contentFile)) {
              content = fs.readFileSync(contentFile, 'utf8');
            }
          } catch (e) {
            content = '';
          }
          const scriptData = {
            id: script.id,
            projectId: targetProjectId,
            title: script.title,
            content,
            sourceText: content,
            characters: [],
            mainCharacterTemplates: [],
            createdAt: script.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          saveScript(targetProjectId, scriptData, { baseTempDir });
          migrationNeeded = true;
        }

        const contentFile = path.join(tempProjectsDir, targetProjectId, 'uploaded-scripts', `${script.id}.txt`);
        const scriptJson = readJsonSafe(scriptJsonPath) || {};
        const uploadedContent = safeExists(contentFile) ? fs.readFileSync(contentFile, 'utf8') : '';
        const runnableContent = String(scriptJson.sourceText || scriptJson.content || '');
        if (uploadedContent && uploadedContent !== runnableContent) {
          await syncRunnableScriptFiles({
            projectId: targetProjectId,
            scriptEntry: script,
            content: uploadedContent,
            projectStoreBaseTempDir: baseTempDir,
          });
          migrationNeeded = true;
        }
      }

      if (migrationNeeded) {
        fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');
      }

      const enrichedIndex = index.map((script) =>
        enrichScriptEntryWithParseState({ ...script }, baseTempDir, targetProjectId)
      );

      return sendJson(response, 200, enrichedIndex);
    }

    const scriptDetailMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts\/([^/]+)$/);
    if (scriptDetailMatch && !pathname.includes('/episodes/')) {
      let targetProjectId;
      let scriptId;
      try {
        targetProjectId = validatePathSegment(scriptDetailMatch[1], 'projectId');
        scriptId = validatePathSegment(scriptDetailMatch[2], 'scriptId');
      } catch (err) {
        return sendJson(response, 400, { error: err.message || 'Invalid script locator' });
      }
      const method = request.method || 'GET';

      const projectDir = path.join(tempProjectsDir, targetProjectId);
      const scriptsIndex = path.join(projectDir, 'scripts.json');
      const scriptsDir = path.join(projectDir, 'uploaded-scripts');
      const contentFile = path.join(scriptsDir, `${scriptId}.txt`);

      const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];
      const entryIndex = index.findIndex((s) => s.id === scriptId);

      if (entryIndex < 0) {
        return sendJson(response, 404, { error: 'Script not found' });
      }

      if (method === 'PUT') {
        try {
          const body = await safeParseBody(request, response); if (body === null) return;
          const entry = index[entryIndex];

          if (body.title != null) entry.title = body.title;
          entry.updatedAt = new Date().toISOString();

          if (body.content != null && typeof body.content === 'string') {
            if (!safeExists(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
            fs.writeFileSync(contentFile, body.content, 'utf8');
            entry.charCount = body.content.length;
          }

          index[entryIndex] = entry;
          fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');

          const nextContent = body.content != null && typeof body.content === 'string'
            ? body.content
            : (safeExists(contentFile) ? fs.readFileSync(contentFile, 'utf8') : '');
          await syncRunnableScriptFiles({
            projectId: targetProjectId,
            scriptEntry: entry,
            content: nextContent,
            projectStoreBaseTempDir,
          });
          index[entryIndex] = entry;
          fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');

          return sendJson(response, 200, entry);
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to update script: ${err.message}` });
        }
      }

      if (method === 'DELETE') {
        try {
          index.splice(entryIndex, 1);
          fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');
          if (safeExists(contentFile)) fs.unlinkSync(contentFile);
          return sendJson(response, 200, { success: true, id: scriptId });
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to delete script: ${err.message}` });
        }
      }

      // GET — return entry + content
      const content = safeExists(contentFile) ? fs.readFileSync(contentFile, 'utf8') : '';
      const enrichedEntry = enrichScriptEntryWithParseState({ ...index[entryIndex] }, projectStoreBaseTempDir, targetProjectId);
      return sendJson(response, 200, { ...enrichedEntry, content });
    }

    if (pathname === '/api/runs') {
      const method = request.method || 'GET';

      if (method === 'POST') {
        try {
          const body = await safeParseBody(request, response); if (body === null) return;
          const { projectId, scriptId, episodeId, style } = body;
          const mode = body.mode || (body.stopAt ? { kind: 'stop', stopAt: body.stopAt } : { kind: 'stop', stopAt: 'full' });

          if (!projectId || !scriptId || !episodeId) {
            return sendJson(response, 400, { error: 'projectId, scriptId, episodeId are required' });
          }

          const baseTempDir = path.join(workspaceRoot, 'temp');
          const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const runJobsDir = path.join(getEpisodeDir(projectId, scriptId, episodeId, baseTempDir), 'run-jobs');
          const debugLogPath = path.join(runJobsDir, `${runId}.log`);
          const requestedInputFormat = ['professional-script', 'raw-novel', 'auto'].includes(body.inputFormat)
            ? body.inputFormat
            : 'professional-script';
          const args = [
            'scripts/run.js',
            `--project=${projectId}`,
            `--script=${scriptId}`,
            `--episode=${episodeId}`,
            `--run-attempt-id=${runId}`,
            `--input-format=${requestedInputFormat}`,
          ];
          if (style) args.push(`--style=${style}`);

          let latestRun = null;
          if (mode.kind === 'retry') {
            latestRun = findLatestRunJob(runJobs, projectId, scriptId, episodeId);
            cleanLatestFailedRun({
              latestRun,
              projectId,
              scriptId,
              episodeId,
              baseTempDir,
              workspaceRoot,
              debugLogPath,
            });
            if (mode.stopAt && mode.stopAt !== 'full') {
              args.push(`--stop-at=${mode.stopAt}`);
            }
          } else if (mode.kind === 'continue') {
            args.push('--continue');
            latestRun = findLatestRunJob(runJobs, projectId, scriptId, episodeId);
            if (latestRun?.jobId) {
              args.push(`--continue-job-id=${latestRun.jobId}`);
            }
            if (mode.stopAt === 'before_video') {
              args.push('--stop-at=before_video');
            }
          } else if (mode.stopAt && mode.stopAt !== 'full') {
            args.push(`--stop-at=${mode.stopAt}`);
          }

          const preflight = await ensureRunnableScriptForRun({
            projectId,
            scriptId,
            episodeId,
            tempProjectsDir,
            projectStoreBaseTempDir: baseTempDir,
            inputFormat: requestedInputFormat,
          });
          if (!preflight.episode) {
            return sendJson(response, 404, { error: 'Episode not found. Please re-upload the script.' });
          }

          if (!preflight.parseOk) {
            const now = new Date().toISOString();
            const error = preflight.parseError || '剧本解析失败，当前分集没有可运行分镜。';
            appendTextLog(
              debugLogPath,
              `[WorkbenchRunPreflight] project=${projectId} script=${scriptId} episode=${episodeId} parseOk=false shotCount=${preflight.shotCount} error=${error}`
            );
            createRunJob({
              id: runId,
              projectId,
              scriptId,
              episodeId,
              status: 'failed',
              style: style || null,
              scriptTitle: preflight.entry?.title || preflight.script?.title || scriptId,
              episodeTitle: preflight.episode?.title || episodeId,
              startedAt: now,
              finishedAt: now,
              error,
              debugLogPath,
              agentTaskRuns: [
                buildScriptParserTask({
                  runId,
                  error,
                  startedAt: now,
                  finishedAt: now,
                }),
              ],
            }, { baseTempDir });
            return sendJson(response, 200, {
              success: false,
              runId,
              status: 'failed',
              error,
              debugLogPath,
              message: 'Script parser preflight failed',
            });
          }

          const shotCount = preflight.shotCount;
          appendTextLog(
            debugLogPath,
            `[WorkbenchRunTrigger] project=${projectId} script=${scriptId} episode=${episodeId} mode=${JSON.stringify(mode)} style=${style || ''} shotCount=${shotCount} latestRunId=${latestRun?.id || ''} continueJobId=${latestRun?.jobId || ''} args=${JSON.stringify(args)}`
          );

          // Pre-register pending run-job so GET polling finds it immediately (fixes 404 race condition)
          try {
            createRunJob({
              id: runId,
              projectId,
              scriptId,
              episodeId,
              status: 'pending',
              style: style || null,
              scriptTitle: preflight.entry?.title || preflight.script?.title || scriptId,
              episodeTitle: preflight.episode?.title || episodeId,
              startedAt: new Date().toISOString(),
              debugLogPath,
            }, { baseTempDir: path.join(workspaceRoot, 'temp') });
          } catch (preRegErr) {
            // Non-fatal: child process will create/overwrite it anyway
            appendTextLog(debugLogPath, `[WorkbenchRunTrigger] preregister failed: ${preRegErr.message}`);
          }

          const stdoutFd = fs.openSync(debugLogPath, 'a');
          const stderrFd = fs.openSync(debugLogPath, 'a');
          try {
            const child = spawnProcess('node', args, {
              detached: true,
              stdio: ['ignore', stdoutFd, stderrFd],
              cwd: process.cwd(),
            });
            child.unref();
            appendTextLog(debugLogPath, `[WorkbenchRunTrigger] spawned pid=${child.pid || 'unknown'}`);
          } finally {
            fs.closeSync(stdoutFd);
            fs.closeSync(stderrFd);
          }

          return sendJson(response, 200, {
            success: true,
            runId,
            debugLogPath,
            message: 'Pipeline triggered',
          });
        } catch (err) {
          if (err?.code === 'PATH_OUTSIDE_ROOT') {
            return sendJson(response, 400, { error: err.message || 'Unsafe path outside workspace' });
          }
          return sendJson(response, 500, { error: `Failed to trigger run: ${err.message}` });
        }
      }

      return sendJson(
        response,
        200,
        runJobs.map((runJob) => ({
          id: runJob.id,
          projectId: runJob.projectId,
          scriptId: runJob.scriptId,
          episodeId: runJob.episodeId,
          scriptTitle: runJob.scriptTitle,
          episodeTitle: runJob.episodeTitle,
          status: normalizeRunStatus(runJob, derived.qaOverviewsByRunId[runJob.id]),
          startedAt: runJob.startedAt,
          finishedAt: runJob.finishedAt,
          headline: derived.qaOverviewsByRunId[runJob.id]?.headline || '',
        }))
      );
    }

    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch) {
      const run = runJobs.find((item) => item.id === runMatch[1]);
      if (!run) {
        return sendJson(response, 404, { error: 'Run not found' });
      }
      return sendJson(response, 200, {
        ...run,
        qaOverview: derived.qaOverviewsByRunId[run.id] || null,
        artifacts: derived.artifactSummariesByRunId[run.id] || null,
      });
    }

    const runReviewMatch = pathname.match(/^\/api\/runs\/([^/]+)\/review$/);
    if (runReviewMatch) {
      if ((request.method || 'GET') !== 'GET') {
        return sendJson(response, 405, { error: 'Method not allowed' });
      }

      const run = runJobs.find((item) => item.id === runReviewMatch[1]);
      if (!run) {
        return sendJson(response, 404, { error: 'Run not found' });
      }

      const { liveState, postComposeReview, editTaskPack, humanReviewQueue } = loadReviewArtifactsWithLiveFallback(
        run,
        workspaceRoot,
        { projectStoreBaseTempDir }
      );
      return sendJson(response, 200, {
        run: {
          id: run.id,
          projectId: run.projectId,
          scriptId: run.scriptId,
          episodeId: run.episodeId,
          scriptTitle: run.scriptTitle,
          episodeTitle: run.episodeTitle,
          status: liveState?.completedAt ? 'completed' : run.status,
          startedAt: run.startedAt,
          finishedAt: liveState?.completedAt || run.finishedAt,
        },
        qaOverview: derived.qaOverviewsByRunId[run.id] || null,
        postComposeReview: postComposeReview.data,
        editTaskPack: editTaskPack.data,
        humanReviewQueue: humanReviewQueue.data,
      });
    }

    const runReviewClipsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/review\/clips$/);
    if (runReviewClipsMatch) {
      if ((request.method || 'GET') !== 'GET') {
        return sendJson(response, 405, { error: 'Method not allowed' });
      }

      const run = runJobs.find((item) => item.id === runReviewClipsMatch[1]);
      if (!run) {
        return sendJson(response, 404, { error: 'Run not found' });
      }

      const liveState = loadRunLiveState(run, { projectStoreBaseTempDir });
      const snapshot = loadRunArtifactJson(run, workspaceRoot, 'state.snapshot.json');
      const { editTaskPack } = loadReviewArtifactsWithLiveFallback(run, workspaceRoot, { projectStoreBaseTempDir });
      const episode = loadEpisode(run.projectId, run.scriptId, run.episodeId, { baseTempDir: projectStoreBaseTempDir });
      return sendJson(response, 200, {
        runId: run.id,
        clips: buildReviewClips({
          snapshot: snapshot.data || liveState,
          editTaskPack: editTaskPack.data,
          episode,
        }),
      });
    }

    const runReviewTaskMatch = pathname.match(/^\/api\/runs\/([^/]+)\/review\/tasks\/([^/]+)$/);
    if (runReviewTaskMatch) {
      if ((request.method || 'GET') !== 'PUT') {
        return sendJson(response, 405, { error: 'Method not allowed' });
      }

      const runId = runReviewTaskMatch[1];
      return withRunLock(runId, async () => {
        const run = runJobs.find((item) => item.id === runId);
        if (!run) {
          return sendJson(response, 404, { error: 'Run not found' });
        }

        const editTaskPack = loadRunArtifactJson(run, workspaceRoot, 'edit-task-pack.json');
        if (!editTaskPack.data || !editTaskPack.filePath) {
          return sendJson(response, 404, { error: 'Edit task pack not found' });
        }

        const body = await safeParseBody(request, response); if (body === null) return;
        const nextStatus = String(body.status || '').trim();
        const allowedStatuses = new Set(['approved', 'skipped', 'manual_review']);
        if (!allowedStatuses.has(nextStatus)) {
          return sendJson(response, 400, { error: 'Invalid task review status' });
        }

        const taskId = runReviewTaskMatch[2];
        const taskIndex = Array.isArray(editTaskPack.data.tasks)
          ? editTaskPack.data.tasks.findIndex((task) => task?.id === taskId)
          : -1;
        if (taskIndex < 0) {
          return sendJson(response, 404, { error: 'Review task not found' });
        }

        const updatedTask = {
          ...editTaskPack.data.tasks[taskIndex],
          status: nextStatus,
          reviewedAt: new Date().toISOString(),
        };
        editTaskPack.data.tasks[taskIndex] = updatedTask;
        syncEditTaskPackStatusFields(editTaskPack.data);
        writeJsonSafe(editTaskPack.filePath, editTaskPack.data);

        const postComposeReview = loadRunArtifactJson(run, workspaceRoot, 'post-compose-review.json');
        if (postComposeReview.filePath && postComposeReview.data) {
          postComposeReview.data.lastTaskUpdate = {
            taskId,
            status: nextStatus,
            reviewedAt: updatedTask.reviewedAt,
          };
          syncPostComposeReviewStatusFields(postComposeReview.data, editTaskPack.data);
          writeJsonSafe(postComposeReview.filePath, postComposeReview.data);
        }

        const humanReviewQueue = loadRunArtifactJson(run, workspaceRoot, 'human-review-queue.json');
        if (humanReviewQueue.filePath && humanReviewQueue.data) {
          syncHumanReviewQueueStatusFields(humanReviewQueue.data, taskId, nextStatus);
          writeJsonSafe(humanReviewQueue.filePath, humanReviewQueue.data);
        }

        return sendJson(response, 200, {
          success: true,
          task: updatedTask,
        });
      });
    }

    const runReviewVideoMatch = pathname.match(/^\/api\/runs\/([^/]+)\/review\/video$/);
    if (runReviewVideoMatch) {
      if ((request.method || 'GET') !== 'GET') {
        return sendJson(response, 405, { error: 'Method not allowed' });
      }

      const run = runJobs.find((item) => item.id === runReviewVideoMatch[1]);
      if (!run) {
        return sendJson(response, 404, { error: 'Run not found' });
      }

      const runDir = resolveRunDir(run, workspaceRoot);
      const { liveState, editTaskPack } = loadReviewArtifactsWithLiveFallback(run, workspaceRoot, {
        projectStoreBaseTempDir,
      });
      const finalVideoRefs = [
        editTaskPack.data?.finalVideoRef,
        liveState?.outputPath,
        'output/final.mp4',
      ].filter(Boolean);
      if (!runDir) {
        return sendJson(response, 404, { error: 'Run artifact directory not found' });
      }

      let finalVideoPath = null;
      let invalidFinalVideoRef = null;
      for (const finalVideoRef of finalVideoRefs) {
        try {
          const candidatePath = path.isAbsolute(finalVideoRef)
            ? resolveTrustedAbsoluteFinalVideoPath(finalVideoRef, workspaceRoot)
            : resolvePathInside(runDir, finalVideoRef, 'run directory');
          if (path.isAbsolute(finalVideoRef) && !candidatePath) {
            invalidFinalVideoRef = {
              ref: finalVideoRef,
              error: createPathSecurityError(`Resolved path is outside run directory: ${finalVideoRef}`),
            };
            continue;
          }
          if (candidatePath && safeExists(candidatePath)) {
            finalVideoPath = candidatePath;
            break;
          }
        } catch (err) {
          if (err?.code === 'PATH_OUTSIDE_ROOT') {
            const trustedPath = resolveTrustedAbsoluteFinalVideoPath(finalVideoRef, workspaceRoot);
            if (trustedPath && safeExists(trustedPath)) {
              finalVideoPath = trustedPath;
              break;
            }
            invalidFinalVideoRef = { ref: finalVideoRef, error: err };
          } else {
            throw err;
          }
        }
      }

      if (invalidFinalVideoRef) {
        return sendJson(response, 400, {
          error: invalidFinalVideoRef.error?.message || 'Final video path is outside run directory',
        });
      }

      if (!finalVideoPath) {
        const unsafeRef = finalVideoRefs.find((finalVideoRef) => {
          if (!path.isAbsolute(finalVideoRef)) return false;
          return !resolveTrustedAbsoluteFinalVideoPath(finalVideoRef, workspaceRoot);
        });
        if (unsafeRef) {
          try {
            resolvePathInside(runDir, unsafeRef, 'run directory');
          } catch (err) {
            return sendJson(response, 400, { error: err.message || 'Final video path is outside run directory' });
          }
        }
        return sendJson(response, 404, { error: 'Final video not found' });
      }

      return sendVideoFile(response, finalVideoPath, request.headers || {});
    }

    // ── SSE: Real-time run-job stream ───────────────────────────
    const runStreamMatch = pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
    if (runStreamMatch) {
      const runId = decodeURIComponent(runStreamMatch[1]);

      if (request.method !== 'GET') {
        return sendJson(response, 405, { error: 'Method not allowed' });
      }

      const run = runJobs.find((item) => item.id === runId);
      if (!run) {
        return sendJson(response, 404, { error: 'Run not found' });
      }

      // SSE headers
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const TERMINAL_STATUSES = new Set([
        'completed', 'failed', 'error', 'blocked', 'cancelled',
      ]);
      const isTerminal = (status) => TERMINAL_STATUSES.has(String(status || '').toLowerCase());

      function sendSseEvent(eventType, data) {
        try {
          response.write(`event: ${eventType}\n`);
          response.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          // Connection may already be closed
        }
      }

      // Send initial state immediately
      sendSseEvent('status', {
        id: run.id,
        status: run.status,
        scriptTitle: run.scriptTitle,
        episodeTitle: run.episodeTitle,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        error: run.error,
        agentTaskRuns: run.agentTaskRuns || [],
      });

      // If already terminal, close right away
      if (isTerminal(run.status)) {
        sendSseEvent('done', { id: run.id, status: run.status });
        response.end();
        return;
      }

      // Resolve the run-job file path for fs.watch
      const baseTempDir = path.join(workspaceRoot, 'temp');
      const episodeDir = getEpisodeDir(
        run.projectId,
        run.scriptId,
        run.episodeId,
        baseTempDir
      );
      const runJobFilePath = path.join(episodeDir, 'run-jobs', `${run.id}.json`);

      let watcher = null;
      let debounceTimer = null;
      let closed = false;

      function cleanup() {
        if (closed) return;
        closed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        if (watcher) {
          try { watcher.close(); } catch { /* ignore */ }
          watcher = null;
        }
      }

      function pushUpdate() {
        if (closed) return;
        const data = readJsonSafe(runJobFilePath);
        if (!data) return;

        sendSseEvent('status', {
          id: data.id,
          status: data.status,
          scriptTitle: data.scriptTitle,
          episodeTitle: data.episodeTitle,
          startedAt: data.startedAt,
          finishedAt: data.finishedAt,
          error: data.error,
          artifactRunDir: data.artifactRunDir,
          agentTaskRuns: data.agentTaskRuns || [],
        });

        if (isTerminal(data.status)) {
          sendSseEvent('done', { id: data.id, status: data.status });
          cleanup();
          response.end();
        }
      }

      // Start watching — wait for the file to exist if it doesn't yet
      if (safeExists(runJobFilePath)) {
        try {
          watcher = fs.watch(runJobFilePath, () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(pushUpdate, 300);
          });
        } catch {
          // Fall back to interval polling if fs.watch fails
          const fallbackInterval = setInterval(() => {
            if (closed) { clearInterval(fallbackInterval); return; }
            pushUpdate();
          }, 3000);
        }
      } else {
        // File not yet created (pre-registration may have used a different baseTempDir);
        // poll until it appears, then switch to fs.watch
        const probeInterval = setInterval(() => {
          if (closed) { clearInterval(probeInterval); return; }
          if (safeExists(runJobFilePath)) {
            clearInterval(probeInterval);
            pushUpdate();
            try {
              watcher = fs.watch(runJobFilePath, () => {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(pushUpdate, 300);
              });
            } catch { /* ignore */ }
          }
        }, 2000);

        // Timeout: stop probing after 2 minutes
        setTimeout(() => {
          clearInterval(probeInterval);
          if (!closed && !watcher) {
            sendSseEvent('error', { id: runId, message: 'Run job file never appeared' });
            cleanup();
            response.end();
          }
        }, 120000);
      }

      // Clean up on client disconnect
      request.on('close', cleanup);
      request.on('error', cleanup);
      return;
    }

    const runJianyingExportMatch = pathname.match(/^\/api\/runs\/([^/]+)\/export-jianying$/);
    if (runJianyingExportMatch) {
      const run = runJobs.find((item) => item.id === runJianyingExportMatch[1]);
      if (!run) {
        return sendJson(response, 404, { error: 'Run not found' });
      }

      try {
        const snapshotPath = path.join(run.artifactRunDir, 'state.snapshot.json');
        if (!safeExists(snapshotPath)) {
          return sendJson(response, 400, { error: 'Snapshot file not found in run directory' });
        }

        const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
        const scriptShots = snapshot?.scriptData?.shots || [];
        const imageByShotId = new Map((snapshot?.imageResults || []).map((entry) => [entry.shotId, entry]));
        const videoByShotId = new Map((snapshot?.videoResults || []).map((entry) => [entry.shotId, entry]));
        const audioByShotId = new Map((snapshot?.audioResults || []).map((entry) => [entry.shotId, entry]));

        const projectId = crypto.randomUUID();
        const videoTrackId = crypto.randomUUID();
        const audioTrackId = crypto.randomUUID();
        const textTrackId = crypto.randomUUID();

        const videoSegments = [];
        const audioSegments = [];
        const textSegments = [];

        const materialVideos = [];
        const materialAudios = [];
        const materialTexts = [];

        let currentTimelineUs = 0;

        // 2. 遍历各分镜，构建时间线与关联素材
        scriptShots.forEach((shot, index) => {
          const image = imageByShotId.get(shot.id);
          const video = videoByShotId.get(shot.id);
          const audio = audioByShotId.get(shot.id);

          const rawVideoPath = video?.videoPath || image?.imagePath || '';
          const rawAudioPath = audio?.audioPath || '';

          const absVideoPath = rawVideoPath ? path.resolve(workspaceRoot, rawVideoPath).replace(/\//g, '\\') : '';
          const absAudioPath = rawAudioPath ? path.resolve(workspaceRoot, rawAudioPath).replace(/\//g, '\\') : '';

          const durationUs = Math.max(1000000, Math.round((Number(shot.duration) || 3.0) * 1000000));

          // A. 视频/原画轨道段
          if (absVideoPath) {
            const materialId = crypto.randomUUID();
            const segmentId = crypto.randomUUID();

            materialVideos.push({
              "id": materialId,
              "path": absVideoPath,
              "type": video?.videoPath ? "video" : "photo",
              "duration": durationUs,
              "width": 1080,
              "height": 1920
            });

            videoSegments.push({
              "id": segmentId,
              "material_id": materialId,
              "source_timerange": { "duration": durationUs, "start": 0 },
              "target_timerange": { "duration": durationUs, "start": currentTimelineUs },
              "render_index": 10000 + index,
              "volume": 1.0,
              "speed": 1.0
            });
          }

          // B. 配音音频轨道段
          if (absAudioPath) {
            const materialId = crypto.randomUUID();
            const segmentId = crypto.randomUUID();

            materialAudios.push({
              "id": materialId,
              "path": absAudioPath,
              "type": "music",
              "duration": durationUs
            });

            audioSegments.push({
              "id": segmentId,
              "material_id": materialId,
              "source_timerange": { "duration": durationUs, "start": 0 },
              "target_timerange": { "duration": durationUs, "start": currentTimelineUs },
              "render_index": 20000 + index,
              "volume": 1.0,
              "speed": 1.0
            });
          }

          // C. 台词字幕轨道段
          if (shot.dialogue) {
            const materialId = crypto.randomUUID();
            const segmentId = crypto.randomUUID();
            
            const subtitleText = `[${shot.speaker || '未知'}] “${shot.dialogue}”`;

            materialTexts.push({
              "id": materialId,
              "content": JSON.stringify({
                "styles": [],
                "text": subtitleText
              }),
              "type": "text"
            });

            textSegments.push({
              "id": segmentId,
              "material_id": materialId,
              "source_timerange": { "duration": durationUs, "start": 0 },
              "target_timerange": { "duration": durationUs, "start": currentTimelineUs },
              "render_index": 30000 + index,
              "speed": 1.0
            });
          }

          currentTimelineUs += durationUs;
        });

        // 3. 构建完整的 draft_content.json 结构
        const draftContent = {
          "canvas_config": {
            "height": 1920,
            "width": 1080,
            "ratio": "9:16"
          },
          "duration": currentTimelineUs,
          "id": projectId,
          "materials": {
            "videos": materialVideos,
            "audios": materialAudios,
            "texts": materialTexts
          },
          "tracks": [
            {
              "id": videoTrackId,
              "type": "video",
              "segments": videoSegments
            },
            {
              "id": audioTrackId,
              "type": "audio",
              "segments": audioSegments
            },
            {
              "id": textTrackId,
              "type": "text",
              "segments": textSegments
            }
          ]
        };

        // 4. 定位并创建本地剪映草稿目录
        const projectTitle = run.scriptTitle || 'AI漫剧';
        const episodeTitle = run.episodeTitle || run.episodeId || '默认分集';
        const folderName = `[AI漫剧]_${projectTitle}_${episodeTitle}_${run.id.slice(0, 8)}`;

        const userProfile = process.env.USERPROFILE || 'C:\\Users\\default';
        const capcutProjectsBase = path.join(userProfile, 'AppData', 'Local', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
        
        let targetFolder = '';
        let isDirectToCapcut = false;

        if (safeExists(capcutProjectsBase)) {
          targetFolder = path.join(capcutProjectsBase, folderName);
          isDirectToCapcut = true;
        } else {
          // 降级生成到项目根目录 output/CapCut_Draft/ 下
          const fallbackBase = path.join(workspaceRoot, 'output', 'CapCut_Draft');
          if (!safeExists(fallbackBase)) {
            fs.mkdirSync(fallbackBase, { recursive: true });
          }
          targetFolder = path.join(fallbackBase, folderName);
        }

        if (!safeExists(targetFolder)) {
          fs.mkdirSync(targetFolder, { recursive: true });
        }

        // 5. 写入草稿主体和元数据
        const draftMeta = {
          "draft_id": projectId,
          "draft_name": folderName,
          "draft_fold_path": targetFolder,
          "tm_draft_create": Date.now(),
          "tm_draft_modified": Date.now(),
          "draft_type": "draft_type_jianying",
          "draft_version": "13.0.0"
        };

        fs.writeFileSync(path.join(targetFolder, 'draft_content.json'), JSON.stringify(draftContent, null, 2), 'utf8');
        fs.writeFileSync(path.join(targetFolder, 'draft_meta_info.json'), JSON.stringify(draftMeta, null, 2), 'utf8');

        return sendJson(response, 200, {
          success: true,
          directToCapcut: isDirectToCapcut,
          projectName: folderName,
          exportPath: targetFolder,
          durationSec: currentTimelineUs / 1000000
        });
      } catch (err) {
        return sendJson(response, 500, { error: `Failed to export Jianying draft: ${err.message}` });
      }
    }

    const runQaMatch = pathname.match(/^\/api\/runs\/([^/]+)\/qa$/);
    if (runQaMatch) {
      const qa = derived.qaOverviewsByRunId[runQaMatch[1]];
      return sendJson(response, qa ? 200 : 404, qa || { error: 'Run QA not found' });
    }

    const runArtifactsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/artifacts$/);
    if (runArtifactsMatch) {
      const artifacts = derived.artifactSummariesByRunId[runArtifactsMatch[1]];
      return sendJson(response, artifacts ? 200 : 404, artifacts || { error: 'Run artifacts not found' });
    }

    if (pathname === '/api/assets/characters') {
      return sendJson(response, 200, {
        source: 'filesystem-artifacts',
        items: [
          {
            title: workbenchModel.currentRun.displayTitle,
            summary: '角色资产页当前从运行上下文聚合入口，后续接入真实角色档案文件。',
          },
        ],
      });
    }

    if (pathname === '/api/assets/videos') {
      return sendJson(response, 200, {
        source: 'filesystem-artifacts',
        items: runJobs.slice(0, 12).map((runJob) => ({
          id: runJob.id,
          title: `${runJob.scriptTitle || '未命名脚本'} / ${runJob.episodeTitle || runJob.episodeId || '未命名分集'}`,
          status: normalizeRunStatus(runJob, derived.qaOverviewsByRunId[runJob.id]),
          artifactRunDir: runJob.artifactRunDir,
        })),
      });
    }

    // ── 健康检查：LLM API 连通性 ──────────────────────────
    if (pathname === '/api/health/llm') {
      if ((request.method || 'GET') !== 'GET') {
        return sendJson(response, 405, { error: 'Method not allowed' });
      }
      try {
        const url = new URL(request.url || '/api/health/llm', 'http://127.0.0.1');
        const projectId = url.searchParams.get('projectId');
        const scriptId = url.searchParams.get('scriptId');
        const episodeId = url.searchParams.get('episodeId');
        const baseTempDir = path.join(workspaceRoot, 'temp');
        const config =
          projectId && scriptId && episodeId
            ? resolveLlmPrecheckConfig({ projectId, scriptId, episodeId, baseTempDir })
            : {
                provider: process.env.LLM_PROVIDER || 'qwen',
                model: process.env.LLM_MODEL || undefined,
              };
        const result = await llmHealthCheck(config);
        return sendJson(response, 200, result);
      } catch (err) {
        return sendJson(response, 200, {
          ok: false,
          provider: process.env.LLM_PROVIDER || 'qwen',
          model: '',
          latencyMs: 0,
          error: err.message || 'Health check failed',
        });
      }
    }

    if (pathname === '/api/settings/providers') {
      const method = request.method || 'GET';
      if (method === 'GET') {
        return sendJson(response, 200, buildSettingsPayload(workspaceRoot));
      }
      if (method === 'PUT') {
        try {
          const body = await safeParseBody(request, response); if (body === null) return;
          const updates = collectSettingsUpdates(body.sections || []);
          updateEnvFile(path.join(workspaceRoot, '.env'), updates, {
            allowedRoot: workspaceRoot,
            expectedBaseName: '.env',
          });
          return sendJson(response, 200, buildSettingsPayload(workspaceRoot));
        } catch (err) {
          return sendJson(response, 500, { error: err.message || '保存配置失败' });
        }
      }
      return sendJson(response, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/settings/providers/precheck') {
      if ((request.method || 'GET') !== 'POST') {
        return sendJson(response, 405, { error: 'Method not allowed' });
      }
      try {
        const payload = await runBatchProviderPrecheck();
        return sendJson(response, 200, payload);
      } catch (err) {
        return sendJson(response, 500, { error: err.message || '批量预检失败' });
      }
    }

    if (pathname === '/') {
      return sendJson(response, 200, {
        name: 'AI Video Factory Workbench API',
        mode: 'api-only-workbench',
        endpoints: ['/api/workbench', '/api/projects', '/api/runs', '/api/settings/providers'],
      });
    }

    const staticPath = safeStaticPath(requestPath, workspaceRoot);
    if (!staticPath || !safeExists(staticPath) || fs.statSync(staticPath).isDirectory()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    sendFile(response, staticPath);
  });
}

export default {
  createWorkbenchServer,
};
