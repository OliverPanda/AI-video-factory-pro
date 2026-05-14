import fs from 'node:fs';
import path from 'node:path';

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function resolveRunDir(runJob, workspaceRoot) {
  if (!runJob?.artifactRunDir) return null;
  return path.isAbsolute(runJob.artifactRunDir)
    ? runJob.artifactRunDir
    : path.join(workspaceRoot, runJob.artifactRunDir);
}

export function getArtifactDirectorySummary(runJob, { workspaceRoot }) {
  const runDir = resolveRunDir(runJob, workspaceRoot);
  if (!runDir) {
    return { runDir: null, agentDirs: [], outputFiles: [] };
  }

  const dirents = safeReadDir(runDir);
  const agentDirs = dirents
    .filter((item) => item.isDirectory() && /^\d/.test(item.name))
    .map((item) => item.name)
    .sort();

  const outputFiles = [];
  for (const agentDir of agentDirs.slice(0, 6)) {
    const outputsDir = path.join(runDir, agentDir, '1-outputs');
    for (const fileDirent of safeReadDir(outputsDir)) {
      if (!fileDirent.isFile()) continue;
      outputFiles.push({
        agentDir,
        name: fileDirent.name,
      });
      if (outputFiles.length >= 12) break;
    }
    if (outputFiles.length >= 12) break;
  }

  return {
    runDir,
    agentDirs,
    outputFiles,
  };
}

export default {
  getArtifactDirectorySummary,
};
