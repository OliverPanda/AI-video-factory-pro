import path from 'path';
import { createHash } from 'node:crypto';

export function sanitizeFileSegment(value, fallback) {
  const normalized = String(value || fallback).replace(/[^\w\u4e00-\u9fa5]/g, '_');
  return normalized || fallback;
}

export function buildLegacyBridgeIdentity(scriptFilePath) {
  const resolvedPath = path.resolve(scriptFilePath);
  const baseName = sanitizeFileSegment(path.basename(resolvedPath, path.extname(resolvedPath)), 'legacy');
  const digest = createHash('sha1').update(resolvedPath).digest('hex').slice(0, 12);
  const suffix = `${baseName}_${digest}`;

  return {
    resolvedPath,
    jobId: `legacy_${suffix}`,
    projectId: `legacy_project_${suffix}`,
    scriptId: `legacy_script_${suffix}`,
    episodeId: `legacy_episode_${suffix}`,
  };
}

export function readLegacyInputFormatMetadata(entity) {
  return entity?.sourceInputFormat ||
    entity?.parserInputFormat ||
    entity?.parserMetadata?.inputFormat ||
    entity?.compatibility?.inputFormat ||
    null;
}

export function canReuseExistingParsedLegacyData(existingScript, existingEpisode, selectedInputFormat) {
  if (!existingScript || !existingEpisode) {
    return false;
  }

  const scriptInputFormat = readLegacyInputFormatMetadata(existingScript);
  const episodeInputFormat = readLegacyInputFormatMetadata(existingEpisode);
  const scriptHasInputFormat = Boolean(scriptInputFormat);
  const episodeHasInputFormat = Boolean(episodeInputFormat);

  if (scriptHasInputFormat || episodeHasInputFormat) {
    return (
      scriptHasInputFormat &&
      episodeHasInputFormat &&
      scriptInputFormat === selectedInputFormat &&
      episodeInputFormat === selectedInputFormat
    );
  }

  return false;
}
