import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { ensureDir, saveJSON } from './fileHelper.js';
import { formatRunTimestamp, normalizeReadableSegment } from './naming.js';
import { normalizeText } from './normalization.js';
import { ArtifactStore } from './contracts/ArtifactStore.js';
import {
  buildRuntimeStageTimelineEntries,
  normalizeRuntimeJournal,
  normalizeStageRun,
} from '../runtime/schemas/runtimeJournal.js';
import { normalizeDecisionRecord } from '../runtime/schemas/decisionRecord.js';
import { normalizeRunState } from '../runtime/schemas/runState.js';

export const AGENT_ARTIFACT_LAYOUT = {
  scriptParser: '01-script-parser',
  characterRegistry: '02-character-registry',
  characterRefSheetGenerator: '02b-character-ref-sheets',
  characterAssetGovernance: '02c-character-asset-governance',
  promptEngineer: '03-prompt-engineer',
  imageGenerator: '04-image-generator',
  consistencyChecker: '05-consistency-checker',
  continuityChecker: '06-continuity-checker',
  sceneGrammarAgent: '06-scene-grammar',
  ttsAgent: '07-tts-agent',
  ttsQaAgent: '08-tts-qa',
  lipsyncAgent: '08b-lipsync-agent',
  motionPlanner: '09a-motion-planner',
  performancePlanner: '09b-performance-planner',
  seedancePromptAgent: '09bb-seedance-prompt-agent',
  preflightQaAgent: '09bc-preflight-qa-agent',
  videoRouter: '09c-video-router',
  videoGenerationAgent: '09d-video-generation-agent',
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
  storyboardContextAgent: '09o-storyboard-context-memory',
  avPackagingAgent: '09q-av-packaging',
  crossVideoConsistencyChecker: '10-cross-video-consistency',
  crossVideoConsistencyAgent: '10-cross-video-consistency',
  videoComposer: '10-video-composer',
  postComposeReviewAgent: '10b-post-compose-review',
  costGovernance: '11-cost-governance',
  humanReviewQueue: '12-human-review-queue',
};

function createAgentContext(runDir, agentDirName) {
  const dir = ensureDir(path.join(runDir, agentDirName));
  const manifestPath = path.join(dir, 'manifest.json');
  const inputsDir = ensureDir(path.join(dir, '0-inputs'));
  const outputsDir = ensureDir(path.join(dir, '1-outputs'));
  const metricsDir = ensureDir(path.join(dir, '2-metrics'));
  const errorsDir = ensureDir(path.join(dir, '3-errors'));

  return {
    runDir,
    dir,
    manifestPath,
    inputsDir,
    outputsDir,
    metricsDir,
    errorsDir,
  };
}

function buildArtifactHash(...parts) {
  return createHash('sha1')
    .update(parts.filter(Boolean).map((part) => String(part)).join('::'))
    .digest('hex')
    .slice(0, 10);
}

function buildReadableArtifactSegment(value, maxLength = 48) {
  const readable = normalizeReadableSegment(value || 'untitled');
  return readable.length > maxLength ? readable.slice(0, maxLength) : readable;
}

function buildArtifactProjectDirName(input) {
  return `p_${buildArtifactHash(input?.projectId, input?.projectName)}_${buildReadableArtifactSegment(input?.projectName)}`;
}

function buildArtifactScriptDirName(input) {
  return `s_${buildArtifactHash(input?.scriptId, input?.scriptTitle)}_${buildReadableArtifactSegment(input?.scriptTitle)}`;
}

function buildArtifactEpisodeDirName(input) {
  const numericEpisodeNo = Number(input?.episodeNo);
  const episodeNo =
    Number.isFinite(numericEpisodeNo) && numericEpisodeNo > 0
      ? String(Math.floor(numericEpisodeNo)).padStart(2, '0')
      : '01';
  return `e${episodeNo}_${buildArtifactHash(input?.episodeId, input?.episodeTitle)}_${buildReadableArtifactSegment(input?.episodeTitle)}`;
}

function buildArtifactRunDirName(input) {
  return `r_${formatRunTimestamp(input?.startedAt)}_${buildArtifactHash(input?.runJobId)}`;
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
    visualBlockedShotIds: normalizeList(runDebug.visualBlockedShotIds),
    upstreamFailureShotIds: normalizeList(runDebug.upstreamFailureShotIds),
    caseMemoryFindings: normalizeList(runDebug.caseMemoryFindings),
    retriedCount: Number(runDebug.retriedCount || 0),
  };
}

export function createRunArtifactContext(input) {
  const baseTempDir = input?.baseTempDir || './temp';
  const projectDir = ensureDir(path.join(baseTempDir, 'projects', buildArtifactProjectDirName(input)));
  const scriptDir = ensureDir(path.join(projectDir, 'scripts', buildArtifactScriptDirName(input)));
  const episodeDir = ensureDir(path.join(scriptDir, 'episodes', buildArtifactEpisodeDirName(input)));
  const runsDir = ensureDir(path.join(episodeDir, 'runs'));
  const runDir = ensureDir(path.join(runsDir, buildArtifactRunDirName(input)));

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
      characterRefSheetGenerator: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.characterRefSheetGenerator),
      characterAssetGovernance: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.characterAssetGovernance),
      promptEngineer: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.promptEngineer),
      imageGenerator: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.imageGenerator),
      consistencyChecker: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.consistencyChecker),
      continuityChecker: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.continuityChecker),
      sceneGrammarAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.sceneGrammarAgent),
      ttsAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.ttsAgent),
      ttsQaAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.ttsQaAgent),
      lipsyncAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.lipsyncAgent),
      motionPlanner: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.motionPlanner),
      performancePlanner: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.performancePlanner),
      seedancePromptAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.seedancePromptAgent),
      preflightQaAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.preflightQaAgent),
      videoRouter: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.videoRouter),
      videoGenerationAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.videoGenerationAgent),
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
      storyboardContextAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.storyboardContextAgent),
      avPackagingAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.avPackagingAgent),
      crossVideoConsistencyChecker: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.crossVideoConsistencyChecker),
      crossVideoConsistencyAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.crossVideoConsistencyAgent),
      videoComposer: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.videoComposer),
      postComposeReviewAgent: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.postComposeReviewAgent),
      costGovernance: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.costGovernance),
      humanReviewQueue: createAgentContext(runDir, AGENT_ARTIFACT_LAYOUT.humanReviewQueue),
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

export function writeRuntimeJournal(artifactContext, payload = {}, options = {}) {
  const writeJSON = options.saveJSON || saveJSON;
  const existingTimeline = (() => {
    try {
      return JSON.parse(fs.readFileSync(artifactContext.timelinePath, 'utf-8'));
    } catch {
      return [];
    }
  })();

  const executionRecords = (Array.isArray(payload.executionRecords) ? payload.executionRecords : [])
    .map((item) => normalizeStageRun(item))
    .filter((item) => item.stage);
  const decisions = (Array.isArray(payload.decisions) ? payload.decisions : [])
    .map((item) => normalizeDecisionRecord(item))
    .filter((item) => item.decisionType !== 'unknown' || item.decisionKey);

  const runtimeJournal = normalizeRuntimeJournal({
    status: normalizeText(payload.status) || 'unknown',
    updatedAt: normalizeText(payload.updatedAt) || new Date().toISOString(),
    stages: executionRecords,
    decisions,
  });

  const preservedTimeline = Array.isArray(existingTimeline)
    ? existingTimeline.filter((entry) => entry?.event !== 'runtime_stage_execution')
    : [];
  const stageTimelineEntries = buildRuntimeStageTimelineEntries(runtimeJournal);

  writeJSON(path.join(artifactContext.runDir, 'runtime-journal.json'), runtimeJournal);
  writeJSON(artifactContext.timelinePath, [...preservedTimeline, ...stageTimelineEntries]);

  const nextSnapshot = {
    ...(payload.snapshot || {}),
    runtimeJournal,
    pipelineExecutionRecords: executionRecords,
    decisionRecords: decisions,
  };
  const runState = normalizeRunState({
    snapshot: nextSnapshot,
    runtimeJournal,
    stageRuns: executionRecords,
    decisions,
    runId: payload.runId || nextSnapshot.runId || nextSnapshot.id,
    jobId: payload.jobId || nextSnapshot.jobId,
    projectId: payload.projectId || nextSnapshot.projectId,
    scriptId: payload.scriptId || nextSnapshot.scriptId,
    episodeId: payload.episodeId || nextSnapshot.episodeId,
    status: payload.status || nextSnapshot.status,
    startedAt: payload.startedAt || nextSnapshot.startedAt,
    updatedAt: payload.updatedAt || nextSnapshot.updatedAt,
    completedAt: payload.completedAt || nextSnapshot.completedAt,
    failedAt: payload.failedAt || nextSnapshot.failedAt,
  });
  nextSnapshot.runState = runState;
  writeJSON(path.join(artifactContext.runDir, 'state.snapshot.json'), nextSnapshot);

  return runtimeJournal;
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

export class FsArtifactStore extends ArtifactStore {
  createRunArtifactContext(input) {
    return createRunArtifactContext(input);
  }

  initializeRunArtifacts(artifactContext, metadata, options = {}) {
    return initializeRunArtifacts(artifactContext, metadata, options);
  }

  writeRuntimeJournal(artifactContext, payload, options = {}) {
    return writeRuntimeJournal(artifactContext, payload, options);
  }

  adoptAgentArtifacts(sourceAgentContext, targetAgentContext) {
    return adoptAgentArtifacts(sourceAgentContext, targetAgentContext);
  }
}

export const fsArtifactStore = new FsArtifactStore();

export default {
  createRunArtifactContext,
  initializeRunArtifacts,
  writeRuntimeJournal,
  adoptAgentArtifacts,
  AGENT_ARTIFACT_LAYOUT,
  normalizeHarnessAgentSummary,
  normalizeHarnessRunOverview,
  normalizeHarnessRunDebug,
  normalizeHarnessArtifacts,
  fsArtifactStore,
  FsArtifactStore,
};
