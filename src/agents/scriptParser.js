/**
 * 编剧Agent - 将剧本文本解析为结构化分镜JSON
 */

import { chat, chatJSON } from '../llm/client.js';
import { SCRIPT_ANALYSIS_SYSTEM, SCRIPT_ANALYSIS_USER } from '../llm/prompts/scriptAnalysis.js';
import logger from '../utils/logger.js';

/**
 * 解析剧本为分镜数据
 * @param {string} scriptText - 原始剧本文本
 * @returns {Promise<{title, totalDuration, characters, shots}>}
 */
export async function parseScript(scriptText) {
  logger.info('ScriptParser', '开始解析剧本...');

  const messages = [
    { role: 'system', content: SCRIPT_ANALYSIS_SYSTEM },
    { role: 'user', content: SCRIPT_ANALYSIS_USER(scriptText) },
  ];

  const result = await chatJSON(messages, {
    temperature: 0.3, // 低温度，保证结构准确
    maxTokens: 8192,
  });

  // 校验基本结构
  validateScriptData(result);

  logger.info('ScriptParser', `解析完成：${result.shots.length} 个分镜，共 ${result.characters.length} 个角色`);
  return result;
}

/**
 * 细化特定场景（多轮对话）
 * @param {Object} shot - 分镜对象
 * @param {string} direction - 细化方向（如："增加更多情感细节"）
 */
export async function refineShot(shot, direction) {
  logger.debug('ScriptParser', `细化分镜 ${shot.id}：${direction}`);

  const messages = [
    { role: 'system', content: SCRIPT_ANALYSIS_SYSTEM },
    {
      role: 'user',
      content: `请细化以下分镜数据，${direction}：\n${JSON.stringify(shot, null, 2)}\n\n只返回修改后的单个分镜JSON对象。`,
    },
  ];

  return chatJSON(messages, { temperature: 0.5 });
}

// ─── 内部校验 ────────────────────────────────────────────────
function validateScriptData(data) {
  if (!data.shots || !Array.isArray(data.shots)) {
    throw new Error('剧本解析结果缺少 shots 数组');
  }
  if (!data.characters || !Array.isArray(data.characters)) {
    throw new Error('剧本解析结果缺少 characters 数组');
  }

  data.shots.forEach((shot, i) => {
    if (!shot.id) shot.id = `shot_${String(i + 1).padStart(3, '0')}`;
    if (!shot.duration) shot.duration = 3;
    if (!shot.characters) shot.characters = [];
    if (!shot.dialogue) shot.dialogue = '';
    if (!shot.speaker) shot.speaker = '';  // 明确说话者，空字符串代表无台词或未标注

    // 确保 characters 是字符串数组（LLM 偶尔会返回对象数组）
    shot.characters = shot.characters.map((c) =>
      typeof c === 'string' ? c : (c?.name || String(c))
    );
  });
}
