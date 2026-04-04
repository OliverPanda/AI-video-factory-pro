# 动态短剧升级 Phase 1 验收报告

基于：

- [Phase 1 设计文档](../specs/2026-04-04-dynamic-shortdrama-phase1-design.md)
- [Phase 1 实施计划](2026-04-04-dynamic-shortdrama-phase1-implementation.md)

本文档用于把本轮 Phase 1 收口成明确结论：哪些已经完成，哪些只是工程上达标但不代表商用品质完成，以及是否满足进入 Phase 2 的门槛。

## 结论摘要

当前 Phase 1 的工程目标可以判定为：

- `工程验收：通过`
- `产品验收：未完成`
- `是否可进入 Phase 2：可以`

原因：

- 成片主视觉主路径已经从 `imageResults` 切换到 `videoResults`
- `Director`、state cache、artifact、resume、测试、文档都已经完成闭环
- 但商用品质、镜头表现力、多角色复杂表演仍然不在本阶段承诺范围内

## Phase 1 完成度矩阵

| 类别 | 条目 | 状态 | 结论 |
| --- | --- | --- | --- |
| 架构目标 | `Director` 仍是唯一 orchestrator | `done` | 当前主流程仍由 `src/agents/director.js` 单点编排，没有引入第二个调度中心。 |
| 架构目标 | 新四个模块进入主链 | `done` | `Motion Planner / Video Router / Runway Video Agent / Shot QA Agent` 已进入主流程与流程图。 |
| 架构目标 | `image generator` 降级为参考图/回退来源 | `done` | 当前 Phase 1 中它负责参考图、首帧与静图 fallback，不再是默认交付视觉。 |
| 架构目标 | `video composer` 降级为后期总装层 | `done` | composer 已改为优先消费 `videoResults`，负责 timeline 合成与最终交付。 |
| 公共协议 | `motionPlan` 最小结构 | `done` | 已在主链生成并有单测覆盖。 |
| 公共协议 | `shotPackage` 最小结构 | `done` | 已由 `videoRouter` 组装并有规则测试。 |
| 公共协议 | `videoResults` 最小结构 | `done` | 已由 `runwayVideoAgent` 输出，并被 `Director` 与 `Shot QA` 消费。 |
| 公共协议 | `shotQaReport` 最小结构 | `done` | 已落盘并进入 composer 前桥接逻辑。 |
| 公共协议 | compose 优先级 | `done` | 现行为 `videoResults > lipsyncResults > animationClips > imageResults`。 |
| Artifact / Resume | `09a~09d`、`10-video-composer` | `done` | 编号已写入 artifact layout、测试和文档。 |
| Artifact / Resume | `motionPlan / shotPackages / videoResults / shotQaReport` state cache | `done` | 已进入 `state.json` 与续跑逻辑。 |
| Artifact / Resume | `--step=compose` 保留视频结果 | `done` | `resumeFromStep` 已有测试覆盖。 |
| Artifact / Resume | `--step=video` 清理视频及后续状态 | `done` | 已实现且有测试覆盖。 |
| 明确不做项 | `performance agent` | `not_in_scope` | 本阶段未实现，且符合原 spec。 |
| 明确不做项 | `bridge shot agent` | `not_in_scope` | 本阶段未实现，且符合原 spec。 |
| 明确不做项 | `Veo` 接入 | `not_in_scope` | 当前仅保留协议层兼容位，未落真实接入。 |
| 明确不做项 | `resume-from-shot` | `not_in_scope` | 当前仍是 step 级续跑。 |
| 明确不做项 | 成本预算系统 | `not_in_scope` | 当前未做成本控制或路由预算系统。 |
| 商用品质 | 真实动态表演质量稳定可商用 | `partial` | 工程链路已打通，但视觉质量仍取决于 provider 输出，不构成商用品质保证。 |
| 商用品质 | 多角色复杂打斗/桥接镜头/Act-Two 自动化 | `partial` | 明确未纳入 Phase 1，仅保留为 Phase 2 及后续方向。 |
| 商用品质 | `Shot QA` 能代表最终视觉质量 | `partial` | 当前 `Shot QA` 只代表工程可用，不代表镜头表现力或商业可交付质量。 |

## 工程验收 vs 产品验收

### 工程验收通过的定义

当前 Phase 1 已满足以下工程条件：

- 主链能生成并优先消费 `videoResults`
- 视频失败时能显式 fallback 到旧路径
- `Shot QA` 与 `resume-from-step` 不会破坏已生成的视频结果
- `state.json`、artifact、README、agent 文档、runtime 文档、流程图已同步
- 协议层、核心模块、director 集成、acceptance 测试都有明确覆盖

### 产品验收未完成的定义

以下内容不应被误认为“Phase 1 已经完成”：

- 真实动态表演质量稳定可商用
- 多角色复杂打斗、桥接镜头、Act-Two 自动化
- 通过 `Shot QA` 就等于视觉质量达标
- “像 PPT 一样切图”的商用问题已经由 Phase 1 自动解决

当前 Phase 1 的定位应固定为：

> 工程主路径切换完成，不等于商用动态短剧质量完成。

## 最终验收命令集

### 分层验收

1. 协议与核心模块

```bash
node --test tests/motionPlanner.test.js tests/videoRouter.test.js tests/runwayVideoApi.test.js tests/runwayVideoAgent.test.js tests/shotQaAgent.test.js
```

2. composer / resume / director 集成

```bash
node --test tests/videoComposer.test.js tests/resumeFromStep.test.js tests/director.project-run.test.js tests/director.artifacts.test.js tests/runArtifacts.test.js
```

3. acceptance

```bash
node --test tests/pipeline.acceptance.test.js
```

### 一次性收口命令

```bash
node --test tests/motionPlanner.test.js tests/videoRouter.test.js tests/runwayVideoApi.test.js tests/runwayVideoAgent.test.js tests/shotQaAgent.test.js tests/videoComposer.test.js tests/resumeFromStep.test.js tests/director.project-run.test.js tests/director.artifacts.test.js tests/pipeline.acceptance.test.js tests/runArtifacts.test.js
```

## 本轮验收结果

本轮已按上述“一次性收口命令”重新执行验收。

执行命令：

```bash
node --test tests/motionPlanner.test.js tests/videoRouter.test.js tests/runwayVideoApi.test.js tests/runwayVideoAgent.test.js tests/shotQaAgent.test.js tests/videoComposer.test.js tests/resumeFromStep.test.js tests/director.project-run.test.js tests/director.artifacts.test.js tests/pipeline.acceptance.test.js tests/runArtifacts.test.js
```

执行结果：

- `60 passed`
- `0 failed`
- `0 skipped`

该结果说明：

- 协议层、核心模块、resume、director 集成、acceptance 全部通过
- 当前仓库已经满足本文定义的 Phase 1 工程验收门槛

## 进入 Phase 2 的门槛

只有满足以下条件，才视为可以正式切换到 Phase 2：

- 上述最终验收命令全绿
- 本文“完成度矩阵”中，核心工程项全部为 `done`
- `partial` 只允许出现在视觉质量和商用品质层
- README、流程图文档和 spec 已能独立解释当前主链
- 对外口径固定为：
  - `工程主路径切换完成`
  - `商用品质仍待下一阶段优化`

## 本轮默认口径

本轮收口默认采用以下口径：

- `RUNWAY_API_KEY` 缺失时走 fallback 仍属于 Phase 1 合规行为
- 当前目标不是继续做 Phase 2 功能，而是把 Phase 1 收口成“决策完成、状态清晰”的里程碑
- 当前仓库最近三笔提交已覆盖 Phase 1 主实现，不需要再进行大规模补代码
