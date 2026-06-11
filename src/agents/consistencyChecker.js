/**
 * 一致性验证Agent - 用多模态LLM检查角色跨镜头外观一致性
 */

import fs from 'fs';
import path from 'path';
import { visionChat, parseJSONResponse } from '../llm/client.js';
import { CONSISTENCY_CHECK_SYSTEM, CONSISTENCY_CHECK_USER } from '../llm/prompts/consistencyCheck.js';
import { imageToBase64, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import {
  classifyShotConsistencyClass,
  evaluateConsistencyDecision,
  resolveCharacterPriority,
} from '../domain/consistencyQaPolicy.js';
import { resolveCharacterIdentity } from './characterRegistry.js';
import logger from '../utils/logger.js';

const SCORE_THRESHOLD = parseInt(process.env.CONSISTENCY_THRESHOLD || '7', 10);
// 每批最多发送几张图给视觉LLM（防止单次 base64 占用过大内存）
const BATCH_SIZE = parseInt(process.env.CONSISTENCY_BATCH_SIZE || '6', 10);
const KNOWN_HARD_DRIFT_TAGS = new Set([
  'identity_swap',
  'character_swap',
  'face_swap',
  'wrong_character',
  'face_mismatch',
]);
const CONSISTENCY_CHECK_UNAVAILABLE_REASON = 'consistency_check_unavailable';

function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function buildConsistencyMarkdown(reports, needsRegeneration, qaDecisionCounts, regenStrategyCounts) {
  const lines = [
    '# Consistency Report',
    '',
    `- Checked Characters: ${reports.length}`,
    `- Flagged Shots: ${needsRegeneration.length}`,
    `- Decision Counts: pass=${qaDecisionCounts.pass || 0}, pass_with_review=${qaDecisionCounts.pass_with_review || 0}, warn=${qaDecisionCounts.warn || 0}, block=${qaDecisionCounts.block || 0}`,
    `- Regen Strategy Counts: none=${regenStrategyCounts.none || 0}, prompt_tighten=${regenStrategyCounts.prompt_tighten || 0}, reanchor_regenerate=${regenStrategyCounts.reanchor_regenerate || 0}`,
    '',
  ];

  if (reports.length === 0) {
    lines.push('No consistency reports were generated.');
  }

  for (const report of reports) {
    lines.push(`## ${report.character}`);
    lines.push(`- Overall Score: ${report.overallScore ?? 'n/a'}`);
    lines.push(`- Character Priority: ${report.characterPriority ?? 'support'}`);
    lines.push(`- Shot Consistency Class: ${report.shotConsistencyClass ?? 'standard'}`);
    lines.push(`- QA Decision: ${report.qaDecision?.status ?? 'pass'}`);
    lines.push(`- Regen Strategy: ${report.regenStrategy ?? report.qaDecision?.regenStrategy ?? 'none'}`);
    lines.push(`- Skipped: ${report.skipped ? 'yes' : 'no'}`);
    if (report.details) {
      lines.push(`- Details: ${JSON.stringify(report.details)}`);
    }
    if (Array.isArray(report.identityDriftTags) && report.identityDriftTags.length > 0) {
      lines.push(`- Identity Drift Tags: ${report.identityDriftTags.join(', ')}`);
    }
    if (Array.isArray(report.hardFailureReasons) && report.hardFailureReasons.length > 0) {
      lines.push(`- Hard Failure Reasons: ${report.hardFailureReasons.join(', ')}`);
    }
    if (Array.isArray(report.softRiskTags) && report.softRiskTags.length > 0) {
      lines.push(`- Soft Risk Tags: ${report.softRiskTags.join(', ')}`);
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
      lines.push(
        `- ${item.shotId}: ${item.reason} [strategy=${item.regenStrategy || 'prompt_tighten'}]`
      );
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

function normalizeStringTags(tags = []) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(tags.filter(Boolean).map((tag) => String(tag).trim()))];
}

function resolveHardFailureReasons(rawHardFailureReasons, identityDriftTags) {
  if (Array.isArray(rawHardFailureReasons)) {
    const normalizedHard = normalizeStringTags(rawHardFailureReasons);
    return normalizedHard;
  }

  return normalizeIdentityDriftTags(identityDriftTags).filter((tag) => KNOWN_HARD_DRIFT_TAGS.has(tag));
}

function resolveSoftRiskTags(rawSoftRiskTags, identityDriftTags) {
  if (Array.isArray(rawSoftRiskTags)) {
    const normalizedSoft = normalizeStringTags(rawSoftRiskTags);
    return normalizedSoft;
  }

  return normalizeIdentityDriftTags(identityDriftTags);
}

function resolveCandidateShotIndices(report, charImages = []) {
  const problematicIndices = Array.isArray(report?.problematicImageIndices)
    ? report.problematicImageIndices.filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < charImages.length)
    : [];

  if (problematicIndices.length > 0) {
    return [...new Set(problematicIndices)];
  }

  if (charImages.length > 0) {
    return [0];
  }

  return [];
}

function normalizeOverallScore(rawScore) {
  const parsed = typeof rawScore === 'string' ? Number(rawScore.trim()) : Number(rawScore);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return parsed;
}

function normalizeProblematicImageIndices(rawIndices, maxLength) {
  if (!Array.isArray(rawIndices)) {
    return [];
  }

  return [...new Set(rawIndices
    .map((idx) => (typeof idx === 'string' ? Number(idx.trim()) : Number(idx)))
    .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < maxLength))];
}

const SHOT_CLASS_ORDER = {
  anchor: 0,
  standard: 1,
  complex: 2,
};

function pickMostStrictShotClass(shotClasses = []) {
  if (!Array.isArray(shotClasses) || shotClasses.length === 0) {
    return 'standard';
  }

  return [...shotClasses].sort((left, right) => {
    return (SHOT_CLASS_ORDER[left] ?? 99) - (SHOT_CLASS_ORDER[right] ?? 99);
  })[0];
}

function summarizeQaDecisionCounts(reports = []) {
  const counts = { pass: 0, pass_with_review: 0, warn: 0, block: 0 };
  for (const report of reports) {
    const status = report?.qaDecision?.status;
    if (status === 'pass' || status === 'pass_with_review' || status === 'warn' || status === 'block') {
      counts[status] += 1;
    }
  }

  return counts;
}

function summarizeRegenStrategyCounts(reports = []) {
  const counts = { none: 0, prompt_tighten: 0, reanchor_regenerate: 0 };
  for (const report of reports) {
    const strategy = report?.regenStrategy ?? report?.qaDecision?.regenStrategy;
    if (strategy === 'none' || strategy === 'prompt_tighten' || strategy === 'reanchor_regenerate') {
      counts[strategy] += 1;
    }
  }

  return counts;
}

function resolveImageResultCharacterIdentities(imageResult = {}) {
  return (Array.isArray(imageResult?.characters) ? imageResult.characters : [])
    .map((character) => resolveCharacterIdentity(character) || String(character?.name || character || '').trim())
    .filter(Boolean);
}

function hasStructuredCharacterIdentity(imageResult = {}) {
  return (Array.isArray(imageResult?.characters) ? imageResult.characters : []).some(
    (character) => Boolean(resolveCharacterIdentity(character))
  );
}

function collectCharacterImages(imageResults = [], charCard = {}) {
  const targetIdentity = resolveCharacterIdentity(charCard);
  const targetName = String(charCard?.name || '').trim();

  return (Array.isArray(imageResults) ? imageResults : []).filter((result) => {
    if (!result?.success) {
      return false;
    }

    const identities = resolveImageResultCharacterIdentities(result);
    if (targetIdentity) {
      if (identities.includes(targetIdentity)) {
        return true;
      }

      if (!hasStructuredCharacterIdentity(result) && targetName) {
        return identities.includes(targetName);
      }

      return false;
    }

    if (!targetName) {
      return false;
    }

    return identities.includes(targetName);
  });
}

function normalizeConsistencyReport(rawReport = {}, characterName, validImages) {
  const normalizedImageList = Array.isArray(rawReport.imageList) && rawReport.imageList.length > 0
    ? rawReport.imageList.filter((image) => image && typeof image === 'object')
    : validImages;
  const identityDriftTags = normalizeIdentityDriftTags(rawReport.identityDriftTags);
  const hardFailureReasons = resolveHardFailureReasons(rawReport.hardFailureReasons, identityDriftTags);
  const softRiskTags = resolveSoftRiskTags(rawReport.softRiskTags, identityDriftTags);

  return {
    character: rawReport.character || characterName,
    overallScore: normalizeOverallScore(rawReport.overallScore),
    details: rawReport.details ?? null,
    anchorSummary: rawReport.anchorSummary ?? {},
    identityDriftTags,
    hardFailureReasons,
    softRiskTags,
    problematicImageIndices: normalizeProblematicImageIndices(
      rawReport.problematicImageIndices,
      normalizedImageList.length
    ),
    skipped: Boolean(rawReport.skipped),
    error: rawReport.error ?? null,
    suggestion: rawReport.suggestion ?? null,
    imageList: normalizedImageList,
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

    const prompt = `${CONSISTENCY_CHECK_SYSTEM}\n\n${CONSISTENCY_CHECK_USER(characterName, characterCard, batch.length)}`;

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
    return {
      character: characterName,
      overallScore: 0,
      identityDriftTags: [CONSISTENCY_CHECK_UNAVAILABLE_REASON],
      hardFailureReasons: [CONSISTENCY_CHECK_UNAVAILABLE_REASON],
      softRiskTags: [CONSISTENCY_CHECK_UNAVAILABLE_REASON],
      problematicImageIndices: [],
      imageList: validImages,
      error: '所有批次均失败',
    };
  }

  // 汇总：取所有批次的平均分
  const avgScore = allReports.reduce((sum, r) => sum + r.overallScore, 0) / allReports.length;
  const lastReport = allReports[allReports.length - 1];

  const finalReport = {
    character: characterName,
    overallScore: avgScore,
    details: lastReport.details,
    anchorSummary: lastReport.anchorSummary ?? {},
    identityDriftTags: normalizeIdentityDriftTags(
      allReports.flatMap((report) => report.identityDriftTags || [])
    ),
    hardFailureReasons: normalizeStringTags(allReports.flatMap((report) => report.hardFailureReasons || [])),
    softRiskTags: normalizeStringTags(allReports.flatMap((report) => report.softRiskTags || [])),
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
    const charImages = collectCharacterImages(imageResults, charCard);

    if (charImages.length === 0) continue;

    const report = normalizeConsistencyReport(
      await runCheckCharacterConsistency(charCard.name, charCard, charImages, {
        artifactContext: deps.artifactContext,
      }),
      charCard.name,
      charImages
    );
    const consistencyImages =
      Array.isArray(report.imageList) && report.imageList.length > 0
        ? report.imageList
        : charImages;

    const characterPriority = resolveCharacterPriority(charCard);
    const candidateIndices = resolveCandidateShotIndices(report, consistencyImages);
    const candidateClasses = candidateIndices.map((idx) => classifyShotConsistencyClass(consistencyImages[idx] || {}));
    const shotConsistencyClass = pickMostStrictShotClass(candidateClasses);
    const qaDecision = evaluateConsistencyDecision({
      overallScore: report.overallScore,
      characterPriority,
      shotConsistencyClass,
      hardFailureReasons: report.hardFailureReasons,
      softRiskTags: report.softRiskTags,
    });
    const normalizedReport = {
      ...report,
      characterPriority,
      shotConsistencyClass,
      qaDecision,
      regenStrategy: qaDecision.regenStrategy,
    };

    reports.push(normalizedReport);

    // 兼容旧阈值：当没有新决策字段时仍可触发旧逻辑；优先采用双轴 QA 决策
    const shouldUseLegacyThreshold =
      !normalizedReport.qaDecision || !normalizedReport.qaDecision.status;

    if (shouldUseLegacyThreshold && normalizedReport.overallScore < SCORE_THRESHOLD && !normalizedReport.skipped) {
      const badIndices = normalizedReport.problematicImageIndices || [];
      badIndices.forEach((idx) => {
        if (consistencyImages[idx]) {
          needsRegeneration.push({
            shotId: consistencyImages[idx].shotId,
            reason: `${charCard.name} 一致性评分 ${normalizedReport.overallScore}/10`,
            regenStrategy: 'prompt_tighten',
            hardFailureReasons: normalizedReport.hardFailureReasons || [],
            softRiskTags: normalizedReport.softRiskTags || [],
            suggestion: normalizedReport.suggestion,
          });
        }
      });
      continue;
    }

    if (normalizedReport.skipped) {
      continue;
    }

    const badIndices = Array.isArray(normalizedReport.problematicImageIndices)
      ? normalizedReport.problematicImageIndices
      : [];

    badIndices.forEach((idx) => {
      const shot = consistencyImages[idx];
      if (!shot) {
        return;
      }
      const shotClass = classifyShotConsistencyClass(shot);
      const shotDecision = evaluateConsistencyDecision({
        overallScore: normalizedReport.overallScore,
        characterPriority,
        shotConsistencyClass: shotClass,
        hardFailureReasons: normalizedReport.hardFailureReasons,
        softRiskTags: normalizedReport.softRiskTags,
      });

      if (shotDecision.status === 'pass' || shotDecision.status === 'pass_with_review') {
        return;
      }

      const hardFailureReasons = normalizedReport.hardFailureReasons || [];
      const reason =
        shotDecision.status === 'block' && hardFailureReasons.length > 0
          ? `${charCard.name} 触发硬失败：${hardFailureReasons.join(', ')}`
          : `${charCard.name} 一致性评分 ${normalizedReport.overallScore}/10（${characterPriority}/${shotClass}）`;

      needsRegeneration.push({
        shotId: shot.shotId,
        reason,
        regenStrategy: shotDecision.regenStrategy,
        hardFailureReasons,
        softRiskTags: normalizedReport.softRiskTags || [],
        suggestion: normalizedReport.suggestion,
      });
    });

    const isConsistencyCheckerUnavailable =
      Array.isArray(normalizedReport.hardFailureReasons) &&
      normalizedReport.hardFailureReasons.includes(CONSISTENCY_CHECK_UNAVAILABLE_REASON);

    if (
      badIndices.length === 0 &&
      !isConsistencyCheckerUnavailable &&
      (normalizedReport.qaDecision?.status === 'warn' || normalizedReport.qaDecision?.status === 'block') &&
      consistencyImages[0]
    ) {
      const hardFailureReasons = normalizedReport.hardFailureReasons || [];
      const reason =
        normalizedReport.qaDecision.status === 'block' && hardFailureReasons.length > 0
          ? `${charCard.name} 触发硬失败：${hardFailureReasons.join(', ')}`
          : `${charCard.name} 一致性评分 ${normalizedReport.overallScore}/10（${characterPriority}/${shotConsistencyClass}）`;

      needsRegeneration.push({
        shotId: consistencyImages[0].shotId,
        reason,
        regenStrategy: normalizedReport.qaDecision.regenStrategy,
        hardFailureReasons,
        softRiskTags: normalizedReport.softRiskTags || [],
        suggestion: normalizedReport.suggestion,
      });
    }
  }

  logger.info(
    'ConsistencyChecker',
    `一致性检查完成。需要重生成：${needsRegeneration.length} 个镜头`
  );

  if (deps.artifactContext) {
    const driftCounts = collectIdentityDriftCounts(reports);
    const qaDecisionCounts = summarizeQaDecisionCounts(reports);
    const regenStrategyCounts = summarizeRegenStrategyCounts(reports);
    saveJSON(path.join(deps.artifactContext.inputsDir, 'character-registry.json'), characterRegistry);
    saveJSON(path.join(deps.artifactContext.inputsDir, 'image-results.json'), imageResults);
    saveJSON(path.join(deps.artifactContext.outputsDir, 'consistency-report.json'), reports);
    saveJSON(path.join(deps.artifactContext.outputsDir, 'flagged-shots.json'), needsRegeneration);
    writeTextFile(
      path.join(deps.artifactContext.outputsDir, 'consistency-report.md'),
      buildConsistencyMarkdown(reports, needsRegeneration, qaDecisionCounts, regenStrategyCounts)
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
      qa_decision_counts: qaDecisionCounts,
      regen_strategy_counts: regenStrategyCounts,
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
    const checkerStatus =
      qaDecisionCounts.block > 0
        ? 'block'
        : (qaDecisionCounts.warn > 0 || qaDecisionCounts.pass_with_review > 0 ? 'warn' : 'pass');
    writeAgentQaSummary(
      {
        agentKey: 'consistencyChecker',
        agentName: 'Consistency Checker',
        status: checkerStatus,
        headline:
          checkerStatus === 'block'
            ? `发现 ${qaDecisionCounts.block} 个角色触发阻断一致性风险`
            : (needsRegeneration.length > 0
              ? `发现 ${needsRegeneration.length} 个需要重生成的一致性风险镜头`
              : `已完成 ${reports.length} 个角色的一致性检查`),
        summary:
          checkerStatus === 'block'
            ? '至少有一个角色触发了硬失败规则，建议优先使用回锚重生成处理后再继续。'
            : (needsRegeneration.length > 0
              ? '检查器已按双轴规则标记风险镜头，建议根据策略分别执行 tighten 或回锚处理。'
              : '当前没有发现需要立即重生成的高风险一致性问题。'),
        passItems: [`已检查角色数：${reports.length}`, `平均一致性分：${metrics.avg_consistency_score}`],
        warnItems:
          needsRegeneration.length > 0
            ? [
              `待重生成镜头数：${needsRegeneration.length}`,
              `判定分布：pass=${qaDecisionCounts.pass}, pass_with_review=${qaDecisionCounts.pass_with_review}, warn=${qaDecisionCounts.warn}, block=${qaDecisionCounts.block}`,
              `策略分布：prompt_tighten=${regenStrategyCounts.prompt_tighten}, reanchor_regenerate=${regenStrategyCounts.reanchor_regenerate}`,
            ]
            : (qaDecisionCounts.pass_with_review > 0
              ? [`低置信放行角色数：${qaDecisionCounts.pass_with_review}`]
              : []),
        blockItems:
          qaDecisionCounts.block > 0
            ? [`阻断角色数：${qaDecisionCounts.block}`]
            : [],
        nextAction:
          checkerStatus === 'block'
            ? '优先处理 block 风险镜头（建议回锚重生成），通过后再继续合成流程。'
            : (needsRegeneration.length > 0
              ? '优先处理 flagged-shots.json 中的镜头，再决定是否继续合成。'
              : '可以继续进入连贯性或下游流程。'),
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
