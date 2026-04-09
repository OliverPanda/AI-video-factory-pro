# 镜头增强 Agent（Motion Enhancer）

本文档基于 `src/agents/motionEnhancer.js`，描述 Phase 2 中新增的镜头增强层。

## 职责

1. 接收 `rawVideoResults`，判断哪些镜头需要增强、哪些直接透传、哪些应跳过增强。
2. 对可增强镜头执行轻量 FFmpeg 规则增强。
3. 输出 `enhancedVideoResults`，供 `Shot QA v2` 做最终验收。

## 输入

- `rawVideoResults`
- `shotPackages`
- 可选的 `performancePlan` 相关语义，当前主要通过 `shotPackage.enhancementHints` 体现

## 输出

最小输出为 `enhancedVideoResults[]`，每个镜头至少包含：

- `shotId`
- `sourceVideoPath`
- `enhancementApplied`
- `enhancementProfile`
- `enhancementActions`
- `enhancedVideoPath`
- `durationAdjusted`
- `cameraMotionInjected`
- `interpolationApplied`
- `stabilizationApplied`
- `qualityDelta`
- `status`
- `error`

## 当前决策规则

### `skip_enhance`

出现以下情况直接跳过增强：

- 原始视频生成失败
- 没有 `videoPath`
- 上游 provider 没有返回可处理文件

### `pass_through`

出现以下情况直接透传：

- 视频本身可用
- `shotPackage.enhancementHints` 为空

### `enhance`

出现以下情况执行增强：

- 原始视频生成成功
- `shotPackage.enhancementHints` 非空

## 当前增强能力

Phase 2 MVP 目前采用轻量规则增强，不引入重型视觉模型。

默认增强路径：

- `encoding_normalization`
- `motion_smoothness_enhancement`

当前默认 FFmpeg 行为：

- `fps=24`
- `pix_fmt=yuv420p`

这层的目标是“把可用镜头再收一收”，不是把坏片强行修成可交付镜头。

## Artifact

对应 run package 目录：

- `09e-motion-enhancer`

当前主要落盘：

- `1-outputs/enhanced-video-results.json`
- `1-outputs/qa-summary.md`
- `2-metrics/motion-enhancer-metrics.json`
- `2-metrics/qa-summary.json`
- `manifest.json`

## 与上下游的关系

- 上游：
  - `Fallback Video Adapter` 输出 `rawVideoResults`
- 下游：
  - `Shot QA Agent` 消费 `enhancedVideoResults`
- 注意：
  - `Motion Enhancer` 不直接桥接 `videoResults`
  - 最终是否进入成片由 `Shot QA v2 + Director` 决定

## 不负责的内容

- 不负责重新生成失败镜头
- 不负责多 provider 路由
- 不负责多镜头连续性修复
- 不直接决定最终 compose 用哪一路视频

## 来源文件

- `src/agents/motionEnhancer.js`

## 相关文档

- [Agent 文档总览](README.md)
- [Agent 间输入输出关系图](agent-io-map.md)
- [表演规划 Agent（Performance Planner）](performance-planner.md)
- [合成 Agent（Video Composer）](video-composer.md)
