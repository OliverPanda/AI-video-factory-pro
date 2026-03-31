import { getVoicePresetFilePath, loadJSON, saveJSON } from './fileHelper.js';

export function saveVoicePreset(projectId, preset, options = {}) {
  if (typeof preset?.id !== 'string' || preset.id.trim() === '') {
    throw new Error('[voicePresetStore] preset.id must be a non-empty string');
  }

  const filePath = getVoicePresetFilePath(projectId, preset.id, options.baseTempDir);
  saveJSON(filePath, preset);
  return preset;
}

export function loadVoicePreset(projectId, voicePresetId, options = {}) {
  const filePath = getVoicePresetFilePath(projectId, voicePresetId, options.baseTempDir);
  return loadJSON(filePath);
}
