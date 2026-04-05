# Motion Planner Agent

本文档基于 `src/agents/motionPlanner.js`。

## 负责什么

`Motion Planner` 把结构化 `shots` 变成动态镜头规划，是视频主链的第一步。

## 入口函数

- `planMotion(shots, options)`
- `buildMotionPlan(shots)`

## 输入

- `shots`
- `artifactContext`

## 输出

输出 `motionPlan[]`，每条至少包含：

- `shotId`
- `order`
- `shotType`
- `durationTargetSec`
- `cameraIntent`
- `cameraSpec`
- `videoGenerationMode`
- `visualGoal`

## 当前 shotType 规则

当前规则版主要推断：

- `dialogue_closeup`
- `dialogue_medium`
- `fight_wide`
- `insert_impact`
- `ambient_transition`

判断依据来自：

- `camera_type / cameraType / camera`
- `scene`
- `action`
- `dialogue`

## 当前 cameraSpec 规则

Planner 会根据 `shotType` 自动补：

- `template`
- `lensIntent`
- `moveType`
- `framing`
- `speed`
- `ratio`

当前默认比率固定为 `9:16`。

## 当前可审计产物

- `09a-motion-planner/1-outputs/motion-plan.json`
- `09a-motion-planner/2-metrics/motion-plan-metrics.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 不负责的内容

- 不负责 provider 选择
- 不负责表演模板与生成层级
- 不负责真正生成视频

## 相关文档

- [Performance Planner Agent](performance-planner.md)
- [Video Router Agent](video-router.md)
- [Agent 输入输出关系图](agent-io-map.md)
