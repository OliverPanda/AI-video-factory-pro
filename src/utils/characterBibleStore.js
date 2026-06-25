// ponytail: minimal bridge — delegates to fileHelper
import { getCharacterBibleFilePath, getCharacterBiblesDir, loadJSON, saveJSON } from './fileHelper.js';
import fs from 'node:fs';
import path from 'node:path';

export function saveCharacterBible(projectId, characterBible, options = {}) {
  if (typeof characterBible?.id !== 'string' || characterBible.id.trim() === '') {
    throw new Error('[characterBibleStore] characterBible.id must be a non-empty string');
  }
  saveJSON(getCharacterBibleFilePath(projectId, characterBible.id, options.baseTempDir), characterBible);
  return characterBible;
}

export function loadCharacterBible(projectId, characterBibleId, options = {}) {
  return loadJSON(getCharacterBibleFilePath(projectId, characterBibleId, options.baseTempDir));
}

export function listCharacterBibles(projectId, options = {}) {
  const dir = getCharacterBiblesDir(projectId, options.baseTempDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => loadJSON(path.join(dir, f))).filter(Boolean);
}
