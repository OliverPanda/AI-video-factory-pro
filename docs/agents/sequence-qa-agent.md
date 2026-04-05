# Sequence QA Agent

## 职责

- 对 `sequenceClipResults` 做工程验收与最小连续性验收
- 输出 `sequenceQaReport`
- 只有 `pass` 的 sequence 才能覆盖原始 shot timeline

## 典型输入

- `sequenceClipResults`
- `videoResults`
- `bridgeClipResults`

## 典型输出

- `finalDecision`
- `fallbackAction`
- `passedCount`
- `fallbackCount`
- `manualReviewCount`

## 落盘

- `09n-sequence-qa/1-outputs/sequence-qa-report.json`
- `09n-sequence-qa/2-metrics/sequence-qa-metrics.json`
- `09n-sequence-qa/2-metrics/qa-summary.json`

## 当前 MVP 边界

- 先做文件可读、时长可用、entry/exit 与 continuity 的轻量校验
- 不做昂贵视觉评分模型
- `manual_review / fail / fallback` 都不会进入 composer 的 sequence 主路径
