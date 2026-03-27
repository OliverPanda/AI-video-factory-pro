/**
 * 角色设定Agent - 维护角色视觉档案，确保跨镜头一致性
 */

import { chatJSON } from '../llm/client.js';
import logger from '../utils/logger.js';

const CHARACTER_SYSTEM = `你是专业的漫剧角色设计师，负责为角色创建详细的视觉设定档案。
你需要从剧本信息中提取角色的视觉特征，并生成可用于AI图像生成的英文描述词。

原则：
- 描述要具体可视化，避免抽象词汇
- 优先描述可见特征：发型、发色、面部、体型、服装
- 生成图像提示词要与所选风格（写实/3D）匹配`;

/**
 * 构建角色视觉档案
 * @param {Array<{name, gender, age}>} characters - 角色列表（来自剧本解析）
 * @param {string} scriptContext - 剧本摘要（提供上下文）
 * @param {string} style - 'realistic' | '3d'
 * @returns {Promise<Array<CharacterCard>>}
 */
export async function buildCharacterRegistry(characters, scriptContext, style = 'realistic') {
  logger.info('CharacterRegistry', `构建 ${characters.length} 个角色的视觉档案...`);

  const prompt = `
根据以下剧本信息，为每个角色创建详细的视觉档案：

<剧本背景>
${scriptContext}
</剧本背景>

<角色列表>
${characters.map((c) => `- ${c.name}（${c.gender === 'female' ? '女' : '男'}，${c.age || '成年'}）`).join('\n')}
</角色列表>

<视觉风格>
${style === '3d' ? '3D渲染风格（Pixar/Cinema4D）' : '写实摄影风格（电影级人像）'}
</视觉风格>

请为每个角色输出JSON档案，格式：
{
  "characters": [
    {
      "name": "角色名",
      "gender": "male/female",
      "age": "年龄描述",
      "visualDescription": "用于Prompt的英文外观描述（含发型、肤色、服装等，50词内）",
      "basePromptTokens": "核心提示词（10-15个英文词，每次生成该角色时必须包含）",
      "personality": "性格特点（中文，影响表情/姿态生成）"
    }
  ]
}`;

  const result = await chatJSON(
    [
      { role: 'system', content: CHARACTER_SYSTEM },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.4 }
  );

  const cards = result.characters || [];
  logger.info('CharacterRegistry', `角色档案构建完成：${cards.map((c) => c.name).join('、')}`);
  return cards;
}

/**
 * 获取指定角色的 Prompt 插入词
 * @param {string} characterName
 * @param {Array} registry
 * @returns {string} basePromptTokens
 */
export function getCharacterTokens(characterName, registry) {
  const card = registry.find((c) => c.name === characterName);
  return card ? card.basePromptTokens : '';
}

/**
 * 获取分镜中所有角色的 Prompt 组合
 */
export function getShotCharacterTokens(shot, registry) {
  if (!shot.characters || shot.characters.length === 0) return '';
  return shot.characters
    .map((name) => getCharacterTokens(name, registry))
    .filter(Boolean)
    .join(', ');
}
