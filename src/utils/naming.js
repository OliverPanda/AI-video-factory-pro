function normalizeReadableSegment(value) {
  const normalized = String(value || 'untitled')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, '_');

  return normalized || 'untitled';
}

function buildReadableIdName(label, id) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('id must be a non-empty string');
  }

  return `${normalizeReadableSegment(label)}__${id}`;
}

function normalizeEpisodeNo(value) {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 1;
  return String(safeValue).padStart(2, '0');
}

function formatRunTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error('startedAt must be a valid date-like value');
  }

  const iso = date.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replace(/:/g, '')}`;
}

export { buildReadableIdName, formatRunTimestamp, normalizeReadableSegment };

export function buildProjectDirName(projectName, projectId) {
  return buildReadableIdName(projectName, projectId);
}

export function buildScriptDirName(scriptTitle, scriptId) {
  return buildReadableIdName(scriptTitle, scriptId);
}

export function buildEpisodeDirName(episode) {
  return `第${normalizeEpisodeNo(episode?.episodeNo)}集__${episode?.id}`;
}

export function buildRunDirName(runJobId, startedAt) {
  if (typeof runJobId !== 'string' || runJobId.trim() === '') {
    throw new Error('runJobId must be a non-empty string');
  }

  return `${formatRunTimestamp(startedAt)}__${runJobId}`;
}

export default {
  buildProjectDirName,
  buildScriptDirName,
  buildEpisodeDirName,
  buildRunDirName,
  buildReadableIdName,
  formatRunTimestamp,
  normalizeReadableSegment,
};
