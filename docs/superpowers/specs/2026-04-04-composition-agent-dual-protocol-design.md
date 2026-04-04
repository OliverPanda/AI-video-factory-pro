# 2026-04-04 Composition Agent Dual Protocol Design

## 1. Goal

将当前合成阶段从“只接受 repo 内部数组参数”的实现，升级为：

- 面向未来的平台级 `CompositionJob` 协议
- 同时兼容当前仓库已有的 legacy agent 输出协议

目标是既不打断当前 `director -> videoComposer` 主链，也为后续多项目、多运行时、多交付通道预留统一协议。

## 2. Design Summary

本次设计采用双层协议：

- 外层：平台协议
  - `composeFromJob(job, outputPath, options)`
- 内层：兼容协议
  - `composeFromLegacy(input, outputPath, options)`
- 旧入口兼容
  - `composeVideo(shots, imageResults, audioResults, outputPath, options)`

旧入口内部会转调 `composeFromLegacy(...)`。

## 3. Why This Design

当前仓库中，上游 agent 的真实输出已经稳定，但并不是平台级资产协议：

- `shots` 使用 `shot.id`
- `imageResults` / `audioResults` / `lipsyncResults` 通过 `shotId` 关联
- 字幕没有独立 asset，而是从 `dialogue` 现场生成
- 合成结果过去只返回 `outputPath`

如果直接强推平台协议，会要求上游所有 agent 同步改造，风险太高。

所以本次设计把“兼容映射层”定义为正式组件，而不是临时 glue code。

## 4. Compatibility Contract

### Legacy Source Protocol

当前兼容输入来自：

- `normalizedShots`
- `imageResults`
- `audioResults`
- `animationClips`
- `lipsyncResults`
- `ttsQaReport`
- `lipsyncReport`

### Mapping Rules

- `shot.id -> shotId`
- shots 原始顺序 -> `order`
- `duration || durationSec || 3` -> `durationMs`
- `dialogue -> inline subtitle source`
- `speaker -> speakerId`
- `imagePath -> visual asset`
- `audioPath -> audio asset`
- `animation videoPath -> animation clip`
- `lipsync videoPath -> lipsync clip`

### Subtitle Policy

V1 默认允许没有 `subtitle asset`。

规则：

- 若无 `subtitleRef`，使用 `shot.dialogue`
- 若未来存在 `subtitleRef`，则 `subtitleRef` 优先

## 5. Render And QA Policy

### Visual Priority

1. `lipsync clip`
2. `animation clip`
3. `static image`

### QA Gate

- `ttsQaReport.block` -> 直接 `blocked`
- `lipsyncReport.block` -> 直接 `blocked`
- `warn` -> 允许交付，但写入 `DeliveryReport.warnings`

### Delivery Metadata

最终交付报告应汇总：

- `manualReviewPlan.recommendedShotIds`
- `manualReviewShots`
- `fallbackCount`
- `fallbackShots`
- `downgradedCount`

## 6. Output Contract

合成结果统一为结构化对象：

- `status`
- `outputVideo`
- `report`
- `artifacts`

其中：

- `outputVideo.uri` 与旧 `outputPath` 等价
- `artifacts` 汇总现有 run package 产物，不改文件名

## 7. Non-Goals

本次设计不包含：

- 上游 agent 协议重构
- HLS/DASH/DRM
- 资产治理平台
- 云端对象存储发布实现细节

## 8. Success Criteria

满足以下条件即视为设计落地成功：

- 现有 `director -> composeVideo` 链路无回归
- composer 同时支持 legacy 输入和平台 job 输入
- 输出从字符串升级为结构化结果
- 当前 artifact 文件结构保持不变
- QA block/warn 规则能在 composer 层正确表达
