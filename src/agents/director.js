/**
 * 导演Agent（Orchestrator）- 主编排器
 * 支持分集级别执行，并保留旧剧本文件入口的兼容桥接
 */

import fs from 'node:fs';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { parseScript } from './scriptParser.js';
import {
  buildCharacterRegistry,
  findCharacterByIdentity,
  findCharacterByIdentityOrName,
  resolveCharacterIdentity,
} from './characterRegistry.js';
import { applyContinuityRepairHints, generateAllPrompts } from './promptEngineer.js';
import { generateAllImages, regenerateImage } from './imageGenerator.js';
import { generateCharacterRefSheets } from './characterRefSheetGenerator.js';
import { imageQueue } from '../utils/queue.js';
import { runConsistencyCheck } from './consistencyChecker.js';
import { runContinuityCheck } from './continuityChecker.js';
import { normalizeDialogueShots } from './dialogueNormalizer.js';
import { generateAllAudio } from './ttsAgent.js';
import { runTtsQa } from './ttsQaAgent.js';
import { runLipsync } from './lipsyncAgent.js';
import { planSceneGrammar } from './sceneGrammarAgent.js';
import { planDirectorPacks } from './directorPackAgent.js';
import { runPreflightQa } from './preflightQaAgent.js';
import { planMotion } from './motionPlanner.js';
import { planPerformance } from './performancePlanner.js';
import { routeVideoShots } from './videoRouter.js';
import { runSeedanceVideo } from './seedanceVideoAgent.js';
import { runSora2Video } from './sora2VideoAgent.js';
import { runMotionEnhancer } from './motionEnhancer.js';
import { runShotQa } from './shotQaAgent.js';
import { planBridgeShots } from './bridgeShotPlanner.js';
import { routeBridgeShots } from './bridgeShotRouter.js';
import { generateBridgeClips } from './bridgeClipGenerator.js';
import { runBridgeQa } from './bridgeQaAgent.js';
import { planActionSequences } from './actionSequencePlanner.js';
import { routeActionSequencePackages } from './actionSequenceRouter.js';
import { generateSequenceClips } from './sequenceClipGenerator.js';
import { runSequenceQa } from './sequenceQaAgent.js';
import { composeVideo } from './videoComposer.js';
import { createAnimationClip, createKeyframeAsset } from '../domain/assetModel.js';
import { createEpisode, createProject, createScript } from '../domain/projectModel.js';
import { loadEpisode, loadProject, loadScript, saveEpisode, saveProject, saveScript } from '../utils/projectStore.js';
import { ensureDir, generateJobId, initDirs, loadJSON, readTextFile, saveJSON } from '../utils/fileHelper.js';
import { appendAgentTaskRun, createRunJob, finishRunJob } from '../utils/jobStore.js';
import { AGENT_ARTIFACT_LAYOUT, adoptAgentArtifacts, createRunArtifactContext, initializeRunArtifacts } from '../utils/runArtifacts.js';
import { createActionSequencePackage, createActionSequencePlanEntry, createSequenceClipResult, createSequenceQaReport } from '../utils/actionSequenceProtocol.js';
import { listCharacterBibles } from '../utils/characterBibleStore.js';
import { loadPronunciationLexicon } from '../utils/pronunciationLexiconStore.js';
import { writeRunQaOverview } from '../utils/qaSummary.js';
import { ensureProjectVoiceCast, loadVoiceCast } from '../utils/voiceCastStore.js';
import { loadVoicePreset } from '../utils/voicePresetStore.js';
import { buildEpisodeDirName, buildProjectDirName } from '../utils/naming.js';
import logger from '../utils/logger.js';

const LEGACY_DEFAULT_INPUT_FORMAT = 'professional-script';

function sanitizeFileSegment(value, fallback) {
  const normalized = String(value || fallback).replace(/[^\w\u4e00-\u9fa5]/g, '_');
  return normalized || fallback;
}

function buildEpisodeContext(script, episode) {
  return episode.summary || script.sourceText || episode.title || script.title || '';
}

function buildLegacyBridgeIdentity(scriptFilePath) {
  const resolvedPath = path.resolve(scriptFilePath);
  const baseName = sanitizeFileSegment(path.basename(resolvedPath, path.extname(resolvedPath)), 'legacy');
  const digest = createHash('sha1').update(resolvedPath).digest('hex').slice(0, 12);
  const suffix = `${baseName}_${digest}`;

  return {
    resolvedPath,
    jobId: `legacy_${suffix}`,
    projectId: `legacy_project_${suffix}`,
    scriptId: `legacy_script_${suffix}`,
    episodeId: `legacy_episode_${suffix}`,
  };
}

function readLegacyInputFormatMetadata(entity) {
  return entity?.sourceInputFormat ||
    entity?.parserInputFormat ||
    entity?.parserMetadata?.inputFormat ||
    entity?.compatibility?.inputFormat ||
    null;
}

function initializePhase4SequenceState(state = {}) {
  return {
    actionSequencePlan: Array.isArray(state.actionSequencePlan)
      ? state.actionSequencePlan.map((entry) => createActionSequencePlanEntry(entry))
      : [],
    actionSequencePackages: Array.isArray(state.actionSequencePackages)
      ? state.actionSequencePackages.map((entry) => createActionSequencePackage(entry))
      : [],
    sequenceClipResults: Array.isArray(state.sequenceClipResults)
      ? state.sequenceClipResults.map((entry) => createSequenceClipResult(entry))
      : [],
    sequenceQaReport: state.sequenceQaReport ? createSequenceQaReport(state.sequenceQaReport) : null,
  };
}

function hashContent(value) {
  return createHash('sha1').update(String(value || '')).digest('hex');
}

function simplifyNormalizedShotsForCache(normalizedShots = []) {
  return (Array.isArray(normalizedShots) ? normalizedShots : []).map((shot) => ({
    id: shot?.id || shot?.shotId || null,
    dialogue: shot?.dialogue || '',
    speaker: shot?.speaker || shot?.speakerId || '',
  }));
}

function simplifyVoiceCastForCache(voiceCast = []) {
  return (Array.isArray(voiceCast) ? voiceCast : []).map((entry) => ({
    characterId: entry?.characterId || entry?.episodeCharacterId || entry?.mainCharacterTemplateId || null,
    displayName: entry?.displayName || entry?.name || null,
    voicePresetId: entry?.voicePresetId || null,
    provider: entry?.voiceProfile?.provider || entry?.provider || null,
    voice: entry?.voiceProfile?.voice || entry?.voiceId || null,
    rate: entry?.voiceProfile?.rate ?? entry?.rate ?? null,
    pitch: entry?.voiceProfile?.pitch ?? entry?.pitch ?? null,
    volume: entry?.voiceProfile?.volume ?? entry?.volume ?? null,
    voiceProfile: entry?.voiceProfile || null,
  }));
}

function buildAudioResultsSignature(audioResults = []) {
  return (Array.isArray(audioResults) ? audioResults : []).map((entry) => {
    const audioPath = entry?.audioPath || null;
    let statSignature = null;
    if (audioPath && fs.existsSync(audioPath)) {
      const stat = fs.statSync(audioPath);
      statSignature = `${stat.size}:${Math.round(stat.mtimeMs)}`;
    }
    return {
      shotId: entry?.shotId || null,
      audioPath,
      statSignature,
    };
  });
}

function buildAudioCacheKey({ normalizedShots, voiceProjectId, voiceCast }) {
  return hashContent(
    JSON.stringify({
      voiceProjectId: normalizeProjectId(voiceProjectId),
      normalizedShots: simplifyNormalizedShotsForCache(normalizedShots),
      voiceCast: simplifyVoiceCastForCache(voiceCast),
    })
  );
}

function buildLipsyncCacheKey({ normalizedShots, voiceProjectId, audioResults }) {
  return hashContent(
    JSON.stringify({
      voiceProjectId: normalizeProjectId(voiceProjectId),
      normalizedShots: simplifyNormalizedShotsForCache(normalizedShots),
      audioResults: buildAudioResultsSignature(audioResults),
    })
  );
}

function createRunJobAttemptId(jobId, now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, '');
  const nonce = randomUUID().replace(/-/g, '').slice(0, 8);
  return `run_${jobId}_${timestamp}_${nonce}`;
}

function ensureImageResultIdentity(imageResult) {
  if (imageResult?.keyframeAssetId) {
    return imageResult;
  }

  const keyframeAsset = createKeyframeAsset({
    shotId: imageResult?.shotId,
    imagePath: imageResult?.imagePath || null,
    status: imageResult?.success === false ? 'failed' : 'ready',
  });

  return {
    ...imageResult,
    keyframeAssetId: keyframeAsset.id,
  };
}

function assertCharacterRefSheetsSucceeded(refSheetResults = [], characterRegistry = []) {
  const failedSheets = (Array.isArray(refSheetResults) ? refSheetResults : []).filter(
    (sheet) => !sheet?.success || !sheet?.imagePath
  );

  if (failedSheets.length === 0) {
    return;
  }

  const failedNames = failedSheets
    .map((sheet) => sheet?.characterName || sheet?.characterId || 'unknown')
    .join('、');

  const expectedCount = Array.isArray(characterRegistry) ? characterRegistry.length : 0;
  throw new Error(`角色三视图生成失败：${failedSheets.length}/${expectedCount} 个角色未通过，失败角色：${failedNames}`);
}

function buildAnimationClipBridge(imageResults, animationClips = []) {
  const explicitClips = Array.isArray(animationClips)
    ? animationClips.filter((clip) => clip?.shotId && clip?.videoPath)
    : [];
  if (explicitClips.length > 0) {
    return explicitClips;
  }

  return imageResults
    .filter((result) => result?.shotId && result?.imagePath)
    .map((result) =>
      createAnimationClip({
        shotId: result.shotId,
        keyframeAssetId: result.keyframeAssetId,
        videoPath: null,
        sourceMode: 'single_keyframe',
        status: result.success === false ? 'failed' : 'draft',
      })
    );
}

function getDefaultVideoProvider() {
  const rawProvider = process.env.VIDEO_PROVIDER || 'seedance';
  if (rawProvider === 'fallback_video' || rawProvider === 'runway') {
    return 'sora2';
  }
  return rawProvider;
}

function isNodeTestRuntime() {
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

function normalizeStringList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

async function createEmptyProviderRun() {
  return {
    results: [],
    report: {
      status: 'pass',
      warnings: [],
      blockers: [],
    },
  };
}

function normalizeRuntimeVideoProvider(provider) {
  if (provider === 'fallback_video' || provider === 'runway') {
    return 'sora2';
  }
  return provider;
}

function buildVideoClipBridge(videoResults = [], shotQaReport = null) {
  const allowedShotIds = shotQaReport?.entries
    ? new Set(
        shotQaReport.entries
          .filter((entry) => entry?.canUseVideo === true || entry?.finalDecision === 'pass' || entry?.finalDecision === 'pass_with_enhancement')
          .map((entry) => entry.shotId)
      )
    : null;

  return (Array.isArray(videoResults) ? videoResults : [])
    .filter((result) => result?.shotId && result?.videoPath)
    .filter((result) => !allowedShotIds || allowedShotIds.has(result.shotId))
    .map((result) => ({
      shotId: result.shotId,
      videoPath: result.videoPath,
      durationSec: result.durationSec || result.targetDurationSec || null,
      status: result.status || 'completed',
      provider: result.provider || result.preferredProvider || getDefaultVideoProvider(),
    }));
}

function buildShotQaInputs(enhancedVideoResults = [], rawVideoResults = []) {
  const rawByShotId = new Map((Array.isArray(rawVideoResults) ? rawVideoResults : []).map((entry) => [entry.shotId, entry]));
  return (Array.isArray(enhancedVideoResults) ? enhancedVideoResults : []).map((entry) => {
    const raw = rawByShotId.get(entry?.shotId) || {};
    return {
      ...entry,
      shotId: entry?.shotId || raw?.shotId || null,
      status: entry?.status || raw?.status || 'unknown',
      videoPath: entry?.enhancedVideoPath || entry?.videoPath || entry?.sourceVideoPath || raw?.videoPath || null,
      targetDurationSec: entry?.targetDurationSec || raw?.targetDurationSec || null,
      actualDurationSec: entry?.actualDurationSec || raw?.actualDurationSec || null,
      performanceTemplate: entry?.performanceTemplate || raw?.performanceTemplate || null,
      preferredProvider: raw?.preferredProvider || raw?.provider || null,
      provider: raw?.provider || raw?.preferredProvider || null,
      failureCategory: entry?.failureCategory || raw?.failureCategory || null,
      reason: entry?.reason || raw?.reason || null,
    };
  });
}

function buildBridgeClipBridge(bridgeShotPlan = [], bridgeClipResults = [], bridgeQaReport = null) {
  const approvedBridgeIds = getApprovedContinuityIds(bridgeQaReport, 'bridgeId');
  const planByBridgeId = new Map((Array.isArray(bridgeShotPlan) ? bridgeShotPlan : []).map((entry) => [entry.bridgeId, entry]));

  if (approvedBridgeIds.size === 0) {
    return [];
  }

  return (Array.isArray(bridgeClipResults) ? bridgeClipResults : [])
    .filter((result) => result?.bridgeId && result?.videoPath)
    .filter((result) => approvedBridgeIds.has(result.bridgeId))
    .map((result) => {
      const planEntry = planByBridgeId.get(result.bridgeId) || {};
      return {
        bridgeId: result.bridgeId,
        fromShotId: planEntry.fromShotId || null,
        toShotId: planEntry.toShotId || null,
        videoPath: result.videoPath,
        durationSec: result.actualDurationSec || result.targetDurationSec || null,
        finalDecision: 'pass',
      };
    })
    .filter((entry) => entry.fromShotId && entry.toShotId);
}

function buildSequenceClipBridge(actionSequencePlan = [], sequenceClipResults = [], sequenceQaReport = null) {
  const approvedSequenceIds = getApprovedContinuityIds(sequenceQaReport, 'sequenceId');
  const planBySequenceId = new Map(
    (Array.isArray(actionSequencePlan) ? actionSequencePlan : []).map((entry) => [entry.sequenceId, entry])
  );
  const qaBySequenceId = new Map(
    (Array.isArray(sequenceQaReport?.entries) ? sequenceQaReport.entries : []).map((entry) => [entry.sequenceId, entry])
  );

  if (approvedSequenceIds.size === 0) {
    return [];
  }

  return (Array.isArray(sequenceClipResults) ? sequenceClipResults : [])
    .filter((result) => result?.sequenceId && result?.videoPath)
    .filter((result) => approvedSequenceIds.has(result.sequenceId))
    .map((result) => {
      const planEntry = planBySequenceId.get(result.sequenceId) || {};
      const qaEntry = qaBySequenceId.get(result.sequenceId) || {};
      const coveredShotIds = Array.isArray(qaEntry.coveredShotIds) && qaEntry.coveredShotIds.length > 0
        ? qaEntry.coveredShotIds
        : (Array.isArray(result.coveredShotIds) && result.coveredShotIds.length > 0
          ? result.coveredShotIds
          : Array.isArray(planEntry.shotIds)
            ? planEntry.shotIds
            : []);

      return {
        sequenceId: result.sequenceId,
        coveredShotIds,
        videoPath: result.videoPath,
        durationSec: result.actualDurationSec || result.targetDurationSec || planEntry.durationTargetSec || null,
        finalDecision: 'pass',
        provider: result.provider || planEntry.preferredProvider || getDefaultVideoProvider(),
      };
    })
    .filter((entry) => entry.coveredShotIds.length > 0);
}

function filterBridgeClipsAgainstSequences(bridgeClips = [], sequenceClips = []) {
  const shotToSequenceId = new Map();
  for (const sequenceClip of Array.isArray(sequenceClips) ? sequenceClips : []) {
    for (const shotId of Array.isArray(sequenceClip?.coveredShotIds) ? sequenceClip.coveredShotIds : []) {
      shotToSequenceId.set(shotId, sequenceClip.sequenceId);
    }
  }

  return (Array.isArray(bridgeClips) ? bridgeClips : []).filter((bridgeClip) => {
    const fromSequenceId = shotToSequenceId.get(bridgeClip?.fromShotId) || null;
    const toSequenceId = shotToSequenceId.get(bridgeClip?.toShotId) || null;
    return !(fromSequenceId && fromSequenceId === toSequenceId);
  });
}

function getCompletedContinuityIds(results = [], idKey) {
  return (Array.isArray(results) ? results : [])
    .filter((entry) => entry?.[idKey] && entry?.status === 'completed' && entry?.videoPath)
    .map((entry) => entry[idKey]);
}

function getApprovedContinuityIds(report = null, idKey) {
  return new Set(
    (Array.isArray(report?.entries) ? report.entries : [])
      .filter((entry) => entry?.[idKey] && entry?.finalDecision === 'pass')
      .map((entry) => entry[idKey])
  );
}

function isReusableContinuityQaReport(report = null, clipResults = [], idKey) {
  if (!report || !Array.isArray(report.entries)) {
    return false;
  }

  const completedIds = getCompletedContinuityIds(clipResults, idKey);
  if (completedIds.length === 0) {
    return true;
  }

  const evaluatedIds = new Set(
    report.entries
      .filter((entry) => entry?.[idKey])
      .map((entry) => entry[idKey])
  );

  return completedIds.every((id) => evaluatedIds.has(id));
}

function assertContinuityDeliveryGate({
  bridgeShotPlan = [],
  bridgeClipResults = [],
  bridgeQaReport = null,
  actionSequencePlan = [],
  sequenceClipResults = [],
  sequenceQaReport = null,
} = {}) {
  const issues = [];

  const bridgePlanCount = Array.isArray(bridgeShotPlan) ? bridgeShotPlan.length : 0;
  const completedBridgeIds = getCompletedContinuityIds(bridgeClipResults, 'bridgeId');
  if (bridgePlanCount > 0 && !isReusableContinuityQaReport(bridgeQaReport, bridgeClipResults, 'bridgeId')) {
    issues.push('bridge QA 缺失或不完整');
  }
  // Bridge/sequence QA fail should downgrade to the underlying shot path,
  // not dead-stop delivery. Only missing/incomplete QA is a hard gate here.

  const sequencePlanCount = Array.isArray(actionSequencePlan) ? actionSequencePlan.length : 0;
  const completedSequenceIds = getCompletedContinuityIds(sequenceClipResults, 'sequenceId');
  if (sequencePlanCount > 0 && !isReusableContinuityQaReport(sequenceQaReport, sequenceClipResults, 'sequenceId')) {
    issues.push('sequence QA 缺失或不完整');
  }

  if (issues.length > 0) {
    throw new Error(`Continuity delivery gate blocked: ${issues.join('；')}`);
  }
}

function normalizeProjectId(projectId) {
  return projectId ?? null;
}

function buildSequenceCoverageMetrics(actionSequencePlan = [], sequenceClipResults = [], sequenceQaReport = null) {
  const planBySequenceId = new Map(
    (Array.isArray(actionSequencePlan) ? actionSequencePlan : []).map((entry) => [entry.sequenceId, entry])
  );
  const clipBySequenceId = new Map(
    (Array.isArray(sequenceClipResults) ? sequenceClipResults : [])
      .filter((entry) => entry?.sequenceId && entry?.videoPath)
      .map((entry) => [entry.sequenceId, entry])
  );
  const qaEntries = Array.isArray(sequenceQaReport?.entries) ? sequenceQaReport.entries : [];
  const approvedSequenceIds = [];
  const fallbackSequenceIds = new Set();
  const coveredShotIds = new Set();

  for (const entry of qaEntries) {
    if (!entry?.sequenceId) {
      continue;
    }
    const clip = clipBySequenceId.get(entry.sequenceId);
    if (entry.finalDecision === 'pass' && clip?.videoPath) {
      approvedSequenceIds.push(entry.sequenceId);
      const shotIds =
        Array.isArray(entry.coveredShotIds) && entry.coveredShotIds.length > 0
          ? entry.coveredShotIds
          : planBySequenceId.get(entry.sequenceId)?.shotIds || [];
      shotIds.forEach((shotId) => coveredShotIds.add(shotId));
      continue;
    }
    fallbackSequenceIds.add(entry.sequenceId);
  }

  for (const sequenceId of planBySequenceId.keys()) {
    if (!approvedSequenceIds.includes(sequenceId) && !qaEntries.some((entry) => entry?.sequenceId === sequenceId)) {
      fallbackSequenceIds.add(sequenceId);
    }
  }

  return {
    sequence_coverage_shot_count: coveredShotIds.size,
    sequence_coverage_sequence_count: approvedSequenceIds.length,
    applied_sequence_ids: approvedSequenceIds,
    fallback_sequence_ids: [...fallbackSequenceIds],
  };
}

function buildPipelineSummaryMetrics({
  motionPlan,
  videoResults,
  shotQaReport,
  preflightQaReport,
  seedancePromptMetrics,
  actionSequencePlan,
  sequenceClipResults,
  sequenceQaReport,
}) {
  const plannedVideoShotCount = Array.isArray(motionPlan) ? motionPlan.length : 0;
  const generatedVideoShotCount = Array.isArray(videoResults)
    ? videoResults.filter((item) => item?.status === 'completed' && item?.videoPath).length
    : 0;
  const fallbackVideoShotCount = Number.isFinite(shotQaReport?.fallbackCount) ? shotQaReport.fallbackCount : 0;
  const videoProviderBreakdown = Array.isArray(videoResults)
    ? videoResults.reduce((acc, item) => {
        const key = item?.provider || item?.preferredProvider || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    : {};
  const preflightPassCount = Number.isFinite(preflightQaReport?.passCount) ? preflightQaReport.passCount : 0;
  const preflightWarnCount = Number.isFinite(preflightQaReport?.warnCount) ? preflightQaReport.warnCount : 0;
  const preflightBlockCount = Number.isFinite(preflightQaReport?.blockCount) ? preflightQaReport.blockCount : 0;
  const preflightBlockedShotIds = Array.isArray(preflightQaReport?.entries)
    ? preflightQaReport.entries
        .filter((entry) => entry?.decision === 'block' && entry?.shotId)
        .map((entry) => entry.shotId)
    : [];
  const preflightWarnShotIds = Array.isArray(preflightQaReport?.entries)
    ? preflightQaReport.entries
        .filter((entry) => entry?.decision === 'warn' && entry?.shotId)
        .map((entry) => entry.shotId)
    : [];
  const preflightFixBriefCount = Array.isArray(preflightQaReport?.entries)
    ? preflightQaReport.entries.filter((entry) => entry?.decision === 'warn' || entry?.decision === 'block').length
    : 0;
  const inferredCoverageCount = Number.isFinite(seedancePromptMetrics?.inferredCoverageCount)
    ? seedancePromptMetrics.inferredCoverageCount
    : 0;
  const inferredBlockingCount = Number.isFinite(seedancePromptMetrics?.inferredBlockingCount)
    ? seedancePromptMetrics.inferredBlockingCount
    : 0;
  const inferredContinuityCount = Number.isFinite(seedancePromptMetrics?.inferredContinuityCount)
    ? seedancePromptMetrics.inferredContinuityCount
    : 0;
  const seedancePromptPackageCount = Number.isFinite(seedancePromptMetrics?.promptPackageCount)
    ? seedancePromptMetrics.promptPackageCount
    : 0;
  const inferredShotCount = Math.max(inferredCoverageCount, inferredBlockingCount, inferredContinuityCount);
  const inferenceWarnThreshold = seedancePromptPackageCount > 0 ? Math.max(1, Math.ceil(seedancePromptPackageCount * 0.5)) : 0;
  const seedanceInferenceRisk = inferredShotCount >= inferenceWarnThreshold && inferenceWarnThreshold > 0 ? 'warn' : 'pass';
  const inferenceBlockMinShots = Number.parseInt(process.env.SEEDANCE_INFERENCE_BLOCK_MIN_SHOTS || '2', 10);
  const seedanceInferenceDeliveryGate =
    seedanceInferenceRisk === 'warn' && seedancePromptPackageCount >= inferenceBlockMinShots
      ? 'block_formal_delivery'
      : 'allow';
  const plannedSequenceCount = Array.isArray(actionSequencePlan) ? actionSequencePlan.length : 0;
  const generatedSequenceCount = Array.isArray(sequenceClipResults)
    ? sequenceClipResults.filter((item) => item?.status === 'completed' && item?.videoPath).length
    : 0;
  const sequenceFallbackCount = Number.isFinite(sequenceQaReport?.fallbackCount) ? sequenceQaReport.fallbackCount : 0;
  const sequenceProviderBreakdown = Array.isArray(sequenceClipResults)
    ? sequenceClipResults.reduce((acc, item) => {
        const key = item?.provider || item?.preferredProvider || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    : {};
  const sequenceCoverage = buildSequenceCoverageMetrics(actionSequencePlan, sequenceClipResults, sequenceQaReport);

  return {
    planned_video_shot_count: plannedVideoShotCount,
    generated_video_shot_count: generatedVideoShotCount,
    video_provider_breakdown: videoProviderBreakdown,
    fallback_video_shot_count: fallbackVideoShotCount,
    preflight_pass_count: preflightPassCount,
    preflight_warn_count: preflightWarnCount,
    preflight_block_count: preflightBlockCount,
    preflight_warn_shot_ids: preflightWarnShotIds,
    preflight_blocked_shot_ids: preflightBlockedShotIds,
    preflight_fix_brief_count: preflightFixBriefCount,
    inferred_coverage_count: inferredCoverageCount,
    inferred_blocking_count: inferredBlockingCount,
    inferred_continuity_count: inferredContinuityCount,
    inferred_shot_count: inferredShotCount,
    seedance_prompt_package_count: seedancePromptPackageCount,
    seedance_inference_warn_threshold: inferenceWarnThreshold,
    seedance_inference_risk: seedanceInferenceRisk,
    seedance_inference_block_min_shots: inferenceBlockMinShots,
    seedance_inference_delivery_gate: seedanceInferenceDeliveryGate,
    planned_sequence_count: plannedSequenceCount,
    generated_sequence_count: generatedSequenceCount,
    sequence_provider_breakdown: sequenceProviderBreakdown,
    sequence_fallback_count: sequenceFallbackCount,
    ...sequenceCoverage,
  };
}

function createDeliverySummary({
  projectName,
  projectId,
  scriptTitle,
  episodeTitle,
  outputPath,
  runJobId,
  jobId,
  style,
  ttsQaReport,
  lipsyncReport,
  motionPlan,
  videoResults,
  shotQaReport,
  preflightQaReport,
  seedancePromptMetrics,
  actionSequencePlan,
  sequenceClipResults,
  sequenceQaReport,
  composeResult,
  preflightFixBriefArtifact,
}) {
  const pipelineSummary = buildPipelineSummaryMetrics({
    motionPlan,
    videoResults,
    shotQaReport,
    preflightQaReport,
    seedancePromptMetrics,
    actionSequencePlan,
    sequenceClipResults,
    sequenceQaReport,
  });
  const manualReviewShots = Array.isArray(lipsyncReport?.manualReviewShots)
    ? lipsyncReport.manualReviewShots
    : [];
  const ttsManualReviewShots = Array.isArray(ttsQaReport?.manualReviewPlan?.recommendedShotIds)
    ? ttsQaReport.manualReviewPlan.recommendedShotIds
    : [];
  const mergedManualReviewShots = Array.from(new Set([...ttsManualReviewShots, ...manualReviewShots]));
  const downgradedCount = Number.isFinite(lipsyncReport?.downgradedCount)
    ? lipsyncReport.downgradedCount
    : 0;
  const fallbackEntries = Array.isArray(lipsyncReport?.entries)
    ? lipsyncReport.entries.filter((entry) => (lipsyncReport?.fallbackShots || []).includes(entry?.shotId))
    : [];
  const fallbackShots = Array.isArray(lipsyncReport?.fallbackShots) ? lipsyncReport.fallbackShots : [];
  const fallbackCount = Number.isFinite(lipsyncReport?.fallbackCount) ? lipsyncReport.fallbackCount : fallbackShots.length;
  const fallbackSummary = fallbackEntries.length > 0
    ? fallbackEntries
        .map((entry) => `${entry.shotId}:${entry.fallbackFrom || 'unknown'}->${entry.provider || 'unknown'}`)
        .join('；')
    : (fallbackShots.length > 0 ? fallbackShots.join(', ') : '无');
  const composeWarnings = Array.isArray(composeResult?.report?.warnings) ? composeResult.report.warnings : [];
  const composeStatus = composeResult?.status || 'not_run';
  const composeArtifacts = composeResult?.artifacts || null;
  return [
    '# Delivery Summary',
    '',
    `- 项目：${projectName} (${projectId})`,
    `- 剧本：${scriptTitle}`,
    `- 分集：${episodeTitle}`,
    `- 风格：${style}`,
    `- RunJob：${runJobId}`,
    `- Job：${jobId}`,
    `- 成片：${path.basename(outputPath)}`,
    `- Compose Status：${composeStatus}`,
    `- Planned Video Shots：${pipelineSummary.planned_video_shot_count}`,
    `- Generated Video Shots：${pipelineSummary.generated_video_shot_count}`,
    `- Video Provider Breakdown：${Object.keys(pipelineSummary.video_provider_breakdown).length > 0 ? JSON.stringify(pipelineSummary.video_provider_breakdown) : '{}'}`,
    `- Fallback Video Shots：${pipelineSummary.fallback_video_shot_count}`,
    `- Preflight Pass Count：${pipelineSummary.preflight_pass_count}`,
    `- Preflight Warn Count：${pipelineSummary.preflight_warn_count}`,
    `- Preflight Block Count：${pipelineSummary.preflight_block_count}`,
    `- Preflight Warn Shots：${pipelineSummary.preflight_warn_shot_ids.length > 0 ? pipelineSummary.preflight_warn_shot_ids.join(', ') : '无'}`,
    `- Preflight Blocked Shots：${pipelineSummary.preflight_blocked_shot_ids.length > 0 ? pipelineSummary.preflight_blocked_shot_ids.join(', ') : '无'}`,
    `- Preflight Fix Brief Count：${pipelineSummary.preflight_fix_brief_count}`,
    preflightFixBriefArtifact ? `- Preflight Fix Brief Artifact：${preflightFixBriefArtifact}` : '- Preflight Fix Brief Artifact：无',
    `- Seedance Inferred Coverage Count：${pipelineSummary.inferred_coverage_count}`,
    `- Seedance Inferred Blocking Count：${pipelineSummary.inferred_blocking_count}`,
    `- Seedance Inferred Continuity Count：${pipelineSummary.inferred_continuity_count}`,
    `- Seedance Inferred Shot Count：${pipelineSummary.inferred_shot_count}`,
    `- Seedance Inference Risk：${pipelineSummary.seedance_inference_risk}`,
    `- Seedance Inference Delivery Gate：${pipelineSummary.seedance_inference_delivery_gate}`,
    `- Planned Sequences：${pipelineSummary.planned_sequence_count}`,
    `- Generated Sequences：${pipelineSummary.generated_sequence_count}`,
    `- Sequence Provider Breakdown：${Object.keys(pipelineSummary.sequence_provider_breakdown).length > 0 ? JSON.stringify(pipelineSummary.sequence_provider_breakdown) : '{}'}`,
    `- Sequence Fallback Count：${pipelineSummary.sequence_fallback_count}`,
    `- planned_sequence_count: ${pipelineSummary.planned_sequence_count}`,
    `- generated_sequence_count: ${pipelineSummary.generated_sequence_count}`,
    `- sequence_provider_breakdown: ${JSON.stringify(pipelineSummary.sequence_provider_breakdown)}`,
    `- sequence_fallback_count: ${pipelineSummary.sequence_fallback_count}`,
    `- sequence_coverage_shot_count: ${pipelineSummary.sequence_coverage_shot_count}`,
    `- sequence_coverage_sequence_count: ${pipelineSummary.sequence_coverage_sequence_count}`,
    `- applied_sequence_ids: ${pipelineSummary.applied_sequence_ids.length > 0 ? pipelineSummary.applied_sequence_ids.join(', ') : '无'}`,
    `- fallback_sequence_ids: ${pipelineSummary.fallback_sequence_ids.length > 0 ? pipelineSummary.fallback_sequence_ids.join(', ') : '无'}`,
    `- TTS QA：${ttsQaReport?.status || 'not_run'}`,
    `- Lip-sync QA：${lipsyncReport?.status || 'not_run'}`,
    `- 人工抽查建议：${ttsManualReviewShots.length > 0 ? ttsManualReviewShots.join(', ') : '无'}`,
    `- 人工复核镜头：${mergedManualReviewShots.length > 0 ? mergedManualReviewShots.join(', ') : '无'}`,
    `- 降级镜头数：${downgradedCount}`,
    `- Lip-sync Fallback Count：${fallbackCount}`,
    `- Lip-sync Fallback Shots：${fallbackSummary}`,
    ttsQaReport?.warnings?.length
      ? `- TTS Warnings：${ttsQaReport.warnings.join('；')}`
      : '- TTS Warnings：无',
    lipsyncReport?.warnings?.length
      ? `- Lip-sync Warnings：${lipsyncReport.warnings.join('；')}`
      : '- Lip-sync Warnings：无',
    composeWarnings.length > 0
      ? `- Compose Warnings：${composeWarnings.join('；')}`
      : '- Compose Warnings：无',
    composeArtifacts?.composePlanUri ? `- Compose Plan Artifact：${composeArtifacts.composePlanUri}` : '- Compose Plan Artifact：无',
    '',
  ].join('\n');
}

function normalizeComposeResult(composeRun, fallbackOutputPath) {
  if (typeof composeRun === 'string') {
    return {
      status: 'completed',
      outputVideo: {
        uri: composeRun,
      },
      report: {
        warnings: [],
        blockedReasons: [],
      },
      artifacts: null,
    };
  }

  if (composeRun && typeof composeRun === 'object') {
    const outputUri = composeRun?.outputVideo?.uri || fallbackOutputPath;
    return {
      status: composeRun.status || 'completed',
      outputVideo: {
        ...(composeRun.outputVideo || {}),
        uri: outputUri,
      },
      report: {
        warnings: Array.isArray(composeRun?.report?.warnings) ? composeRun.report.warnings : [],
        blockedReasons: Array.isArray(composeRun?.report?.blockedReasons)
          ? composeRun.report.blockedReasons
          : [],
        ...(composeRun.report || {}),
      },
      artifacts: composeRun.artifacts || null,
    };
  }

  return {
    status: 'completed',
    outputVideo: {
      uri: fallbackOutputPath,
    },
    report: {
      warnings: [],
      blockedReasons: [],
    },
    artifacts: null,
  };
}

function buildPreflightTopIssues(preflightQaReport = null) {
  return (Array.isArray(preflightQaReport?.entries) ? preflightQaReport.entries : [])
    .filter((entry) => entry?.decision === 'block' || entry?.decision === 'warn')
    .slice(0, 3)
    .map((entry) => {
      const detail = Array.isArray(entry?.reasonDetails) && entry.reasonDetails.length > 0
        ? entry.reasonDetails.map((item) => `${item.label}，建议：${item.suggestion}`).join('；')
        : (Array.isArray(entry?.reasons) && entry.reasons.length > 0 ? entry.reasons.join(', ') : 'unspecified');
      return `Preflight QA Agent: ${entry.shotId || 'unknown_shot'} ${entry.decision} - ${detail}`;
    });
}

function buildPreflightFixBriefTopIssues(preflightQaReport = null) {
  return (Array.isArray(preflightQaReport?.entries) ? preflightQaReport.entries : [])
    .filter((entry) => entry?.decision === 'block' || entry?.decision === 'warn')
    .slice(0, 2)
    .map((entry) => {
      const firstDetail = Array.isArray(entry?.reasonDetails) && entry.reasonDetails.length > 0 ? entry.reasonDetails[0] : null;
      return `Preflight Fix Brief: ${entry.shotId || 'unknown_shot'} 应优先回修，先处理${firstDetail?.label || '基础约束缺失'}。`;
    });
}

function readSeedancePromptMetrics(loadJSONFn, artifactContext) {
  if (!artifactContext?.agents?.seedancePromptAgent) {
    return null;
  }

  return readJSONSafe(
    loadJSONFn,
    path.join(artifactContext.agents.seedancePromptAgent.metricsDir, 'seedance-prompt-metrics.json'),
    null
  );
}

function normalizeRunDebugText(value) {
  return String(value || '').trim();
}

function buildRunDebugSignals({ runJob = null, stateSnapshot = null, agentSummaries = [] } = {}) {
  const agentTaskRuns = Array.isArray(runJob?.agentTaskRuns) ? runJob.agentTaskRuns : [];
  const stepCounts = new Map();

  for (const taskRun of agentTaskRuns) {
    const step = String(taskRun?.step || '').trim();
    if (!step) {
      continue;
    }
    stepCounts.set(step, (stepCounts.get(step) || 0) + 1);
  }

  const cachedSteps = agentTaskRuns.filter((item) => item?.status === 'cached').map((item) => item.step);
  const skippedSteps = agentTaskRuns.filter((item) => item?.status === 'skipped').map((item) => item.step);
  const failedSteps = agentTaskRuns.filter((item) => item?.status === 'failed').map((item) => item.step);
  const manualReviewSteps = agentTaskRuns.filter((item) => item?.status === 'manual_review').map((item) => item.step);
  const retriedSteps = [...stepCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([step]) => step);
  const failedAgentSummaries = Array.isArray(agentSummaries)
    ? agentSummaries.filter((item) => item?.status === 'block').map((item) => item.agentName || item.agentKey || 'unknown')
    : [];
  const manualReviewAgentSummaries = Array.isArray(agentSummaries)
    ? agentSummaries.filter((item) => {
        if (item?.status !== 'warn') {
          return false;
        }
        const nextActions = Array.isArray(item?.nextActions) ? item.nextActions : [];
        const warningText = `${item.headline || ''} ${item.summary || ''} ${nextActions.join(' ')}`;
        return /人工复核|manual review/i.test(warningText) || Number(item?.metrics?.manualReviewCount || 0) > 0;
      }).map((item) => item.agentName || item.agentKey || 'unknown')
    : [];

  const stopStage =
    failedSteps[0] ||
    failedAgentSummaries[0] ||
    (stateSnapshot?.stoppedBeforeVideoAt ? 'stop_before_video' : '') ||
    '';
  const stopReason =
    normalizeRunDebugText(stateSnapshot?.lastError) ||
    normalizeRunDebugText(runJob?.error) ||
    (stateSnapshot?.stoppedBeforeVideoAt ? 'stopped_before_video' : '') ||
    (stateSnapshot?.pipelineSummary?.seedance_inference_delivery_gate === 'block_formal_delivery'
      ? 'seedance_inference_gate'
      : '') ||
    '';

  return {
    status:
      normalizeRunDebugText(runJob?.status) ||
      (normalizeRunDebugText(stateSnapshot?.lastError) ? 'failed' : normalizeRunDebugText(stateSnapshot?.completedAt) ? 'completed' : 'running'),
    stopStage,
    stopReason,
    whereFailed: stopStage,
    lastError: normalizeRunDebugText(stateSnapshot?.lastError) || normalizeRunDebugText(runJob?.error) || '',
    completedAt: normalizeRunDebugText(stateSnapshot?.completedAt) || normalizeRunDebugText(runJob?.finishedAt) || '',
    failedAt: normalizeRunDebugText(stateSnapshot?.failedAt) || '',
    stoppedBeforeVideoAt: normalizeRunDebugText(stateSnapshot?.stoppedBeforeVideoAt) || '',
    previewOutputPath: normalizeRunDebugText(stateSnapshot?.previewOutputPath) || '',
    cachedSteps,
    skippedSteps,
    retriedSteps,
    manualReviewSteps: [...new Set([...manualReviewSteps, ...manualReviewAgentSummaries])],
    failedSteps: [...new Set([...failedSteps, ...failedAgentSummaries])],
    retriedCount: retriedSteps.length,
  };
}

function buildSeedanceInferenceTopIssues(seedancePromptMetrics = null) {
  if (!seedancePromptMetrics) {
    return [];
  }

  const issues = [];
  if (seedancePromptMetrics.inferredCoverageCount > 0) {
    issues.push(`Seedance Prompt Agent: 有 ${seedancePromptMetrics.inferredCoverageCount} 个镜头的 coverage 依赖系统兜底推断。`);
  }
  if (seedancePromptMetrics.inferredBlockingCount > 0) {
    issues.push(`Seedance Prompt Agent: 有 ${seedancePromptMetrics.inferredBlockingCount} 个镜头的 blocking 依赖系统兜底推断。`);
  }
  if (seedancePromptMetrics.inferredContinuityCount > 0) {
    issues.push(`Seedance Prompt Agent: 有 ${seedancePromptMetrics.inferredContinuityCount} 个镜头的 continuity locks 依赖系统兜底推断。`);
  }
  return issues.slice(0, 2);
}

function isSeedanceInferenceOverThreshold(seedancePromptMetrics = null) {
  if (!seedancePromptMetrics || !Number.isFinite(seedancePromptMetrics.promptPackageCount) || seedancePromptMetrics.promptPackageCount <= 0) {
    return false;
  }

  const inferredShotCount = Math.max(
    Number(seedancePromptMetrics.inferredCoverageCount || 0),
    Number(seedancePromptMetrics.inferredBlockingCount || 0),
    Number(seedancePromptMetrics.inferredContinuityCount || 0)
  );
  const threshold = Math.max(1, Math.ceil(Number(seedancePromptMetrics.promptPackageCount) * 0.5));
  return inferredShotCount >= threshold;
}

function shouldBlockFormalDeliveryForSeedanceInference(pipelineSummary = {}) {
  return pipelineSummary?.seedance_inference_delivery_gate === 'block_formal_delivery';
}

function readJSONSafe(loadJSONFn, filePath, fallback) {
  try {
    const loaded = loadJSONFn(filePath);
    if (loaded !== null && loaded !== undefined) {
      return loaded;
    }
  } catch {
    // fall through to direct file read
  }

  try {
    if (filePath && fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    // ignore
  }

  return fallback;
}

function mapManifestStatusToQaStatus(status) {
  if (status === 'failed') return 'block';
  if (status === 'completed_with_errors') return 'warn';
  if (status === 'completed') return 'pass';
  return 'pending';
}

function collectRunQaOverview(loadJSONFn, artifactContext, options = {}) {
  if (!artifactContext?.agents) {
    return null;
  }

  const runManifest = readJSONSafe(loadJSONFn, artifactContext.manifestPath, null);
  const stateSnapshot = artifactContext.runDir
    ? readJSONSafe(loadJSONFn, path.join(artifactContext.runDir, 'state.snapshot.json'), null)
    : null;
  const runJob = runManifest?.runJobId
    && artifactContext.episodeDir
    ? readJSONSafe(
        loadJSONFn,
        path.join(artifactContext.episodeDir, 'run-jobs', `${runManifest.runJobId}.json`),
        null
      )
    : null;

  const agentNameMap = {
    scriptParser: 'Script Parser',
    characterRegistry: 'Character Registry',
    promptEngineer: 'Prompt Engineer',
    imageGenerator: 'Image Generator',
    consistencyChecker: 'Consistency Checker',
    continuityChecker: 'Continuity Checker',
    ttsAgent: 'TTS Agent',
    ttsQaAgent: 'TTS QA Agent',
    lipsyncAgent: 'Lip-sync Agent',
    motionPlanner: 'Motion Planner',
    performancePlanner: 'Performance Planner',
    videoRouter: 'Video Router',
    runwayVideoAgent: 'Runway Video Agent',
    sora2VideoAgent: 'Fallback Video Adapter',
    fallbackVideoAgent: 'Fallback Video Adapter',
    seedanceVideoAgent: 'Seedance Video Agent',
    motionEnhancer: 'Motion Enhancer',
    shotQaAgent: 'Shot QA Agent',
    bridgeShotPlanner: 'Bridge Shot Planner',
    bridgeShotRouter: 'Bridge Shot Router',
    bridgeClipGenerator: 'Bridge Clip Generator',
    bridgeQaAgent: 'Bridge QA Agent',
    actionSequencePlanner: 'Action Sequence Planner',
    actionSequenceRouter: 'Action Sequence Router',
    sequenceClipGenerator: 'Sequence Clip Generator',
    sequenceQaAgent: 'Sequence QA Agent',
    videoComposer: 'Video Composer',
  };

  const orderedKeys = [
    'scriptParser',
    'characterRegistry',
    'promptEngineer',
    'imageGenerator',
    'consistencyChecker',
    'continuityChecker',
    'ttsAgent',
    'ttsQaAgent',
    'lipsyncAgent',
    'motionPlanner',
    'performancePlanner',
    'videoRouter',
    'runwayVideoAgent',
    'sora2VideoAgent',
    'fallbackVideoAgent',
    'seedanceVideoAgent',
    'motionEnhancer',
    'shotQaAgent',
    'bridgeShotPlanner',
    'bridgeShotRouter',
    'bridgeClipGenerator',
    'bridgeQaAgent',
    'actionSequencePlanner',
    'actionSequenceRouter',
    'sequenceClipGenerator',
    'sequenceQaAgent',
    'videoComposer',
  ];

  const agentSummaries = orderedKeys
    .map((agentKey) => {
      const ctx = artifactContext.agents[agentKey];
      if (!ctx) return null;

      const qaSummary = readJSONSafe(loadJSONFn, path.join(ctx.metricsDir, 'qa-summary.json'), null);
      if (qaSummary) {
        return qaSummary;
      }

      const manifest = readJSONSafe(loadJSONFn, ctx.manifestPath, null);
      if (!manifest || manifest.status === 'pending') {
        return null;
      }

      return {
        agentKey,
        agentName: agentNameMap[agentKey] || agentKey,
        status: mapManifestStatusToQaStatus(manifest.status),
        headline: `执行状态：${manifest.status}`,
        summary: '当前只有执行层信息，尚未生成更详细的小白 QA 摘要。',
        passItems: [],
        warnItems: [],
        blockItems: [],
        nextActions: ['如需详细判断，请继续查看该 agent 的 manifest 和核心产物。'],
        nextAction: '如需详细判断，请继续查看该 agent 的 manifest 和核心产物。',
        evidenceFiles: ['manifest.json'],
        artifacts: [{ path: 'manifest.json', label: 'manifest.json', kind: 'file' }],
        inputSnapshot: null,
        outputSnapshot: null,
        metrics: {},
      };
    })
    .filter(Boolean);

  const passCount = agentSummaries.filter((item) => item.status === 'pass').length;
  const warnCount = agentSummaries.filter((item) => item.status === 'warn').length;
  const blockCount = agentSummaries.filter((item) => item.status === 'block').length;
  const inferenceOverThreshold = isSeedanceInferenceOverThreshold(options.seedancePromptMetrics);
  const releasable = options.releasable ?? blockCount === 0;
  let status = blockCount > 0 ? 'block' : (warnCount > 0 || inferenceOverThreshold) ? 'warn' : 'pass';
  let topIssues = [
    ...agentSummaries
      .filter((item) => item.status === 'block')
      .flatMap((item) => (item.blockItems || []).slice(0, 2).map((issue) => `${item.agentName}: ${issue}`)),
    ...agentSummaries
      .filter((item) => item.status === 'warn')
      .flatMap((item) => (item.warnItems || []).slice(0, 2).map((issue) => `${item.agentName}: ${issue}`)),
    ...normalizeStringList(options.extraTopIssues),
  ].slice(0, 5);

  if (!releasable) {
    status = 'block';
    topIssues = topIssues.length > 0 ? topIssues : ['Director: 本轮运行未完成，当前不能交付'];
  }

  const headline =
    status === 'pass'
      ? '本轮主要 agent 都已达标'
      : status === 'warn'
        ? inferenceOverThreshold && warnCount === 0
          ? '本轮可继续交付，但 Seedance 输入补全占比过高'
          : `本轮可继续交付，但有 ${warnCount} 个 agent 需要留意`
        : `本轮有 ${blockCount} 个 agent 处于阻断状态`;

  const summary =
    status === 'pass'
      ? '核心成果物已经齐备，当前没有明显阻断问题。'
      : status === 'warn'
        ? inferenceOverThreshold && warnCount === 0
          ? '主要链路已经跑通，但过多镜头仍依赖系统自动补导演信息，说明上游输入质量不够稳。'
          : '主要链路已经跑通，但仍有风险项需要研发或人工复查。'
        : '至少有一个关键 agent 未达标，需要先修复后再交付。';

  const summaryWithContext = options.summaryAppend
    ? `${summary} ${options.summaryAppend}`.trim()
    : summary;
  const runDebug = buildRunDebugSignals({
    runJob,
    stateSnapshot,
    agentSummaries,
  });

  return {
    status,
    releasable,
    headline,
    summary: summaryWithContext,
    passCount,
    warnCount,
    blockCount,
    agentSummaries,
    topIssues,
    runDebug,
  };
}

export function createDirector(overrides = {}) {
  const deps = {
    parseScript,
    buildCharacterRegistry,
    generateCharacterRefSheets:
      overrides.generateCharacterRefSheets || (isNodeTestRuntime() ? (async () => []) : generateCharacterRefSheets),
    generateAllPrompts,
    generateAllImages,
    regenerateImage,
    runConsistencyCheck,
    runContinuityCheck,
    normalizeDialogueShots,
    generateAllAudio,
    runTtsQa,
    runLipsync,
    planSceneGrammar,
    planDirectorPacks,
    runPreflightQa,
    planMotion,
    planPerformance,
    routeVideoShots,
    runSeedanceVideo: overrides.runSeedanceVideo || (isNodeTestRuntime() ? createEmptyProviderRun : runSeedanceVideo),
    runSora2Video: overrides.runSora2Video || (isNodeTestRuntime() ? createEmptyProviderRun : runSora2Video),
    runMotionEnhancer,
    runShotQa,
    planBridgeShots,
    routeBridgeShots,
    generateBridgeClips,
    runBridgeQa,
    planActionSequences,
    routeActionSequencePackages,
    generateSequenceClips,
    runSequenceQa,
    composeVideo,
    saveJSON,
    loadJSON,
    initDirs,
    generateJobId,
    readTextFile,
    saveProject,
    saveScript,
    saveEpisode,
    loadProject,
    loadScript,
    loadEpisode,
    createRunJob,
    finishRunJob,
    appendAgentTaskRun,
    listCharacterBibles,
    loadPronunciationLexicon,
    loadVoiceCast,
    ensureProjectVoiceCast,
    loadVoicePreset,
    logger,
    ...overrides,
  };

  const director = {
    async runEpisodePipeline({ projectId, scriptId, episodeId, options = {} }) {
      const style = options.style || process.env.IMAGE_STYLE || 'realistic';
      const jobId = options.jobId || deps.generateJobId(`${scriptId}_${episodeId}`);

      deps.logger.info('Director', `=== 开始任务 ${jobId} ===`);
      deps.logger.info(
        'Director',
        `项目：${projectId} | 剧本：${scriptId} | 分集：${episodeId} | 风格：${style}`
      );

      const dirs = deps.initDirs(jobId);
      const stateFile = path.join(dirs.root, 'state.json');
      const loadedState = deps.loadJSON(stateFile) || {};
      const state = Object.assign(loadedState, initializePhase4SequenceState(loadedState));
      const runStartedAt = options.startedAt || new Date().toISOString();
      let runJobRef = null;
      let runJobCreated = false;
      let taskRunWritesEnabled = true;
      let activeArtifactContext = options.artifactContext || null;

      function saveState(update) {
        Object.assign(state, update);
        deps.saveJSON(stateFile, state);
        if (activeArtifactContext?.runDir) {
          deps.saveJSON(path.join(activeArtifactContext.runDir, 'state.snapshot.json'), state);
        }
      }

      function tryObservabilityWrite(action, label) {
        try {
          action();
          return true;
        } catch (error) {
          deps.logger.error('Director', `观测写入失败，后续将跳过：${label} - ${error.message}`);
          return false;
        }
      }

      try {
        const project = deps.loadProject(projectId, options.storeOptions) || null;
        const script = deps.loadScript(projectId, scriptId, options.storeOptions) || null;
        if (!script) {
          throw new Error(`找不到剧本：${projectId}/${scriptId}`);
        }

        const episode = deps.loadEpisode(projectId, scriptId, episodeId, options.storeOptions) || null;
        if (!episode) {
          throw new Error(`找不到分集：${projectId}/${scriptId}/${episodeId}`);
        }

        const shots = Array.isArray(episode.shots) ? episode.shots : [];
        const characters = Array.isArray(script.characters) ? script.characters : [];
        const mainCharacterTemplates = Array.isArray(script.mainCharacterTemplates)
          ? script.mainCharacterTemplates
          : [];
        const episodeCharacters = Array.isArray(episode.episodeCharacters)
          ? episode.episodeCharacters
          : (Array.isArray(episode.characters) ? episode.characters : []);
        const characterBibles =
          typeof deps.listCharacterBibles === 'function'
            ? deps.listCharacterBibles(projectId, options.storeOptions)
            : [];
        const projectName = project?.name || script?.title || projectId;
        const scriptTitle = script.title || 'untitled_script';
        const episodeTitle = episode.title || `episode_${episodeId}`;
        runJobRef = {
          id: options.runAttemptId || createRunJobAttemptId(jobId),
          projectId,
          scriptId,
          episodeId,
        };
        const artifactContext =
          options.artifactContext ||
          createRunArtifactContext({
            baseTempDir: options.storeOptions?.baseTempDir,
            projectId,
            projectName,
            scriptId,
            scriptTitle,
            episodeId,
            episodeTitle,
            episodeNo: episode.episodeNo,
            runJobId: runJobRef.id,
            startedAt: runStartedAt,
          });
        activeArtifactContext = artifactContext;

        initializeRunArtifacts(artifactContext, {
          projectId,
          projectName,
          scriptId,
          scriptTitle,
          episodeId,
          episodeTitle,
          runJobId: runJobRef.id,
          jobId,
          style,
          startedAt: runStartedAt,
        }, { saveJSON: deps.saveJSON });

        deps.logger.info(
          'Director',
          `剧名：${scriptTitle}，分集：${episodeTitle}，共 ${shots.length} 个分镜，${characters.length} 个角色`
        );

        function appendStepRun(step, payload) {
          if (!runJobCreated || !taskRunWritesEnabled) {
            return;
          }

          const succeeded = tryObservabilityWrite(
            () =>
              deps.appendAgentTaskRun(
                runJobRef,
                {
                  id: `${runJobRef.id}_${step}`,
                  step,
                  agent: 'director',
                  ...payload,
                },
                options.storeOptions
              ),
            `appendAgentTaskRun:${step}`
          );
          if (!succeeded) {
            taskRunWritesEnabled = false;
          }
        }

        runJobCreated = tryObservabilityWrite(
          () =>
            deps.createRunJob(
              {
                ...runJobRef,
                jobId,
                status: 'running',
                style,
                scriptTitle,
                episodeTitle,
                startedAt: runStartedAt,
                artifactRunDir: artifactContext.runDir,
                artifactManifestPath: artifactContext.manifestPath,
                artifactTimelinePath: artifactContext.timelinePath,
              },
              options.storeOptions
            ),
          'createRunJob'
        );

        async function recordStep(step, detail, run) {
          const startedAt = new Date().toISOString();

          try {
            const result = await run();
            appendStepRun(step, {
              status: detail.status || 'completed',
              detail: detail.message,
              startedAt,
              finishedAt: new Date().toISOString(),
            });
            return result;
          } catch (error) {
            appendStepRun(step, {
              status: 'failed',
              detail: detail.message,
              startedAt,
              finishedAt: new Date().toISOString(),
              error: error.message,
            });
            throw error;
          }
        }

        let characterRegistry = state.characterRegistry;
        if (!characterRegistry) {
          deps.logger.info('Director', '【Step 1/6】构建角色档案...');
          characterRegistry = await recordStep(
            'build_character_registry',
            { message: '构建角色档案' },
            () =>
              deps.buildCharacterRegistry(
                episodeCharacters.length > 0 ? episodeCharacters : characters,
                `${scriptTitle}：${buildEpisodeContext(script, episode).slice(0, 500)}`,
                style,
                {
                  artifactContext: artifactContext.agents.characterRegistry,
                  mainCharacterTemplates,
                  episodeCharacters,
                  characterBibles,
                }
              )
          );
          saveState({ characterRegistry });
        } else {
          deps.logger.info('Director', '【Step 1/6】使用缓存的角色档案');
          appendStepRun('build_character_registry', {
            status: 'cached',
            detail: '使用缓存的角色档案',
          });
        }

        let characterRefSheets = Array.isArray(state.characterRefSheets) ? state.characterRefSheets : null;
        if (!characterRefSheets) {
          deps.logger.info('Director', '【Step 1.5】生成角色三视图参考纸...');
          const refSheetResults = await recordStep(
            'generate_character_ref_sheets',
            { message: '生成角色三视图参考纸' },
            () =>
              deps.generateCharacterRefSheets(characterRegistry, path.join(dirs.root, 'character-ref-sheets'), {
                style,
                artifactContext: artifactContext.agents.characterRefSheetGenerator,
              })
          );
          assertCharacterRefSheetsSucceeded(refSheetResults, characterRegistry);
          characterRefSheets = Array.isArray(refSheetResults) ? refSheetResults : [];
          for (const sheet of characterRefSheets) {
            if (!sheet.success || !sheet.imagePath) continue;
            const card =
              findCharacterByIdentity(characterRegistry, sheet.characterId) ||
              findCharacterByIdentityOrName(characterRegistry, sheet.characterName);
            if (card) {
              card.referenceImagePath = sheet.imagePath;
            }
          }
          saveState({ characterRefSheets, characterRegistry });
        } else {
          deps.logger.info('Director', '【Step 1.5】使用缓存的角色三视图参考纸');
          appendStepRun('generate_character_ref_sheets', {
            status: 'cached',
            detail: '使用缓存的角色三视图参考纸',
          });
          for (const sheet of characterRefSheets) {
            if (!sheet.success || !sheet.imagePath) continue;
            const card =
              findCharacterByIdentity(characterRegistry, sheet.characterId) ||
              findCharacterByIdentityOrName(characterRegistry, sheet.characterName);
            if (card && !card.referenceImagePath) {
              card.referenceImagePath = sheet.imagePath;
            }
          }
        }

        let promptList = state.promptList;
        if (!promptList) {
          deps.logger.info('Director', '【Step 2/6】生成图像Prompt...');
          promptList = await recordStep('generate_prompts', { message: '生成图像Prompt' }, () =>
            deps.generateAllPrompts(shots, characterRegistry, style, {
              artifactContext: artifactContext.agents.promptEngineer,
            })
          );
          saveState({ promptList });
        } else {
          deps.logger.info('Director', '【Step 2/6】使用缓存的Prompt列表');
          appendStepRun('generate_prompts', {
            status: 'cached',
            detail: '使用缓存的Prompt列表',
          });
        }

        let imageResults = state.imageResults;
        if (!imageResults) {
          deps.logger.info('Director', '【Step 3/6】生成分镜图像...');
          imageResults = await recordStep('generate_images', { message: '生成分镜图像' }, () =>
            deps.generateAllImages(promptList, dirs.images, {
              style,
              artifactContext: artifactContext.agents.imageGenerator,
            })
          );
          imageResults = imageResults.map((rawResult) => {
            const result = ensureImageResultIdentity(rawResult);
            const shot = shots.find((item) => item.id === result.shotId);
            return { ...result, characters: shot?.characters || [] };
          });
          saveState({ imageResults });
        } else {
          deps.logger.info('Director', '【Step 3/6】使用缓存的图像结果');
          appendStepRun('generate_images', {
            status: 'cached',
            detail: '使用缓存的图像结果',
          });
          if (imageResults.some((result) => !result.characters || !result.keyframeAssetId)) {
            imageResults = imageResults.map((result) => {
              const normalizedResult = ensureImageResultIdentity(result);
              if (normalizedResult.characters) return normalizedResult;
              const shot = shots.find((item) => item.id === normalizedResult.shotId);
              return { ...normalizedResult, characters: shot?.characters || [] };
            });
            saveState({ imageResults });
          }
        }

        for (const card of characterRegistry) {
          if (card.referenceImagePath) continue;
          const charId = resolveCharacterIdentity(card);
          if (!charId) continue;
          const match = imageResults.find(
            (r) =>
              r.success &&
              r.imagePath &&
              (Array.isArray(r.characters) ? r.characters : []).some(
                (c) => resolveCharacterIdentity(c) === charId
              )
          );
          if (match) {
            card.referenceImagePath = match.imagePath;
          }
        }

        if (options.stopAfterImages) {
          deps.logger.info('Director', '🛑 --stop-after-images：已完成图像生成，提前退出');
          saveState({ imageResults, characterRegistry, characterRefSheets });
          return {
            status: 'stopped_after_images',
            imageResults,
            characterRegistry,
            characterRefSheets,
          };
        }

        if (!options.skipConsistencyCheck) {
          if (!state.consistencyCheckDone) {
            deps.logger.info('Director', '【Step 4/7】一致性验证...');
            const { needsRegeneration } = await recordStep(
              'consistency_check',
              { message: '一致性验证' },
              () =>
                deps.runConsistencyCheck(characterRegistry, imageResults, {
                  artifactContext: artifactContext.agents.consistencyChecker,
                })
            );

            if (needsRegeneration.length > 0) {
              deps.logger.info(
                'Director',
                `重新生成 ${needsRegeneration.length} 个一致性不足的镜头...`
              );
              await recordStep(
                'regenerate_inconsistent_images',
                { message: `重生成 ${needsRegeneration.length} 个一致性不足的镜头` },
                async () => {
                  const regenTasks = needsRegeneration.map((item) =>
                    imageQueue.add(async () => {
                      const originalPrompt = promptList.find((prompt) => prompt.shotId === item.shotId);
                      if (!originalPrompt) return null;

                      const adjustedPrompt =
                        `${originalPrompt.image_prompt}, highly consistent character appearance, ` +
                        `${item.suggestion || ''}`;
                      const regeneratedResult = ensureImageResultIdentity(await deps.regenerateImage(
                        item.shotId,
                        adjustedPrompt,
                        originalPrompt.negative_prompt,
                        dirs.images,
                        { style }
                      ));
                      return { item, regeneratedResult };
                    })
                  );
                  const settled = await Promise.allSettled(regenTasks);
                  for (const entry of settled) {
                    if (entry.status !== 'fulfilled' || !entry.value) continue;
                    const { item, regeneratedResult } = entry.value;

                    if (regeneratedResult.success === false) {
                      deps.logger.error(
                        'Director',
                        `一致性重生成失败，保留原图继续流程：${item.shotId} - ${regeneratedResult.error || 'unknown error'}`
                      );
                      continue;
                    }

                    const index = imageResults.findIndex((result) => result.shotId === item.shotId);
                    if (index >= 0) {
                      imageResults[index] = {
                        ...imageResults[index],
                        ...regeneratedResult,
                      };
                    }
                  }
                }
              );
            }

            saveState({ imageResults, consistencyCheckDone: true });
          } else {
            deps.logger.info('Director', '【Step 4/7】使用缓存的一致性检查结果');
            appendStepRun('consistency_check', {
              status: 'cached',
              detail: '使用缓存的一致性检查结果',
            });
          }
        } else {
          deps.logger.info('Director', '【Step 4/7】跳过一致性检查');
          appendStepRun('consistency_check', {
            status: 'skipped',
            detail: '跳过一致性检查',
          });
        }

        const shouldSkipContinuityCheck = options.skipContinuityCheck === true || options.skipConsistencyCheck === true;
        if (!shouldSkipContinuityCheck) {
          if (!state.continuityCheckDone) {
            deps.logger.info('Director', '【Step 5/7】连贯性检查...');
            const continuityResult = await recordStep(
              'continuity_check',
              { message: '连贯性检查' },
              () =>
                deps.runContinuityCheck(shots, imageResults, {
                  artifactContext: artifactContext.agents.continuityChecker,
                })
            );

            const repairAttemptsPath = path.join(
              artifactContext.agents.continuityChecker.outputsDir,
              'repair-attempts.json'
            );
            const repairAttempts = readJSONSafe(deps.loadJSON, repairAttemptsPath, []);
            const flaggedTransitions = Array.isArray(continuityResult.flaggedTransitions)
              ? continuityResult.flaggedTransitions
              : [];

            if (flaggedTransitions.length > 0) {
              deps.logger.info(
                'Director',
                `处理 ${flaggedTransitions.length} 个连贯性问题转场...`
              );

              await recordStep(
                'repair_continuity_transitions',
                { message: `处理 ${flaggedTransitions.length} 个连贯性问题转场` },
                async () => {
                  const repairTasks = flaggedTransitions.map((item) =>
                    imageQueue.add(async () => {
                      if (item.recommendedAction === 'pass') {
                        return {
                          attempt: { shotId: item.shotId, attempted: false, repairMethod: item.repairMethod || null, success: true, reason: 'pass' },
                        };
                      }

                      if (item.recommendedAction === 'manual_review') {
                        return {
                          attempt: { shotId: item.shotId, attempted: false, repairMethod: item.repairMethod || 'manual_review', success: true, reason: 'manual_review' },
                        };
                      }

                      const originalPrompt = promptList.find((prompt) => prompt.shotId === item.shotId);
                      if (!originalPrompt) {
                        return {
                          attempt: { shotId: item.shotId, attempted: true, repairMethod: item.repairMethod || 'prompt_regen', success: false, error: 'missing original prompt' },
                        };
                      }

                      const adjustedPrompt = applyContinuityRepairHints(originalPrompt.image_prompt, item);
                      const regeneratedResult = ensureImageResultIdentity(
                        await deps.regenerateImage(
                          item.shotId,
                          adjustedPrompt,
                          originalPrompt.negative_prompt,
                          dirs.images,
                          { style }
                        )
                      );

                      if (regeneratedResult.success === false) {
                        deps.logger.error(
                          'Director',
                          `连贯性重生成失败，保留原图继续流程：${item.shotId} - ${regeneratedResult.error || 'unknown error'}`
                        );
                        return {
                          attempt: { shotId: item.shotId, attempted: true, repairMethod: item.repairMethod || 'prompt_regen', success: false, error: regeneratedResult.error || 'unknown error' },
                        };
                      }

                      return { item, regeneratedResult, attempt: { shotId: item.shotId, attempted: true, repairMethod: item.repairMethod || 'prompt_regen', success: true } };
                    })
                  );
                  const settled = await Promise.allSettled(repairTasks);
                  for (const entry of settled) {
                    if (entry.status !== 'fulfilled' || !entry.value) continue;
                    const { item: repairedItem, regeneratedResult, attempt } = entry.value;
                    repairAttempts.push(attempt);

                    if (regeneratedResult && repairedItem) {
                      const shot = shots.find((s) => s.id === repairedItem.shotId);
                      const index = imageResults.findIndex((result) => result.shotId === repairedItem.shotId);
                      if (index >= 0) {
                        imageResults[index] = {
                          ...imageResults[index],
                          ...regeneratedResult,
                          characters: shot?.characters || imageResults[index]?.characters || [],
                        };
                      }
                    }
                  }
                }
              );
            }

            deps.saveJSON(repairAttemptsPath, repairAttempts);
            saveState({
              imageResults,
              continuityCheckDone: true,
              continuityReport: continuityResult.reports,
              continuityFlaggedTransitions: flaggedTransitions,
            });
          } else {
            deps.logger.info('Director', '【Step 5/7】使用缓存的连贯性检查结果');
            appendStepRun('continuity_check', {
              status: 'cached',
              detail: '使用缓存的连贯性检查结果',
            });
          }
        } else {
          deps.logger.info('Director', '【Step 5/7】跳过连贯性检查');
          appendStepRun('continuity_check', {
            status: 'skipped',
            detail: '跳过连贯性检查',
          });
        }

        const bridgeStateUpdates = {};
        if (!state.hasOwnProperty('bridgeShotPlan')) {
          bridgeStateUpdates.bridgeShotPlan = [];
        }
        if (!state.hasOwnProperty('bridgeShotPackages')) {
          bridgeStateUpdates.bridgeShotPackages = [];
        }
        if (!state.hasOwnProperty('bridgeClipResults')) {
          bridgeStateUpdates.bridgeClipResults = [];
        }
        if (!state.hasOwnProperty('bridgeQaReport')) {
          bridgeStateUpdates.bridgeQaReport = null;
        }
        if (Object.keys(bridgeStateUpdates).length > 0) {
          saveState(bridgeStateUpdates);
        }
        let scenePacks = Array.isArray(state.scenePacks) ? state.scenePacks : null;
        if (!scenePacks) {
          deps.logger.info('Director', '【Step 6/14】提炼场景语法...');
          scenePacks = await recordStep('plan_scene_grammar', { message: '提炼场景语法' }, () =>
            deps.planSceneGrammar(shots)
          );
          saveState({ scenePacks });
        } else {
          deps.logger.info('Director', '【Step 6/14】使用缓存的场景语法结果');
          appendStepRun('plan_scene_grammar', {
            status: 'cached',
            detail: '使用缓存的场景语法结果',
          });
        }
        let directorPacks = Array.isArray(state.directorPacks) ? state.directorPacks : null;
        if (!directorPacks) {
          deps.logger.info('Director', '【Step 7/15】生成导演包...');
          directorPacks = await recordStep('plan_director_packs', { message: '生成导演包' }, () =>
            deps.planDirectorPacks(scenePacks, { shots })
          );
          saveState({ directorPacks });
        } else {
          deps.logger.info('Director', '【Step 7/15】使用缓存的导演包结果');
          appendStepRun('plan_director_packs', {
            status: 'cached',
            detail: '使用缓存的导演包结果',
          });
        }
        let motionPlan = Array.isArray(state.motionPlan) ? state.motionPlan : null;
        if (!motionPlan) {
          deps.logger.info('Director', '【Step 8/15】规划动态镜头...');
          motionPlan = await recordStep('plan_motion', { message: '规划动态镜头' }, () =>
            deps.planMotion(shots, {
              artifactContext: artifactContext.agents.motionPlanner,
            })
          );
          saveState({ motionPlan });
        } else {
          deps.logger.info('Director', '【Step 6/11】使用缓存的动态镜头规划');
          appendStepRun('plan_motion', {
            status: 'cached',
            detail: '使用缓存的动态镜头规划',
          });
        }

        let performancePlan = Array.isArray(state.performancePlan) ? state.performancePlan : null;
        if (!performancePlan) {
          deps.logger.info('Director', '【Step 9/15】规划镜头表演...');
          performancePlan = await recordStep('plan_performance', { message: '规划镜头表演' }, () =>
            deps.planPerformance(motionPlan, {
              artifactContext: artifactContext.agents.performancePlanner,
            })
          );
          saveState({ performancePlan });
        } else {
          deps.logger.info('Director', '【Step 7/13】使用缓存的镜头表演规划');
          appendStepRun('plan_performance', {
            status: 'cached',
            detail: '使用缓存的镜头表演规划',
          });
        }

        let shotPackages = Array.isArray(state.shotPackages) ? state.shotPackages : null;
        if (!shotPackages) {
          deps.logger.info('Director', '【Step 10/15】路由视频镜头...');
          const requestedVideoProvider = getDefaultVideoProvider();
          shotPackages = await recordStep('route_video_shots', { message: '路由视频镜头' }, () =>
            deps.routeVideoShots(shots, motionPlan, imageResults, {
              videoProvider: requestedVideoProvider,
              performancePlan,
              promptList,
              scenePacks,
              directorPacks,
              characterRegistry,
              seedancePromptArtifactContext: artifactContext.agents.seedancePromptAgent,
              artifactContext: artifactContext.agents.videoRouter,
            })
          );
          saveState({ shotPackages });
        } else {
          deps.logger.info('Director', '【Step 7/11】使用缓存的视频路由结果');
          appendStepRun('route_video_shots', {
            status: 'cached',
            detail: '使用缓存的视频路由结果',
          });
        }
        let preflightShotPackages = Array.isArray(state.preflightShotPackages) ? state.preflightShotPackages : null;
        let preflightQaReport = state.preflightQaReport || null;
        if (!preflightShotPackages || !preflightQaReport) {
          deps.logger.info('Director', '【Step 10.5/15】生成前质检...');
          const preflightRun = await recordStep('preflight_qa', { message: '生成前质检' }, () =>
            deps.runPreflightQa(shotPackages, {
              artifactContext: artifactContext.agents.preflightQaAgent,
            })
          );
          preflightShotPackages = Array.isArray(preflightRun?.reviewedPackages) ? preflightRun.reviewedPackages : shotPackages;
          preflightQaReport = preflightRun?.report || null;
          saveState({ preflightShotPackages, preflightQaReport });
        } else {
          deps.logger.info('Director', '【Step 10.5/15】使用缓存的生成前质检结果');
          appendStepRun('preflight_qa', {
            status: 'cached',
            detail: '使用缓存的生成前质检结果',
          });
        }

        if (options.stopBeforeVideo) {
          deps.logger.info('Director', '🛑 --stop-before-video：已完成预飞检，提前退出到视频生成前');
          const stopBeforeVideoSummary = buildPipelineSummaryMetrics({
            motionPlan,
            videoResults: [],
            shotQaReport: null,
            preflightQaReport,
            seedancePromptMetrics: readSeedancePromptMetrics(deps.loadJSON, artifactContext),
            actionSequencePlan,
            sequenceClipResults: [],
            sequenceQaReport: null,
          });
          writeRunQaOverview(
            collectRunQaOverview(deps.loadJSON, artifactContext, {
              releasable: false,
              seedancePromptMetrics: readSeedancePromptMetrics(deps.loadJSON, artifactContext),
              extraTopIssues: [
                ...buildPreflightTopIssues(preflightQaReport),
                ...buildPreflightFixBriefTopIssues(preflightQaReport),
                'Director: 已按要求停止在视频生成前，未触发任何视频 API 调用。',
              ],
              summaryAppend: '当前只完成到预飞检阶段，后续视频生成尚未执行。',
            }),
            artifactContext
          );
          saveState({
            pipelineSummary: stopBeforeVideoSummary,
            stoppedBeforeVideoAt: new Date().toISOString(),
          });
          return {
            status: 'stopped_before_video',
            pipelineSummary: stopBeforeVideoSummary,
            preflightQaReport,
            motionPlan,
            shotPackages,
            characterRegistry,
          };
        }

        let rawVideoResults = Array.isArray(state.rawVideoResults) ? state.rawVideoResults : null;
        if (!rawVideoResults) {
          deps.logger.info('Director', '【Step 11/15】生成动态镜头...');
          const videoRun = await recordStep('generate_video_clips', { message: '生成动态镜头' }, () =>
            (async () => {
              const videoDir = dirs.video || path.join(dirs.root, 'video');
              const requestedVideoProvider = getDefaultVideoProvider();
              const requestedProviders = new Set(
                (Array.isArray(preflightShotPackages) ? preflightShotPackages : [])
                  .map((item) => normalizeRuntimeVideoProvider(item?.preferredProvider))
                  .filter((provider) => provider && provider !== 'static_image')
              );
              const shouldRunProvider = (provider) => requestedProviders.size > 0 && requestedProviders.has(provider);
              const providersToRun = [];

              if (shouldRunProvider('seedance')) {
                providersToRun.push({
                  provider: 'seedance',
                  runner: deps.runSeedanceVideo,
                  artifactContext: artifactContext.agents.seedanceVideoAgent,
                });
              }

              if (shouldRunProvider('sora2')) {
                providersToRun.push({
                  provider: 'sora2',
                  runner: deps.runSora2Video,
                  artifactContext: artifactContext.agents.sora2VideoAgent,
                });
              }

              if (requestedProviders.size === 0) {
                return {
                  results: [],
                  report: {
                    status: 'pass',
                  },
                };
              }

              const settled = await Promise.allSettled(
                providersToRun.map((providerRun) =>
                  providerRun.runner(preflightShotPackages, videoDir, {
                    artifactContext: providerRun.artifactContext,
                  })
                )
              );
              const runResults = [];
              for (const entry of settled) {
                if (entry.status === 'fulfilled') {
                  runResults.push(entry.value);
                } else {
                  deps.logger.error(
                    'Director',
                    `Provider 执行失败: ${entry.reason?.message || entry.reason}`
                  );
                }
              }

              return {
                results: runResults.flatMap((item) => (Array.isArray(item?.results) ? item.results : [])),
                report: {
                  status: runResults.some((item) => item?.report?.status === 'warn') ? 'warn' : 'pass',
                },
              };
            })()
          );
          rawVideoResults = Array.isArray(videoRun?.results) ? videoRun.results : [];
          saveState({ rawVideoResults });
        } else {
          deps.logger.info('Director', '【Step 9/13】使用缓存的动态镜头结果');
          appendStepRun('generate_video_clips', {
            status: 'cached',
            detail: '使用缓存的动态镜头结果',
          });
        }

        let enhancedVideoResults = Array.isArray(state.enhancedVideoResults) ? state.enhancedVideoResults : null;
        if (!enhancedVideoResults) {
          deps.logger.info('Director', '【Step 10/13】增强动态镜头...');
          enhancedVideoResults = await recordStep('enhance_video_clips', { message: '增强动态镜头' }, () =>
            deps.runMotionEnhancer(rawVideoResults, preflightShotPackages || shotPackages, {
              artifactContext: artifactContext.agents.motionEnhancer,
            })
          );
          saveState({ enhancedVideoResults });
        } else {
          deps.logger.info('Director', '【Step 10/13】使用缓存的镜头增强结果');
          appendStepRun('enhance_video_clips', {
            status: 'cached',
            detail: '使用缓存的镜头增强结果',
          });
        }

        let shotQaReport = state.shotQaReportV2 || state.shotQaReport || null;
        let videoResults = Array.isArray(state.videoResults) ? state.videoResults : null;
        if (!shotQaReport || !videoResults) {
          deps.logger.info('Director', '【Step 11/13】镜头级 QA...');
          const shotQaInputs = buildShotQaInputs(enhancedVideoResults, rawVideoResults);
          shotQaReport = await recordStep('shot_qa', { message: '镜头级 QA' }, () =>
            deps.runShotQa(shotQaInputs, {
              artifactContext: artifactContext.agents.shotQaAgent,
            })
          );
          const approvedShotIds = new Set(
            (shotQaReport?.entries || [])
              .filter((entry) => entry?.canUseVideo === true || entry?.finalDecision === 'pass' || entry?.finalDecision === 'pass_with_enhancement')
              .map((entry) => entry.shotId)
          );
          const rawVideoResultByShotId = new Map(
            (rawVideoResults || []).map((result) => [result.shotId, result])
          );
          videoResults = (enhancedVideoResults || [])
            .filter((result) => approvedShotIds.has(result.shotId))
            .map((result) => {
              const rawResult = rawVideoResultByShotId.get(result.shotId);
              return {
                shotId: result.shotId,
                provider: rawResult?.provider || rawResult?.preferredProvider || getDefaultVideoProvider(),
                status: result.status,
                videoPath: result.enhancedVideoPath || result.videoPath || result.sourceVideoPath || null,
                targetDurationSec: result.targetDurationSec || rawResult?.targetDurationSec || null,
                durationSec:
                  result.actualDurationSec ||
                  result.targetDurationSec ||
                  rawResult?.actualDurationSec ||
                  rawResult?.targetDurationSec ||
                  null,
                enhancementApplied: Boolean(result.enhancementApplied),
                enhancementProfile: result.enhancementProfile || 'none',
              };
            });
          saveState({ shotQaReport, shotQaReportV2: shotQaReport, videoResults });
        } else {
          deps.logger.info('Director', '【Step 11/13】使用缓存的镜头级 QA 结果');
          appendStepRun('shot_qa', {
            status: 'cached',
            detail: '使用缓存的镜头级 QA 结果',
          });
        }

        const hasCompletedBridgeCache = isReusableContinuityQaReport(
          state.bridgeQaReport,
          state.bridgeClipResults,
          'bridgeId'
        );
        let bridgeShotPlan =
          Array.isArray(state.bridgeShotPlan) && hasCompletedBridgeCache ? state.bridgeShotPlan : null;
        if (!bridgeShotPlan) {
          deps.logger.info('Director', '【Step 11a/13】规划桥接镜头...');
          bridgeShotPlan = await recordStep('plan_bridge_shots', { message: '规划桥接镜头' }, () =>
            deps.planBridgeShots(shots, {
              continuityFlaggedTransitions: state.continuityFlaggedTransitions || [],
              continuityReport: state.continuityReport || [],
              motionPlan,
              performancePlan,
              imageResults,
              videoResults,
              artifactContext: artifactContext.agents.bridgeShotPlanner,
            })
          );
          saveState({ bridgeShotPlan });
        } else {
          deps.logger.info('Director', '【Step 11a/13】使用缓存的桥接镜头规划');
          appendStepRun('plan_bridge_shots', {
            status: 'cached',
            detail: '使用缓存的桥接镜头规划',
          });
        }

        let bridgeShotPackages =
          Array.isArray(state.bridgeShotPackages) && hasCompletedBridgeCache ? state.bridgeShotPackages : null;
        if (!bridgeShotPackages) {
          deps.logger.info('Director', '【Step 11b/13】路由桥接镜头...');
          bridgeShotPackages = await recordStep('route_bridge_shots', { message: '路由桥接镜头' }, () =>
            deps.routeBridgeShots(bridgeShotPlan, {
              imageResults,
              videoResults,
              performancePlan,
              artifactContext: artifactContext.agents.bridgeShotRouter,
            })
          );
          saveState({ bridgeShotPackages });
        } else {
          deps.logger.info('Director', '【Step 11b/13】使用缓存的桥接镜头路由');
          appendStepRun('route_bridge_shots', {
            status: 'cached',
            detail: '使用缓存的桥接镜头路由',
          });
        }

        let bridgeClipResults =
          Array.isArray(state.bridgeClipResults) && hasCompletedBridgeCache ? state.bridgeClipResults : null;
        if (!bridgeClipResults) {
          deps.logger.info('Director', '【Step 11c/13】生成桥接片段...');
          const bridgeClipRun = await recordStep('generate_bridge_clips', { message: '生成桥接片段' }, () =>
            deps.generateBridgeClips(
              bridgeShotPackages,
              dirs.video || path.join(dirs.root, 'video'),
              {
                artifactContext: artifactContext.agents.bridgeClipGenerator,
              }
            )
          );
          bridgeClipResults = Array.isArray(bridgeClipRun?.results) ? bridgeClipRun.results : [];
          saveState({ bridgeClipResults });
        } else {
          deps.logger.info('Director', '【Step 11c/13】使用缓存的桥接片段结果');
          appendStepRun('generate_bridge_clips', {
            status: 'cached',
            detail: '使用缓存的桥接片段结果',
          });
        }

        let bridgeQaReport = state.bridgeQaReport || null;
        if (!bridgeQaReport) {
          deps.logger.info('Director', '【Step 11d/13】桥接片段 QA...');
          bridgeQaReport = await recordStep('bridge_qa', { message: '桥接片段 QA' }, () =>
            deps.runBridgeQa(bridgeClipResults, {
              bridgeShotPlan,
              artifactContext: artifactContext.agents.bridgeQaAgent,
            })
          );
          saveState({ bridgeQaReport });
        } else {
          deps.logger.info('Director', '【Step 11d/13】使用缓存的桥接片段 QA 结果');
          appendStepRun('bridge_qa', {
            status: 'cached',
            detail: '使用缓存的桥接片段 QA 结果',
          });
        }

        const hasCompletedSequenceCache = isReusableContinuityQaReport(
          state.sequenceQaReport,
          state.sequenceClipResults,
          'sequenceId'
        );
        let actionSequencePlan =
          Array.isArray(state.actionSequencePlan) && hasCompletedSequenceCache ? state.actionSequencePlan : null;
        if (!actionSequencePlan) {
          deps.logger.info('Director', '【Step 11e/13】规划连续动作段...');
          actionSequencePlan = await recordStep('plan_action_sequences', { message: '规划连续动作段' }, () =>
            deps.planActionSequences(shots, {
              motionPlan,
              performancePlan,
              shotQaReport,
              bridgeQaReport,
              bridgeShotPlan,
              videoResults,
              continuityReport: state.continuityReport || [],
              continuityFlaggedTransitions: state.continuityFlaggedTransitions || [],
              artifactContext: artifactContext.agents.actionSequencePlanner,
            })
          );
          saveState({ actionSequencePlan });
        } else {
          deps.logger.info('Director', '【Step 11e/13】使用缓存的连续动作段规划');
          appendStepRun('plan_action_sequences', {
            status: 'cached',
            detail: '使用缓存的连续动作段规划',
          });
        }

        let actionSequencePackages =
          Array.isArray(state.actionSequencePackages) && hasCompletedSequenceCache ? state.actionSequencePackages : null;
        if (!actionSequencePackages) {
          deps.logger.info('Director', '【Step 11f/13】路由连续动作段...');
          actionSequencePackages = await recordStep('route_action_sequences', { message: '路由连续动作段' }, () =>
            deps.routeActionSequencePackages(actionSequencePlan, {
              imageResults,
              videoResults,
              bridgeClipResults,
              performancePlan,
              artifactContext: artifactContext.agents.actionSequenceRouter,
            })
          );
          saveState({ actionSequencePackages });
        } else {
          deps.logger.info('Director', '【Step 11f/13】使用缓存的连续动作段路由');
          appendStepRun('route_action_sequences', {
            status: 'cached',
            detail: '使用缓存的连续动作段路由',
          });
        }

        let sequenceClipResults =
          Array.isArray(state.sequenceClipResults) && hasCompletedSequenceCache ? state.sequenceClipResults : null;
        if (!sequenceClipResults) {
          deps.logger.info('Director', '【Step 11g/13】生成连续动作段片段...');
          const sequenceClipRun = await recordStep('generate_sequence_clips', { message: '生成连续动作段片段' }, () =>
            deps.generateSequenceClips(
              actionSequencePackages,
              dirs.video || path.join(dirs.root, 'video'),
              {
                artifactContext: artifactContext.agents.sequenceClipGenerator,
              }
            )
          );
          sequenceClipResults = Array.isArray(sequenceClipRun?.results) ? sequenceClipRun.results : [];
          saveState({ sequenceClipResults });
        } else {
          deps.logger.info('Director', '【Step 11g/13】使用缓存的连续动作段片段结果');
          appendStepRun('generate_sequence_clips', {
            status: 'cached',
            detail: '使用缓存的连续动作段片段结果',
          });
        }

        let sequenceQaReport = state.sequenceQaReport || null;
        if (!sequenceQaReport) {
          deps.logger.info('Director', '【Step 11h/13】连续动作段 QA...');
          sequenceQaReport = await recordStep('sequence_qa', { message: '连续动作段 QA' }, () =>
            deps.runSequenceQa(sequenceClipResults, {
              shots,
              videoResults,
              bridgeClipResults,
              actionSequencePlan,
              actionSequencePackages,
              artifactContext: artifactContext.agents.sequenceQaAgent,
            })
          );
          saveState({ sequenceQaReport });
        } else {
          deps.logger.info('Director', '【Step 11h/13】使用缓存的连续动作段 QA 结果');
          appendStepRun('sequence_qa', {
            status: 'cached',
            detail: '使用缓存的连续动作段 QA 结果',
          });
        }

        const voiceProjectId = normalizeProjectId(
          options.voiceProjectId === undefined ? projectId : options.voiceProjectId
        );

        let normalizedShots = Array.isArray(state.normalizedShots) ? state.normalizedShots : null;
        if (!normalizedShots) {
          deps.logger.info('Director', '【Step 12/13】标准化对白...');
          const pronunciationLexiconProjectId = voiceProjectId ?? projectId;
          const pronunciationLexicon = pronunciationLexiconProjectId
            ? deps.loadPronunciationLexicon(
                pronunciationLexiconProjectId,
                options.storeOptions
              )
            : [];
          normalizedShots = await recordStep('normalize_dialogue', { message: '标准化对白' }, () =>
            deps.normalizeDialogueShots(shots, {
              artifactContext: artifactContext.agents.ttsAgent,
              pronunciationLexicon:
                options.pronunciationLexicon || pronunciationLexicon || [],
            })
          );
          saveState({ normalizedShots });
        } else {
          deps.logger.info('Director', '【Step 12/13】使用缓存的对白标准化结果');
          appendStepRun('normalize_dialogue', {
            status: 'cached',
            detail: '使用缓存的对白标准化结果',
          });
        }

        const voiceCast = voiceProjectId
          ? deps.ensureProjectVoiceCast
            ? deps.ensureProjectVoiceCast(voiceProjectId, characterRegistry, options.storeOptions)
            : deps.loadVoiceCast(voiceProjectId, options.storeOptions) || []
          : [];
        const cachedAudioProjectId = normalizeProjectId(state.audioProjectId);
        const audioCacheKey = buildAudioCacheKey({
          normalizedShots,
          voiceProjectId,
          voiceCast,
        });
        const canReuseAudioCache =
          state.audioResults &&
          cachedAudioProjectId === voiceProjectId &&
          state.audioCacheKey === audioCacheKey;
        let audioResults = canReuseAudioCache ? state.audioResults : null;
        let audioVoiceResolution = Array.isArray(state.audioVoiceResolution) ? state.audioVoiceResolution : [];
        if (!audioResults) {
          deps.logger.info('Director', '【Step 13/14】生成配音...');
          const audioOptions = voiceProjectId
            ? {
                projectId: voiceProjectId,
                voiceCast,
                voicePresetLoader: (voicePresetId, loadOptions = {}) =>
                  deps.loadVoicePreset(voiceProjectId, voicePresetId, loadOptions),
              }
            : {};
          audioResults = await recordStep('generate_audio', { message: '生成配音' }, () =>
            deps.generateAllAudio(normalizedShots, characterRegistry, dirs.audio, {
              ...audioOptions,
              artifactContext: artifactContext.agents.ttsAgent,
            })
          );
          audioVoiceResolution = Array.isArray(audioResults.voiceResolution) ? audioResults.voiceResolution : [];
          saveState({ audioResults, audioVoiceResolution, audioProjectId: voiceProjectId, audioCacheKey });
        } else {
          deps.logger.info('Director', '【Step 13/14】使用缓存的音频结果');
          appendStepRun('generate_audio', {
            status: 'cached',
            detail: '使用缓存的音频结果',
          });
          saveState({ audioProjectId: cachedAudioProjectId, audioCacheKey: state.audioCacheKey || audioCacheKey });
        }

        const ttsQaReport = await recordStep('tts_qa', { message: 'TTS 验收' }, async () => {
          const qaResult = await deps.runTtsQa(normalizedShots, audioResults, audioVoiceResolution, {
            artifactContext: artifactContext.agents.ttsQaAgent,
          });
          if (qaResult.status === 'block') {
            throw new Error(`TTS QA 阻断交付：${qaResult.blockers.join('；')}`);
          }
          return qaResult;
        });

        const lipsyncCacheKey = buildLipsyncCacheKey({
          normalizedShots,
          voiceProjectId,
          audioResults,
        });
        const canReuseLipsyncCache =
          Array.isArray(state.lipsyncResults) &&
          state.lipsyncCacheKey === lipsyncCacheKey;
        let lipsyncResults = canReuseLipsyncCache ? state.lipsyncResults : null;
        let lipsyncReport = state.lipsyncReport || null;
        if (!lipsyncResults) {
          deps.logger.info('Director', '【Step 12/13】生成口型同步片段...');
          const lipsyncRun = await recordStep('lipsync', { message: '生成口型同步片段' }, () =>
            deps.runLipsync(normalizedShots, imageResults, audioResults, {
              artifactContext: artifactContext.agents.lipsyncAgent,
            })
          );
          lipsyncResults = Array.isArray(lipsyncRun?.results) ? lipsyncRun.results : [];
          lipsyncReport = lipsyncRun?.report || null;
          saveState({ lipsyncResults, lipsyncReport, lipsyncCacheKey });
        } else {
          deps.logger.info('Director', '【Step 12/13】使用缓存的口型同步结果');
          appendStepRun('lipsync', {
            status: 'cached',
            detail: '使用缓存的口型同步结果',
          });
          saveState({ lipsyncCacheKey: state.lipsyncCacheKey || lipsyncCacheKey });
        }

        if (lipsyncReport?.status === 'block') {
          throw new Error(`Lip-sync QA 阻断交付：${(lipsyncReport.blockers || []).join('；')}`);
        }

        deps.logger.info('Director', '【Step 13/13】合成视频...');
        const outputDir = ensureDir(
          path.join(
            dirs.output,
            buildProjectDirName(projectName, projectId),
            buildEpisodeDirName({ episodeNo: episode.episodeNo, id: episodeId })
          )
        );
        const outputPath = path.join(outputDir, 'final-video.mp4');
        const animationClips = buildAnimationClipBridge(
          imageResults,
          state.animationClips || episode.animationClips || []
        );
        const videoClips = buildVideoClipBridge(videoResults, shotQaReport);
        const sequenceClips = buildSequenceClipBridge(actionSequencePlan, sequenceClipResults, sequenceQaReport);
        const bridgeClips = filterBridgeClipsAgainstSequences(
          buildBridgeClipBridge(bridgeShotPlan, bridgeClipResults, bridgeQaReport),
          sequenceClips
        );

        assertContinuityDeliveryGate({
          bridgeShotPlan,
          bridgeClipResults,
          bridgeQaReport,
          actionSequencePlan,
          sequenceClipResults,
          sequenceQaReport,
        });

        const composeRun = await recordStep('compose_video', { message: '合成视频' }, () =>
          deps.composeVideo(normalizedShots, imageResults, audioResults, outputPath, {
            title: `${scriptTitle} - ${episodeTitle}`,
            sequenceClips,
            videoClips,
            bridgeClips,
            animationClips,
            lipsyncClips: lipsyncResults,
            artifactContext: artifactContext.agents.videoComposer,
            ttsQaReport,
            lipsyncReport,
          })
        );
        const composeResult = normalizeComposeResult(composeRun, outputPath);
        const finalOutputPath = composeResult.outputVideo.uri || outputPath;

        if (composeResult.status === 'blocked' || composeResult.status === 'completed_with_errors') {
          throw new Error(
            `Compose 阻断交付：${(composeResult.report?.blockedReasons || []).join('；') || 'unknown compose block'}`
          );
        }

        const pipelineSummary = buildPipelineSummaryMetrics({
          motionPlan,
          videoResults,
          shotQaReport,
          preflightQaReport,
          seedancePromptMetrics: readSeedancePromptMetrics(deps.loadJSON, artifactContext),
          actionSequencePlan,
          sequenceClipResults,
          sequenceQaReport,
        });
        const seedancePromptMetrics = readSeedancePromptMetrics(deps.loadJSON, artifactContext);
        const deliverySummaryPath = path.join(path.dirname(finalOutputPath), 'delivery-summary.md');
        ensureDir(path.dirname(deliverySummaryPath));
        fs.writeFileSync(
          deliverySummaryPath,
          createDeliverySummary({
            projectName,
            projectId,
            scriptTitle,
            episodeTitle,
            outputPath: finalOutputPath,
            runJobId: runJobRef.id,
            jobId,
            style,
            ttsQaReport,
            lipsyncReport,
            motionPlan,
            videoResults,
            shotQaReport,
            preflightQaReport,
            seedancePromptMetrics,
            preflightFixBriefArtifact: 'runs/' +
              path.basename(artifactContext.runDir) +
              '/' +
              AGENT_ARTIFACT_LAYOUT.preflightQaAgent +
              '/1-outputs/preflight-fix-brief.md',
            actionSequencePlan,
            sequenceClipResults,
            sequenceQaReport,
            composeResult,
          }),
          'utf-8'
        );
        const preflightContextSummary =
          preflightQaReport
            ? `生成前质检结果：pass ${preflightQaReport.passCount || 0}，warn ${preflightQaReport.warnCount || 0}，block ${preflightQaReport.blockCount || 0}。`
            : '';
        const seedanceInferenceSummary =
          seedancePromptMetrics
            ? `Seedance 输入补全：coverage ${seedancePromptMetrics.inferredCoverageCount || 0}，blocking ${seedancePromptMetrics.inferredBlockingCount || 0}，continuity ${seedancePromptMetrics.inferredContinuityCount || 0}。`
            : '';
        if (shouldBlockFormalDeliveryForSeedanceInference(pipelineSummary)) {
          saveState({
            pipelineSummary,
            previewOutputPath: finalOutputPath,
            composeResult,
            deliverySummaryPath,
            failedAt: new Date().toISOString(),
          });
          throw new Error(
            `Seedance 输入补全占比过高，阻止正式交付：${pipelineSummary.inferred_shot_count}/${pipelineSummary.seedance_prompt_package_count} 个镜头依赖系统兜底`
          );
        }
        writeRunQaOverview(
          collectRunQaOverview(deps.loadJSON, artifactContext, {
            releasable: true,
            seedancePromptMetrics,
            extraTopIssues: [
              ...buildPreflightTopIssues(preflightQaReport),
              ...buildPreflightFixBriefTopIssues(preflightQaReport),
              ...buildSeedanceInferenceTopIssues(seedancePromptMetrics),
            ],
            summaryAppend: [preflightContextSummary, seedanceInferenceSummary].filter(Boolean).join(' '),
          }),
          artifactContext
        );

        saveState({
          pipelineSummary,
          outputPath: finalOutputPath,
          composeResult,
          deliverySummaryPath,
          completedAt: new Date().toISOString(),
        });
        if (runJobCreated) {
          tryObservabilityWrite(
            () =>
              deps.finishRunJob(
                runJobRef,
                {
                  status: 'completed',
                },
                options.storeOptions
              ),
            'finishRunJob:completed'
          );
        }
        deps.logger.info('Director', `\n✅ 任务完成！\n   视频路径：${finalOutputPath}`);
        return finalOutputPath;
      } catch (err) {
        deps.logger.error('Director', `任务失败：${err.message}`);
        deps.logger.error('Director', err.stack);
        saveState({ lastError: err.message, failedAt: new Date().toISOString() });
        if (activeArtifactContext) {
          const failedPreflightContextSummary =
            state?.preflightQaReport
              ? `生成前质检结果：pass ${state.preflightQaReport.passCount || 0}，warn ${state.preflightQaReport.warnCount || 0}，block ${state.preflightQaReport.blockCount || 0}。`
              : '';
          const failedSeedancePromptMetrics = readSeedancePromptMetrics(deps.loadJSON, activeArtifactContext);
          const failedSeedanceInferenceSummary =
            failedSeedancePromptMetrics
              ? `Seedance 输入补全：coverage ${failedSeedancePromptMetrics.inferredCoverageCount || 0}，blocking ${failedSeedancePromptMetrics.inferredBlockingCount || 0}，continuity ${failedSeedancePromptMetrics.inferredContinuityCount || 0}。`
              : '';
          writeRunQaOverview(
            collectRunQaOverview(deps.loadJSON, activeArtifactContext, {
              releasable: false,
              seedancePromptMetrics: failedSeedancePromptMetrics,
              extraTopIssues: [
                ...buildPreflightTopIssues(state?.preflightQaReport),
                ...buildPreflightFixBriefTopIssues(state?.preflightQaReport),
                ...buildSeedanceInferenceTopIssues(failedSeedancePromptMetrics),
              ],
              summaryAppend: [failedPreflightContextSummary, failedSeedanceInferenceSummary].filter(Boolean).join(' '),
            }),
            activeArtifactContext
          );
        }
        if (runJobRef && runJobCreated) {
          tryObservabilityWrite(
            () =>
              deps.finishRunJob(
                runJobRef,
                {
                  status: 'failed',
                  error: err.message,
                },
                options.storeOptions
              ),
            'finishRunJob:failed'
          );
        }
        throw err;
      }
    },

    async runPipeline(scriptFilePath, options = {}) {
      const style = options.style || process.env.IMAGE_STYLE || 'realistic';
      const legacy = buildLegacyBridgeIdentity(scriptFilePath);
      const runStartedAt = options.startedAt || new Date().toISOString();
      const runAttemptId = options.runAttemptId || createRunJobAttemptId(legacy.jobId, new Date(runStartedAt));

      deps.logger.info('Director', `=== 开始兼容任务 ${legacy.jobId} ===`);
      deps.logger.info('Director', `剧本：${scriptFilePath} | 风格：${style}`);

      const dirs = deps.initDirs(legacy.jobId);
      const stateFile = path.join(dirs.root, 'state.json');
      const loadedState = deps.loadJSON(stateFile) || {};
      const state = Object.assign(loadedState, initializePhase4SequenceState(loadedState));
      let activeArtifactContext = options.artifactContext || null;

      function saveState(update) {
        Object.assign(state, update);
        deps.saveJSON(stateFile, state);
        if (activeArtifactContext?.runDir) {
          deps.saveJSON(path.join(activeArtifactContext.runDir, 'state.snapshot.json'), state);
        }
      }

      try {
        const scriptText = deps.readTextFile(scriptFilePath);
        const legacyScriptTitle =
          path.basename(scriptFilePath, path.extname(scriptFilePath)) || legacy.scriptId;
        const scriptContentHash = hashContent(scriptText);
        const selectedInputFormat =
          options.inputFormat || options.parseScriptDeps?.inputFormat || LEGACY_DEFAULT_INPUT_FORMAT;
        let bootstrapParserArtifactContext = null;
        const hasCompatibilityInputFormat = Object.prototype.hasOwnProperty.call(
          state.compatibility || {},
          'inputFormat'
        );
        const contentChanged =
          state.compatibility?.scriptContentHash &&
          state.compatibility.scriptContentHash !== scriptContentHash;
        const inputFormatChanged =
          hasCompatibilityInputFormat &&
          state.compatibility.inputFormat !== selectedInputFormat;
        const missingInputFormatMetadataNeedsReparse =
          state.compatibility &&
          !hasCompatibilityInputFormat &&
          selectedInputFormat !== LEGACY_DEFAULT_INPUT_FORMAT;

        if (contentChanged || inputFormatChanged || missingInputFormatMetadataNeedsReparse) {
          for (const key of Object.keys(state)) {
            delete state[key];
          }
        }

        const existingScript =
          deps.loadScript(legacy.projectId, legacy.scriptId, options.storeOptions) || null;
        const existingEpisode =
          deps.loadEpisode(legacy.projectId, legacy.scriptId, legacy.episodeId, options.storeOptions) ||
          null;
        const existingScriptInputFormat = readLegacyInputFormatMetadata(existingScript);
        const existingEpisodeInputFormat = readLegacyInputFormatMetadata(existingEpisode);
        const existingParsedInputFormats =
          [existingScriptInputFormat, existingEpisodeInputFormat].filter(Boolean);
        // Older persisted legacy script/episode records may not have parser metadata.
        // Trust them only for the historical default; non-default formats reparse.
        const canReuseExistingParsedLegacyData =
          existingScript &&
          existingEpisode &&
          existingScript.sourceText === scriptText &&
          (existingParsedInputFormats.length > 0
            ? existingParsedInputFormats.every((inputFormat) => inputFormat === selectedInputFormat)
            : selectedInputFormat === LEGACY_DEFAULT_INPUT_FORMAT &&
              !inputFormatChanged &&
              !missingInputFormatMetadataNeedsReparse);

        let scriptData = state.scriptData;
        if (!scriptData) {
          if (canReuseExistingParsedLegacyData) {
            scriptData = {
              title: existingScript.title,
              characters: existingScript.characters || [],
              shots: existingEpisode.shots || [],
            };
          } else {
            bootstrapParserArtifactContext = createRunArtifactContext({
              baseTempDir: options.storeOptions?.baseTempDir,
              projectId: legacy.projectId,
              projectName: legacyScriptTitle,
              scriptId: legacy.scriptId,
              scriptTitle: legacyScriptTitle,
              episodeId: legacy.episodeId,
              episodeTitle: legacyScriptTitle,
              episodeNo: 1,
              runJobId: runAttemptId,
              startedAt: runStartedAt,
            }).agents.scriptParser;
            scriptData = await deps.parseScript(scriptText, {
              ...options.parseScriptDeps,
              inputFormat: selectedInputFormat,
              artifactContext: bootstrapParserArtifactContext,
            });
          }
        }

        const title = scriptData.title || path.basename(scriptFilePath, path.extname(scriptFilePath));
        const characters = scriptData.characters || [];
        const shots = scriptData.shots || [];
        const finalArtifactContext =
          options.artifactContext ||
          createRunArtifactContext({
            baseTempDir: options.storeOptions?.baseTempDir,
            projectId: legacy.projectId,
            projectName: title,
            scriptId: legacy.scriptId,
            scriptTitle: title,
            episodeId: legacy.episodeId,
            episodeTitle: title,
            episodeNo: 1,
            runJobId: runAttemptId,
            startedAt: runStartedAt,
          });
        activeArtifactContext = finalArtifactContext;

        if (bootstrapParserArtifactContext && !options.artifactContext) {
          adoptAgentArtifacts(
            bootstrapParserArtifactContext,
            finalArtifactContext.agents.scriptParser
          );
        }

        saveState({
          compatibility: {
            mode: 'legacy-script-file',
            scriptFilePath: legacy.resolvedPath,
            scriptContentHash,
            projectId: legacy.projectId,
            scriptId: legacy.scriptId,
            episodeId: legacy.episodeId,
            inputFormat: selectedInputFormat,
          },
          scriptData,
        });

        if (
          !existingScript ||
          !existingEpisode ||
          existingScript.sourceText !== scriptText ||
          !canReuseExistingParsedLegacyData
        ) {
          const project = createProject({
            id: legacy.projectId,
            name: title,
            code: sanitizeFileSegment(path.basename(scriptFilePath, path.extname(scriptFilePath)), 'project'),
            status: 'draft',
          });
          deps.saveProject(project, options.storeOptions);

          const script = createScript({
            id: legacy.scriptId,
            projectId: project.id,
            title,
            sourceText: scriptText,
            characters,
            sourceInputFormat: selectedInputFormat,
            parserMetadata: {
              ...(scriptData.parserMetadata || {}),
              inputFormat: scriptData.parserMetadata?.inputFormat || selectedInputFormat,
            },
            status: 'draft',
          });
          deps.saveScript(project.id, script, options.storeOptions);

          const episode = createEpisode({
            id: legacy.episodeId,
            projectId: project.id,
            scriptId: script.id,
            episodeNo: 1,
            title,
            summary: scriptText.slice(0, 500),
            shots,
            sourceInputFormat: selectedInputFormat,
            parserMetadata: {
              ...(scriptData.parserMetadata || {}),
              inputFormat: scriptData.parserMetadata?.inputFormat || selectedInputFormat,
            },
            status: 'draft',
          });
          deps.saveEpisode(project.id, script.id, episode, options.storeOptions);
        }

        return director.runEpisodePipeline({
          projectId: legacy.projectId,
          scriptId: legacy.scriptId,
          episodeId: legacy.episodeId,
          options: {
            ...options,
            jobId: legacy.jobId,
            startedAt: runStartedAt,
            runAttemptId,
            artifactContext: finalArtifactContext,
            voiceProjectId: options.projectId ?? null,
          },
        });
      } catch (err) {
        deps.logger.error('Director', `任务失败：${err.message}`);
        deps.logger.error('Director', err.stack);
        saveState({ lastError: err.message, failedAt: new Date().toISOString() });
        throw err;
      }
    },
  };

  return director;
}

const director = createDirector();

export function createRunPipeline(overrides = {}) {
  return createDirector(overrides).runPipeline;
}

export const __testables = {
  collectRunQaOverview,
  initializePhase4SequenceState,
  buildShotQaInputs,
  buildBridgeClipBridge,
  buildSequenceClipBridge,
  filterBridgeClipsAgainstSequences,
  isReusableContinuityQaReport,
  assertContinuityDeliveryGate,
};

export const runEpisodePipeline = director.runEpisodePipeline;
export const runPipeline = director.runPipeline;
export default director;
