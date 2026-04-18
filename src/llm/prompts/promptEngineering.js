import { getSanitizedCharacterTokens } from '../../agents/characterRegistry.js';

/**
 * 图像 Prompt 工程模板
 */

export const PROMPT_ENGINEER_SYSTEM = `你是一位专业的AI图像提示词工程师，擅长为中文漫剧场景生成高质量的英文图像生成Prompt。

你需要根据分镜描述，生成适合Stable Diffusion / Flux模型的提示词。

原则：
1. 主体优先：先描述人物，再描述环境
2. 风格一致：根据指定风格（写实/3D）使用对应关键词
3. 情感准确：通过光线、色调、构图传达情绪
4. 负面词必要：排除常见画质问题
5. 输出双语字段：英文用于模型执行，中文用于展示与审阅`;

export const PROMPT_ENGINEER_USER = (shot, characterCards, style) => `
请为以下分镜生成图像Prompt：

<分镜信息>
场景：${shot.scene}
出场角色：${shot.characters.join('、')}
动作：${shot.action}
情绪：${shot.emotion}
镜头：${shot.camera_type}
</分镜信息>

<连续性约束>
承接镜头：${shot.continuityState?.carryOverFromShotId || shot.continuitySourceShotId || '无'}
场景光照：${shot.continuityState?.sceneLighting || '未指定'}
镜头轴线：${shot.continuityState?.cameraAxis || '未指定'}
道具状态：${Array.isArray(shot.continuityState?.propStates) && shot.continuityState.propStates.length > 0 ? shot.continuityState.propStates.map((item) => `${item.name}:${item.holderEpisodeCharacterId || item.side || 'unknown'}`).join('；') : '无'}
连续风险：${Array.isArray(shot.continuityState?.continuityRiskTags) && shot.continuityState.continuityRiskTags.length > 0 ? shot.continuityState.continuityRiskTags.join('、') : '无'}
</连续性约束>

<角色视觉档案>
${characterCards.map((c) => `${c.name}：${c.visualDescription}${getSanitizedCharacterTokens(c) ? `；identity=${getSanitizedCharacterTokens(c)}` : ''}${c.negativeDriftTokens ? `；avoid=${c.negativeDriftTokens}` : ''}`).join('\n')}
</角色视觉档案>

<风格>
${style === '3d' ? '3D渲染风格（Pixar/Cinema4D质感）' : '写实摄影风格（电影感人像）'}
</风格>

额外要求：
1. 角色 identity 只保留人物固有特征，不要把楼梯、货架、柱子、门、墙等场景元素当成人物特征重复写入。
2. 多人镜头优先突出当前动作主体，配角只保留 1-2 个识别特征，避免把所有人的完整描述整段重复。
3. 镜头差异要明确体现在构图里：主体是谁、前后景关系、视角高低、景别、是否 over-shoulder / single / two-shot / group composition。
4. 如果镜头是特写/近景，不要退回成三人同框的大场面；如果是全景/远景，要交代清楚人物相对位置。

请输出JSON：
{
  "image_prompt_en": "正向提示词（英文，逗号分隔，150词以内）",
  "negative_prompt_en": "负向提示词（英文，逗号分隔）",
  "display_prompt_zh": "中文展示提示词（用于UI/审阅）",
  "display_negative_prompt_zh": "中文负向展示提示词（用于UI/审阅）",
  "style_notes": "风格备注（中文，说明关键设计决策）"
}`;

// 风格基础词库
export const STYLE_BASE = {
  realistic: {
    quality: 'cinematic, photorealistic, 8k uhd, hyperdetailed, sharp focus, absolutely real photography, NOT illustration, NOT animation, NOT cartoon style, NOT anime',
    lighting: 'professional photography, natural lighting, volumetric light',
    negative: 'cartoon, anime, 3d render, painting, sketch, illustration, animated, cel shading, digital art, blurry, low quality, deformed, ugly, watermark',
  },
  '3d': {
    quality: '3D render, Pixar style, Cinema4D, octane render, 8k, subsurface scattering',
    lighting: 'soft ambient lighting, global illumination, ray tracing, soft shadows',
    negative: 'photorealistic, photograph, 2D, flat, sketch, blurry, low quality, watermark',
  },
};

export function buildCharacterRefSheetPrompt(character, style = 'realistic') {
  const tokens = getSanitizedCharacterTokens(character);
  const desc = String(character.visualDescription || '').trim();
  const identity = tokens || desc || 'a person';

  const styleTokens =
    style === '3d'
      ? '3D render, Pixar style, character model sheet'
      : 'photorealistic, studio photo, fashion catalog';

  const prompt = [
    `one single ${character.gender === 'female' ? 'female' : 'male'} person, ${identity}`,
    `character turnaround sheet, 3 views side by side: front | side profile | back`,
    `full body head to toe, standing pose, centered in each panel, pure white seamless studio background`,
    `same person same outfit in all 3 views, equal spacing`,
    `isolated subject only, no props, no furniture, no environment objects, no architecture, no background structures`,
    styleTokens,
    'high quality, sharp, even lighting',
  ].join(', ');

  const negative =
    style === '3d'
      ? 'photograph, blurry, low quality, watermark, text, labels, props, furniture, ladder, stairs, rack, pillar, walls, background objects, environment'
      : 'cartoon, anime, 3d render, illustration, landscape, scenery, nature, building, multiple people, crowd, blurry, low quality, watermark, text, labels, cropped, cut off, props, furniture, ladder, stairs, staircase, rack, pillar, walls, background objects, environment';

  return { prompt, negative };
}

export const CAMERA_KEYWORDS = {
  特写: 'extreme close-up shot, face detail, single subject, expression focus, shallow depth of field',
  近景: 'close-up shot, upper body, single subject emphasis, clean background separation',
  中景: 'medium shot, waist up, subject-driven composition, clear foreground and background relation',
  全景: 'full body shot, full length, staged blocking, visible character spacing',
  远景: 'wide shot, establishing shot, landscape, strong environmental layout, clear relative positions',
};
