import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import sharp from 'sharp';

function normalizeReferenceEntries(referenceImages = []) {
  return (Array.isArray(referenceImages) ? referenceImages : [])
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        return { path: entry.trim() || null, url: null, type: null, role: null };
      }
      if (typeof entry === 'object') {
        return {
          path: String(entry.path || '').trim() || null,
          url:
            String(
              entry.url ||
              entry.publicUrl ||
              entry.remoteUrl ||
              entry.sourceUrl ||
              ''
            ).trim() || null,
          type: String(entry.type || '').trim() || null,
          role: String(entry.role || '').trim() || null,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function isReferenceType(entry = {}, ...types) {
  const normalizedType = String(entry?.type || '').trim().toLowerCase();
  const normalizedRole = String(entry?.role || '').trim().toLowerCase();
  return types.some((type) => normalizedType === type || normalizedRole === type);
}

export function selectSoraReferenceImages(referenceImages = [], options = {}) {
  const normalizedEntries = normalizeReferenceEntries(referenceImages);
  if (normalizedEntries.length === 0) {
    return [];
  }

  const maxCharacterRefs =
    Number.isInteger(options.maxCharacterRefs) && options.maxCharacterRefs >= 0
      ? options.maxCharacterRefs
      : 2;
  const selected = [];
  const seen = new Set();

  function push(entry) {
    if (!entry) return;
    const key = `${entry.path || ''}::${entry.url || ''}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    selected.push(entry);
  }

  const keyframes = normalizedEntries.filter((entry) =>
    isReferenceType(entry, 'keyframe', 'first_frame', 'first_frame_keyframe')
  );
  const characterRefs = normalizedEntries.filter((entry) =>
    isReferenceType(entry, 'character_reference', 'character_ref', 'character_reference_sheet')
  );
  const nonAdjacentRemainder = normalizedEntries.filter(
    (entry) =>
      !keyframes.includes(entry) &&
      !characterRefs.includes(entry) &&
      !isReferenceType(entry, 'adjacent_shot', 'adjacent', 'neighbor_shot')
  );
  const adjacentShots = normalizedEntries.filter((entry) =>
    isReferenceType(entry, 'adjacent_shot', 'adjacent', 'neighbor_shot')
  );

  push(keyframes[0] || null);
  characterRefs.slice(0, maxCharacterRefs).forEach(push);

  if (selected.length === 0) {
    push(nonAdjacentRemainder[0] || null);
  }

  if (selected.length === 0) {
    push(adjacentShots[0] || null);
  }

  if (selected.length <= 1 && adjacentShots.length > 0 && characterRefs.length === 0) {
    push(adjacentShots[0] || null);
  }

  return selected;
}

function inferMimeType(filePath = '') {
  const normalized = String(filePath || '').toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

export function encodeImageFileAsDataUrl(filePath) {
  const mimeType = inferMimeType(filePath);
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

export async function composeReferenceImages(referenceImages = [], options = {}) {
  const entries = normalizeReferenceEntries(referenceImages).filter((entry) => entry.path && fs.existsSync(entry.path));
  if (entries.length === 0) {
    return null;
  }

  if (entries.length === 1) {
    return {
      path: entries[0].path,
      dataUrl: encodeImageFileAsDataUrl(entries[0].path),
      sourceCount: 1,
      composed: false,
    };
  }

  const tileSize = options.tileSize || 768;
  const columns = Math.min(2, entries.length);
  const rows = Math.ceil(entries.length / columns);
  const canvasWidth = columns * tileSize;
  const canvasHeight = rows * tileSize;
  const tempDir = options.tempDir || path.join(process.env.TEMP_DIR || os.tmpdir(), 'aivf-reference-composites');
  fs.mkdirSync(tempDir, { recursive: true });

  const digest = createHash('sha1')
    .update(JSON.stringify(entries.map((entry) => ({ path: entry.path, mtimeMs: fs.statSync(entry.path).mtimeMs }))))
    .digest('hex')
    .slice(0, 16);
  const outputPath = path.join(tempDir, `reference-composite-${digest}.jpg`);

  if (!fs.existsSync(outputPath)) {
    const overlays = [];
    for (let index = 0; index < entries.length; index += 1) {
      const source = entries[index];
      const buffer = await sharp(source.path)
        .rotate()
        .resize({
          width: tileSize,
          height: tileSize,
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 },
          withoutEnlargement: true,
        })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
      overlays.push({
        input: buffer,
        left: (index % columns) * tileSize,
        top: Math.floor(index / columns) * tileSize,
      });
    }

    await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite(overlays)
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(outputPath);
  }

  return {
    path: outputPath,
    dataUrl: encodeImageFileAsDataUrl(outputPath),
    sourceCount: entries.length,
    composed: true,
  };
}

export async function resolveSingleReferenceAsset(referenceImages = [], options = {}) {
  const normalizedEntries = normalizeReferenceEntries(referenceImages);
  if (normalizedEntries.length === 0) {
    return null;
  }

  const localEntries = normalizedEntries.filter((entry) => entry.path && fs.existsSync(entry.path));
  const httpEntry = normalizedEntries.find((entry) => entry.url?.startsWith('http://') || entry.url?.startsWith('https://')) || null;

  if (options.preferDataUrl !== true && localEntries.length <= 1 && httpEntry && !options.forceComposite) {
    return {
      path: localEntries[0]?.path || null,
      dataUrl: localEntries[0]?.path ? encodeImageFileAsDataUrl(localEntries[0].path) : null,
      url: httpEntry.url,
      sourceCount: localEntries.length || (httpEntry ? 1 : 0),
      composed: false,
    };
  }

  if (localEntries.length > 0) {
    return composeReferenceImages(localEntries, options);
  }

  return httpEntry
    ? {
        path: null,
        dataUrl: null,
        url: httpEntry.url,
        sourceCount: 1,
        composed: false,
      }
    : null;
}

export const __testables = {
  normalizeReferenceEntries,
  inferMimeType,
  isReferenceType,
};
