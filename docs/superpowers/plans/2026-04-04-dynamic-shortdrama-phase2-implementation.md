# 动态短剧升级 Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不重写 `Director` 和不改变 `composer` 输入心智的前提下，为现有视频主链补齐表演规划、镜头增强和双层 QA，让单镜头默认更像真实动态镜头而不是静图拼接。

**Architecture:** Phase 2 继续沿用 Phase 1 的单 orchestrator 架构，把新能力插入现有 `motionPlan -> shotPackages -> videoResults -> shotQaReport -> composer` 主链。新增 `Performance Planner Agent`、`Motion Enhancer Agent` 和 `Shot QA v2`，并通过 `rawVideoResults / enhancedVideoResults / videoResults` 三层结果桥接，保持 `composer` 仍只消费 `videoResults`。

**Tech Stack:** Node.js、现有 agent runtime、FFmpeg / ffprobe、Runway API、Node test runner

---

## File Structure

本轮优先沿用现有文件边界，不做无关重构。

**Core runtime**

- Create: `src/agents/performancePlanner.js`
- Create: `src/agents/motionEnhancer.js`
- Modify: `src/agents/videoRouter.js`
- Modify: `src/agents/runwayVideoAgent.js`
- Modify: `src/agents/shotQaAgent.js`
- Modify: `src/agents/director.js`
- Modify: `src/agents/videoComposer.js`
- Modify: `src/utils/runArtifacts.js`
- Modify: `src/utils/fileHelper.js`（仅当增强层需要新的文件探测/规范化辅助函数时）
- Modify: `scripts/resume-from-step.js`

**Tests**

- Create: `tests/performancePlanner.test.js`
- Create: `tests/motionEnhancer.test.js`
- Modify: `tests/videoRouter.test.js`
- Modify: `tests/runwayVideoAgent.test.js`
- Modify: `tests/shotQaAgent.test.js`
- Modify: `tests/videoComposer.test.js`
- Modify: `tests/resumeFromStep.test.js`
- Modify: `tests/director.project-run.test.js`
- Modify: `tests/director.artifacts.test.js`
- Modify: `tests/pipeline.acceptance.test.js`
- Modify: `tests/runArtifacts.test.js`

**Docs**

- Modify: `README.md`
- Modify: `docs/agents/README.md`
- Modify: `docs/agents/agent-io-map.md`
- Modify: `docs/agents/video-composer.md`
- Modify: `docs/runtime/resume-from-step.md`
- Create: `docs/agents/performance-planner.md`
- Create: `docs/agents/motion-enhancer.md`
- Create: `docs/superpowers/plans/2026-04-04-dynamic-shortdrama-phase2-implementation.md`

## Task 1：定义协议层与状态桥接

**Files:**

- Create: `tests/performancePlanner.test.js`
- Modify: `tests/videoRouter.test.js`
- Modify: `tests/resumeFromStep.test.js`
- Modify: `src/agents/videoRouter.js`
- Modify: `src/agents/shotQaAgent.js`
- Modify: `src/agents/director.js`
- Modify: `scripts/resume-from-step.js`

- [ ] **Step 1: 写 `performancePlan` 协议失败测试**

覆盖最小字段：

- `performanceTemplate`
- `subjectBlocking`
- `actionBeatList`
- `cameraMovePlan`
- `motionIntensity`
- `tempoCurve`
- `expressionCue`
- `providerPromptDirectives`
- `enhancementHints`
- `generationTier`
- `variantCount`

- [ ] **Step 2: 运行失败测试确认当前仓库还没有该协议**

Run: `node --test tests/performancePlanner.test.js`
Expected: FAIL，提示缺少 `performancePlanner` 或字段不完整。

- [ ] **Step 3: 扩展 `shotPackage v2` 协议失败测试**

在 [tests/videoRouter.test.js](/d:/My-Project/AI-video-factory-pro/tests/videoRouter.test.js) 增加断言，要求 router 消费 `performancePlan` 后写出：

- `performanceTemplate`
- `actionBeatList`
- `cameraMovePlan`
- `generationTier`
- `variantCount`
- `candidateSelectionRule`
- `regenPolicy`
- `firstLastFramePolicy`
- `enhancementHints`

- [ ] **Step 4: 写 `resume` 新状态字段失败测试**

在 [tests/resumeFromStep.test.js](/d:/My-Project/AI-video-factory-pro/tests/resumeFromStep.test.js) 增加断言：

- `--step=compose` 保留：
  - `performancePlan`
  - `rawVideoResults`
  - `enhancedVideoResults`
  - `videoResults`
  - `shotQaReportV2`
- `--step=video` 清理：
  - `performancePlan`
  - `shotPackages`
  - `rawVideoResults`
  - `enhancedVideoResults`
  - `videoResults`
  - `shotQaReport`
  - `shotQaReportV2`

- [ ] **Step 5: 最小实现协议与 state 字段**

修改 [videoRouter.js](/d:/My-Project/AI-video-factory-pro/src/agents/videoRouter.js)、[shotQaAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/shotQaAgent.js)、[director.js](/d:/My-Project/AI-video-factory-pro/src/agents/director.js)、[resume-from-step.js](/d:/My-Project/AI-video-factory-pro/scripts/resume-from-step.js)，先把 Phase 2 的协议字段和状态桥接通道挂起来，不做全部业务逻辑。

- [ ] **Step 6: 运行协议与 resume 测试**

Run: `node --test tests/performancePlanner.test.js tests/videoRouter.test.js tests/resumeFromStep.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/performancePlanner.test.js tests/videoRouter.test.js tests/resumeFromStep.test.js src/agents/videoRouter.js src/agents/shotQaAgent.js src/agents/director.js scripts/resume-from-step.js
git commit -m "feat: 定义 Phase 2 表演规划与视频状态桥接协议"
```

## Task 2：新增 Performance Planner Agent

**Files:**

- Create: `src/agents/performancePlanner.js`
- Create: `tests/performancePlanner.test.js`

- [ ] **Step 1: 写镜头模板分类失败测试**

至少覆盖这 6 类：

- `dialogue_closeup_react`
- `dialogue_two_shot_tension`
- `emotion_push_in`
- `fight_exchange_medium`
- `fight_impact_insert`
- `ambient_transition_motion`

- [ ] **Step 2: 写 `generationTier / variantCount` 规则失败测试**

要求：

- 普通镜头默认 `generationTier = base`
- 强情绪或关键打击镜头可升级 `enhanced`
- `hero` 只留给少数关键镜头
- `variantCount` 默认 1，关键镜头允许 2-3

- [ ] **Step 3: 运行失败测试**

Run: `node --test tests/performancePlanner.test.js`
Expected: FAIL

- [ ] **Step 4: 实现最小规则版 planner**

在 [performancePlanner.js](/d:/My-Project/AI-video-factory-pro/src/agents/performancePlanner.js) 中实现：

- 输入 `motionPlan + shots + continuity context`
- 输出 `performancePlan`
- 固定模板分类
- 写出 `performance-plan.json`
- 写出 QA summary / metrics

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/performancePlanner.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agents/performancePlanner.js tests/performancePlanner.test.js
git commit -m "feat: 新增 Phase 2 表演规划 Agent"
```

## Task 3：升级 Video Router 为 Phase 2 版本

**Files:**

- Modify: `src/agents/videoRouter.js`
- Modify: `tests/videoRouter.test.js`

- [ ] **Step 1: 写 router 消费 `performancePlan` 的失败测试**

断言 router 会把 `motionPlan + performancePlan + imageResults + prompts` 组装为 `shotPackage v2`。

- [ ] **Step 2: 写候选策略与生成层级规则失败测试**

要求至少覆盖：

- `base` 镜头固定单候选
- `enhanced` 镜头允许 2 候选
- `hero` 镜头允许 3 候选但必须显式记账
- 缺少合格参考图时允许静图回退

- [ ] **Step 3: 运行失败测试**

Run: `node --test tests/videoRouter.test.js`
Expected: FAIL

- [ ] **Step 4: 最小实现 router 升级**

更新 [videoRouter.js](/d:/My-Project/AI-video-factory-pro/src/agents/videoRouter.js)：

- 消费 `performancePlan`
- 产出 `shotPackage v2`
- 写出 `candidateSelectionRule / regenPolicy / firstLastFramePolicy`
- 记录 `generationTier` 分布 metrics

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/videoRouter.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agents/videoRouter.js tests/videoRouter.test.js
git commit -m "feat: 升级视频路由以支持 Phase 2 镜头包协议"
```

## Task 4：升级 Runway Video Agent 输出 rawVideoResults

**Files:**

- Modify: `src/agents/runwayVideoAgent.js`
- Modify: `tests/runwayVideoAgent.test.js`

- [ ] **Step 1: 写 `rawVideoResults` 失败测试**

断言每个结果至少含：

- `provider`
- `model`
- `variantIndex`
- `targetDurationSec`
- `actualDurationSec`
- `failureCategory`

- [ ] **Step 2: 写多候选镜头输出失败测试**

要求关键镜头生成多个候选时仍能稳定落盘并记账。

- [ ] **Step 3: 运行失败测试**

Run: `node --test tests/runwayVideoAgent.test.js`
Expected: FAIL

- [ ] **Step 4: 更新 agent 输出结构**

修改 [runwayVideoAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/runwayVideoAgent.js)：

- 输出 `rawVideoResults`
- 保留现有错误分类
- 记录模型 tier、候选索引、实际时长
- 写出 `raw-video-results.json`

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/runwayVideoAgent.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agents/runwayVideoAgent.js tests/runwayVideoAgent.test.js
git commit -m "feat: 扩展 Runway 视频产物以支持原始结果分层"
```

## Task 5：新增 Motion Enhancer Agent

**Files:**

- Create: `src/agents/motionEnhancer.js`
- Create: `tests/motionEnhancer.test.js`
- Modify: `src/utils/fileHelper.js`（如需）

- [ ] **Step 1: 写增强决策失败测试**

覆盖：

- 已有基础运动的镜头 -> `enhance`
- 工程正常且动态正常的镜头 -> `pass_through`
- 明显坏文件或生成失败镜头 -> `skip_enhance`

- [ ] **Step 2: 写增强结果结构失败测试**

断言输出：

- `enhancementApplied`
- `enhancementProfile`
- `enhancementActions`
- `enhancedVideoPath`
- `durationAdjusted`
- `qualityDelta`

- [ ] **Step 3: 写最小 FFmpeg 增强管线失败测试**

要求优先覆盖：

- `timing normalizer`
- `encoding normalization`
- `motion smoothness enhancement`

- [ ] **Step 4: 运行失败测试**

Run: `node --test tests/motionEnhancer.test.js`
Expected: FAIL

- [ ] **Step 5: 实现最小增强 agent**

在 [motionEnhancer.js](/d:/My-Project/AI-video-factory-pro/src/agents/motionEnhancer.js) 中实现：

- enhancement decision
- 单条 FFmpeg filter graph 优先策略
- 增强前后 probe
- `enhanced-video-results.json`

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test tests/motionEnhancer.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/motionEnhancer.js tests/motionEnhancer.test.js src/utils/fileHelper.js
git commit -m "feat: 新增 Phase 2 镜头增强 Agent"
```

## Task 6：升级 Shot QA 为 V2

**Files:**

- Modify: `src/agents/shotQaAgent.js`
- Modify: `tests/shotQaAgent.test.js`

- [ ] **Step 1: 写工程可用 + 动态可用双层验收失败测试**

至少覆盖：

- 合法 mp4 + 有运动 -> `engineering_pass + motion_pass`
- 合法 mp4 + 近乎静帧 -> `engineering_pass + motion_fail`
- 空文件/坏文件 -> `engineering_fail`

- [ ] **Step 2: 写按模板分桶阈值失败测试**

要求不同 `shotType / performanceTemplate` 使用不同阈值，而不是全局一个数。

- [ ] **Step 3: 写回退决策失败测试**

覆盖：

- `pass`
- `pass_with_enhancement`
- `fallback_to_image`
- `manual_review`

- [ ] **Step 4: 运行失败测试**

Run: `node --test tests/shotQaAgent.test.js`
Expected: FAIL

- [ ] **Step 5: 实现最小 `Shot QA v2`**

修改 [shotQaAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/shotQaAgent.js)：

- 工程指标检测
- `freeze / near-duplicate / motion / black / signal` 指标
- `shotQaReportV2`
- `manual-review-shots.json`

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test tests/shotQaAgent.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/shotQaAgent.js tests/shotQaAgent.test.js
git commit -m "feat: 升级镜头质检为 Phase 2 双层验收"
```

## Task 7：Director 集成与最终 videoResults 桥接

**Files:**

- Modify: `src/agents/director.js`
- Modify: `tests/director.project-run.test.js`
- Modify: `tests/director.artifacts.test.js`

- [ ] **Step 1: 写主链顺序失败测试**

要求 `Director` 按顺序接入：

- `motionPlanner`
- `performancePlanner`
- `videoRouter`
- `runwayVideoAgent`
- `motionEnhancer`
- `shotQaAgent`

- [ ] **Step 2: 写 `videoResults` 最终桥接失败测试**

断言：

- `rawVideoResults` 和 `enhancedVideoResults` 分开缓存
- `videoResults` 只在 QA 决策后统一写入
- 回退镜头不会污染 `videoResults`

- [ ] **Step 3: 写 run summary 字段失败测试**

新增断言：

- `planned_performance_shot_count`
- `enhanced_video_shot_count`
- `raw_video_shot_count`
- `manual_review_shot_count`
- `video_generation_tier_breakdown`

- [ ] **Step 4: 运行失败测试**

Run: `node --test tests/director.project-run.test.js tests/director.artifacts.test.js`
Expected: FAIL

- [ ] **Step 5: 实现 Director 集成**

更新 [director.js](/d:/My-Project/AI-video-factory-pro/src/agents/director.js)：

- 接入新 agents
- 写 state cache
- 统一桥接 `videoResults`
- 记录 run summary

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test tests/director.project-run.test.js tests/director.artifacts.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/director.js tests/director.project-run.test.js tests/director.artifacts.test.js
git commit -m "feat: 集成 Phase 2 视频主链与最终视频桥接"
```

## Task 8：保持 Composer 兼容并验证主路径

**Files:**

- Modify: `src/agents/videoComposer.js`
- Modify: `tests/videoComposer.test.js`
- Modify: `tests/pipeline.acceptance.test.js`

- [ ] **Step 1: 写 composer 兼容性失败测试**

断言：

- composer 仍只认 `videoResults`
- 不需要理解 `rawVideoResults / enhancedVideoResults`
- `videoResults` 缺失时仍回退旧路径

- [ ] **Step 2: 写 acceptance 失败测试**

要求 production-style 样例能证明：

- 主链确实经过 `Performance Planner -> Motion Enhancer -> Shot QA v2`
- 最终成片来源于 Phase 2 视频主路径
- fallback 被显式记账

- [ ] **Step 3: 运行失败测试**

Run: `node --test tests/videoComposer.test.js tests/pipeline.acceptance.test.js`
Expected: FAIL

- [ ] **Step 4: 做最小 composer 桥接调整**

只在 [videoComposer.js](/d:/My-Project/AI-video-factory-pro/src/agents/videoComposer.js) 中补 Phase 2 所需兼容逻辑，不引入对内部新通道的耦合。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/videoComposer.test.js tests/pipeline.acceptance.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agents/videoComposer.js tests/videoComposer.test.js tests/pipeline.acceptance.test.js
git commit -m "feat: 保持合成器兼容并验证 Phase 2 视频主路径"
```

## Task 9：更新 Artifact 编号与续跑清理

**Files:**

- Modify: `src/utils/runArtifacts.js`
- Modify: `scripts/resume-from-step.js`
- Modify: `tests/runArtifacts.test.js`
- Modify: `tests/resumeFromStep.test.js`

- [ ] **Step 1: 写 artifact 编号迁移失败测试**

要求新 run 包统一输出：

- `09a-motion-planner`
- `09b-performance-planner`
- `09c-video-router`
- `09d-runway-video-agent`
- `09e-motion-enhancer`
- `09f-shot-qa`
- `10-video-composer`

- [ ] **Step 2: 写历史包不迁移的边界测试**

要求：

- 新逻辑不要求重写历史 Phase 1 包
- 只验证新运行包编号

- [ ] **Step 3: 运行失败测试**

Run: `node --test tests/runArtifacts.test.js tests/resumeFromStep.test.js`
Expected: FAIL

- [ ] **Step 4: 实现编号与清理规则**

修改 [runArtifacts.js](/d:/My-Project/AI-video-factory-pro/src/utils/runArtifacts.js) 和 [resume-from-step.js](/d:/My-Project/AI-video-factory-pro/scripts/resume-from-step.js)。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/runArtifacts.test.js tests/resumeFromStep.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/runArtifacts.js scripts/resume-from-step.js tests/runArtifacts.test.js tests/resumeFromStep.test.js
git commit -m "chore: 升级 Phase 2 运行包编号与续跑清理规则"
```

## Task 10：文档与验收命令同步

**Files:**

- Modify: `README.md`
- Modify: `docs/agents/README.md`
- Modify: `docs/agents/agent-io-map.md`
- Modify: `docs/agents/video-composer.md`
- Modify: `docs/runtime/resume-from-step.md`
- Create: `docs/agents/performance-planner.md`
- Create: `docs/agents/motion-enhancer.md`

- [ ] **Step 1: 写 README 更新清单**

必须补：

- Phase 2 主链图
- 新 agent 顺序
- Phase 2 MVP 非目标
- 新验收命令

- [ ] **Step 2: 写 agent 文档更新清单**

必须补：

- `Performance Planner`
- `Motion Enhancer`
- `Shot QA v2`
- `composer` 兼容策略

- [ ] **Step 3: 写 runtime / resume 文档更新清单**

必须补：

- `video` 阶段内部新增模块
- 新状态字段
- `compose` 保留规则
- `video` 清理规则

- [ ] **Step 4: 更新文档**

按以上清单修改对应文档，保持与 [2026-04-04-dynamic-shortdrama-phase2-design.md](/d:/My-Project/AI-video-factory-pro/docs/superpowers/specs/2026-04-04-dynamic-shortdrama-phase2-design.md) 一致。

- [ ] **Step 5: 执行最终验收命令**

Run:

```bash
node --test tests/performancePlanner.test.js tests/videoRouter.test.js tests/runwayVideoAgent.test.js tests/motionEnhancer.test.js tests/shotQaAgent.test.js tests/videoComposer.test.js tests/resumeFromStep.test.js tests/director.project-run.test.js tests/director.artifacts.test.js tests/pipeline.acceptance.test.js tests/runArtifacts.test.js
```

Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add README.md docs/agents/README.md docs/agents/agent-io-map.md docs/agents/video-composer.md docs/runtime/resume-from-step.md docs/agents/performance-planner.md docs/agents/motion-enhancer.md docs/superpowers/plans/2026-04-04-dynamic-shortdrama-phase2-implementation.md
git commit -m "docs: 同步 Phase 2 实施计划与运行文档"
```

## Test Plan

- [ ] 协议层：`performancePlan` 字段完整，`shotPackage v2` 正确消费表演计划
- [ ] Router：`generationTier / variantCount / firstLastFramePolicy` 规则正确
- [ ] Runway Agent：输出 `rawVideoResults`，多候选与时长记账正确
- [ ] Motion Enhancer：增强决策正确，最小 FFmpeg 管线稳定，坏片段不会被误增强
- [ ] Shot QA v2：工程可用和动态可用双层判定正确，按模板分桶阈值有效，`manual_review` 有显式记账
- [ ] Director：新主链顺序正确，`videoResults` 由 QA 决策后统一桥接，run summary 新字段完整
- [ ] Composer：仍只消费 `videoResults`，内部新增通道不会泄漏到 composer 接口
- [ ] Resume：`--step=compose` 保留视频相关结果，`--step=video` 清理视频及其后续状态
- [ ] Artifacts：新编号统一生效，历史包不要求迁移
- [ ] Acceptance：至少 1 个 production-style 样例证明 Phase 2 视频主路径已走通

## Notes

- Phase 2 默认仍锁 `Runway` 为 provider，不在本计划中扩展多 provider 自动路由
- `FILM / Real-ESRGAN` 仅作为未来可选增强插件，不纳入 Phase 2 MVP 必做项
- `manual-review-shots.json` 作为 `manual_review` 的最小落盘产物必须写出
- 所有任务默认遵循 TDD：先补失败测试，再做最小实现，再跑通过，再提交
