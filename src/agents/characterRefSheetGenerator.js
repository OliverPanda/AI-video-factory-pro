import path from 'node:path';

import { generateImage } from '../apis/imageApi.js';
import { resolveCharacterIdentity } from './characterRegistry.js';
import { buildCharacterRefSheetPrompt } from '../llm/prompts/promptEngineering.js';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { imageQueue, queueWithRetry } from '../utils/queue.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import logger from '../utils/logger.js';

function resolveCharacterId(card) {
  return resolveCharacterIdentity(card);
}

function writeArtifacts(results, report, artifactContext) {
  if (!artifactContext) return;
  ensureDir(artifactContext.outputsDir);
  ensureDir(artifactContext.metricsDir);
  saveJSON(path.join(artifactContext.outputsDir, 'character-ref-sheets.json'), results);
  saveJSON(path.join(artifactContext.metricsDir, 'ref-sheet-metrics.json'), report);
  saveJSON(artifactContext.manifestPath, {
    status: report.failureCount > 0 && report.successCount === 0 ? 'completed_with_errors' : 'completed',
    characterCount: report.totalCharacters,
    successCount: report.successCount,
    outputFiles: ['character-ref-sheets.json', 'ref-sheet-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'characterRefSheetGenerator',
      agentName: 'Character Reference Sheet Generator',
      status: report.successCount > 0 ? 'pass' : 'warn',
      headline: `已为 ${report.successCount}/${report.totalCharacters} 个角色生成三视图参考纸`,
      summary: '角色三视图参考纸用于后续分镜生成的角色一致性锚定。',
      passItems: report.successCount > 0 ? [`成功生成：${report.successCount} 个角色`] : [],
      warnItems: report.failureCount > 0 ? [`生成失败：${report.failureCount} 个角色`] : [],
      nextAction: '可以继续进入 Prompt 生成和分镜图像生成。',
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

  const results = await Promise.all(
    characterRegistry.map((card) => {
      const charId = resolveCharacterId(card);
      const charName = card.name || charId || 'unknown';
      const refPrompt = buildCharacterRefSheetPrompt(card, style);
      const outputPath = path.join(resolvedDir, `${charId || charName}_ref_sheet.png`);

      return queueWithRetry(
        imageQueue,
        async () => {
          logger.info('CharRefSheet', `生成角色三视图：${charName}`);
          const refSheetSize = process.env.CHARACTER_REF_SHEET_SIZE || '2048x1024';
          const imagePath = await runGenerateImage(refPrompt.prompt, refPrompt.negative, outputPath, { style, size: refSheetSize });
          return {
            characterId: charId,
            characterName: charName,
            imagePath,
            prompt: refPrompt.prompt,
            success: true,
            error: null,
          };
        },
        5,
        `ref_sheet_${charName}`
      ).catch((err) => {
        logger.error('CharRefSheet', `${charName} 三视图生成失败：${err.message}`);
        return {
          characterId: charId,
          characterName: charName,
          imagePath: null,
          prompt: refPrompt.prompt,
          success: false,
          error: err.message,
        };
      });
    })
  );

  const successCount = results.filter((r) => r.success).length;
  const report = {
    totalCharacters: characterRegistry.length,
    successCount,
    failureCount: characterRegistry.length - successCount,
    successRate: characterRegistry.length > 0 ? successCount / characterRegistry.length : 0,
  };

  logger.info('CharRefSheet', `角色三视图完成：${successCount}/${characterRegistry.length} 成功`);
  writeArtifacts(results, report, options.artifactContext);

  return results;
}

export const __testables = {
  resolveCharacterId,
};
