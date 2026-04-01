import path from 'node:path';

import { ensureDir } from './fileHelper.js';
import {
  buildEpisodeDirName,
  buildProjectDirName,
  buildRunDirName,
  buildScriptDirName,
} from './naming.js';

function createAgentContext(runDir, agentDirName) {
  const dir = ensureDir(path.join(runDir, agentDirName));
  const manifestPath = path.join(dir, 'manifest.json');
  const inputsDir = ensureDir(path.join(dir, '0-inputs'));
  const outputsDir = ensureDir(path.join(dir, '1-outputs'));
  const metricsDir = ensureDir(path.join(dir, '2-metrics'));
  const errorsDir = ensureDir(path.join(dir, '3-errors'));

  return {
    dir,
    manifestPath,
    inputsDir,
    outputsDir,
    metricsDir,
    errorsDir,
  };
}

export function createRunArtifactContext(input) {
  const baseTempDir = input?.baseTempDir;
  const projectDir = ensureDir(
    path.join(baseTempDir, 'projects', buildProjectDirName(input?.projectName, input?.projectId))
  );
  const scriptDir = ensureDir(
    path.join(projectDir, 'scripts', buildScriptDirName(input?.scriptTitle, input?.scriptId))
  );
  const episodeDir = ensureDir(
    path.join(
      scriptDir,
      'episodes',
      buildEpisodeDirName({ episodeNo: input?.episodeNo, id: input?.episodeId })
    )
  );
  const runsDir = ensureDir(path.join(episodeDir, 'runs'));
  const runDir = ensureDir(path.join(runsDir, buildRunDirName(input?.runJobId, input?.startedAt)));

  return {
    projectDir,
    scriptDir,
    episodeDir,
    runsDir,
    runDir,
    manifestPath: path.join(runDir, 'manifest.json'),
    agents: {
      scriptParser: createAgentContext(runDir, '01-script-parser'),
      characterRegistry: createAgentContext(runDir, '02-character-registry'),
      promptEngineer: createAgentContext(runDir, '03-prompt-engineer'),
      imageGenerator: createAgentContext(runDir, '04-image-generator'),
      consistencyChecker: createAgentContext(runDir, '05-consistency-checker'),
      ttsAgent: createAgentContext(runDir, '06-tts-agent'),
      videoComposer: createAgentContext(runDir, '07-video-composer'),
    },
  };
}

export default {
  createRunArtifactContext,
};
