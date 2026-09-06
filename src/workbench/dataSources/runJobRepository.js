import fs from 'node:fs';
import path from 'node:path';
import { attachRunKey } from '../../utils/runKey.js';

const CACHE_TTL_MS = Number(process.env.WORKBENCH_CACHE_TTL_MS || 5000);

let _cachedRunJobs = null;
let _cachedProjectsDir = null;
let _cacheTimestamp = 0;

function safeExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseDate(value) {
  const time = Date.parse(value || '');
  return Number.isNaN(time) ? 0 : time;
}

export function findRunJobFiles({ tempProjectsDir }) {
  if (!safeExists(tempProjectsDir)) {
    return [];
  }

  const runJobFiles = [];

  for (const projectDirent of safeReadDir(tempProjectsDir)) {
    if (!projectDirent.isDirectory()) continue;
    const scriptsDir = path.join(tempProjectsDir, projectDirent.name, 'scripts');

    for (const scriptDirent of safeReadDir(scriptsDir)) {
      if (!scriptDirent.isDirectory()) continue;
      const episodesDir = path.join(scriptsDir, scriptDirent.name, 'episodes');

      for (const episodeDirent of safeReadDir(episodesDir)) {
        if (!episodeDirent.isDirectory()) continue;
        const runJobsDir = path.join(episodesDir, episodeDirent.name, 'run-jobs');

        for (const fileDirent of safeReadDir(runJobsDir)) {
          if (fileDirent.isFile() && fileDirent.name.endsWith('.json')) {
            runJobFiles.push(path.join(runJobsDir, fileDirent.name));
          }
        }
      }
    }
  }

  return runJobFiles;
}

export function listRunJobs({ tempProjectsDir }) {
  const now = Date.now();
  if (
    _cachedRunJobs &&
    _cachedProjectsDir === tempProjectsDir &&
    now - _cacheTimestamp < CACHE_TTL_MS
  ) {
    return _cachedRunJobs;
  }

  const jobs = findRunJobFiles({ tempProjectsDir })
    .map((filePath) => readJsonSafe(filePath))
    .filter(Boolean)
    .map((runJob) => attachRunKey(runJob))
    .sort((a, b) => parseDate(b.startedAt) - parseDate(a.startedAt));

  _cachedRunJobs = jobs;
  _cachedProjectsDir = tempProjectsDir;
  _cacheTimestamp = now;

  return jobs;
}

export function invalidateRunJobCache() {
  _cachedRunJobs = null;
  _cachedProjectsDir = null;
  _cacheTimestamp = 0;
}

export default {
  findRunJobFiles,
  listRunJobs,
  invalidateRunJobCache,
};
