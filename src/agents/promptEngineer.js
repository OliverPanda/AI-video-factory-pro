/**
 * 视觉设计Agent - 为每个分镜生成图像生成Prompt
 */

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
import { llmQueue } from '../utils/queue.js';
import logger from '../utils/logger.js';

/**
 * 为单个分镜生成图像Prompt
 * @param {Object} shot - 分镜对象
 * @param {Array} characterRegistry - 角色档案列表
 * @param {string} style - 'realistic' | '3d'
 * @returns {Promise<{shotId, image_prompt, negative_prompt, style_notes}>}
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

  // 自动增强：注入基础质量词 + 镜头关键词
  const styleBase = STYLE_BASE[style] || STYLE_BASE.realistic;
  const cameraType = shot.camera_type || shot.cameraType || null;
  const cameraKw = CAMERA_KEYWORDS[cameraType] || 'medium shot';
  const charTokens = getShotCharacterTokens(shot, characterRegistry);

  const enhancedPrompt = [
    charTokens,
    result.image_prompt,
    cameraKw,
    styleBase.lighting,
    styleBase.quality,
  ]
    .filter(Boolean)
    .join(', ');

  const fullNegativePrompt = [result.negative_prompt, styleBase.negative]
    .filter(Boolean)
    .join(', ');

  return {
    shotId: shot.id,
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
export async function generateAllPrompts(shots, characterRegistry, style = 'realistic') {
  logger.info('PromptEngineer', `开始为 ${shots.length} 个分镜生成Prompt...`);

  const results = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    logger.step(i + 1, shots.length, `生成Prompt: ${shot.id}`);
    try {
      // 使用 llmQueue 限流，防止大量镜头时触发 API RPM 限制
      const prompt = await llmQueue.add(() => generatePromptForShot(shot, characterRegistry, style));
      results.push(prompt);
    } catch (err) {
      logger.warn('PromptEngineer', `${shot.id} Prompt生成失败，使用降级方案：${err.message}`);
      results.push(fallbackPrompt(shot, style));
    }
  }

  logger.info('PromptEngineer', 'Prompt生成完成');
  return results;
}

// 降级方案：基于分镜信息直接组装基础Prompt
function fallbackPrompt(shot, style) {
  const styleBase = STYLE_BASE[style] || STYLE_BASE.realistic;
  const cameraType = shot.camera_type || shot.cameraType || null;
  const cameraKw = CAMERA_KEYWORDS[cameraType] || 'medium shot';
  return {
    shotId: shot.id,
    image_prompt: `${shot.scene}, ${shot.action}, ${cameraKw}, ${styleBase.quality}`,
    negative_prompt: styleBase.negative,
    style_notes: '降级生成（LLM调用失败）',
  };
}
