# 2026-04-07 项目健康检查

本文档用于回答一个非常具体的问题：

> 这个项目现在到底是“已经完全 OK”，还是“工程可用但仍在收口”？

结论先写前面：

- `工程状态：可用`
- `主链状态：已打通`
- `Phase 4 状态：已接入并通过当前回归测试`
- `产品状态：未完全收口`
- `当前阶段判断：适合继续试跑、调优和收口，不适合宣称商用品质已经稳定完成`

## 1. 本次检查基于什么

本次健康检查基于以下事实源：

- 仓库入口口径：[../../README.md](../../README.md)
- Agent 结构口径：[../agents/README.md](../agents/README.md)
- 运行与排障入口：[README.md](README.md)
- Phase 4 后续任务计划：[../superpowers/plans/2026-04-06-dynamic-shortdrama-phase4-high-value-followups-implementation.md](../superpowers/plans/2026-04-06-dynamic-shortdrama-phase4-high-value-followups-implementation.md)
- 2026-04-07 本地测试结果：
  - `npm run test:pipeline:prod`
  - `node --test tests/actionSequencePlanner.test.js tests/actionSequenceRouter.test.js tests/sequenceClipGenerator.test.js tests/sequenceQaAgent.test.js tests/videoComposer.sequence.test.js tests/director.sequence.integration.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js tests/pipeline.acceptance.test.js`

## 2. 现在已经确认 OK 的部分

以下部分可以视为“工程上已经成型”：

1. 单一 orchestrator 架构已经稳定成立

- `Director` 仍是唯一调度中心，没有拆出第二个 orchestrator。
- 当前主流程已经包含：
  - 静态图主链
  - 动态镜头主链
  - bridge shot 子链
  - action sequence 子链
  - TTS / lip-sync 子链
  - composer 总装交付

2. 主视频 provider 双路已经成立

- 当前实现支持：
  - `Seedance`
  - `Runway`
- 默认主 provider 已切到 `Seedance`
- `Runway` 仍保留为兼容与 fallback 路径

3. Phase 4 不是只停留在设计文档

- `Action Sequence Planner`
- `Action Sequence Router`
- `Sequence Clip Generator`
- `Sequence QA Agent`
- `Video Composer` sequence 覆盖逻辑

这些模块已经进入当前真实主流程，并且有对应测试与文档。

4. 当前回归测试结果是绿的

2026-04-07 本地执行结果：

- `npm run test:pipeline:prod`
  - `pass: 1`
  - `fail: 0`
- Phase 4 收口相关回归：
  - `pass: 60`
  - `fail: 0`

这说明：

- 核心 acceptance 主链当前可跑通
- Phase 4 action sequence 子链当前没有明显工程级回归
- `resume-from-step`、`runArtifacts`、`director sequence integration`、`videoComposer sequence` 这几块当前口径一致

## 3. 为什么还不能说“已经完全 OK”

“不能直接宣称完全 OK”不是因为主链没接上，而是因为当前项目仍然处在“工程闭环完成，产品质量收口中”的阶段。

主要原因有 4 个：

1. 文档口径仍明确区分工程验收和产品验收

- 现有文档多次强调：
  - 工程链路可用
  - 不等于商用品质已完成
- 当前 `Shot QA`、`Sequence QA` 更偏：
  - 工程可用
  - 最小连续性验收
  - fallback / 覆盖决策

而不是最终视觉品质背书。

2. Phase 4 仍然存在明确的“调优中”信号

- `docs/sop/README.md` 已经把 `Phase 4 Sequence 调优 Checklist` 作为当前推荐入口之一。
- `2026-04-06` 的高价值 follow-up 计划也说明：
  - 当前主链已落地
  - 但下一步重点仍是提升调优效率、可解释性和生成可控性

3. README 里已经明确写了本阶段不承诺的内容

当前 MVP 仍不包含：

- 多人群战自动编排闭环
- 语音驱动动作节拍闭环
- 商用品质级复杂表演保证

这不是 bug，而是当前阶段边界。

4. 仓库当前仍是进行中状态

本次检查时工作区不是干净状态，说明当前仓库还在推进中，而不是一个已经冻结收口的稳定里程碑。

## 4. 当前最准确的阶段判断

如果要用一句话描述当前状态，建议固定口径为：

> 这个项目现在已经达到“工程上可跑、结构上成型、主链完整”的阶段，但仍处于 Phase 4 质量收口与 sequence 调优阶段，不能直接等同于商用品质稳定完成。

可以把状态拆成两层：

- 对内工程判断：
  - `可以继续开发`
  - `可以继续联调`
  - `可以继续试跑真实样例`
- 对外/产品判断：
  - `不建议宣称已经完全成熟`
  - `不建议把当前 QA 结果直接等同于商业可交付质量`

## 5. 接下来最值得做的三件事

### A. 固化日常验收基线

建议把下面两组命令当作当前最小健康检查：

```bash
npm run test:pipeline:prod
```

```bash
node --test tests/actionSequencePlanner.test.js tests/actionSequenceRouter.test.js tests/sequenceClipGenerator.test.js tests/sequenceQaAgent.test.js tests/videoComposer.sequence.test.js tests/director.sequence.integration.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js tests/pipeline.acceptance.test.js
```

目标：

- 先确保主链没坏
- 再确保 Phase 4 子链没坏

### B. 做真实样例抽检，而不是只看单测

当前最该验证的不是“模块有没有返回值”，而是：

- sequence 真的有没有覆盖到该覆盖的镜头
- 覆盖后观感有没有明显提升
- fallback 是否仍然过于频繁
- bridge / sequence / lipsync 是否存在互相打架的情况

建议固定选 `1~2` 个真实剧本样例，连续复跑观察：

- `delivery-summary.md`
- run 根目录 `qa-overview.md`
- `09n-sequence-qa/2-metrics/sequence-qa-metrics.json`
- `10-video-composer/2-metrics/video-metrics.json`

### C. 把“工程问题”和“观感问题”分开管理

当前 backlog 最容易混淆的地方，是把这两类问题混在一起：

- 工程问题：
  - 主链是否能跑
  - 是否能续跑
  - artifacts 是否齐
  - provider 路由是否正确
- 观感问题：
  - 连续动作段是否真的更像连续镜头
  - sequence 覆盖是否值回票价
  - 人物动作、节奏、口型是否自然

建议后续任务一定分成两栏，否则容易出现“工程全绿，但观感没提升”的假完成。

## 6. 当前建议的默认口径

以后如果有人再问“项目是不是已经完全 OK 了”，建议直接回答：

> 工程上已经 OK，主链和 Phase 4 子链都已经接入并通过当前回归测试；但产品质量还在收口，尤其是 action sequence 的观感和稳定性，暂时不能说已经完全成熟。

## 7. 一眼判断版

给忙的时候快速看：

- `能不能跑：能`
- `主链是不是通的：是`
- `Phase 4 是不是只是 PPT：不是，已经接入代码和测试`
- `是不是已经彻底收工：不是`
- `下一步重点：真实样例抽检 + sequence 调优 + 质量收口`
