# 角色资产生产级闭环

本闭环把角色一致性从一次性 prompt 约束升级为可审计、可版本化、可复用、可人工复核的生产资产治理。

## 新增运行产物

每次 run 会新增以下 agent 目录：

- `02b-character-ref-sheets/`：角色三视图参考纸，作为 canonical refs 的重要候选。
- `02c-character-asset-governance/`：角色资产治理报告，判断角色是否具备跨集复用条件。
- `11-cost-governance/`：成本治理报告，统计计划视频请求、回锚重生成、实际失败请求。
- `12-human-review-queue/`：统一人审队列，汇总资产治理、质量门禁和成本治理产生的人工决策点。

## 资产治理规则

角色治理报告会检查：

- 主角或长期复用角色是否绑定 `characterBibleId`。
- 角色是否具备 `canonical refs`、三视图、最佳帧等可复用参考。
- 临时角色是否被限制为单集局部资产。
- 每个角色的复用策略：`strong_bind`、`medium_bind`、`episode_local`。
- 资产血缘：本轮谁被评估、使用哪个版本、引用多少参考图。

关键文件：

- `character-asset-governance.json`
- `character-asset-governance.md`
- `asset-audit-log.json`
- `canonical-reference-summary.json`

## 质量评估与人审

`Consistency Checker` 仍负责自动质量门禁，输出 `pass / warn / block` 和 `regenStrategy`。

人审队列会合并：

- 主角缺资产 ID、缺 canonical refs 等资产治理问题。
- 一致性评分 warn/block、身份漂移、需要回锚重生成的镜头。
- 成本预算超限或失败请求过多。

> **双层记录说明**：一致性相关的 review items 分为两层——角色级 `quality_gate`（来自 reports，侧重"该角色是否通过质量门槛"）和镜头级 `shot_regeneration`（来自 needsRegeneration，侧重"该镜头是否已完成重生成"）。同一角色可能在两条记录中分别出现，这是有意为之的设计：角色级记录用于判断资产是否达标，镜头级记录用于跟踪重生成闭环，二者不可互相替代。

关键文件：

- `human-review-queue.json`
- `human-review-queue.md`

## 成本治理

成本治理默认是 advisory mode：超预算时进入 warn 和人审队列，不直接中断生产。

可配置项：

- `COST_MAX_VIDEO_REQUESTS`：单轮最大计划视频请求数，默认 `60`。
- `COST_MAX_REANCHOR_REGENERATIONS`：单轮最大回锚重生成次数，默认 `8`。
- `COST_MAX_FAILED_VIDEO_REQUESTS`：单轮最大失败视频请求数，默认 `5`。
- `COST_GOVERNANCE_ENFORCE=1`：开启后超预算会变成 block。

关键文件：

- `cost-governance-report.json`
- `cost-governance-report.md`
- `cost-governance-metrics.json`

## 总体 QA 汇总

`qa-overview.json` 会读取新增闭环 agent 的 QA summary。

排序策略：

- 硬阻断 agent 的 block item 优先。
- Director 显式传入的业务关键问题其次，例如 Preflight、Seedance 输入补全风险。
- 普通 warn item 最后展示，避免资产治理提示挤掉更紧急的交付风险。
