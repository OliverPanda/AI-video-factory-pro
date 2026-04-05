# Bridge QA Agent

本文档基于 `src/agents/bridgeQaAgent.js`。

## 负责什么

`Bridge QA Agent` 对 bridge clip 做两层验收：

1. 工程验收
2. 连续性决策

它的输出不是简单 `pass/fail`，而是当前 bridge 子链的最终动作建议。

## 入口函数

- `runBridgeQa(bridgeClipResults, options)`
- `evaluateBridgeClips(bridgeClipResults, options)`

## 输入

- `bridgeClipResults`
- 可选 `options`：
  - `probeVideo`
  - `evaluateContinuity`
  - `artifactContext`

## 当前决策集合

当前固定输出四档决策：

- `pass`
- `fallback_to_direct_cut`
- `fallback_to_transition_stub`
- `manual_review`

## 当前验收规则

工程验收最少检查：

- 文件存在
- 文件非空
- `ffprobe` 可读
- 时长在目标范围内

连续性决策当前读取这些维度：

- `continuityStatus`
- `transitionSmoothness`
- `identityDriftRisk`
- `cameraAxisStatus`

如果没有自定义 continuity evaluator，会先用默认保守值。

## 输出

输出 `bridgeQaReport`，包含：

- `status`
- `entries`
- `passedCount`
- `fallbackCount`
- `manualReviewCount`
- `warnings`

## 当前可审计产物

- `09j-bridge-qa/1-outputs/bridge-qa-report.json`
- `09j-bridge-qa/1-outputs/bridge-qa-report.md`
- `09j-bridge-qa/2-metrics/bridge-qa-metrics.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 不负责的内容

- 不负责重新生成 bridge clip
- 不负责改写主镜头结果
- 不负责直接修改 compose plan

只有 `finalDecision === "pass"` 的 bridge clip 才应进入最终 timeline。

## 相关文档

- [Bridge Clip Generator Agent](bridge-clip-generator.md)
- [Video Composer](video-composer.md)
- [Agent 输入输出关系图](agent-io-map.md)
