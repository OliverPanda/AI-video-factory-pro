import { getSanitizedCharacterTokens, sanitizeCharacterIdentityTokens } from '../../agents/characterRegistry.js';
import { getCharacterIdentityAnchor, getCharacterForbiddenIdentityTokens } from '../../agents/characterRegistry.js';

/**
 * 图像 Prompt 工程模板
 */

export const PROMPT_ENGINEER_SYSTEM = `你是一位专业的AI视觉提示词工程师，精通为图像生成模型（Flux/SD）和视频生成模型（Seedance 2.0/HappyHorse）编写高质量英文提示词。

你需要根据分镜描述，生成适合目标模型的提示词。

## 核心原则
1. **主体优先**：先描述人物（身份锚点、服装、姿态），再描述环境（空间、光线、氛围）
2. **风格一致**：根据指定风格（写实/3D）使用对应关键词，不混用
3. **情感准确**：通过光线方向、色调温度、构图张力传达情绪，而非仅用形容词堆砌
4. **负面词必要**：排除常见画质问题，但不在正向词中使用 "NOT X" 否定句式
5. **镜头可执行**：确保描述的内容是模型能生成的——不说"像XX电影"，而是说具体的光影构图
6. **输出双语**：英文用于模型执行，中文用于UI展示与审阅
7. **视频思维**：如果该分镜将用于视频生成，需额外考虑——人物动作的起点和落点、镜头运动的动机、空间方位的连续性

## 视频模型专项指导
- 镜头运动要有动机：不是为动而动，而是跟随情绪节拍或人物动作
- 人物动作要可落地：描述从什么姿态开始 → 中间动作 → 落到什么姿态结束
- 空间方位要稳定：在连续分镜中保持一致的朝向、轴线和场景地理
- 不要过度描述细节：视频模型的 token 预算有限，优先保证主体清晰、动作可读、空间稳定

## Few-Shot 示例

### ✅ 好的 Prompt（视频可用）
"medium shot of a young woman with shoulder-length black hair, white blouse, standing by a rain-streaked window, right hand reaching toward the glass, expression shifting from melancholy to quiet resolve, motivated by the off-screen voice, soft natural window light, slow dolly push-in, shallow depth of field, cinematic live-action footage"

### ❌ 差的 Prompt（视频不可用）
"beautiful woman, sad, cinematic lighting, masterpiece, 8k, hyperdetailed, NOT anime, NOT cartoon, like a Wong Kar-wai film, emotional atmosphere, rainy day"

### 关键差异说明
- 好的 prompt 描述了具体动作路径（hand reaching）、情绪变化方向（melancholy → resolve）、镜头运动动机（motivated by voice）
- 差的 prompt 只有形容词堆砌和否定句式，模型无从执行
- 好的 prompt 给出了可被下一镜承接的动作落点（hand on glass, expression resolved）
- 差的 prompt 没有时空锚点，跨镜连续性无法保证`;



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

// ============================================================
// 风格基础词库（v2 — 视频模型友好）
// 原则：
//   - 不使用 "NOT X" 否定式正向词（视频模型对此解析与 SD 不同）
//   - 正向描述视觉目标，负面交给 negative prompt
//   - 区分图像生成（Flux/SD）与视频模型（Seedance/HappyHorse）两套预设
// ============================================================

/**
 * 图像生成风格词库（Flux / SD3 等静态图模型）
 * 保留原有高质量词，移除 "NOT X" 否定式正向词
 */
export const STYLE_BASE = {
  realistic: {
    quality:
      'cinematic photography, photorealistic, sharp focus, fine skin texture, natural fabric drape, lifelike proportions, film grain subtle',
    lighting:
      'motivated natural lighting, soft volumetric atmosphere, practical light sources, cinematic contrast ratio',
    negative:
      'cartoon, anime, 3d render, painting, sketch, illustration, cel shading, digital art, blurry, low quality, deformed anatomy, ugly, watermark, text, signature',
  },
  '3d': {
    quality:
      '3D render, premium CG character, subsurface scattering, physically based materials, clean topology, production-ready shading',
    lighting:
      'soft ambient lighting, global illumination, ray-traced shadows, rim light accent, studio three-point light',
    negative:
      'photorealistic, photograph, 2D flat, sketch, blurry, low quality, watermark, text, signature, broken mesh, UV stretching',
  },
};

/**
 * 视频模型风格词库（Seedance 2.0 / HappyHorse 等动态模型）
 * 重点：运动质量、时间一致性、镜头行为，而非静态画质词
 */
export const VIDEO_STYLE_BASE = {
  seedance: {
    quality:
      'cinematic live-action footage, natural film grain, 35mm aesthetic, organic human motion, realistic fabric physics, coherent temporal consistency',
    lighting:
      'motivated lighting continuity, natural light falloff, consistent shadow direction across frames, atmospheric depth',
    negative:
      'overactive camera, rapid motion blur, jittery handheld, ghosting artifacts, morphing faces, identity drift, frame flicker, inconsistent lighting, broken limb motion, unnatural body twist',
  },
  happyhorse: {
    quality:
      'cinematic live-action footage, smooth motion cadence, stable subject tracking, natural body mechanics, controlled movement amplitude, coherent frame-to-frame transition',
    lighting:
      'stable lighting across frames, motivated practical light, consistent exposure, natural color temperature',
    negative:
      'overactive camera movement, rapid erratic motion, jittery handheld shake, ghosting artifacts, identity morphing, face swapping, frame flicker, lighting pop, motion blur excess, body part teleportation, limb distortion, floating limbs, unsupported body twist',
  },
};

export function buildCharacterRefSheetPrompt(character, style = 'realistic') {
  const identityAnchor = getCharacterIdentityAnchor(character);
  const tokens = getSanitizedCharacterTokens(character);
  const desc = sanitizeCharacterIdentityTokens(character.visualDescription || '');
  const forbiddenIdentityTokens = getCharacterForbiddenIdentityTokens(character);
  const personality = sanitizeCharacterIdentityTokens(character.personality || character.persona || '');
  const identity = identityAnchor || tokens || desc || 'a person';

  const styleTokens =
    style === '3d'
      ? '3D render, premium character design sheet, physically based materials, clean studio presentation'
      : 'photorealistic, premium character design sheet, studio quality, production-ready presentation';

  // v2 精简版：聚焦核心视觉锚点，控制 prompt 在 ~120 词以内
  const prompt = [
    `character reference sheet of one single ${character.gender === 'female' ? 'female' : 'male'} character, ${identity}`,
    'clean white background, presentation board layout',
    '3 full-body views side by side: front view, side profile, back view, same person, same outfit, same proportions, neutral standing pose',
    'facial close-up detail inset, color palette chips for hair skin and costume',
    'accessory and pattern detail insets for hard-to-read construction elements',
    'proportion reference with scale guide for intuitive height comparison',
    personality ? `character personality expressed through costume language and controlled expression: ${personality}` : null,
    'isolated subject only, no props, no furniture, no environment, no background structures, no ladder, no stairs, no rack, no pillar, no wall',
    styleTokens,
    'high quality, sharp, even studio lighting',
  ]
    .filter(Boolean)
    .join(', ');

  const negative =
    style === '3d'
      ? 'photograph, blurry, low quality, watermark, text captions, props, furniture, environment objects, background structures, extra people, inconsistent outfit, inconsistent proportions, cropped body, missing limbs, broken anatomy'
      : 'cartoon, anime, 3d render, illustration, blurry, low quality, watermark, text captions, props, furniture, environment objects, background structures, multiple people, cropped, inconsistent outfit, inconsistent proportions, missing limbs, broken anatomy';

  const mergedNegative = [negative, forbiddenIdentityTokens].filter(Boolean).join(', ');

  return { prompt, negative: mergedNegative };
}

// ============================================================
// 镜头语法（v2 — 四维：景别 × 焦距机位 × 构图 × 运动）
// ============================================================

export const CAMERA_KEYWORDS = {
  // 景别（向后兼容）
  特写: 'extreme close-up shot, face detail, single subject, expression focus, shallow depth of field',
  近景: 'close-up shot, upper body, single subject emphasis, clean background separation',
  中景: 'medium shot, waist up, subject-driven composition, clear foreground and background relation',
  全景: 'full body shot, full length, staged blocking, visible character spacing',
  远景: 'wide shot, establishing shot, landscape, strong environmental layout, clear relative positions',
};

/**
 * 镜头语法（四维）：景别 + 焦距机位 + 构图规则 + 运动类型
 * 用于视频模型 prompt 的精确镜头控制
 */
export const CAMERA_GRAMMAR = {
  // --- 景别 (Shot Size) ---
  shotSize: {
    ecu: 'extreme close-up, facial detail only, 135mm telephoto, razor-thin depth of field, intimate emotional register',
    cu: 'close-up, face fills frame, 85mm portrait lens, shallow depth f/2.8, subject isolation from background',
    mcu: 'medium close-up, head and shoulders, 50mm lens, soft background separation, personal space distance',
    ms: 'medium shot, waist up, 35mm lens, natural perspective, subject-context balance',
    mls: 'medium long shot, full body visible, 28mm lens, subject in environmental context',
    fs: 'full shot, entire body head to toe, 24mm lens, clear staging and blocking readable',
    ws: 'wide shot, small figure in large space, 18mm wide lens, deep focus, environmental storytelling',
    ews: 'extreme wide shot, establishing landscape, 14mm ultrawide, maximum depth of field, space dominates figure',
  },

  // --- 机位高度 (Camera Height) ---
  cameraHeight: {
    low_angle: 'low angle shot, camera looking up, subject appears dominant powerful imposing, sky or ceiling as backdrop',
    eye_level: 'eye-level shot, neutral perspective, natural human viewpoint, conversational intimacy',
    high_angle: 'high angle shot, camera looking down, subject appears vulnerable diminished, floor or ground visible',
    birds_eye: 'overhead birds-eye view, directly above looking straight down, geometric spatial relationship',
    dutch: 'dutch angle, tilted horizon, psychological unease, destabilized perspective, off-kilter world',
  },

  // --- 构图规则 (Composition) ---
  composition: {
    rule_of_thirds: 'subject placed on rule-of-thirds intersection, balanced negative space, visual breathing room',
    leading_lines: 'leading lines guide eye to subject, depth cues through linear perspective, directional flow',
    frame_within_frame: 'foreground elements frame the subject, layered depth, voyeuristic or observational feel',
    symmetry: 'symmetrical composition, centered subject, formal balanced framing, Kubrick-esque precision',
    negative_space: 'generous negative space around subject, isolation and scale emphasized, minimalist visual weight',
    over_shoulder: 'over-the-shoulder framing, foreground shoulder out of focus, viewer as observer in the scene',
    two_shot: 'two-shot composition, both characters in frame, relationship dynamic readable through spacing',
    group_shot: 'group composition, multiple subjects staged with clear foreground midground background separation',
  },

  // --- 运动类型 (Camera Movement) — 视频模型专属 ---
  movement: {
    static_locked: 'locked-off static camera, no movement, tripod stability, pure compositional frame',
    slow_push: 'slow dolly push-in, gradual focal compression, emotional intensification, foreground-background separation increasing',
    slow_pull: 'slow dolly pull-out, gradual reveal of context, emotional distancing, space expanding around subject',
    tracking: 'lateral tracking shot, camera moves parallel to subject, steady speed, background parallax motion',
    handheld_float: 'gentle handheld float, subtle organic breathing motion, documentary intimacy, NOT shaky, NOT abrupt jerk',
    whip_pan: 'controlled whip pan, swift directional camera swing, motion blur transition, energy punctuation',
    crane_up: 'slow crane rise, vertical reveal, scale and context expanding, subject becoming small in space',
    crane_down: 'slow crane descent, vertical approach, focus narrowing, subject growing in frame',
    dolly_zoom: 'dolly zoom effect, simultaneous dolly and zoom in opposite directions, vertigo perspective shift, psychological tension',
    steadicam_follow: 'steadicam follow, smooth tracking behind or beside subject, floating stability, immersive walk-and-talk',
    rack_focus: 'rack focus pull, shift of focus plane from foreground to background or reverse, attention redirection',
  },

  // --- 组合式镜头语法模板 ---
  combine(shotSize, cameraHeight, composition, movement) {
    const parts = [
      CAMERA_GRAMMAR.shotSize[shotSize] || shotSize || '',
      CAMERA_GRAMMAR.cameraHeight[cameraHeight] || cameraHeight || '',
      CAMERA_GRAMMAR.composition[composition] || composition || '',
      CAMERA_GRAMMAR.movement[movement] || movement || '',
    ];
    return parts.filter(Boolean).join(', ');
  },
};

/**
 * HappyHorse 专属镜头运动语法
 * HappyHorse 对运动幅度、速度、节奏有特殊敏感性，需要显式控制
 */
export const HAPPYHORSE_CAMERA_GRAMMAR = {
  movement: {
    static_locked:
      'locked-off static camera, absolutely no movement, tripod stability, pure frame composition',
    slow_push:
      'slow steady push-in, gradual and smooth, no speed variation, motion intensity: subtle, camera speed: 0.3x slow',
    slow_pull:
      'slow steady pull-out, gradual reveal, no sudden speed change, motion intensity: subtle, camera speed: 0.3x slow',
    tracking:
      'smooth lateral tracking, constant speed left-to-right, no vertical bob, motion intensity: moderate, camera speed: 0.5x',
    handheld_float:
      'gentle handheld breathing, micro-movements only, organic but controlled, motion intensity: very subtle, camera speed: 0.2x, NO abrupt jerk, NO sudden direction change',
    whip_pan:
      'controlled directional whip pan, swift but smooth, single direction only, motion intensity: high, camera speed: 1.0x, settle to stable frame at end',
    crane_up:
      'slow crane rise, constant vertical speed, no lateral drift, motion intensity: subtle, camera speed: 0.3x',
    crane_down:
      'slow crane descent, constant vertical speed, smooth landing, motion intensity: subtle, camera speed: 0.3x',
    steadicam_follow:
      'steadicam smooth follow, consistent distance from subject, floating stability, motion intensity: moderate, camera speed: 0.5x, no sudden stops',
  },

  // HappyHorse 人物运动幅度控制
  subjectMotion: {
    subtle: 'minimal subject movement, micro-expressions and subtle gestures only, restrained body language',
    moderate: 'moderate subject movement, natural walking pace, conversational gestures, controlled range of motion',
    dynamic: 'dynamic subject movement, full body action, extended range of motion, energetic physical performance',
  },

  // HappyHorse motion intensity + speed 控制标签
  motionControl(movementKey, subjectMotionKey) {
    const cam = HAPPYHORSE_CAMERA_GRAMMAR.movement[movementKey] || movementKey || '';
    const subj = HAPPYHORSE_CAMERA_GRAMMAR.subjectMotion[subjectMotionKey] || subjectMotionKey || '';
    return [cam, subj].filter(Boolean).join(', ');
  },
};
