# Seedance Video Agent

本文档基于 `src/agents/seedanceVideoAgent.js` 与 `src/apis/seedanceVideoApi.js`。

## 负责什么

`Seedance Video Agent` 负责消费 `shotPackages` 中被路由到 `seedance` 的镜头，并调用火山方舟视频生成 API 产出 `rawVideoResults`。

当前接入的是官方文档中的异步任务接口：

- `POST /api/v3/contents/generations/tasks`
- `GET /api/v3/contents/generations/tasks/{id}`

## 入口函数

- `runSeedanceVideo(shotPackages, videoDir, options)`
- `createSeedanceVideoClip(shotPackage, outputPath, options)`
- `seedanceImageToVideo(shotPackage, outputPath, options, env)`

## 当前鉴权与基础配置

默认使用以下环境变量：

- `VIDEO_PROVIDER=seedance`
- `ARK_API_KEY` 或 `SEEDANCE_API_KEY`
- `SEEDANCE_API_BASE_URL`
- `SEEDANCE_MODEL_ID`
- `SEEDANCE_VIDEO_RATIO`
- `SEEDANCE_POLL_INTERVAL_MS`
- `SEEDANCE_TIMEOUT_MS`

当前默认值：

- Base URL: `https://ark.cn-beijing.volces.com/api/v3`
- Model ID: `doubao-seedance-2-0-260128`

## 输入

- `shotPackages`
- `videoDir`
- 可选 `options`：
  - `generateVideoClip`
  - `httpClient`
  - `binaryHttpClient`
  - `pollIntervalMs`
  - `overallTimeoutMs`
  - `artifactContext`

## 请求映射

当前最小映射策略：

- `shotPackage.visualGoal + cameraSpec` -> `content.text`
- `referenceImages[0..n]` -> `content.image_url`
- 第一张参考图默认写成 `first_frame`
- 其余参考图写成 `reference_image`
- `cameraSpec.ratio` 或环境变量 -> `ratio`
- `durationTargetSec` -> `duration`

当前默认：

- `generate_audio = false`
- `watermark = false`

## 输出

输出 `{ results, report }`

单条 `result` 当前典型字段有：

- `shotId`
- `preferredProvider`
- `provider`
- `status`
- `videoPath`
- `outputUrl`
- `taskId`
- `providerJobId`
- `providerRequest`
- `providerMetadata`
- `targetDurationSec`
- `actualDurationSec`
- `failureCategory`
- `error`
- `errorCode`
- `errorStatus`
- `errorDetails`

## 当前任务状态处理

官方状态映射：

- `succeeded` -> `completed`
- `failed` -> `failed`
- `expired` -> `provider_timeout`
- `cancelled` -> `failed`
- 其余如 `queued / running` -> 持续轮询

## 当前错误分类

统一归一到：

- `provider_auth_error`
- `provider_rate_limit`
- `provider_timeout`
- `provider_invalid_request`
- `provider_generation_failed`

## 当前可审计产物

- `1-outputs/seedance-video-results.json`
- `1-outputs/seedance-video-report.md`
- `2-metrics/seedance-video-report.json`
- `3-errors/<shotId>-seedance-error.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 与 Fallback Video 的关系

- `Fallback Video Adapter` 仍保留，作为兼容 provider
- `Seedance Video Agent` 是当前默认的火山方舟 provider 实现
- `Director` 默认优先走 `Seedance`
- 如果 `shotPackages` 中存在不同 `preferredProvider`，`Director` 会按真实路由结果分别调用对应 agent
- `Video Composer` 不感知是 `fallback video` 还是 `Seedance`，只消费统一的 `videoResults`

## 不负责的内容

- 不做镜头增强
- 不做 `Shot QA`
- 不决定最终是否回退到静图
- 不决定桥接和连续动作段是否生成

## 相关文档

- [Video Router Agent](video-router.md)
- [Fallback Video Adapter](fallback-video-adapter.md)
- [Director](director.md)
- [Video Composer](video-composer.md)
