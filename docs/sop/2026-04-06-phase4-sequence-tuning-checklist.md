# Phase 4 Sequence 调优 Checklist

这份清单面向真实样本试跑后的复盘和调优。

目标不是回答“有没有跑通”，而是更快回答下面 4 个问题：

1. 这轮到底有多少 sequence 真正发起生成了
2. 主要失败在哪一类问题
3. 哪些 sequence 最终真的进了成片
4. 下一步最值得先改 prompt、补参考，还是接受回退

## 推荐使用场景

- 跑真实样本，例如 `samples/寒烬宫变-pro.txt`
- 一轮跑完后觉得“还是像 PPT”
- 怀疑 sequence 子链虽然接上了，但没有真正提升成片观感
- 准备做下一轮 prompt / reference / fallback 调优

## 建议阅读顺序

### 1. 先看 run 根目录 `qa-overview.md`

先判断整轮是否可交付，以及主要卡在视频、桥接、sequence 还是 composer。

如果这里只看到“可交付”，不代表 sequence 已经真正起效，还要继续往下看。

### 2. 再看 `09l-action-sequence-router/2-metrics/action-sequence-routing-metrics.json`

重点字段：

- `plannedSequenceCount`
- `referenceTierBreakdown`
- `skippedCount`
- `skipReasonBreakdown`

这里主要回答：

- 这轮到底有多少 sequence 被选中了
- 有多少 sequence 根本没发请求
- 没发请求主要是因为：
  - `missing_image_reference`
  - `missing_video_reference`
  - `missing_bridge_reference`
  - `insufficient_reference_mix`
  - `no_valid_reference_material`

判断建议：

- `skipReasonBreakdown` 主要是 `missing_image_reference`
  先补图像参考，不要先改 prompt
- 主要是 `missing_bridge_reference`
  说明 cut 点桥接不足，先补 bridge 资产
- 主要是 `insufficient_reference_mix`
  说明素材不是完全没有，而是覆盖不够，先优化 sequence 选材和参考组合

### 3. 再看 `09n-sequence-qa/2-metrics/sequence-qa-metrics.json`

重点字段：

- `failureCategoryBreakdown`
- `topFailureCategory`
- `topRecommendedAction`
- `actionBreakdown`
- `fallbackSequenceIds`
- `manualReviewSequenceIds`

这里主要回答：

- 这轮 sequence 主要失败在哪类 QA 问题
- 下一步应该优先做什么
- 哪些 sequence 已经明确回退
- 哪些 sequence 更适合人工挑选

判断建议：

- `topFailureCategory = continuity_mismatch`
  先优化 sequence prompt 的连续性表达、角色/动作连续约束
- `topFailureCategory = entry_exit_mismatch`
  先优化进出约束和桥接上下文
- `topFailureCategory = duration_mismatch`
  先调整目标时长或 provider 请求参数
- `topFailureCategory = provider_output_invalid`
  先看 provider 输出质量和下载文件有效性

### 4. 再看 `09n-sequence-qa/1-outputs/sequence-qa-report.md`

这一步主要是把 metrics 里的聚合结论映射回单条 sequence，避免只知道“这一类很多”，但不知道“到底是哪些 sequence”。

重点关注：

- 哪些 sequence 通过
- 哪些 sequence 进入 fallback
- 哪些 sequence 建议 manual review
- 人类可读总结里给出的下一步建议

### 5. 再看 `10-video-composer/2-metrics/video-metrics.json`

重点字段：

- `sequence_coverage_shot_count`
- `sequence_coverage_sequence_count`
- `applied_sequence_ids`
- `covered_shot_ids`
- `fallback_shot_ids`

这里主要回答：

- sequence 虽然过了 QA，最终有没有真的进入成片
- 进入成片后覆盖了多少 shot
- 还有哪些 shot 仍然走旧路径

判断建议：

- `applied_sequence_ids` 为空
  说明这轮 sequence 对成片没有真实贡献
- `sequence_coverage_shot_count` 很低
  说明 sequence 子链接上了，但覆盖面很小
- `fallback_shot_ids` 很多
  说明大部分镜头仍靠 `videoResults / bridge / lipsync / image` 交付

### 6. 最后看分集目录下的 `delivery-summary.md`

这是 run 级复盘入口，适合做“这一轮值不值得继续围绕 sequence 调”的最终判断。

重点字段：

- `planned_sequence_count`
- `generated_sequence_count`
- `sequence_provider_breakdown`
- `sequence_fallback_count`
- `sequence_coverage_shot_count`
- `sequence_coverage_sequence_count`
- `applied_sequence_ids`
- `fallback_sequence_ids`

## 一轮复盘时建议固定记录的结论

每次真实样本跑完，建议至少记录这 6 行：

- 本轮计划了多少个 sequence
- 实际发起生成了多少个 sequence
- 主要 skip 原因是什么
- 主要 QA 失败类型是什么
- 最终有多少个 sequence 真进了成片
- 下一轮优先动作是什么

可以直接用下面这个模板：

```md
## Phase 4 Sequence Retro

- planned_sequence_count:
- generated_sequence_count:
- top_skip_reason:
- topFailureCategory:
- topRecommendedAction:
- sequence_coverage_sequence_count:
- sequence_coverage_shot_count:
- applied_sequence_ids:
- fallback_sequence_ids:
- next_iteration_focus:
```

## 推荐下一轮调优优先级

默认建议按这个顺序来：

1. 先补参考素材问题
2. 再调 sequence prompt 模板
3. 再调 route 选择规则
4. 最后再讨论是否要扩 sequence 类型

原因很简单：

- 没有足够参考时，prompt 再漂亮也很难救
- 连续性没过时，先修 entry/exit 和 continuity 约束最划算
- 真正进不了成片时，先看 composer 覆盖摘要，比盲目盯 provider 输出更有用

## 当前不建议马上做的事

- 不建议因为一轮效果差就立刻再加新 orchestrator
- 不建议为了少量失败就升级成 sequence 级 CLI
- 不建议在还没形成稳定复盘习惯前就引入昂贵视觉评分模型
- 不建议一开始就跳到多人群战自动编排

当前最值钱的是：

- 让每一轮失败都能更快归因
- 让每一次 sequence 成功都能明确体现在最终成片覆盖率上
