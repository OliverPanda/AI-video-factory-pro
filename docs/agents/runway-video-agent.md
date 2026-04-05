# Runway Video Agent

本文档基于 `src/agents/runwayVideoAgent.js`。

## 负责什么

`Runway Video Agent` 只负责消费 `shotPackages` 中被路由到 `runway` 的镜头，生成 `rawVideoResults`。它是统一视频 provider 协议下的一个具体实现，与 `Seedance Video Agent` 并存。

## 入口函数

- `runRunwayVideo(shotPackages, videoDir, options)`

## 输入

- `shotPackages`
- `videoDir`
- 可选 `options`：
  - `generateVideoClip`
  - `artifactContext`

## 输出

输出 `{ results, report }`

其中单条 `result` 当前典型字段有：

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

- `preferredProvider !== runway` 时直接 `skipped`
- 只有被 `Video Router` 路由到 `runway` 的镜头才会真实提交任务
- 成功时返回 `completed`
- 失败时保留标准化错误字段：
  - `failureCategory`
  - `error`
  - `errorCode`
  - `errorStatus`
  - `errorDetails`

## 当前可审计产物

- `09d-runway-video-agent/1-outputs/raw-video-results.json`
- `09d-runway-video-agent/1-outputs/video-report.md`
- `09d-runway-video-agent/2-metrics/video-generation-report.json`
- `09d-runway-video-agent/3-errors/<shotId>-video-error.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 不负责的内容

- 不做增强
- 不做镜头 QA
- 不桥接最终 `videoResults`
- 不决定 compose 使用顺位
- 不处理 `seedance` 路由镜头

## 相关文档

- [Video Router Agent](video-router.md)
- [Seedance Video Agent](seedance-video-agent.md)
- [Motion Enhancer Agent](motion-enhancer.md)
- [Shot QA Agent](shot-qa-agent.md)
