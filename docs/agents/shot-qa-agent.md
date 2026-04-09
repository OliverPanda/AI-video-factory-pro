# Shot QA Agent

本文档基于 `src/agents/shotQaAgent.js`。

## 负责什么

`Shot QA Agent` 对动态镜头做最小自动验收，决定哪些镜头还能走视频主链，哪些镜头必须回退到静图。

## 入口函数

- `runShotQa(videoResults, options)`
- `evaluateShotVideos(videoResults, options)`

## 输入

- `videoResults`
- 可选 `options`：
  - `probeVideo`
  - `artifactContext`

## 当前验收维度

当前至少检查两层：

1. 工程层
   - 文件存在
   - 文件非空
   - 时长是否在目标范围内
2. motion 层
   - `freezeDurationSec`
   - `nearDuplicateRatio`
   - `motionScore`

## 输出

输出 `shotQaReport`，每条 entry 典型字段有：

- `shotId`
- `qaStatus`
- `engineeringStatus`
- `motionStatus`
- `canUseVideo`
- `fallbackToImage`
- `enhancementApplied`
- `enhancementProfile`
- `finalDecision`
- `decisionReason`
- `durationSec`
- `targetDurationSec`

## 当前决策规则

- 通过时：
  - `pass`
  - `pass_with_enhancement`
- 不通过时：
  - `fallback_to_image`

`Director` 会基于这个报告统一桥接最终 `videoResults`。

## 当前可审计产物

- `09f-shot-qa/1-outputs/shot-qa-report.json`
- `09f-shot-qa/1-outputs/manual-review-shots.json`
- `09f-shot-qa/1-outputs/shot-qa-report.md`
- `09f-shot-qa/2-metrics/shot-qa-metrics.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 不负责的内容

- 不重新生成视频
- 不直接插入 compose timeline
- 不负责 bridge shot 子链

## 相关文档

- [Fallback Video Adapter](fallback-video-adapter.md)
- [Motion Enhancer Agent](motion-enhancer.md)
- [Video Composer](video-composer.md)
