# 2026-04-04 动态短剧升级 Phase 1 设计

## 1. 目标

本次 Phase 1 只解决一个核心问题：

- 将成片默认视觉主路径从 `imageResults` 切换为 `videoResults`

当前系统已经具备：

- `Director` 单一 orchestrator
- `image -> tts -> lipsync -> ffmpeg compose` 主链
- run artifact / state cache / resume-from-step 能力

但现状仍以静图为主，视频阶段更多是把静图、口型片段与音频拼接成成片，无法把“真实镜头生成”作为默认交付路径。

本次设计的目标是，在不推翻现有 orchestrator 与审计体系的前提下，把系统升级到：

- `image generator` 提供参考图/首帧
- `video generation` 成为默认主生产路径
- `video composer` 降级为后期总装层

## 2. 架构决策

### 2.1 保持单一调度中心

Phase 1 继续保留 `Director` 作为唯一 orchestrator，不引入第二个调度中心。

### 2.2 插入四个新模块

在当前链路中插入四个模块：

1. `Motion Planner Agent`
2. `Video Router Agent`
3. `Runway Video Agent`
4. `Shot QA Agent`

新的高层数据流固定为：

```text
scriptData / shotPlan
  -> imageResults
  -> motionPlan
  -> shotPackages
  -> videoResults
  -> shotQaReport
  -> videoComposer
```

### 2.3 image generator 与 video composer 的角色调整

`image generator` 在 Phase 1 中降级为：

- 参考图提供者
- 首帧资产提供者
- fallback 静图来源

它不再是默认交付视觉。

`video composer` 在 Phase 1 中固定为后期层：

- 选择最终进入时间线的视觉资产
- 合成音频、字幕和最终成片
- 生成交付报告与最终 artifact

## 3. 公共协议

### 3.1 motionPlan

新增 `motionPlan`，作为镜头级动态规划标准产物。

最小字段固定为：

- `shotId`
- `order`
- `shotType`
- `durationTargetSec`
- `cameraIntent`
- `cameraSpec`
- `videoGenerationMode`
- `visualGoal`

### 3.2 shotPackage

新增 `shotPackage`，作为镜头生成标准件。

最小字段固定为：

- `shotId`
- `shotType`
- `durationTargetSec`
- `visualGoal`
- `cameraSpec`
- `referenceImages`
- `preferredProvider`
- `fallbackProviders`
- `audioRef`
- `qaRules`

### 3.3 videoResults

新增 `videoResults`，作为进入 composer 的视频主通道。

最小字段固定为：

- `shotId`
- `preferredProvider`
- `provider`
- `status`
- `videoPath`
- `outputUrl`
- `taskId`
- `targetDurationSec`
- `failureCategory`
- `error`
- `errorCode`
- `errorStatus`
- `errorDetails`

### 3.4 shotQaReport

新增 `shotQaReport`，用于镜头级工程验收。

最小字段固定为：

- `status`
- `entries`
- `plannedShotCount`
- `passedCount`
- `fallbackCount`
- `fallbackShots`
- `warnings`
- `blockers`

`entries[]` 最小字段固定为：

- `shotId`
- `qaStatus`
- `canUseVideo`
- `fallbackToImage`
- `reason`
- `durationSec`
- `targetDurationSec`

## 4. 固定优先级

`Director` 传给 `videoComposer` 的视觉优先级固定为：

1. `videoResults`
2. `lipsyncResults`
3. `animationClips`
4. `imageResults`

## 5. 模块边界

### 5.1 Motion Planner Agent

输入：

- `scriptData`
- `shotPlan`
- continuity 上下文

输出：

- `motionPlan.json`

边界：

- 只负责镜头规划
- 不直接调用外部视频 provider
- Phase 1 先做确定性规则版本，不引入复杂 LLM 创作

`shotType` 最少覆盖：

- `dialogue_closeup`
- `dialogue_medium`
- `fight_wide`
- `insert_impact`
- `ambient_transition`

### 5.2 Video Router Agent

输入：

- `motionPlan + imageResults + promptList`

输出：

- `shotPackages.json`

边界：

- 负责组装 provider request 所需的标准件
- 不直接向 provider 发请求
- Phase 1 的主 provider 固定为 `Runway`
- 协议层允许未来扩展 `Veo / Luma`，但本次不落地

### 5.3 Runway Video Agent

输入：

- `shotPackage`

输出：

- `videoResults`

边界：

- 只实现 Phase 1 的 `image-to-video`
- 支持异步提交、轮询、下载与错误分类
- 不覆盖多角色 Act-Two 高复杂表演

错误分类固定至少区分：

- `provider_auth_error`
- `provider_rate_limit`
- `provider_timeout`
- `provider_invalid_request`
- `provider_generation_failed`

### 5.4 Shot QA Agent

输入：

- `videoResults`

输出：

- `shotQaReport`

边界：

- 只做结构化工程验收
- 不做昂贵视觉评分模型
- 显式记录 fallback

Phase 1 验收规则固定为：

- 文件存在
- 文件非空
- `ffprobe` 可读
- 时长不为 0
- 时长与目标时长偏差在阈值内
- provider 未返回空文件或错误文件

## 6. Artifact 设计

新增 agent run 包目录：

- `09a-motion-planner`
- `09b-video-router`
- `09c-runway-video-agent`
- `09d-shot-qa`

原 `videoComposer` 顺延为：

- `10-video-composer`

每个新 agent 都必须遵循既有 auditable artifact 规则：

- `0-inputs`
- `1-outputs`
- `2-metrics`
- `3-errors`

`Director` 的 run summary 新增字段：

- `planned_video_shot_count`
- `generated_video_shot_count`
- `video_provider_breakdown`
- `fallback_video_shot_count`

## 7. 失败与续跑

续跑仍然是 step 级，不升级为 shot 级 CLI。

但内部状态必须缓存：

- `motionPlan`
- `shotPackages`
- `videoResults`
- `shotQaReport`

续跑规则固定为：

- `resume-from-step --step=compose` 必须保留 `videoResults`
- `resume-from-step --step=video` 只清掉视频生成及其后续状态
- `Runway` 单镜头失败时允许同 shot 内部重试
- 若仍失败，必须标注 `failed_provider` / 失败分类，并由 `Director` 统一决定是否 fallback 到静图

## 8. 非目标

本次 Phase 1 明确不做：

- `performance agent`
- `bridge shot agent`
- `Veo` 真接入
- 多角色 Act-Two 自动化
- `resume-from-shot`
- 成本预算系统

## 9. 成功标准

满足以下条件即视为 Phase 1 设计达标：

- `Director` 仍是唯一 orchestrator
- 成片主视觉优先使用 `videoResults`
- `image generator` 成为参考图/首帧层，而不是默认交付层
- `video composer` 成为后期总装层
- 新 agent 全部进入现有 artifact / QA / resume 体系
- 没有 `RUNWAY_API_KEY` 或视频生成失败时，系统仍可显式 fallback 到静图路径继续交付
