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
  characterRefSheetGenerator: '02b-character-ref-sheets',
  promptEngineer: '03-prompt-engineer',
  imageGenerator: '04-image-generator',
  consistencyChecker: '05-consistency-checker',
  continuityChecker: '06-continuity-checker',
  ttsAgent: '07-tts-agent',
  ttsQaAgent: '08-tts-qa',
  lipsyncAgent: '08b-lipsync-agent',
  motionPlanner: '09a-motion-planner',
  performancePlanner: '09b-performance-planner',
  seedancePromptAgent: '09bb-seedance-prompt-agent',
  preflightQaAgent: '09bc-preflight-qa-agent',
  videoRouter: '09c-video-router',
  runwayVideoAgent: '09d-runway-video-agent',
  sora2VideoAgent: '09d-sora2-video-agent',
  fallbackVideoAgent: '09d-sora2-video-agent',
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

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeStepList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      if (typeof item === 'string') {
        return normalizeText(item);
      }
      return normalizeText(item?.step || item?.name || item?.agentName || item?.label);
    })
    .filter(Boolean);
}

function normalizeArtifactRef(item) {
  if (!item) {
    return null;
  }

  if (typeof item === 'string') {
    const pathValue = normalizeText(item);
    if (!pathValue) return null;
    return {
      path: pathValue,
      label: path.basename(pathValue),
      kind: 'file',
    };
  }

  const pathValue =
    normalizeText(item.path) ||
    normalizeText(item.uri) ||
    normalizeText(item.filePath) ||
    normalizeText(item.outputPath) ||
    null;
  const label =
    normalizeText(item.label) ||
    normalizeText(item.name) ||
    (pathValue ? path.basename(pathValue) : '');

  if (!pathValue && !label) {
    return null;
  }

  return {
    kind: normalizeText(item.kind) || 'file',
    path: pathValue,
    label,
    summary: normalizeText(item.summary) || '',
  };
}

export function normalizeHarnessArtifacts(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeArtifactRef(item))
    .filter(Boolean);
}

export function normalizeHarnessAgentSummary(summary = {}) {
  const nextActions = normalizeList(summary.nextActions || (summary.nextAction ? [summary.nextAction] : []));
  const artifacts = normalizeHarnessArtifacts(summary.artifacts || summary.evidenceFiles || []);
  const status = normalizeText(summary.status) || 'pass';

  return {
    agentKey: normalizeText(summary.agentKey) || null,
    agentName: normalizeText(summary.agentName) || '',
    status,
    headline: normalizeText(summary.headline) || '',
    summary: normalizeText(summary.summary) || '',
    passItems: normalizeList(summary.passItems),
    warnItems: normalizeList(summary.warnItems),
    blockItems: normalizeList(summary.blockItems),
    nextActions,
    nextAction: nextActions[0] || '',
    evidenceFiles: normalizeList(summary.evidenceFiles),
    artifacts,
    inputSnapshot: summary.inputSnapshot ?? null,
    outputSnapshot: summary.outputSnapshot ?? null,
    metrics: summary.metrics || {},
  };
}

export function normalizeHarnessRunOverview(overview = {}) {
  return {
    status: normalizeText(overview.status) || 'pass',
    releasable: overview.releasable !== false,
    headline: normalizeText(overview.headline) || '',
    summary: normalizeText(overview.summary) || '',
    passCount: Number(overview.passCount || 0),
    warnCount: Number(overview.warnCount || 0),
    blockCount: Number(overview.blockCount || 0),
    agentSummaries: Array.isArray(overview.agentSummaries)
      ? overview.agentSummaries.map((item) => normalizeHarnessAgentSummary(item))
      : [],
    topIssues: normalizeList(overview.topIssues),
    runDebug: normalizeHarnessRunDebug(overview.runDebug),
  };
}

export function normalizeHarnessRunDebug(runDebug = {}) {
  return {
    status: normalizeText(runDebug.status) || 'unknown',
    stopStage: normalizeText(runDebug.stopStage) || '',
    stopReason: normalizeText(runDebug.stopReason) || '',
    whereFailed: normalizeText(runDebug.whereFailed) || '',
    lastError: normalizeText(runDebug.lastError) || '',
    completedAt: normalizeText(runDebug.completedAt) || '',
    failedAt: normalizeText(runDebug.failedAt) || '',
    stoppedBeforeVideoAt: normalizeText(runDebug.stoppedBeforeVideoAt) || '',
    previewOutputPath: normalizeText(runDebug.previewOutputPath) || '',
    cachedSteps: normalizeStepList(runDebug.cachedSteps),
    skippedSteps: normalizeStepList(runDebug.skippedSteps),
    retriedSteps: normalizeStepList(runDebug.retriedSteps),
    manualReviewSteps: normalizeStepList(runDebug.manualReviewSteps),
    failedSteps: normalizeStepList(runDebug.failedSteps),
    retriedCount: Number(runDebug.retriedCount || 0),
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

  const sora2VideoAgent = createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.sora2VideoAgent);

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
      seedancePromptAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.seedancePromptAgent),
      preflightQaAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.preflightQaAgent),
      videoRouter: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.videoRouter),
      runwayVideoAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.runwayVideoAgent),
      sora2VideoAgent,
      fallbackVideoAgent: sora2VideoAgent,
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
  normalizeHarnessAgentSummary,
  normalizeHarnessRunOverview,
  normalizeHarnessRunDebug,
  normalizeHarnessArtifacts,
};
