# 连贯性检查 Agent（Continuity Checker）

本文档基于 [src/agents/continuityChecker.js](/d:/My-Project/AI-video-factory-pro/src/agents/continuityChecker.js)，说明当前项目里 `Continuity Checker v2` 的职责、输入输出和边界。

## 负责什么

当前这层已经不是“只打一个分”的占位检查器，而是一个三段式连贯性系统：

1. 构造镜头承接对
2. 用规则层检查硬性 continuity contract
3. 合并软性视觉审核结果，给出修复动作

它的目标不是替代导演或后期，而是让系统在进入 `tts / compose` 之前，先把“明显不顺的转场”结构化地找出来，并给出可执行的下一步。

## 和 Consistency Checker 的区别

- `Consistency Checker`
  - 看同一角色跨镜头外观是否像同一个人
- `Continuity Checker`
  - 看两个镜头之间的承接是否顺

当前 `Continuity Checker` 关注的是：

- 镜头承接关系是否正确
- 轴线是否翻转
- 光照语义是否突变
- 关键道具状态是否断裂
- 动作、视线、情绪和构图是否存在软性跳变

## 当前架构

`Continuity Checker v2` 采用三层结构：

### 1. Continuity Contract

这是规则层，负责硬约束。

当前内建检查包括：

- `carryOverFromShotId` 承接关系
- `cameraAxis` 轴线方向
- `sceneLighting` 光照语义
- `propStates` 道具状态

这层输出 `hardViolations`。

### 2. Visual Continuity Review

这是软审核层。

如果调用方注入了 `checkTransition(previousShot, currentShot, previousImage, currentImage)`，这一层会消费它的结果，并将其标准化为：

- `continuityScore`
- `softWarnings`
- `llmObservations`
- `repairHints`

如果没有注入视觉审核器，系统会退回保守默认值，不主动拦截流程。

### 3. Repair Planning

规则层和软审核层会合并成一个统一结果，生成：

- `recommendedAction`
- `repairMethod`
- `continuityTargets`
- `postprocessHints`

当前支持的动作只有三种：

- `pass`
- `regenerate_prompt_and_image`
- `manual_review`

## 入口函数

- `checkShotContinuity(previousShot, currentShot, previousImage, currentImage, options)`
- `runContinuityCheck(shots, imageResults, options)`

## 输入

### 主输入

- `shots`
- `imageResults`

### 运行选项

- `options.threshold`
- `options.checkTransition`
- `options.artifactContext`

## 转场对构造规则

优先级：

1. `shot.continuityState.carryOverFromShotId`
2. `shot.continuitySourceShotId`
3. 上一个镜头

只有在这几个条件都满足时才会形成有效转场：

- previous shot 存在
- previous image 存在
- current image 存在

## 输出结构

### `continuity-report.json`

每个转场报告至少包含：

- `previousShotId`
- `shotId`
- `checkedDimensions`
- `hardViolations`
- `softWarnings`
- `continuityScore`
- `llmObservations`
- `repairHints`
- `recommendedAction`
- `repairMethod`
- `continuityTargets`
- `postprocessHints`

为了兼容现有消费方，也保留：

- `violations`

### `flagged-transitions.json`

这里只保留需要关注的转场，常见字段包括：

- `previousShotId`
- `shotId`
- `triggerSource`
- `hardViolationCodes`
- `continuityScore`
- `violations`
- `repairHints`
- `recommendedAction`
- `repairMethod`
- `continuityTargets`

### `repair-plan.json`

这是 continuity repair planning 的主结果，供 `Director` 决定是否自动重生图或进入人工复核。

### `repair-attempts.json`

这是修复尝试记录：

- 是否尝试
- 使用什么方法
- 成功还是失败
- 失败原因是什么

## 当前实现策略

当前实现是“规则优先 + 可注入软审核 + 可审计修复计划”的第一阶段。

这意味着：

- 硬规则已经真正生效
- 视觉 LLM 审核仍然通过 `checkTransition` 注入
- 报告和 repair artifacts 已经稳定落盘
- `Director` 已经能消费 `recommendedAction`

同时，这也意味着：

- 当前不是完整后期平台
- 还没有内建局部重绘、光学流插帧、统一调色
- `postprocessHints` 只是为第二阶段预留接口

## Director 如何消费这一步

当前主链路顺序是：

1. `image generation`
2. `identity consistency`
3. `continuity checking`
4. `continuity repair`
5. `tts`
6. `compose`

其中：

- `pass`
  - 直接进入后续流程
- `regenerate_prompt_and_image`
  - 使用 continuity repair hints 回灌 prompt，再重生图
- `manual_review`
  - 保留原图，继续主链路

如果 continuity repair 失败：

- 会记录错误
- 会保留原图
- 不会直接把整轮流程打断

## 可审计成果物

传入 `artifactContext` 时，会落这些文件：

- `1-outputs/continuity-report.json`
- `1-outputs/flagged-transitions.json`
- `1-outputs/repair-plan.json`
- `1-outputs/repair-attempts.json`
- `1-outputs/continuity-report.md`
- `2-metrics/continuity-metrics.json`
- `manifest.json`

## 当前指标

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

## 当前边界

这层已经比最初的基础 checker 强很多，但仍然是第一阶段能力。

它已经解决了：

- 连贯性规则有独立 agent
- 连贯性报告结构更完整
- continuity repair 有单独计划和尝试记录
- `Director` 能保底继续主链路

它还没有做重型能力：

- 内建真实视觉 LLM 连续性评审器
- 视线方向自动识别
- 道具检测模型
- 局部重绘
- 光学流插帧
- 统一调色

## 适合这个项目的用法

当前最适合的使用方式是：

- 用 `ShotContinuityState` 提供硬约束
- 用 `checkTransition` 注入软审核逻辑
- 用 `repair-plan.json` 驱动重生成或人工复核
- 用 `repair-attempts.json` 看自动修复是否真的有效

也就是说，这一层现在已经适合作为“前中期连贯性控制器”，但还不是完整“后期修复工作台”。

## 相关文档

- [一致性验证 Agent（Consistency Checker）](consistency-checker.md)
- [Agent 间输入输出关系图](agent-io-map.md)
- [运行包目录示例](run-package-example.md)
- [temp/ 目录说明](../runtime/temp-structure.md)
