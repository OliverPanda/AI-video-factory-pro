/**
 * 导演Agent（Orchestrator）- 主编排器
 * 支持分集级别执行，并保留旧剧本文件入口的兼容桥接
 */

import fs from 'node:fs';
import path from 'path';
import { parseScript } from './scriptParser.js';
import {
  buildCharacterRegistry,
  getShotCharacterCards,
  resolveCharacterIdentity,
} from './characterRegistry.js';
import { generateAllPrompts } from './promptEngineer.js';
import { generateAllImages, regenerateImage } from './imageGenerator.js';
import { generateCharacterRefSheets } from './characterRefSheetGenerator.js';
import { buildCorePropRegistry } from './corePropRegistry.js';

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
import { buildCharacterAssetGovernanceReport } from '../domain/characterAssetGovernance.js';
import { createEpisode, createProject, createScript } from '../domain/projectModel.js';
import { loadEpisode, loadProject, loadScript, saveEpisode, saveProject, saveScript } from '../utils/projectStore.js';
import { ensureDir, generateJobId, initDirs, loadJSON, readTextFile, saveJSON } from '../utils/fileHelper.js';
import { appendAgentTaskRun, createRunJob, finishRunJob } from '../utils/jobStore.js';
import { AGENT_ARTIFACT_LAYOUT, adoptAgentArtifacts, createRunArtifactContext, initializeRunArtifacts } from '../utils/runArtifacts.js';
import { listCharacterBibles } from '../utils/characterBibleStore.js';
import { loadPronunciationLexicon } from '../utils/pronunciationLexiconStore.js';
import { writeRunQaOverview } from '../utils/qaSummary.js';
import { writeCharacterAssetGovernanceArtifacts } from '../utils/characterAssetGovernanceArtifacts.js';
import { buildCostGovernanceReport, writeCostGovernanceArtifacts } from '../utils/costGovernance.js';
import { buildHumanReviewQueue, writeHumanReviewQueueArtifacts } from '../utils/humanReviewQueue.js';
import { ensureProjectVoiceCast, loadVoiceCast } from '../utils/voiceCastStore.js';
import { loadVoicePreset } from '../utils/voicePresetStore.js';
import { buildEpisodeDirName, buildProjectDirName } from '../utils/naming.js';
import logger from '../utils/logger.js';
import { createEpisodePipelineWorkflow, createMultiStepPipelineWorkflow, runEpisodeViaWorkflow } from './director/workflowRuntime.js';
import {
  buildEpisodeContext,
  initializePhase4SequenceState,
  hashContent,
  simplifyNormalizedShotsForCache,
  simplifyVoiceCastForCache,
  buildAudioResultsSignature,
  buildAudioCacheKey,
  buildLipsyncCacheKey,
  createRunJobAttemptId,
  classifyImageFailure,
  buildVisualEligibilityReport,
  buildVisualEligibilityTopIssues,
  buildUpstreamFailureInsights,
  buildUpstreamFailureTopIssues,
  collectHardVisualBlockEntries,
  assertNoHardVisualBlocks,
  buildVisualEligibilitySummaryText,
  buildUpstreamFailureSummaryText,
  assertCharacterRefSheetsSucceeded,
  isSuccessfulCharacterRefSheet,
  buildCharacterRefSheetSuccessIndex,
  getMissingCharacterRefSheetCards,
  findCharacterRefSheetResultForCard,
  mergeCharacterRefSheetResults,
  buildTestRuntimeCharacterRefSheetPlaceholders,
  coerceCharacterRefSheetResults,
  applyCharacterRefSheetPaths,
  buildAnimationClipBridge,
  getDefaultVideoProvider,
  isNodeTestRuntime,
  normalizeStringList,
  attachShotReferenceImagesToPrompts,
  createEmptyProviderRun,
  normalizeRuntimeVideoProvider,
  buildVideoClipBridge,
  assertAllShotsHaveApprovedDynamicVideo,
  buildShotQaInputs,
  buildBridgeClipBridge,
  buildSequenceClipBridge,
  filterBridgeClipsAgainstSequences,
  getCompletedContinuityIds,
  getApprovedContinuityIds,
  isReusableContinuityQaReport,
  assertContinuityDeliveryGate,
  normalizeProjectId,
  buildSequenceCoverageMetrics,
  buildPipelineSummaryMetrics,
  createDeliverySummary,
  inferOwnerModuleFromRootCause,
  inferActionSuggestion,
  buildBossRootCauseSummary,
  normalizeComposeResult,
  buildPreflightTopIssues,
  buildPreflightFixBriefTopIssues,
  readSeedancePromptMetrics,
  normalizeRunDebugText,
  buildRunDebugSignals,
  buildSeedanceInferenceTopIssues,
  isSeedanceInferenceOverThreshold,
  shouldBlockFormalDeliveryForSeedanceInference,
  readJSONSafe,
  normalizeStopAt,
  mapManifestStatusToQaStatus,
  collectRunQaOverview,
  HARD_VISUAL_BLOCK_REASON_CODES,
  createPipelineCtx,
  executeLoadAssetsStage,
  executeCharacterRegistryStage,
  executeGenerateRefSheetsStage,
  executeConsistencyCheckStage,
  executeContinuityCheckStage,
  executePlanSceneGrammarStage,
  executePlanDirectorPacksStage,
  executePlanMotionStage,
  executePlanPerformanceStage,
  executeBuildStoryboardContextStage,
  executeGeneratePromptsStage,
  executeGenerateImagesStage,
  executeImageBackfillStage,
  executeNormalizeDialogueStage,
  executeGenerateAudioStage,
  executeTtsQaStage,
  executeLipsyncStage,
  executeCrossVideoConsistencyStage,
  executeAvPackagingStage,
  executeComposeVideoStage,
  executePostComposeReviewStage,
  executeDeliverySummaryStage,
  executeFinishRunJobStage,
  executeGenerateVideoClipsStage,
  executeCostGovernanceStage,
  executeEnhanceVideoClipsStage,
  executeShotQaStage,
  executeBridgeSubPipelineStage,
  executeSequenceSubPipelineStage,
} from './director/runtimeSupport.js';


export function createDirector(overrides = {}) {
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
    createRunArtifactContext,
    initializeRunArtifacts,
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
    // P2d：对外调用面保持 { projectId, scriptId, episodeId, options } 不变；
    // 实际执行经 Mastra workflow（单 plan step v1，见 director/workflowRuntime.js）。
    async runEpisodePipeline({ projectId, scriptId, episodeId, options = {} }) {
      // P2d v2：当前使用 legacy 单 step workflow（Batch 1 stage 函数已就绪，后续 batch 逐步切换）
      const workflow = createEpisodePipelineWorkflow({
        executePipeline: director.runEpisodePipelineImpl,
      });
      return runEpisodeViaWorkflow(workflow, { projectId, scriptId, episodeId, options });
    },

    async runEpisodePipelineImpl({ projectId, scriptId, episodeId, options = {} }) {
      const style = options.style || process.env.IMAGE_STYLE || 'realistic';
      const jobId = options.jobId || deps.generateJobId(`${scriptId}_${episodeId}`);

      deps.logger.info('Director', `=== 开始任务 ${jobId} ===`);
      deps.logger.info(
        'Director',
        `项目：${projectId} | 剧本：${scriptId} | 分集：${episodeId} | 风格：${style}`
      );

      let dirs = deps.initDirs(jobId);
      const stateFile = path.join(dirs.root, 'state.json');
      const loadedState = deps.loadJSON(stateFile) || {};
      const runStartedAt = options.startedAt || new Date().toISOString();
      let runJobRef = null;
      let activeArtifactContext = options.artifactContext || null;

      // P2d v2 Batch 0：使用 createPipelineCtx 收敛闭包共享变量
      const ctx = createPipelineCtx({
        loadedState,
        deps,
        stateFile,
        artifactContext: activeArtifactContext,
      });
      ctx.style = style;
      ctx.jobId = jobId;
      ctx.pipelineOptions = options;
      const { state, saveState } = ctx;

      function tryObservabilityWrite(action, label) {
        return ctx.tryObservabilityWrite(action, label);
      }

      try {
        // P2d v2 Batch 1：使用 stage 函数替代内联代码
        await executeLoadAssetsStage(ctx, deps, { projectId, scriptId, episodeId, options, runStartedAt });
        activeArtifactContext = ctx.artifactContext;
        runJobRef = ctx.runJobRef;

        await executeCharacterRegistryStage(ctx, deps, {});

        await executeGenerateRefSheetsStage(ctx, deps, { dirs });

        // after_ref_sheets stop check（stage 内已设置 ctx.stopStatus）
        if (ctx.stopStatus) {
          return {
            status: ctx.stopStatus,
            characterRegistry: ctx.characterRegistry,
            characterRefSheets: ctx.characterRefSheets,
          };
        }

        // 从 state 恢复本地变量，供后续 stage 使用
        const shots = state.shots || [];
        const characters = state.characters || [];
        const episodeCharacters = state.episodeCharacters || [];
        const mainCharacterTemplates = state.mainCharacterTemplates || [];
        const characterBibles = state.characterBibles || [];
        const scriptTitle = state.scriptTitle || '';
        const episodeTitle = state.episodeTitle || '';
        const stopAt = state.stopAt || {};
        let characterRegistry = ctx.characterRegistry;
        let corePropRegistry = ctx.corePropRegistry;
        const characterRefSheets = ctx.characterRefSheets;
        const characterAssetGovernanceReport = state.characterAssetGovernanceReport || null;
        const artifactContext = ctx.artifactContext;
        const project = ctx.project;
        const script = ctx.script;
        const episode = ctx.episode;
        const projectName = state.projectName || project?.name || script?.title || projectId;
        const requestedMaxShots = state.requestedMaxShots || null;

        // 重建 dirs（从 state.jobId 计算，与 load_assets 阶段一致）
        dirs = deps.initDirs(state.jobId || jobId);

        function appendStepRun(step, payload) {
          ctx.appendStepRun(step, payload, runJobRef, options);
        }

        function logCachedStepRun(step, label, message) {
          ctx.logCachedStepRun(step, label, message, runJobRef, options);
        }

        async function recordStep(step, detail, run) {
          return ctx.recordStep(step, detail, run, runJobRef, options);
        }

        await executeGeneratePromptsStage(ctx, deps, {});

        await executeGenerateImagesStage(ctx, deps, { dirs });

        await executeImageBackfillStage(ctx, deps, {});

        if (ctx.stopStatus) {
          return {
            status: ctx.stopStatus,
            imageResults: ctx.imageResults,
            characterRegistry: ctx.characterRegistry,
            characterRefSheets: ctx.characterRefSheets,
          };
        }

        let imageResults = ctx.imageResults;
        let promptList = ctx.promptList;

        await executeConsistencyCheckStage(ctx, deps, { dirs });
        const consistencyResult = ctx.consistencyResult;

        await executeContinuityCheckStage(ctx, deps, { dirs });

        ctx.visualEligibilityReport = buildVisualEligibilityReport(shots, imageResults);
        const visualEligibilityReport = ctx.visualEligibilityReport;
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
        await executePlanSceneGrammarStage(ctx, deps, {});
        await executePlanDirectorPacksStage(ctx, deps, {});
        await executePlanMotionStage(ctx, deps, {});
        await executePlanPerformanceStage(ctx, deps, {});
        await executeBuildStoryboardContextStage(ctx, deps, {});

        // 从 ctx 恢复本地变量，供后续阶段使用
        const scenePacks = ctx.scenePacks;
        const directorPacks = ctx.directorPacks;
        const motionPlan = ctx.motionPlan;
        const performancePlan = ctx.performancePlan;
        const storyboardContextMemory = ctx.storyboardContextMemory;

        let shotPackages = ctx.shotPackages;
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
          ctx.shotPackages = shotPackages;
        } else {
          logCachedStepRun("route_video_shots", "使用缓存的视频路由结果", "【Step 7/11】使用缓存的视频路由结果");
        }
        let preflightShotPackages = ctx.preflightShotPackages;
        let preflightQaReport = ctx.preflightQaReport;
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
          ctx.preflightShotPackages = preflightShotPackages;
          ctx.preflightQaReport = preflightQaReport;
        } else {
          logCachedStepRun("preflight_qa", "使用缓存的生成前质检结果", "【Step 10.5/15】使用缓存的生成前质检结果");
        }

        assertNoHardVisualBlocks('Preflight QA', preflightQaReport?.entries, 'reasons');

        const upstreamFailureInsights = buildUpstreamFailureInsights(visualEligibilityReport, preflightQaReport);
        saveState({ upstreamFailureInsights });
        ctx.upstreamFailureInsights = upstreamFailureInsights;

        let costGovernanceReport = deps.buildCostGovernanceReport({
          preflightShotPackages,
          consistencyNeedsRegeneration: consistencyResult?.needsRegeneration || [],
          costMetricsState: state.costMetrics,
          runId: runJobRef.id,
          policy: options.costPolicy || {},
        });
        deps.writeCostGovernanceArtifacts(costGovernanceReport, artifactContext.agents.costGovernance);
        saveState({ costGovernanceReport, costMetrics: costGovernanceReport?.costMetricsState || state.costMetrics || {} });
        ctx.costGovernanceReport = costGovernanceReport;

        let humanReviewQueue = deps.buildHumanReviewQueue({
          assetGovernanceReport: characterAssetGovernanceReport || null,
          consistencyResult,
          costReport: costGovernanceReport,
        });
        deps.writeHumanReviewQueueArtifacts(humanReviewQueue, artifactContext.agents.humanReviewQueue);
        saveState({ humanReviewQueue });
        ctx.humanReviewQueue = humanReviewQueue;

        if (stopAt.stopBeforeVideo) {
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

        await executeGenerateVideoClipsStage(ctx, deps, { dirs });

        await executeCostGovernanceStage(ctx, deps, { phase: 'post_video' });
        costGovernanceReport = ctx.costGovernanceReport;
        humanReviewQueue = ctx.humanReviewQueue;

        await executeEnhanceVideoClipsStage(ctx, deps, {});

        await executeShotQaStage(ctx, deps, {});

        await executeBridgeSubPipelineStage(ctx, deps, { dirs });

        await executeSequenceSubPipelineStage(ctx, deps, { dirs });

        await executeNormalizeDialogueStage(ctx, deps, {});
        await executeGenerateAudioStage(ctx, deps, { dirs });
        await executeTtsQaStage(ctx, deps, {});
        await executeLipsyncStage(ctx, deps, {});
        await executeCrossVideoConsistencyStage(ctx, deps, {});
        await executeAvPackagingStage(ctx, deps, {});

        deps.logger.info('Director', '【Step 13/13】合成视频...');
        await executeComposeVideoStage(ctx, deps, { dirs });

        await executePostComposeReviewStage(ctx, deps, {});

        await executeDeliverySummaryStage(ctx, deps, { dirs });

        const finalOutputPath = await executeFinishRunJobStage(ctx, deps, {});
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
                ...buildVisualEligibilityTopIssues(state?.visualEligibilityReport),
                ...buildUpstreamFailureTopIssues(state?.upstreamFailureInsights),
                ...buildPreflightTopIssues(state?.preflightQaReport),
                ...buildPreflightFixBriefTopIssues(state?.preflightQaReport),
                ...buildSeedanceInferenceTopIssues(failedSeedancePromptMetrics),
              ],
              summaryAppend: [
                buildVisualEligibilitySummaryText(state?.visualEligibilityReport),
                buildUpstreamFailureSummaryText(state?.upstreamFailureInsights),
                failedPreflightContextSummary,
                failedSeedanceInferenceSummary,
              ].filter(Boolean).join(' '),
            }),
            activeArtifactContext
          );
        }
        if (runJobRef && ctx.runJobCreated) {
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

  };

  return director;
}

const director = createDirector();

// P2b 批 1：纯函数区已搬至 director/runtimeSupport.js，此处仅转发以保持 __testables 导出面不变
export const __testables = {
  HARD_VISUAL_BLOCK_REASON_CODES: HARD_VISUAL_BLOCK_REASON_CODES,
  attachShotReferenceImagesToPrompts: attachShotReferenceImagesToPrompts,
  collectHardVisualBlockEntries: collectHardVisualBlockEntries,
  collectRunQaOverview: collectRunQaOverview,
  assertNoHardVisualBlocks: assertNoHardVisualBlocks,
  initializePhase4SequenceState: initializePhase4SequenceState,
  buildVisualEligibilityReport: buildVisualEligibilityReport,
  buildUpstreamFailureInsights: buildUpstreamFailureInsights,
  buildShotQaInputs: buildShotQaInputs,
  buildBridgeClipBridge: buildBridgeClipBridge,
  buildSequenceClipBridge: buildSequenceClipBridge,
  filterBridgeClipsAgainstSequences: filterBridgeClipsAgainstSequences,
  isReusableContinuityQaReport: isReusableContinuityQaReport,
  assertContinuityDeliveryGate: assertContinuityDeliveryGate,
  normalizeStopAt: normalizeStopAt,
};

export const runEpisodePipeline = director.runEpisodePipeline;
export default director;
