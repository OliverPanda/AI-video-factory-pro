# Lip-sync Agent

本文档基于 `src/agents/lipsyncAgent.js`。

## 负责什么

`Lip-sync Agent` 负责为需要说话表演的镜头生成口型片段，并在失败时给出降级和人工复核建议。

## 入口函数

- `runLipsync(shots, imageResults, audioResults, options)`
- `shouldApplyLipsync(shot)`

## 输入

- `shots`
- `imageResults`
- `audioResults`
- 可选 `options`：
  - `generateLipsyncClip`
  - `shouldLipsyncShot`
  - `validateGeneratedClip`
  - `outputPathBuilder`
  - `artifactContext`

## 当前触发规则

只有镜头满足“需要看见说话表演”时才触发：

- 有对白
- `visualSpeechRequired === true`
- `isCloseUp === true`
- `camera_type` 属于 close-up / medium 一类

## 当前 QA 规则

生成结果会按镜头尺度决定 QA 严格度：

- close-up 更严格
- key shot / 强检镜头失败更容易升级为 `block`
- 普通镜头失败允许降级回标准合成路径

## 输出

输出：

- `clips`
- `report`
- `results`

其中 report 当前包含：

- `status`
- `triggeredCount`
- `generatedCount`
- `failedCount`
- `skippedCount`
- `downgradedCount`
- `fallbackCount`
- `manualReviewCount`
- `blockers`
- `warnings`

## 当前可审计产物

- `08b-lipsync-agent/1-outputs/lipsync.index.json`
- `08b-lipsync-agent/1-outputs/lipsync-report.md`
- `08b-lipsync-agent/2-metrics/lipsync-report.json`
- `08b-lipsync-agent/3-errors/<shotId>-lipsync-error.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 不负责的内容

- 不负责音频生成
- 不负责动态镜头生成
- 不负责最终时间线编排

## 相关文档

- [TTS Agent](tts-agent.md)
- [TTS QA Agent](tts-qa-agent.md)
- [Video Composer](video-composer.md)
