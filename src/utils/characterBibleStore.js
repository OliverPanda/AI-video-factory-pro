import { getCharacterBibleFilePath, getCharacterBiblesDir, loadJSON, saveJSON } from './fileHelper.js';
import fs from 'node:fs';
import path from 'node:path';

export function saveCharacterBible(projectId, characterBible, options = {}) {
  if (typeof characterBible?.id !== 'string' || characterBible.id.trim() === '') {
    throw new Error('[characterBibleStore] characterBible.id must be a non-empty string');
  }

  const filePath = getCharacterBibleFilePath(projectId, characterBible.id, options.baseTempDir);
  saveJSON(filePath, characterBible);
  return characterBible;
}

export function loadCharacterBible(projectId, characterBibleId, options = {}) {
  const filePath = getCharacterBibleFilePath(projectId, characterBibleId, options.baseTempDir);
  return loadJSON(filePath);
}

export function listCharacterBibles(projectId, options = {}) {
  const dirPath = getCharacterBiblesDir(projectId, options.baseTempDir);
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map((fileName) => loadJSON(path.join(dirPath, fileName)))
    .filter(Boolean);
}

export default {
  saveCharacterBible,
  loadCharacterBible,
  listCharacterBibles,
};
