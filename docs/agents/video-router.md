# Video Router Agent

本文档基于 `src/agents/videoRouter.js`。

## 负责什么

`Video Router` 把 `shots + motionPlan + imageResults + performancePlan + promptList` 组装成下游可直接消费的 `shotPackages`，并给出 provider 无关的镜头路由决策。

## 入口函数

- `routeVideoShots(shots, motionPlan, imageResults, options)`
- `buildShotPackages(shots, motionPlan, imageResults, options)`

## 输入

- `shots`
- `motionPlan`
- `imageResults`
- 可选 `options`：
  - `performancePlan`
  - `promptList`
  - `audioRef`
  - `artifactContext`

## 输出

当前每条 `shotPackage` 至少包含：

- `shotId`
- `shotType`
- `durationTargetSec`
- `visualGoal`
- `cameraSpec`
- `referenceImages`
- `preferredProvider`
- `fallbackProviders`
- `providerRequestHints`
- `performanceTemplate`
- `actionBeatList`
- `cameraMovePlan`
- `generationTier`
- `variantCount`
- `regenPolicy`
- `enhancementHints`
- `qaRules`

## 当前路由规则

- 有参考图时优先当前 `VIDEO_PROVIDER`，默认 `seedance`
- 没有参考图时直接路由到 `static_image`
- 当前主 provider 用户侧可为 `fallback_video` 或 `seedance`
- `fallback_video` 当前内部仍映射到 `sora2` runtime branch，以保持兼容
- `providerRequestHints` 会把时长、画幅、动势级别、镜头类型等 provider 请求提示一起写入，供下游具体视频 agent 适配各自 API
- `performancePlan` 会补充：
  - `performanceTemplate`
  - `generationTier`
  - `variantCount`
  - `enhancementHints`
- `promptList.image_prompt` 会优先覆盖 `motionPlan.visualGoal`

## 当前可审计产物

- `09c-video-router/1-outputs/shot-packages.json`
- `09c-video-router/1-outputs/video-routing-decisions.json`
- `09c-video-router/2-metrics/video-routing-metrics.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 不负责的内容

- 不直接生成视频
- 不做镜头 QA
- 不决定最终是否回退到静图
- 不关心具体 provider 的鉴权、轮询、下载细节

## 相关文档

- [Motion Planner Agent](motion-planner.md)
- [Fallback Video Adapter](fallback-video-adapter.md)
- [Seedance Video Agent](seedance-video-agent.md)
- [Agent 输入输出关系图](agent-io-map.md)
