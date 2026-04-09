# 动态短剧升级 Phase 4 收口后下一轮高价值任务实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 不继续横向扩系统，而是沿着当前 `action sequence -> Seedance -> sequence QA -> composer` 主线，优先补齐“更容易调优、更容易看懂、更容易稳定提升观感”的小层能力。

**Strategy:** 默认执行顺序固定为 4 个任务，先提升排查效率，再提升生成质量，再补路由可解释性，最后补全 run 级命中记账。

**Current Status:** 截至 `2026-04-06`，本计划 4 个任务均已在当前代码库落地，本文档用于正式落盘、复盘和后续延伸执行。

---

## File Structure

本轮严格沿用当前 Phase 4 代码边界，不新增 orchestrator、不新增 CLI、不拆新 runtime。

**Core runtime**

- Modify: `src/agents/sequenceQaAgent.js`
- Modify: `src/agents/actionSequenceRouter.js`
- Modify: `src/apis/seedanceVideoApi.js`
- Modify: `src/agents/director.js`
- Modify: `src/agents/videoComposer.js`
- Modify: `src/utils/actionSequenceProtocol.js`

**Tests**

- Modify: `tests/sequenceQaAgent.test.js`
- Modify: `tests/actionSequenceRouter.test.js`
- Modify: `tests/seedanceVideoApi.test.js`
- Modify: `tests/director.sequence.integration.test.js`
- Modify: `tests/pipeline.acceptance.test.js`
- Modify: `tests/videoComposer.test.js`
- Modify: `tests/videoComposer.artifacts.test.js`

**Docs**

- Create: `docs/superpowers/plans/2026-04-06-dynamic-shortdrama-phase4-high-value-followups-implementation.md`

---

## Task 1：Sequence QA 问题类型汇总摘要

**目标**

让一次 run 结束后可以直接回答：“这轮 sequence 主要失败在哪类问题上，下一步优先改什么”。

**Files**

- Modify: `src/agents/sequenceQaAgent.js`
- Modify: `tests/sequenceQaAgent.test.js`

- [x] 在 `sequence-qa-metrics.json` 的现有 `failureCategoryBreakdown` 基础上新增：
  - `topFailureCategory`
  - `topRecommendedAction`
  - `actionBreakdown`
  - `fallbackSequenceIds`
  - `manualReviewSequenceIds`
- [x] 在 `sequence-qa-report.md` 和 `qa-summary.md` 增加一句人类可读总结
- [x] 保持 `finalDecision`、`fallbackAction`、`qaFailureCategory` 的既有判定逻辑不变
- [x] 补测试覆盖：
  - 多类失败并存时选出 `topFailureCategory`
  - `recommendedAction` 聚合正确
  - `pass` 场景不误报失败主因

---

## Task 2：Seedance 分类型 Sequence Prompt 模板

**目标**

把已落地的 `sequenceContextSummary` 从“通用描述”升级为“按动作段类型优化的最小模板”，优先提高 `fight_exchange / chase_run / dialogue_move` 三类 sequence 的可控性。

**Files**

- Modify: `src/agents/actionSequenceRouter.js`
- Modify: `src/apis/seedanceVideoApi.js`
- Modify: `tests/actionSequenceRouter.test.js`
- Modify: `tests/seedanceVideoApi.test.js`

- [x] 新增轻量模板映射：
  - `fight_exchange_sequence`
  - `chase_run_sequence`
  - `dialogue_move_sequence`
  - 其余类型继续走通用模板
- [x] 模板只增强已有 prompt 片段，不新增复杂 DSL
- [x] 模板固定包含：
  - 连续动作目标
  - 运镜方向
  - 主体连续性
  - 进出约束
- [x] 保证现有 `sequenceContextSummary / referenceTier / audioBeatHints` 不丢失

---

## Task 3：Action Sequence Router 的 Skip 原因分类

**目标**

把当前 `skip_generation` 从“知道跳过了”升级成“知道为什么跳过了”，方便判断是补参考素材，还是直接接受回退。

**Files**

- Modify: `src/utils/actionSequenceProtocol.js`
- Modify: `src/agents/actionSequenceRouter.js`
- Modify: `tests/actionSequenceRouter.test.js`

- [x] 在 `actionSequencePackage` 中新增结构化字段：
  - `skipReason`
- [x] 固定 `skipReason` 推荐值：
  - `missing_video_reference`
  - `missing_bridge_reference`
  - `missing_image_reference`
  - `no_valid_reference_material`
  - `insufficient_reference_mix`
- [x] 在 `action-sequence-routing-metrics.json` 中新增：
  - `skipReasonBreakdown`
- [x] 在 `action-sequence-packages.json` 与 QA summary 中明确写出 skip 原因
- [x] 保持既有 provider 优先级不变，只增强“为什么没发请求”的可解释性

---

## Task 4：Director / Composer 的 Sequence 覆盖命中摘要

**目标**

让每次 run 后都能一眼知道：这次到底有多少 shot 真正被 sequence 覆盖，哪些 sequence 生效了，哪些最终还是走回旧路径。

**Files**

- Modify: `src/agents/director.js`
- Modify: `src/agents/videoComposer.js`
- Modify: `tests/director.sequence.integration.test.js`
- Modify: `tests/pipeline.acceptance.test.js`
- Modify: `tests/videoComposer.test.js`
- Modify: `tests/videoComposer.artifacts.test.js`

- [x] 在 `Director` run summary 中新增：
  - `sequence_coverage_shot_count`
  - `sequence_coverage_sequence_count`
  - `applied_sequence_ids`
  - `fallback_sequence_ids`
- [x] 在 `delivery-summary.md` 中输出 sequence 覆盖命中摘要
- [x] 在 `videoComposer` metrics / QA summary 中输出：
  - 哪些 shot 被 sequence 覆盖
  - 哪些 shot 仍走旧路径
- [x] 不改变 composer 输入优先级，不新增 timeline 层

---

## 验收命令

每完成一个任务都跑对应定向测试；四项都完成后统一跑：

```bash
node --test tests/actionSequenceRouter.test.js tests/seedanceVideoApi.test.js tests/sequenceQaAgent.test.js tests/director.sequence.integration.test.js tests/pipeline.acceptance.test.js
```

如需补 composer 侧回归，再跑：

```bash
node --test tests/videoComposer.test.js tests/videoComposer.artifacts.test.js
```

如需做本轮完整收口，可再补：

```bash
node --test tests/actionSequencePlanner.test.js tests/actionSequenceRouter.test.js tests/sequenceClipGenerator.test.js tests/sequenceQaAgent.test.js tests/videoComposer.sequence.test.js tests/director.sequence.integration.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js tests/pipeline.acceptance.test.js
```

---

## 非目标

本轮明确不做：

- 不新增新 provider
- 不新增新 CLI
- 不升级成 sequence 级续跑
- 不引入昂贵视觉评分模型
- 不做多人群战编排
- 不做语音节拍闭环

---

## Assumptions

- 默认继续沿用当前推荐顺序：`Task 1 -> Task 2 -> Task 3 -> Task 4`
- `Seedance` 仍是 sequence 默认主 provider，`Runway` 只保留兼容
- 本轮目标仍是“提升调优效率和生成可控性”，不是引入新系统层
- 当前仓库状态已经完成本计划首轮实现，后续只需基于本文件继续验收、补文档或做下一轮增量升级
