# 2026-04-02 Continuity Checker V2 Design

## Goal

为 AI Video Factory Pro 设计一套**可控、渐进式、可审计**的连贯性系统升级方案，使当前项目在多角色、多场景、多分镜流程下，能够更稳定地处理：

1. 镜头承接关系
2. 轴线与站位连续性
3. 光照语义连续性
4. 道具状态连续性
5. 动作、情绪与构图的软连贯性

本设计不是直接把项目扩成完整后期平台，而是基于现有 `continuityChecker`、`promptEngineer`、`director` 和审计运行包能力，做一版真正可落地的 `Continuity Checker v2`。

## Why This Design

结合 [AI漫剧连贯性优化指南.docx](d:/ComfyUI/笔记/AI漫剧连贯性优化指南.docx) 与当前代码现状，连贯性问题可以分成两类：

- **硬性连续约束**
  - 上一镜承接关系是否明确
  - 镜头轴线有没有翻转
  - 关键道具是否断裂
  - 光照标签是否突变
- **软性视觉连贯性**
  - 动作是否自然承接
  - 角色视线是否突兀
  - 情绪推进是否跳变
  - 场景构图与氛围是否突然断裂

当前项目已经有：

- `ShotContinuityState`
- 独立 `Continuity Checker`
- `Prompt Engineer` continuity 注入
- `Director` 编排与 run artifacts

但当前实现仍然偏“框架占位”：

- 默认没有注入 `checkTransition` 时，会返回保守高分
- 规则层不够强
- 没有区分硬错误和软警告
- 缺少 repair planning
- 没有为局部重绘、插帧、统一调色等第二阶段能力留接口

因此最合适的方向不是纯规则，也不是纯视觉 LLM，而是**混合架构**：

1. 规则层先判硬约束
2. 视觉 LLM 再判软连贯性
3. 合并成可执行的修复计划

## Final Decision

最终采用 **3 层 Continuity Checker v2 架构**：

1. `Continuity Contract`
   - 基于 `ShotContinuityState` 的确定性规则层
2. `Visual Continuity Review`
   - 基于视觉 LLM 的软连贯性审核层
3. `Repair Planning`
   - 将规则结果与视觉结果合并为后续动作

### Strategic Choice

整体路线选择“完整升级路线”，但分阶段推进：

- **第一阶段**
  - 做强前中期连贯性能力
  - 规则 + 视觉审核 + 自动/人工修复决策
- **第二阶段**
  - 为局部重绘、光学流插帧、统一调色、声画校准预留接口
  - 但不在本阶段直接实现完整后期工作流

## Scope

### In Scope

- 强化 `ShotContinuityState`
- 增加规则化 continuity contract 检查
- 增加视觉 LLM soft review 接口
- 升级 `continuity-report.json` 数据结构
- 新增 `repair-plan.json` 与 `repair-attempts.json`
- `Director` 接入 continuity repair planning
- 重生成失败后保底继续主链路
- 完整审计产物落盘

### Out of Scope

- 真正的视频级 world model
- 重型姿态网络 / 骨骼同步系统
- 完整局部重绘系统
- 完整光学流插帧系统
- 完整自动调色系统
- 全季级叙事弧自动规划

## Current State

当前 [continuityChecker.js](d:/My-Project/AI-video-factory-pro/src/agents/continuityChecker.js) 已具备：

- 转场对构造
- `threshold` 过滤
- `artifactContext` 落盘
- `continuity-report.json / flagged-transitions.json / continuity-report.md / continuity-metrics.json`

当前 [continuity-checker.md](d:/My-Project/AI-video-factory-pro/docs/agents/continuity-checker.md) 对它的定位也已经明确：

- 它是“跨分镜基础连贯性检查”
- 不是最终重型能力

本设计保留这些边界，但把这层从“框架占位”升级成“真正参与决策的中间系统”。

## Core Architecture

```text
Shots + ImageResults
        |
        v
Continuity Contract
  - carryOver
  - cameraAxis
  - sceneLighting
  - propStates
  - risk tags
        |
        v
Visual Continuity Review
  - staging continuity
  - gaze continuity
  - emotional continuity
  - composition continuity
        |
        v
Repair Planning
  - pass
  - regenerate_prompt_and_image
  - manual_review
        |
        v
Director
```

## Data Model

### 1. `ShotContinuityState`

保留现有字段，但语义从“描述信息”升级为“检查契约”。

建议字段：

```json
{
  "carryOverFromShotId": "shot_007",
  "sceneLighting": "night_candle",
  "cameraAxis": "screen_left_to_right",
  "propStates": [
    {
      "name": "letter",
      "holderEpisodeCharacterId": "ep_shenqing",
      "state": "opened",
      "side": "left-hand"
    }
  ],
  "continuityRiskTags": [
    "axis_risk",
    "prop_continuity",
    "group_staging"
  ]
}
```

#### Field Notes

- `carryOverFromShotId`
  - 明确指定必须承接的上一镜
- `sceneLighting`
  - 收敛成更可比较的标签，而不是完全自由文本
- `cameraAxis`
  - 建议收敛为有限集合：
    - `screen_left_to_right`
    - `screen_right_to_left`
    - `neutral`
- `propStates`
  - 关键道具的状态快照
- `continuityRiskTags`
  - 提醒 checker 额外关注的高风险维度

### 2. `ContinuityReport`

`continuity-report.json` 从单层结果升级为双层结果：

```json
{
  "previousShotId": "shot_001",
  "shotId": "shot_002",
  "hardViolations": [
    {
      "code": "camera_axis_flip",
      "severity": "high",
      "message": "镜头轴线从 left_to_right 变成 right_to_left"
    }
  ],
  "softWarnings": [
    {
      "code": "emotion_jump",
      "severity": "medium",
      "message": "角色情绪衔接略显突兀"
    }
  ],
  "continuityScore": 6,
  "llmObservations": [
    "人物站位承接基本正确，但视线方向略突兀"
  ],
  "repairHints": [
    "保持角色A在画面左侧、角色B在右侧",
    "延续上一镜暖色烛光侧逆光"
  ],
  "recommendedAction": "regenerate_prompt_and_image",
  "repairMethod": "prompt_regen",
  "continuityTargets": [
    "camera_axis",
    "lighting",
    "staging"
  ],
  "postprocessHints": [
    "如仍不顺，可在后期增加短插帧过渡"
  ]
}
```

### 3. `flagged-transitions.json`

建议保留“为什么被标记”的原因，而不只是分数：

```json
{
  "previousShotId": "shot_001",
  "shotId": "shot_002",
  "triggerSource": "combined",
  "hardViolationCodes": ["camera_axis_flip"],
  "continuityScore": 6,
  "recommendedAction": "regenerate_prompt_and_image"
}
```

### 4. `repair-plan.json`

新增 continuity repair planning 结果：

```json
[
  {
    "shotId": "shot_002",
    "recommendedAction": "regenerate_prompt_and_image",
    "repairMethod": "prompt_regen",
    "continuityTargets": ["lighting", "camera_axis"],
    "repairHints": [
      "保持角色站位不翻轴",
      "延续上一镜暖色烛光"
    ]
  }
]
```

### 5. `repair-attempts.json`

新增自动修复尝试记录：

```json
[
  {
    "shotId": "shot_002",
    "attempted": true,
    "repairMethod": "prompt_regen",
    "success": false,
    "error": "socket hang up"
  }
]
```

## Continuity Contract

规则层优先回答“硬约束是否被破坏”。

### First-Phase Checks

第一阶段推荐内建这几类规则：

1. `carry_over_mismatch`
   - 当前镜头承接引用错误
2. `camera_axis_flip`
   - 轴线翻转
3. `lighting_jump`
   - 光照语义突变
4. `prop_state_break`
   - 道具状态断裂
5. `risk_tag_unaddressed`
   - 高风险标签存在，但当前镜头没有体现必要约束

### Output

规则层输出：

- `hardViolations`
- `checkedDimensions`
- `contractSummary`

如果存在高严重度 `hardViolations`，后续视觉 LLM 仍可执行，但最终不能直接 `pass`。

## Visual Continuity Review

视觉层负责“软连贯性”。

### First-Phase Review Dimensions

1. 动作承接
2. 站位与视线
3. 情绪推进
4. 构图连续
5. 同场景氛围与光感延续

### Output

视觉层输出：

- `continuityScore`
- `llmObservations`
- `softWarnings`
- `repairHints`

这层结果不应直接替代规则层；它的职责是补充“人眼会觉得哪里不顺”的部分。

## Repair Planning

Repair Planning 把规则层和视觉层合并成统一决策。

### Recommended Actions

第一阶段只定义三类动作：

- `pass`
- `regenerate_prompt_and_image`
- `manual_review`

### Recommended Action Rules

建议规则如下：

1. 无硬错误，视觉分数正常
   - `pass`
2. 局部、可修复的问题
   - `regenerate_prompt_and_image`
3. 多角色复杂调度、大幅动作断裂、多问题叠加
   - `manual_review`

### Repair Method

第一阶段只启用：

- `prompt_regen`
- `manual_review`

为第二阶段预留但暂不实现：

- `local_inpaint`
- `optical_flow_interpolate`
- `color_match`

## Director Integration

### Pipeline Order

主链路顺序建议为：

1. `image generation`
2. `identity consistency`
3. `continuity checking`
4. `continuity repair planning`
5. `tts`
6. `compose`

原因：

- 角色身份没稳时，连贯性判断价值较低
- 连贯性更适合基于“身份基本通过”的画面来审

### Repair Execution

`Director` 在 continuity 阶段应支持：

- `pass`
  - 直接继续
- `regenerate_prompt_and_image`
  - 用 continuity repair hints 回灌 prompt，再重生图
- `manual_review`
  - 不自动修，保留原图继续跑

### Failure Policy

如果 continuity repair 失败：

- 落盘错误证据
- 保留原图
- 整轮继续主链路

不允许因为单个 continuity repair 失败，让整轮 `tts / compose` 全部中断。

## Prompt Integration

`Prompt Engineer` 继续保留 continuity block，但需要为 repair reuse 做增强。

第一阶段建议：

- 正常 prompt 继续基于 `continuityState`
- 重生成 prompt 在原 continuity block 基础上，再追加 repair hints
- repair hints 来自 `Continuity Checker v2`

这样不需要引入新的 prompt 系统，只需要增强 continuity-aware regeneration。

## Artifacts

### Existing Artifacts To Keep

- `continuity-report.json`
- `flagged-transitions.json`
- `continuity-report.md`
- `continuity-metrics.json`
- `manifest.json`

### New Artifacts

- `repair-plan.json`
- `repair-attempts.json`

### Proposed Layout

```text
06-continuity-checker/
  manifest.json
  0-inputs/
    continuity-contract.json
  1-outputs/
    continuity-report.json
    flagged-transitions.json
    continuity-report.md
    repair-plan.json
    repair-attempts.json
  2-metrics/
    continuity-metrics.json
  3-errors/
    transition-<previous>-<current>-error.json
```

## Metrics

在当前基础上扩充为：

- `checked_transition_count`
- `flagged_transition_count`
- `avg_continuity_score`
- `hard_violation_count`
- `soft_warning_count`
- `hard_rule_fail_count`
- `llm_review_fail_count`
- `action_pass_count`
- `action_regenerate_count`
- `action_manual_review_count`

## Testing Strategy

### 1. Rule-Layer Tests

断言：

- 轴线翻转会命中 `camera_axis_flip`
- 道具断裂会命中 `prop_state_break`
- 承接错误会命中 `carry_over_mismatch`

### 2. Mixed Decision Tests

断言：

- 有硬错误时，即使视觉层高分，也不能直接 `pass`
- 无硬错误但视觉层低分时，会生成 `softWarnings`
- `recommendedAction` 符合预期

### 3. Director Integration Tests

断言：

- `pass` 时不重生成
- `regenerate_prompt_and_image` 时会进入重生成
- `manual_review` 时保留原图继续跑
- continuity repair 失败时整轮仍继续

### 4. Artifact Tests

断言真实落盘：

- `continuity-report.json`
- `flagged-transitions.json`
- `repair-plan.json`
- `repair-attempts.json`
- `continuity-report.md`
- `continuity-metrics.json`

## Phase Plan

### Phase 1

- Continuity Contract 强化
- 视觉 soft review 接口接入
- Repair Planning
- Director repair 编排
- artifacts 与 tests 补齐

### Phase 2

- `local_inpaint`
- `optical_flow_interpolate`
- `color_match`
- `postprocessHints` 消费链路

## Non-Goals

本设计明确不做：

- 直接把项目改造成完整后期视频工作站
- 直接引入世界模型或视频级长时序基础设施
- 直接实现工业级多角色骨骼同步约束

这些方向未来可以做，但不是当前收益最高的第一步。

## Summary

当前最适合本项目的路线是：

- 整体上走“完整升级路线”
- 实现上先做前中期连贯性能力增强
- 架构上采用“规则层 + 视觉层 + repair planning”的混合方案
- 为第二阶段后处理能力预留结构接口

这条路线与当前的 `continuity-checker.md`、`ShotContinuityState`、`Prompt Engineer`、`Director` 和 auditable run package 都能自然衔接，不需要推倒重来。
