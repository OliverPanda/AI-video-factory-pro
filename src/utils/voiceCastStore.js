import { getVoiceCastFilePath, loadJSON, saveJSON } from './fileHelper.js';

export function saveVoiceCast(projectId, voiceCast, options = {}) {
  const filePath = getVoiceCastFilePath(projectId, options.baseTempDir);
  saveJSON(filePath, voiceCast);
  return voiceCast;
}

export function loadVoiceCast(projectId, options = {}) {
  const filePath = getVoiceCastFilePath(projectId, options.baseTempDir);
  return loadJSON(filePath);
}

