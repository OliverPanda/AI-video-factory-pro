/**
 * 一致性验证Agent - 用多模态LLM检查角色跨镜头外观一致性
 */

import fs from 'fs';
import path from 'path';
import { visionChat, parseJSONResponse } from '../llm/client.js';
import { CONSISTENCY_CHECK_SYSTEM, CONSISTENCY_CHECK_USER } from '../llm/prompts/consistencyCheck.js';
import { imageToBase64 } from '../utils/fileHelper.js';
import logger from '../utils/logger.js';

const SCORE_THRESHOLD = parseInt(process.env.CONSISTENCY_THRESHOLD || '7', 10);
// 每批最多发送几张图给视觉LLM（防止单次 base64 占用过大内存）
const BATCH_SIZE = parseInt(process.env.CONSISTENCY_BATCH_SIZE || '6', 10);

/**
 * 验证同一角色在多张图片中的一致性
 * @param {string} characterName
 * @param {Object} characterCard - 来自CharacterRegistry
 * @param {Array<{shotId, imagePath}>} imageList - 包含该角色的图像列表
 * @returns {Promise<ConsistencyReport>}
 */
export async function checkCharacterConsistency(characterName, characterCard, imageList) {
  // 过滤不存在的图像
  const validImages = imageList.filter((img) => img.imagePath && fs.existsSync(img.imagePath));
  if (validImages.length < 2) {
    logger.debug('ConsistencyChecker', `${characterName} 图像不足2张，跳过一致性检查`);
    return { character: characterName, overallScore: 10, problematicImageIndices: [], skipped: true };
  }

  logger.info('ConsistencyChecker', `检查 ${characterName} 在 ${validImages.length} 张图中的一致性...`);

  // 分批处理：每批最多 BATCH_SIZE 张图，防止单次 base64 占用过大内存
  // 多批结果取平均分，问题图像索引做全局偏移
  const batches = [];
  for (let i = 0; i < validImages.length; i += BATCH_SIZE) {
    batches.push(validImages.slice(i, i + BATCH_SIZE));
  }

  const allReports = [];
  const allProblematicIndices = [];

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const globalOffset = batchIdx * BATCH_SIZE;

    // 逐张转 base64，用后立即释放引用
    const imageBase64List = batch.map((img) => imageToBase64(img.imagePath));

    const prompt = CONSISTENCY_CHECK_USER(characterName, characterCard, batch.length);

    try {
      const raw = await visionChat(prompt, imageBase64List, {
        maxTokens: 1024,
        temperature: 0.2,
      });

      const report = parseJSONResponse(raw);

      // 将批内索引转为全局索引
      const globalIndices = (report.problematicImageIndices || []).map((i) => i + globalOffset);
      allProblematicIndices.push(...globalIndices);
      allReports.push(report);
    } catch (err) {
      logger.warn('ConsistencyChecker', `批次 ${batchIdx + 1}/${batches.length} 检查失败：${err.message}，跳过`);
    }
  }

  if (allReports.length === 0) {
    return { character: characterName, overallScore: 10, problematicImageIndices: [], error: '所有批次均失败' };
  }

  // 汇总：取所有批次的平均分
  const avgScore = Math.round(
    allReports.reduce((sum, r) => sum + (r.overallScore || 10), 0) / allReports.length
  );
  const lastReport = allReports[allReports.length - 1];

  const finalReport = {
    character: characterName,
    overallScore: avgScore,
    details: lastReport.details,
    problematicImageIndices: [...new Set(allProblematicIndices)], // 去重
    suggestion: lastReport.suggestion,
    imageList: validImages,
  };

  logger.info('ConsistencyChecker', `${characterName} 一致性评分：${avgScore}/10`);
  return finalReport;
}

/**
 * 对所有角色执行一致性验证
 * @param {Array} characterRegistry - 角色档案列表
 * @param {Array<{shotId, imagePath, characters}>} imageResults - 图像生成结果（含角色信息）
 * @returns {Promise<{reports, needsRegeneration: Array<{shotId, reason}>}>}
 */
export async function runConsistencyCheck(characterRegistry, imageResults) {
  const reports = [];
  const needsRegeneration = [];

  for (const charCard of characterRegistry) {
    // 找出包含该角色的图像
    const charImages = imageResults.filter(
      (r) => r.success && r.characters?.includes(charCard.name)
    );

    if (charImages.length === 0) continue;

    const report = await checkCharacterConsistency(charCard.name, charCard, charImages);
    reports.push(report);

    // 低于阈值的图像标记为需要重生成
    if (report.overallScore < SCORE_THRESHOLD && !report.skipped) {
      const badIndices = report.problematicImageIndices || [];
      badIndices.forEach((idx) => {
        if (charImages[idx]) {
          needsRegeneration.push({
            shotId: charImages[idx].shotId,
            reason: `${charCard.name} 一致性评分 ${report.overallScore}/10`,
            suggestion: report.suggestion,
          });
        }
      });
    }
  }

  logger.info(
    'ConsistencyChecker',
    `一致性检查完成。需要重生成：${needsRegeneration.length} 个镜头`
  );

  return { reports, needsRegeneration };
}
