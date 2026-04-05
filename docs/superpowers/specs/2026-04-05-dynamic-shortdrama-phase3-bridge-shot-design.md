# 2026-04-05 动态短剧升级 Phase 3 设计：Bridge Shot 与镜头连续性

## 1. 目标

Phase 3 的目标固定为：

- 解决镜头与镜头之间“硬跳切、像拼 PPT”的连续性问题

Phase 1 已经完成：

- `videoResults` 进入成片默认主路径
- `Director`、artifact、resume、测试、文档闭环

Phase 2 已经完成：

- 单镜头主链从“能播”推进到“更像镜头”
- 新增 `Performance Planner`
- 新增 `Motion Enhancer`
- `Shot QA` 升级为双层验收

但即使 Phase 2 完成，当前系统仍存在一个明显短板：

- 单镜头可能更像视频镜头了，但镜头与镜头之间仍可能断裂、生硬、缺少过门

因此，Phase 3 MVP 的核心目标固定为：

- 保留当前 `Director + Runway` 主链
- 不重写 Phase 2 视频主路径
- 在少量高价值 cut 点上插入 `bridge shot` 子链
- 优先让成片“看起来更顺”，而不是优先追求桥接镜头本身很炫

本阶段的成功标准固定为：

> 镜头之间明显更顺，不再主要依赖生硬硬切完成连续叙事。

## 2. 范围

### 2.1 本阶段要解决什么

Phase 3 MVP 只优先解决：

- 镜头之间的视觉过渡
- 连续动作的承接
- 空间位移的过门
- 情绪推进的过门

只在“明显存在连续性风险”的 cut 点触发 `bridge shot`，而不是给所有镜头都插桥接。

### 2.2 本阶段明确不做什么

Phase 3 MVP 明确不做：

- 全镜头自动桥接
- 多桥段长链拼接系统
- 多角色群战桥接主线
- 语音驱动桥接表演
- shot 级 CLI 续跑
- 第二个 orchestrator
- 第二套主运行时
- 全量切换到社区工作流

## 3. 架构决策

### 3.1 保持单一调度中心

Phase 3 继续保留 `Director` 作为唯一 orchestrator，不引入第二个调度中心。

### 3.2 采用“主镜头链路 + 桥接子链”模式

Phase 3 不推翻当前 Phase 2 主链。

Phase 2 主链保持为：

```text
motionPlan
-> performancePlan
-> shotPackages
-> rawVideoResults
-> enhancedVideoResults
-> shotQaReportV2
-> videoResults
-> videoComposer
```

Phase 3 新增的不是第二条主链，而是一条按需触发的桥接子链：

```text
continuity analysis
-> bridge shot planning
-> bridge shot packages
-> bridge clip generation
-> bridge QA
-> final timeline stitching
```

也就是说：

- 普通镜头继续走 Phase 2
- 只有 `Director` 判断某两个镜头之间存在明显连续性风险时，才插入 `bridge shot`
- `videoComposer` 最终仍消费统一的时间线资产，只是 timeline 中会多出 bridge clip

### 3.3 最小增量升级原则

Phase 3 的默认原则固定为：

- 复用现有 `Runway` 主链与现有目录结构
- 复用现有 artifact / resume / QA / state cache 机制
- 尽量在现有 `Continuity Checker -> Director -> Composer` 之间插入桥接层
- 不在 MVP 阶段引入 ComfyUI、Wan、IPAdapter 等第二套正式运行时

## 4. 模块边界

### 4.1 Bridge Shot Planner Agent

输入：

- `scriptData`
- `shotPlan`
- `continuityReport`
- `motionPlan`
- `performancePlan`
- 前后镜头的已生成视觉资产

输出：

- `bridgeShotPlan.json`

边界：

- 只决定哪些 cut 点需要桥接
- 只决定桥接意图、桥接类型、桥接时长和桥接目标
- 不直接调用视频 provider

### 4.2 Bridge Shot Router Agent

输入：

- `bridgeShotPlan`
- `imageResults`
- `videoResults`
- `performancePlan`

输出：

- `bridgeShotPackages.json`

边界：

- 负责把桥接规划组装成 provider request
- 负责做能力感知路由
- 不直接向 provider 发请求

### 4.3 Bridge Clip Generator Agent

输入：

- `bridgeShotPackage`

输出：

- `bridgeClipResults`

边界：

- 负责生成桥接片段
- MVP 默认复用现有 `Runway` 接口能力
- 不替代普通镜头视频生成链路

### 4.4 Bridge QA Agent

输入：

- `bridgeClipResults`
- `fromShot / toShot` 参考资产

输出：

- `bridgeQaReport`

边界：

- 负责判断桥接镜头是否“接得上”
- 不做昂贵视觉评分模型
- 失败时回退为直接切或保守转场，不阻断整轮交付

### 4.5 Video Composer Phase 3 兼容边界

`videoComposer` 在 Phase 3 中仍固定为后期层。

它不直接理解桥接决策逻辑，只接收：

- 主镜头 timeline
- bridge clip timeline 插入点

最终由 `Director` 决定是否把 bridge clip 写进时间线。

## 5. 公共协议与数据结构

### 5.1 bridgeShotPlan

用于表达“某两个主镜头之间要不要桥接、桥什么、为什么桥”。

每个 entry 的最小字段固定为：

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

### 5.2 bridgeShotPackage

用于向 provider 发送标准化桥接请求。

最小字段固定为：

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

### 5.3 bridgeClipResults

用于记录桥接片段生成结果。

最小字段固定为：

- `bridgeId`
- `status`
- `provider`
- `model`
- `videoPath`
- `targetDurationSec`
- `actualDurationSec`
- `failureCategory`
- `error`

### 5.4 bridgeQaReport

用于表达桥接片段验收结果。

最小字段固定为：

- `status`
- `entries`
- `passedCount`
- `fallbackCount`
- `manualReviewCount`
- `warnings`
- `blockers`

`entries[]` 最小字段固定为：

- `bridgeId`
- `engineeringStatus`
- `continuityStatus`
- `transitionSmoothness`
- `identityDriftRisk`
- `cameraAxisStatus`
- `finalDecision`
- `decisionReason`

## 6. 桥接决策规则

Phase 3 MVP 不允许“默认所有 cut 都生成 bridge shot”。

只在下面 4 类情况触发桥接：

### 6.1 motion_carry

适用：

- 前镜头动作尚未完成
- 后镜头已经进入动作结果
- 中间缺少动作承接

例如：

- 起刀 -> 落刀
- 转身 -> 冲刺
- 跃起 -> 落地

### 6.2 camera_reframe

适用：

- 同主体连续存在
- 但景别或机位变化过猛

例如：

- 特写直接跳大全景
- 近景直接跳侧后位

### 6.3 spatial_transition

适用：

- 人物或叙事空间发生位移
- 但观众没有被“带过去”

例如：

- 回廊 -> 殿前广场
- 断桥 -> 祭坛

### 6.4 emotional_transition

适用：

- 情绪从 A 状态跳到 B 状态过猛
- 需要一个视觉过门去抬升情绪

例如：

- 压抑 -> 爆发
- 犹豫 -> 决绝

## 7. 官方方案与社区方案映射

### 7.1 官方能力对 Phase 3 的意义

当前最适合直接吸收进 Phase 3 MVP 的官方能力，是：

1. `Runway image-to-video`
   - 适合基础桥接档

2. `Runway / Veo 能力分层`
   - 适合做 bridge shot 的能力感知路由

3. `first and last keyframe`
   - 适合桥接镜头中的强连续性场景

官方能力对本系统的意义不是“全量切换模型”，而是：

- 在普通镜头仍按现有 Phase 2 路线走的前提下
- 仅对少量高价值桥接镜头启用更强约束能力

### 7.2 社区方案的核心启发

社区在 continuity / continuation 问题上的主流经验，核心都是：

- 用上一镜头末端参考
- 用下一镜头起始参考
- 生成中间过渡片段

这一路线已经被大量 ComfyUI / Wan 工作流验证是有效方向。

但社区也反复暴露出 3 个风险：

1. `identity drift`
   - 人物桥着桥着变脸、变衣服、变结构

2. `flash / flicker`
   - 前后帧过渡时出现闪帧、跳帧、突变

3. `camera axis break`
   - 视觉上接上了，但轴线和空间关系乱了

Phase 3 不把社区方案直接搬进主运行时，但要把这些风险吸收成：

- QA 规则
- fallback 策略
- 中长期路线

## 8. Phase 3 MVP 实现路线

### 8.1 两档桥接能力

Phase 3 MVP 固定为两档能力：

#### A. 基础桥接档

默认方案。

做法：

- 取 `fromShot` 末端参考
- 取 `toShot` 起始参考
- 用桥接 prompt 生成 1.5 到 3 秒桥接片段

适用：

- 情绪过门
- 景别重构
- 轻空间过渡

#### B. 强约束桥接档

只给高风险桥接使用。

做法：

- 路由到支持 `first and last keyframe` 的能力档
- 明确锁定起点和终点视觉
- 只要求中间过渡自然

适用：

- 主体身份必须强一致
- 前后镜头变化很大
- 直接硬切极不自然

### 8.2 默认 provider 策略

Phase 3 MVP 仍锁定当前官方主链，不引入第二套默认运行时。

默认路由口径：

1. 普通桥接 -> 继续走当前 Runway 主链
2. 高风险桥接 -> 走支持 first/last keyframe 的能力档
3. provider 不满足能力要求 -> 回退保守方案

## 9. QA 与 fallback 策略

### 9.1 工程可用验收

至少包含：

- 文件存在
- `ffprobe` 可读
- 时长不为 0
- 编码规格合法

### 9.2 连续性验收

至少包含：

- 起始画面能接上 `fromShot`
- 结束画面能接上 `toShot`
- 主体身份无明显漂移
- 轴线无明显跳反
- 无明显闪帧、黑帧、断裂

### 9.3 最终决策

Phase 3 bridge QA 的决策固定为：

- `pass`
- `fallback_to_direct_cut`
- `fallback_to_transition_stub`
- `manual_review`

其中 MVP 默认兜底应优先为：

- `fallback_to_direct_cut`

原则固定为：

> 桥接失败时，不能让桥接层把原本还能播的主链成片搞得更差。

## 10. Artifact 与状态设计

Phase 3 建议新增的 artifact 编号固定为：

- `09g-bridge-shot-planner`
- `09h-bridge-shot-router`
- `09i-bridge-clip-generator`
- `09j-bridge-qa`

新增状态缓存字段建议包括：

- `bridgeShotPlan`
- `bridgeShotPackages`
- `bridgeClipResults`
- `bridgeQaReport`

兼容约束固定为：

- 不废弃 `videoResults`
- `bridge clip` 通过 `Director` 写入最终 timeline
- `resume-from-step --step=compose` 不能清掉 bridge 结果
- `resume-from-step --step=video` 在 Phase 3 中建议清掉 bridge 相关状态

## 11. 测试与验收入口

Phase 3 MVP 的测试重点固定为：

1. 哪些 cut 点会被正确判定为需要桥接
2. bridge shot package 是否组装完整
3. bridge QA 是否能正确回退
4. composer 是否能正确插入 bridge clip
5. resume / artifact / fallback 不被破坏

建议测试包括：

- `tests/bridgeShotPlanner.test.js`
- `tests/bridgeShotRouter.test.js`
- `tests/bridgeClipGenerator.test.js`
- `tests/bridgeQaAgent.test.js`
- `tests/videoComposer.bridge.test.js`
- `tests/resumeFromStep.phase3.test.js`
- `tests/director.bridge.integration.test.js`

## 12. 成功标准

满足以下条件即可视为 Phase 3 MVP 达标：

- `Director` 仍是唯一 orchestrator
- bridge shot 只在高风险 cut 点触发
- 成片时间线能插入 bridge clip
- 桥接失败不会破坏原始主链交付
- 至少 1 个真实样例能证明镜头之间明显更顺
- `resume / artifact / tests / docs` 继续闭环

## 13. 中长期演进方案（Post-MVP Roadmap）

### 13.1 更强的桥接控制

后续可升级为：

- 更强的 first-last-frame 桥接
- 多候选桥接镜头排序
- 依据镜头类型的差异化桥接模板

### 13.2 多桥段连续性链路

MVP 只做单个 cut 点桥接。

中长期可扩展为：

- 三镜头连续桥接
- 一整段动作链的桥接优化
- 多个 cut 点协同规划

### 13.3 多角色动作桥接

当前 MVP 不优先做群戏。

中长期可扩展为：

- 双人对打桥接
- 三人以上群戏桥接
- 人物相对位置连续性建模

### 13.4 社区强控工作流并行支线

当前 MVP 不引入第二套正式运行时。

但中长期可以预留并行支线：

- ComfyUI continuity workflow
- Wan first-last-frame workflow
- 更强的 reference-based continuity pipeline

这些能力不应先进入默认主路径，而应先以实验性支线验证。

### 13.5 与语音 / 表演联动

中长期可把 bridge shot 与下列系统联动：

- TTS 节奏
- lip-sync 节点
- performance planner 的 action beats

最终目标是让桥接镜头不只是“接上”，而是“接得像表演的一部分”。

## 14. 参考资料

官方资料：

- Runway API Reference：<https://docs.dev.runwayml.com/api/>
- Runway API Getting Started：<https://docs.dev.runwayml.com/guides/using-the-api/>
- Runway Models：<https://docs.dev.runwayml.com/guides/models/>
- Runway Pricing：<https://docs.dev.runwayml.com/guides/pricing/>
- Runway Changelog（含 `veo3.1`、`first and last keyframe`、`Reference to Video`）：<https://docs.dev.runwayml.com/api-details/api_changelog/>
- ComfyUI ByteDance First/Last Frame Node：<https://docs.comfy.org/built-in-nodes/ByteDanceFirstLastFrameNode>
- ComfyUI Wan2.2 FLF2V Workflow：<https://docs.comfy.org/tutorials/video/wan/wan2_2>

社区经验参考：

- Reddit: Wan 2.2 best practices to continue videos：<https://www.reddit.com/r/comfyui/comments/1md7egt/wan_22_best_practices_to_continue_videos/>
- Reddit: Why do I get flashes doing first frame/end frame：<https://www.reddit.com/r/comfyui/comments/1lnczz2/why_do_i_get_flashes_doing_first_frameend_frame/>
- Reddit: continuity / first-last-frame workflow discussion：<https://www.reddit.com/r/comfyui/comments/1n2s2rk/>
