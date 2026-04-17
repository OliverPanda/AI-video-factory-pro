# Harness Engineering Retrofit Spec

**Goal:** 把当前漫剧生成系统改造成一个可观测、可回放、可调优的 agent harness，让每次 run 都能清楚回答“输入是什么、每一步推断了什么、哪里降级了、为什么失败、下一次该改哪”。

## Why This Change

当前项目已经有完整生产链路，但调优体验仍然偏“看日志猜问题”：

- 长链路阶段多，失败原因分散在多个 agent
- `manifest / qa-summary / metrics / errors` 已存在，但格式和粒度不统一
- 有些步骤会继续往下跑，导致成本浪费
- 相同问题会在不同模块里重复出现，例如身份绑定、provider 回退、QA 误放行

这个改造的目标不是重写业务链路，而是给现有链路补一个更强的 harness 外壳。

## Core Principles

1. **Execution Contract First**
   每个 agent 的输入、输出、错误和下一步建议都必须结构化。
2. **Observation Must Be Actionable**
   任何产物都要能直接回答“下一步做什么”。
3. **Guardrails Before Spend**
   关键失败必须尽早 stop，避免继续调用昂贵外部 API。
4. **Identity and Provider Must Be Explicit**
   角色身份和 provider 路由都必须可追踪，不能靠隐式猜测。
5. **Debuggability Over Cleverness**
   先让系统更容易查问题，再谈更复杂的自动化。

## Harness Layers

### 1. Contract Layer

把每个 agent 的输入输出统一成四类字段：

- `input_snapshot`
- `output_snapshot`
- `status`
- `next_actions`

目标：

- 同类 agent 的结果可以横向比较
- review 时不用进源码才能看懂
- 失败时能直接给 controller 一个可执行动作

### 2. Observation Layer

统一各 agent 的落盘结构，尽量对齐为：

- `manifest.json`
- `qa-summary.md`
- `qa-summary.json`
- `metrics.json`
- `errors/*.json`

目标：

- 让 `Director` 可以稳定聚合
- 让调优时可以按 run、按 agent、按阶段比较
- 让 shell/automation 能直接读取

### 3. Recovery Layer

统一错误恢复语义：

- 可重试
- 可降级
- 必须停止
- 需要人工介入

目标：

- 三视图失败、身份绑定失败、provider 失败、QA block 的处理方式一致
- 不再出现“失败了但还继续烧钱”的情况

### 4. Metrics Layer

统一调优指标：

- 每步成功率
- 每步重试次数
- 每步回退次数
- 每步成本风险
- 每步人工介入率

目标：

- 能知道哪个模块最不稳定
- 能知道哪个 prompt / provider / 规则最容易出问题
- 能支持持续回归比较

## First-Phase Scope

第一期只改造高价值主链，不碰无关模块：

1. `Director`
2. `runArtifacts`
3. `Character Registry`
4. `Character Ref Sheet Generator`
5. `Video Router`
6. `TTS Agent`
7. `Voice Cast Store`
8. `Bridge / Sequence QA` 的输出 envelope

## What Changes

### Director

`Director` 变成 harness controller：

- 统一收集每步输入输出快照
- 统一写 run-level summary
- 统一决定 stop / retry / continue
- 统一把 QA 结果聚合成最终 run verdict

### Agent Artifacts

每个 agent 的产物都要带一致的语义：

- 输入是什么
- 输出是什么
- 失败时建议下一步做什么
- 这个结果是 cached / regenerated / synthesized / skipped 中哪一种

### Guardrails

明确以下硬门槛：

- 三视图失败直接阻断后续出图 / 视频
- 身份绑定失败直接阻断资产回填
- 关键 QA block 阻断合成
- 昂贵 provider 调用前必须通过 preflight

### Observability

run 级别要能快速看出：

- 哪一步最常失败
- 哪个角色最常串
- 哪类镜头最常回退
- 哪个 provider 最容易超时或降级

## Non-Goals

本期不做：

- 重写现有业务流程
- 引入全新的队列系统
- 统一所有历史旧数据的永久迁移
- 改变项目的创作语义

## Success Criteria

如果改造成功，应该满足：

1. 任何一次 run 都能直接定位失败阶段。
2. 任何一次 QA 结果都能看出是否该 stop。
3. 任何一次 provider 回退都能知道原因。
4. 任何一次身份串错都能追到具体输入和中间产物。
5. 调 prompt 或 provider 时，能用 run-level 指标做横向比较。

## Implementation Strategy

建议顺序：

1. 先统一 observation / envelope
2. 再统一 Director 聚合逻辑
3. 再补关键 stop gate
4. 最后把 metrics 做成可比对结构

## Review Checklist

- [ ] 每个关键 agent 是否有统一的输入输出合同
- [ ] 每个关键 agent 是否有统一的 status / next_actions
- [ ] 每个关键 agent 是否能被 Director 聚合
- [ ] 三视图 / 身份 / provider / QA 的 stop gate 是否明确
- [ ] 是否可以用 run artifacts 快速回放一次失败

