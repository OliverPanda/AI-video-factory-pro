# Sequence Clip Generator

## 职责

- 生成连续动作段视频
- 输出 `sequenceClipResults`
- 记录 provider 失败分类，供 Director 决定是否回退
- 默认走 `Seedance` sequence 视频路径，显式 `Runway` 仍兼容

## 典型输入

- `actionSequencePackages`

## 典型输出

- `sequenceId`
- `coveredShotIds`
- `videoPath`
- `targetDurationSec`
- `actualDurationSec`
- `failureCategory`

## 落盘

- `09m-sequence-clip-generator/1-outputs/sequence-clip-results.json`
- `09m-sequence-clip-generator/1-outputs/sequence-generation-context.json`
- `09m-sequence-clip-generator/1-outputs/sequence-clip-report.md`
- `09m-sequence-clip-generator/2-metrics/sequence-clip-generation-report.json`
- `09m-sequence-clip-generator/3-errors/*.json`

`sequence-generation-context.json` 会额外记录：

- `referenceStrategy`
- `referenceTier`
- `referenceCount`
- `generationMode`
- `sequenceContextSummary`

## 当前 MVP 边界

- 只负责生成与下载
- 不负责最终是否覆盖原始 shot timeline
- 单段失败时允许回退到 `videoResults + bridgeClips`
