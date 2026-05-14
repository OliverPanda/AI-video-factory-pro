import fs from 'node:fs';
import path from 'node:path';

import { ensureDir } from '../src/utils/fileHelper.js';

function copyDirectory(sourceDir, targetDir) {
  ensureDir(path.dirname(targetDir));
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export async function initSampleProject(options = {}) {
  const sampleProjectDir =
    options.sampleProjectDir || path.resolve('samples', 'project-example');
  const baseTempDir = options.baseTempDir || path.resolve('temp');

  const project = loadJson(path.join(sampleProjectDir, 'project.json'));
  const projectId = project.id;
  const targetProjectDir = path.join(baseTempDir, 'projects', projectId);

  copyDirectory(sampleProjectDir, targetProjectDir);

  const scriptsDir = path.join(targetProjectDir, 'scripts');
  const [scriptId] = fs
    .readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const episodesDir = path.join(scriptsDir, scriptId, 'episodes');
  const [episodeId] = fs
    .readdirSync(episodesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  return {
    projectId,
    scriptId,
    episodeId,
    projectDir: targetProjectDir,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const result = await initSampleProject();
  console.log(JSON.stringify(result, null, 2));
}
