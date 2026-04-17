# Seedance Web Director Design

## Summary

目标是把当前 `script -> shot prompt -> image -> video -> QA` 的生产线，重构为尽量模拟 Seedance 2.0 官方网页版思路的导演式工作流，让系统从当前约 35 分的可看性提升到稳定 80 分的写实电影感交付。

核心结论：

- 现在喂给 Seedance 的是“整理过的工程输入”，不是“整理过的导演输入”
- 当前主问题不是 QA 不够，而是前置导演层缺失
- 连贯性控制必须前移，从事后拦截改成生成前约束
- 应先沉淀 `skill + agent + code` 的三层结构，再做实现

## Goals

- 把 Seedance 主生产链改造成更接近官方网页版的输入结构
- 优先提升叙事连贯性、空间清晰度、人物稳定性和镜头衔接
- 建立可复用的 schema、skill、agent 和 protocol 层
- 支持单镜头和多镜头连续段的差异化生成策略
- 建立候选筛选、失败归因和改写重跑机制

## Non-Goals

- 第一阶段不追求最大化动态冲击力
- 第一阶段不引入多供应商主线切换
- 第一阶段不把 TTS/口型同步当主矛盾处理
- 第一阶段不构建全自动电影导演大系统

## Quality Target

目标成片标准：

- 观众能看懂每场戏在发生什么
- 人物和空间稳定，不明显漂移
- 镜头之间能自然衔接
- 画面和声音服务同一个导演意图
- 个别镜头即使不出彩，也不会拖垮整片

## Why Current Output Fails

当前约 35 分的原因主要有 8 项：

1. 戏的目标不清，镜头像事件流水账
2. 空间关系不清，观众看不明白人和机位的位置
3. 人物调度不清，没有视觉主次
4. 镜头没有明确 entry / exit / handoff
5. 节奏没有波形，缺乏起势、爆发、停顿和释放
6. 写实动作和反应缺乏重量感
7. 声画不属于同一导演意图
8. 没有显式的候选审美筛选和重写机制

## Architecture

新的主流程：

`script -> scene pack -> director pack -> generation pack -> Seedance -> candidate review -> delivery`

### Layer 1: Scene Pack

职责：先定义“戏”，而不是先定义“镜头”。

必填字段：

- `scene_id`
- `scene_title`
- `scene_goal`
- `dramatic_question`
- `start_state`
- `end_state`
- `location_anchor`
- `time_anchor`
- `cast`
- `power_shift`
- `emotional_curve`
- `action_beats`
- `visual_motif`
- `space_layout`
- `camera_grammar`
- `hard_locks`
- `forbidden_choices`
- `delivery_priority`

要求：

- 一个 scene 是一个叙事单位，不是镜头清单
- 同一场戏内的镜头都必须服务于同一个 `scene_goal`

### Layer 2: Director Pack

职责：把 scene 翻译成导演语言。

必填字段：

- `scene_id`
- `cinematic_intent`
- `coverage_strategy`
- `shot_order_plan`
- `entry_master_state`
- `exit_master_state`
- `axis_map`
- `blocking_map`
- `screen_direction_rules`
- `pace_design`
- `performance_rules`
- `camera_rules`
- `reference_strategy`
- `continuity_locks`
- `candidate_strategy`
- `failure_rewrite_policy`

要求：

- Director Pack 是最接近官方网页版隐式中间层的结构
- 连贯性 agent 的主要产物应落在这一层，而不是仅在 QA 阶段出现

### Layer 3: Generation Pack

职责：生成最终发给 Seedance 的任务包。

分为两类：

- `ShotGenerationPack`
- `SequenceGenerationPack`

#### ShotGenerationPack

适用于：

- 建立威胁
- 关键反应
- 决策瞬间
- 收尾镜头

必填字段：

- `task_type`
- `scene_id`
- `shot_id`
- `shot_goal`
- `entry_state`
- `exit_state`
- `timecoded_beats`
- `camera_plan`
- `actor_blocking`
- `space_anchor`
- `character_locks`
- `environment_locks`
- `reference_stack`
- `negative_rules`
- `quality_target`

#### SequenceGenerationPack

适用于：

- 连续打斗
- 连续追逐
- 对话走位
- 有必要展示动作逻辑连续性的中段

必填字段：

- `task_type`
- `scene_id`
- `sequence_id`
- `sequence_goal`
- `covered_beats`
- `entry_state`
- `mid_state`
- `exit_state`
- `timecoded_multi_beats`
- `axis_rule`
- `blocking_progression`
- `camera_progression`
- `reference_stack`
- `hard_locks`
- `negative_rules`
- `candidate_policy`

## Candidate Review Loop

目标不是简单 `pass/fail`，而是：

1. `rank`
2. `diagnose`
3. `rewrite`
4. `decide`

### Scoring Dimensions

- `narrative_clarity`
- `spatial_readability`
- `character_stability`
- `motion_realism`
- `camera_discipline`
- `handoff_quality`
- `cinematic_tone`
- `artifact_penalty`

其中优先级最高的是：

- `narrative_clarity`
- `spatial_readability`
- `handoff_quality`

### Failure Taxonomy

- `space_confusion`
- `identity_drift`
- `motion_weight_missing`
- `axis_break`
- `entry_state_missing`
- `exit_state_missing`
- `overactive_camera`
- `under_directed_action`
- `tone_not_realistic`
- `artifact_visible`

### Rewrite Mapping

- `space_confusion` -> 加强 `space_anchor + blocking_map + axis_rule`
- `identity_drift` -> 强化 identity references，减少无关参考
- `motion_weight_missing` -> 在 beat 中加入起势、受力、停顿
- `entry_state_missing` -> 重写开头 1 秒
- `exit_state_missing` -> 重写结尾 1 秒
- `overactive_camera` -> 删除漂移、旋转和无意义推进
- `tone_not_realistic` -> 增强写实摄影和表演约束

## Agent Plan

### Keep But Redesign

- `motionPlanner`
  - 改为输出 `shot beat skeleton`
- `performancePlanner`
  - 改为输出 `actor blocking + emotion pacing`
- `continuity agent`
  - 改为前置生成 `entry / exit / handoff / axis rules`

### Rename / Upgrade

- `videoRouter` -> `seedanceGenerationPackBuilder`
- `actionSequenceRouter` -> `seedanceSequencePackBuilder`

### Downgrade To Post-Generation Review

- `shotQaAgent`
- `bridgeQaAgent`
- `sequenceQaAgent`

这些 agent 只负责：

- 产物检查
- 候选排序
- 失败归因
- 是否允许进入 delivery

### New Agents

- `sceneGrammarAgent`
- `directorPackAgent`
- `seedancePromptAgent`
- `seedanceCandidateReviewer`
- `seedanceFailureDiagnoser`
- `seedanceRewritePlanner`
- `deliveryEditorAgent`

## Skill Plan

第一阶段建议沉淀 4 个 skill：

- `seedance-web-director`
- `cinematic-scene-grammar`
- `seedance-candidate-review`
- `seedance-rewrite-playbook`

对应职责：

- `skill` 定标准
- `agent` 做判断
- `code` 保稳定

## Code Plan

第一阶段先补 protocol / domain 层：

- `ScenePack`
- `DirectorPack`
- `ShotGenerationPack`
- `SequenceGenerationPack`
- `CandidateReview`
- `RewritePatch`

建议新增：

- `src/domain/seedanceSceneProtocol.js`
- `src/domain/seedanceDirectorProtocol.js`
- `src/domain/seedanceGenerationProtocol.js`
- `src/domain/seedanceReviewProtocol.js`

## Phasing

### Phase 1

- 写 spec
- 建 scene / director / generation / review schema
- 写第一批 skills
- 实现 4 个核心 agents
- 单场戏达到稳定 80 分可看性

### Phase 2

- 专项优化多镜头 sequence
- 增加更强的候选排序
- 评估更好的 TTS 和音频协同方案

### Phase 3

- 扩展 delivery editor
- 扩展多供应商能力，但不破坏导演层

## Explicit Do-Not-Do List

当前不要做：

- 继续堆 QA agent
- 继续单纯拉长 prompt
- 先上多供应商主线
- 先做全自动电影导演大系统

## Acceptance Criteria

第一阶段只看这 5 条：

- 戏能看懂
- 空间清楚
- 人物稳定
- 镜头能接
- 成片整体不出戏

## Open Questions

- Sequence 与 shot 的切分阈值如何量化
- 候选生成数量如何在成本和质量之间平衡
- Seedance API 是否支持更多接近网页版的隐式参数，需要专项调研
- TTS / lip sync 在写实电影感目标下的最佳介入点是什么
