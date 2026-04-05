# Bridge Shot Planner Agent

本文档基于 `src/agents/bridgeShotPlanner.js`。

## 负责什么

`Bridge Shot Planner` 只做“是否需要桥接、需要什么桥接”的规划，不做生成和 QA。

它当前只会对 `Continuity Checker` 标出来的高风险 cut 点生成规划，不会给所有镜头默认插桥。

## 入口函数

- `planBridgeShots(shots, options)`
- `buildBridgeShotPlan(shots, options)`

## 输入

- `shots`
- `options.continuityFlaggedTransitions`
- `options.motionPlan`
- `options.artifactContext`

## 输出

输出 `bridgeShotPlan[]`，每条至少包含：

- `bridgeId`
- `fromShotId`
- `toShotId`
- `bridgeType`
- `bridgeGoal`
- `durationTargetSec`
- `continuityRisk`
- `cameraTransitionIntent`
- `subjectContinuityTargets`
- `environmentContinuityTargets`
- `mustPreserveElements`
- `bridgeGenerationMode`
- `preferredProvider`
- `fallbackStrategy`

## 当前桥接类型

规则版 MVP 目前覆盖：

- `motion_carry`
- `camera_reframe`
- `spatial_transition`
- `emotional_transition`

## 当前决策规则

Planner 只在下列条件满足时生成 bridge：

- 当前 cut 已被 `Continuity Checker` 标成风险转场
- 可以从前后镜头、动作、景别、情绪、scene 变化中推断出桥接类型

风险等级当前主要受这几类信号影响：

- `continuityScore`
- `hardViolationCodes`
- 转场类型本身是否属于高风险

## 当前可审计产物

- `09g-bridge-shot-planner/1-outputs/bridge-shot-plan.json`
- `09g-bridge-shot-planner/2-metrics/bridge-shot-plan-metrics.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 不负责的内容

- 不负责 provider 路由
- 不负责生成 bridge clip
- 不负责 bridge QA
- 不负责决定最终是否写入 compose timeline

## 相关文档

- [Bridge Shot Router Agent](bridge-shot-router.md)
- [Bridge QA Agent](bridge-qa-agent.md)
- [Agent 输入输出关系图](agent-io-map.md)
