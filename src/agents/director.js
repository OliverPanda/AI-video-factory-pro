/**
 * 导演Agent（Orchestrator）- 主编排器
 * 支持分集级别执行，并保留旧剧本文件入口的兼容桥接
 */

import path from 'path';
import { createHash } from 'node:crypto';
import { parseScript } from './scriptParser.js';
import { buildCharacterRegistry } from './characterRegistry.js';
import { generateAllPrompts } from './promptEngineer.js';
import { generateAllImages, regenerateImage } from './imageGenerator.js';
import { runConsistencyCheck } from './consistencyChecker.js';
import { generateAllAudio } from './ttsAgent.js';
import { composeVideo } from './videoComposer.js';
import { createEpisode, createProject, createScript } from '../domain/projectModel.js';
import { loadEpisode, loadScript, saveEpisode, saveProject, saveScript } from '../utils/projectStore.js';
import { generateJobId, initDirs, loadJSON, readTextFile, saveJSON } from '../utils/fileHelper.js';
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
    loadScript,
    loadEpisode,
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

      function saveState(update) {
        Object.assign(state, update);
        deps.saveJSON(stateFile, state);
      }

      try {
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
        const scriptTitle = script.title || 'untitled_script';
        const episodeTitle = episode.title || `episode_${episodeId}`;

        deps.logger.info(
          'Director',
          `剧名：${scriptTitle}，分集：${episodeTitle}，共 ${shots.length} 个分镜，${characters.length} 个角色`
        );

        let characterRegistry = state.characterRegistry;
        if (!characterRegistry) {
          deps.logger.info('Director', '【Step 1/6】构建角色档案...');
          characterRegistry = await deps.buildCharacterRegistry(
            characters,
            `${scriptTitle}：${buildEpisodeContext(script, episode).slice(0, 500)}`,
            style
          );
          saveState({ characterRegistry });
        } else {
          deps.logger.info('Director', '【Step 1/6】使用缓存的角色档案');
        }

        let promptList = state.promptList;
        if (!promptList) {
          deps.logger.info('Director', '【Step 2/6】生成图像Prompt...');
          promptList = await deps.generateAllPrompts(shots, characterRegistry, style);
          saveState({ promptList });
        } else {
          deps.logger.info('Director', '【Step 2/6】使用缓存的Prompt列表');
        }

        let imageResults = state.imageResults;
        if (!imageResults) {
          deps.logger.info('Director', '【Step 3/6】生成分镜图像...');
          imageResults = await deps.generateAllImages(promptList, dirs.images, { style });
          imageResults = imageResults.map((result) => {
            const shot = shots.find((item) => item.id === result.shotId);
            return { ...result, characters: shot?.characters || [] };
          });
          saveState({ imageResults });
        } else {
          deps.logger.info('Director', '【Step 3/6】使用缓存的图像结果');
          if (imageResults.some((result) => !result.characters)) {
            imageResults = imageResults.map((result) => {
              if (result.characters) return result;
              const shot = shots.find((item) => item.id === result.shotId);
              return { ...result, characters: shot?.characters || [] };
            });
            saveState({ imageResults });
          }
        }

        if (!options.skipConsistencyCheck) {
          if (!state.consistencyCheckDone) {
            deps.logger.info('Director', '【Step 4/6】一致性验证...');
            const { needsRegeneration } = await deps.runConsistencyCheck(characterRegistry, imageResults);

            if (needsRegeneration.length > 0) {
              deps.logger.info(
                'Director',
                `重新生成 ${needsRegeneration.length} 个一致性不足的镜头...`
              );
              for (const item of needsRegeneration) {
                const originalPrompt = promptList.find((prompt) => prompt.shotId === item.shotId);
                if (!originalPrompt) continue;

                const adjustedPrompt =
                  `${originalPrompt.image_prompt}, highly consistent character appearance, ` +
                  `${item.suggestion || ''}`;
                const newPath = await deps.regenerateImage(
                  item.shotId,
                  adjustedPrompt,
                  originalPrompt.negative_prompt,
                  dirs.images,
                  { style }
                );

                const index = imageResults.findIndex((result) => result.shotId === item.shotId);
                if (index >= 0) {
                  imageResults[index].imagePath = newPath;
                  imageResults[index].success = true;
                }
              }
            }

            saveState({ imageResults, consistencyCheckDone: true });
          } else {
            deps.logger.info('Director', '【Step 4/6】使用缓存的一致性检查结果');
          }
        } else {
          deps.logger.info('Director', '【Step 4/6】跳过一致性检查');
        }

        let audioResults = state.audioResults;
        if (!audioResults) {
          deps.logger.info('Director', '【Step 5/6】生成配音...');
          audioResults = await deps.generateAllAudio(shots, characterRegistry, dirs.audio);
          saveState({ audioResults });
        } else {
          deps.logger.info('Director', '【Step 5/6】使用缓存的音频结果');
        }

        deps.logger.info('Director', '【Step 6/6】合成视频...');
        const outputFileName =
          `${sanitizeFileSegment(scriptTitle, 'script')}_${sanitizeFileSegment(episodeTitle, 'episode')}_${jobId}.mp4`;
        const outputPath = path.join(dirs.output, outputFileName);

        await deps.composeVideo(shots, imageResults, audioResults, outputPath, {
          title: `${scriptTitle} - ${episodeTitle}`,
        });

        saveState({ outputPath, completedAt: new Date().toISOString() });
        deps.logger.info('Director', `\n✅ 任务完成！\n   视频路径：${outputPath}`);
        return outputPath;
      } catch (err) {
        deps.logger.error('Director', `任务失败：${err.message}`);
        deps.logger.error('Director', err.stack);
        saveState({ lastError: err.message, failedAt: new Date().toISOString() });
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
        const existingScript =
          deps.loadScript(legacy.projectId, legacy.scriptId, options.storeOptions) || null;
        const existingEpisode =
          deps.loadEpisode(legacy.projectId, legacy.scriptId, legacy.episodeId, options.storeOptions) ||
          null;

        let scriptData = state.scriptData;
        if (!scriptData) {
          if (existingScript && existingEpisode) {
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
            projectId: legacy.projectId,
            scriptId: legacy.scriptId,
            episodeId: legacy.episodeId,
          },
          scriptData,
        });

        if (!existingScript || !existingEpisode) {
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

export const runEpisodePipeline = director.runEpisodePipeline;
export const runPipeline = director.runPipeline;
export default director;
