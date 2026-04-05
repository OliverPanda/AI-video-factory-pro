# Bridge Shot Router Agent

本文档基于 `src/agents/bridgeShotRouter.js`。

## 负责什么

`Bridge Shot Router` 把 `bridgeShotPlan` 组装成可执行的 `bridgeShotPackages`。

## 入口函数

- `routeBridgeShots(bridgeShotPlan, options)`
- `buildBridgeShotPackages(bridgeShotPlan, options)`

## 输入

- `bridgeShotPlan`
- 可选 `options`：
  - `imageResults`
  - `videoResults`
  - `artifactContext`

## 输出

当前每条 `bridgeShotPackage` 至少包含：

- `bridgeId`
- `fromShotRef`
- `toShotRef`
- `fromReferenceImage`
- `toReferenceImage`
- `promptDirectives`
- `negativePromptDirectives`
- `durationTargetSec`
- `providerCapabilityRequirement`
- `firstLastFrameMode`
- `preferredProvider`
- `fallbackProviders`
- `qaRules`

## 当前路由规则

- 如果前后参考图不齐，会直接保守回退到 `fallback_direct_cut`
- `bridgeGenerationMode === first_last_keyframe` 时：
  - 能力要求为 `first_last_keyframe`
  - `firstLastFrameMode = required`
- 否则走 `image_to_video`

## 当前可审计产物

- `09h-bridge-shot-router/1-outputs/bridge-shot-packages.json`
- `09h-bridge-shot-router/2-metrics/bridge-routing-metrics.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 不负责的内容

- 不生成 bridge clip
- 不做 bridge QA
- 不直接决定最终时间线插入

## 相关文档

- [Bridge Shot Planner Agent](bridge-shot-planner.md)
- [Bridge Clip Generator Agent](bridge-clip-generator.md)
- [Agent 输入输出关系图](agent-io-map.md)
