# 2026-04-05 动态短剧升级 Phase 4 设计：Action Sequence 连续动作段 MVP

## 1. 目标

Phase 4 的目标不是继续横向扩张整条生产线，而是集中解决一个已经在 Phase 2 与 Phase 3 验收后依然明显存在的问题：

- 单镜头更像镜头了
- 镜头之间也开始有 bridge 过门了
- 但一到“连续追逐、连续打斗、连续转身、连续冲刺”这类动作段，成片仍容易碎成多个 clip，缺少真正一气呵成的连续动作感

Phase 1 已经完成：

- `videoResults` 进入成片默认主路径
- `Director`、artifact、resume、测试、文档闭环

Phase 2 已经完成：

- 单镜头从“能播”推进到“更像镜头”
- 引入 `Performance Planner`
- 引入 `Motion Enhancer`
- `Shot QA` 升级为双层验收

Phase 3 已经完成：

- 新增 `bridge shot` 子链
- 高风险 cut 点开始有过门与承接
- 成片不再只依赖生硬硬切完成叙事

但即使到 Phase 3，当前系统仍存在一个核心短板：

- 多个连续动作 shot 仍然是“多个镜头 + 若干 bridge”拼起来的
- 系统还没有把“一整段动作”当成一等公民来规划、生成和验收

因此，Phase 4 MVP 的核心目标固定为：

- 保留当前 `Director` 单一 orchestrator
- 不推翻 Phase 1~3 已完成的主链与子链
- 在现有 `shot` 主链之上新增一条 `action sequence` 子链
- 只对“高价值连续动作段”优先生成整段连续素材
- 让成片在连续打斗、追逐、冲刺、转场动作上明显更像真实连续镜头，而不是多个动态 clip 的拼接

本阶段成功标准固定为：

> 连续动作段默认优先消费通过 QA 的 `sequence clips`，而不是只能依赖“单镜头 clip + bridge shot”完成动作叙事。

## 2. 范围

### 2.1 本阶段要解决什么

Phase 4 MVP 只优先解决：

- 连续动作段的整体生成
- 多 shot 动作承接
- 单段内的连打、连追、连移动、连转身
- 同一连续动作段内的运镜流向保持
- 同一连续动作段内的主体、空间、动作目标的连续性

优先覆盖的动作段类型固定为：

- `fight_exchange_sequence`
- `chase_run_sequence`
- `escape_transition_sequence`
- `impact_followthrough_sequence`
- `dialogue_move_sequence`

这里的“sequence”指的是：

- 由 `2~5` 个原始 shot 组成
- 它们在脚本、动作目标、时空关系上本来就属于一段连续动作
- 如果仍按完全离散 shot 生成，会明显削弱观感

### 2.2 本阶段明确不做什么

Phase 4 MVP 明确不做：

- 全片 sequence 化生成
- 多人群战智能调度闭环
- 语音驱动动作节拍闭环
- 第二个 orchestrator
- 第二套正式 runtime
- sequence 级 CLI 续跑
- provider 智能成本系统
- 昂贵视觉评分模型
- 把 sequence 生成为“万能兜底层”

说明：

- `多人群战编排`
- `表演节奏与语音联动`

这两类能力在 Phase 4 只预留协议字段和后续扩展位，不纳入本阶段必做闭环。

## 3. 架构决策

### 3.1 保持单一调度中心

Phase 4 继续保留 `Director` 作为唯一 orchestrator，不引入第二个调度中心。

### 3.2 采用“现有主链 + action sequence 子链”模式

Phase 4 不重写 Phase 2 的视频主链，也不替代 Phase 3 的 bridge shot 子链。

当前已存在的主路径保持为：

```text
motionPlan
-> performancePlan
-> shotPackages
-> rawVideoResults
-> enhancedVideoResults
-> shotQaReportV2
-> videoResults
-> bridgeShotPlan
-> bridgeShotPackages
-> bridgeClipResults
-> bridgeQaReport
-> videoComposer
```

Phase 4 新增的不是一条新主运行时，而是一条按需触发的 `action sequence` 子链：

```text
continuity / performance / bridge context
-> action sequence planning
-> action sequence packages
-> sequence clip generation
-> sequence QA
-> final timeline stitching
```

也就是说：

- 普通镜头继续走 Phase 2
- cut 点桥接继续走 Phase 3
- 只有 `Director` 判断某一段 shot 明显属于连续动作段时，才触发 `action sequence`
- `videoComposer` 最终仍只消费统一时间线资产

### 3.3 最小增量升级原则

Phase 4 的默认原则固定为：

- 复用现有 `Runway` 主链、目录结构、state cache、artifact 和 resume 机制
- 尽量在现有 `Shot QA -> Bridge QA -> Composer` 之间插入 sequence 层
- 不把 sequence 做成独立项目模式
- 不要求 composer 直接理解 sequence 规划逻辑
- 不在 MVP 阶段接入新 provider 作为正式主路径

### 3.4 与 Seedance 路线的借鉴边界

从公开资料看，字节/Seedance 的关键思路是：

- 把 `sequence` 当成一等公民，而不是只优化单个 shot
- 强依赖参考素材与多模态条件
- 强调续拍、延拍、镜头段级连续性

Phase 4 MVP 只吸收其中最适合当前仓库的最小增量部分：

- 在协议层正式引入 `action sequence`
- 显式传入多 shot 的连续性约束
- 优先让系统具备“按动作段生成”的能力

Phase 4 不尝试复现 Seedance 全量能力，不承诺原生音视频联合生成，也不承诺真正的 sequence-native foundation model。

## 4. 模块边界

### 4.1 Action Sequence Planner Agent

输入：

- `scriptData`
- `shotPlan`
- `motionPlan`
- `performancePlan`
- `shotQaReportV2`
- `bridgeQaReport`
- `videoResults`
- continuity 上下文

输出：

- `actionSequencePlan.json`

边界：

- 只负责识别哪些 shot 应被并为一个连续动作段
- 只负责决定 sequence 类型、时长、动作目标、进出约束和连续性目标
- 不直接调用视频 provider
- Phase 4 MVP 先做规则驱动版本，不要求复杂导演式 LLM 创作

### 4.2 Action Sequence Router Agent

输入：

- `actionSequencePlan`
- `imageResults`
- `videoResults`
- `bridgeClipResults`
- `performancePlan`

输出：

- `actionSequencePackages.json`

边界：

- 负责把 sequence 规划组装成 provider request
- 负责选择参考图、参考视频、桥接参考和前后帧提示
- 负责做能力感知路由
- 不直接向 provider 发请求

### 4.3 Sequence Clip Generator Agent

输入：

- `actionSequencePackage`

输出：

- `sequenceClipResults`

边界：

- 负责生成连续动作视频段
- MVP 默认优先复用现有 provider 能力
- 不替代普通镜头视频生成链路
- 失败时不阻断整轮交付

### 4.4 Sequence QA Agent

输入：

- `sequenceClipResults`
- `videoResults`
- `bridgeClipResults`
- `from/to shot` 参考资产

输出：

- `sequenceQaReport`

边界：

- 负责判断 sequence clip 是否可作为主素材覆盖一段 shot
- 先做工程验收 + 连续性验收
- 不做昂贵视觉评分模型
- 失败时回退到 `videoResults + bridgeClips`

### 4.5 Video Composer Phase 4 兼容边界

`videoComposer` 在 Phase 4 中仍固定为后期层。

它不直接理解 sequence 规划逻辑，只接收：

- 主镜头 timeline
- bridge clip timeline
- sequence clip timeline 覆盖信息

最终由 `Director` 决定是否把 `sequence clip` 覆盖写入时间线。

## 5. 公共协议与数据结构

### 5.1 actionSequencePlan

用于表达“哪些原始 shot 要作为一个连续动作段来生成、为什么、目标是什么”。

每个 entry 的最小字段固定为：

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

字段说明：

- `shotIds` 固定表示该连续动作段覆盖的原始 shot 列表
- `entryConstraint` 表示 sequence 进入时必须承接的姿态、方位或动作
- `exitConstraint` 表示 sequence 结束时必须落到的姿态、方位或动作
- `fallbackStrategy` 固定用于描述 sequence 失败后是否回退到原始 shot + bridge 路径

### 5.2 actionSequencePackage

用于向 provider 发送标准化连续动作段请求。

最小字段固定为：

- `sequenceId`
- `shotIds`
- `durationTargetSec`
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

字段说明：

- `referenceImages` 主要来自 `imageResults`
- `referenceVideos` 主要来自已通过 QA 的 `videoResults`
- `bridgeReferences` 主要来自可复用的 `bridgeClipResults`
- `audioBeatHints` 在 Phase 4 只预留协议，不要求生成端一定消费

### 5.3 sequenceClipResults

用于记录连续动作段的生成结果。

最小字段固定为：

- `sequenceId`
- `status`
- `provider`
- `model`
- `videoPath`
- `coveredShotIds`
- `targetDurationSec`
- `actualDurationSec`
- `failureCategory`
- `error`

### 5.4 sequenceQaReport

用于表达连续动作段验收结果。

最小字段固定为：

- `status`
- `entries`
- `passedCount`
- `fallbackCount`
- `manualReviewCount`
- `warnings`
- `blockers`

`entries[]` 最小字段固定为：

- `sequenceId`
- `coveredShotIds`
- `engineCheck`
- `continuityCheck`
- `durationCheck`
- `entryExitCheck`
- `finalDecision`
- `fallbackAction`
- `notes`

## 6. Sequence 识别与触发规则

Phase 4 MVP 不允许“默认所有镜头都生成 action sequence”。

只在下面 5 类情况触发 sequence：

### 6.1 fight_exchange_sequence

适用：

- 两到五个 shot 本质上属于同一轮交锋
- 动作起势、碰撞、后撤、回身之间应连续出现

例如：

- 挥刀 -> 格挡 -> 反击
- 出拳 -> 闪避 -> 追击

### 6.2 chase_run_sequence

适用：

- 多个 shot 只是同一段奔跑、追逐或冲刺的拆分
- 若离散生成会明显失去速度感

### 6.3 escape_transition_sequence

适用：

- 人物在短时间内完成转身、脱离、穿门、跨越障碍
- 这段位移本身就是叙事核心

### 6.4 impact_followthrough_sequence

适用：

- 冲击发生后需要连续展示受力、失衡、落地、回稳
- 单镜头拆开会让冲击显得假

### 6.5 dialogue_move_sequence

适用：

- 以对白为主，但人物和机位在一段内持续运动
- 例如边走边说、逼近施压、回廊对峙推进

## 7. 生成与路由策略

### 7.1 Phase 4 MVP 默认主 provider

Phase 4 MVP 默认仍优先复用当前主 provider，不引入第二套正式 runtime。

路由原则固定为：

- 能从已有 `imageResults + videoResults + bridgeReferences` 组织出足够参考时，优先走 sequence 生成
- 参考不足时允许不生成 sequence，保留原有主路径
- provider 请求失败时允许 sequence 内重试
- 多次失败后显式回退到 `videoResults + bridgeClips`

### 7.2 参考素材优先级

构建 `actionSequencePackage` 时，参考素材优先级固定为：

1. 已通过 QA 的 `videoResults`
2. 已通过 QA 的 `bridgeClipResults`
3. `imageResults`

### 7.3 覆盖策略

只有当 `sequenceQaReport.entries[].finalDecision === pass` 时：

- 该 `sequence clip` 才允许覆盖对应 `shotIds`
- composer 才不再逐个消费被覆盖的 shot video clips

如果 `finalDecision !== pass`：

- sequence clip 不进入主 timeline
- 对应 shot 继续走 `videoResults + bridgeClips` 旧路径

## 8. Artifact 与状态缓存

### 8.1 新增 artifact 目录

Phase 4 新增 agent run 包目录：

- `09k-action-sequence-planner`
- `09l-action-sequence-router`
- `09m-sequence-clip-generator`
- `09n-sequence-qa`

每个 agent 继续遵循已有 auditable artifact 规则：

- `0-inputs`
- `1-outputs`
- `2-metrics`
- `3-errors`

### 8.2 新增 state cache 字段

新增缓存字段：

- `actionSequencePlan`
- `actionSequencePackages`
- `sequenceClipResults`
- `sequenceQaReport`

### 8.3 Run summary 扩展字段

`Director` 在 run summary 中新增：

- `planned_sequence_count`
- `generated_sequence_count`
- `sequence_provider_breakdown`
- `sequence_fallback_count`

## 9. 失败与续跑策略

### 9.1 失败策略

Phase 4 失败策略固定为：

- 单个 sequence 失败，不阻断整轮交付
- sequence 工程校验失败，必须显式回退
- sequence 连续性校验失败，允许标记 `manual_review` 或回退
- 不允许失败的 sequence 直接污染主 timeline

最小失败类型至少区分：

- `provider_auth_error`
- `provider_rate_limit`
- `provider_timeout`
- `provider_invalid_request`
- `provider_generation_failed`
- `sequence_engineering_failed`
- `sequence_continuity_failed`

### 9.2 续跑策略

Phase 4 仍然坚持“step 级续跑”，不升级成 sequence 级 CLI。

小白话理解固定为：

- 用户仍然按“大步骤”续跑
- 系统内部可以缓存 sequence 成果物
- 用户不需要指定某个 `sequenceId` 单独重跑

因此：

- `resume-from-step --step=compose`
  - 不会清掉 `sequenceClipResults`
  - 不会清掉 `sequenceQaReport`

- `resume-from-step --step=video`
  - 会清掉 `actionSequencePlan`
  - 会清掉 `actionSequencePackages`
  - 会清掉 `sequenceClipResults`
  - 会清掉 `sequenceQaReport`
  - 并继续保持现有视频及其后续状态的清理逻辑

## 10. 明确不做与后续预留

### 10.1 本阶段明确不做

- 不做多人群战智能编排主链
- 不做语音驱动动作节拍主链
- 不做 sequence 级 CLI 续跑
- 不做新的 cost router
- 不做第二 orchestrator

### 10.2 对 Phase 5+ 的预留

虽然本阶段不做，但协议层与设计上允许未来接入：

- `multiCharacterBlocking`
- `combatFormationHints`
- `audioBeatHints` 真正参与生成
- `sequenceContinuationMode`
- 更强的 sequence-native provider

## 11. 测试计划

必须覆盖以下测试：

### 11.1 协议与规划

- `actionSequencePlan` 只在高价值连续动作段生成
- `actionSequencePlan` 字段完整
- `actionSequencePackage` 组装字段完整
- `audioBeatHints` 在协议层可保留但不强制生效

### 11.2 Sequence Generator

- 提交任务成功
- provider 失败分类正确
- 下载后文件校验失败可识别
- 空结果不会被当成有效 sequence

### 11.3 Sequence QA

- 合法 mp4 通过
- 空文件/伪文件失败
- 时长异常失败
- entry / exit 约束明显不符时失败
- fallback 被正确记录

### 11.4 Director / Composer 集成

- 有 `sequenceClips` 且 QA pass 时优先消费 sequence
- sequence QA fail 时回退到 `videoResults + bridgeClips`
- 被 sequence 覆盖的 shot 不再重复写入 timeline
- state cache 命中时不会重复生成

### 11.5 Resume

- `resume-from-step --step=compose` 保留 `sequenceClipResults`
- `resume-from-step --step=video` 只清 sequence 及后续视频状态

### 11.6 Acceptance

- 至少新增 1 个 production-style 测试样例
- 验证连续动作段最终来源于 `sequence clip`
- 验证 sequence 失败时仍可交付旧路径成片

## 12. 验收标准

Phase 4 MVP 工程验收通过应定义为：

- 主链已能识别连续动作段并生成 `actionSequencePlan`
- `Director` 已接入 sequence 子链并可写入状态缓存
- 通过 QA 的 `sequence clips` 能优先进入 timeline
- QA 失败时能显式回退到旧路径
- artifact、resume、测试、文档齐全

Phase 4 MVP 产品验收未承诺内容应明确写明：

- 真实动态表演质量仍取决于 provider 输出
- 多人群战复杂编排不在本阶段
- 语音与动作节拍的强联动不在本阶段
- 当前 `Sequence QA` 只做工程可用 + 连续性验收，不代表商用品质已达标

一句话口径固定为：

> Phase 4 完成的是“连续动作段主路径”的工程升级，不等于已经完成商用级群战表演系统。
