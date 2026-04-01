import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, saveJSON } from './fileHelper.js';
import {
  buildEpisodeDirName,
  buildProjectDirName,
  buildRunDirName,
  buildScriptDirName,
} from './naming.js';

export const AGENT_ARTIFACT_LAYOUT = {
  scriptParser: '01-script-parser',
  characterRegistry: '02-character-registry',
  promptEngineer: '03-prompt-engineer',
  imageGenerator: '04-image-generator',
  consistencyChecker: '05-consistency-checker',
  ttsAgent: '06-tts-agent',
  videoComposer: '07-video-composer',
};

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
    timelinePath: path.join(runDir, 'timeline.json'),
    agents: {
      scriptParser: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.scriptParser),
      characterRegistry: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.characterRegistry),
      promptEngineer: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.promptEngineer),
      imageGenerator: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.imageGenerator),
      consistencyChecker: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.consistencyChecker),
      ttsAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.ttsAgent),
      videoComposer: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.videoComposer),
    },
  };
}

export function initializeRunArtifacts(artifactContext, metadata, options = {}) {
  const writeJSON = options.saveJSON || saveJSON;
  const timeline = [
    {
      event: 'run_initialized',
      status: 'running',
      at: metadata.startedAt,
      runJobId: metadata.runJobId,
      jobId: metadata.jobId,
    },
  ];

  writeJSON(artifactContext.manifestPath, metadata);
  writeJSON(artifactContext.timelinePath, timeline);

  for (const [agentKey, agentContext] of Object.entries(artifactContext.agents)) {
    if (!fs.existsSync(agentContext.manifestPath)) {
      writeJSON(agentContext.manifestPath, {
        agentKey,
        agentDirName: AGENT_ARTIFACT_LAYOUT[agentKey],
        status: 'pending',
      });
    }
  }

  return timeline;
}

export function adoptAgentArtifacts(sourceAgentContext, targetAgentContext) {
  if (!sourceAgentContext || !targetAgentContext) {
    return targetAgentContext;
  }

  if (sourceAgentContext.dir === targetAgentContext.dir) {
    return targetAgentContext;
  }

  if (!fs.existsSync(sourceAgentContext.dir)) {
    return targetAgentContext;
  }

  fs.rmSync(targetAgentContext.dir, { recursive: true, force: true });
  ensureDir(path.dirname(targetAgentContext.dir));
  fs.renameSync(sourceAgentContext.dir, targetAgentContext.dir);
  return targetAgentContext;
}

export default {
  createRunArtifactContext,
  initializeRunArtifacts,
  adoptAgentArtifacts,
  AGENT_ARTIFACT_LAYOUT,
};
