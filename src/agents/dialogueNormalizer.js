import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, saveJSON } from '../utils/fileHelper.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function applyPronunciationLexicon(text, pronunciationLexicon = []) {
  return pronunciationLexicon.reduce((currentText, entry) => {
    if (!entry || typeof entry.source !== 'string' || entry.source === '') {
      return currentText;
    }

    const target = typeof entry.target === 'string' ? entry.target : entry.source;
    return currentText.split(entry.source).join(target);
  }, text);
}

export function normalizeDialogueText(text, options = {}) {
  const normalizedWhitespace = normalizeWhitespace(text);
  if (normalizedWhitespace === '') {
    return '';
  }

  return applyPronunciationLexicon(normalizedWhitespace, options.pronunciationLexicon);
}

export function splitDialogueSegments(text, options = {}) {
  if (!text) {
    return [];
  }

  const maxSegmentLength = options.maxSegmentLength || 120;
  const sentenceLikeParts = text
    .match(/[^。！？!?；;]+[。！？!?；;]?/gu)
    ?.map((part) => part.trim())
    .filter(Boolean) || [];

  if (sentenceLikeParts.length === 0) {
    return [text];
  }

  const segments = [];
  for (const part of sentenceLikeParts) {
    if (part.length <= maxSegmentLength) {
      segments.push(part);
      continue;
    }

    for (let index = 0; index < part.length; index += maxSegmentLength) {
      segments.push(part.slice(index, index + maxSegmentLength));
    }
  }

  return segments;
}

export function estimateDialogueDurationMs(text, options = {}) {
  if (!text) {
    return null;
  }

  const charactersPerSecond = options.charactersPerSecond || 4.5;
  const punctuationPauseMs = options.punctuationPauseMs || 180;
  const punctuationCount = (text.match(/[，,。！？!?；;：:]/g) || []).length;
  const estimatedMs = Math.round((text.length / charactersPerSecond) * 1000 + punctuationCount * punctuationPauseMs);
  return estimatedMs > 0 ? estimatedMs : null;
}

function writeArtifacts(normalizedShots, pronunciationLexicon, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.inputsDir, 'dialogue-normalized.json'), normalizedShots);
  saveJSON(path.join(artifactContext.inputsDir, 'pronunciation-lexicon.json'), pronunciationLexicon || []);
  saveJSON(
    path.join(artifactContext.outputsDir, 'tts-segments.json'),
    normalizedShots.map((shot) => ({
      shotId: shot.id,
      dialogue: shot.dialogue,
      dialogueSegments: shot.dialogueSegments,
      dialogueDurationMs: shot.dialogueDurationMs,
    }))
  );
  writeTextFile(
    path.join(artifactContext.outputsDir, 'dialogue-normalized.md'),
    [
      '| Shot ID | Original | Normalized | Duration Budget (ms) | Segments |',
      '| --- | --- | --- | --- | --- |',
      ...normalizedShots.map((shot) =>
        `| ${shot.id} | ${shot.dialogueOriginal || ''} | ${shot.dialogue || ''} | ${shot.dialogueDurationMs ?? ''} | ${(shot.dialogueSegments || []).join(' / ')} |`
      ),
    ].join('\n') + '\n'
  );
}

export function normalizeDialogueShots(shots = [], options = {}) {
  const pronunciationLexicon = Array.isArray(options.pronunciationLexicon)
    ? options.pronunciationLexicon
    : [];

  const normalizedShots = shots.map((shot) => {
    const dialogueOriginal = shot?.dialogue ?? '';
    const dialogue = normalizeDialogueText(dialogueOriginal, { pronunciationLexicon });
    const dialogueSegments = splitDialogueSegments(dialogue, options);
    const estimatedDurationMs = estimateDialogueDurationMs(dialogue, options);

    return {
      ...shot,
      dialogueOriginal,
      dialogue,
      dialogueSegments,
      dialogueDurationMs: dialogue ? estimatedDurationMs : null,
    };
  });

  writeArtifacts(normalizedShots, pronunciationLexicon, options.artifactContext);
  return normalizedShots;
}

export const __testables = {
  applyPronunciationLexicon,
  normalizeWhitespace,
  splitDialogueSegments,
};
