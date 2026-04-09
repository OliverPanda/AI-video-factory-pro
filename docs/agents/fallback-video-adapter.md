# Fallback Video Adapter

本文档基于 [sora2VideoAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/sora2VideoAgent.js) 和 [fallbackVideoApi.js](/d:/My-Project/AI-video-factory-pro/src/apis/fallbackVideoApi.js)。

## 负责什么

`Fallback Video Adapter` 负责消费 `shotPackages` 中被路由到兼容视频分支的镜头，生成统一协议下的 `rawVideoResults`。

用户侧通过：

- `VIDEO_PROVIDER=fallback_video`

来启用这条链路。

当前内部实现仍映射到 `sora2` runtime branch，以保证：

- 历史 run package 继续可读
- 旧缓存 state 不断链
- QA overview / artifact 聚合不需要一次性迁移

## 入口函数

- `runSora2Video(shotPackages, videoDir, options)`
- `createFallbackVideoClip(shotPackage, outputPath, options)`
- `fallbackImageToVideo(shotPackage, outputPath, options, env)`

## 输入

- `shotPackages`
- `videoDir`
- 可选 `options`：
  - `generateVideoClip`
  - `artifactContext`
  - `httpClient`
  - `pollIntervalMs`
  - `overallTimeoutMs`

## 输出

输出 `{ results, report }`

单条 `result` 当前典型字段有：

- `shotId`
- `preferredProvider`
- `provider`
- `model`
- `status`
- `videoPath`
- `outputUrl`
- `taskId`
- `providerJobId`
- `providerRequest`
- `providerMetadata`
- `targetDurationSec`
- `actualDurationSec`
- `variantIndex`
- `failureCategory`

## 当前生成规则

- `preferredProvider !== 'sora2'` 时直接 `skipped`
- `videoRouter` 会把用户侧 `fallback_video` 解析并路由到这条内部兼容分支
- adapter 层会根据 `VIDEO_FALLBACK_BASE_URL` 自动适配部分供应商差异
  - 例如 `ai.t8star.cn` 会把 `720x1280 / 1280x720` 归一为 `720P`
- 成功时返回统一的 `completed` 结果
- 失败时保留标准化错误字段：
  - `failureCategory`
  - `error`
  - `errorCode`
  - `errorStatus`
  - `errorDetails`

## 当前可审计产物

- `09d-sora2-video-agent/1-outputs/raw-video-results.json`
- `09d-sora2-video-agent/1-outputs/video-report.md`
- `09d-sora2-video-agent/2-metrics/video-generation-report.json`
- `09d-sora2-video-agent/3-errors/<shotId>-video-error.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

说明：

- 当前目录名仍保留 `09d-sora2-video-agent`
- 这是兼容旧 run 的保守做法，不代表用户侧仍应把它理解成 “Sora2 专用链路”

## 不负责的内容

- 不做镜头增强
- 不做镜头 QA
- 不直接桥接最终 `videoResults`
- 不决定 compose 使用顺位
- 不处理 `seedance` 路由镜头

## 相关文档

- [Video Router Agent](video-router.md)
- [Seedance Video Agent](seedance-video-agent.md)
- [Motion Enhancer Agent](motion-enhancer.md)
- [Shot QA Agent](shot-qa-agent.md)
