/**
 * 导演Agent（Orchestrator）- 主编排器
 * 支持分集级别执行，并保留旧剧本文件入口的兼容桥接
 */

import fs from 'node:fs';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { parseScript } from './scriptParser.js';
import { buildCharacterRegistry } from './characterRegistry.js';
import { applyContinuityRepairHints, generateAllPrompts } from './promptEngineer.js';
import { generateAllImages, regenerateImage } from './imageGenerator.js';
import { runConsistencyCheck } from './consistencyChecker.js';
import { runContinuityCheck } from './continuityChecker.js';
import { normalizeDialogueShots } from './dialogueNormalizer.js';
import { generateAllAudio } from './ttsAgent.js';
import { runTtsQa } from './ttsQaAgent.js';
import { runLipsync } from './lipsyncAgent.js';
import { planMotion } from './motionPlanner.js';
import { planPerformance } from './performancePlanner.js';
import { routeVideoShots } from './videoRouter.js';
import { runRunwayVideo } from './runwayVideoAgent.js';
import { runMotionEnhancer } from './motionEnhancer.js';
import { runShotQa } from './shotQaAgent.js';
import { composeVideo } from './videoComposer.js';
import { createAnimationClip, createKeyframeAsset } from '../domain/assetModel.js';
import { createEpisode, createProject, createScript } from '../domain/projectModel.js';
import { loadEpisode, loadProject, loadScript, saveEpisode, saveProject, saveScript } from '../utils/projectStore.js';
import { ensureDir, generateJobId, initDirs, loadJSON, readTextFile, saveJSON } from '../utils/fileHelper.js';
import { appendAgentTaskRun, createRunJob, finishRunJob } from '../utils/jobStore.js';
import { adoptAgentArtifacts, createRunArtifactContext, initializeRunArtifacts } from '../utils/runArtifacts.js';
import { listCharacterBibles } from '../utils/characterBibleStore.js';
import { loadPronunciationLexicon } from '../utils/pronunciationLexiconStore.js';
import { writeRunQaOverview } from '../utils/qaSummary.js';
import { loadVoiceCast } from '../utils/voiceCastStore.js';
import { loadVoicePreset } from '../utils/voicePresetStore.js';
import { buildEpisodeDirName, buildProjectDirName } from '../utils/naming.js';
import logger from '../utils/logger.js';

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

function hashContent(value) {
  return createHash('sha1').update(String(value || '')).digest('hex');
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
      provider: result.provider || 'runway',
    }));
}

function normalizeProjectId(projectId) {
  return projectId ?? null;
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
  composeResult,
}) {
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
  const plannedVideoShotCount = Array.isArray(motionPlan) ? motionPlan.length : 0;
  const generatedVideoShotCount = Array.isArray(videoResults)
    ? videoResults.filter((item) => item?.status === 'completed' && item?.videoPath).length
    : 0;
  const fallbackVideoShotCount = Number.isFinite(shotQaReport?.fallbackCount) ? shotQaReport.fallbackCount : 0;
  const videoProviderBreakdown = videoResults
    ? videoResults.reduce((acc, item) => {
        const key = item?.provider || item?.preferredProvider || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    : {};

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
    `- Planned Video Shots：${plannedVideoShotCount}`,
    `- Generated Video Shots：${generatedVideoShotCount}`,
    `- Video Provider Breakdown：${Object.keys(videoProviderBreakdown).length > 0 ? JSON.stringify(videoProviderBreakdown) : '{}'}`,
    `- Fallback Video Shots：${fallbackVideoShotCount}`,
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

function readJSONSafe(loadJSONFn, filePath, fallback) {
  try {
    return loadJSONFn(filePath) ?? fallback;
  } catch {
    return fallback;
  }
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
    motionEnhancer: 'Motion Enhancer',
    shotQaAgent: 'Shot QA Agent',
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
    'motionEnhancer',
    'shotQaAgent',
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
        nextAction: '如需详细判断，请继续查看该 agent 的 manifest 和核心产物。',
        evidenceFiles: ['manifest.json'],
        metrics: {},
      };
    })
    .filter(Boolean);

  const passCount = agentSummaries.filter((item) => item.status === 'pass').length;
  const warnCount = agentSummaries.filter((item) => item.status === 'warn').length;
  const blockCount = agentSummaries.filter((item) => item.status === 'block').length;
  const releasable = options.releasable ?? blockCount === 0;
  let status = blockCount > 0 ? 'block' : warnCount > 0 ? 'warn' : 'pass';
  let topIssues = [
    ...agentSummaries
      .filter((item) => item.status === 'block')
      .flatMap((item) => (item.blockItems || []).slice(0, 2).map((issue) => `${item.agentName}: ${issue}`)),
    ...agentSummaries
      .filter((item) => item.status === 'warn')
      .flatMap((item) => (item.warnItems || []).slice(0, 2).map((issue) => `${item.agentName}: ${issue}`)),
  ].slice(0, 5);

  if (!releasable) {
    status = 'block';
    topIssues = topIssues.length > 0 ? topIssues : ['Director: 本轮运行未完成，当前不能交付'];
  }

  const headline =
    status === 'pass'
      ? '本轮主要 agent 都已达标'
      : status === 'warn'
        ? `本轮可继续交付，但有 ${warnCount} 个 agent 需要留意`
        : `本轮有 ${blockCount} 个 agent 处于阻断状态`;

  const summary =
    status === 'pass'
      ? '核心成果物已经齐备，当前没有明显阻断问题。'
      : status === 'warn'
        ? '主要链路已经跑通，但仍有风险项需要研发或人工复查。'
        : '至少有一个关键 agent 未达标，需要先修复后再交付。';

  return {
    status,
    releasable,
    headline,
    summary,
    passCount,
    warnCount,
    blockCount,
    agentSummaries,
    topIssues,
  };
}

export function createDirector(overrides = {}) {
  const deps = {
    parseScript,
    buildCharacterRegistry,
    generateAllPrompts,
    generateAllImages,
    regenerateImage,
    runConsistencyCheck,
    runContinuityCheck,
    normalizeDialogueShots,
    generateAllAudio,
    runTtsQa,
    runLipsync,
    planMotion,
    planPerformance,
    routeVideoShots,
    runRunwayVideo,
    runMotionEnhancer,
    runShotQa,
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
      const state = deps.loadJSON(stateFile) || {};
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
                  for (const item of needsRegeneration) {
                    const originalPrompt = promptList.find((prompt) => prompt.shotId === item.shotId);
                    if (!originalPrompt) continue;

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
                  for (const item of flaggedTransitions) {
                    if (item.recommendedAction === 'pass') {
                      repairAttempts.push({
                        shotId: item.shotId,
                        attempted: false,
                        repairMethod: item.repairMethod || null,
                        success: true,
                        reason: 'pass',
                      });
                      continue;
                    }

                    if (item.recommendedAction === 'manual_review') {
                      repairAttempts.push({
                        shotId: item.shotId,
                        attempted: false,
                        repairMethod: item.repairMethod || 'manual_review',
                        success: true,
                        reason: 'manual_review',
                      });
                      continue;
                    }

                    const originalPrompt = promptList.find((prompt) => prompt.shotId === item.shotId);
                    if (!originalPrompt) {
                      repairAttempts.push({
                        shotId: item.shotId,
                        attempted: true,
                        repairMethod: item.repairMethod || 'prompt_regen',
                        success: false,
                        error: 'missing original prompt',
                      });
                      continue;
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
                      repairAttempts.push({
                        shotId: item.shotId,
                        attempted: true,
                        repairMethod: item.repairMethod || 'prompt_regen',
                        success: false,
                        error: regeneratedResult.error || 'unknown error',
                      });
                      continue;
                    }

                    const shot = shots.find((entry) => entry.id === item.shotId);
                    const index = imageResults.findIndex((result) => result.shotId === item.shotId);
                    if (index >= 0) {
                      imageResults[index] = {
                        ...imageResults[index],
                        ...regeneratedResult,
                        characters: shot?.characters || imageResults[index]?.characters || [],
                      };
                    }

                    repairAttempts.push({
                      shotId: item.shotId,
                      attempted: true,
                      repairMethod: item.repairMethod || 'prompt_regen',
                      success: true,
                    });
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

        let motionPlan = Array.isArray(state.motionPlan) ? state.motionPlan : null;
        if (!motionPlan) {
          deps.logger.info('Director', '【Step 6/11】规划动态镜头...');
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
          deps.logger.info('Director', '【Step 7/13】规划镜头表演...');
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
          deps.logger.info('Director', '【Step 8/13】路由视频镜头...');
          shotPackages = await recordStep('route_video_shots', { message: '路由视频镜头' }, () =>
            deps.routeVideoShots(shots, motionPlan, imageResults, {
              performancePlan,
              promptList,
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

        let rawVideoResults = Array.isArray(state.rawVideoResults) ? state.rawVideoResults : null;
        if (!rawVideoResults) {
          deps.logger.info('Director', '【Step 9/13】生成动态镜头...');
          const videoRun = await recordStep('generate_video_clips', { message: '生成动态镜头' }, () =>
            deps.runRunwayVideo(
              shotPackages,
              dirs.video || path.join(dirs.root, 'video'),
              {
                artifactContext: artifactContext.agents.runwayVideoAgent,
              }
            )
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
            deps.runMotionEnhancer(rawVideoResults, shotPackages, {
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
          shotQaReport = await recordStep('shot_qa', { message: '镜头级 QA' }, () =>
            deps.runShotQa(enhancedVideoResults, {
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
                provider: 'runway',
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
          ? deps.loadVoiceCast(voiceProjectId, options.storeOptions) || []
          : [];
        const cachedAudioProjectId = normalizeProjectId(state.audioProjectId);
        const canReuseAudioCache = state.audioResults && cachedAudioProjectId === voiceProjectId;
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
          saveState({ audioResults, audioVoiceResolution, audioProjectId: voiceProjectId });
        } else {
          deps.logger.info('Director', '【Step 13/14】使用缓存的音频结果');
          appendStepRun('generate_audio', {
            status: 'cached',
            detail: '使用缓存的音频结果',
          });
          saveState({ audioProjectId: cachedAudioProjectId });
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

        let lipsyncResults = Array.isArray(state.lipsyncResults) ? state.lipsyncResults : null;
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
          saveState({ lipsyncResults, lipsyncReport });
        } else {
          deps.logger.info('Director', '【Step 12/13】使用缓存的口型同步结果');
          appendStepRun('lipsync', {
            status: 'cached',
            detail: '使用缓存的口型同步结果',
          });
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

        const composeRun = await recordStep('compose_video', { message: '合成视频' }, () =>
          deps.composeVideo(normalizedShots, imageResults, audioResults, outputPath, {
            title: `${scriptTitle} - ${episodeTitle}`,
            videoClips,
            animationClips,
            lipsyncClips: lipsyncResults,
            artifactContext: artifactContext.agents.videoComposer,
            ttsQaReport,
            lipsyncReport,
          })
        );
        const composeResult = normalizeComposeResult(composeRun, outputPath);
        const finalOutputPath = composeResult.outputVideo.uri || outputPath;

        if (composeResult.status === 'blocked') {
          throw new Error(
            `Compose 阻断交付：${(composeResult.report?.blockedReasons || []).join('；') || 'unknown compose block'}`
          );
        }

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
            composeResult,
          }),
          'utf-8'
        );
        writeRunQaOverview(
          collectRunQaOverview(deps.loadJSON, artifactContext, { releasable: true }),
          artifactContext
        );

        saveState({
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
          writeRunQaOverview(
            collectRunQaOverview(deps.loadJSON, activeArtifactContext, { releasable: false }),
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
      const state = deps.loadJSON(stateFile) || {};
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
        let bootstrapParserArtifactContext = null;
        const contentChanged =
          state.compatibility?.scriptContentHash &&
          state.compatibility.scriptContentHash !== scriptContentHash;

        if (contentChanged) {
          for (const key of Object.keys(state)) {
            delete state[key];
          }
        }

        const existingScript =
          deps.loadScript(legacy.projectId, legacy.scriptId, options.storeOptions) || null;
        const existingEpisode =
          deps.loadEpisode(legacy.projectId, legacy.scriptId, legacy.episodeId, options.storeOptions) ||
          null;

        let scriptData = state.scriptData;
        if (!scriptData) {
          if (
            existingScript &&
            existingEpisode &&
            existingScript.sourceText === scriptText
          ) {
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
          },
          scriptData,
        });

        if (
          !existingScript ||
          !existingEpisode ||
          existingScript.sourceText !== scriptText
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

export const runEpisodePipeline = director.runEpisodePipeline;
export const runPipeline = director.runPipeline;
export default director;
