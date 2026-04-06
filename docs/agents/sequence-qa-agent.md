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
- `09n-sequence-qa/1-outputs/sequence-qa-context.json`
- `09n-sequence-qa/1-outputs/sequence-qa-report.md`
- `09n-sequence-qa/2-metrics/sequence-qa-metrics.json`
- `09n-sequence-qa/2-metrics/qa-summary.json`

`sequence-qa-context.json` 会把验收结论和生成上下文并排写盘，方便回放排查：

- `referenceStrategy`
- `referenceTier`
- `referenceCount`
- `generationMode`
- `sequenceContextSummary`
- `finalDecision`
- `fallbackAction`
- `qaFailureCategory`
- `recommendedAction`

其中 `qaFailureCategory` 当前会归类到这几种高价值原因：

- `passed`
- `coverage_invalid`
- `provider_output_invalid`
- `provider_unavailable`
- `duration_mismatch`
- `entry_exit_mismatch`
- `continuity_mismatch`
- `quality_evaluator_error`
- `manual_review_needed`

`recommendedAction` 会基于分类给出下一步建议，例如：

- `keep_sequence_in_main_timeline`
- `retry_or_regenerate_provider_output`
- `adjust_duration_or_regenerate`
- `tighten_entry_exit_constraints`
- `fallback_to_shots_or_add_bridge_context`
- `manual_review_and_select_best_variant`

## 当前 MVP 边界

- 先做文件可读、时长可用、entry/exit 与 continuity 的轻量校验
- 不做昂贵视觉评分模型
- `manual_review / fail / fallback` 都不会进入 composer 的 sequence 主路径
