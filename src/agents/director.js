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
  getContextualShotCharacterCards,
  getShotCharacterCards,
  resolveCharacterIdentity,
} from './characterRegistry.js';
import { applyContinuityRepairHints, generateAllPrompts } from './promptEngineer.js';
import { generateAllImages, regenerateImage } from './imageGenerator.js';
import { generateCharacterRefSheets } from './characterRefSheetGenerator.js';
import { buildCorePropRegistry } from './corePropRegistry.js';
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
import { runVideoGeneration } from './videoGenerationAgent.js';
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
import { buildStoryboardContext } from './storyboardContextAgent.js';
import { runCrossVideoConsistency } from './crossVideoConsistencyAgent.js';
import { runAvPackaging } from './avPackagingAgent.js';
import { runPostComposeReview } from './postComposeReviewAgent.js';
import { createAnimationClip, createKeyframeAsset } from '../domain/assetModel.js';
import { buildCharacterAssetGovernanceReport } from '../domain/characterAssetGovernance.js';
import { createEpisode, createProject, createScript } from '../domain/projectModel.js';
import { fsProjectStore } from '../utils/projectStore.js';
import { ensureDir, generateJobId, initDirs, loadJSON, readTextFile, saveJSON } from '../utils/fileHelper.js';
import { fsRunJobStore } from '../utils/jobStore.js';
import { AGENT_ARTIFACT_LAYOUT, fsArtifactStore } from '../utils/runArtifacts.js';
import { createActionSequencePackage, createActionSequencePlanEntry, createSequenceClipResult, createSequenceQaReport } from '../utils/actionSequenceProtocol.js';
import { listCharacterBibles } from '../utils/characterBibleStore.js';
import { loadPronunciationLexicon } from '../utils/pronunciationLexiconStore.js';
import { writeRunQaOverview } from '../utils/qaSummary.js';
import { writeCharacterAssetGovernanceArtifacts } from '../utils/characterAssetGovernanceArtifacts.js';
import { buildCostGovernanceReport, writeCostGovernanceArtifacts } from '../utils/costGovernance.js';
import { buildHumanReviewQueue, writeHumanReviewQueueArtifacts } from '../utils/humanReviewQueue.js';
import { buildSceneAssetRecords, writeSceneAssetArtifacts } from '../utils/sceneAssetArtifacts.js';
import { ensureProjectVoiceCast, loadVoiceCast } from '../utils/voiceCastStore.js';
import { loadVoicePreset } from '../utils/voicePresetStore.js';
import { buildEpisodeDirName, buildProjectDirName } from '../utils/naming.js';
import { createDefaultBoundStores } from '../utils/storeBindings.js';
import {
  hashContent,
  buildAudioCacheKey,
  buildLipsyncCacheKey,
  normalizeProjectId,
  ensureImageResultIdentity,
  normalizeImageResultsForShots,
  mergeImageResultsByShotId,
  recoverImageResultsFromDisk,
  assertContinuityDeliveryGate,
  buildVideoClipBridge,
  buildShotQaInputs,
  buildBridgeClipBridge,
  buildSequenceClipBridge,
  filterBridgeClipsAgainstSequences,
  isReusableContinuityQaReport,
  getMissingCharacterRefSheetCards,
  mergeCharacterRefSheetResults,
  coerceCharacterRefSheetResults,
  applyCharacterRefSheetPaths,
  buildAnimationClipBridge,
} from '../utils/directorPipelineHelpers.js';
import {
  buildCharacterStableReferencePacks,
  buildShotReferencePayload,
  updateStableReferencePack,
} from '../utils/characterReferenceContracts.js';
import {
  buildSceneStableReferencePacks,
  buildSceneReferencePayload,
  updateSceneStableReferencePack,
} from '../utils/sceneReferenceContracts.js';
import {
  buildPipelineSummaryMetrics,
  createDeliverySummary,
  normalizeComposeResult,
  buildPreflightFixBriefTopIssues,
} from '../utils/directorSummaryBuilders.js';
import {
  HARD_VISUAL_BLOCK_REASON_CODES,
  normalizeStringList,
  buildVisualEligibilityReport,
  buildVisualEligibilityTopIssues,
  buildUpstreamFailureInsights,
  buildUpstreamFailureTopIssues,
  buildExecutionGate,
  buildExecutionGateTopIssues,
  collectHardVisualBlockEntries,
  assertNoHardVisualBlocks,
  buildPreflightTopIssues,
  buildSeedanceInferenceTopIssues,
  isSeedanceInferenceOverThreshold,
  shouldBlockFormalDeliveryForSeedanceInference,
  buildRunDebugSignals,
  readJSONSafe,
  collectRunQaOverview,
} from '../utils/directorObservability.js';
import { runSceneConsistencyPrecheck } from '../utils/sceneConsistencyPrecheck.js';
import logger from '../utils/logger.js';
import { shouldUseExperimentalRuntime } from '../director/runtimeSelection.js';

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

function canReuseExistingParsedLegacyData(existingScript, existingEpisode, selectedInputFormat) {
  if (!existingScript || !existingEpisode) {
    return false;
  }

  const scriptInputFormat = readLegacyInputFormatMetadata(existingScript);
  const episodeInputFormat = readLegacyInputFormatMetadata(existingEpisode);
  const scriptHasInputFormat = Boolean(scriptInputFormat);
  const episodeHasInputFormat = Boolean(episodeInputFormat);

  if (scriptHasInputFormat || episodeHasInputFormat) {
    return (
      scriptHasInputFormat &&
      episodeHasInputFormat &&
      scriptInputFormat === selectedInputFormat &&
      episodeInputFormat === selectedInputFormat
    );
  }

  return false;
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

let runExperimentalEpisodePipelineFacade = async function runExperimentalEpisodePipelineFacade(payload) {
  const runtime = await import('../director/index.js');
  return runtime.createExperimentalRunPipeline()(payload);
};

function createRunJobAttemptId(jobId, now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, '');
  const nonce = randomUUID().replace(/-/g, '').slice(0, 8);
  return `run_${jobId}_${timestamp}_${nonce}`;
}

function buildVisualEligibilitySummaryText(visualEligibilityReport = null) {
  if (!visualEligibilityReport) {
    return '';
  }
  return `视觉可开工性：pass ${visualEligibilityReport.passCount || 0}，block ${visualEligibilityReport.blockCount || 0}${visualEligibilityReport.blockCount ? `；阻断镜头 ${visualEligibilityReport.blockedShotIds.join('、')}` : ''}。`;
}

function buildUpstreamFailureSummaryText(upstreamFailureInsights = null) {
  if (!upstreamFailureInsights?.matchedCount) {
    return '';
  }
  return `案例记忆：已识别 ${upstreamFailureInsights.matchedCount} 个“missing_reference_stack 与上游生图失败同时出现，应优先排查上游关键帧问题”的镜头。`;
}

function assertCharacterRefSheetsSucceeded(refSheetResults = [], characterRegistry = []) {
  const failedSheets = (Array.isArray(refSheetResults) ? refSheetResults : []).filter((sheet) => {
    if (sheet?.success && sheet?.imagePath) {
      return false;
    }
    if (sheet?.skipped === true || sheet?.readinessStatus === 'skipped') {
      return false;
    }
    return true;
  });

  if (failedSheets.length === 0) {
    return;
  }

  const failedNames = failedSheets
    .map((sheet) => {
      const name = sheet?.characterName || sheet?.characterId || 'unknown';
      if (sheet?.readinessStatus === 'blocked') {
        return `${name}(asset_not_ready)`;
      }
      if (sheet?.failureCategory) {
        return `${name}(${sheet.failureCategory})`;
      }
      return name;
    })
    .join('、');

  const expectedCount = Array.isArray(characterRegistry) ? characterRegistry.length : 0;
  throw new Error(`角色三视图生成失败：${failedSheets.length}/${expectedCount} 个角色未通过，失败角色：${failedNames}`);
}

function assertCharacterAssetGovernancePassed(report = null) {
  const blockedRecords = Array.isArray(report?.records)
    ? report.records.filter((record) => record?.governanceStatus === 'blocked')
    : [];

  if (blockedRecords.length === 0) {
    return;
  }

  const detail = blockedRecords
    .map((record) => {
      const reasons = [...(record?.blockers || []), ...(record?.warnings || [])].filter(Boolean).join('、');
      return `${record?.name || record?.assetId || 'unknown'}(${reasons || '资产治理阻断'})`;
    })
    .join('；');

  throw new Error(`角色资产治理阻断，当前 run 不允许继续出图：${detail}`);
}


function getDefaultVideoProvider() {
  const rawProvider = process.env.VIDEO_PROVIDER || 'seedance';
  if (rawProvider === 'fallback_video') {
    return 'sora2';
  }
  return rawProvider;
}

function isNodeTestRuntime() {
  return Boolean(
    process.env.NODE_TEST_CONTEXT ||
      process.execArgv.includes('--test') ||
      process.argv.includes('--test')
  );
}

function collectReanchorReferenceImages(shotId, shots = [], imageResults = [], characterRegistry = []) {
  const references = [];
  const seen = new Set();
  const shotList = Array.isArray(shots) ? shots : [];
  const shotIndex = shotList.findIndex((entry) => entry?.id === shotId);
  const shot = shotIndex >= 0 ? shotList[shotIndex] : null;
  const shotCharacterCards = shot
    ? getContextualShotCharacterCards(shot, characterRegistry, {
        shotIndex,
        shots: shotList,
        maxCards: 3,
      })
    : [];

  function pushReference(pathValue) {
    const normalized = String(pathValue || '').trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    references.push(normalized);
  }

  for (const card of shotCharacterCards) {
    const referenceImages = Array.isArray(card?.referenceImages) ? card.referenceImages : [];
    for (const referenceImage of referenceImages) {
      pushReference(referenceImage?.path || referenceImage);
    }
    pushReference(card?.referenceImagePath);
  }

  const currentImageResult = (Array.isArray(imageResults) ? imageResults : []).find((entry) => entry?.shotId === shotId);
  pushReference(currentImageResult?.imagePath);

  return references;
}

function attachShotReferenceImagesToPrompts(
  promptList = [],
  shots = [],
  characterRegistry = [],
  stableReferencePacks = [],
  characterRefSheets = [],
  imageResults = [],
  sceneAssetRecords = [],
  sceneStableReferencePacks = [],
) {
  return (Array.isArray(promptList) ? promptList : []).map((prompt) => {
    const shot = (Array.isArray(shots) ? shots : []).find((entry) => entry?.id === prompt?.shotId) || { id: prompt?.shotId };
    const sceneReferencePayload = buildSceneReferencePayload(shot, {
      sceneAssetRecords,
      sceneStableReferencePacks,
    });
    const referencePayload = buildShotReferencePayload(shot, {
      shots,
      characterRegistry,
      stableReferencePacks,
      characterRefSheets,
      imageResults,
      sceneReferenceGroups: sceneReferencePayload.referenceGroups,
    });
    const existingReferences = normalizeStringList(prompt?.referenceImages);
    const mergedReferences = [...new Set([
      ...existingReferences,
      ...referencePayload.referenceImages,
      ...sceneReferencePayload.sceneGenerationContract?.recentStableSceneFrames || [],
    ])];
    return {
      ...prompt,
      referenceImages: mergedReferences,
      referenceGroups: referencePayload.referenceGroups,
      shotCharacterContracts: referencePayload.shotCharacterContracts,
      characterPriority: referencePayload.characterPriority,
      sceneGenerationContract: sceneReferencePayload.sceneGenerationContract,
    };
  });
}

function buildConsistencyRegenerationPrompt(originalPrompt, item = {}) {
  const basePrompt = String(originalPrompt?.image_prompt || '').trim();
  const suggestion = String(item?.suggestion || '').trim();

  if (item?.regenStrategy === 'reanchor_regenerate') {
    return [basePrompt, 'match the anchored character identity from the provided references', suggestion]
      .filter(Boolean)
      .join(', ');
  }

  return [basePrompt, 'highly consistent character appearance', suggestion]
    .filter(Boolean)
    .join(', ');
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
  if (provider === 'fallback_video') {
    return 'sora2';
  }
  return provider;
}

function assertAllShotsHaveApprovedDynamicVideo(shotPackages = [], shotQaReport = null, rawVideoResults = []) {
  const expectedShotIds = (Array.isArray(shotPackages) ? shotPackages : [])
    .map((entry) => entry?.shotId)
    .filter(Boolean);

  if (expectedShotIds.length === 0) {
    return;
  }

  const qaEntryByShotId = new Map(
    (Array.isArray(shotQaReport?.entries) ? shotQaReport.entries : [])
      .filter((entry) => entry?.shotId)
      .map((entry) => [entry.shotId, entry])
  );
  const rawResultByShotId = new Map(
    (Array.isArray(rawVideoResults) ? rawVideoResults : [])
      .filter((entry) => entry?.shotId)
      .map((entry) => [entry.shotId, entry])
  );

  if (qaEntryByShotId.size === 0 && rawResultByShotId.size === 0) {
    return;
  }

  const failedShots = expectedShotIds.flatMap((shotId) => {
    const qaEntry = qaEntryByShotId.get(shotId);
    const rawResult = rawResultByShotId.get(shotId);
    const passed = qaEntry?.canUseVideo === true ||
      qaEntry?.finalDecision === 'pass' ||
      qaEntry?.finalDecision === 'pass_with_enhancement' ||
      (!qaEntry && rawResult?.status === 'completed' && rawResult?.videoPath);

    if (passed) {
      return [];
    }

    const reason = qaEntry?.decisionReason ||
      qaEntry?.reason ||
      rawResult?.failureCategory ||
      rawResult?.error ||
      qaEntry?.finalDecision ||
      rawResult?.status ||
      'dynamic_video_missing';

    return [`${shotId}(${reason})`];
  });

  if (failedShots.length === 0) {
    return;
  }

  throw new Error(`动态视频未全部生成成功，已中断交付：${failedShots.join('；')}`);
}

function assertShotCharacterContractsReady(promptList = []) {
  const blocked = (Array.isArray(promptList) ? promptList : []).flatMap((prompt) => {
    const contracts = Array.isArray(prompt?.shotCharacterContracts) ? prompt.shotCharacterContracts : [];
    return contracts
      .filter((contract) => contract?.contractReady === false && contract?.priority === 'lead')
      .map((contract) => ({
        shotId: prompt.shotId,
        name: contract.characterName || contract.characterId || 'unknown',
        reasons: contract.missingRequirements || [],
      }));
  });
  if (blocked.length === 0) {
    return;
  }
  const detail = blocked
    .map((item) => `${item.shotId}/${item.name}(${item.reasons.join(', ') || 'contract_not_ready'})`)
    .join('；');
  throw new Error(`角色生成合同未就绪，当前 run 不允许继续出图：${detail}`);
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


export function createDirector(overrides = {}) {
  const { projectStore, runJobStore, artifactStore } = createDefaultBoundStores(overrides);
  const deps = {
    parseScript,
    buildCharacterRegistry,
    buildCharacterAssetGovernanceReport,
    writeCharacterAssetGovernanceArtifacts,
    buildCorePropRegistry,
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
    runVideoGeneration: overrides.runVideoGeneration || (isNodeTestRuntime() ? createEmptyProviderRun : runVideoGeneration),
    buildCostGovernanceReport,
    writeCostGovernanceArtifacts,
    buildHumanReviewQueue,
    writeHumanReviewQueueArtifacts,
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
    buildStoryboardContext,
    runCrossVideoConsistency,
    runAvPackaging,
    runPostComposeReview,
    composeVideo,
    saveJSON,
    loadJSON,
    initDirs,
    generateJobId,
    readTextFile,
    projectStore,
    runJobStore,
    artifactStore,
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
      if (shouldUseExperimentalRuntime(options)) {
        return runExperimentalEpisodePipelineFacade({ projectId, scriptId, episodeId, options });
      }
      const normalizedStopAt = typeof options.stopAt === 'string' ? options.stopAt.trim().toLowerCase() : null;
      const normalizedOptions = {
        ...options,
        stopAfterRefSheets:
          options.stopAfterRefSheets === true || normalizedStopAt === 'after_ref_sheets',
        stopAfterImages:
          options.stopAfterImages === true || normalizedStopAt === 'after_images',
        stopBeforeVideo:
          options.stopBeforeVideo === true || normalizedStopAt === 'before_video',
      };
      const style = normalizedOptions.style || process.env.IMAGE_STYLE || 'realistic';
      const jobId = normalizedOptions.jobId || deps.generateJobId(`${scriptId}_${episodeId}`);

      deps.logger.info('Director', `=== 开始任务 ${jobId} ===`);
      deps.logger.info(
        'Director',
        `项目：${projectId} | 剧本：${scriptId} | 分集：${episodeId} | 风格：${style}`
      );

      const dirs = deps.initDirs(jobId);
      const stateFile = path.join(dirs.root, 'state.json');
      const loadedState = deps.loadJSON(stateFile) || {};
      const state = Object.assign(loadedState, initializePhase4SequenceState(loadedState));
      const runStartedAt = normalizedOptions.startedAt || new Date().toISOString();
      let runJobRef = null;
      let runJobCreated = false;
      let taskRunWritesEnabled = true;
      let activeArtifactContext = normalizedOptions.artifactContext || null;

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
        const project =
          deps.projectStore.loadProject(projectId, normalizedOptions.storeOptions) || normalizedOptions.bootstrapProject || null;
        let script =
          deps.projectStore.loadScript(projectId, scriptId, normalizedOptions.storeOptions) || normalizedOptions.bootstrapScript || null;
        if (!script) {
          throw new Error(`找不到剧本：${projectId}/${scriptId}`);
        }

        let episode =
          deps.projectStore.loadEpisode(projectId, scriptId, episodeId, normalizedOptions.storeOptions) ||
          normalizedOptions.bootstrapEpisode ||
          null;
        if (!episode) {
          throw new Error(`找不到分集：${projectId}/${scriptId}/${episodeId}`);
        }

        const characters = Array.isArray(script.characters) ? script.characters : [];
        const mainCharacterTemplates = Array.isArray(script.mainCharacterTemplates)
          ? script.mainCharacterTemplates
          : [];
        const episodeCharacters = Array.isArray(episode.episodeCharacters)
          ? episode.episodeCharacters
          : (Array.isArray(episode.characters) ? episode.characters : []);
        const characterBibles =
          typeof deps.listCharacterBibles === 'function'
            ? deps.listCharacterBibles(projectId, normalizedOptions.storeOptions)
            : [];
        const projectName = project?.name || script?.title || projectId;
        const scriptTitle = script.title || 'untitled_script';
        const episodeTitle = episode.title || `episode_${episodeId}`;
        runJobRef = {
          id: normalizedOptions.runAttemptId || createRunJobAttemptId(jobId),
          projectId,
          scriptId,
          episodeId,
        };
        const artifactContext =
          normalizedOptions.artifactContext ||
          deps.artifactStore.createRunArtifactContext({
            baseTempDir: normalizedOptions.storeOptions?.baseTempDir,
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

        deps.artifactStore.initializeRunArtifacts(artifactContext, {
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

        const shouldRepairEmptyEpisodeShots =
          (!Array.isArray(episode.shots) || episode.shots.length === 0) &&
          typeof script.sourceText === 'string' &&
          script.sourceText.trim().length > 0;

        if (shouldRepairEmptyEpisodeShots) {
          const repairedScriptData = await recordStep(
            'repair_empty_episode_shots',
            { message: '修复空分镜并重新解析剧本' },
            () =>
              deps.parseScript(script.sourceText, {
                artifactContext: artifactContext.agents.scriptParser,
              })
          );
          const repairedCharacters = Array.isArray(repairedScriptData?.characters)
            ? repairedScriptData.characters
            : [];
          const repairedShots = Array.isArray(repairedScriptData?.shots) ? repairedScriptData.shots : [];

          script = {
            ...script,
            title: repairedScriptData?.title || script.title,
            characters: repairedCharacters,
            parserMetadata: repairedScriptData?.parserMetadata
              ? {
                  ...(script.parserMetadata || {}),
                  ...repairedScriptData.parserMetadata,
                }
              : script.parserMetadata,
          };
          episode = {
            ...episode,
            title: repairedScriptData?.title || episode.title,
            shots: repairedShots,
            parserMetadata: repairedScriptData?.parserMetadata
              ? {
                  ...(episode.parserMetadata || {}),
                  ...repairedScriptData.parserMetadata,
                }
              : episode.parserMetadata,
          };

          deps.projectStore.saveScript(projectId, script, normalizedOptions.storeOptions);
          deps.projectStore.saveEpisode(projectId, scriptId, episode, normalizedOptions.storeOptions);
          saveState({
            scriptData: repairedScriptData,
            repairEmptyEpisodeShotsAt: new Date().toISOString(),
          });
        }

        const allShots = Array.isArray(episode.shots) ? episode.shots : [];
        const requestedMaxShots =
          Number.isInteger(normalizedOptions.maxShots) && normalizedOptions.maxShots > 0 ? normalizedOptions.maxShots : null;
        const shots = requestedMaxShots ? allShots.slice(0, requestedMaxShots) : allShots;

        deps.logger.info(
          'Director',
          requestedMaxShots
            ? `剧名：${scriptTitle}，分集：${episodeTitle}，本次抽样运行前 ${shots.length}/${allShots.length} 个分镜，${characters.length} 个角色`
            : `剧名：${scriptTitle}，分集：${episodeTitle}，共 ${shots.length} 个分镜，${characters.length} 个角色`
        );

        function appendStepRun(step, payload) {
          if (!runJobCreated || !taskRunWritesEnabled) {
            return;
          }

          const succeeded = tryObservabilityWrite(
            () =>
              deps.runJobStore.appendAgentTaskRun(
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

        function finalizeExecutionGate(executionGate) {
          const timestamp = new Date().toISOString();
          const skippedReason = executionGate?.reason === 'no_visual_assets' ? 'no_visual_assets' : 'upstream_blocked';
          const normalizedGate = {
            status: executionGate?.status === 'blocked' ? 'blocked' : executionGate?.status || 'pass',
            reason: executionGate?.reason || '',
            blockedShotIds: Array.isArray(executionGate?.blockedShotIds) ? executionGate.blockedShotIds : [],
            stoppedBeforeStage: executionGate?.stoppedBeforeStage || 'generate_video_clips',
            message: executionGate?.message || '',
            source: executionGate?.source || '',
          };
          saveState({
            executionGate: normalizedGate,
            lastError: normalizedGate.message || normalizedGate.reason || null,
            failedAt: timestamp,
            completedAt: null,
          });

          const downstreamSteps = [
            'generate_video_clips',
            'motion_enhancer',
            'shot_qa',
            'bridge_shot_planner',
            'bridge_shot_router',
            'bridge_clip_generator',
            'bridge_qa',
            'action_sequence_planner',
            'action_sequence_router',
            'sequence_clip_generator',
            'sequence_qa',
            'generate_audio',
            'tts_qa',
            'lipsync',
            'cross_video_consistency',
            'av_packaging',
            'compose_video',
            'post_compose_review',
          ];
          for (const step of downstreamSteps) {
            appendStepRun(step, {
              status: 'skipped',
              detail: `上游阻断，未执行（${skippedReason}）`,
              startedAt: timestamp,
              finishedAt: timestamp,
              error: normalizedGate.message || normalizedGate.reason || skippedReason,
            });
          }
          writeRunQaOverview(
            collectRunQaOverview(deps.loadJSON, artifactContext, {
              releasable: false,
              seedancePromptMetrics: readSeedancePromptMetrics(deps.loadJSON, artifactContext),
              extraTopIssues: [
                ...buildExecutionGateTopIssues(normalizedGate),
                ...buildVisualEligibilityTopIssues(state?.visualEligibilityReport),
                ...buildUpstreamFailureTopIssues(state?.upstreamFailureInsights),
                ...buildPreflightTopIssues(state?.preflightQaReport),
                ...buildPreflightFixBriefTopIssues(state?.preflightQaReport),
              ],
              summaryAppend: [
                buildVisualEligibilitySummaryText(state?.visualEligibilityReport),
                buildUpstreamFailureSummaryText(state?.upstreamFailureInsights),
                normalizedGate.message || '',
                '后续视觉与交付阶段均已跳过，未继续空跑。',
              ].filter(Boolean).join(' '),
            }),
            artifactContext
          );
          if (runJobCreated) {
            tryObservabilityWrite(
              () =>
                deps.runJobStore.finishRunJob(
                  runJobRef,
                  {
                    status: 'failed',
                    error: normalizedGate.message || normalizedGate.reason || skippedReason,
                    finishedAt: timestamp,
                  },
                  options.storeOptions
                ),
              'finishRunJob:execution_gate'
            );
          }
          return normalizedGate;
        }

        runJobCreated = tryObservabilityWrite(
          () =>
            deps.runJobStore.createRunJob(
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
        const cachedRefSheets = Array.isArray(characterRefSheets) ? characterRefSheets : [];
        const missingCharacterCards = getMissingCharacterRefSheetCards(
          characterRegistry,
          cachedRefSheets,
          resolveCharacterIdentity
        );
        const refSheetOutputDir = path.join(dirs.root, 'character-ref-sheets');

        if (!characterRefSheets) {
          deps.logger.info('Director', '【Step 1.5】生成角色三视图参考纸...');
          const refSheetResults = await recordStep(
            'generate_character_ref_sheets',
            { message: '生成角色三视图参考纸' },
            () =>
              deps.generateCharacterRefSheets(characterRegistry, refSheetOutputDir, {
                style,
                artifactContext: artifactContext.agents.characterRefSheetGenerator,
              })
          );
          characterRefSheets = coerceCharacterRefSheetResults(refSheetResults, characterRegistry, refSheetOutputDir, {
            isNodeTestRuntime,
            resolveCharacterIdentity,
          });
          saveState({ characterRefSheets, characterRegistry });
          assertCharacterRefSheetsSucceeded(characterRefSheets, characterRegistry);
          applyCharacterRefSheetPaths(characterRegistry, characterRefSheets, {
            findCharacterByIdentity,
            findCharacterByIdentityOrName,
          });
        } else if (missingCharacterCards.length > 0) {
          deps.logger.info(
            'Director',
            `【Step 1.5】复用已成功的角色三视图，补生成 ${missingCharacterCards.length}/${characterRegistry.length} 个失败/缺失角色`
          );
          appendStepRun('generate_character_ref_sheets', {
            status: 'partial_cached',
            detail: `复用已成功的角色三视图，补生成 ${missingCharacterCards.length} 个失败/缺失角色`,
          });
          const regeneratedRefSheets = await recordStep(
            'generate_character_ref_sheets',
            { message: `补生成 ${missingCharacterCards.length} 个失败/缺失角色三视图` },
            () =>
              deps.generateCharacterRefSheets(missingCharacterCards, refSheetOutputDir, {
                style,
                artifactContext: artifactContext.agents.characterRefSheetGenerator,
              })
          );
          characterRefSheets = mergeCharacterRefSheetResults(
            characterRegistry,
            cachedRefSheets,
            coerceCharacterRefSheetResults(regeneratedRefSheets, missingCharacterCards, refSheetOutputDir, {
              isNodeTestRuntime,
              resolveCharacterIdentity,
            }),
            resolveCharacterIdentity
          );
          saveState({ characterRefSheets, characterRegistry });
          assertCharacterRefSheetsSucceeded(characterRefSheets, characterRegistry);
          applyCharacterRefSheetPaths(characterRegistry, characterRefSheets, {
            findCharacterByIdentity,
            findCharacterByIdentityOrName,
          });
        } else {
          deps.logger.info('Director', '【Step 1.5】使用缓存的角色三视图参考纸');
          appendStepRun('generate_character_ref_sheets', {
            status: 'cached',
            detail: '使用缓存的角色三视图参考纸',
          });
          applyCharacterRefSheetPaths(characterRegistry, characterRefSheets, {
            findCharacterByIdentity,
            findCharacterByIdentityOrName,
          });
        }

        const characterAssetGovernanceReport = deps.buildCharacterAssetGovernanceReport({
          projectId,
          scriptId,
          episodeId,
          characterRegistry,
          characterRefSheets,
        });
        deps.writeCharacterAssetGovernanceArtifacts(
          characterAssetGovernanceReport,
          artifactContext.agents.characterAssetGovernance
        );
        saveState({ characterAssetGovernanceReport, characterRegistry });
        assertCharacterAssetGovernancePassed(characterAssetGovernanceReport);

        if (normalizedOptions.stopAfterRefSheets) {
          deps.logger.info('Director', '🛑 --stop-after-ref-sheets：已完成角色参考图，提前退出');
          saveState({ characterRegistry, characterRefSheets, characterAssetGovernanceReport });
          return {
            status: 'stopped_after_ref_sheets',
            characterRegistry,
            characterRefSheets,
            characterAssetGovernanceReport,
          };
        }

        let stableReferencePacks = Array.isArray(state.stableReferencePacks) ? state.stableReferencePacks : null;
        if (!stableReferencePacks || stableReferencePacks.length === 0) {
          stableReferencePacks = buildCharacterStableReferencePacks(characterRegistry, {
            characterRefSheets,
            existingPacks: [],
            runId: jobId,
          });
          saveState({ stableReferencePacks });
        }
        if (artifactContext?.agents?.consistencyChecker?.outputsDir) {
          deps.saveJSON(
            path.join(artifactContext.agents.consistencyChecker.outputsDir, 'character-stable-reference-pack.json'),
            stableReferencePacks
          );
        }
        let sceneStableReferencePacks = Array.isArray(state.sceneStableReferencePacks)
          ? state.sceneStableReferencePacks
          : [];
        if (artifactContext?.agents?.sceneGrammarAgent?.outputsDir && sceneStableReferencePacks.length > 0) {
          deps.saveJSON(
            path.join(artifactContext.agents.sceneGrammarAgent.outputsDir, 'scene-stable-reference-pack.json'),
            sceneStableReferencePacks
          );
        }

        let corePropRegistry = Array.isArray(state.corePropRegistry) ? state.corePropRegistry : null;
        if (!corePropRegistry) {
          corePropRegistry = deps.buildCorePropRegistry(shots, {
            projectId,
            scriptId,
            episodeId,
          });
          saveState({ corePropRegistry });
        }

        let promptList = state.promptList;
        if (!promptList) {
          deps.logger.info('Director', '【Step 2/6】生成图像Prompt...');
          const promptShots = shots.map((shot) => {
            const sceneReferencePayload = buildSceneReferencePayload(shot, {
              sceneAssetRecords: Array.isArray(state.sceneAssetRecords) ? state.sceneAssetRecords : [],
              sceneStableReferencePacks: Array.isArray(state.sceneStableReferencePacks) ? state.sceneStableReferencePacks : [],
            });
            const referencePayload = buildShotReferencePayload(shot, {
              shots,
              characterRegistry,
              stableReferencePacks,
              characterRefSheets,
              imageResults: [],
              sceneReferenceGroups: sceneReferencePayload.referenceGroups,
            });
            return {
              ...shot,
              ...referencePayload,
              sceneGenerationContract: sceneReferencePayload.sceneGenerationContract,
            };
          });
          promptList = await recordStep('generate_prompts', { message: '生成图像Prompt' }, () =>
            deps.generateAllPrompts(promptShots, characterRegistry, style, {
              corePropRegistry,
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
        promptList = attachShotReferenceImagesToPrompts(
          promptList,
          shots,
          characterRegistry,
          stableReferencePacks,
          characterRefSheets,
          [],
          Array.isArray(state.sceneAssetRecords) ? state.sceneAssetRecords : [],
          Array.isArray(state.sceneStableReferencePacks) ? state.sceneStableReferencePacks : []
        );
        assertShotCharacterContractsReady(promptList);
        saveState({ promptList });

        let imageResults = Array.isArray(state.imageResults) ? state.imageResults : null;
        if (!imageResults || imageResults.length === 0) {
          const recoveredImageResults = recoverImageResultsFromDisk(promptList, shots, dirs.images);
          if (recoveredImageResults.length > 0) {
            deps.logger.info(
              'Director',
              `【Step 3/6】从磁盘恢复了 ${recoveredImageResults.length} 张已生成分镜图，继续补剩余镜头`
            );
            imageResults = recoveredImageResults;
            saveState({ imageResults });
          }
        }

        imageResults = normalizeImageResultsForShots(imageResults || [], shots);
        const attemptedImageShotIds = new Set(
          imageResults.filter((result) => result?.shotId).map((result) => result.shotId)
        );
        const pendingPrompts = promptList.filter((prompt) => !attemptedImageShotIds.has(prompt.shotId));

        if (pendingPrompts.length > 0) {
          const hasRecoveredCache = imageResults.length > 0;
          deps.logger.info(
            'Director',
            hasRecoveredCache
              ? `【Step 3/6】继续生成缺失分镜图像（剩余 ${pendingPrompts.length}/${promptList.length} 张）...`
              : '【Step 3/6】生成分镜图像...'
          );
          const generatedImageResults = await recordStep(
            'generate_images',
            {
              message: hasRecoveredCache
                ? `继续生成缺失分镜图像（剩余 ${pendingPrompts.length}/${promptList.length} 张）`
                : '生成分镜图像',
            },
            () =>
              deps.generateAllImages(pendingPrompts, dirs.images, {
                style,
                artifactContext: artifactContext.agents.imageGenerator,
                onResult: (partialResult) => {
                  const nextImageResults = normalizeImageResultsForShots(
                    mergeImageResultsByShotId(imageResults || [], [partialResult]),
                    shots
                  );
                  imageResults = nextImageResults;
                  saveState({ imageResults });
                },
              })
          );
          imageResults = normalizeImageResultsForShots(
            mergeImageResultsByShotId(imageResults || [], generatedImageResults),
            shots
          );
          saveState({ imageResults });
        } else {
          deps.logger.info('Director', '【Step 3/6】使用缓存的图像结果');
          appendStepRun('generate_images', {
            status: 'cached',
            detail: '使用缓存的图像结果',
          });
          saveState({ imageResults });
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

        let consistencyResult = state.consistencyResult || { reports: [], needsRegeneration: [] };
        if (!options.skipConsistencyCheck) {
          if (!state.consistencyCheckDone) {
            deps.logger.info('Director', '【Step 4/7】一致性验证...');
            consistencyResult = await recordStep(
              'consistency_check',
              { message: '一致性验证' },
              () =>
                deps.runConsistencyCheck(characterRegistry, imageResults, {
                  artifactContext: artifactContext.agents.consistencyChecker,
                  stableReferencePacks,
                  repairAttemptsByShotId: state.consistencyRepairAttemptsByShotId || {},
                })
            );
            const needsRegeneration = Array.isArray(consistencyResult?.needsRegeneration)
              ? consistencyResult.needsRegeneration
              : [];

            if (needsRegeneration.length > 0) {
              const shouldRegenerateInconsistentImages =
                normalizedOptions.skipConsistencyRegeneration !== true && normalizedOptions.stopBeforeVideo !== true;

              if (shouldRegenerateInconsistentImages) {
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

                        const adjustedPrompt = buildConsistencyRegenerationPrompt(originalPrompt, item);
                        const regenerateOptions = { style };

                        if (item.regenStrategy === 'reanchor_regenerate') {
                          const regenPrompt = attachShotReferenceImagesToPrompts(
                            [originalPrompt],
                            shots,
                            characterRegistry,
                            stableReferencePacks,
                            characterRefSheets,
                            imageResults,
                            Array.isArray(state.sceneAssetRecords) ? state.sceneAssetRecords : [],
                            Array.isArray(state.sceneStableReferencePacks) ? state.sceneStableReferencePacks : []
                          )[0];
                          regenerateOptions.referenceImages = regenPrompt.referenceImages;
                          regenerateOptions.referenceGroups = regenPrompt.referenceGroups;
                          regenerateOptions.characterPriority = regenPrompt.characterPriority;
                        }

                        if (item.regenStrategy === 'block_for_manual_asset_fix') {
                          return {
                            item,
                            regeneratedResult: {
                              shotId: item.shotId,
                              success: false,
                              error: 'block_for_manual_asset_fix',
                            },
                          };
                        }

                        const regeneratedResult = ensureImageResultIdentity(await deps.regenerateImage(
                          item.shotId,
                          adjustedPrompt,
                          originalPrompt.negative_prompt,
                          dirs.images,
                          regenerateOptions
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

                      const repairAttemptsByShotId = {
                        ...(state.consistencyRepairAttemptsByShotId || {}),
                        [item.shotId]: Number(state.consistencyRepairAttemptsByShotId?.[item.shotId] || 0) + 1,
                      };
                      saveState({ consistencyRepairAttemptsByShotId: repairAttemptsByShotId });
                    }
                  }
                );

                consistencyResult = await deps.runConsistencyCheck(characterRegistry, imageResults, {
                  artifactContext: artifactContext.agents.consistencyChecker,
                  stableReferencePacks,
                  repairAttemptsByShotId: state.consistencyRepairAttemptsByShotId || {},
                });
                const blockingConsistencyItems = (Array.isArray(consistencyResult?.needsRegeneration)
                  ? consistencyResult.needsRegeneration
                  : []).filter((item) => item?.regenStrategy === 'block_for_manual_asset_fix');
                if (blockingConsistencyItems.length > 0) {
                  const detail = blockingConsistencyItems
                    .map((item) => `${item.shotId}:${item.reason}`)
                    .join('；');
                  throw new Error(`角色一致性仍未恢复，需人工修复资产后再继续：${detail}`);
                }
              } else {
                deps.logger.info(
                  'Director',
                  `【Step 4/7】检测到 ${needsRegeneration.length} 个一致性问题镜头，但当前运行停止在视频前，跳过自动重生成`
                );
              }
            }

            saveState({ imageResults, consistencyResult, consistencyCheckDone: true });
            const approvedReports = Array.isArray(consistencyResult?.reports)
              ? consistencyResult.reports.filter((report) => {
                const finalDecision = report?.finalGateDecision || report?.qaDecision?.status || 'pass';
                return finalDecision === 'pass' || finalDecision === 'none' || finalDecision === 'pass_with_review';
              })
              : [];
            if (approvedReports.length > 0) {
              stableReferencePacks = approvedReports.reduce(
                (packs, report) => updateStableReferencePack(packs, report, imageResults, jobId),
                stableReferencePacks
              );
              saveState({ stableReferencePacks });
              deps.saveJSON(
                path.join(artifactContext.agents.consistencyChecker.outputsDir, 'character-stable-reference-pack.json'),
                stableReferencePacks
              );
            }
          } else {
            deps.logger.info('Director', '【Step 4/7】使用缓存的一致性检查结果');
            appendStepRun('consistency_check', {
              status: 'cached',
              detail: '使用缓存的一致性检查结果',
            });
            consistencyResult =
              state.consistencyResult ||
              {
                reports: readJSONSafe(
                  deps.loadJSON,
                  path.join(artifactContext.agents.consistencyChecker.outputsDir, 'consistency-report.json'),
                  []
                ),
                needsRegeneration: readJSONSafe(
                  deps.loadJSON,
                  path.join(artifactContext.agents.consistencyChecker.outputsDir, 'flagged-shots.json'),
                  []
                ),
              };
          }
        } else {
          deps.logger.info('Director', '【Step 4/7】跳过一致性检查');
          appendStepRun('consistency_check', {
            status: 'skipped',
            detail: '跳过一致性检查',
          });
          consistencyResult = { reports: [], needsRegeneration: [] };
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
                  corePropRegistry,
                  artifactContext: artifactContext.agents.continuityChecker,
                  sceneStableReferencePacks: Array.isArray(state.sceneStableReferencePacks) ? state.sceneStableReferencePacks : [],
                  sceneAssetRecords: Array.isArray(state.sceneAssetRecords) ? state.sceneAssetRecords : [],
                })
            );

            const repairAttemptsPath = path.join(
              artifactContext.agents.continuityChecker.outputsDir,
              'repair-attempts.json'
            );
            const repairAttempts = readJSONSafe(deps.loadJSON, repairAttemptsPath, []);
            const originalFlaggedTransitions = Array.isArray(continuityResult.flaggedTransitions)
              ? continuityResult.flaggedTransitions
              : [];
            let flaggedTransitions = originalFlaggedTransitions;

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
                      const regenPrompt = attachShotReferenceImagesToPrompts(
                        [originalPrompt],
                        shots,
                        characterRegistry,
                        stableReferencePacks,
                        characterRefSheets,
                        imageResults,
                        Array.isArray(state.sceneAssetRecords) ? state.sceneAssetRecords : [],
                        Array.isArray(state.sceneStableReferencePacks) ? state.sceneStableReferencePacks : []
                      )[0];
                      const regeneratedResult = ensureImageResultIdentity(
                        await deps.regenerateImage(
                          item.shotId,
                          adjustedPrompt,
                          originalPrompt.negative_prompt,
                          dirs.images,
                          {
                            style,
                            referenceImages: regenPrompt.referenceImages,
                            referenceGroups: regenPrompt.referenceGroups,
                            characterPriority: regenPrompt.characterPriority,
                          }
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

                  const repairedShotIds = new Set(
                    repairAttempts
                      .filter((item) => item?.attempted === true && item?.success === true && item?.shotId)
                      .map((item) => item.shotId)
                  );
                  flaggedTransitions = originalFlaggedTransitions.filter(
                    (item) => !repairedShotIds.has(item?.shotId)
                  );
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

        const visualEligibilityReport = buildVisualEligibilityReport(shots, imageResults);
        saveState({ visualEligibilityReport });

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
        sceneStableReferencePacks = Array.isArray(state.sceneStableReferencePacks) ? state.sceneStableReferencePacks : null;
        const sceneContinuityResult = {
          reports: Array.isArray(state.continuityReport) ? state.continuityReport : [],
          flaggedTransitions: Array.isArray(state.continuityFlaggedTransitions) ? state.continuityFlaggedTransitions : [],
        };
        const sceneAssetRecords = buildSceneAssetRecords({
          scenePacks,
          shots,
          imageResults,
          continuityResult: sceneContinuityResult,
          sceneStableReferencePacks: sceneStableReferencePacks || [],
        });
        if (!sceneStableReferencePacks || sceneStableReferencePacks.length === 0) {
          sceneStableReferencePacks = buildSceneStableReferencePacks(sceneAssetRecords, {
            existingPacks: sceneStableReferencePacks || [],
            runId: jobId,
          });
        } else {
          sceneStableReferencePacks = buildSceneStableReferencePacks(sceneAssetRecords, {
            existingPacks: sceneStableReferencePacks,
            runId: jobId,
          });
        }
        sceneStableReferencePacks = sceneAssetRecords.reduce((packs, record) => {
          const representativeImage = (Array.isArray(imageResults) ? imageResults : []).find(
            (entry) => entry?.shotId === record.representativeShotId || entry?.imagePath === record.bestFramePath
          );
          return updateSceneStableReferencePack(
            packs,
            {
              sceneId: record.sceneId,
              shotId: record.representativeShotId,
              imagePath: representativeImage?.imagePath || record.bestFramePath || record.anchorImagePath || null,
              sceneSimilarityScore: record.lastSceneSimilarityScore || record.continuityScore || 0,
              continuityScore: record.lastContinuityScore || record.continuityScore || 0,
              lightingAnchor: record.lightingAnchor || null,
              propAnchorSnapshot: record.propAnchorSnapshot || [],
            },
            jobId
          );
        }, sceneStableReferencePacks);
        saveState({ sceneStableReferencePacks });
        writeSceneAssetArtifacts(sceneAssetRecords, artifactContext.agents.sceneGrammarAgent);
        if (artifactContext?.agents?.sceneGrammarAgent?.outputsDir) {
          deps.saveJSON(
            path.join(artifactContext.agents.sceneGrammarAgent.outputsDir, 'scene-stable-reference-pack.json'),
            sceneStableReferencePacks
          );
        }
        saveState({ sceneAssetRecords });
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

        let storyboardContextMemory = state.storyboardContextMemory || null;
        if (!storyboardContextMemory) {
          deps.logger.info('Director', '【Step 9.5/15】构建分镜上下文记忆...');
          storyboardContextMemory = await recordStep('storyboard_context_memory', { message: '构建分镜上下文记忆' }, () =>
            deps.buildStoryboardContext(
              {
                projectId,
                runId: runJobRef.id,
                shots,
                characterRegistry,
                characterAssetGovernanceReport,
                motionPlan,
                performancePlan,
                imageResults,
                continuityReport: state.continuityReport || [],
                continuityFlaggedTransitions: state.continuityFlaggedTransitions || [],
                videoProviderCapabilities: state.videoProviderCapabilities || {},
                sourceArtifacts: [
                  {
                    path: path.join(artifactContext.agents.imageGenerator.outputsDir, 'image-results.json'),
                    artifactType: 'image-results',
                    agent: 'imageGenerator',
                    version: 'director-v1',
                    generatedAt: new Date().toISOString(),
                  },
                  {
                    path: path.join(artifactContext.agents.characterAssetGovernance.outputsDir, 'character-asset-governance.json'),
                    artifactType: 'character-asset-governance',
                    agent: 'characterAssetGovernance',
                    version: 'director-v1',
                    generatedAt: new Date().toISOString(),
                  },
                ],
              },
              {
                currentShotId: shots[0]?.id || shots[0]?.shotId || null,
                tokenBudget: normalizedOptions.storyboardContextTokenBudget,
                artifactContext: artifactContext.agents.storyboardContextAgent,
              }
            )
          );
          saveState({ storyboardContextMemory });
        } else {
          deps.logger.info('Director', '【Step 9.5/15】使用缓存的分镜上下文记忆');
          appendStepRun('storyboard_context_memory', {
            status: 'cached',
            detail: '使用缓存的分镜上下文记忆',
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
              continuityFlaggedTransitions: state.continuityFlaggedTransitions || [],
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

        const upstreamFailureInsights = buildUpstreamFailureInsights(visualEligibilityReport, preflightQaReport);
        saveState({ upstreamFailureInsights });

        const executionGate = buildExecutionGate({
          visualEligibilityReport,
          preflightQaReport,
          shotPackages: preflightShotPackages,
          stoppedBeforeStage: 'generate_video_clips',
        });
        saveState({ executionGate });
        if (executionGate.status === 'blocked') {
          if (normalizedOptions.stopBeforeVideo) {
            deps.logger.info('Director', '🛑 --stop-before-video：检测到上游阻断，保留根因与 QA 信息并停止在视频生成前');
            saveState({
              stoppedBeforeVideoAt: new Date().toISOString(),
              lastError: null,
              failedAt: null,
            });
            writeRunQaOverview(
              collectRunQaOverview(deps.loadJSON, artifactContext, {
                releasable: false,
                seedancePromptMetrics: readSeedancePromptMetrics(deps.loadJSON, artifactContext),
                extraTopIssues: [
                  ...buildExecutionGateTopIssues(executionGate),
                  ...buildVisualEligibilityTopIssues(visualEligibilityReport),
                  ...buildUpstreamFailureTopIssues(upstreamFailureInsights),
                  ...buildPreflightTopIssues(preflightQaReport),
                  ...buildPreflightFixBriefTopIssues(preflightQaReport),
                ],
                summaryAppend: [
                  buildVisualEligibilitySummaryText(visualEligibilityReport),
                  buildUpstreamFailureSummaryText(upstreamFailureInsights),
                  executionGate.message || '',
                  '当前按 stop-before-video 停止，后续视频生成未执行。',
                ].filter(Boolean).join(' '),
              }),
              artifactContext
            );
            return {
              status: 'stopped_before_video',
              executionGate,
              preflightQaReport,
              motionPlan,
              shotPackages,
              characterRegistry,
            };
          }
          const normalizedGate = finalizeExecutionGate(executionGate);
          throw new Error(normalizedGate.message || normalizedGate.reason || 'Execution gate blocked');
        }

        let costGovernanceReport = deps.buildCostGovernanceReport({
          preflightShotPackages,
          consistencyNeedsRegeneration: consistencyResult?.needsRegeneration || [],
          costMetricsState: state.costMetrics,
          runId: runJobRef.id,
          policy: normalizedOptions.costPolicy || {},
        });
        deps.writeCostGovernanceArtifacts(costGovernanceReport, artifactContext.agents.costGovernance);
        saveState({ costGovernanceReport, costMetrics: costGovernanceReport?.costMetricsState || state.costMetrics || {} });

        let humanReviewQueue = deps.buildHumanReviewQueue({
          assetGovernanceReport: characterAssetGovernanceReport || null,
          consistencyResult,
          costReport: costGovernanceReport,
        });
        deps.writeHumanReviewQueueArtifacts(humanReviewQueue, artifactContext.agents.humanReviewQueue);
        saveState({ humanReviewQueue });

        if (normalizedOptions.stopBeforeVideo) {
          deps.logger.info('Director', '🛑 --stop-before-video：已完成预飞检，提前退出到视频生成前');
          const stopBeforeVideoActionSequencePlan = Array.isArray(state.actionSequencePlan)
            ? state.actionSequencePlan
            : [];
          const stopBeforeVideoSequenceClipResults = Array.isArray(state.sequenceClipResults)
            ? state.sequenceClipResults
            : [];
          const stopBeforeVideoSequenceQaReport = state.sequenceQaReport || null;
          const stopBeforeVideoSummary = buildPipelineSummaryMetrics({
            motionPlan,
            videoResults: [],
            shotQaReport: null,
            preflightQaReport,
            visualEligibilityReport,
            upstreamFailureInsights,
            seedancePromptMetrics: readSeedancePromptMetrics(deps.loadJSON, artifactContext),
            actionSequencePlan: stopBeforeVideoActionSequencePlan,
            sequenceClipResults: stopBeforeVideoSequenceClipResults,
            sequenceQaReport: stopBeforeVideoSequenceQaReport,
          });
          saveState({
            pipelineSummary: stopBeforeVideoSummary,
            stoppedBeforeVideoAt: new Date().toISOString(),
            lastError: null,
            failedAt: null,
          });
          writeRunQaOverview(
            collectRunQaOverview(deps.loadJSON, artifactContext, {
              releasable: false,
              seedancePromptMetrics: readSeedancePromptMetrics(deps.loadJSON, artifactContext),
              extraTopIssues: [
                ...buildExecutionGateTopIssues(state?.executionGate),
                ...buildVisualEligibilityTopIssues(visualEligibilityReport),
                ...buildUpstreamFailureTopIssues(upstreamFailureInsights),
                ...buildPreflightTopIssues(preflightQaReport),
                ...buildPreflightFixBriefTopIssues(preflightQaReport),
                ...(costGovernanceReport?.warnings || []).map((item) => `Cost Governance: ${item}`),
                ...(costGovernanceReport?.blockers || []).map((item) => `Cost Governance: ${item}`),
                'Director: 已按要求停止在视频生成前，未触发任何视频 API 调用。',
              ],
              summaryAppend: [
                buildVisualEligibilitySummaryText(visualEligibilityReport),
                buildUpstreamFailureSummaryText(upstreamFailureInsights),
                state?.executionGate?.message || '',
                `成本治理：计划视频请求 ${costGovernanceReport?.planned?.videoRequestCount || 0} 个，估算单位 ${costGovernanceReport?.planned?.estimatedUnits?.total || 0}。`,
                `人审队列：待复核 ${humanReviewQueue?.summary?.openCount || 0} 项。`,
                '当前只完成到预飞检阶段，后续视频生成尚未执行。',
              ].filter(Boolean).join(' '),
            }),
            artifactContext
          );
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
              const dedicatedProviders = new Set(['seedance', 'sora2']);

              if (shouldRunProvider('seedance')) {
                providersToRun.push({
                  provider: 'seedance',
                  packages: preflightShotPackages,
                  runner: deps.runSeedanceVideo,
                  artifactContext: artifactContext.agents.seedanceVideoAgent,
                });
              }

              if (shouldRunProvider('sora2')) {
                providersToRun.push({
                  provider: 'sora2',
                  packages: preflightShotPackages,
                  runner: deps.runSora2Video,
                  artifactContext: artifactContext.agents.sora2VideoAgent,
                });
              }

              const unifiedProviderPackages = (Array.isArray(preflightShotPackages) ? preflightShotPackages : []).filter((item) => {
                const provider = normalizeRuntimeVideoProvider(item?.preferredProvider);
                return provider && provider !== 'static_image' && !dedicatedProviders.has(provider);
              });
              if (unifiedProviderPackages.length > 0) {
                providersToRun.push({
                  provider: 'unified',
                  packages: unifiedProviderPackages,
                  runner: deps.runVideoGeneration,
                  artifactContext: artifactContext.agents.videoGenerationAgent,
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
                  providerRun.runner(providerRun.packages, videoDir, {
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

        costGovernanceReport = deps.buildCostGovernanceReport({
          preflightShotPackages,
          consistencyNeedsRegeneration: consistencyResult?.needsRegeneration || [],
          videoResults: rawVideoResults,
          costMetricsState: state.costMetrics,
          runId: runJobRef.id,
          policy: normalizedOptions.costPolicy || {},
        });
        deps.writeCostGovernanceArtifacts(costGovernanceReport, artifactContext.agents.costGovernance);
        humanReviewQueue = deps.buildHumanReviewQueue({
          assetGovernanceReport: characterAssetGovernanceReport || null,
          consistencyResult,
          costReport: costGovernanceReport,
        });
        deps.writeHumanReviewQueueArtifacts(humanReviewQueue, artifactContext.agents.humanReviewQueue);
        saveState({ costGovernanceReport, costMetrics: costGovernanceReport?.costMetricsState || state.costMetrics || {}, humanReviewQueue });

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

        assertNoHardVisualBlocks('Shot QA', shotQaReport?.entries, 'decisionReason');
        assertAllShotsHaveApprovedDynamicVideo(preflightShotPackages || shotPackages, shotQaReport, rawVideoResults);

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
              videoProvider: getDefaultVideoProvider(),
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
              videoProvider: getDefaultVideoProvider(),
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
              videoProvider: getDefaultVideoProvider(),
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
              videoProvider: getDefaultVideoProvider(),
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

        let crossVideoConsistencyReport = state.crossVideoConsistencyReport || null;
        if (!crossVideoConsistencyReport) {
          deps.logger.info('Director', '【Step 12.25/13】检查跨视频一致性...');
          crossVideoConsistencyReport = await recordStep('cross_video_consistency', { message: '检查跨视频一致性' }, () =>
            deps.runCrossVideoConsistency(
              {
                projectKey: options.projectKey || project?.projectKey || project?.code || null,
                videoProvider: getDefaultVideoProvider(),
                videoResults,
                bridgeClipResults,
                sequenceClipResults,
                lipsyncResults,
                shotQaReport,
                bridgeQaReport,
                sequenceQaReport,
                consistencyReport: consistencyResult,
                continuityReport: {
                  reports: state.continuityReport || [],
                  flaggedTransitions: state.continuityFlaggedTransitions || [],
                },
                lipsyncReport,
                contextMemory: storyboardContextMemory,
                videoMetadata: (videoResults || []).map((result) => ({
                  videoId: result.videoId || result.shotId,
                  firstShotId: result.shotId,
                  lastShotId: result.shotId,
                  provider: result.provider || result.preferredProvider || getDefaultVideoProvider(),
                  characters: result.characters || [],
                  scenes: result.scenes || [],
                  entryPose: result.entryPose || null,
                  exitPose: result.exitPose || null,
                  requiredReferenceIds: result.referenceIds || result.references || [],
                })),
                sourceArtifacts: [
                  {
                    path: path.join(artifactContext.agents.shotQaAgent.outputsDir, 'shot-qa-report.json'),
                    artifactType: 'shot-qa-report',
                    agent: 'shotQaAgent',
                    version: 'director-v1',
                    generatedAt: new Date().toISOString(),
                  },
                ],
              },
              {
                artifactContext: artifactContext.agents.crossVideoConsistencyChecker,
              }
            )
          );
          saveState({ crossVideoConsistencyReport });
        } else {
          deps.logger.info('Director', '【Step 12.25/13】使用缓存的跨视频一致性报告');
          appendStepRun('cross_video_consistency', {
            status: 'cached',
            detail: '使用缓存的跨视频一致性报告',
          });
        }

        let avPackagingPlan = state.avPackagingPlan || null;
        if (!avPackagingPlan) {
          deps.logger.info('Director', '【Step 12.5/13】生成音画包装计划...');
          avPackagingPlan = await recordStep('av_packaging', { message: '生成音画包装计划' }, () =>
            deps.runAvPackaging(
              {
                runId: runJobRef.id,
                shots: normalizedShots,
                audioResults,
                ttsQaReport,
                lipsyncReport,
                sequenceClips: sequenceClipResults,
                bridgeClips: bridgeClipResults,
                options: {
                  assets: options.avAssets || options.assets || {},
                  subtitleStyleProfile: options.subtitleStyleProfile,
                  audioMood: options.audioMood,
                  fps: options.fps,
                  resolution: options.resolution,
                },
              },
              {
                artifactContext: artifactContext.agents.avPackagingAgent,
              }
            )
          );
          saveState({ avPackagingPlan });
        } else {
          deps.logger.info('Director', '【Step 12.5/13】使用缓存的音画包装计划');
          appendStepRun('av_packaging', {
            status: 'cached',
            detail: '使用缓存的音画包装计划',
          });
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
        const videoClips = buildVideoClipBridge(videoResults, shotQaReport, getDefaultVideoProvider);
        const sequenceClips = buildSequenceClipBridge(
          actionSequencePlan,
          sequenceClipResults,
          sequenceQaReport,
          getDefaultVideoProvider
        );
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
            packagingPlan: avPackagingPlan,
          })
        );
        const composeResult = normalizeComposeResult(composeRun, outputPath);
        const finalOutputPath = composeResult.outputVideo.uri || outputPath;

        if (composeResult.status === 'blocked' || composeResult.status === 'completed_with_errors') {
          throw new Error(
            `Compose 阻断交付：${(composeResult.report?.blockedReasons || []).join('；') || 'unknown compose block'}`
          );
        }

        let postComposeReview = state.postComposeReview || null;
        if (!postComposeReview) {
          const composePlan =
            composeResult.artifacts?.composePlan ||
            composeResult.composePlan ||
            readJSONSafe(deps.loadJSON, composeResult.artifacts?.composePlanUri, {});
          deps.logger.info('Director', '【Step 13.5/13】生成成片预览后编辑任务包...');
          postComposeReview = await recordStep('post_compose_review', { message: '生成成片预览后编辑任务包' }, () =>
            deps.runPostComposeReview(
              {
                projectId,
                runId: runJobRef.id,
                composeResult,
                composePlan,
                shotQaReport,
                bridgeQaReport,
                sequenceQaReport,
                ttsQaReport,
                lipsyncReport,
                crossVideoConsistencyReport,
                avPackagingPlan,
                costGovernanceReport,
                userFeedback: options.userPreviewFeedback || options.userFeedback || null,
                finalVideoPath: finalOutputPath,
              },
              {
                artifactContext: artifactContext.agents.postComposeReviewAgent,
              }
            )
          );
          const postComposeReviewItems = (postComposeReview.editTaskPack?.humanReview?.items || []).map((item) => ({
            id: `post_compose_${item.taskId}`,
            type: 'post_compose_edit_task',
            priority: item.priority || 'medium',
            status: 'open',
            shotId: item.targetRef?.type === 'shot' ? item.targetRef.id : null,
            reason: item.reason || '成片预览后编辑任务需要确认',
            suggestedAction: `${item.reviewType || 'approve_or_skip'}: ${item.targetRef?.type || 'unknown'}:${item.targetRef?.id || 'unknown'}`,
            evidence: ['post-compose-review/edit-task-pack.json'],
          }));
          humanReviewQueue = deps.buildHumanReviewQueue({
            assetGovernanceReport: characterAssetGovernanceReport || null,
            consistencyResult,
            costReport: costGovernanceReport,
            extraItems: postComposeReviewItems,
          });
          deps.writeHumanReviewQueueArtifacts(humanReviewQueue, artifactContext.agents.humanReviewQueue);
          saveState({ postComposeReview, humanReviewQueue });
        } else {
          deps.logger.info('Director', '【Step 13.5/13】使用缓存的成片预览后编辑任务包');
          appendStepRun('post_compose_review', {
            status: 'cached',
            detail: '使用缓存的成片预览后编辑任务包',
          });
          // 缓存恢复路径：从缓存的 postComposeReview 中重新提取编辑任务，重建人审队列，
          // 确保断点续跑时成片预览后编辑任务不会从人审界面丢失。
          const cachedPostComposeReviewItems = (postComposeReview?.editTaskPack?.humanReview?.items || []).map((item) => ({
            id: `post_compose_${item.taskId}`,
            type: 'post_compose_edit_task',
            priority: item.priority || 'medium',
            status: 'open',
            shotId: item.targetRef?.type === 'shot' ? item.targetRef.id : null,
            reason: item.reason || '成片预览后编辑任务需要确认',
            suggestedAction: `${item.reviewType || 'approve_or_skip'}: ${item.targetRef?.type || 'unknown'}:${item.targetRef?.id || 'unknown'}`,
            evidence: ['post-compose-review/edit-task-pack.json'],
          }));
          humanReviewQueue = deps.buildHumanReviewQueue({
            assetGovernanceReport: characterAssetGovernanceReport || null,
            consistencyResult,
            costReport: costGovernanceReport,
            extraItems: cachedPostComposeReviewItems,
          });
          deps.writeHumanReviewQueueArtifacts(humanReviewQueue, artifactContext.agents.humanReviewQueue);
          saveState({ humanReviewQueue });
        }

        const pipelineSummary = buildPipelineSummaryMetrics({
          motionPlan,
          videoResults,
          shotQaReport,
          preflightQaReport,
          visualEligibilityReport,
          upstreamFailureInsights,
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
            visualEligibilityReport,
            upstreamFailureInsights,
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
              ...buildExecutionGateTopIssues(state?.executionGate),
              ...buildVisualEligibilityTopIssues(visualEligibilityReport),
              ...buildUpstreamFailureTopIssues(upstreamFailureInsights),
              ...buildPreflightTopIssues(preflightQaReport),
              ...buildPreflightFixBriefTopIssues(preflightQaReport),
              ...buildSeedanceInferenceTopIssues(seedancePromptMetrics),
            ],
            summaryAppend: [
              buildVisualEligibilitySummaryText(visualEligibilityReport),
              buildUpstreamFailureSummaryText(upstreamFailureInsights),
              state?.executionGate?.message || '',
              preflightContextSummary,
              seedanceInferenceSummary,
            ].filter(Boolean).join(' '),
          }),
          artifactContext
        );

        saveState({
          pipelineSummary,
          outputPath: finalOutputPath,
          composeResult,
          deliverySummaryPath,
          completedAt: new Date().toISOString(),
          lastError: null,
          failedAt: null,
        });
        if (runJobCreated) {
          tryObservabilityWrite(
            () =>
              deps.runJobStore.finishRunJob(
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
                ...buildExecutionGateTopIssues(state?.executionGate),
                ...buildVisualEligibilityTopIssues(state?.visualEligibilityReport),
                ...buildUpstreamFailureTopIssues(state?.upstreamFailureInsights),
                ...buildPreflightTopIssues(state?.preflightQaReport),
                ...buildPreflightFixBriefTopIssues(state?.preflightQaReport),
                ...buildSeedanceInferenceTopIssues(failedSeedancePromptMetrics),
              ],
              summaryAppend: [
                buildVisualEligibilitySummaryText(state?.visualEligibilityReport),
                buildUpstreamFailureSummaryText(state?.upstreamFailureInsights),
                state?.executionGate?.message || '',
                failedPreflightContextSummary,
                failedSeedanceInferenceSummary,
              ].filter(Boolean).join(' '),
            }),
            activeArtifactContext
          );
        }
        if (runJobRef && runJobCreated) {
          tryObservabilityWrite(
            () =>
              deps.runJobStore.finishRunJob(
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
          !hasCompatibilityInputFormat;

        if (contentChanged || inputFormatChanged || missingInputFormatMetadataNeedsReparse) {
          for (const key of Object.keys(state)) {
            delete state[key];
          }
        }

        const existingProject =
          deps.projectStore.loadProject(legacy.projectId, options.storeOptions) || null;
        const existingScript =
          deps.projectStore.loadScript(legacy.projectId, legacy.scriptId, options.storeOptions) || null;
        const existingEpisode =
          deps.projectStore.loadEpisode(legacy.projectId, legacy.scriptId, legacy.episodeId, options.storeOptions) ||
          null;
        const canReuseExistingParsedLegacyDataFromStore =
          existingScript &&
          existingEpisode &&
          existingScript.sourceText === scriptText &&
          canReuseExistingParsedLegacyData(existingScript, existingEpisode, selectedInputFormat);

        let scriptData = state.scriptData;
        if (!scriptData) {
          if (canReuseExistingParsedLegacyDataFromStore) {
            scriptData = {
              title: existingScript.title,
              characters: existingScript.characters || [],
              shots: existingEpisode.shots || [],
            };
          } else {
            bootstrapParserArtifactContext = deps.artifactStore.createRunArtifactContext({
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
        let bootstrapProject = existingProject;
        let bootstrapScript = existingScript;
        let bootstrapEpisode = existingEpisode;
        const finalArtifactContext =
          options.artifactContext ||
          deps.artifactStore.createRunArtifactContext({
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
          deps.artifactStore.adoptAgentArtifacts(
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
          !canReuseExistingParsedLegacyDataFromStore
        ) {
          const project = createProject({
            id: legacy.projectId,
            name: title,
            code: sanitizeFileSegment(path.basename(scriptFilePath, path.extname(scriptFilePath)), 'project'),
            status: 'draft',
          });
          deps.projectStore.saveProject(project, options.storeOptions);

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
          deps.projectStore.saveScript(project.id, script, options.storeOptions);

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
          deps.projectStore.saveEpisode(project.id, script.id, episode, options.storeOptions);
          bootstrapProject = project;
          bootstrapScript = script;
          bootstrapEpisode = episode;
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
            bootstrapProject,
            bootstrapScript,
            bootstrapEpisode,
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
  buildLegacyBridgeIdentity,
  HARD_VISUAL_BLOCK_REASON_CODES,
  attachShotReferenceImagesToPrompts,
  collectHardVisualBlockEntries,
  collectRunQaOverview,
  assertNoHardVisualBlocks,
  initializePhase4SequenceState,
  buildVisualEligibilityReport,
  buildUpstreamFailureInsights,
  buildShotQaInputs,
  buildBridgeClipBridge,
  buildSequenceClipBridge,
  filterBridgeClipsAgainstSequences,
  isReusableContinuityQaReport,
  assertContinuityDeliveryGate,
};

Object.defineProperty(__testables, 'runExperimentalEpisodePipelineFacade', {
  enumerable: true,
  configurable: true,
  get() {
    return runExperimentalEpisodePipelineFacade;
  },
  set(value) {
    runExperimentalEpisodePipelineFacade = value;
  },
});

export const runEpisodePipeline = director.runEpisodePipeline;
export const runPipeline = director.runPipeline;
export default director;
