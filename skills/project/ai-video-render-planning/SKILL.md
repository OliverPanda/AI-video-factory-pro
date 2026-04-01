---
name: ai-video-render-planning
description: 用于规划 shots、音频、字幕和 FFmpeg 步骤如何合成为最终视频，或排查本项目渲染失败问题时。
---

# ai-video-render-planning

## 概述

这个 skill 记录项目最终视频合成流程背后的稳定规划规则。

它覆盖 composition plan 构建、音频归一化、字幕时间轴和 FFmpeg 排障边界，但不替代 `src/agents/videoComposer.js`。

## 什么时候使用

- 需要规划 `shots + imageResults + audioResults` 如何合成为最终视频
- 需要整理音频时间线和静音镜头策略
- 需要对齐字幕时间轴和画面节奏
- 需要排查 FFmpeg 合成失败、字体问题或路径问题

## 输入约定

- `shots`
- `imageResults`
- `audioResults`
- Final output path
- 环境变量中的视频设置（如果存在）：
  `VIDEO_WIDTH`、`VIDEO_HEIGHT`、`VIDEO_FPS`、`SUBTITLE_FONT`

## 输出约定

- composition plan，其中每个 shot 至少包含：
  - `shotId`
  - `imagePath`
  - `audioPath`
  - `dialogue`
  - `duration`
- 与规划时间轴对齐的 ASS 字幕文件
- 覆盖整条时间线的合并音轨
- 最终 MP4 视频

## 必须遵守的规则

- 合成开始前必须先验证 FFmpeg 可用性。
- 只有出图成功的 shots 才能进入 composition plan。
- 图像和音频路径必须位于允许的工作区根目录内。
- 缺失或非法 `duration` 应归一成一个大于 0 的小正数，而不是 0。
- 字幕时间轴应来自 composition plan，而不是只按原始剧本顺序推断。
- 缺失音频的镜头必须显式补静音，不能在时间线上留空洞。
- 音频片段在拼接前需要先归一格式。
- 最终合成时，视频轨来自图片 concat 流，音轨来自合并后的音频文件。

## 字幕规则

- 字幕文本必须正确转义 ASS 控制字符。
- 字幕事件时间应按 shot 顺序累加。
- 即使没有对白，也要生成最小可用的 ASS 文件。
- 字幕样式要保持项目默认的竖屏配置和中文字体优先逻辑。

## 音频规则

- 没有音频的镜头通过 `anullsrc` 生成静音。
- 已有音频应补齐到该 shot 的规划时长。
- 音频片段需要先通过 concat list 拼接，再进入最终 mux。
- 渲染结束后应清理临时 concat 文件和音频片段文件。

## FFmpeg 规则

- 当前运行时依赖 `fluent-ffmpeg` 和一个可访问的 `ffmpeg` 可执行文件。
- 当前渲染流程会用到：
  - 图片 concat demuxing
  - ASS 硬字幕
  - `libx264` 视频编码
  - AAC 音频输出
- 排障时建议按这三层顺序检查：
  1. render plan 和安全路径
  2. ffmpeg 可用性以及 codec/filter 支持
  3. 当前平台的中文字幕字体可用性

## 常见失败场景

- FFmpeg 缺失，或者不在 `PATH` 中
- 当前平台没有可用的目标字体
- 字幕路径转义不正确
- 音频 concat list 格式错误
- 某个 shot 的图片路径超出允许工作区
- 音频补齐或时长错误导致时间线错位

## 处理建议

- 在执行重型 FFmpeg 工作前，先验证 composition plan。
- concat 输入文件尽量使用确定性、可复查的临时文件。
- Windows 上字幕滤镜失败时，优先排查路径转义。
- 如果使用打包版 FFmpeg 二进制，要额外确认 codec 和 filter 支持情况。

## 不覆盖的内容

- Director 编排和重试策略
- FFmpeg 二进制的外部打包方案
- 平台部署自动化

## 来源文件

- `src/agents/videoComposer.js`
- `README.md`
