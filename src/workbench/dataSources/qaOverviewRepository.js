import fs from 'node:fs';
import path from 'node:path';

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function normalizeQaOverview(raw = {}) {
  const agentSummaries = Array.isArray(raw.agentSummaries)
    ? raw.agentSummaries.filter((item) => item && (item.agentName || item.headline || item.summary))
    : [];

  const recomputedPassCount = agentSummaries.filter((item) => item.status === 'pass').length;
  const recomputedWarnCount = agentSummaries.filter((item) => item.status === 'warn').length;
  const recomputedBlockCount = agentSummaries.filter((item) => item.status === 'block').length;

  const passCount =
    Number.isFinite(Number(raw.passCount)) && Number(raw.passCount) > 0
      ? Number(raw.passCount)
      : recomputedPassCount;
  const warnCount =
    Number.isFinite(Number(raw.warnCount)) && Number(raw.warnCount) >= 0
      ? Number(raw.warnCount)
      : recomputedWarnCount;
  const blockCount =
    Number.isFinite(Number(raw.blockCount)) && Number(raw.blockCount) >= 0
      ? Number(raw.blockCount)
      : recomputedBlockCount;

  return {
    status: raw.status || (blockCount > 0 ? 'block' : warnCount > 0 ? 'warn' : 'pass'),
    releasable: raw.releasable !== false,
    headline: raw.headline || '',
    summary: raw.summary || '',
    passCount,
    warnCount,
    blockCount,
    agentSummaries,
    topIssues: Array.isArray(raw.topIssues) ? raw.topIssues : [],
    runDebug: raw.runDebug || {},
  };
}

export function loadQaOverview(runJob, { workspaceRoot }) {
  const artifactRunDir = runJob?.artifactRunDir;
  if (!artifactRunDir) {
    return normalizeQaOverview({});
  }

  const qaOverviewPath = path.join(
    path.isAbsolute(artifactRunDir) ? artifactRunDir : path.join(workspaceRoot, artifactRunDir),
    'qa-overview.json'
  );

  return normalizeQaOverview(readJsonSafe(qaOverviewPath) || {});
}

export default {
  normalizeQaOverview,
  loadQaOverview,
};
