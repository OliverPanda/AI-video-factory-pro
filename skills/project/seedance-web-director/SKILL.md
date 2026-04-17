---
name: seedance-web-director
description: 用于把当前仓库的视频生成任务按 Seedance 2.0 官方网页版思路落地为导演式工作流；它是更通用的 `cinematic-web-director` 在本项目中的 Seedance 适配版。
---

# seedance-web-director

## 概述

这个 skill 记录本项目“Seedance 官方网页版导演式工作流”的项目适配方法。

如果你想做跨项目复用，优先使用：

- [cinematic-web-director](d:/My-Project/AI-video-factory-pro/skills/project/cinematic-web-director/SKILL.md)

这个 skill 更适合当前仓库中与 Seedance 相关的落地和评审。它适用于把当前工程输入升级为导演输入，也适用于审查：

- `scene pack`
- `director pack`
- `generation pack`
- candidate review / rewrite 机制
- `shot / sequence / bridge` 的导演一致性

它不直接替代具体 agent 实现，但会规定这些 agent 应该产出什么、先后顺序是什么、哪些质量目标优先。

## 什么时候使用

- 需要按“导演式工作流”设计或重构视频主链
- 需要新增或调整 `sceneGrammarAgent`、`directorPackAgent`、`seedancePromptAgent`
- 需要审查 `motionPlanner`、`performancePlanner`、`continuity` 相关 agent 是否仍停留在工程输入层
- 需要讨论为什么成片“能跑通但不可看”
- 需要规划 `candidate review -> diagnose -> rewrite -> decide` 闭环
- 需要评估某项变更是否真的提升了叙事清晰度、空间可读性和镜头 handoff

## 当前仓库里的额外目标

- 先定义“戏”，再定义“镜头”
- 连贯性前移，避免只在 QA 阶段补救
- 让 `shot / sequence / bridge` 都服务同一导演意图
- 把 QA 从单纯拦截器，降级为候选筛选和失败归因层

## 必须遵守的判断顺序

1. 先问这场戏的 `scene_goal` 是否清楚
2. 再问导演层是否明确了 `coverage / blocking / axis / pace / entry / exit`
3. 再问 generation pack 是否把这些导演约束落成可执行输入
4. 最后才问后置 QA 是否需要拦截、改写或回退

如果前 3 层没有站稳，不要把问题错误归因到“模型不行”或“QA 不够严”。

## 当前仓库里的额外约束

- `shot / sequence / bridge` 三条视频语义都必须服务同一导演意图
- director 层要能落进当前的 `seedanceSceneProtocol / seedanceDirectorProtocol / seedanceGenerationProtocol`
- prompt 结构要兼容当前 Seedance 2.0 prompt architecture

## 核心结构

### Layer 1: Scene Pack

职责：定义这场戏到底要讲什么。

最重要的字段：

- `scene_goal`
- `dramatic_question`
- `start_state`
- `end_state`
- `location_anchor`
- `cast`
- `action_beats`
- `visual_motif`
- `camera_grammar`
- `hard_locks`

规则：

- scene 是叙事单位，不是镜头列表
- 同一场戏内的镜头都必须服务同一个 `scene_goal`

### Layer 2: Director Pack

职责：把 scene 翻译为导演语言。

最重要的字段：

- `cinematic_intent`
- `coverage_strategy`
- `shot_order_plan`
- `axis_map`
- `blocking_map`
- `pace_design`
- `camera_rules`
- `continuity_locks`
- `candidate_strategy`
- `failure_rewrite_policy`

规则：

- 这一层是最接近 Seedance 官方网页版隐式导演层的位置
- 连贯性产物要尽量沉淀在这一层，而不是只在 QA 里报告问题

### Layer 3: Generation Pack

职责：把导演意图翻译成模型可执行输入。

分为：

- `ShotGenerationPack`
- `SequenceGenerationPack`

规则：

- `shot` 负责关键叙事点、关键反应、关键 handoff
- `sequence` 负责连续动作、追逐、对话走位等中段连续性
- `bridge` 负责段间过渡与高风险 cut 修复，不负责替代整段动作表达

## Candidate Review Loop

后置 review 不应只回答 `pass / fail`，而应固定回答四件事：

1. `rank`
2. `diagnose`
3. `rewrite`
4. `decide`

优先评分维度：

- `narrative_clarity`
- `spatial_readability`
- `handoff_quality`

常见失败类型：

- `space_confusion`
- `identity_drift`
- `motion_weight_missing`
- `axis_break`
- `entry_state_missing`
- `exit_state_missing`
- `overactive_camera`
- `tone_not_realistic`

## 对现有 agent 的改造要求

### 应保留但重做

- `motionPlanner`
  输出应更接近 `shot beat skeleton`
- `performancePlanner`
  输出应更接近 `actor blocking + emotion pacing`
- continuity 相关 agent
  产物应前移为 `entry / exit / handoff / axis rules`

### 应升级命名或职责

- `videoRouter`
  应更接近 `seedanceGenerationPackBuilder`
- `actionSequenceRouter`
  应更接近 `seedanceSequencePackBuilder`

### 应降级为后置 reviewer

- `shotQaAgent`
- `bridgeQaAgent`
- `sequenceQaAgent`

它们主要负责：

- 产物检查
- 候选排序
- 失败归因
- 是否允许进入 delivery

## 调整建议

- 如果成片问题是“观众看不懂戏”，优先补 `scene_goal / dramatic_question / blocking / axis`
- 如果问题是“镜头接不上”，优先补 `entry / exit / handoff`
- 如果问题是“人物漂移”，优先补 `character_locks / reference_strategy`
- 如果问题是“镜头太乱”，优先收紧 `camera_rules` 和 `pace_design`
- 如果问题是“整片气质不统一”，优先看 `cinematic_intent` 是否贯穿到 `shot / sequence / bridge`

## 不要做的事

- 不要把所有问题都推给后置 QA
- 不要在没有 director 层约束时就直接堆 prompt 细节
- 不要把 `sequence` 和 `bridge` 当成纯 provider 功能开关
- 不要让 `shot / sequence / bridge` 各自形成互相冲突的导演意图

## 推荐先读

- 设计总纲：
  [2026-04-13-seedance-web-director-design.md](d:/My-Project/AI-video-factory-pro/docs/superpowers/specs/2026-04-13-seedance-web-director-design.md)
- 通用导演 skill：
  [cinematic-web-director](d:/My-Project/AI-video-factory-pro/skills/project/cinematic-web-director/SKILL.md)
- prompt 结构现状：
  [2026-04-15-seedance2-prompt-architecture.md](d:/My-Project/AI-video-factory-pro/docs/superpowers/specs/2026-04-15-seedance2-prompt-architecture.md)
- 当前 schema：
  [seedanceSceneProtocol.js](d:/My-Project/AI-video-factory-pro/src/domain/seedanceSceneProtocol.js)
  [seedanceDirectorProtocol.js](d:/My-Project/AI-video-factory-pro/src/domain/seedanceDirectorProtocol.js)
  [seedanceGenerationProtocol.js](d:/My-Project/AI-video-factory-pro/src/domain/seedanceGenerationProtocol.js)

## 来源文件

- `docs/superpowers/specs/2026-04-13-seedance-web-director-design.md`
- `docs/superpowers/specs/2026-04-15-seedance2-prompt-architecture.md`
- `src/domain/seedanceSceneProtocol.js`
- `src/domain/seedanceDirectorProtocol.js`
- `src/domain/seedanceGenerationProtocol.js`
