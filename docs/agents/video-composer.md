# 合成 Agent（Video Composer）

本文档基于 `src/agents/videoComposer.js`，描述当前合成阶段的真实实现，以及 2026-04 的 Phase 2 视频主链收口方式。

## 职责

1. 接收已经准备好的镜头资产，生成可执行合成计划。
2. 在 `generated video clip > lipsync clip > animation clip > static image` 的优先级下选择最终视觉素材。
3. 生成 ASS 硬字幕，并把所有镜头音频拼成统一主音轨。
4. 用 FFmpeg 输出最终 MP4。
5. 输出结构化交付结果，同时保持现有 run package 审计产物不变。

## Phase 2 兼容策略

当前实现同时支持两种输入方式：

- 平台协议：
  - `composeFromJob(job, outputPath, options)`
- 兼容协议：
  - `composeFromLegacy(input, outputPath, options)`
- 旧入口兼容：
  - `composeVideo(shots, imageResults, audioResults, outputPath, options)`

其中旧入口现在只是兼容壳层，内部会转成 `composeFromLegacy(...)`。

## 为什么要有兼容层

当前仓库真实上游链路是：

- `scriptParser`
- `dialogueNormalizer`
- `imageGenerator`
- `ttsAgent`
- `ttsQaAgent`
- `lipsyncAgent`
- `director`

这些 Agent 已经有稳定输出，但不是平台级 `CompositionJob` 协议。因此合成阶段新增了 `LegacyComposeInputAdapter`，把现有协议显式映射成统一形状，而不是在实现里继续临时 `find(shot.id)` 拼接。

## 当前兼容输入

`composeFromLegacy(...)` 兼容当前仓库的主要输入：

- `shots`
  - 至少含 `id`、`dialogue`、`duration` 或 `durationSec`
- `imageResults`
  - 典型元素：`{ shotId, keyframeAssetId?, imagePath, success }`
- `audioResults`
  - 典型元素：`{ shotId, audioPath, hasDialogue? }`
- `videoResults`
  - 典型元素：`{ shotId, videoPath, durationSec?, status?, provider? }`
- `rawVideoResults`
  - Phase 2 内部使用，典型元素：`{ shotId, videoPath, targetDurationSec, variantIndex }`
- `enhancedVideoResults`
  - Phase 2 内部使用，典型元素：`{ shotId, enhancedVideoPath, enhancementApplied, enhancementProfile }`
- `animationClips`
  - 典型元素：`{ shotId, videoPath, durationSec? }`
- `lipsyncResults`
  - 典型元素：`{ shotId, videoPath, durationSec?, status?, qaStatus? }`
- `ttsQaReport`
- `lipsyncReport`

## 兼容映射规则

- `shot.id -> shotId`
- 原始 `shots` 数组顺序 -> `order`
- `shot.duration || shot.durationSec || 3` -> `durationMs`
- `shot.dialogue -> inline subtitle source`
- `shot.speaker -> speakerId`
- `imageResults[].imagePath -> visuals`
- `audioResults[].audioPath -> audios`
- `videoResults[].videoPath -> video clips(role=video)`
- `animationClips[].videoPath -> video clips(role=animation)`
- `lipsyncResults[].videoPath -> video clips(role=lipsync)`

注意：

- 当前系统没有独立 `subtitle asset`
- 所以 V1 默认用 `dialogue` 作为 inline subtitle source
- 如果未来引入 `subtitleRef`，应优先用外部字幕资产
- Phase 2 的 `rawVideoResults / enhancedVideoResults` 不应该直接传给 composer
- `Director` 会在 `Shot QA v2` 之后统一桥接最终 `videoResults`

## 平台协议入口

`composeFromJob(...)` 支持面向未来的平台级输入。当前它会把：

- `job.shots`
- `job.assets.visuals`
- `job.assets.audios`
- `job.assets.clips`

先适配回当前渲染逻辑可消费的形状，再复用原有 FFmpeg 合成路径。

这意味着：

- 现有合成核心没有被重写
- 只是增加了显式协议转换层

## QA 兼容规则

`composeFromLegacy(...)` 现在会读取上游 QA 状态：

- 如果 `ttsQaReport.status === "block"`，直接返回 `blocked`
- 如果 `lipsyncReport.status === "block"`，直接返回 `blocked`
- 如果任一是 `warn`，仍允许继续合成，但会进入交付报告

同时会合并这些信息进入最终报告：

- `manualReviewPlan.recommendedShotIds`
- `manualReviewShots`
- `fallbackCount`
- `fallbackShots`
- `downgradedCount`

## 合成计划规则

`buildCompositionPlan(...)` 生成的每个镜头计划包含：

- `shotId`
- `visualType`
- `imagePath` 或 `videoPath`
- `audioPath`
- `dialogue`
- `duration`

视觉优先级：

1. `generated_video_clip`
2. `lipsync_clip`
3. `animation_clip`
4. `static_image`

如果镜头没有任何可用视觉来源，就不会进入最终 plan。

Phase 2 口径补充：

- `videoComposer` 的外部心智不变，仍然只看 `videoResults`
- `videoResults` 可能来自增强后镜头，也可能来自未增强但通过 QA 的原始镜头
- 如果 `Shot QA v2` 判定镜头需 `fallback_to_image`，该镜头不会进入 `videoResults`

## 字幕规则

- 字幕格式为 ASS
- 默认硬字幕烧录
- 如果没有对白，会生成最小空 ASS 文件
- 当前字幕时间轴来自合成 plan 的镜头时长累加
- 当前没有独立 subtitle asset 时，不会单独读取字幕文件输入

## 音频规则

- 现有实现会先生成统一主音轨
- 最终视频阶段只挂一条音轨
- 无音频镜头不会主动补静音文件，而是通过时间线偏移和已有音频项混音

## 输出

当前不再只返回字符串路径，而是返回结构化结果：

- `status`
- `outputVideo`
- `report`
- `artifacts`

其中：

- `outputVideo.uri` 与旧 `outputPath` 语义等价
- `artifacts` 会汇总现有 run package 文件位置

## 审计产物

当前仍保留原有落盘文件：

- `1-outputs/compose-plan.json`
- `1-outputs/segment-index.json`
- `2-metrics/video-metrics.json`
- `3-errors/ffmpeg-command.txt`
- `3-errors/ffmpeg-stderr.txt`

新增的是：

- 这些文件会再被汇总为返回值里的 `ArtifactIndex`

## 不负责的内容

- 不负责生成上游图像、音频、口型片段
- 不负责生成 `performancePlan`
- 不负责增强 `rawVideoResults`
- 不负责决定 `rawVideoResults / enhancedVideoResults` 哪一路进入主交付
- 不负责播放包、HLS/DASH、DRM
- 不负责上传发布策略之外的资产治理

## 来源文件

- `src/agents/videoComposer.js`

## 相关文档

- [Agent 文档总览](README.md)
- [导演 Agent 详细说明](director.md)
- [表演规划 Agent（Performance Planner）](performance-planner.md)
- [镜头增强 Agent（Motion Enhancer）](motion-enhancer.md)
- [TTS Agent 详细说明](tts-agent.md)
