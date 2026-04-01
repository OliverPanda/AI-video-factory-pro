# 合成 Agent（Video Composer）

本文档基于 `src/agents/videoComposer.js`，聚焦最终视频合成阶段的真实实现，包括时间线规划、字幕生成、音轨预处理、FFmpeg 依赖和清理逻辑。

## 职责

1. 基于分镜、图像和音频结果生成一份可执行的合成计划。
2. 为对白生成 ASS 字幕文件，并保证字幕时间与镜头时长对齐。
3. 预处理每段音频或静音片段，先合成一条统一音轨，再交给 FFmpeg 输出最终视频。
4. 检查路径安全、FFmpeg 可用性和跨平台字幕字体可用性。

## 输入

- `shots`：分镜列表，至少包含 `id`、`dialogue`、`duration`。
- `imageResults`：图像结果数组，元素至少包含 `shotId`、`imagePath`、`success`。
- `audioResults`：音频结果数组，元素通常包含 `shotId`、`audioPath`。
- `outputPath`：最终 MP4 输出路径。
- `options`：当前实现里只透传，未实际参与主要合成分支。

## 输出

- 最终 MP4 文件。
- 与输出视频同名的 `.ass` 字幕文件。
- 中间阶段会短暂生成：
  - 图片 concat 清单
  - 音频切片目录
  - 音频 concat 清单
  - 预合成音轨

这些临时文件在合成结束后会被清理。

## 主流程

1. `checkFFmpeg` 先确认本机能调用 FFmpeg。
2. `assertSafeWorkspacePath` 校验输出路径必须位于工作区、`output/` 或 `temp/` 下。
3. `buildCompositionPlan` 将 `shots`、`imageResults`、`audioResults` 合并成计划数组。
4. `generateSubtitleFile` 根据 `dialogue` 和 `duration` 生成 ASS 字幕。
5. `prepareAudioTrack` 把每个镜头的音频归一化，不存在音频时补静音片段，再拼成一条总音轨。
6. `mergeWithFFmpeg` 用图片 concat 列表 + 预合成音轨 + ASS 字幕输出最终视频。
7. 清理 concat 清单和音频临时目录。

## 合成计划规则

`buildCompositionPlan` 会为每个可用镜头输出：

- `shotId`
- `imagePath`
- `audioPath`
- `dialogue`
- `duration`

关键规则：

- 图像不存在或 `success !== true` 的镜头会被直接丢弃。
- `duration` 会经过 `normalizeAudioDuration` 处理，非正数时最小回退到 `0.1` 秒。
- 图像和音频路径都必须通过 `assertSafeWorkspacePath` 校验。

## 字幕规则

- 字幕格式为 ASS。
- 仅在 `dialogue` 非空时生成字幕事件。
- 字幕时间轴完全按 `plan` 中的 `duration` 累加。
- 默认字体优先级：
  - Windows：`Microsoft YaHei`
  - macOS：`PingFang SC`
  - Linux：`Noto Sans CJK SC` / `WenQuanYi Micro Hei`
- 如果没有对白，也会生成一个最小可用的空 ASS 文件，避免后续滤镜引用失败。

## 音频规则

- 有音频时，使用 `normalizeAudioSegment` 转成单声道、48k 采样率，并通过 `apad` 补到镜头时长。
- 无音频时，使用 `createSilenceSegment` 生成静音片段。
- 所有分镜音频先合成一条 `mergedAudioPath`，最终视频阶段只接入这一条音轨。

这意味着当前实现的音频策略是“先规划，再统一拼轨”，而不是让最终视频阶段同时处理多段音频。

## FFmpeg 与安全约束

### 路径安全

`assertSafeWorkspacePath` 会拒绝：

- 空路径
- 含控制字符的路径
- 超出工作区、`output/`、`temp/` 的路径
- 在要求存在的场景下，不存在的文件路径

### 命令安全

- `escapeConcatPath` 用于 concat 清单里的文件路径转义。
- `escapeFilterPath` 用于字幕滤镜路径转义。
- `escapeAssText` 用于对白文本转义，避免 ASS 控制字符破坏字幕内容。

### FFmpeg 缺失时的表现

当前报错文案会明确提示：

- Windows 可用 `winget install Gyan.FFmpeg`
- 或访问 `https://ffmpeg.org/download.html`

## 常见问题

### 为什么最终阶段只接一条音轨

因为代码先把每个分镜音频归一化并拼成总音轨，这样最终合成阶段更稳定，也更容易确保和镜头时长一致。

### 为什么某些镜头没进最终视频

最常见原因是该镜头没有成功图像，`buildCompositionPlan` 会直接过滤掉没有 `imagePath` 或 `success` 失败的项。

### 为什么字幕和对白时长看起来不完全匹配真实语速

当前字幕时间轴基于分镜 `duration`，不是基于 TTS 音频的真实语速反推，所以当分镜时长设置不准确时，会出现轻微偏差。

## 不负责的内容

- 不负责生成图像、音频或分镜内容。
- 不负责任务状态管理和断点续跑。
- 不负责上传、发布或多平台导出策略。

## 来源文件

- `src/agents/videoComposer.js`

## 相关文档

- [Agent 文档总览](README.md)
- [视觉设计链路说明](visual-design.md)
- [导演 Agent 详细说明](director.md)
