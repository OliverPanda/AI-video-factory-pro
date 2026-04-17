# AI Video Factory Pro Agent IO TypeScript Interfaces

## 说明

这份文档把主流程中稳定的 agent 输入输出结构，整理成 TypeScript 接口草案。

用途：

1. 后续可以直接迁移到 `src/types/` 下
2. 可以作为 OpenAPI / JSON Schema 的中间稿
3. 方便前后端、工作流编排器、审计系统共享统一协议

说明约定：

- 当前以“贴近现状”为主，不强行补所有业务约束
- 有些字段在不同阶段是可选的，因此这里会保留较多 `?`
- 某些字段在代码里允许 `null`，这里也保留 `| null`

## Type Definitions

```ts
/** 运行状态枚举 */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_with_warnings'
  | 'completed_with_errors'
  | 'failed'
  | 'blocked'
  | 'pass'
  | 'warn'
  | 'fail';

/** 基础镜头结构 */
export interface Shot {
  /** 镜头唯一 ID */
  id: string;
  /** 场景描述或场次标记 */
  scene?: string | null;
  /** 出现在该镜头中的角色名列表 */
  characters?: string[] | null;
  /** 镜头对白文本 */
  dialogue?: string | null;
  /** 指定说话者 */
  speaker?: string | null;
  /** 镜头动作描述 */
  action?: string | null;
  /** 镜头情绪描述 */
  emotion?: string | null;
  /** 镜头类型 */
  cameraType?: string | null;
  /** 运镜方式 */
  cameraMovement?: string | null;
  /** 时长，兼容旧字段 */
  duration?: number | null;
  /** 时长秒数 */
  durationSec?: number | null;
}

/** 角色注册表卡片 */
export interface CharacterRegistryCard {
  /** 角色卡主键 */
  id: string;
  /** 分集角色实例 ID */
  episodeCharacterId?: string | null;
  /** 角色名 */
  name: string;
  /** 性别 */
  gender?: string | null;
  /** 年龄描述 */
  age?: string | number | null;
  /** 视觉描述 */
  visualDescription?: string | null;
  /** 角色稳定提示词锚点 */
  basePromptTokens?: string | null;
  /** 性格描述 */
  personality?: string | null;
  /** 默认声音配置 */
  defaultVoiceProfile?: Record<string, unknown> | null;
  /** 反漂移提示词 */
  negativeDriftTokens?: string | null;
  /** 灯光锚点 */
  lightingAnchor?: Record<string, unknown>;
  /** 服装锚点 */
  wardrobeAnchor?: Record<string, unknown>;
  /** 角色参考图 */
  referenceImages?: string[];
  /** 核心视觉特征 */
  coreTraits?: Record<string, unknown>;
  /** 角色 bible ID */
  characterBibleId?: string | null;
  /** 主角色模板 ID */
  mainCharacterTemplateId?: string | null;
}

/** 单镜头图像 Prompt 条目 */
export interface PromptEntry {
  /** 对应镜头 ID */
  shotId: string;
  /** 主提示词 */
  image_prompt: string;
  /** 负向提示词 */
  negative_prompt: string;
  /** 风格补充说明 */
  style_notes: string;
}

/** 图像请求上下文 */
export interface ImageRequestContext {
  /** 镜头 ID */
  shotId: string;
  /** 实际请求 prompt */
  prompt: string;
  /** 负向提示词 */
  negativePrompt?: string | null;
  /** 输出文件路径 */
  outputPath: string;
  /** provider 名称 */
  provider?: string | null;
  /** 模型名称 */
  model?: string | null;
}

/** 分镜图结果 */
export interface ImageResult {
  /** 镜头 ID */
  shotId: string;
  /** 对应关键帧资产 ID */
  keyframeAssetId?: string | null;
  /** 实际提交的 prompt */
  prompt: string;
  /** 负向提示词 */
  negativePrompt?: string | null;
  /** 输出图片路径 */
  imagePath: string | null;
  /** 风格标签 */
  style: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string | null;
  /** 请求上下文快照 */
  request?: ImageRequestContext;
}

/** 场景中的单个 beat */
export interface SceneBeat {
  /** beat ID */
  beat_id: string;
  /** 覆盖的镜头 ID 列表 */
  shot_ids: string[];
  /** beat 摘要 */
  summary: string;
  /** 戏剧转折说明 */
  dramatic_turn?: string | null;
}

/** Scene Grammar 输出的场景包 */
export interface ScenePack {
  /** 场景 ID */
  scene_id: string;
  /** 场景标题 */
  scene_title: string;
  /** 场景目标 */
  scene_goal: string;
  /** 场景核心戏剧问题 */
  dramatic_question: string;
  /** 场景起始状态 */
  start_state: string;
  /** 场景结束状态 */
  end_state: string;
  /** 地点锚点 */
  location_anchor: string;
  /** 时间锚点 */
  time_anchor: string;
  /** 角色列表 */
  cast: string[];
  /** 权力关系变化 */
  power_shift: string;
  /** 情绪曲线 */
  emotional_curve: string;
  /** beat 列表 */
  action_beats: SceneBeat[];
  /** 视觉母题 */
  visual_motif: string;
  /** 空间布局 */
  space_layout: Record<string, unknown>;
  /** 场景镜头语法 */
  camera_grammar: Record<string, unknown>;
  /** 硬性连续性锁定条件 */
  hard_locks: string[];
  /** 禁止选择列表 */
  forbidden_choices: string[];
  /** 交付优先级 */
  delivery_priority: string;
  /** 协议校验状态 */
  validation_status?: string;
  /** 协议校验问题 */
  validation_issues?: string[];
}

/** Director pack 中的 shot order 条目 */
export interface DirectorShotOrderPlanEntry {
  /** beat ID */
  beat_id: string;
  /** coverage 策略 */
  coverage: string;
  /** 强调重点 */
  emphasis: string;
}

/** Director pack 中的 blocking 条目 */
export interface DirectorBlockingMapEntry {
  /** beat ID */
  beat_id: string;
  /** 主体站位列表 */
  subject_positions: string[];
  /** 动作/调度说明 */
  movement_note: string;
}

/** Director Pack */
export interface DirectorPack {
  /** 所属场景 ID */
  scene_id: string;
  /** 导演意图总结 */
  cinematic_intent: string;
  /** coverage 策略 */
  coverage_strategy: string;
  /** coverage 顺序规划 */
  shot_order_plan: DirectorShotOrderPlanEntry[];
  /** 入场主状态 */
  entry_master_state: string;
  /** 出场主状态 */
  exit_master_state: string;
  /** 轴线规则 */
  axis_map: Record<string, unknown>;
  /** blocking 映射 */
  blocking_map: DirectorBlockingMapEntry[];
  /** 屏幕方向规则 */
  screen_direction_rules: string[];
  /** 节奏设计 */
  pace_design: Record<string, unknown>;
  /** 表演规则 */
  performance_rules: string[];
  /** 镜头规则 */
  camera_rules: string[];
  /** 参考策略 */
  reference_strategy: Record<string, unknown>;
  /** 连续性锁 */
  continuity_locks: string[];
  /** 候选策略 */
  candidate_strategy: Record<string, unknown>;
  /** 失败重写策略 */
  failure_rewrite_policy: Record<string, unknown>;
  /** 协议校验状态 */
  validation_status?: string;
  /** 协议校验问题 */
  validation_issues?: string[];
}

/** Motion planner 输出 */
export interface MotionPlanEntry {
  /** 镜头 ID */
  shotId: string;
  /** 镜头顺序 */
  order: number;
  /** 镜头类型 */
  shotType: string;
  /** 目标时长 */
  durationTargetSec: number;
  /** 运镜意图 */
  cameraIntent: string;
  /** 结构化镜头规格 */
  cameraSpec: Record<string, unknown>;
  /** 视频生成模式 */
  videoGenerationMode: string;
  /** 视觉目标 */
  visualGoal: string;
  /** 故事节拍 */
  storyBeat: string;
  /** 屏幕方向 */
  screenDirection: string;
  /** 空间锚点 */
  spaceAnchor: string;
  /** 连续性上下文 */
  continuityContext: Record<string, unknown>;
}

/** Performance planner 输出 */
export interface PerformancePlanEntry {
  /** 镜头 ID */
  shotId: string;
  /** 镜头顺序 */
  order?: number | null;
  /** 表演模板 */
  performanceTemplate: string;
  /** 故事节拍 */
  storyBeat?: string | null;
  /** 屏幕方向 */
  screenDirection: string;
  /** 空间锚点 */
  spaceAnchor?: string | null;
  /** 连续性上下文 */
  continuityContext?: Record<string, unknown> | null;
  /** 主体调度信息 */
  subjectBlocking: string[];
  /** 动作节拍列表 */
  actionBeatList: string[];
  /** 镜头运动方案 */
  cameraMovePlan: Record<string, unknown>;
  /** 动作强度 */
  motionIntensity: string;
  /** 节奏曲线 */
  tempoCurve: string;
  /** 表情提示 */
  expressionCue?: string | null;
  /** provider 级提示词指令 */
  providerPromptDirectives: string[];
  /** 后续增强提示 */
  enhancementHints: string[];
  /** 生成层级 */
  generationTier: string;
  /** 候选变体数 */
  variantCount: number;
}

/** 参考图条目 */
export interface ShotReferenceImage {
  /** 参考图类型 */
  type?: string;
  /** 文件路径 */
  path: string;
  /** 在参考栈中的角色，例如 first_frame */
  role?: string;
}

/** 单镜头视频路由包 */
export interface ShotPackage {
  /** 镜头 ID */
  shotId: string;
  /** 镜头类型 */
  shotType?: string | null;
  /** 目标时长 */
  durationTargetSec?: number | null;
  /** 视觉目标 */
  visualGoal?: string | null;
  /** 结构化镜头规格 */
  cameraSpec?: Record<string, unknown> | null;
  /** 参考图列表 */
  referenceImages: ShotReferenceImage[];
  /** 首选 provider */
  preferredProvider: string;
  /** 回退 provider 列表 */
  fallbackProviders: string[];
  /** provider 请求提示 */
  providerRequestHints?: Record<string, unknown> | null;
  /** 可选音频参考 */
  audioRef?: Record<string, unknown> | null;
  /** 连续性上下文 */
  continuityContext?: Record<string, unknown> | null;
  /** 表演模板 */
  performanceTemplate?: string | null;
  /** 动作节拍 */
  actionBeatList: string[];
  /** 镜头运动计划 */
  cameraMovePlan?: Record<string, unknown> | null;
  /** 生成层级 */
  generationTier?: string;
  /** 候选变体数 */
  variantCount?: number;
  /** 候选选择规则 */
  candidateSelectionRule?: string;
  /** 重生成策略 */
  regenPolicy?: string;
  /** 首尾帧策略 */
  firstLastFramePolicy?: string;
  /** 增强提示 */
  enhancementHints?: string[];
  /** QA 规则 */
  qaRules?: Record<string, unknown>;
}

/** 生成包中的 beat */
export interface ShotGenerationBeat {
  /** 时间点，单位秒 */
  at_sec: number;
  /** beat 摘要 */
  summary: string;
}

/** 生成包中的参考条目 */
export interface ShotGenerationPackReference {
  /** 参考类型 */
  type: string;
  /** 参考路径 */
  path: string;
  /** 参考角色 */
  role: string;
}

/** Seedance 单镜头结构化生成包 */
export interface ShotGenerationPack {
  /** 任务类型，固定为 shot */
  task_type: 'shot';
  /** 场景 ID */
  scene_id: string;
  /** 镜头 ID */
  shot_id: string;
  /** 镜头目标 */
  shot_goal: string;
  /** 入画状态 */
  entry_state: string;
  /** 出画状态 */
  exit_state: string;
  /** 时间编码 beat 列表 */
  timecoded_beats: ShotGenerationBeat[];
  /** 镜头规划 */
  camera_plan: Record<string, unknown>;
  /** 角色调度 */
  actor_blocking: string[];
  /** 空间锚点 */
  space_anchor: string;
  /** 角色锁 */
  character_locks: string[];
  /** 环境锁 */
  environment_locks: string[];
  /** 参考栈 */
  reference_stack: ShotGenerationPackReference[];
  /** 负向规则 */
  negative_rules: string[];
  /** 质量目标 */
  quality_target: string;
  /** 协议校验状态 */
  validation_status?: string;
  /** 协议校验问题 */
  validation_issues?: string[];
}

/** Seedance Prompt block */
export interface SeedancePromptBlock {
  /** block 标签 */
  label?: string;
  /** block 文本内容 */
  text: string;
}

/** Seedance Prompt Agent 输出包 */
export interface SeedancePromptPackage extends ShotPackage {
  /** 结构化生成包 */
  generationPack: ShotGenerationPack;
  /** Prompt block 列表 */
  seedancePromptBlocks: SeedancePromptBlock[];
  /** provider 请求提示 */
  providerRequestHints?: Record<string, unknown> | null;
  /** 导演层推断审计 */
  directorInferenceAudit?: Record<string, unknown> | null;
  /** 质量问题 */
  qualityIssues?: string[];
  /** 质量状态 */
  qualityStatus?: string;
}

/** 生成前 QA 处理后的包 */
export interface PreflightReviewedPackage extends SeedancePromptPackage {
  /** 生成前决策 */
  preflightDecision?: 'pass' | 'warn' | 'block';
  /** 决策原因标签 */
  preflightReasons?: string[];
  /** 结构化原因说明 */
  preflightReasonDetails?: Record<string, unknown>[];
  /** 质量分数 */
  preflightScores?: Record<string, unknown>;
}

/** 单镜头视频生成结果 */
export interface VideoGenerationResult {
  /** 镜头 ID */
  shotId: string;
  /** 路由阶段指定的首选 provider */
  preferredProvider?: string;
  /** 实际使用的 provider */
  provider?: string | null;
  /** 生成状态 */
  status: string;
  /** 输出视频路径 */
  videoPath: string | null;
  /** 目标时长 */
  targetDurationSec?: number | null;
  /** 实际时长 */
  actualDurationSec?: number | null;
  /** 失败分类 */
  failureCategory?: string | null;
  /** 错误信息 */
  error?: string | null;
  /** provider 错误码 */
  errorCode?: string | null;
  /** provider 状态码或任务状态 */
  errorStatus?: string | number | null;
  /** provider 返回的详细错误 */
  errorDetails?: Record<string, unknown> | null;
  /** 是否应用增强 */
  enhancementApplied?: boolean;
  /** 增强策略名称 */
  enhancementProfile?: string;
}

/** 单镜头视频 QA 条目 */
export interface ShotQaEntry {
  /** 镜头 ID */
  shotId: string;
  /** QA 状态 */
  qaStatus: string;
  /** 工程检查状态 */
  engineeringStatus: string;
  /** 动态质量状态 */
  motionStatus: string;
  /** 是否允许进入最终时间线 */
  canUseVideo: boolean;
  /** 是否回退静图 */
  fallbackToImage: boolean;
  /** 静止帧持续时长 */
  freezeDurationSec?: number | null;
  /** 近重复帧比例 */
  nearDuplicateRatio?: number | null;
  /** 动态评分 */
  motionScore?: number | null;
  /** 是否应用增强 */
  enhancementApplied?: boolean;
  /** 增强策略 */
  enhancementProfile?: string;
  /** 最终决策 */
  finalDecision: string;
  /** 决策原因 */
  decisionReason?: string | null;
  /** 决策原因简写 */
  reason?: string | null;
  /** 实测时长 */
  durationSec?: number | null;
  /** 目标时长 */
  targetDurationSec?: number | null;
  /** 错误信息 */
  error?: string | null;
}

/** 单镜头视频 QA 报告 */
export interface ShotQaReport {
  /** 报告总体状态 */
  status: string;
  /** 明细条目 */
  entries: ShotQaEntry[];
  /** 计划验收镜头数 */
  plannedShotCount: number;
  /** 工程通过数 */
  engineeringPassedCount: number;
  /** 动态通过数 */
  motionPassedCount: number;
  /** 最终通过数 */
  passedCount: number;
  /** 回退数 */
  fallbackCount: number;
  /** 回退镜头列表 */
  fallbackShots: string[];
  /** 风险提醒 */
  warnings?: string[];
}

/** 桥接镜头规划条目 */
export interface BridgeShotPlanEntry {
  /** 桥接片段 ID */
  bridgeId: string;
  /** 起始镜头 ID */
  fromShotId: string;
  /** 目标镜头 ID */
  toShotId: string;
  /** 桥接类型 */
  bridgeType: string;
  /** 桥接目标 */
  bridgeGoal: string;
  /** 目标时长 */
  durationTargetSec: number;
  /** 连续性风险等级 */
  continuityRisk: string;
  /** 镜头转场意图 */
  cameraTransitionIntent: string;
  /** 主体连续性目标 */
  subjectContinuityTargets: string[];
  /** 环境连续性目标 */
  environmentContinuityTargets: string[];
  /** 必须保留元素 */
  mustPreserveElements: string[];
  /** 桥接生成模式 */
  bridgeGenerationMode: string;
  /** 首选 provider */
  preferredProvider: string;
  /** 回退策略 */
  fallbackStrategy: string;
}

/** 桥接镜头路由包 */
export interface BridgeShotPackage {
  /** 桥接片段 ID */
  bridgeId: string;
  /** 起始镜头引用 */
  fromShotRef: Record<string, unknown>;
  /** 目标镜头引用 */
  toShotRef: Record<string, unknown>;
  /** 起始关键帧路径 */
  fromReferenceImage?: string | null;
  /** 结束关键帧路径 */
  toReferenceImage?: string | null;
  /** 正向生成指令 */
  promptDirectives: string[];
  /** 负向限制指令 */
  negativePromptDirectives: string[];
  /** 目标时长 */
  durationTargetSec: number;
  /** provider 能力要求 */
  providerCapabilityRequirement?: string | null;
  /** 首尾帧模式 */
  firstLastFrameMode?: string | null;
  /** 首选 provider */
  preferredProvider: string;
  /** 回退 provider 列表 */
  fallbackProviders: string[];
  /** QA 规则 */
  qaRules?: Record<string, unknown>;
}

/** 桥接片段生成结果 */
export interface BridgeClipResult {
  /** 桥接片段 ID */
  bridgeId: string | null;
  /** 生成状态 */
  status: string;
  /** 实际 provider */
  provider?: string | null;
  /** 实际模型 */
  model?: string | null;
  /** 输出视频路径 */
  videoPath: string | null;
  /** 目标时长 */
  targetDurationSec?: number | null;
  /** 实际时长 */
  actualDurationSec?: number | null;
  /** 失败分类 */
  failureCategory?: string | null;
  /** 错误信息 */
  error?: string | null;
  /** provider 任务 ID */
  taskId?: string | null;
  /** provider 产物 URL */
  outputUrl?: string | null;
}

/** 桥接 QA 条目 */
export interface BridgeQaEntry {
  /** 桥接片段 ID */
  bridgeId: string;
  /** 工程检查状态 */
  engineeringStatus: string;
  /** 连续性检查状态 */
  continuityStatus: string;
  /** 转场平滑程度 */
  transitionSmoothness: string;
  /** 角色漂移风险 */
  identityDriftRisk: string;
  /** 轴线状态 */
  cameraAxisStatus: string;
  /** 最终决策 */
  finalDecision: string;
  /** 决策原因 */
  decisionReason: string;
  /** 实测时长 */
  durationSec?: number | null;
  /** 目标时长 */
  targetDurationSec?: number | null;
  /** 检查错误 */
  error?: string | null;
}

/** 桥接 QA 报告 */
export interface BridgeQaReport {
  /** 报告状态 */
  status: string;
  /** 明细条目 */
  entries: BridgeQaEntry[];
  /** 通过数 */
  passedCount: number;
  /** 回退数 */
  fallbackCount: number;
  /** 人工复核数 */
  manualReviewCount: number;
  /** 风险提醒 */
  warnings?: string[];
}

/** sequence 规划条目 */
export interface ActionSequencePlanEntry {
  /** sequence ID */
  sequenceId: string;
  /** 覆盖镜头 ID 列表 */
  shotIds: string[];
  /** sequence 类型 */
  sequenceType?: string | null;
  /** sequence 目标 */
  sequenceGoal?: string | null;
  /** 目标时长 */
  durationTargetSec?: number | null;
  /** 镜头流动意图 */
  cameraFlowIntent?: string | null;
  /** 动作连续性目标 */
  motionContinuityTargets: string[];
  /** 主体连续性目标 */
  subjectContinuityTargets: string[];
  /** 环境连续性目标 */
  environmentContinuityTargets: string[];
  /** 必须保留元素 */
  mustPreserveElements: string[];
  /** 入段约束 */
  entryConstraint?: string | null;
  /** 出段约束 */
  exitConstraint?: string | null;
  /** 生成模式 */
  generationMode?: string | null;
  /** 首选 provider */
  preferredProvider?: string | null;
  /** 回退策略 */
  fallbackStrategy?: string | null;
}

/** sequence 路由包 */
export interface ActionSequencePackage {
  /** sequence ID */
  sequenceId: string;
  /** 覆盖镜头 ID 列表 */
  shotIds: string[];
  /** 目标时长 */
  durationTargetSec?: number | null;
  /** 参考图列表 */
  referenceImages: Record<string, unknown>[];
  /** 参考视频列表 */
  referenceVideos: Record<string, unknown>[];
  /** bridge 辅助参考 */
  bridgeReferences: Record<string, unknown>[];
  /** 参考策略 */
  referenceStrategy?: string | null;
  /** 跳过生成原因 */
  skipReason?: string | null;
  /** 视觉目标 */
  visualGoal?: string | null;
  /** 文本化镜头规格 */
  cameraSpec?: string | null;
  /** 连续性说明 */
  continuitySpec?: string | null;
  /** 上下文摘要 */
  sequenceContextSummary?: string | null;
  /** 入帧提示 */
  entryFrameHint?: string | null;
  /** 出帧提示 */
  exitFrameHint?: string | null;
  /** 音频节拍提示 */
  audioBeatHints: Record<string, unknown>[];
  /** 首选 provider */
  preferredProvider?: string | null;
  /** 回退 provider 列表 */
  fallbackProviders: string[];
  /** provider 请求提示 */
  providerRequestHints?: Record<string, unknown> | null;
  /** QA 规则 */
  qaRules: string[];
}

/** sequence 生成结果 */
export interface SequenceClipResult {
  /** sequence ID */
  sequenceId: string | null;
  /** 生成状态 */
  status: string | null;
  /** 实际 provider */
  provider?: string | null;
  /** 实际模型 */
  model?: string | null;
  /** 视频路径 */
  videoPath?: string | null;
  /** 覆盖镜头列表 */
  coveredShotIds: string[];
  /** 目标时长 */
  targetDurationSec?: number | null;
  /** 实际时长 */
  actualDurationSec?: number | null;
  /** 失败分类 */
  failureCategory?: string | null;
  /** 错误信息 */
  error?: string | null;
}

/** sequence QA 条目 */
export interface SequenceQaEntry {
  /** sequence ID */
  sequenceId: string | null;
  /** 覆盖镜头列表 */
  coveredShotIds: string[];
  /** 工程检查结果 */
  engineCheck?: string | null;
  /** 连续性检查结果 */
  continuityCheck?: string | null;
  /** 时长检查结果 */
  durationCheck?: string | null;
  /** 首尾衔接检查结果 */
  entryExitCheck?: string | null;
  /** 最终决策 */
  finalDecision?: string | null;
  /** 回退动作 */
  fallbackAction?: string | null;
  /** 备注 */
  notes?: string | null;
  /** 决策原因 */
  decisionReason?: string | null;
  /** QA 失败分类 */
  qaFailureCategory?: string | null;
  /** 推荐动作 */
  recommendedAction?: string | null;
}

/** sequence QA 报告 */
export interface SequenceQaReport {
  /** 报告状态 */
  status: string;
  /** 明细条目 */
  entries: SequenceQaEntry[];
  /** 通过数 */
  passedCount: number;
  /** 回退数 */
  fallbackCount: number;
  /** 人工复核数 */
  manualReviewCount: number;
  /** 风险提醒 */
  warnings: string[];
  /** 阻断项 */
  blockers: string[];
  /** 主要失败类别 */
  topFailureCategory?: string | null;
  /** 顶层推荐动作 */
  topRecommendedAction?: string | null;
  /** 动作统计 */
  actionBreakdown?: Record<string, number>;
  /** 失败类别统计 */
  failureCategoryBreakdown?: Record<string, number>;
  /** 回退的 sequence ID 列表 */
  fallbackSequenceIds?: string[];
  /** 待人工复核 sequence ID 列表 */
  manualReviewSequenceIds?: string[];
}

/** 对白标准化后的镜头 */
export interface NormalizedShot extends Shot {
  /** 原始对白 */
  dialogueOriginal: string;
  /** 标准化后的对白 */
  dialogue: string;
  /** 切分后的对白段 */
  dialogueSegments: string[];
  /** 估算对白时长，单位毫秒 */
  dialogueDurationMs: number | null;
}

/** 音频结果 */
export interface AudioResult {
  /** 镜头 ID */
  shotId: string;
  /** 输出音频路径 */
  audioPath: string | null;
  /** 是否有对白 */
  hasDialogue: boolean;
  /** 错误信息 */
  error?: string | null;
}

/** 选声解析条目 */
export interface VoiceResolutionEntry {
  /** 镜头 ID */
  shotId: string;
  /** 是否有对白 */
  hasDialogue: boolean;
  /** 实际送入 TTS 的对白 */
  dialogue: string;
  /** 说话者名字 */
  speakerName: string;
  /** 性别解析结果 */
  resolvedGender?: string | null;
  /** 实际下发到 TTS 的参数 */
  ttsOptions?: Record<string, unknown> | null;
  /** 是否使用默认兜底音色 */
  usedDefaultVoiceFallback: boolean;
  /** 解析状态 */
  status: string;
  /** 输出音频路径 */
  audioPath: string | null;
  /** 语音预设 ID */
  voicePresetId?: string | null;
  /** 声音来源 */
  voiceSource: string;
  /** 错误信息 */
  error?: string | null;
}

/** TTS QA 报告 */
export interface TtsQaReport {
  /** 报告状态 */
  status: string;
  /** 明细条目 */
  entries: Record<string, unknown>[];
  /** 有对白镜头数 */
  dialogueShotCount: number;
  /** fallback 次数 */
  fallbackCount: number;
  /** fallback 比率 */
  fallbackRate: number;
  /** 时长预算通过率 */
  budgetPassRate: number;
  /** 阻断项 */
  blockers: string[];
  /** 风险提醒 */
  warnings: string[];
  /** 抽检计划 */
  manualReviewPlan?: Record<string, unknown>;
  /** ASR 回听报告 */
  asrReport?: Record<string, unknown>;
}

/** lipsync 条目 */
export interface LipsyncResult {
  /** 镜头 ID */
  shotId: string;
  /** 是否触发 lipsync */
  triggered: boolean;
  /** 执行状态 */
  status: string;
  /** 状态原因 */
  reason?: string | null;
  /** 实际 provider */
  provider?: string | null;
  /** 尝试过的 provider */
  attemptedProviders?: string[];
  /** 是否发生 provider fallback */
  fallbackApplied?: boolean;
  /** 从哪个 provider 回退 */
  fallbackFrom?: string | null;
  /** 输入图片路径 */
  imagePath?: string | null;
  /** 输入音频路径 */
  audioPath?: string | null;
  /** 输出视频路径 */
  videoPath?: string | null;
  /** 时长 */
  durationSec?: number | null;
  /** 音画时间偏移 */
  timingOffsetMs?: number | null;
  /** 评估器结果 */
  evaluator?: Record<string, unknown> | null;
  /** 是否发生降级 */
  downgradeApplied?: boolean;
  /** 降级原因 */
  downgradeReason?: string | null;
  /** QA 状态 */
  qaStatus?: string;
  /** QA 风险项 */
  qaWarnings?: string[];
  /** QA 阻断项 */
  qaBlockers?: string[];
  /** 是否需要人工复核 */
  manualReviewRequired?: boolean;
  /** 错误信息 */
  error?: string | null;
}

/** lipsync 报告 */
export interface LipsyncReport {
  /** 报告状态 */
  status: string;
  /** 触发数 */
  triggeredCount: number;
  /** 成功生成数 */
  generatedCount: number;
  /** 失败数 */
  failedCount: number;
  /** 跳过数 */
  skippedCount: number;
  /** 降级数 */
  downgradedCount: number;
  /** fallback 数 */
  fallbackCount: number;
  /** fallback 镜头列表 */
  fallbackShots: string[];
  /** 人工复核数 */
  manualReviewCount: number;
  /** 人工复核镜头列表 */
  manualReviewShots: string[];
  /** 阻断项 */
  blockers: string[];
  /** 风险提醒 */
  warnings: string[];
  /** 全量条目 */
  entries: LipsyncResult[];
}

/** 时间线合成条目 */
export interface CompositionPlanItem {
  /** 时间线条目 ID */
  shotId: string;
  /** sequence ID */
  sequenceId?: string | null;
  /** bridge ID */
  bridgeId?: string | null;
  /** sequence 覆盖镜头列表 */
  coveredShotIds?: string[] | null;
  /** 时间线起始锚镜头 */
  timelineFromShotId?: string | null;
  /** 时间线结束锚镜头 */
  timelineToShotId?: string | null;
  /** bridge 起始镜头 */
  fromShotId?: string | null;
  /** bridge 目标镜头 */
  toShotId?: string | null;
  /** 可视资产类型 */
  visualType: string;
  /** 视频路径 */
  videoPath?: string | null;
  /** 静图路径 */
  imagePath?: string | null;
  /** 音频路径 */
  audioPath?: string | null;
  /** 对白文本 */
  dialogue: string;
  /** 该条目时长 */
  duration: number;
}

/** 最终合成结果 */
export interface ComposeResult {
  /** 任务 ID */
  jobId?: string | null;
  /** 合成状态 */
  status: string;
  outputVideo: {
    /** 固定为 video */
    type: 'video';
    /** 输出视频路径 */
    uri: string;
    /** 输出格式 */
    format: string;
  };
  /** 交付报告 */
  report: Record<string, unknown>;
  /** 产物索引 */
  artifacts: Record<string, unknown>;
}
```

## 建议

如果下一步要把这些类型真正落进代码里，建议拆成：

1. `src/types/core.ts`
2. `src/types/scene-director.ts`
3. `src/types/video-pipeline.ts`
4. `src/types/audio-pipeline.ts`
5. `src/types/composition.ts`

这样比把所有接口塞进一个文件里更容易维护。
