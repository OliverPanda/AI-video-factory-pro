// ponytail: minimal bridge — delegates to fileHelper
import { getVoicePresetFilePath, loadJSON, saveJSON } from './fileHelper.js';

export function saveVoicePreset(projectId, preset, options = {}) {
  if (typeof preset?.id !== 'string' || preset.id.trim() === '') {
    throw new Error('[voicePresetStore] preset.id must be a non-empty string');
  }
  saveJSON(getVoicePresetFilePath(projectId, preset.id, options.baseTempDir), preset);
  return preset;
}

export function loadVoicePreset(projectId, voicePresetId, options = {}) {
  return loadJSON(getVoicePresetFilePath(projectId, voicePresetId, options.baseTempDir));
}
