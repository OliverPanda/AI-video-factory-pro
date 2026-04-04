# 表演规划 Agent（Performance Planner）

本文档基于 `src/agents/performancePlanner.js`，描述 Phase 2 中新增的表演规划层。

## 职责

1. 接收 `motionPlan`，把“镜头怎么拍”升级为“镜头里的人怎么动、镜头节奏怎么走”。
2. 为每个镜头生成 `performancePlan`，补齐表演模板、动作节拍、运镜计划和生成层级。
3. 为下游 `Video Router` 提供更稳定的 `shotPackage v2` 输入，而不是只靠 `shotType` 做粗路由。

## 输入

- `motionPlan`
  - 典型字段：`shotId`、`shotType`、`cameraIntent`、`durationTargetSec`
- 可选上下文：
  - continuity 信息
  - shot 顺序
  - 参与角色信息

## 输出

最小输出为 `performancePlan[]`，每个镜头至少包含：

- `shotId`
- `order`
- `performanceTemplate`
- `subjectBlocking`
- `actionBeatList`
- `cameraMovePlan`
- `motionIntensity`
- `tempoCurve`
- `expressionCue`
- `providerPromptDirectives`
- `enhancementHints`
- `generationTier`
- `variantCount`

## 当前实现规则

当前版本是规则驱动，不依赖复杂导演式 LLM 创作。

模板映射的核心口径：

- `dialogue_closeup` -> `dialogue_closeup_react`
- `dialogue_medium` 且多人 -> `dialogue_two_shot_tension`
- `dialogue_medium` 且单人 -> `emotion_push_in`
- `fight_wide` -> `fight_exchange_medium`
- `insert_impact` -> `fight_impact_insert`
- `ambient_transition` -> `ambient_transition_motion`

生成层级规则：

- `base`
  - 默认普通镜头
- `enhanced`
  - 重点情绪镜头或需要更明显运动的对话镜头
- `hero`
  - 极少数关键冲击镜头，例如 `fight_impact_insert`

候选数规则：

- `base` -> `variantCount = 1`
- `enhanced` -> `variantCount = 2`
- `hero` -> `variantCount = 3`

## Artifact

对应 run package 目录：

- `09b-performance-planner`

当前主要落盘：

- `0-inputs/`
- `1-outputs/performance-plan.json`
- `1-outputs/qa-summary.md`
- `2-metrics/performance-plan-metrics.json`
- `2-metrics/qa-summary.json`
- `manifest.json`

## 与下游的关系

- `Video Router`
  - 消费 `performancePlan`
  - 组装 `shotPackage v2`
- `Director`
  - 缓存 `performancePlan`
  - 续跑 `--step=compose` 时保留该状态
  - 续跑 `--step=video` 时清理该状态

## 不负责的内容

- 不直接调用视频 provider
- 不负责下载或增强视频文件
- 不决定镜头最终是否通过 QA

## 来源文件

- `src/agents/performancePlanner.js`

## 相关文档

- [Agent 文档总览](README.md)
- [Agent 间输入输出关系图](agent-io-map.md)
- [镜头增强 Agent（Motion Enhancer）](motion-enhancer.md)
- [合成 Agent（Video Composer）](video-composer.md)
