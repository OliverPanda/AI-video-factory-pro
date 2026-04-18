/**
 * 视觉设计Agent - 为每个分镜生成图像生成Prompt
 */

import fs from 'node:fs';
import path from 'node:path';
import { chatJSON } from '../llm/client.js';
import {
  PROMPT_ENGINEER_SYSTEM,
  PROMPT_ENGINEER_USER,
  STYLE_BASE,
  CAMERA_KEYWORDS,
} from '../llm/prompts/promptEngineering.js';
import {
  getShotCharacterCards,
  getShotCharacterNames,
  getShotCharacterTokens,
} from './characterRegistry.js';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import { llmQueue } from '../utils/queue.js';
import logger from '../utils/logger.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function mergePromptSegments(segments = []) {
  return [
    ...new Set(
      segments
        .flatMap((segment) =>
          String(segment || '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        )
        .filter(Boolean)
    ),
  ].join(', ');
}

function buildPromptsTable(prompts, promptSources) {
  const lines = [
    '| Shot ID | Source | Display Prompt ZH | Execution Prompt EN | Negative Prompt EN | Style Notes |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const prompt of prompts) {
    const source = promptSources.find((entry) => entry.shotId === prompt.shotId)?.source || '';
    const displayPromptZh = prompt.display_prompt_zh || '';
    const executionPromptEn = prompt.image_prompt_en || prompt.image_prompt || '';
    const executionNegativePromptEn = prompt.negative_prompt_en || prompt.negative_prompt || '';
    lines.push(
      `| ${prompt.shotId} | ${source} | ${displayPromptZh} | ${executionPromptEn} | ${executionNegativePromptEn} | ${prompt.style_notes || ''} |`
    );
  }

  return `${lines.join('\n')}\n`;
}

function buildContinuityTokens(shot = {}) {
  const continuityState = shot.continuityState ?? {};
  const tokens = [
    continuityState.sceneLighting,
    continuityState.cameraAxis ? `camera axis ${continuityState.cameraAxis}` : null,
    ...(Array.isArray(continuityState.continuityRiskTags) ? continuityState.continuityRiskTags : []),
    ...(Array.isArray(continuityState.propStates)
      ? continuityState.propStates.map((item) =>
          item?.name
            ? `${item.name}${item.side ? ` ${item.side}` : ''}${item.holderEpisodeCharacterId ? ` held by ${item.holderEpisodeCharacterId}` : ''}`
            : null
        )
      : []),
  ];

  return tokens.filter(Boolean).join(', ');
}

function keepAsciiExecutionTokens(value) {
  return String(value || '')
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment && !/[\u3400-\u9FFF]/.test(segment))
    .join(', ');
}

function buildChineseDisplayPrompt(shot = {}) {
  const cameraType = shot.camera_type || shot.cameraType || null;
  const characterNames =
    Array.isArray(shot.characters) && shot.characters.length > 0
      ? `角色：${shot.characters.join('、')}`
      : null;
  return [
    shot.scene ? `场景：${shot.scene}` : null,
    shot.action ? `动作：${shot.action}` : null,
    characterNames,
    shot.emotion ? `情绪：${shot.emotion}` : null,
    cameraType ? `镜头：${cameraType}` : null,
  ]
    .filter(Boolean)
    .join('；');
}

function buildChineseDisplayNegativePrompt(style = 'realistic') {
  if (style === '3d') {
    return '避免低质量、贴图错误、结构畸形';
  }
  return '避免低质量、模糊、卡通感、结构畸形';
}

function buildEnglishFallbackExecutionPrompt(shot, styleBase) {
  const cameraType = shot.camera_type || shot.cameraType || null;
  const cameraKw = CAMERA_KEYWORDS[cameraType] || 'medium shot';
  const continuityTokens = keepAsciiExecutionTokens(buildContinuityTokens(shot));
  const sceneHint = keepAsciiExecutionTokens(shot.scene);
  const actionHint = keepAsciiExecutionTokens(shot.action);
  const emotionHint = keepAsciiExecutionTokens(shot.emotion);

  return mergePromptSegments([
    sceneHint ? `scene ${sceneHint}` : null,
    actionHint ? `action ${actionHint}` : null,
    emotionHint ? `emotion ${emotionHint}` : null,
    continuityTokens,
    cameraKw,
    'single cinematic frame, clear subject focus',
    styleBase.lighting,
    styleBase.quality,
  ]);
}

export function applyContinuityRepairHints(basePrompt, report = {}) {
  const hints = Array.isArray(report.repairHints) ? report.repairHints : [];
  const targets = Array.isArray(report.continuityTargets) ? report.continuityTargets : [];
  const continuityPatch = [...targets, ...hints].filter(Boolean).join(', ');
  if (!continuityPatch) {
    return basePrompt;
  }

  return [basePrompt, `continuity repair`, continuityPatch].filter(Boolean).join(', ');
}

function buildPromptMetrics(prompts, promptSources) {
  const llmSuccessCount = promptSources.filter((entry) => entry.source === 'llm').length;
  const fallbackCount = promptSources.filter((entry) => entry.source === 'fallback').length;
  return {
    prompt_count: prompts.length,
    llm_success_count: llmSuccessCount,
    fallback_count: fallbackCount,
    fallback_rate: prompts.length > 0 ? fallbackCount / prompts.length : 0,
    avg_prompt_length:
      prompts.length > 0
        ? prompts.reduce((sum, prompt) => sum + (prompt.image_prompt || '').length, 0) / prompts.length
        : 0,
  };
}

function writePromptArtifacts(prompts, promptSources, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'prompts.json'), prompts);
  saveJSON(path.join(artifactContext.outputsDir, 'prompt-sources.json'), promptSources);
  writeTextFile(path.join(artifactContext.outputsDir, 'prompts.table.md'), buildPromptsTable(prompts, promptSources));
  const metrics = buildPromptMetrics(prompts, promptSources);
  saveJSON(path.join(artifactContext.metricsDir, 'prompt-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    promptCount: prompts.length,
    outputFiles: ['prompts.json', 'prompt-sources.json', 'prompts.table.md', 'prompt-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'promptEngineer',
      agentName: 'Prompt Engineer',
      status: metrics.fallback_count > 0 ? 'warn' : 'pass',
      headline:
        metrics.fallback_count > 0
          ? `有 ${metrics.fallback_count} 个镜头使用了降级 Prompt`
          : `已为 ${prompts.length} 个镜头生成 Prompt`,
      summary:
        metrics.fallback_count > 0
          ? '主链路已产出完整 Prompt，但部分镜头使用了降级方案，建议抽查这些镜头。'
          : '所有镜头都通过主生成链路拿到了 Prompt，可继续出图。',
      passItems: [`Prompt 数：${metrics.prompt_count}`, `LLM 成功数：${metrics.llm_success_count}`],
      warnItems:
        metrics.fallback_count > 0 ? [`Fallback Prompt 数：${metrics.fallback_count}`] : [],
      nextAction:
        metrics.fallback_count > 0
          ? '优先抽查 fallback 镜头的 prompts.table.md，确认是否还能接受。'
          : '可以继续进入图像生成阶段。',
      evidenceFiles: [
        '1-outputs/prompts.json',
        '1-outputs/prompt-sources.json',
        '1-outputs/prompts.table.md',
      ],
      metrics,
    },
    artifactContext
  );
}

function writePromptFallbackEvidence(shot, style, error, fallbackResult, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const fileName = `${shot.id}-fallback-error.json`;
  saveJSON(path.join(artifactContext.errorsDir, fileName), {
    shotId: shot.id,
    shot,
    style,
    error: error.message,
    source: 'fallback',
    fallbackPrompt: fallbackResult,
  });
}

/**
 * 为单个分镜生成图像Prompt
 * @param {Object} shot - 分镜对象
 * @param {Array} characterRegistry - 角色档案列表
 * @param {string} style - 'realistic' | '3d'
 * @returns {Promise<{shotId, image_prompt_en, negative_prompt_en, display_prompt_zh, display_negative_prompt_zh, image_prompt, negative_prompt, style_notes}>}
 */
export async function generatePromptForShot(shot, characterRegistry, style = 'realistic', deps = {}) {
  const runChatJSON = deps.chatJSON || chatJSON;
  const charCards = getShotCharacterCards(shot, characterRegistry);
  const shotForPrompt = {
    ...shot,
    characters: getShotCharacterNames(shot, characterRegistry),
  };

  const messages = [
    { role: 'system', content: PROMPT_ENGINEER_SYSTEM },
    { role: 'user', content: PROMPT_ENGINEER_USER(shotForPrompt, charCards, style) },
  ];

  const result = await runChatJSON(messages, { temperature: 0.6 });
  const llmImagePrompt = result.image_prompt_en || result.image_prompt || '';
  const llmNegativePrompt = result.negative_prompt_en || result.negative_prompt || '';

  // 自动增强：注入基础质量词 + 镜头关键词
  const styleBase = STYLE_BASE[style] || STYLE_BASE.realistic;
  const cameraType = shot.camera_type || shot.cameraType || null;
  const cameraKw = CAMERA_KEYWORDS[cameraType] || 'medium shot';
  const charTokens = getShotCharacterTokens(shot, characterRegistry);

  const enhancedPrompt = mergePromptSegments([
    charTokens,
    llmImagePrompt,
    buildContinuityTokens(shot),
    cameraKw,
    styleBase.lighting,
    styleBase.quality,
  ]);

  const fullNegativePrompt = mergePromptSegments([llmNegativePrompt, styleBase.negative]);
  const displayPromptZh = result.display_prompt_zh || buildChineseDisplayPrompt(shotForPrompt);
  const displayNegativePromptZh =
    result.display_negative_prompt_zh || buildChineseDisplayNegativePrompt(style);

  return {
    shotId: shot.id,
    image_prompt_en: enhancedPrompt,
    negative_prompt_en: fullNegativePrompt,
    display_prompt_zh: displayPromptZh,
    display_negative_prompt_zh: displayNegativePromptZh,
    image_prompt: enhancedPrompt,
    negative_prompt: fullNegativePrompt,
    style_notes: result.style_notes || '',
  };
}

/**
 * 批量为所有分镜生成Prompt
 * @param {Array} shots
 * @param {Array} characterRegistry
 * @param {string} style
 * @returns {Promise<Array>}
 */
export async function generateAllPrompts(shots, characterRegistry, style = 'realistic', deps = {}) {
  logger.info('PromptEngineer', `开始为 ${shots.length} 个分镜生成Prompt...`);

  const results = [];
  const promptSources = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    logger.step(i + 1, shots.length, `生成Prompt: ${shot.id}`);
    try {
      // 使用 llmQueue 限流，防止大量镜头时触发 API RPM 限制
      const prompt = await llmQueue.add(() =>
        generatePromptForShot(shot, characterRegistry, style, deps)
      );
      results.push(prompt);
      promptSources.push({ shotId: shot.id, source: 'llm' });
    } catch (err) {
      logger.warn('PromptEngineer', `${shot.id} Prompt生成失败，使用降级方案：${err.message}`);
      const fallbackResult = fallbackPrompt(shot, style);
      results.push(fallbackResult);
      promptSources.push({ shotId: shot.id, source: 'fallback', error: err.message });
      writePromptFallbackEvidence(shot, style, err, fallbackResult, deps.artifactContext);
    }
  }

  writePromptArtifacts(results, promptSources, deps.artifactContext);
  logger.info('PromptEngineer', 'Prompt生成完成');
  return results;
}

// 降级方案：基于分镜信息直接组装基础Prompt
function fallbackPrompt(shot, style) {
  const styleBase = STYLE_BASE[style] || STYLE_BASE.realistic;
  const fallbackExecutionPrompt = buildEnglishFallbackExecutionPrompt(shot, styleBase);
  const displayPromptZh = buildChineseDisplayPrompt(shot);
  const displayNegativePromptZh = buildChineseDisplayNegativePrompt(style);
  return {
    shotId: shot.id,
    image_prompt_en: fallbackExecutionPrompt,
    negative_prompt_en: styleBase.negative,
    display_prompt_zh: displayPromptZh,
    display_negative_prompt_zh: displayNegativePromptZh,
    image_prompt: fallbackExecutionPrompt,
    negative_prompt: styleBase.negative,
    style_notes: '降级生成（LLM调用失败）',
  };
}
