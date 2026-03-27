/**
 * 导演Agent（Orchestrator）- 主编排器
 * 读取剧本，调度所有子Agent，处理异常，输出最终视频
 */

import path from 'path';
import { parseScript } from './scriptParser.js';
import { buildCharacterRegistry } from './characterRegistry.js';
import { generateAllPrompts } from './promptEngineer.js';
import { generateAllImages, regenerateImage } from './imageGenerator.js';
import { runConsistencyCheck } from './consistencyChecker.js';
import { generateAllAudio } from './ttsAgent.js';
import { composeVideo } from './videoComposer.js';
import { saveJSON, loadJSON, initDirs, generateJobId, readTextFile } from '../utils/fileHelper.js';
import logger from '../utils/logger.js';

/**
 * 主入口：从剧本文件生成视频
 * @param {string} scriptFilePath - 剧本文件路径
 * @param {Object} options - { style: 'realistic'|'3d', skipConsistencyCheck: bool }
 * @returns {Promise<string>} 最终视频路径
 */
export async function runPipeline(scriptFilePath, options = {}) {
  const style = options.style || process.env.IMAGE_STYLE || 'realistic';
  const jobId = generateJobId(path.basename(scriptFilePath));

  logger.info('Director', `=== 开始任务 ${jobId} ===`);
  logger.info('Director', `剧本：${scriptFilePath} | 风格：${style}`);

  // ─── 初始化目录 ──────────────────────────────────────────
  const dirs = initDirs(jobId);
  const stateFile = path.join(dirs.root, 'state.json');
  const state = loadJSON(stateFile) || {};

  function saveState(update) {
    Object.assign(state, update);
    saveJSON(stateFile, state);
  }

  try {
    // ─── Step 1: 读取剧本 ─────────────────────────────────
    const scriptText = readTextFile(scriptFilePath);
    logger.info('Director', `剧本字数：${scriptText.length}`);

    // ─── Step 2: 解析剧本 ─────────────────────────────────
    let scriptData = state.scriptData;
    if (!scriptData) {
      logger.info('Director', '【Step 1/6】解析剧本...');
      scriptData = await parseScript(scriptText);
      saveState({ scriptData });
    } else {
      logger.info('Director', '【Step 1/6】使用缓存的剧本解析结果');
    }

    const { shots, characters, title } = scriptData;
    logger.info('Director', `剧名：${title}，共 ${shots.length} 个分镜，${characters.length} 个角色`);

    // ─── Step 3: 构建角色档案 ─────────────────────────────
    let characterRegistry = state.characterRegistry;
    if (!characterRegistry) {
      logger.info('Director', '【Step 2/6】构建角色档案...');
      characterRegistry = await buildCharacterRegistry(
        characters,
        `${title}：${scriptText.slice(0, 500)}`,
        style
      );
      saveState({ characterRegistry });
    } else {
      logger.info('Director', '【Step 2/6】使用缓存的角色档案');
    }

    // ─── Step 4: 生成图像Prompt ───────────────────────────
    let promptList = state.promptList;
    if (!promptList) {
      logger.info('Director', '【Step 3/6】生成图像Prompt...');
      promptList = await generateAllPrompts(shots, characterRegistry, style);
      saveState({ promptList });
    } else {
      logger.info('Director', '【Step 3/6】使用缓存的Prompt列表');
    }

    // ─── Step 5: 生成图像 ──────────────────────────────────
    let imageResults = state.imageResults;
    if (!imageResults) {
      logger.info('Director', '【Step 4/6】生成分镜图像...');
      imageResults = await generateAllImages(promptList, dirs.images, { style });
      // 附加角色信息（用于一致性检查），保存前完成，确保缓存中也有该字段
      imageResults = imageResults.map((r) => {
        const shot = shots.find((s) => s.id === r.shotId);
        return { ...r, characters: shot?.characters || [] };
      });
      saveState({ imageResults });
    } else {
      logger.info('Director', '【Step 4/6】使用缓存的图像结果');
      // 兼容旧缓存：若 characters 字段缺失（旧版本生成的 state），补全它
      const missingChars = imageResults.some((r) => !r.characters);
      if (missingChars) {
        imageResults = imageResults.map((r) => {
          if (r.characters) return r;
          const shot = shots.find((s) => s.id === r.shotId);
          return { ...r, characters: shot?.characters || [] };
        });
        saveState({ imageResults });
      }
    }

    // ─── Step 6: 一致性检查（可选） ───────────────────────
    if (!options.skipConsistencyCheck) {
      // 断点续跑：若上次已完成一致性检查，跳过
      if (!state.consistencyCheckDone) {
        logger.info('Director', '【Step 4b/6】一致性验证...');
        const { needsRegeneration } = await runConsistencyCheck(characterRegistry, imageResults);

        if (needsRegeneration.length > 0) {
          logger.info('Director', `重新生成 ${needsRegeneration.length} 个一致性不足的镜头...`);
          for (const item of needsRegeneration) {
            const originalPrompt = promptList.find((p) => p.shotId === item.shotId);
            if (!originalPrompt) continue;

            // 调整Prompt（加入一致性建议）
            const adjustedPrompt = `${originalPrompt.image_prompt}, highly consistent character appearance, ${item.suggestion || ''}`;
            const newPath = await regenerateImage(
              item.shotId,
              adjustedPrompt,
              originalPrompt.negative_prompt,
              dirs.images,
              { style }
            );

            const idx = imageResults.findIndex((r) => r.shotId === item.shotId);
            if (idx >= 0) {
              imageResults[idx].imagePath = newPath;
              imageResults[idx].success = true; // 重新生成后标记为成功
            }
          }
        }

        saveState({ imageResults, consistencyCheckDone: true });
      } else {
        logger.info('Director', '【Step 4b/6】使用缓存的一致性检查结果');
      }
    } else {
      logger.info('Director', '【Step 4b/6】跳过一致性检查');
    }

    // ─── Step 7: 生成配音 ──────────────────────────────────
    let audioResults = state.audioResults;
    if (!audioResults) {
      logger.info('Director', '【Step 5/6】生成配音...');
      audioResults = await generateAllAudio(shots, characterRegistry, dirs.audio);
      saveState({ audioResults });
    } else {
      logger.info('Director', '【Step 5/6】使用缓存的音频结果');
    }

    // ─── Step 8: 合成视频 ──────────────────────────────────
    logger.info('Director', '【Step 6/6】合成视频...');
    const outputFileName = `${title.replace(/[^\w\u4e00-\u9fa5]/g, '_')}_${jobId}.mp4`;
    const outputPath = path.join(dirs.output, outputFileName);

    await composeVideo(shots, imageResults, audioResults, outputPath, { title });

    saveState({ outputPath, completedAt: new Date().toISOString() });

    logger.info('Director', `\n✅ 任务完成！\n   视频路径：${outputPath}`);
    return outputPath;
  } catch (err) {
    logger.error('Director', `任务失败：${err.message}`);
    logger.error('Director', err.stack);
    saveState({ lastError: err.message, failedAt: new Date().toISOString() });
    throw err;
  }
}
