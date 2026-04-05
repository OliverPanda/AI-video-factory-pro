# Bridge Clip Generator Agent

本文档基于 `src/agents/bridgeClipGenerator.js`。

## 负责什么

`Bridge Clip Generator` 把 `bridgeShotPackages` 变成 `bridgeClipResults`。

它会：

- 对可生成的 bridge package 调 provider
- 对能力不满足的请求返回可解释失败
- 对明确不需要生成的 package 返回 `skipped`

## 入口函数

- `generateBridgeClips(bridgeShotPackages, videoDir, options)`

## 输入

- `bridgeShotPackages`
- `videoDir`
- 可选 `options`：
  - `supportedCapabilities`
  - `generateBridgeClip`
  - `artifactContext`

## 输出

输出 `{ results, report }`

其中单条 `result` 当前典型字段有：

- `bridgeId`
- `status`
- `provider`
- `model`
- `videoPath`
- `targetDurationSec`
- `actualDurationSec`
- `failureCategory`
- `error`

## 当前生成规则

- `preferredProvider !== runway` 时直接 `skipped`
- `providerCapabilityRequirement` 不满足时直接 `failed`
- 默认把 bridge package 转成兼容 Runway 的 shot package 再生成
- 失败会保留标准化错误信息，不假成功

## 当前可审计产物

- `09i-bridge-clip-generator/1-outputs/bridge-clip-results.json`
- `09i-bridge-clip-generator/1-outputs/bridge-clip-report.md`
- `09i-bridge-clip-generator/2-metrics/bridge-clip-generation-report.json`
- `09i-bridge-clip-generator/3-errors/<bridgeId>-bridge-error.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 不负责的内容

- 不负责 bridge 类型规划
- 不负责 bridge QA
- 不负责决定 `direct_cut / transition_stub / manual_review`
- 不负责 timeline 插入

## 相关文档

- [Bridge Shot Router Agent](bridge-shot-router.md)
- [Bridge QA Agent](bridge-qa-agent.md)
- [Agent 输入输出关系图](agent-io-map.md)
