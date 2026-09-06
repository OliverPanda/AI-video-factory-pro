import path from 'node:path';

import { generateImage } from '../apis/imageApi.js';
import {
  getCharacterIdentityAnchor,
  getSanitizedCharacterTokens,
  resolveCharacterIdentity,
} from './characterRegistry.js';
import { buildCharacterRefSheetPrompt } from '../llm/prompts/promptEngineering.js';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { createExecutionPolicy, queueWithRetry } from '../utils/queue.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import logger from '../utils/logger.js';

function resolveCharacterId(card) {
  return resolveCharacterIdentity(card);
}

function collectCharacterReferenceImages(card = {}) {
  const references = [];
  const seen = new Set();

  function pushReference(value) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    references.push(normalized);
  }

  const referenceImages = Array.isArray(card.referenceImages) ? card.referenceImages : [];
  for (const referenceImage of referenceImages) {
    pushReference(referenceImage?.path || referenceImage?.url || referenceImage);
  }
  pushReference(card.referenceImagePath);

  return references;
}

const LEAD_PRIORITIES = new Set(['lead', 'main', 'hero', 'anchor']);

function resolveRefSheetTimeoutMs(options = {}) {
  const raw = options.timeoutMs
    || process.env.CHARACTER_REF_SHEET_TIMEOUT_MS
    || process.env.IMAGE_GENERATION_TIMEOUT_MS
    || process.env.IMAGE_REQUEST_TIMEOUT_MS
    || '240000';
  const timeoutMs = Number.parseInt(String(raw), 10);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 240000;
}

function resolveRefSheetConcurrency(options = {}) {
  const raw = options.concurrency || process.env.CHARACTER_REF_SHEET_CONCURRENCY || '1';
  const concurrency = Number.parseInt(String(raw), 10);
  return Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 1;
}

function classifyRefSheetFailure(error) {
  const text = String(error?.message || error || '').toLowerCase();
  if (text.includes('timeout')) return 'provider_timeout';
  if (text.includes('429') || text.includes('rate limit')) return 'rate_limit';
  if (text.includes('503') || text.includes('upstream')) return 'provider_unavailable';
  return 'provider_generation_failed';
}

function classifyRefSheetReadiness(card = {}) {
  const references = collectCharacterReferenceImages(card);
  const identityAnchor = getCharacterIdentityAnchor(card);
  const tokens = getSanitizedCharacterTokens(card);
  const visualDescription = String(card.visualDescription || '').trim();
  const characterBibleId = String(card.characterBibleId || '').trim();
  const priority = String(card.priority || card.characterPriority || '').trim().toLowerCase();
  const isLead = LEAD_PRIORITIES.has(priority);
  const hasVisualProfile = Boolean(identityAnchor || tokens || visualDescription);
  const canGenerate = hasVisualProfile || references.length > 0;

  if (canGenerate) {
    return {
      status: 'ready',
      blocking: false,
      reasonCode: null,
      reason: null,
      references,
      timeoutMs: null,
    };
  }

  if (isLead || characterBibleId) {
    return {
      status: 'blocked',
      blocking: true,
      reasonCode: 'missing_visual_profile',
      reason: '缺少 character bible / 视觉描述 / identity tokens，无法稳定生成角色三视图',
      references,
      timeoutMs: null,
    };
  }

  return {
    status: 'skipped',
    blocking: false,
    reasonCode: 'missing_visual_profile',
    reason: '角色档案过空，跳过重三视图生成并继续后续流程',
    references,
    timeoutMs: null,
  };
}

function writeArtifacts(results, report, artifactContext) {
  if (!artifactContext) return;
  ensureDir(artifactContext.outputsDir);
  ensureDir(artifactContext.metricsDir);
  saveJSON(path.join(artifactContext.outputsDir, 'character-ref-sheets.json'), results);
  saveJSON(path.join(artifactContext.metricsDir, 'ref-sheet-metrics.json'), report);
  saveJSON(artifactContext.manifestPath, {
    status: report.blockingFailureCount > 0 ? 'completed_with_errors' : 'completed',
    characterCount: report.totalCharacters,
    successCount: report.successCount,
    outputFiles: ['character-ref-sheets.json', 'ref-sheet-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'characterRefSheetGenerator',
      agentName: 'Character Reference Sheet Generator',
      status: report.blockingFailureCount > 0 ? 'warn' : (report.successCount > 0 ? 'pass' : 'warn'),
      headline: `已为 ${report.successCount}/${report.totalCharacters} 个角色生成三视图参考纸`,
      summary: '角色三视图参考纸用于后续分镜生成的角色一致性锚定。',
      passItems: [
        report.successCount > 0 ? `成功生成：${report.successCount} 个角色` : null,
        report.skippedCount > 0 ? `跳过重三视图：${report.skippedCount} 个角色` : null,
      ].filter(Boolean),
      warnItems: [
        report.blockingFailureCount > 0 ? `生成失败：${report.blockingFailureCount} 个角色` : null,
        report.blockedCount > 0 ? `角色档案不足并阻断：${report.blockedCount} 个角色` : null,
      ].filter(Boolean),
      nextAction: report.blockingFailureCount > 0 || report.blockedCount > 0
        ? '建议先修复阻断角色的视觉档案或 provider 超时问题，再继续后续图像链路。'
        : '可以继续进入 Prompt 生成和分镜图像生成。',
      evidenceFiles: ['1-outputs/character-ref-sheets.json', '2-metrics/ref-sheet-metrics.json'],
      metrics: report,
    },
    artifactContext
  );
}

export async function generateCharacterRefSheets(characterRegistry = [], outputDir, options = {}) {
  const style = options.style || process.env.IMAGE_STYLE || 'realistic';
  const resolvedDir = ensureDir(outputDir || path.join(process.env.TEMP_DIR || './temp', 'character-ref-sheets'));
  const runGenerateImage = options.generateImage || generateImage;
  const executionPolicy =
    options.executionPolicy && typeof options.executionPolicy === 'object'
      ? createExecutionPolicy(options.executionPolicy)
      : createExecutionPolicy();
  const maxRetries = executionPolicy.defaultMaxRetries ?? 3;
  const timeoutMs = resolveRefSheetTimeoutMs(options);
  const concurrency = resolveRefSheetConcurrency(options);
  const results = [];

  for (let start = 0; start < characterRegistry.length; start += concurrency) {
    const chunk = characterRegistry.slice(start, start + concurrency);
    const chunkResults = await Promise.all(
      chunk.map((card) => {
      const charId = resolveCharacterId(card);
      const charName = card.name || charId || 'unknown';
      const refPrompt = buildCharacterRefSheetPrompt(card, style);
      const outputPath = path.join(resolvedDir, `${charId || charName}_ref_sheet.png`);
      const readiness = classifyRefSheetReadiness(card);

      if (readiness.status === 'skipped' || readiness.status === 'blocked') {
        logger.warn('CharRefSheet', `${charName} 三视图${readiness.status === 'blocked' ? '阻断' : '跳过'}：${readiness.reason}`);
        return Promise.resolve({
          characterId: charId,
          characterName: charName,
          imagePath: null,
          prompt: refPrompt.prompt,
          success: false,
          skipped: readiness.status === 'skipped',
          blocking: readiness.blocking,
          readinessStatus: readiness.status,
          failureCategory: readiness.status === 'blocked' ? 'missing_character_profile' : 'skipped_missing_profile',
          error: readiness.reason,
        });
      }

      return queueWithRetry(
        null,
        async () => {
          logger.info('CharRefSheet', `生成角色三视图：${charName}`);
          const refSheetSize = process.env.CHARACTER_REF_SHEET_SIZE || '1280x1024';
          const imagePath = await runGenerateImage(refPrompt.prompt, refPrompt.negative, outputPath, {
            style,
            size: refSheetSize,
            timeoutMs,
            references: readiness.references,
          });
          return {
            characterId: charId,
            characterName: charName,
            imagePath,
            prompt: refPrompt.prompt,
            success: true,
            skipped: false,
            blocking: false,
            readinessStatus: readiness.status,
            failureCategory: null,
            error: null,
          };
        },
        maxRetries,
        `ref_sheet_${charName}`,
        {
          queueType: 'image',
          policy: executionPolicy,
        }
      ).catch((err) => {
        logger.error('CharRefSheet', `${charName} 三视图生成失败：${err.message}`);
        return {
          characterId: charId,
          characterName: charName,
          imagePath: null,
          prompt: refPrompt.prompt,
          success: false,
          skipped: false,
          blocking: true,
          readinessStatus: 'failed',
          failureCategory: classifyRefSheetFailure(err),
          error: err.message,
        };
      });
      })
    );
    results.push(...chunkResults);
  }

  const successCount = results.filter((r) => r.success).length;
  const skippedCount = results.filter((r) => r.skipped).length;
  const blockedCount = results.filter((r) => r.readinessStatus === 'blocked').length;
  const blockingFailureCount = results.filter((r) => !r.success && !r.skipped).length;
  const report = {
    totalCharacters: characterRegistry.length,
    successCount,
    failureCount: characterRegistry.length - successCount,
    skippedCount,
    blockedCount,
    blockingFailureCount,
    successRate: characterRegistry.length > 0 ? successCount / characterRegistry.length : 0,
    timeoutMs,
    concurrency,
  };

  logger.info('CharRefSheet', `角色三视图完成：${successCount}/${characterRegistry.length} 成功`);
  writeArtifacts(results, report, options.artifactContext);

  return results;
}

export const __testables = {
  collectCharacterReferenceImages,
  resolveCharacterId,
};
