# 连贯性检查 Agent（Continuity Checker）

本文档基于 [src/agents/continuityChecker.js](/d:/My-Project/AI-video-factory-pro/src/agents/continuityChecker.js)，说明当前实现里独立的“跨分镜基础连贯性检查”是如何工作的。

## 负责什么

1. 按分镜承接关系构造 `previous shot -> current shot` 转场对。
2. 检查当前镜头是否延续上一镜的基础连续状态。
3. 输出转场报告、问题转场列表和修复建议。
4. 把连贯性证据单独落盘，不再继续混进 `Consistency Checker`。

## 和 Consistency Checker 的区别

- `Consistency Checker`
  - 看同一角色跨镜头外观是否像同一个人
- `Continuity Checker`
  - 看两个镜头之间的承接是否顺

当前这层关注的是：

- 光照语义是否突变
- 镜头轴线 / 左右关系是否可能漂移
- 道具承接是否断裂
- 高风险转场有没有显式被标出来

## 入口函数

- `checkShotContinuity(previousShot, currentShot, previousImage, currentImage, options)`
- `runContinuityCheck(shots, imageResults, options)`

## 输入

- `shots`
- `imageResults`
- `options.threshold`
- `options.checkTransition`
- `options.artifactContext`

## 当前实现策略

当前先用“可注入检查器 + 完整审计成果物”的最小版本落地。

这意味着：

- 结构和落盘已经稳定
- `Director` 已经会编排这一步
- 测试里可以注入自定义 transition checker
- 后续再接真实视觉 LLM 或更复杂规则，不需要重做目录和编排

默认没有注入 `checkTransition` 时，会返回一个保守的高分报告，不主动拦流程。

## 转场对构造规则

优先级：

1. `shot.continuityState.carryOverFromShotId`
2. `shot.continuitySourceShotId`
3. 上一个镜头

只有在这几个条件都满足时才会形成有效转场：

- previous shot 存在
- previous image 存在
- current image 存在

## 可审计成果物

传入 `artifactContext` 时，会落这些文件：

- `1-outputs/continuity-report.json`
- `1-outputs/flagged-transitions.json`
- `1-outputs/continuity-report.md`
- `2-metrics/continuity-metrics.json`
- `manifest.json`

## 当前指标

- `checked_transition_count`
- `flagged_transition_count`
- `avg_continuity_score`

## 当前边界

这个 Agent 现在是“基础连贯性框架”，不是最终形态。

它已经解决了：

- 连贯性能力有独立 agent
- Director 会真正调它
- run artifacts 有专门目录和报告

它还没做重型能力：

- 真实视觉 LLM 连续性打分
- 视线方向自动识别
- 道具检测
- 骨骼级多人同步约束

## 相关文档

- [一致性验证 Agent（Consistency Checker）](consistency-checker.md)
- [Agent 间输入输出关系图](agent-io-map.md)
- [运行包目录示例](run-package-example.md)
