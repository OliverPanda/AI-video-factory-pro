# TTS QA Agent

本文档基于 `src/agents/ttsQaAgent.js`。

## 负责什么

`TTS QA Agent` 对配音结果做最小自动验收，并给出人工抽查计划。

## 入口函数

- `runTtsQa(shots, audioResults, voiceResolution, options)`

## 输入

- `shots`
- `audioResults`
- `voiceResolution`
- 可选 `options`：
  - `getAudioDurationMs`
  - `transcribeAudio`
  - `asrWarnThreshold`
  - `asrBlockThreshold`
  - `artifactContext`

## 当前验收维度

- 音频文件是否存在
- 音频时长是否落在对白预算附近
- ASR 转写偏差是否过大
- 是否使用 fallback voice
- 同一角色是否发生音色漂移

## 输出

输出 `ttsQaReport`，包含：

- `status`
- `blockers`
- `warnings`
- `dialogueShotCount`
- `fallbackCount`
- `fallbackRate`
- `budgetPassRate`
- `asrReport`
- `manualReviewPlan`
- `entries`

## 当前人工抽查规划

`manualReviewPlan` 会重点抽：

- 主角镜头
- 配角镜头
- 高情绪对白
- close-up / 强检镜头

## 当前可审计产物

- `08-tts-qa/2-metrics/tts-qa.json`
- `08-tts-qa/2-metrics/asr-report.json`
- `08-tts-qa/1-outputs/voice-cast-report.md`
- `08-tts-qa/1-outputs/manual-review-sample.md`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 不负责的内容

- 不重新生成音频
- 不负责 lip-sync 生成
- 不直接控制最终 compose

## 相关文档

- [TTS Agent](tts-agent.md)
- [Lip-sync Agent](lipsync-agent.md)
- [Agent 输入输出关系图](agent-io-map.md)
