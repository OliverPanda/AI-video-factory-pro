# 动态短剧升级 Phase 4：Action Sequence 连续动作段 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不推翻当前 Phase 1~3 主链的前提下，为高价值连续动作段新增 `action sequence` 子链，让成片可优先消费通过 QA 的整段连续动作视频，而不是只能依赖离散 shot + bridge 组合。

**Architecture:** Phase 4 继续保留 `Director` 为唯一 orchestrator，普通镜头仍走 Phase 2 主链，cut 点桥接仍走 Phase 3 子链，只在识别到高价值连续动作段时插入 `Action Sequence Planner / Router / Generator / QA` 四个模块。`videoComposer` 继续保持后期层定位，由 `Director` 决定何时用 `sequence clips` 覆盖原有多个 shot 的 timeline 写入。

**Tech Stack:** Node.js、现有 agent runtime、Runway API 复用链路、FFmpeg / ffprobe、Node test runner

---

## File Structure

本轮优先沿用 Phase 2 / Phase 3 的文件边界，不做无关重构。

**Core runtime**

- Create: `src/utils/actionSequenceProtocol.js`
- Create: `src/agents/actionSequencePlanner.js`
- Create: `src/agents/actionSequenceRouter.js`
- Create: `src/agents/sequenceClipGenerator.js`
- Create: `src/agents/sequenceQaAgent.js`
- Modify: `src/agents/director.js`
- Modify: `src/agents/videoComposer.js`
- Modify: `src/agents/runwayVideoAgent.js`（仅在确有必要时抽取 sequence 复用能力）
- Modify: `src/utils/runArtifacts.js`
- Modify: `scripts/resume-from-step.js`

**Tests**

- Create: `tests/actionSequencePlanner.test.js`
- Create: `tests/actionSequenceRouter.test.js`
- Create: `tests/sequenceClipGenerator.test.js`
- Create: `tests/sequenceQaAgent.test.js`
- Create: `tests/videoComposer.sequence.test.js`
- Create: `tests/director.sequence.integration.test.js`
- Modify: `tests/resumeFromStep.test.js`
- Modify: `tests/runArtifacts.test.js`
- Modify: `tests/pipeline.acceptance.test.js`

**Docs**

- Modify: `README.md`
- Modify: `docs/agents/README.md`
- Modify: `docs/agents/agent-io-map.md`
- Modify: `docs/agents/video-composer.md`
- Modify: `docs/runtime/resume-from-step.md`
- Create: `docs/agents/action-sequence-planner.md`
- Create: `docs/agents/sequence-clip-generator.md`
- Create: `docs/agents/sequence-qa-agent.md`
- Create: `docs/superpowers/plans/2026-04-05-dynamic-shortdrama-phase4-action-sequence-implementation.md`

## Task 1：定义 Sequence 协议层、状态缓存与 artifact 编号

**Files:**

- Create: `src/utils/actionSequenceProtocol.js`
- Create: `tests/actionSequencePlanner.test.js`
- Modify: `tests/resumeFromStep.test.js`
- Modify: `tests/runArtifacts.test.js`
- Modify: `src/utils/runArtifacts.js`
- Modify: `scripts/resume-from-step.js`
- Modify: `src/agents/director.js`

- [ ] **Step 1: 写 `actionSequencePlan` 最小协议失败测试**

覆盖最小字段：

- `sequenceId`
- `shotIds`
- `sequenceType`
- `sequenceGoal`
- `durationTargetSec`
- `cameraFlowIntent`
- `motionContinuityTargets`
- `subjectContinuityTargets`
- `environmentContinuityTargets`
- `mustPreserveElements`
- `entryConstraint`
- `exitConstraint`
- `generationMode`
- `preferredProvider`
- `fallbackStrategy`

- [ ] **Step 2: 在同一测试文件补 `actionSequencePackage / sequenceClipResults / sequenceQaReport` 字段失败测试**

至少覆盖：

- `actionSequencePackage.referenceImages / referenceVideos / bridgeReferences / audioBeatHints`
- `sequenceClipResults.coveredShotIds / videoPath / failureCategory`
- `sequenceQaReport.entries[].finalDecision / fallbackAction`

- [ ] **Step 3: 写 resume 的 Phase 4 状态字段失败测试**

在 `tests/resumeFromStep.test.js` 中增加断言：

- `--step=compose` 保留：
  - `actionSequencePlan`
  - `actionSequencePackages`
  - `sequenceClipResults`
  - `sequenceQaReport`
- `--step=video` 清理：
  - `actionSequencePlan`
  - `actionSequencePackages`
  - `sequenceClipResults`
  - `sequenceQaReport`

- [ ] **Step 4: 写 run artifact 编号失败测试**

要求新 run 包统一输出：

- `09k-action-sequence-planner`
- `09l-action-sequence-router`
- `09m-sequence-clip-generator`
- `09n-sequence-qa`

- [ ] **Step 5: 运行失败测试确认当前仓库还没有这些协议**

Run:

```bash
node --test tests/actionSequencePlanner.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js
```

Expected: FAIL，提示缺少新协议、artifact layout 或 resume 清理规则

- [ ] **Step 6: 写最小协议工具与状态桥接**

实现：

- `src/utils/actionSequenceProtocol.js` 中的字段常量与 shape helper
- `src/utils/runArtifacts.js` 的 Phase 4 目录布局
- `scripts/resume-from-step.js` 的 Phase 4 清理规则
- `src/agents/director.js` 中 Phase 4 state 占位字段桥接

- [ ] **Step 7: 运行测试确认通过**

Run:

```bash
node --test tests/actionSequencePlanner.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add tests/actionSequencePlanner.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js src/utils/actionSequenceProtocol.js src/utils/runArtifacts.js scripts/resume-from-step.js src/agents/director.js
git commit -m "feat: 定义 Phase 4 action sequence 协议与状态桥接"
```

## Task 2：新增 Action Sequence Planner Agent

**Files:**

- Create: `src/agents/actionSequencePlanner.js`
- Modify: `tests/actionSequencePlanner.test.js`

- [ ] **Step 1: 写连续动作段触发规则失败测试**

至少覆盖这 5 类：

- `fight_exchange_sequence`
- `chase_run_sequence`
- `escape_transition_sequence`
- `impact_followthrough_sequence`
- `dialogue_move_sequence`

- [ ] **Step 2: 写“不对所有 shot 默认生成 sequence”的失败测试**

要求：

- 只有 `2~5` 个 shot 的高价值连续动作段才生成 `actionSequencePlan`
- 普通镜头或连续性价值不足的镜头组不应被误识别

- [ ] **Step 3: 写 entry / exit 约束与 sequence 时长失败测试**

要求：

- `entryConstraint`、`exitConstraint` 被正确写出
- `durationTargetSec` 为覆盖 shot 的合理聚合时长
- `fallbackStrategy` 默认为回退到原始 `videoResults + bridgeClips`

- [ ] **Step 4: 运行失败测试**

Run:

```bash
node --test tests/actionSequencePlanner.test.js
```

Expected: FAIL

- [ ] **Step 5: 实现最小规则版 planner**

在 `src/agents/actionSequencePlanner.js` 中实现：

- 基于 `shotPlan + motionPlan + performancePlan + continuity/bridge context` 识别 sequence
- 固定 5 类 sequence 触发规则
- 限制一个 sequence 覆盖 `2~5` 个 shot
- 写出 `action-sequence-plan.json`
- 写出 QA summary / metrics

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test tests/actionSequencePlanner.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/actionSequencePlanner.js tests/actionSequencePlanner.test.js
git commit -m "feat: 新增 Phase 4 Action Sequence Planner Agent"
```

## Task 3：新增 Action Sequence Router Agent

**Files:**

- Create: `src/agents/actionSequenceRouter.js`
- Create: `tests/actionSequenceRouter.test.js`

- [ ] **Step 1: 写 `actionSequencePackage` 失败测试**

断言输出最小字段：

- `sequenceId`
- `shotIds`
- `referenceImages`
- `referenceVideos`
- `bridgeReferences`
- `visualGoal`
- `cameraSpec`
- `continuitySpec`
- `entryFrameHint`
- `exitFrameHint`
- `audioBeatHints`
- `preferredProvider`
- `fallbackProviders`
- `qaRules`

- [ ] **Step 2: 写参考素材优先级失败测试**

要求：

- 优先引用已通过 QA 的 `videoResults`
- 其次引用已通过 QA 的 `bridgeClipResults`
- 最后再回退到 `imageResults`

- [ ] **Step 3: 写参考不足不生成无意义请求的失败测试**

要求：

- 缺少关键参考时可标记为 skip / fallback
- 不应构造明显无效的 provider request

- [ ] **Step 4: 运行失败测试**

Run:

```bash
node --test tests/actionSequenceRouter.test.js
```

Expected: FAIL

- [ ] **Step 5: 实现 router**

在 `src/agents/actionSequenceRouter.js` 中实现：

- `actionSequencePlan -> actionSequencePackage`
- 参考图/视频/bridge 素材装配
- `audioBeatHints` 协议层透传
- provider route 与 fallback route 规则
- artifacts 与 QA summary

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test tests/actionSequenceRouter.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/actionSequenceRouter.js tests/actionSequenceRouter.test.js
git commit -m "feat: 新增 Phase 4 Action Sequence Router Agent"
```

## Task 4：新增 Sequence Clip Generator Agent

**Files:**

- Create: `src/agents/sequenceClipGenerator.js`
- Create: `tests/sequenceClipGenerator.test.js`
- Modify: `src/agents/runwayVideoAgent.js`（如需抽公共 provider 调用）

- [ ] **Step 1: 写 sequence 生成成功路径失败测试**

要求：

- 成功提交 provider 任务
- 正确轮询并下载结果
- 产出 `sequenceClipResults` 的最小字段

- [ ] **Step 2: 写 provider 失败分类失败测试**

至少区分：

- `provider_auth_error`
- `provider_rate_limit`
- `provider_timeout`
- `provider_invalid_request`
- `provider_generation_failed`

- [ ] **Step 3: 写下载后坏文件 / 空文件失败测试**

要求：

- 下载到空文件或伪文件时不应标记成功
- `failureCategory` 正确记录

- [ ] **Step 4: 运行失败测试**

Run:

```bash
node --test tests/sequenceClipGenerator.test.js
```

Expected: FAIL

- [ ] **Step 5: 实现 generator**

在 `src/agents/sequenceClipGenerator.js` 中实现：

- 循环处理 `actionSequencePackages`
- 复用现有 provider job submit / poll / download 模式
- 写出 `sequenceClipResults`
- 下载后做最小文件存在性校验
- artifacts 与 error 分类落盘

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test tests/sequenceClipGenerator.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/sequenceClipGenerator.js tests/sequenceClipGenerator.test.js src/agents/runwayVideoAgent.js
git commit -m "feat: 新增 Phase 4 Sequence Clip Generator Agent"
```

## Task 5：新增 Sequence QA Agent

**Files:**

- Create: `src/agents/sequenceQaAgent.js`
- Create: `tests/sequenceQaAgent.test.js`

- [ ] **Step 1: 写合法 mp4 通过的失败测试**

要求：

- `ffprobe` 可读
- 时长不为 0
- `coveredShotIds` 存在
- `finalDecision === pass`

- [ ] **Step 2: 写工程失败测试**

至少覆盖：

- 空文件失败
- 伪文件失败
- 时长异常失败

- [ ] **Step 3: 写连续性失败与 fallback 失败测试**

要求：

- `entryExitCheck` 不通过时判定失败
- `continuityCheck` 不通过时可 `fallback_to_shot_path`
- fallback 必须显式记账

- [ ] **Step 4: 运行失败测试**

Run:

```bash
node --test tests/sequenceQaAgent.test.js
```

Expected: FAIL

- [ ] **Step 5: 实现 QA Agent**

在 `src/agents/sequenceQaAgent.js` 中实现：

- `ffprobe` 工程校验
- 时长阈值校验
- `entry / exit` 和连续性规则校验
- `finalDecision / fallbackAction` 输出
- artifacts、QA summary、metrics

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test tests/sequenceQaAgent.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/sequenceQaAgent.js tests/sequenceQaAgent.test.js
git commit -m "feat: 新增 Phase 4 Sequence QA Agent"
```

## Task 6：Director / Composer 集成 sequence 主路径

**Files:**

- Modify: `src/agents/director.js`
- Modify: `src/agents/videoComposer.js`
- Create: `tests/director.sequence.integration.test.js`
- Create: `tests/videoComposer.sequence.test.js`
- Modify: `tests/pipeline.acceptance.test.js`

- [ ] **Step 1: 写 Director 顺序与缓存命中失败测试**

要求：

- `Director` 顺序变为：
  - `videoResults`
  - `bridge clips`
  - `action sequence`
  - `compose`
- state cache 命中时不重复生成 sequence

- [ ] **Step 2: 写 sequence QA pass 时优先消费 sequence 的失败测试**

要求：

- `sequenceClips` 覆盖对应 `shotIds`
- 被覆盖的 shot 不再重复写入 timeline

- [ ] **Step 3: 写 sequence QA fail 时回退旧路径的失败测试**

要求：

- 失败 sequence 不进入主 timeline
- 原始 `videoResults + bridgeClips` 继续可交付

- [ ] **Step 4: 运行失败测试**

Run:

```bash
node --test tests/director.sequence.integration.test.js tests/videoComposer.sequence.test.js tests/pipeline.acceptance.test.js
```

Expected: FAIL

- [ ] **Step 5: 实现 Director / Composer 集成**

在 `src/agents/director.js` 中实现：

- 规划、路由、生成、QA 四步 sequence 子链
- `actionSequencePlan / actionSequencePackages / sequenceClipResults / sequenceQaReport` state cache
- `sequence` pass 时的 timeline 覆盖桥接
- `sequence` fail 时的旧路径回退
- run summary 新字段

在 `src/agents/videoComposer.js` 中实现：

- 新增 `sequenceClips` 输入适配
- 按覆盖关系屏蔽对应原始 shot 写入
- 保持旧优先级与回退逻辑不被破坏

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test tests/director.sequence.integration.test.js tests/videoComposer.sequence.test.js tests/pipeline.acceptance.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/director.js src/agents/videoComposer.js tests/director.sequence.integration.test.js tests/videoComposer.sequence.test.js tests/pipeline.acceptance.test.js
git commit -m "feat: 接入 Phase 4 action sequence 主路径与 timeline 覆盖"
```

## Task 7：更新文档与最终验收命令

**Files:**

- Modify: `README.md`
- Modify: `docs/agents/README.md`
- Modify: `docs/agents/agent-io-map.md`
- Modify: `docs/agents/video-composer.md`
- Modify: `docs/runtime/resume-from-step.md`
- Create: `docs/agents/action-sequence-planner.md`
- Create: `docs/agents/sequence-clip-generator.md`
- Create: `docs/agents/sequence-qa-agent.md`

- [ ] **Step 1: 更新 README 的主链说明**

要求补充：

- Phase 4 的 `action sequence` 子链位置
- sequence 覆盖旧 shot timeline 的行为
- 当前 MVP 不包含多人群战和语音联动闭环

- [ ] **Step 2: 更新 agent 文档**

要求补充：

- `docs/agents/README.md` 中的新 agent 清单
- `docs/agents/agent-io-map.md` 中的新输入输出图和优先级
- `docs/agents/video-composer.md` 中的 sequence 覆盖规则

- [ ] **Step 3: 更新 runtime 续跑文档**

要求写清：

- `step 级续跑` 的小白解释
- `--step=compose` 保留 sequence 结果
- `--step=video` 清理 sequence 及后续状态

- [ ] **Step 4: 跑 Phase 4 收口验收命令**

Run:

```bash
node --test tests/actionSequencePlanner.test.js tests/actionSequenceRouter.test.js tests/sequenceClipGenerator.test.js tests/sequenceQaAgent.test.js tests/videoComposer.sequence.test.js tests/director.sequence.integration.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js tests/pipeline.acceptance.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md docs/agents/README.md docs/agents/agent-io-map.md docs/agents/video-composer.md docs/runtime/resume-from-step.md docs/agents/action-sequence-planner.md docs/agents/sequence-clip-generator.md docs/agents/sequence-qa-agent.md
git commit -m "docs: 补齐 Phase 4 action sequence 运行与协作文档"
```

## Final Acceptance Command

Phase 4 收口命令固定为：

```bash
node --test tests/actionSequencePlanner.test.js tests/actionSequenceRouter.test.js tests/sequenceClipGenerator.test.js tests/sequenceQaAgent.test.js tests/videoComposer.sequence.test.js tests/director.sequence.integration.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js tests/pipeline.acceptance.test.js
```

通过标准：

- 协议层字段完整
- `Director` 正确接入 sequence 子链
- `sequenceClips` 能覆盖对应 shot timeline
- `sequence QA` 失败时能正确回退
- resume / artifact / acceptance 全部通过
