import { getPronunciationLexiconFilePath, loadJSON, saveJSON } from './fileHelper.js';

export function savePronunciationLexicon(projectId, lexicon, options = {}) {
  const filePath = getPronunciationLexiconFilePath(projectId, options.baseTempDir);
  saveJSON(filePath, Array.isArray(lexicon) ? lexicon : []);
  return Array.isArray(lexicon) ? lexicon : [];
}

export function loadPronunciationLexicon(projectId, options = {}) {
  const filePath = getPronunciationLexiconFilePath(projectId, options.baseTempDir);
  return loadJSON(filePath) || [];
}

export default {
  savePronunciationLexicon,
  loadPronunciationLexicon,
};
