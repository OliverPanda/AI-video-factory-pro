# 2026-04-07 Phase 4 Sequence QA 通过率优化设计

## 1. 目标

本轮目标固定为：

- 不优先追求“更多 sequence 发起”
- 优先提升“已经发起的 sequence”在 `Sequence QA` 中的通过概率
- 重点关注：
  - `entry_exit_mismatch`
  - `continuity_mismatch`

同时明确保留当前质量底线：

- 不放松 `coverage_invalid`
- 不放松 `provider_output_invalid`
- 不放松 `duration_mismatch`
- 不放松 `non_contiguous_coverage`

## 2. 问题定义

当前 Phase 4 已经具备：

- `Action Sequence Planner / Router / Generator / QA`
- `Seedance` sequence 默认主 provider
- `Video Composer` sequence 覆盖主路径

但“已发起 sequence”仍存在两个典型问题：

1. 上游 prompt / package 对“进出约束”和“连续性锁定”的表达仍偏弱
2. `Sequence QA` 对部分边界型 entry/exit 失败缺少“误杀收敛”机制

结果就是：

- provider 已经生成了看起来基本可用的 sequence
- 但由于进出锚点表达不够强，或者 evaluator 给出了保守失败
- 最终没有进入主 timeline

## 3. 设计原则

本轮固定采用“上游约束增强 + 下游误杀收敛”的组合方案。

### 3.1 上游优先

先提高 provider 生成出“更像连续镜头”的概率，而不是先放松 QA。

### 3.2 下游只减少误杀，不降低门槛

`Sequence QA` 只允许把少量“边界型、可疑但不应直接判死”的场景从 `fail` 收敛到：

- `manual_review`
- 或现有的 `fallback_to_shot_path`

不允许把明确坏片放过。

### 3.3 不扩系统边界

本轮不新增：

- 新 orchestrator
- 新 CLI
- 新 provider
- 新 timeline 层
- 新 sequence 类型

## 4. 改动范围

### 4.1 `Action Sequence Router`

增强 `sequenceContextSummary` 和 `providerRequestHints`，把以下信息显式写入 provider 输入上下文：

- `entryConstraint`
- `exitConstraint`
- continuity locks
- preserve elements
- camera flow handoff intent
- no-jump / no-reset 类硬约束

目标是把当前“可读摘要”提升成更像“镜头连续性协议”的文本。

### 4.2 `Seedance Video API`

升级 sequence prompt 组装顺序：

1. `visualGoal`
2. sequence type / sequence objective
3. entry anchor
4. exit anchor
5. continuity locks
6. preserve elements
7. camera motion / framing
8. reference tier
9. audio beat hints
10. hard continuity rules

目标不是引入复杂 DSL，而是把已有字段拼成更强的 sequence 指令。

### 4.3 `Sequence QA Agent`

保留当前硬门槛：

- 空文件 / 假文件 / ffprobe 失败
- 时长异常
- coverage 不合法
- 非连续 shot coverage

新增一个非常小的“soft mismatch”收敛口：

- 当 evaluator 显式给出 entry/exit 的软失败原因时
- 允许从 `fail` 收敛为 `manual_review`

默认行为仍保持不变：

- 普通 `entryExitCheck = fail` 仍然直接失败
- 只有显式 soft reason 才进入 `manual_review`

## 5. 验收标准

本轮通过的定义：

1. `Action Sequence Router` 输出中能看到更明确的 continuity / entry / exit 协议文本
2. `Seedance` 请求 prompt 中能看到更强的 sequence 连续性约束
3. `Sequence QA` 对普通硬失败保持原判
4. 新增的 soft mismatch 场景能进入 `manual_review`，而不是直接 `fail`
5. 相关 focused tests 与 Phase 4 回归仍然为绿

## 6. 非目标

本轮明确不做：

- 不提升 planned sequence 数量
- 不修改 composer 优先级
- 不改 bridge 子链策略
- 不做多人群战系统
- 不做语音驱动动作节拍闭环
