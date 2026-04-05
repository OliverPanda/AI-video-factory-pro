# Action Sequence Planner

## 职责

- 识别 `2~5` 个 shot 组成的高价值连续动作段
- 输出 `actionSequencePlan`
- 不直接调用视频 provider

## 典型输入

- `shots`
- `motionPlan`
- `performancePlan`
- `continuityFlaggedTransitions`
- `bridgeShotPlan`
- `videoResults`

## 典型输出

- `sequenceId`
- `shotIds`
- `sequenceType`
- `durationTargetSec`
- `cameraFlowIntent`
- `fallbackStrategy`

## 落盘

- `09k-action-sequence-planner/0-inputs/`
- `09k-action-sequence-planner/1-outputs/action-sequence-plan.json`
- `09k-action-sequence-planner/2-metrics/`
- `09k-action-sequence-planner/3-errors/`

## 当前 MVP 边界

- 只做规则版规划
- 只覆盖连续动作段，不做全片 sequence 化
- 不做多人群战自动编排闭环
- 不做语音联动闭环
