/**
 * 一致性验证Agent - 用多模态LLM检查角色跨镜头外观一致性
 */

import fs from 'fs';
import path from 'path';
import { visionChat, parseJSONResponse } from '../llm/client.js';
import { CONSISTENCY_CHECK_SYSTEM, CONSISTENCY_CHECK_USER } from '../llm/prompts/consistencyCheck.js';
import { imageToBase64, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import logger from '../utils/logger.js';

const SCORE_THRESHOLD = parseInt(process.env.CONSISTENCY_THRESHOLD || '7', 10);
// 每批最多发送几张图给视觉LLM（防止单次 base64 占用过大内存）
const BATCH_SIZE = parseInt(process.env.CONSISTENCY_BATCH_SIZE || '6', 10);

function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function buildConsistencyMarkdown(reports, needsRegeneration) {
  const lines = [
    '# Consistency Report',
    '',
    `- Checked Characters: ${reports.length}`,
    `- Flagged Shots: ${needsRegeneration.length}`,
    '',
  ];

  if (reports.length === 0) {
    lines.push('No consistency reports were generated.');
  }

  for (const report of reports) {
    lines.push(`## ${report.character}`);
    lines.push(`- Overall Score: ${report.overallScore ?? 'n/a'}`);
    lines.push(`- Skipped: ${report.skipped ? 'yes' : 'no'}`);
    if (report.details) {
      lines.push(`- Details: ${JSON.stringify(report.details)}`);
    }
    if (Array.isArray(report.identityDriftTags) && report.identityDriftTags.length > 0) {
      lines.push(`- Identity Drift Tags: ${report.identityDriftTags.join(', ')}`);
    }
    if (report.anchorSummary) {
      lines.push(`- Anchor Summary: ${JSON.stringify(report.anchorSummary)}`);
    }
    if (report.suggestion) {
      lines.push(`- Suggestion: ${report.suggestion}`);
    }
    if (Array.isArray(report.problematicImageIndices) && report.problematicImageIndices.length > 0) {
      lines.push(`- Problematic Image Indices: ${report.problematicImageIndices.join(', ')}`);
    }
    if (report.error) {
      lines.push(`- Error: ${report.error}`);
    }
    lines.push('');
  }

  if (needsRegeneration.length > 0) {
    lines.push('## Flagged Shots');
    for (const item of needsRegeneration) {
      lines.push(`- ${item.shotId}: ${item.reason}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function normalizeIdentityDriftTags(tags = []) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(tags.filter(Boolean).map((tag) => String(tag).trim()))];
}

function normalizeConsistencyReport(rawReport = {}, characterName, validImages) {
  return {
    character: rawReport.character || characterName,
    overallScore: rawReport.overallScore ?? 10,
    details: rawReport.details ?? null,
    anchorSummary: rawReport.anchorSummary ?? {},
    identityDriftTags: normalizeIdentityDriftTags(rawReport.identityDriftTags),
    problematicImageIndices: Array.isArray(rawReport.problematicImageIndices)
      ? rawReport.problematicImageIndices
      : [],
    suggestion: rawReport.suggestion ?? null,
    imageList: validImages,
  };
}

function collectIdentityDriftCounts(reports = []) {
  const counts = {};
  for (const report of reports) {
    for (const tag of normalizeIdentityDriftTags(report?.identityDriftTags)) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }

  return counts;
}

/**
 * 验证同一角色在多张图片中的一致性
 * @param {string} characterName
 * @param {Object} characterCard - 来自CharacterRegistry
 * @param {Array<{shotId, imagePath}>} imageList - 包含该角色的图像列表
 * @returns {Promise<ConsistencyReport>}
 */
export async function checkCharacterConsistency(characterName, characterCard, imageList, options = {}) {
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

      const report = normalizeConsistencyReport(parseJSONResponse(raw), characterName, batch);

      // 将批内索引转为全局索引
      const globalIndices = (report.problematicImageIndices || []).map((i) => i + globalOffset);
      allProblematicIndices.push(...globalIndices);
      allReports.push(report);
    } catch (err) {
      logger.warn('ConsistencyChecker', `批次 ${batchIdx + 1}/${batches.length} 检查失败：${err.message}，跳过`);
      if (options.artifactContext) {
        saveJSON(
          path.join(
            options.artifactContext.errorsDir,
            `${characterName.replace(/[^\w\u4e00-\u9fa5-]/g, '_')}-batch-${batchIdx + 1}-error.json`
          ),
          {
            character: characterName,
            batchIndex: batchIdx,
            batchSize: batch.length,
            error: err.message,
            imageShots: batch.map((image) => ({ shotId: image.shotId, imagePath: image.imagePath })),
          }
        );
      }
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
    anchorSummary: lastReport.anchorSummary ?? {},
    identityDriftTags: normalizeIdentityDriftTags(
      allReports.flatMap((report) => report.identityDriftTags || [])
    ),
    problematicImageIndices: [...new Set(allProblematicIndices)],
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
  let deps = {};
  if (arguments.length >= 3 && arguments[2] && typeof arguments[2] === 'object') {
    deps = arguments[2];
  }

  const runCheckCharacterConsistency = deps.checkCharacterConsistency || checkCharacterConsistency;
  const reports = [];
  const needsRegeneration = [];

  for (const charCard of characterRegistry) {
    // 找出包含该角色的图像
    const charImages = imageResults.filter(
      (r) => r.success && r.characters?.includes(charCard.name)
    );

    if (charImages.length === 0) continue;

    const report = normalizeConsistencyReport(
      await runCheckCharacterConsistency(charCard.name, charCard, charImages, {
        artifactContext: deps.artifactContext,
      }),
      charCard.name,
      charImages
    );
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

  if (deps.artifactContext) {
    const driftCounts = collectIdentityDriftCounts(reports);
    saveJSON(path.join(deps.artifactContext.inputsDir, 'character-registry.json'), characterRegistry);
    saveJSON(path.join(deps.artifactContext.inputsDir, 'image-results.json'), imageResults);
    saveJSON(path.join(deps.artifactContext.outputsDir, 'consistency-report.json'), reports);
    saveJSON(path.join(deps.artifactContext.outputsDir, 'flagged-shots.json'), needsRegeneration);
    writeTextFile(
      path.join(deps.artifactContext.outputsDir, 'consistency-report.md'),
      buildConsistencyMarkdown(reports, needsRegeneration)
    );
    const metrics = {
      checked_character_count: reports.length,
      checked_shot_count: imageResults.filter((result) => result.success).length,
      flagged_shot_count: needsRegeneration.length,
      avg_consistency_score:
        reports.length > 0
          ? reports.reduce((sum, report) => sum + (report.overallScore || 0), 0) / reports.length
          : 0,
      identity_drift_tag_counts: driftCounts,
      regeneration_count: needsRegeneration.length,
    };
    saveJSON(path.join(deps.artifactContext.metricsDir, 'consistency-metrics.json'), metrics);
    saveJSON(deps.artifactContext.manifestPath, {
      status: 'completed',
      checkedCharacterCount: reports.length,
      flaggedShotCount: needsRegeneration.length,
      outputFiles: [
        'consistency-report.json',
        'consistency-report.md',
        'flagged-shots.json',
        'consistency-metrics.json',
      ],
    });
    writeAgentQaSummary(
      {
        agentKey: 'consistencyChecker',
        agentName: 'Consistency Checker',
        status: needsRegeneration.length > 0 ? 'warn' : 'pass',
        headline:
          needsRegeneration.length > 0
            ? `发现 ${needsRegeneration.length} 个需要重生成的一致性问题镜头`
            : `已完成 ${reports.length} 个角色的一致性检查`,
        summary:
          needsRegeneration.length > 0
            ? '检查器已经找到高风险镜头，说明这一步工作有效，但这些镜头还需要后续处理。'
            : '当前没有发现需要立即重生成的高风险一致性问题。',
        passItems: [`已检查角色数：${reports.length}`, `平均一致性分：${metrics.avg_consistency_score}`],
        warnItems:
          needsRegeneration.length > 0
            ? [`待重生成镜头数：${needsRegeneration.length}`]
            : [],
        nextAction:
          needsRegeneration.length > 0
            ? '优先处理 flagged-shots.json 中的镜头，再决定是否继续合成。'
            : '可以继续进入连贯性或下游流程。',
        evidenceFiles: [
          '1-outputs/consistency-report.json',
          '1-outputs/consistency-report.md',
          '1-outputs/flagged-shots.json',
        ],
        metrics,
      },
      deps.artifactContext
    );
  }

  return { reports, needsRegeneration };
}
