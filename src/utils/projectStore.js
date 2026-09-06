import {
  getEpisodeFilePath,
  getProjectFilePath,
  getScriptFilePath,
  loadJSON,
  saveJSON,
} from './fileHelper.js';
import { ProjectStore } from './contracts/ProjectStore.js';

function resolveBaseTempDir(options = {}) {
  return options.baseTempDir;
}

function validateId(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return value;
}

function requireEntityId(entity, entityName) {
  if (!entity || typeof entity !== 'object') {
    throw new Error(`${entityName} must be an object`);
  }

  return validateId(entity.id, `${entityName}.id`);
}

function validateParentLink(entityValue, expectedValue, label) {
  if (entityValue === undefined || entityValue === null) {
    return;
  }

  validateId(entityValue, label);

  if (entityValue !== expectedValue) {
    throw new Error(`${label} must match the provided parent id`);
  }
}

function projectPath(projectId, options) {
  return getProjectFilePath(validateId(projectId, 'projectId'), resolveBaseTempDir(options));
}

function scriptPath(projectId, scriptId, options) {
  return getScriptFilePath(
    validateId(projectId, 'projectId'),
    validateId(scriptId, 'scriptId'),
    resolveBaseTempDir(options)
  );
}

function episodePath(projectId, scriptId, episodeId, options) {
  return getEpisodeFilePath(
    validateId(projectId, 'projectId'),
    validateId(scriptId, 'scriptId'),
    validateId(episodeId, 'episodeId'),
    resolveBaseTempDir(options)
  );
}

export function saveProject(project, options = {}) {
  const projectId = requireEntityId(project, 'project');
  saveJSON(getProjectFilePath(projectId, resolveBaseTempDir(options)), project);
}

export function loadProject(projectId, options = {}) {
  return loadJSON(projectPath(projectId, options));
}

export function saveScript(projectId, script, options = {}) {
  const normalizedProjectId = validateId(projectId, 'projectId');
  const scriptId = requireEntityId(script, 'script');
  validateParentLink(script.projectId, normalizedProjectId, 'script.projectId');
  saveJSON(getScriptFilePath(normalizedProjectId, scriptId, resolveBaseTempDir(options)), script);
}

export function loadScript(projectId, scriptId, options = {}) {
  return loadJSON(scriptPath(projectId, scriptId, options));
}

export function saveEpisode(projectId, scriptId, episode, options = {}) {
  const normalizedProjectId = validateId(projectId, 'projectId');
  const normalizedScriptId = validateId(scriptId, 'scriptId');
  const episodeId = requireEntityId(episode, 'episode');
  validateParentLink(episode.projectId, normalizedProjectId, 'episode.projectId');
  validateParentLink(episode.scriptId, normalizedScriptId, 'episode.scriptId');
  saveJSON(
    getEpisodeFilePath(
      normalizedProjectId,
      normalizedScriptId,
      episodeId,
      resolveBaseTempDir(options)
    ),
    episode
  );
}

export function loadEpisode(projectId, scriptId, episodeId, options = {}) {
  return loadJSON(episodePath(projectId, scriptId, episodeId, options));
}

export class FsProjectStore extends ProjectStore {
  saveProject(project, options = {}) {
    return saveProject(project, options);
  }

  loadProject(projectId, options = {}) {
    return loadProject(projectId, options);
  }

  saveScript(projectId, script, options = {}) {
    return saveScript(projectId, script, options);
  }

  loadScript(projectId, scriptId, options = {}) {
    return loadScript(projectId, scriptId, options);
  }

  saveEpisode(projectId, scriptId, episode, options = {}) {
    return saveEpisode(projectId, scriptId, episode, options);
  }

  loadEpisode(projectId, scriptId, episodeId, options = {}) {
    return loadEpisode(projectId, scriptId, episodeId, options);
  }
}

export const fsProjectStore = new FsProjectStore();

export default {
  saveProject,
  loadProject,
  saveScript,
  loadScript,
  saveEpisode,
  loadEpisode,
  fsProjectStore,
  FsProjectStore,
};
