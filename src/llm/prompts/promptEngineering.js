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
5. 输出英文Prompt，但场景理解用中文`;

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
${characterCards.map((c) => `${c.name}：${c.visualDescription}${c.basePromptTokens ? `；identity=${c.basePromptTokens}` : ''}${c.negativeDriftTokens ? `；avoid=${c.negativeDriftTokens}` : ''}`).join('\n')}
</角色视觉档案>

<风格>
${style === '3d' ? '3D渲染风格（Pixar/Cinema4D质感）' : '写实摄影风格（电影感人像）'}
</风格>

请输出JSON：
{
  "image_prompt": "正向提示词（英文，逗号分隔，150词以内）",
  "negative_prompt": "负向提示词（英文，逗号分隔）",
  "style_notes": "风格备注（中文，说明关键设计决策）"
}`;

// 风格基础词库
export const STYLE_BASE = {
  realistic: {
    quality: 'cinematic, photorealistic, 8k uhd, hyperdetailed, sharp focus',
    lighting: 'professional photography, natural lighting, volumetric light',
    negative: 'cartoon, anime, 3d render, painting, sketch, blurry, low quality, deformed, ugly, watermark',
  },
  '3d': {
    quality: '3D render, Pixar style, Cinema4D, octane render, 8k, subsurface scattering',
    lighting: 'soft ambient lighting, global illumination, ray tracing, soft shadows',
    negative: 'photorealistic, photograph, 2D, flat, sketch, blurry, low quality, watermark',
  },
};

export const CAMERA_KEYWORDS = {
  特写: 'extreme close-up shot, face detail',
  近景: 'close-up shot, upper body',
  中景: 'medium shot, waist up',
  全景: 'full body shot, full length',
  远景: 'wide shot, establishing shot, landscape',
};
