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
  continuityChecker: '06-continuity-checker',
  ttsAgent: '07-tts-agent',
  ttsQaAgent: '08-tts-qa',
  lipsyncAgent: '08b-lipsync-agent',
  motionPlanner: '09a-motion-planner',
  performancePlanner: '09b-performance-planner',
  videoRouter: '09c-video-router',
  runwayVideoAgent: '09d-runway-video-agent',
  seedanceVideoAgent: '09d-seedance-video-agent',
  motionEnhancer: '09e-motion-enhancer',
  shotQaAgent: '09f-shot-qa',
  bridgeShotPlanner: '09g-bridge-shot-planner',
  bridgeShotRouter: '09h-bridge-shot-router',
  bridgeClipGenerator: '09i-bridge-clip-generator',
  bridgeQaAgent: '09j-bridge-qa',
  actionSequencePlanner: '09k-action-sequence-planner',
  actionSequenceRouter: '09l-action-sequence-router',
  sequenceClipGenerator: '09m-sequence-clip-generator',
  sequenceQaAgent: '09n-sequence-qa',
  videoComposer: '10-video-composer',
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
  const baseTempDir = input?.baseTempDir || './temp';
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
    qaOverviewJsonPath: path.join(runDir, 'qa-overview.json'),
    qaOverviewMarkdownPath: path.join(runDir, 'qa-overview.md'),
    agents: {
      scriptParser: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.scriptParser),
      characterRegistry: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.characterRegistry),
      promptEngineer: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.promptEngineer),
      imageGenerator: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.imageGenerator),
      consistencyChecker: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.consistencyChecker),
      continuityChecker: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.continuityChecker),
      ttsAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.ttsAgent),
      ttsQaAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.ttsQaAgent),
      lipsyncAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.lipsyncAgent),
      motionPlanner: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.motionPlanner),
      performancePlanner: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.performancePlanner),
      videoRouter: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.videoRouter),
      runwayVideoAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.runwayVideoAgent),
      seedanceVideoAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.seedanceVideoAgent),
      motionEnhancer: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.motionEnhancer),
      shotQaAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.shotQaAgent),
      bridgeShotPlanner: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.bridgeShotPlanner),
      bridgeShotRouter: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.bridgeShotRouter),
      bridgeClipGenerator: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.bridgeClipGenerator),
      bridgeQaAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.bridgeQaAgent),
      actionSequencePlanner: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.actionSequencePlanner),
      actionSequenceRouter: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.actionSequenceRouter),
      sequenceClipGenerator: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.sequenceClipGenerator),
      sequenceQaAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.sequenceQaAgent),
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
