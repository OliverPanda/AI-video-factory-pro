/**
 * 导演Agent（Orchestrator）- 主编排器
 * 支持分集级别执行，并保留旧剧本文件入口的兼容桥接
 */

import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { parseScript } from './scriptParser.js';
import { buildCharacterRegistry } from './characterRegistry.js';
import { generateAllPrompts } from './promptEngineer.js';
import { generateAllImages, regenerateImage } from './imageGenerator.js';
import { runConsistencyCheck } from './consistencyChecker.js';
import { generateAllAudio } from './ttsAgent.js';
import { composeVideo } from './videoComposer.js';
import { createAnimationClip, createKeyframeAsset } from '../domain/assetModel.js';
import { createEpisode, createProject, createScript } from '../domain/projectModel.js';
import { loadEpisode, loadProject, loadScript, saveEpisode, saveProject, saveScript } from '../utils/projectStore.js';
import { generateJobId, initDirs, loadJSON, readTextFile, saveJSON } from '../utils/fileHelper.js';
import { appendAgentTaskRun, createRunJob, finishRunJob } from '../utils/jobStore.js';
import { createRunArtifactContext, initializeRunArtifacts } from '../utils/runArtifacts.js';
import { loadVoicePreset } from '../utils/voicePresetStore.js';
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

function normalizeProjectId(projectId) {
  return projectId ?? null;
}

export function createDirector(overrides = {}) {
  const deps = {
    parseScript,
    buildCharacterRegistry,
    generateAllPrompts,
    generateAllImages,
    regenerateImage,
    runConsistencyCheck,
    generateAllAudio,
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

      function saveState(update) {
        Object.assign(state, update);
        deps.saveJSON(stateFile, state);
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
        const projectName = project?.name || projectId;
        const scriptTitle = script.title || 'untitled_script';
        const episodeTitle = episode.title || `episode_${episodeId}`;
        runJobRef = {
          id: createRunJobAttemptId(jobId),
          projectId,
          scriptId,
          episodeId,
        };
        const artifactContext = createRunArtifactContext({
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
                characters,
                `${scriptTitle}：${buildEpisodeContext(script, episode).slice(0, 500)}`,
                style
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
            deps.generateAllPrompts(shots, characterRegistry, style)
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
            deps.generateAllImages(promptList, dirs.images, { style })
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
            deps.logger.info('Director', '【Step 4/6】一致性验证...');
            const { needsRegeneration } = await recordStep(
              'consistency_check',
              { message: '一致性验证' },
              () => deps.runConsistencyCheck(characterRegistry, imageResults)
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

                    const index = imageResults.findIndex((result) => result.shotId === item.shotId);
                    if (index >= 0) {
                      imageResults[index] = {
                        ...imageResults[index],
                        ...regeneratedResult,
                        success: true,
                      };
                    }
                  }
                }
              );
            }

            saveState({ imageResults, consistencyCheckDone: true });
          } else {
            deps.logger.info('Director', '【Step 4/6】使用缓存的一致性检查结果');
            appendStepRun('consistency_check', {
              status: 'cached',
              detail: '使用缓存的一致性检查结果',
            });
          }
        } else {
          deps.logger.info('Director', '【Step 4/6】跳过一致性检查');
          appendStepRun('consistency_check', {
            status: 'skipped',
            detail: '跳过一致性检查',
          });
        }

        const voiceProjectId = normalizeProjectId(
          options.voiceProjectId === undefined ? projectId : options.voiceProjectId
        );
        const cachedAudioProjectId = normalizeProjectId(state.audioProjectId);
        const canReuseAudioCache = state.audioResults && cachedAudioProjectId === voiceProjectId;
        let audioResults = canReuseAudioCache ? state.audioResults : null;
        if (!audioResults) {
          deps.logger.info('Director', '【Step 5/6】生成配音...');
          const audioOptions = voiceProjectId
            ? {
                projectId: voiceProjectId,
                voicePresetLoader: (voicePresetId, loadOptions = {}) =>
                  deps.loadVoicePreset(voiceProjectId, voicePresetId, loadOptions),
              }
            : {};
          audioResults = await recordStep('generate_audio', { message: '生成配音' }, () =>
            deps.generateAllAudio(shots, characterRegistry, dirs.audio, audioOptions)
          );
          saveState({ audioResults, audioProjectId: voiceProjectId });
        } else {
          deps.logger.info('Director', '【Step 5/6】使用缓存的音频结果');
          appendStepRun('generate_audio', {
            status: 'cached',
            detail: '使用缓存的音频结果',
          });
          saveState({ audioProjectId: cachedAudioProjectId });
        }

        deps.logger.info('Director', '【Step 6/6】合成视频...');
        const outputFileName =
          `${sanitizeFileSegment(scriptTitle, 'script')}_${sanitizeFileSegment(episodeTitle, 'episode')}_${jobId}.mp4`;
        const outputPath = path.join(dirs.output, outputFileName);
        const animationClips = buildAnimationClipBridge(
          imageResults,
          state.animationClips || episode.animationClips || []
        );

        await recordStep('compose_video', { message: '合成视频' }, () =>
          deps.composeVideo(shots, imageResults, audioResults, outputPath, {
            title: `${scriptTitle} - ${episodeTitle}`,
            animationClips,
          })
        );

        saveState({ outputPath, completedAt: new Date().toISOString() });
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
        deps.logger.info('Director', `\n✅ 任务完成！\n   视频路径：${outputPath}`);
        return outputPath;
      } catch (err) {
        deps.logger.error('Director', `任务失败：${err.message}`);
        deps.logger.error('Director', err.stack);
        saveState({ lastError: err.message, failedAt: new Date().toISOString() });
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

      deps.logger.info('Director', `=== 开始兼容任务 ${legacy.jobId} ===`);
      deps.logger.info('Director', `剧本：${scriptFilePath} | 风格：${style}`);

      const dirs = deps.initDirs(legacy.jobId);
      const stateFile = path.join(dirs.root, 'state.json');
      const state = deps.loadJSON(stateFile) || {};

      function saveState(update) {
        Object.assign(state, update);
        deps.saveJSON(stateFile, state);
      }

      try {
        const scriptText = deps.readTextFile(scriptFilePath);
        const scriptContentHash = hashContent(scriptText);
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
            scriptData = await deps.parseScript(scriptText);
          }
        }

        const title = scriptData.title || path.basename(scriptFilePath, path.extname(scriptFilePath));
        const characters = scriptData.characters || [];
        const shots = scriptData.shots || [];

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
