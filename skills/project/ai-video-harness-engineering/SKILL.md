---
name: ai-video-harness-engineering
description: 用于重构、评审或扩展本项目的 Director harness、run artifacts、QA gate 与 provider contract，确保系统可观测、可回放、可调优。
---

# ai-video-harness-engineering

## 概述

这个 skill 记录本项目关于 harness engineering 的稳定规则。

它适用于改动 `Director`、`runArtifacts`、关键 agent 的 artifact envelope、stop gate、provider contract 和 run-level observability 时的设计与评审，不替代具体运行时代码。

## 什么时候使用

- 需要重构或扩展 `Director` 作为 harness controller 的职责
- 需要统一 agent artifact contract、status 语义、next actions 或 run-level summary
- 需要新增或调整 stop / retry / degrade / human-review 决策
- 需要接入新的视频 provider，或审查 provider 是否发生跨模型 fallback
- 需要评审某项改动是否真的提升了调试性、回放性和成本护栏

## 核心目标

- 每次 run 都能回答输入是什么、每一步输出了什么、哪里降级了、为什么失败、下一步该改哪
- 关键失败要尽早 stop，避免继续调用高成本外部 provider
- 角色身份、provider 路由和 QA verdict 必须可追踪
- 新增能力优先接到统一 contract，而不是在 `Director` 里堆分支

## 必须遵守的原则

- `Execution Contract First`
  每个关键 agent 都应有结构化的 `input_snapshot`、`output_snapshot`、`status`、`next_actions`
- `Observation Must Be Actionable`
  产物必须能直接支持调试、比较和恢复，而不是只能当日志看
- `Guardrails Before Spend`
  高成本步骤前必须通过 preflight 或 stop gate
- `Identity and Provider Must Be Explicit`
  身份绑定和 provider 选择必须显式，不允许靠隐式猜测
- `Debuggability Over Cleverness`
  先提升系统可诊断性，再引入更复杂自动化

## 当前仓库里的强约束

- `Director` 是 harness controller，不应退化回“只串流程、不聚合证据”的 orchestrator
- 关键 agent 的 artifact 目录应尽量统一为：
  - `manifest.json`
  - `qa-summary.md`
  - `qa-summary.json`
  - `metrics.json`
  - `errors/*.json`
- 三视图失败、身份绑定失败、关键 QA block、关键 provider preflight 失败时，应优先 stop，而不是继续烧钱
- 视频 provider 是 run-level contract
  当 `VIDEO_PROVIDER=seedance` 时，`shot / bridge / sequence` 都必须保持 `seedance`
- 不允许通过 alias 或 fallback 自动切到另一个视频模型
- 新视频 provider 应走 unified client / adapter / transport / config / contract test，而不是在 `Director` 里开特判分支

## 设计判断顺序

1. 先看这次改动是否改变了 agent contract
2. 再看 run artifacts 是否仍然可聚合、可比较、可回放
3. 再看 stop / retry / degrade / review 语义是否一致
4. 最后才看是否需要更复杂的 prompt、router 或 provider 逻辑

如果前 3 点没有站稳，不要先把问题归因到“模型质量”。

## 评审清单

- 每个关键 agent 是否保留统一输入输出合同
- `Director` 是否仍能稳定聚合 run-level summary 和 verdict
- 失败产物是否直接给出 next action，而不是只留原始报错
- 新 provider 是否通过 harness contract test，而不是靠旧模型别名偷跑
- QA block 是否真的阻断了高成本后续步骤
- run artifacts 是否足够支持自动化脚本做周回顾、回归比较和失败诊断

## 常见反模式

- 在 `Director` 里新增 provider 特判分支，而不补 adapter / contract
- 让不同 agent 用完全不同的状态词，导致 run summary 无法聚合
- 失败后继续往下调用高成本 API，只在最终 summary 里补一句失败
- 把身份漂移、provider 漂移、QA 误放行都留到日志里人工排查
- 改了 contract 但不补 `tests/runArtifacts.test.js` 或 `tests/videoProviderHarness.test.js` 这类 harness 回归测试

## 变更建议

- 改 artifacts 时，优先保持字段可横向比较，再考虑展示层格式
- 改 stop gate 时，优先明确失败分类和 next action
- 接新 provider 时，优先补 unified client 接口、配置映射和 contract test
- 改 prompt / agent 行为时，优先确认是否越过了 harness prompt boundary

## 推荐先读

- [2026-04-17-harness-engineering-retrofit-spec.md](D:/My-Project/AI-video-factory-pro/docs/superpowers/specs/2026-04-17-harness-engineering-retrofit-spec.md)
- [2026-04-27-harness-prompt-boundaries-spec.md](D:/My-Project/AI-video-factory-pro/docs/superpowers/specs/2026-04-27-harness-prompt-boundaries-spec.md)
- [videoProviderHarness.test.js](D:/My-Project/AI-video-factory-pro/tests/videoProviderHarness.test.js)
- [runArtifacts.test.js](D:/My-Project/AI-video-factory-pro/tests/runArtifacts.test.js)

## 来源文件

- `docs/superpowers/specs/2026-04-17-harness-engineering-retrofit-spec.md`
- `docs/superpowers/specs/2026-04-27-harness-prompt-boundaries-spec.md`
- `tests/videoProviderHarness.test.js`
- `tests/runArtifacts.test.js`
