// ponytail: minimal bridge — delegates to fileHelper
import { getPronunciationLexiconFilePath, loadJSON, saveJSON } from './fileHelper.js';

export function savePronunciationLexicon(projectId, lexicon, options = {}) {
  saveJSON(getPronunciationLexiconFilePath(projectId, options.baseTempDir), lexicon);
  return lexicon;
}

export function loadPronunciationLexicon(projectId, options = {}) {
  return loadJSON(getPronunciationLexiconFilePath(projectId, options.baseTempDir)) || [];
}
