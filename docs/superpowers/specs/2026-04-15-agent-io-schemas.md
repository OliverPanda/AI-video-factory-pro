# AI Video Factory Pro Agent IO Schemas

## 说明

这份文档描述的是当前 Director 主流程中各个 agent 的输入 schema、输出 schema、落盘产物。

范围基于当前主编排入口：

- `src/agents/director.js`
- `runEpisodePipeline({ projectId, scriptId, episodeId, options })`
- `runPipeline(scriptFilePath, options)` 兼容入口

文档目标：

1. 说明每个 agent 接收什么输入
2. 说明每个 agent 输出什么结构
3. 说明这些结构分别落盘到哪里
4. 给每个字段补齐中文注释，方便后续改造为 API 协议或数据库表

## 主流程 Agent 顺序

当前主流程按大致顺序执行这些 agent：

1. `Director`
2. `ScriptParser`
3. `CharacterRegistry`
4. `PromptEngineer`
5. `ImageGenerator`
6. `SceneGrammarAgent`
7. `DirectorPackAgent`
8. `MotionPlanner`
9. `PerformancePlanner`
10. `VideoRouter`
11. `SeedancePromptAgent`
12. `PreflightQaAgent`
13. `SeedanceVideoAgent` / `Sora2VideoAgent`
14. `MotionEnhancer`
15. `ShotQaAgent`
16. `BridgeShotPlanner`
17. `BridgeShotRouter`
18. `BridgeClipGenerator`
19. `BridgeQaAgent`
20. `ActionSequencePlanner`
21. `ActionSequenceRouter`
22. `SequenceClipGenerator`
23. `SequenceQaAgent`
24. `DialogueNormalizer`
25. `TtsAgent`
26. `TtsQaAgent`
27. `LipsyncAgent`
28. `VideoComposer`

## 通用落盘目录

每个运行会创建统一审计目录：

```text
temp/projects/<projectDir>/scripts/<scriptDir>/episodes/<episodeDir>/runs/<runDir>/
```

每个 agent 子目录统一为：

```text
<agent-dir>/
├── manifest.json
├── 0-inputs/
├── 1-outputs/
├── 2-metrics/
└── 3-errors/
```

常见通用文件说明：

| 字段/文件 | 类型 | 中文注释 |
| --- | --- | --- |
| `manifest.json` | object | 当前 agent 的执行摘要，通常包含状态、核心计数和产物文件列表 |
| `0-inputs/*` | file | 进入该 agent 前保存的输入快照，便于审计和复现 |
| `1-outputs/*` | file | 该 agent 的主要输出结果 |
| `2-metrics/*` | file | 统计指标、QA 汇总、计数器等 |
| `3-errors/*` | file | 失败样本、provider 错误、重试日志等 |

## 计费与外部调用矩阵

说明：

- `可能计费` 表示该 agent 在默认真实运行时，通常会触发外部模型或第三方服务
- `外部调用` 表示是否会走网络请求或第三方 provider
- 即使某 agent `可能计费 = 是`，也不代表每次都一定付费，仍取决于配置、缓存、mock、provider 和运行路径
- 当前用户要求是：**不要在未确认前私自跑真实生视频**

| Agent | 可能计费 | 外部调用 | 中文说明 |
| --- | --- | --- | --- |
| `Director` | 否 | 否 | 本地编排器，只调度其他 agent，不直接调用外部模型 |
| `ScriptParser` | 是 | 是 | 依赖 `chatJSON` 解析剧本，通常会调用外部 LLM |
| `CharacterRegistry` | 是 | 是 | 若走 LLM 生成角色档案，会调用外部模型；若用结构化角色数据则不一定 |
| `PromptEngineer` | 是 | 是 | 默认通过 LLM 为镜头生成 Prompt |
| `ImageGenerator` | 是 | 是 | 调用图像生成 provider 产出关键帧 |
| `SceneGrammarAgent` | 否 | 否 | 规则化整理镜头为 scene pack，本地执行 |
| `DirectorPackAgent` | 否 | 否 | 基于 scene pack 构建导演包，本地执行 |
| `MotionPlanner` | 否 | 否 | 规则化动态规划，本地执行 |
| `PerformancePlanner` | 否 | 否 | 规则化表演规划，本地执行 |
| `VideoRouter` | 否 | 否 | 本地路由镜头到不同 provider 方案 |
| `SeedancePromptAgent` | 否 | 否 | 本地把导演信息和镜头信息整理成 Seedance Prompt 包 |
| `PreflightQaAgent` | 否 | 否 | 本地做生成前 QA 和重写 |
| `SeedanceVideoAgent` | 是 | 是 | 调用 Seedance 或统一 provider client 生成单镜头视频 |
| `Sora2VideoAgent` | 是 | 是 | 调用 fallback video provider 生成单镜头视频 |
| `MotionEnhancer` | 否 | 否 | 当前主要是本地结果整形与增强标记，不直接调外部模型 |
| `ShotQaAgent` | 否 | 否 | 本地通过 ffprobe 等规则做视频验收 |
| `BridgeShotPlanner` | 否 | 否 | 本地规划桥接镜头 |
| `BridgeShotRouter` | 否 | 否 | 本地路由桥接镜头包 |
| `BridgeClipGenerator` | 是 | 是 | 调用视频 provider 生成 bridge clip |
| `BridgeQaAgent` | 否 | 否 | 本地做桥接片段 QA |
| `ActionSequencePlanner` | 否 | 否 | 本地规划 sequence |
| `ActionSequenceRouter` | 否 | 否 | 本地为 sequence 选择参考与 provider 策略 |
| `SequenceClipGenerator` | 是 | 是 | 调用视频 provider 生成 sequence clip |
| `SequenceQaAgent` | 否 | 否 | 本地做 sequence QA |
| `DialogueNormalizer` | 否 | 否 | 本地标准化对白和发音 |
| `TtsAgent` | 是 | 是 | 调用 TTS provider 合成语音 |
| `TtsQaAgent` | 视配置而定 | 视配置而定 | 若启用 ASR 回听会触发外部调用，否则可主要本地验收 |
| `LipsyncAgent` | 是 | 是 | 调用 lipsync provider 生成口型同步视频 |
| `VideoComposer` | 否 | 否 | 本地用 FFmpeg 合成时间线和字幕，不直接调用外部模型 |

## 顶层 Orchestrator

### Director

来源：

- `src/agents/director.js`

主要入口：

- `runEpisodePipeline({ projectId, scriptId, episodeId, options })`
- `runPipeline(scriptFilePath, options)`

### Director 输入 Schema

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `projectId` | string | 项目 ID，指定要执行的项目 |
| `scriptId` | string | 剧本 ID，指定要执行的剧本 |
| `episodeId` | string | 分集 ID，指定要执行的分集 |
| `options.style` | string | 图像或视频整体风格，如 `realistic` |
| `options.jobId` | string | 逻辑任务 ID，用于日志和目录命名 |
| `options.runAttemptId` | string | 本次执行尝试 ID，用于 run-jobs 与 runs 目录 |
| `options.startedAt` | string | 本次运行开始时间 |
| `options.artifactContext` | object | 运行产物上下文，定义各 agent 的落盘目录 |
| `options.storeOptions` | object | store 层读写选项，例如自定义 `baseTempDir` |
| `options.voiceProjectId` | string \| null | 声音资产所属项目 ID，允许跨项目复用 voice cast |

### Director 输出 Schema

`runEpisodePipeline(...)`：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | string | 最终导出视频路径，即 `final-video.mp4` 的路径 |

`runPipeline(...)`：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | string | 兼容旧脚本入口时的最终导出视频路径 |

### Director 落盘

| 文件 | 中文注释 |
| --- | --- |
| `state.json` | 任务运行状态缓存，便于断点续跑 |
| `state.snapshot.json` | 当前 run 目录下的状态快照 |
| `manifest.json` | 整个 run 的总清单 |
| `timeline.json` | 整个 run 的时间线 |
| `qa-overview.json` | 跨 agent 汇总 QA 总览 |
| `qa-overview.md` | 面向阅读的 QA 汇总 |
| `delivery-summary.md` | 最终交付摘要 |

## 基础类型总表

下面这些结构是多个 agent 之间反复传递的核心协议。

### Shot

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `id` | string | 镜头唯一 ID |
| `scene` | string \| null | 镜头所属场景描述 |
| `characters` | string[] \| null | 镜头中的角色名列表 |
| `dialogue` | string \| null | 镜头对白 |
| `speaker` | string \| null | 指定说话者 |
| `action` | string \| null | 镜头动作描述 |
| `emotion` | string \| null | 镜头情绪描述 |
| `cameraType` | string \| null | 镜头类型 |
| `cameraMovement` | string \| null | 运镜方式 |
| `duration` | number \| null | 镜头时长 |
| `durationSec` | number \| null | 镜头时长秒数版 |

### CharacterRegistryCard

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `id` | string | 角色卡主键 |
| `episodeCharacterId` | string \| null | 分集角色实例 ID |
| `name` | string | 角色名 |
| `gender` | string \| null | 性别信息 |
| `age` | string \| number \| null | 年龄描述 |
| `visualDescription` | string \| null | 角色视觉描述，供 Prompt 使用 |
| `basePromptTokens` | string \| null | 角色稳定提示词锚点 |
| `personality` | string \| null | 性格描述 |
| `defaultVoiceProfile` | object \| null | 默认声音配置 |
| `negativeDriftTokens` | string \| null | 反漂移提示词 |
| `lightingAnchor` | object | 角色灯光锚点 |
| `wardrobeAnchor` | object | 角色服装锚点 |
| `referenceImages` | string[] | 角色参考图路径列表 |
| `coreTraits` | object | 角色核心视觉特征 |
| `characterBibleId` | string \| null | 引用的角色 bible ID |
| `mainCharacterTemplateId` | string \| null | 引用的主角色模板 ID |

### PromptEntry

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 对应镜头 ID |
| `image_prompt` | string | 最终图像生成主提示词 |
| `negative_prompt` | string | 负向提示词 |
| `style_notes` | string | 风格补充说明 |

### ImageResult

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 对应镜头 ID |
| `keyframeAssetId` | string \| null | 对应关键帧资产 ID |
| `prompt` | string | 实际提交的图像生成提示词 |
| `negativePrompt` | string \| null | 图像生成负向提示词 |
| `imagePath` | string \| null | 生成出的关键帧图片路径 |
| `style` | string | 风格标签 |
| `success` | boolean | 图像是否生成成功 |
| `error` | string \| null | 失败错误信息 |
| `request` | object | 请求上下文快照 |

### ScenePack

来源：

- `src/domain/seedanceSceneProtocol.js`

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `scene_id` | string | 场景唯一 ID |
| `scene_title` | string | 场景标题 |
| `scene_goal` | string | 场景戏剧目标 |
| `dramatic_question` | string | 场景核心戏剧问题 |
| `start_state` | string | 场景起始状态 |
| `end_state` | string | 场景结束状态 |
| `location_anchor` | string | 空间地点锚点 |
| `time_anchor` | string | 时间锚点 |
| `cast` | string[] | 场景角色列表 |
| `power_shift` | string | 角色权力关系变化 |
| `emotional_curve` | string | 场景情绪曲线 |
| `action_beats` | object[] | 场景动作节拍列表 |
| `visual_motif` | string | 视觉母题 |
| `space_layout` | object | 空间布局说明 |
| `camera_grammar` | object | 场景镜头语法 |
| `hard_locks` | string[] | 必须锁定的连续性约束 |
| `forbidden_choices` | string[] | 明确禁止的镜头选择 |
| `delivery_priority` | string | 交付优先级，如叙事清晰度优先 |
| `validation_status` | string | 协议校验状态 |
| `validation_issues` | string[] | 协议校验问题列表 |

### DirectorPack

来源：

- `src/domain/seedanceDirectorProtocol.js`

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `scene_id` | string | 对应场景 ID |
| `cinematic_intent` | string | 导演意图总结 |
| `coverage_strategy` | string | coverage 策略 |
| `shot_order_plan` | object[] | 每个 beat 应采用的 coverage 顺序 |
| `entry_master_state` | string | 场景入口主状态 |
| `exit_master_state` | string | 场景出口主状态 |
| `axis_map` | object | 轴线规则 |
| `blocking_map` | object[] | 调度与站位规划 |
| `screen_direction_rules` | string[] | 屏幕方向规则 |
| `pace_design` | object | 节奏设计 |
| `performance_rules` | string[] | 表演规则 |
| `camera_rules` | string[] | 镜头规则 |
| `reference_strategy` | object | 参考图和参考视频策略 |
| `continuity_locks` | string[] | 连续性锁定条件 |
| `candidate_strategy` | object | 候选生成策略 |
| `failure_rewrite_policy` | object | 失败时的 Prompt 重写策略 |
| `validation_status` | string | 协议校验状态 |
| `validation_issues` | string[] | 协议校验问题 |

### MotionPlanEntry

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 对应镜头 ID |
| `order` | number | 镜头顺序号 |
| `shotType` | string | 镜头类型分类 |
| `durationTargetSec` | number | 目标时长 |
| `cameraIntent` | string | 运镜意图摘要 |
| `cameraSpec` | object | 结构化镜头规格 |
| `videoGenerationMode` | string | 视频生成模式 |
| `visualGoal` | string | 视觉目标 |
| `storyBeat` | string | 故事节拍 |
| `screenDirection` | string | 屏幕方向 |
| `spaceAnchor` | string | 空间锚点 |
| `continuityContext` | object | 上下镜连续性上下文 |

### PerformancePlanEntry

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 对应镜头 ID |
| `order` | number \| null | 镜头顺序 |
| `performanceTemplate` | string | 表演模板分类 |
| `storyBeat` | string \| null | 故事节拍 |
| `screenDirection` | string | 屏幕方向 |
| `spaceAnchor` | string \| null | 空间锚点 |
| `continuityContext` | object \| null | 连续性上下文 |
| `subjectBlocking` | string[] | 主体调度信息 |
| `actionBeatList` | string[] | 动作节拍列表 |
| `cameraMovePlan` | object | 镜头运动方案 |
| `motionIntensity` | string | 动作强度 |
| `tempoCurve` | string | 节奏曲线 |
| `expressionCue` | string \| null | 表情提示 |
| `providerPromptDirectives` | string[] | provider 级提示词指令 |
| `enhancementHints` | string[] | 后续增强提示 |
| `generationTier` | string | 生成层级 |
| `variantCount` | number | 变体数 |

### ShotPackage

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 镜头 ID |
| `shotType` | string | 镜头类型 |
| `durationTargetSec` | number | 目标时长 |
| `visualGoal` | string | 视觉目标或图生视频主目标 |
| `cameraSpec` | object | 镜头规格 |
| `referenceImages` | object[] | 参考图列表 |
| `preferredProvider` | string | 首选视频 provider |
| `fallbackProviders` | string[] | 回退 provider 列表 |
| `providerRequestHints` | object | 给 provider 的结构化提示信息 |
| `audioRef` | object \| null | 可选音频参考 |
| `continuityContext` | object \| null | 连续性上下文 |
| `performanceTemplate` | string \| null | 表演模板 |
| `actionBeatList` | string[] | 动作节拍 |
| `cameraMovePlan` | object \| null | 镜头运动方案 |
| `generationTier` | string | 生成层级 |
| `variantCount` | number | 生成变体数量 |
| `candidateSelectionRule` | string | 候选选择规则 |
| `regenPolicy` | string | 重生成策略 |
| `firstLastFramePolicy` | string | 首尾帧策略 |
| `enhancementHints` | string[] | 增强建议 |
| `qaRules` | object | 生成后 QA 规则 |

### SeedancePromptPackage

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 镜头 ID |
| `generationPack` | object | Seedance 结构化镜头生成包 |
| `seedancePromptBlocks` | object[] | 按段拆分的 Prompt block 列表 |
| `providerRequestHints` | object | provider 真实请求提示，已结合导演层信息 |
| `directorInferenceAudit` | object | 导演信息推断审计结果 |
| `qualityIssues` | string[] | Prompt 质量问题列表 |
| `qualityStatus` | string | Prompt 质量状态 |

### ShotGenerationPack

来源：

- `src/domain/seedanceGenerationProtocol.js`

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `task_type` | string | 任务类型，固定为 `shot` |
| `scene_id` | string | 所属场景 ID |
| `shot_id` | string | 镜头 ID |
| `shot_goal` | string | 镜头目标 |
| `entry_state` | string | 入画状态 |
| `exit_state` | string | 出画状态 |
| `timecoded_beats` | object[] | 时间编码节拍 |
| `camera_plan` | object | 镜头方案 |
| `actor_blocking` | string[] | 角色调度信息 |
| `space_anchor` | string | 空间锚点 |
| `character_locks` | string[] | 角色锁定约束 |
| `environment_locks` | string[] | 环境锁定约束 |
| `reference_stack` | object[] | 参考素材栈 |
| `negative_rules` | string[] | 负向规则 |
| `quality_target` | string | 质量目标 |
| `validation_status` | string | 协议校验状态 |
| `validation_issues` | string[] | 协议校验问题 |

### PreflightReviewedPackage

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `...ShotPackage` | object | 原始 `ShotPackage` 全量字段 |
| `preflightDecision` | string | 生成前决策，如 `pass / warn / block` |
| `preflightReasons` | string[] | 触发该决策的原因标签 |
| `preflightReasonDetails` | object[] | 原因的结构化解释 |
| `preflightScores` | object | 各类质量分数 |

### VideoGenerationResult

适用于 `SeedanceVideoAgent` 单镜头输出。

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 镜头 ID |
| `preferredProvider` | string | 路由阶段指定的首选 provider |
| `provider` | string | 实际使用的 provider |
| `status` | string | 生成状态，如 `completed / failed / skipped` |
| `videoPath` | string \| null | 生成后的视频路径 |
| `targetDurationSec` | number \| null | 目标时长 |
| `actualDurationSec` | number \| null | 实际时长 |
| `failureCategory` | string \| null | 失败分类 |
| `error` | string \| null | 错误信息 |
| `errorCode` | string \| null | provider 错误码 |
| `errorStatus` | string \| number \| null | provider 状态码或任务状态 |
| `errorDetails` | object \| null | provider 返回的详细错误 |

### ShotQaEntry

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 镜头 ID |
| `qaStatus` | string | QA 状态 |
| `engineeringStatus` | string | 工程可用性状态 |
| `motionStatus` | string | 动态质量状态 |
| `canUseVideo` | boolean | 是否允许进入最终时间线 |
| `fallbackToImage` | boolean | 是否回退到静图 |
| `freezeDurationSec` | number \| null | 静止帧持续时长 |
| `nearDuplicateRatio` | number \| null | 近重复帧比例 |
| `motionScore` | number \| null | 动态评分 |
| `enhancementApplied` | boolean | 是否应用增强 |
| `enhancementProfile` | string | 增强策略名称 |
| `finalDecision` | string | 最终决策 |
| `decisionReason` | string \| null | 决策原因 |
| `reason` | string \| null | 决策原因简写 |
| `durationSec` | number \| null | 实测时长 |
| `targetDurationSec` | number \| null | 目标时长 |
| `error` | string \| null | 运行或探测错误 |

### ShotQaReport

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `status` | string | 总体状态 |
| `entries` | ShotQaEntry[] | 所有镜头的 QA 结果 |
| `plannedShotCount` | number | 计划验收镜头数 |
| `engineeringPassedCount` | number | 工程层通过数 |
| `motionPassedCount` | number | 动态层通过数 |
| `passedCount` | number | 最终通过镜头数 |
| `fallbackCount` | number | 回退静图镜头数 |
| `fallbackShots` | string[] | 回退镜头 ID 列表 |
| `warnings` | string[] | 风险提醒列表 |

### BridgeShotPlanEntry

来源：

- `src/utils/bridgeShotProtocol.js`

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `bridgeId` | string | 桥接片段 ID |
| `fromShotId` | string | 起始镜头 ID |
| `toShotId` | string | 目标镜头 ID |
| `bridgeType` | string | 桥接类型 |
| `bridgeGoal` | string | 桥接目标 |
| `durationTargetSec` | number | 目标时长 |
| `continuityRisk` | string | 连续性风险等级 |
| `cameraTransitionIntent` | string | 镜头转场意图 |
| `subjectContinuityTargets` | string[] | 主体连续性目标 |
| `environmentContinuityTargets` | string[] | 环境连续性目标 |
| `mustPreserveElements` | string[] | 必须保留的元素 |
| `bridgeGenerationMode` | string | 桥接生成模式 |
| `preferredProvider` | string | 首选 provider |
| `fallbackStrategy` | string | 回退策略 |

### BridgeShotPackage

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `bridgeId` | string | 桥接片段 ID |
| `fromShotRef` | object | 起始镜头引用，可带 `videoPath` |
| `toShotRef` | object | 目标镜头引用，可带 `videoPath` |
| `fromReferenceImage` | string \| null | 起始关键帧路径 |
| `toReferenceImage` | string \| null | 结束关键帧路径 |
| `promptDirectives` | string[] | 给桥接生成器的正向指令 |
| `negativePromptDirectives` | string[] | 桥接生成负向限制 |
| `durationTargetSec` | number | 目标时长 |
| `providerCapabilityRequirement` | string | provider 能力要求 |
| `firstLastFrameMode` | string | 首尾帧模式 |
| `preferredProvider` | string | 首选 provider |
| `fallbackProviders` | string[] | 回退 provider 列表 |
| `qaRules` | object | 桥接 QA 规则 |

### BridgeClipResult

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `bridgeId` | string \| null | 桥接片段 ID |
| `status` | string | 生成状态 |
| `provider` | string \| null | 实际使用 provider |
| `model` | string \| null | 实际模型名 |
| `videoPath` | string \| null | 桥接视频路径 |
| `targetDurationSec` | number \| null | 目标时长 |
| `actualDurationSec` | number \| null | 实际时长 |
| `failureCategory` | string \| null | 失败分类 |
| `error` | string \| null | 错误信息 |
| `taskId` | string \| null | provider 任务 ID |
| `outputUrl` | string \| null | provider 返回的产物 URL |

### BridgeQaEntry

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `bridgeId` | string | 桥接片段 ID |
| `engineeringStatus` | string | 工程可用性检查状态 |
| `continuityStatus` | string | 连续性检查状态 |
| `transitionSmoothness` | string | 转场平滑程度 |
| `identityDriftRisk` | string | 角色漂移风险 |
| `cameraAxisStatus` | string | 轴线状态 |
| `finalDecision` | string | 最终决策 |
| `decisionReason` | string | 决策原因 |
| `durationSec` | number \| null | 实测时长 |
| `targetDurationSec` | number \| null | 目标时长 |
| `error` | string \| null | 检查错误信息 |

### BridgeQaReport

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `status` | string | 总体状态 |
| `entries` | BridgeQaEntry[] | 每个桥接片段的 QA 结果 |
| `passedCount` | number | 通过数 |
| `fallbackCount` | number | 回退数 |
| `manualReviewCount` | number | 人工复核数 |
| `warnings` | string[] | 风险列表 |

### ActionSequencePlanEntry

来源：

- `src/utils/actionSequenceProtocol.js`

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `sequenceId` | string | 连续动作段 ID |
| `shotIds` | string[] | 被该 sequence 覆盖的镜头 ID 列表 |
| `sequenceType` | string | 连续动作段类型 |
| `sequenceGoal` | string | 连续动作段目标 |
| `durationTargetSec` | number \| null | 目标时长 |
| `cameraFlowIntent` | string \| null | 镜头流动意图 |
| `motionContinuityTargets` | string[] | 动作连续性目标 |
| `subjectContinuityTargets` | string[] | 主体连续性目标 |
| `environmentContinuityTargets` | string[] | 环境连续性目标 |
| `mustPreserveElements` | string[] | 必保元素 |
| `entryConstraint` | string \| null | 入段约束 |
| `exitConstraint` | string \| null | 出段约束 |
| `generationMode` | string \| null | 生成模式 |
| `preferredProvider` | string \| null | 首选 provider |
| `fallbackStrategy` | string \| null | 回退策略 |

### ActionSequencePackage

来源：

- `src/utils/actionSequenceProtocol.js`

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `sequenceId` | string | 连续动作段 ID |
| `shotIds` | string[] | 覆盖镜头 ID 列表 |
| `durationTargetSec` | number \| null | 目标时长 |
| `referenceImages` | object[] | 参考图片列表 |
| `referenceVideos` | object[] | 参考视频列表 |
| `bridgeReferences` | object[] | 来自 bridge 的辅助参考 |
| `referenceStrategy` | string \| null | 参考策略 |
| `skipReason` | string \| null | 跳过生成原因 |
| `visualGoal` | string \| null | 视觉目标 |
| `cameraSpec` | string \| null | 文本化镜头规格 |
| `continuitySpec` | string \| null | 连续性说明 |
| `sequenceContextSummary` | string \| null | 上下文摘要 |
| `entryFrameHint` | string \| null | 入帧提示 |
| `exitFrameHint` | string \| null | 出帧提示 |
| `audioBeatHints` | object[] | 音频节拍提示 |
| `preferredProvider` | string \| null | 首选 provider |
| `fallbackProviders` | string[] | 回退 provider 列表 |
| `providerRequestHints` | object \| null | provider 请求提示 |
| `qaRules` | string[] | QA 规则列表 |

### SequenceClipResult

来源：

- `src/utils/actionSequenceProtocol.js`

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `sequenceId` | string \| null | 连续动作段 ID |
| `status` | string \| null | 生成状态 |
| `provider` | string \| null | 实际 provider |
| `model` | string \| null | 实际模型名 |
| `videoPath` | string \| null | 视频路径 |
| `coveredShotIds` | string[] | 覆盖的镜头 ID 列表 |
| `targetDurationSec` | number \| null | 目标时长 |
| `actualDurationSec` | number \| null | 实际时长 |
| `failureCategory` | string \| null | 失败分类 |
| `error` | string \| null | 错误信息 |

### SequenceQaEntry

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `sequenceId` | string \| null | 连续动作段 ID |
| `coveredShotIds` | string[] | 覆盖镜头 ID |
| `engineCheck` | string \| null | 工程有效性检查结果 |
| `continuityCheck` | string \| null | 连续性检查结果 |
| `durationCheck` | string \| null | 时长检查结果 |
| `entryExitCheck` | string \| null | 首尾衔接检查结果 |
| `finalDecision` | string \| null | 最终决策 |
| `fallbackAction` | string \| null | 回退动作 |
| `notes` | string \| null | 备注 |
| `decisionReason` | string \| null | 决策原因 |
| `qaFailureCategory` | string \| null | QA 失败类别 |
| `recommendedAction` | string \| null | 推荐处理动作 |

### SequenceQaReport

来源：

- `src/utils/actionSequenceProtocol.js`

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `status` | string | 总体状态 |
| `entries` | SequenceQaEntry[] | 各 sequence QA 条目 |
| `passedCount` | number | 通过数量 |
| `fallbackCount` | number | 回退数量 |
| `manualReviewCount` | number | 人工复核数量 |
| `warnings` | string[] | 风险提醒 |
| `blockers` | string[] | 阻断项 |
| `topFailureCategory` | string \| null | 主要失败类别 |
| `topRecommendedAction` | string \| null | 首选处理动作 |
| `actionBreakdown` | object | 动作分类统计 |
| `failureCategoryBreakdown` | object | 失败类别统计 |
| `fallbackSequenceIds` | string[] | 回退的 sequence ID 列表 |
| `manualReviewSequenceIds` | string[] | 待人工复核的 sequence ID 列表 |

### NormalizedShot

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `...Shot` | object | 原始镜头字段 |
| `dialogueOriginal` | string | 原始对白文本 |
| `dialogue` | string | 归一化后的对白文本 |
| `dialogueSegments` | string[] | 按规则切分后的对白片段 |
| `dialogueDurationMs` | number \| null | 估算对白时长，单位毫秒 |

### AudioResult

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 镜头 ID |
| `audioPath` | string \| null | 生成音频路径 |
| `hasDialogue` | boolean | 当前镜头是否有对白 |
| `error` | string \| null | 失败时的错误信息 |

### VoiceResolutionEntry

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 镜头 ID |
| `hasDialogue` | boolean | 是否存在对白 |
| `dialogue` | string | 实际送入 TTS 的对白 |
| `speakerName` | string | 解析出的说话者名字 |
| `resolvedGender` | string \| null | 解析出的性别 |
| `ttsOptions` | object \| null | 最终下发到 TTS 的参数 |
| `usedDefaultVoiceFallback` | boolean | 是否使用默认兜底音色 |
| `status` | string | 解析状态，如 `skipped / synthesized / failed` |
| `audioPath` | string \| null | 生成音频路径 |
| `voicePresetId` | string \| null | 使用的语音预设 ID |
| `voiceSource` | string | 声音来源，如 `voice_cast / voice_preset / gender_fallback` |
| `error` | string \| null | 失败信息 |

### TtsQaReport

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `status` | string | QA 总状态，如 `pass / warn / block` |
| `entries` | object[] | 每个对白镜头的 TTS QA 条目 |
| `dialogueShotCount` | number | 有对白的镜头数 |
| `fallbackCount` | number | 发生 fallback 的次数 |
| `fallbackRate` | number | fallback 比率 |
| `budgetPassRate` | number | 时长预算通过率 |
| `blockers` | string[] | 阻断项 |
| `warnings` | string[] | 风险提醒 |
| `manualReviewPlan` | object | 建议抽检方案 |
| `asrReport` | object | ASR 回听结果 |

### LipsyncResult

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 镜头 ID |
| `triggered` | boolean | 是否触发口型同步 |
| `status` | string | 执行状态 |
| `reason` | string \| null | 状态原因 |
| `provider` | string \| null | 使用的 lipsync provider |
| `attemptedProviders` | string[] | 尝试过的 provider 列表 |
| `fallbackApplied` | boolean | 是否发生 provider fallback |
| `fallbackFrom` | string \| null | 从哪个 provider 回退而来 |
| `imagePath` | string \| null | 输入图片路径 |
| `audioPath` | string \| null | 输入音频路径 |
| `videoPath` | string \| null | 输出视频路径 |
| `durationSec` | number \| null | 视频时长 |
| `timingOffsetMs` | number \| null | 音画时间偏移 |
| `evaluator` | object \| null | 评估器结果 |
| `downgradeApplied` | boolean | 是否触发降级 |
| `downgradeReason` | string \| null | 降级原因 |
| `qaStatus` | string | QA 状态 |
| `qaWarnings` | string[] | QA 风险项 |
| `qaBlockers` | string[] | QA 阻断项 |
| `manualReviewRequired` | boolean | 是否需要人工复核 |
| `error` | string \| null | 错误信息 |

### LipsyncReport

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `status` | string | 总体状态 |
| `triggeredCount` | number | 触发口型同步的镜头数 |
| `generatedCount` | number | 成功生成数 |
| `failedCount` | number | 失败数 |
| `skippedCount` | number | 跳过数 |
| `downgradedCount` | number | 降级数 |
| `fallbackCount` | number | fallback 数 |
| `fallbackShots` | string[] | fallback 镜头列表 |
| `manualReviewCount` | number | 人工复核数 |
| `manualReviewShots` | string[] | 待人工复核镜头列表 |
| `blockers` | string[] | 阻断项 |
| `warnings` | string[] | 风险提醒 |
| `entries` | LipsyncResult[] | 明细条目 |

### CompositionPlanItem

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotId` | string | 时间线条目 ID，可能是普通 shot、sequence 或 bridge |
| `sequenceId` | string \| null | 若是 sequence，则为 sequence ID |
| `bridgeId` | string \| null | 若是 bridge，则为 bridge ID |
| `coveredShotIds` | string[] \| null | sequence 覆盖的镜头列表 |
| `timelineFromShotId` | string \| null | 时间线起始锚镜头 |
| `timelineToShotId` | string \| null | 时间线结束锚镜头 |
| `fromShotId` | string \| null | bridge 起始镜头 |
| `toShotId` | string \| null | bridge 目标镜头 |
| `visualType` | string | 可视资产类型，如 `static_image / generated_video_clip / sequence_clip / bridge_clip / lipsync_clip` |
| `videoPath` | string \| null | 视频型素材路径 |
| `imagePath` | string \| null | 静图素材路径 |
| `audioPath` | string \| null | 音频路径 |
| `dialogue` | string | 对应对白文本 |
| `duration` | number | 该时间线段时长 |

### ComposeResult

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `jobId` | string \| null | 任务 ID |
| `status` | string | 合成状态，如 `completed / completed_with_warnings / blocked` |
| `outputVideo.type` | string | 输出类型，固定为 `video` |
| `outputVideo.uri` | string | 输出视频路径 |
| `outputVideo.format` | string | 输出格式，如 `mp4` |
| `report` | object | 交付报告 |
| `artifacts` | object | 合成阶段产物索引 |

## Agent 明细

### ScriptParser

函数：

- `parseScript(scriptText, deps = {})`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `scriptText` | string | 原始剧本文本 |
| `deps.artifactContext` | object | ScriptParser 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `title` | string | 剧本标题 |
| `totalDuration` | number | 估算总时长 |
| `characters` | object[] | 角色抽取结果 |
| `shots` | Shot[] | 扁平化镜头列表 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `0-inputs/source-script.txt` | 原始剧本文本 |
| `0-inputs/parser-config.json` | 解析配置 |
| `1-outputs/shots.flat.json` | 扁平镜头结果 |
| `1-outputs/shots.table.md` | 面向阅读的镜头表 |
| `1-outputs/characters.extracted.json` | 抽取出的角色信息 |
| `2-metrics/parser-metrics.json` | 解析统计 |

### CharacterRegistry

函数：

- `buildCharacterRegistry(characters, scriptContext, style, deps)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `characters` | object[] | 剧本抽取出的角色列表 |
| `scriptContext` | string | 剧情上下文 |
| `style` | string | 角色视觉风格 |
| `deps.episodeCharacters` | object[] | 分集角色实例，若提供则优先走结构化合并 |
| `deps.mainCharacterTemplates` | object[] | 主角色模板 |
| `deps.characterBibles` | object[] | 角色 bible 列表 |
| `deps.artifactContext` | object | CharacterRegistry 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | CharacterRegistryCard[] | 角色视觉与声音上下文卡片列表 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `0-inputs/source-characters.json` | 原始角色输入 |
| `0-inputs/character-bibles.json` | 角色 bible 输入 |
| `0-inputs/main-character-templates.json` | 主角色模板输入 |
| `1-outputs/character-registry.json` | 角色注册表 |
| `1-outputs/character-registry.md` | 角色注册表可读版 |
| `2-metrics/character-metrics.json` | 角色统计信息 |

### PromptEngineer

函数：

- `generateAllPrompts(shots, characterRegistry, style, deps)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shots` | Shot[] | 镜头列表 |
| `characterRegistry` | CharacterRegistryCard[] | 角色注册表 |
| `style` | string | 提示词风格 |
| `deps.artifactContext` | object | PromptEngineer 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | PromptEntry[] | 每个镜头的图像提示词条目 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/prompts.json` | Prompt 结果 |
| `1-outputs/prompt-sources.json` | 每个 Prompt 的来源，标记是 LLM 还是 fallback |
| `1-outputs/prompts.table.md` | Prompt 可读表 |
| `2-metrics/prompt-metrics.json` | Prompt 阶段统计 |

### ImageGenerator

函数：

- `generateAllImages(promptList, imagesDir, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `promptList` | PromptEntry[] | 图像 Prompt 列表 |
| `imagesDir` | string | 图片输出目录 |
| `options.style` | string | 风格标签 |
| `options.artifactContext` | object | ImageGenerator 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | ImageResult[] | 分镜图生成结果列表 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `0-inputs/provider-config.json` | 图像 provider 配置快照 |
| `1-outputs/images.index.json` | 图像结果索引 |
| `2-metrics/image-metrics.json` | 图像生成统计 |
| `3-errors/retry-log.json` | 重试日志 |

### SceneGrammarAgent

函数：

- `planSceneGrammar(shots, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shots` | Shot[] | 镜头列表 |
| `options.artifactContext` | object | SceneGrammar 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | ScenePack[] | 场景包列表 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/scene-packs.json` | 场景包结果 |
| `2-metrics/scene-pack-metrics.json` | 场景规划统计 |

### DirectorPackAgent

函数：

- `planDirectorPacks(scenePacks, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `scenePacks` | ScenePack[] | 场景包列表 |
| `options.shots` | Shot[] | 原始镜头列表，用于匹配 blocking 等信息 |
| `options.artifactContext` | object | DirectorPack 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | DirectorPack[] | 导演包列表 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/director-packs.json` | 导演包结果 |
| `2-metrics/director-pack-metrics.json` | 导演包统计 |

### MotionPlanner

函数：

- `planMotion(shots, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shots` | Shot[] | 镜头列表 |
| `options.artifactContext` | object | MotionPlanner 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | MotionPlanEntry[] | 动态规划结果 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/motion-plan.json` | 动态规划结果 |
| `2-metrics/motion-plan-metrics.json` | 动态规划统计 |

### PerformancePlanner

函数：

- `planPerformance(motionPlan, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `motionPlan` | MotionPlanEntry[] | 动态规划结果 |
| `options.artifactContext` | object | PerformancePlanner 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | PerformancePlanEntry[] | 表演规划结果 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/performance-plan.json` | 表演规划结果 |
| `2-metrics/performance-plan-metrics.json` | 表演规划统计 |

### VideoRouter

函数：

- `routeVideoShots(shots, motionPlan, imageResults, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shots` | Shot[] | 镜头列表 |
| `motionPlan` | MotionPlanEntry[] | 动态规划结果 |
| `imageResults` | ImageResult[] | 分镜图结果 |
| `options.promptList` | PromptEntry[] | Prompt 列表 |
| `options.performancePlan` | PerformancePlanEntry[] | 表演规划列表 |
| `options.scenePacks` | ScenePack[] | 场景包列表 |
| `options.directorPacks` | DirectorPack[] | 导演包列表 |
| `options.artifactContext` | object | VideoRouter 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | SeedancePromptPackage[] | 已经过 SeedancePromptAgent 增强的镜头包列表 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/shot-packages.json` | 基础视频路由包 |
| `1-outputs/video-routing-decisions.json` | provider 决策摘要 |
| `2-metrics/video-routing-metrics.json` | 视频路由统计 |

### SeedancePromptAgent

函数：

- `buildSeedancePromptPackages(shotPackages, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotPackages` | ShotPackage[] | 基础镜头路由包 |
| `options.shots` | Shot[] | 原始镜头列表 |
| `options.motionPlan` | MotionPlanEntry[] | 动态规划 |
| `options.scenePacks` | ScenePack[] | 场景包 |
| `options.directorPacks` | DirectorPack[] | 导演包 |
| `options.artifactContext` | object | SeedancePromptAgent 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | SeedancePromptPackage[] | 补充 Seedance Prompt 结构后的镜头包 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/seedance-prompt-packages.json` | 完整 Prompt 包 |
| `1-outputs/seedance-prompt-blocks.json` | Prompt block 摘要 |
| `1-outputs/seedance-director-inference-audit.json` | 导演信息推断审计 |
| `2-metrics/seedance-prompt-metrics.json` | Prompt 质量统计 |

### PreflightQaAgent

函数：

- `runPreflightQa(shotPackages, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotPackages` | SeedancePromptPackage[] | 待生成视频的镜头包 |
| `options.artifactContext` | object | Preflight QA 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `reviewedPackages` | PreflightReviewedPackage[] | 经 QA 重写或拦截后的镜头包 |
| `report.status` | string | 生成前 QA 总状态 |
| `report.passCount` | number | 通过数量 |
| `report.warnCount` | number | 自动收紧数量 |
| `report.blockCount` | number | 阻止生成数量 |
| `report.entries` | object[] | 各镜头 QA 条目 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/preflight-reviewed-packages.json` | QA 后镜头包 |
| `1-outputs/preflight-fix-brief.json` | 结构化修复建议 |
| `1-outputs/preflight-fix-brief.md` | 可读版修复建议 |
| `2-metrics/preflight-report.json` | 生成前 QA 报告 |

### SeedanceVideoAgent

函数：

- `runSeedanceVideo(shotPackages, videoDir, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shotPackages` | PreflightReviewedPackage[] | 待送入 Seedance 的镜头包 |
| `videoDir` | string | 输出视频目录 |
| `options.providerClient` | object | 统一 provider client |
| `options.artifactContext` | object | SeedanceVideoAgent 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `results` | VideoGenerationResult[] | 单镜头生成结果 |
| `report` | object | 视频生成统计报告 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/seedance-video-results.json` | Seedance 视频结果明细 |
| `2-metrics/seedance-video-report.json` | Seedance 视频报告 |
| `1-outputs/seedance-video-report.md` | 可读版视频报告 |
| `3-errors/*-seedance-error.json` | 单镜头错误快照 |

### MotionEnhancer

函数：

- `runMotionEnhancer(rawVideoResults, shotPackages, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `rawVideoResults` | VideoGenerationResult[] | 原始视频结果 |
| `shotPackages` | PreflightReviewedPackage[] | 原始镜头包 |
| `options.artifactContext` | object | MotionEnhancer 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | object[] | 增强后视频结果列表，保留原镜头 ID 并补充增强状态 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/enhanced-video-results.json` | 增强后视频结果 |
| `2-metrics/motion-enhancer-metrics.json` | 增强统计 |

### ShotQaAgent

函数：

- `runShotQa(videoResults, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `videoResults` | object[] | 原始或增强后的视频结果 |
| `options.artifactContext` | object | Shot QA 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | ShotQaReport | 镜头级视频 QA 报告 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/shot-qa-report.json` | Shot QA 明细报告 |
| `1-outputs/manual-review-shots.json` | 人工抽查镜头列表 |
| `1-outputs/shot-qa-report.md` | 可读版 QA 报告 |
| `2-metrics/shot-qa-metrics.json` | Shot QA 统计 |

### BridgeShotPlanner

函数：

- `planBridgeShots(shots, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shots` | Shot[] | 镜头列表 |
| `options.motionPlan` | MotionPlanEntry[] | 动态规划 |
| `options.continuityFlaggedTransitions` | object[] | 被标记为高风险的转场列表 |
| `options.actionSequencePlan` | ActionSequencePlanEntry[] | sequence 规划结果，用于跳过已被覆盖的边界 |
| `options.artifactContext` | object | BridgeShotPlanner 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | BridgeShotPlanEntry[] | 桥接镜头计划列表 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/bridge-shot-plan.json` | 桥接镜头计划 |
| `2-metrics/bridge-shot-plan-metrics.json` | 桥接规划统计 |

### BridgeShotRouter

函数：

- `routeBridgeShots(bridgeShotPlan, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `bridgeShotPlan` | BridgeShotPlanEntry[] | 桥接镜头计划 |
| `options.imageResults` | ImageResult[] | 图像结果 |
| `options.videoResults` | VideoGenerationResult[] | 视频结果 |
| `options.artifactContext` | object | BridgeShotRouter 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | BridgeShotPackage[] | 桥接镜头路由包 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/bridge-shot-packages.json` | 桥接镜头路由包 |
| `2-metrics/bridge-routing-metrics.json` | 桥接路由统计 |

### BridgeClipGenerator

函数：

- `generateBridgeClips(bridgeShotPackages, videoDir, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `bridgeShotPackages` | BridgeShotPackage[] | 待生成桥接片段的包 |
| `videoDir` | string | 桥接视频输出目录 |
| `options.providerClient` | object | 统一视频 provider client |
| `options.artifactContext` | object | BridgeClipGenerator 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `results` | BridgeClipResult[] | 桥接视频生成结果 |
| `report` | object | 桥接生成报告 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/bridge-clip-results.json` | 桥接片段生成结果 |
| `2-metrics/bridge-clip-generation-report.json` | 桥接生成统计 |
| `1-outputs/bridge-clip-report.md` | 可读版桥接报告 |
| `3-errors/*-bridge-error.json` | 单桥接片段错误快照 |

### BridgeQaAgent

函数：

- `runBridgeQa(bridgeClipResults, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `bridgeClipResults` | BridgeClipResult[] | 桥接片段结果 |
| `options.artifactContext` | object | Bridge QA 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | BridgeQaReport | 桥接 QA 报告 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/bridge-qa-report.json` | 桥接 QA 明细 |
| `1-outputs/bridge-qa-report.md` | 可读版桥接 QA 报告 |
| `2-metrics/bridge-qa-metrics.json` | 桥接 QA 统计 |

### ActionSequencePlanner

函数：

- `planActionSequences(shots, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shots` | Shot[] | 镜头列表 |
| `options.motionPlan` | MotionPlanEntry[] | 动态规划 |
| `options.performancePlan` | PerformancePlanEntry[] | 表演规划 |
| `options.artifactContext` | object | ActionSequencePlanner 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | ActionSequencePlanEntry[] | sequence 规划结果 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/action-sequence-plan.json` | sequence 规划结果 |
| `2-metrics/action-sequence-plan-metrics.json` | sequence 规划统计 |

### ActionSequenceRouter

函数：

- `routeActionSequencePackages(actionSequencePlan, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `actionSequencePlan` | ActionSequencePlanEntry[] | sequence 规划结果 |
| `options.imageResults` | ImageResult[] | 图像结果 |
| `options.videoResults` | VideoGenerationResult[] | 视频结果 |
| `options.bridgeClipResults` | BridgeClipResult[] | bridge 片段结果 |
| `options.performancePlan` | PerformancePlanEntry[] | 表演规划 |
| `options.artifactContext` | object | ActionSequenceRouter 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | ActionSequencePackage[] | 可供 sequence 生成器消费的路由包 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/action-sequence-packages.json` | sequence 路由包 |
| `2-metrics/action-sequence-routing-metrics.json` | sequence 路由统计 |

### SequenceClipGenerator

函数：

- `generateSequenceClips(actionSequencePackages, videoDir, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `actionSequencePackages` | ActionSequencePackage[] | sequence 路由包 |
| `videoDir` | string | sequence 输出目录 |
| `options.providerClient` | object | 统一视频 provider client |
| `options.artifactContext` | object | SequenceClipGenerator 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `results` | SequenceClipResult[] | sequence 生成结果 |
| `sequenceClipResults` | SequenceClipResult[] | 与 `results` 等价的兼容字段 |
| `report` | object | sequence 生成报告 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/sequence-clip-results.json` | sequence 结果 |
| `1-outputs/sequence-generation-context.json` | sequence 生成上下文 |
| `2-metrics/sequence-clip-generation-report.json` | sequence 生成统计 |
| `1-outputs/sequence-clip-report.md` | 可读版 sequence 报告 |
| `3-errors/*-sequence-error.json` | 单 sequence 错误快照 |

### SequenceQaAgent

函数：

- `runSequenceQa(sequenceClipResults, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `sequenceClipResults` | SequenceClipResult[] | sequence 生成结果 |
| `options.shots` | Shot[] | 原始镜头列表 |
| `options.videoResults` | VideoGenerationResult[] | shot 级视频结果 |
| `options.bridgeClipResults` | BridgeClipResult[] | bridge 结果 |
| `options.actionSequencePackages` | ActionSequencePackage[] | sequence 路由包 |
| `options.artifactContext` | object | Sequence QA 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | SequenceQaReport | sequence QA 报告 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/sequence-qa-report.json` | sequence QA 主报告 |
| `1-outputs/sequence-qa-context.json` | 带参考策略的上下文摘要 |
| `1-outputs/fallback-sequence-paths.json` | 需要回退到 shot path 的 sequence |
| `1-outputs/manual-review-sequences.json` | 需要人工复核的 sequence |
| `1-outputs/sequence-qa-report.md` | 可读版 sequence QA 报告 |
| `2-metrics/sequence-qa-metrics.json` | sequence QA 统计 |

### DialogueNormalizer

函数：

- `normalizeDialogueShots(shots, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shots` | Shot[] | 原始镜头列表 |
| `options.pronunciationLexicon` | object[] | 发音词典 |
| `options.artifactContext` | object | DialogueNormalizer 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | NormalizedShot[] | 白名单发音、切段和时长估算后的镜头列表 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `0-inputs/dialogue-normalized.json` | 标准化后的对白镜头输入快照 |
| `0-inputs/pronunciation-lexicon.json` | 发音词典快照 |
| `1-outputs/tts-segments.json` | TTS 分段结果 |
| `1-outputs/dialogue-normalized.md` | 可读版对白标准化结果 |

### TtsAgent

函数：

- `generateAllAudio(shots, characterRegistry, audioDir, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shots` | NormalizedShot[] | 已标准化对白的镜头列表 |
| `characterRegistry` | CharacterRegistryCard[] | 角色注册表 |
| `audioDir` | string | 音频输出目录 |
| `options.projectId` | string \| null | 声音配置所属项目 ID |
| `options.voiceCast` | object[] | 项目级 voice cast |
| `options.voicePresetLoader` | function | 语音预设加载器 |
| `options.artifactContext` | object | TTS Agent 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | AudioResult[] | 音频结果列表 |
| `return.voiceResolution` | VoiceResolutionEntry[] | 语音解析与选声结果 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `0-inputs/voice-resolution.json` | 选声解析结果 |
| `1-outputs/audio.index.json` | 音频结果索引 |
| `1-outputs/dialogue-table.md` | 可读版音频与对白对照表 |
| `2-metrics/tts-metrics.json` | TTS 阶段统计 |
| `3-errors/*-error.json` | 单镜头 TTS 错误 |

### TtsQaAgent

函数：

- `runTtsQa(shots, audioResults, voiceResolution, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shots` | NormalizedShot[] | 标准化后的镜头列表 |
| `audioResults` | AudioResult[] | 音频结果 |
| `voiceResolution` | VoiceResolutionEntry[] | 选声解析结果 |
| `options.artifactContext` | object | TTS QA 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | TtsQaReport | TTS QA 报告 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `2-metrics/tts-qa.json` | TTS QA 主报告 |
| `2-metrics/asr-report.json` | 回听 ASR 报告 |
| `1-outputs/voice-cast-report.md` | 选声可读报告 |
| `1-outputs/manual-review-sample.md` | 建议人工抽检样本 |

### LipsyncAgent

函数：

- `runLipsync(shots, imageResults, audioResults, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shots` | NormalizedShot[] | 标准化后的镜头列表 |
| `imageResults` | ImageResult[] | 图像结果 |
| `audioResults` | AudioResult[] | 音频结果 |
| `options.artifactContext` | object | LipsyncAgent 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `clips` | LipsyncResult[] | 成功生成出视频路径的 lipsync 条目 |
| `report` | LipsyncReport | lipsync 报告 |
| `results` | LipsyncResult[] | 全量 lipsync 条目 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/lipsync.index.json` | lipsync 结果索引 |
| `2-metrics/lipsync-report.json` | lipsync 统计报告 |
| `1-outputs/lipsync-report.md` | 可读版 lipsync 报告 |
| `3-errors/*-lipsync-error.json` | 单镜头 lipsync 错误 |

### VideoComposer

函数：

- `composeVideo(shots, imageResults, audioResults, outputPath, options)`

输入：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `shots` | NormalizedShot[] | 标准化后的镜头列表 |
| `imageResults` | ImageResult[] | 图像结果 |
| `audioResults` | AudioResult[] | 音频结果 |
| `outputPath` | string | 最终输出视频路径 |
| `options.sequenceClips` | object[] | 通过 QA 的 sequence 片段 |
| `options.videoClips` | object[] | 通过 QA 的单镜头视频片段 |
| `options.bridgeClips` | object[] | 通过 QA 的桥接片段 |
| `options.animationClips` | object[] | 动画片段 |
| `options.lipsyncClips` | LipsyncResult[] | lipsync 片段 |
| `options.ttsQaReport` | TtsQaReport | TTS QA 报告 |
| `options.lipsyncReport` | LipsyncReport | lipsync QA 报告 |
| `options.artifactContext` | object | VideoComposer 落盘上下文 |

输出：

| 字段 | 类型 | 中文注释 |
| --- | --- | --- |
| `return` | ComposeResult | 最终合成结果 |

落盘：

| 文件 | 中文注释 |
| --- | --- |
| `1-outputs/compose-plan.json` | 最终时间线合成计划 |
| `1-outputs/segment-index.json` | 时间线段索引 |
| `2-metrics/video-metrics.json` | 视频合成指标 |
| `3-errors/ffmpeg-command.txt` | FFmpeg 命令快照 |
| `3-errors/ffmpeg-stderr.txt` | FFmpeg 错误输出 |

## 结论

当前项目的 agent 协议已经具备较强的“准 API 化”特征：

1. `Director` 负责编排和状态持久化
2. 各 agent 多数都有稳定的输入数组、输出数组、report、artifact 四件套
3. `sequence` 与 `bridge` 已经形成独立协议层
4. 这些 schema 已经足够继续向两种方向演进：
   - 对外暴露成 workflow API
   - 内部迁移成数据库表、任务表、审计表

下一步如果继续做，比较自然的是两件事：

1. 再输出一份字段级 JSON Schema / TypeScript type 文档
2. 给每个 agent 增加“是否计费 / 是否会调用外部付费 API”的标注
