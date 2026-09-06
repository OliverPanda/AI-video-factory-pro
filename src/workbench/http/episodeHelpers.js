import fs from 'node:fs';
import path from 'node:path';
import { loadJSON, getEpisodeDir } from '../../utils/fileHelper.js';
import { loadEpisode, saveEpisode } from '../../utils/projectStore.js';
import { validatePathSegment, isPathInside } from './pathSecurity.js';
import { findArtifactFileByName, resolveRunDir } from './reviewSupport.js';
import { matchesRunLocator } from '../../utils/runKey.js';

// ── Episode helpers ──────────────────────────────

export function findEpisodeEntity(episode, entityType, entityId) {
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

export function sanitizeEntityUpdate(body = {}) {
  const next = { ...body };
  delete next.id;
  delete next.projectId;
  delete next.scriptId;
  delete next.episodeId;
  return next;
}

export function syncEpisodeCharacterCopies(episode, nextEntity) {
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

export function loadStoryboardPayload(projectId, scriptId, episodeId, { projectStoreBaseTempDir }) {
  const episode = loadEpisode(projectId, scriptId, episodeId, { baseTempDir: projectStoreBaseTempDir });
  if (!episode) {
    return { episode: null, snapshot: null, episodeDir: null, filePath: null, source: null };
  }
  const episodeDir = getEpisodeDir(projectId, scriptId, episodeId, projectStoreBaseTempDir);
  const snapshot = loadJSON(path.join(episodeDir, 'state.snapshot.json'));
  return {
    episode,
    snapshot,
    episodeDir,
    filePath: path.join(episodeDir, 'episode.json'),
    source: 'project_store',
  };
}

export function resolveEpisodePayload(projectId, scriptId, episodeId, { projectStoreBaseTempDir, runJobs, workspaceRoot, runId = null }) {
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
  const snapshot = loadJSON(snapshotPath) || loadRunLiveState(matchedRun, { projectStoreBaseTempDir });
  const episode = loadJSON(filePath);
  if (!episode) {
    const syntheticEpisode =
      synthesizeEpisodeFromArtifacts(runDir, projectId, scriptId, episodeId, matchedRun)
      || synthesizeMinimalEpisodeFromRun(projectId, scriptId, episodeId, matchedRun, snapshot);
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

export function persistResolvedEpisode(projectId, scriptId, resolvedEpisodePayload, nextEpisode, { projectStoreBaseTempDir }) {
  if (resolvedEpisodePayload?.source === 'project_store') {
    saveEpisode(projectId, scriptId, nextEpisode, { baseTempDir: projectStoreBaseTempDir });
    return;
  }

  if (resolvedEpisodePayload?.filePath) {
    fs.writeFileSync(resolvedEpisodePayload.filePath, JSON.stringify(nextEpisode, null, 2), 'utf8');
  }
}

export function pickLatestRunJobByEpisode(runJobs = [], projectId, scriptId, episodeId) {
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
  return (Array.isArray(runJobs) ? runJobs : []).find((runJob) => matchesRunLocator(runJob, runId)) || null;
}

export function loadRunLiveState(runJob, { projectStoreBaseTempDir }) {
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
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function synthesizeEpisodeFromArtifacts(runDir, projectId, scriptId, episodeId, matchedRun = null) {
  if (!runDir) return null;

  const shotPackagesPath = findArtifactFileByName(runDir, 'shot-packages.json');
  const dialogueNormalizedPath = findArtifactFileByName(runDir, 'dialogue-normalized.json');
  const shotPackages = loadJSON(shotPackagesPath) || [];
  const dialogueNormalized = loadJSON(dialogueNormalizedPath) || [];

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

function synthesizeMinimalEpisodeFromRun(projectId, scriptId, episodeId, matchedRun = null, snapshot = null) {
  if (!matchedRun) return null;

  const snapshotShots = Array.isArray(snapshot?.scriptData?.shots) ? snapshot.scriptData.shots : [];
  const shotIds = snapshotShots.map((shot, index) => ({
    id: String(shot?.id || `shot_${index + 1}`),
    title: String(shot?.title || `镜头 ${String(index + 1).padStart(2, '0')}`),
    scene: String(shot?.scene || ''),
    sceneId: shot?.sceneId || null,
    characters: Array.isArray(shot?.characters) ? shot.characters.map(String) : [],
    action: String(shot?.action || ''),
    dialogue: String(shot?.dialogue || ''),
    emotion: String(shot?.emotion || ''),
    speaker: String(shot?.speaker || ''),
    durationSec: Number(shot?.durationSec || shot?.duration || 0),
    duration: Number(shot?.durationSec || shot?.duration || 0),
    cameraType: String(shot?.cameraType || shot?.camera_type || ''),
    prompt: shot?.prompt || null,
    negativePrompt: shot?.negativePrompt || null,
    provider: shot?.provider || null,
    imagePath: shot?.imagePath || null,
    status: String(shot?.status || 'ready'),
  }));

  return {
    id: episodeId,
    projectId,
    scriptId,
    episodeId,
    title: matchedRun?.episodeTitle || episodeId,
    episodeTitle: matchedRun?.episodeTitle || episodeId,
    shots: shotIds,
    episodeCharacters: [],
    characters: [],
    scenes: [],
    voices: [],
    updatedAt: matchedRun?.finishedAt || matchedRun?.startedAt || new Date().toISOString(),
  };
}
