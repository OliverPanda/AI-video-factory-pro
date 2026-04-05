# 动态短剧升级 Phase 3：Bridge Shot 与镜头连续性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不推翻当前 Phase 2 视频主链的前提下，为高风险 cut 点增加可控的桥接镜头子链，让成片镜头之间明显更顺，而不是依赖生硬硬切。

**Architecture:** Phase 3 继续保留 `Director` 为唯一 orchestrator，普通镜头仍走 Phase 2 主链，只在需要连续性过门的 cut 点插入 `bridge shot` 子链。新增 `Bridge Shot Planner / Router / Generator / QA` 四个模块，并由 `Director` 决定是否把 bridge clip 写入最终 timeline，`videoComposer` 只做兼容消费与时间线总装。

**Tech Stack:** Node.js、现有 agent runtime、Runway API、FFmpeg / ffprobe、Node test runner

---

## File Structure

本轮优先沿用现有 Phase 2 文件边界，不做无关重构。

**Core runtime**

- Create: `src/agents/bridgeShotPlanner.js`
- Create: `src/agents/bridgeShotRouter.js`
- Create: `src/agents/bridgeClipGenerator.js`
- Create: `src/agents/bridgeQaAgent.js`
- Modify: `src/agents/director.js`
- Modify: `src/agents/videoComposer.js`
- Modify: `src/agents/runwayVideoAgent.js`（如需抽取 bridge clip 复用能力）
- Modify: `src/utils/runArtifacts.js`
- Modify: `scripts/resume-from-step.js`

**Tests**

- Create: `tests/bridgeShotPlanner.test.js`
- Create: `tests/bridgeShotRouter.test.js`
- Create: `tests/bridgeClipGenerator.test.js`
- Create: `tests/bridgeQaAgent.test.js`
- Create: `tests/videoComposer.bridge.test.js`
- Create: `tests/director.bridge.integration.test.js`
- Modify: `tests/resumeFromStep.test.js`
- Modify: `tests/runArtifacts.test.js`

**Docs**

- Modify: `README.md`
- Modify: `docs/agents/README.md`
- Modify: `docs/agents/agent-io-map.md`
- Modify: `docs/agents/video-composer.md`
- Modify: `docs/runtime/resume-from-step.md`
- Create: `docs/agents/bridge-shot-planner.md`
- Create: `docs/agents/bridge-clip-generator.md`
- Create: `docs/agents/bridge-qa-agent.md`
- Create: `docs/superpowers/plans/2026-04-05-dynamic-shortdrama-phase3-bridge-shot-implementation.md`

## Task 1：定义 Bridge 协议层与状态桥接

**Files:**

- Create: `tests/bridgeShotPlanner.test.js`
- Modify: `tests/resumeFromStep.test.js`
- Modify: `tests/runArtifacts.test.js`
- Modify: `src/utils/runArtifacts.js`
- Modify: `scripts/resume-from-step.js`
- Modify: `src/agents/director.js`

- [ ] **Step 1: 写 `bridgeShotPlan` 最小协议失败测试**

覆盖最小字段：

- `bridgeId`
- `fromShotId`
- `toShotId`
- `bridgeType`
- `bridgeGoal`
- `durationTargetSec`
- `continuityRisk`
- `cameraTransitionIntent`
- `subjectContinuityTargets`
- `environmentContinuityTargets`
- `mustPreserveElements`
- `bridgeGenerationMode`
- `preferredProvider`
- `fallbackStrategy`

- [ ] **Step 2: 写 `resume` 的 Phase 3 状态字段失败测试**

在 `tests/resumeFromStep.test.js` 中增加断言：

- `--step=compose` 保留：
  - `bridgeShotPlan`
  - `bridgeShotPackages`
  - `bridgeClipResults`
  - `bridgeQaReport`
- `--step=video` 清理：
  - `bridgeShotPlan`
  - `bridgeShotPackages`
  - `bridgeClipResults`
  - `bridgeQaReport`
  - 以及 compose 相关结果

- [ ] **Step 3: 写 run artifact 编号失败测试**

要求新 run 包统一输出：

- `09g-bridge-shot-planner`
- `09h-bridge-shot-router`
- `09i-bridge-clip-generator`
- `09j-bridge-qa`

- [ ] **Step 4: 运行失败测试确认当前仓库还没有这些协议**

Run:

```bash
node --test tests/bridgeShotPlanner.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js
```

Expected: FAIL

- [ ] **Step 5: 最小挂接状态字段与 artifact layout**

修改：

- `src/utils/runArtifacts.js`
- `scripts/resume-from-step.js`
- `src/agents/director.js`

先把 Phase 3 的状态字段、artifact 编号和清理规则挂起来，不做完整业务。

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test tests/bridgeShotPlanner.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/bridgeShotPlanner.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js src/utils/runArtifacts.js scripts/resume-from-step.js src/agents/director.js
git commit -m "feat: 定义 Phase 3 bridge shot 协议与状态桥接"
```

## Task 2：新增 Bridge Shot Planner Agent

**Files:**

- Create: `src/agents/bridgeShotPlanner.js`
- Modify: `tests/bridgeShotPlanner.test.js`

- [ ] **Step 1: 写桥接触发规则失败测试**

至少覆盖这 4 类：

- `motion_carry`
- `camera_reframe`
- `spatial_transition`
- `emotional_transition`

- [ ] **Step 2: 写“不对所有 cut 默认桥接”的失败测试**

要求：

- 只有高风险 cut 点才生成 `bridgeShotPlan`
- 正常可直接切换的镜头对不应被误桥接

- [ ] **Step 3: 写桥接时长与桥接目标失败测试**

要求：

- `durationTargetSec` 在 MVP 范围内
- `bridgeGoal`、`continuityRisk`、`cameraTransitionIntent` 被正确写出

- [ ] **Step 4: 运行失败测试**

Run:

```bash
node --test tests/bridgeShotPlanner.test.js
```

Expected: FAIL

- [ ] **Step 5: 实现最小规则版 planner**

在 `src/agents/bridgeShotPlanner.js` 中实现：

- 基于相邻镜头对生成 `bridgeShotPlan`
- 固定 4 类桥接触发规则
- 写出 `bridge-shot-plan.json`
- 写出 QA summary / metrics

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test tests/bridgeShotPlanner.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/bridgeShotPlanner.js tests/bridgeShotPlanner.test.js
git commit -m "feat: 新增 Phase 3 Bridge Shot Planner Agent"
```

## Task 3：新增 Bridge Shot Router Agent

**Files:**

- Create: `src/agents/bridgeShotRouter.js`
- Create: `tests/bridgeShotRouter.test.js`

- [ ] **Step 1: 写 `bridgeShotPackage` 失败测试**

断言输出最小字段：

- `bridgeId`
- `fromShotRef`
- `toShotRef`
- `fromReferenceImage`
- `toReferenceImage`
- `promptDirectives`
- `negativePromptDirectives`
- `durationTargetSec`
- `providerCapabilityRequirement`
- `firstLastFrameMode`
- `qaRules`

- [ ] **Step 2: 写两档能力路由失败测试**

要求覆盖：

- 普通桥接 -> 基础桥接档
- 高风险桥接 -> 强约束桥接档
- provider 能力不满足 -> 回退保守策略

- [ ] **Step 3: 写引用前后镜头参考资产失败测试**

要求：

- 能正确引用 `fromShot` 和 `toShot` 的参考图
- 缺少参考图时不应生成无意义请求

- [ ] **Step 4: 运行失败测试**

Run:

```bash
node --test tests/bridgeShotRouter.test.js
```

Expected: FAIL

- [ ] **Step 5: 实现 router**

在 `src/agents/bridgeShotRouter.js` 中实现：

- `bridgeShotPlan -> bridgeShotPackage`
- 基础桥接档 / 强约束桥接档
- provider capability routing
- 落盘 `bridge-shot-packages.json`

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test tests/bridgeShotRouter.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/bridgeShotRouter.js tests/bridgeShotRouter.test.js
git commit -m "feat: 新增 Phase 3 bridge shot 路由与能力分层"
```

## Task 4：新增 Bridge Clip Generator Agent

**Files:**

- Create: `src/agents/bridgeClipGenerator.js`
- Create: `tests/bridgeClipGenerator.test.js`
- Modify: `src/agents/runwayVideoAgent.js`（如需抽取共享 helper）

- [ ] **Step 1: 写 `bridgeClipResults` 最小结构失败测试**

断言输出：

- `bridgeId`
- `status`
- `provider`
- `model`
- `videoPath`
- `targetDurationSec`
- `actualDurationSec`
- `failureCategory`
- `error`

- [ ] **Step 2: 写基础桥接档生成失败测试**

要求：

- bridge clip 可以走普通 image-to-video 档
- 成功结果可稳定落盘

- [ ] **Step 3: 写强约束桥接档路由失败测试**

要求：

- 高风险桥接能选择 first/last keyframe 能力档
- 不满足能力时有可解释的回退结果

- [ ] **Step 4: 运行失败测试**

Run:

```bash
node --test tests/bridgeClipGenerator.test.js
```

Expected: FAIL

- [ ] **Step 5: 实现最小生成器**

在 `src/agents/bridgeClipGenerator.js` 中实现：

- bridge request 提交
- 轮询 / 下载 / 错误分类
- 落盘 `bridge-clip-results.json`

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test tests/bridgeClipGenerator.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/bridgeClipGenerator.js tests/bridgeClipGenerator.test.js src/agents/runwayVideoAgent.js
git commit -m "feat: 新增 Phase 3 bridge clip 生成能力"
```

## Task 5：新增 Bridge QA Agent

**Files:**

- Create: `src/agents/bridgeQaAgent.js`
- Create: `tests/bridgeQaAgent.test.js`

- [ ] **Step 1: 写工程可用验收失败测试**

至少覆盖：

- 文件存在且 ffprobe 可读 -> engineering pass
- 空文件 / 坏文件 -> engineering fail

- [ ] **Step 2: 写连续性验收失败测试**

至少覆盖：

- 起始能接上 `fromShot`
- 结束能接上 `toShot`
- 无明显闪帧、跳反、身份漂移

- [ ] **Step 3: 写 bridge fallback 决策失败测试**

覆盖：

- `pass`
- `fallback_to_direct_cut`
- `fallback_to_transition_stub`
- `manual_review`

- [ ] **Step 4: 运行失败测试**

Run:

```bash
node --test tests/bridgeQaAgent.test.js
```

Expected: FAIL

- [ ] **Step 5: 实现最小 bridge QA**

在 `src/agents/bridgeQaAgent.js` 中实现：

- 工程验收
- 连续性验收
- 最终决策
- 落盘 `bridge-qa-report.json`

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test tests/bridgeQaAgent.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/bridgeQaAgent.js tests/bridgeQaAgent.test.js
git commit -m "feat: 新增 Phase 3 bridge shot QA 与回退策略"
```

## Task 6：Director 集成 Bridge 子链

**Files:**

- Modify: `src/agents/director.js`
- Create: `tests/director.bridge.integration.test.js`

- [ ] **Step 1: 写 Director 顺序集成失败测试**

要求 `Director` 按顺序接入：

- `bridgeShotPlanner`
- `bridgeShotRouter`
- `bridgeClipGenerator`
- `bridgeQaAgent`

- [ ] **Step 2: 写“只对高风险 cut 点插桥”的失败测试**

断言：

- 不是所有镜头对都会插 bridge clip
- 桥接失败时可回退为 direct cut

- [ ] **Step 3: 写状态缓存失败测试**

断言：

- `bridgeShotPlan`
- `bridgeShotPackages`
- `bridgeClipResults`
- `bridgeQaReport`

均进入 `state.json`

- [ ] **Step 4: 运行失败测试**

Run:

```bash
node --test tests/director.bridge.integration.test.js
```

Expected: FAIL

- [ ] **Step 5: 实现 Director 集成**

更新 `src/agents/director.js`：

- 接入 Phase 3 bridge 子链
- 缓存 bridge 状态
- 在 compose 前形成 bridge timeline decision

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
node --test tests/director.bridge.integration.test.js
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/director.js tests/director.bridge.integration.test.js
git commit -m "feat: 集成 Phase 3 bridge shot 子链到 Director"
```

## Task 7：Composer 兼容桥接时间线

**Files:**

- Modify: `src/agents/videoComposer.js`
- Create: `tests/videoComposer.bridge.test.js`

- [ ] **Step 1: 写 bridge clip 插入时间线失败测试**

断言：

- bridge clip 能插入主镜头之间
- 没有 bridge clip 时仍保持旧逻辑

- [ ] **Step 2: 写 bridge fallback 兼容失败测试**

断言：

- `fallback_to_direct_cut` 不会破坏主 compose
- `manual_review` 的 bridge 不会被误写入 timeline

- [ ] **Step 3: 运行失败测试**

Run:

```bash
node --test tests/videoComposer.bridge.test.js
```

Expected: FAIL

- [ ] **Step 4: 实现最小 composer 兼容逻辑**

只在 `src/agents/videoComposer.js` 中做最小调整：

- 支持 bridge clip 作为时间线插入项
- 不让 composer 直接承担 bridge 规划责任

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
node --test tests/videoComposer.bridge.test.js
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agents/videoComposer.js tests/videoComposer.bridge.test.js
git commit -m "feat: 支持 bridge shot 时间线插入与兼容回退"
```

## Task 8：续跑、Artifact 与 Acceptance 收口

**Files:**

- Modify: `scripts/resume-from-step.js`
- Modify: `src/utils/runArtifacts.js`
- Modify: `tests/resumeFromStep.test.js`
- Modify: `tests/runArtifacts.test.js`
- Modify: `tests/pipeline.acceptance.test.js`

- [ ] **Step 1: 写 Phase 3 artifact 编号与保留规则失败测试**

要求：

- `09g~09j` 输出正确
- `--step=compose` 保留 bridge 结果
- `--step=video` 清理 bridge 结果

- [ ] **Step 2: 写 acceptance 失败测试**

要求至少证明：

- 存在需要桥接的高风险 cut 点
- bridge shot 进入最终 timeline
- bridge 失败时可安全回退

- [ ] **Step 3: 运行失败测试**

Run:

```bash
node --test tests/resumeFromStep.test.js tests/runArtifacts.test.js tests/pipeline.acceptance.test.js
```

Expected: FAIL

- [ ] **Step 4: 实现收口逻辑**

更新：

- `scripts/resume-from-step.js`
- `src/utils/runArtifacts.js`
- acceptance 依赖的 Director / Composer 兼容点

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
node --test tests/resumeFromStep.test.js tests/runArtifacts.test.js tests/pipeline.acceptance.test.js
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/resume-from-step.js src/utils/runArtifacts.js tests/resumeFromStep.test.js tests/runArtifacts.test.js tests/pipeline.acceptance.test.js
git commit -m "chore: 收口 Phase 3 bridge artifact 与续跑规则"
```

## Task 9：文档同步与最终验收

**Files:**

- Modify: `README.md`
- Modify: `docs/agents/README.md`
- Modify: `docs/agents/agent-io-map.md`
- Modify: `docs/agents/video-composer.md`
- Modify: `docs/runtime/resume-from-step.md`
- Create: `docs/agents/bridge-shot-planner.md`
- Create: `docs/agents/bridge-clip-generator.md`
- Create: `docs/agents/bridge-qa-agent.md`
- Create: `docs/superpowers/plans/2026-04-05-dynamic-shortdrama-phase3-bridge-shot-implementation.md`

- [ ] **Step 1: 写 README 更新清单**

必须补：

- Phase 3 bridge 子链图
- 新 artifact 编号
- MVP 与中长期边界
- 新验收命令

- [ ] **Step 2: 写 agent 文档更新清单**

必须补：

- `Bridge Shot Planner`
- `Bridge Clip Generator`
- `Bridge QA Agent`
- composer 的 bridge 时间线兼容策略

- [ ] **Step 3: 写 runtime 文档更新清单**

必须补：

- `video` 阶段新增 bridge 子链
- 新状态字段
- `compose` 保留规则
- `video` 清理规则

- [ ] **Step 4: 更新文档**

按以上清单修改对应文档，保持与 `docs/superpowers/specs/2026-04-05-dynamic-shortdrama-phase3-bridge-shot-design.md` 一致。

- [ ] **Step 5: 执行最终验收命令**

Run:

```bash
node --test tests/bridgeShotPlanner.test.js tests/bridgeShotRouter.test.js tests/bridgeClipGenerator.test.js tests/bridgeQaAgent.test.js tests/videoComposer.bridge.test.js tests/director.bridge.integration.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js tests/pipeline.acceptance.test.js
```

Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add README.md docs/agents/README.md docs/agents/agent-io-map.md docs/agents/video-composer.md docs/runtime/resume-from-step.md docs/agents/bridge-shot-planner.md docs/agents/bridge-clip-generator.md docs/agents/bridge-qa-agent.md docs/superpowers/plans/2026-04-05-dynamic-shortdrama-phase3-bridge-shot-implementation.md
git commit -m "docs: 同步 Phase 3 bridge shot 实施计划与运行文档"
```

## Test Plan

- [ ] 协议层：`bridgeShotPlan / bridgeShotPackage / bridgeClipResults / bridgeQaReport` 字段完整
- [ ] Planner：只对高风险 cut 点触发桥接，4 类桥接规则覆盖正确
- [ ] Router：基础桥接档 / 强约束桥接档路由正确，引用前后镜头参考资产正确
- [ ] Generator：bridge clip 生成结果稳定落盘，provider 能力不满足时能给出可解释回退
- [ ] Bridge QA：工程可用与连续性可用判定正确，`fallback_to_direct_cut` 为默认兜底
- [ ] Director：只在需要时插桥，bridge 状态正确缓存，不破坏 Phase 2 主链
- [ ] Composer：bridge clip 可以插入 timeline，bridge 失败时仍保持原始主链可播
- [ ] Resume：`--step=compose` 保留 bridge 结果，`--step=video` 清理 bridge 及后续状态
- [ ] Artifacts：`09g~09j` 编号统一生效
- [ ] Acceptance：至少 1 个真实样例证明镜头之间明显更顺

## Notes

- Phase 3 MVP 仍沿用当前 `Director + Runway` 主链，不引入第二套默认运行时
- 社区强控工作流只作为中长期演进方向，不进入 MVP 默认主路径
- bridge shot 失败时必须优先回退为 `direct cut`，不能让桥接层破坏整体交付
- 所有任务默认遵循 TDD：先补失败测试，再做最小实现，再跑通过，再提交
