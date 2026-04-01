# 配音 Agent（TTS）

本文档基于 [src/agents/ttsAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/ttsAgent.js)，描述当前实现里配音 Agent 如何解析 speaker、套用 voice preset，并批量合成对白音频。

## 负责什么

1. 为有台词的分镜批量生成音频文件。
2. 根据 `ShotCharacter / shot.speaker / characters` 解析真正说话者。
3. 根据 `voicePresetId` 或性别默认值确定 TTS 参数。
4. 输出音频索引、声线解析表、失败证据与指标。

## 入口函数

- `generateAllAudio(shots, characterRegistry, audioDir, options)`

## 输入

- `shots`
  - 典型字段有 `id`、`dialogue`、`speaker`、`characters`、`shotCharacters`
- `characterRegistry`
  - 至少要能提供角色 `name` 和 `gender`
- `audioDir`
  - 音频落盘目录
- `options`
  - `projectId`
  - `voicePresetLoader`
  - `textToSpeech`
  - `artifactContext`

## 说话者解析优先级

当前实现的说话者解析顺序是：

1. `ShotCharacter.isSpeaker`
2. `shot.speaker`
3. 第一个参演角色

这套逻辑来自 [character-registry.md](character-registry.md) 中的 `resolveShotSpeaker(...)`。

## 声线解析优先级

当前实现的声线解析顺序是：

1. `speakerCard.voicePresetId + voicePresetLoader`
2. 如果 preset 加载失败，回退到 `gender`
3. 如果没有 speaker，也会兜底为 `female`

也就是：

- 项目级角色差异来自 `voicePresetId`
- `.env` 里的默认男女声只做兜底

## 输出

返回数组，单项通常包含：

- `shotId`
- `audioPath`
- `hasDialogue`
- `error`

同时内部还会构建 `voiceResolution`，用于审计和排查。

## 可审计成果物

传入 `artifactContext` 时，会落这些文件：

- `0-inputs/voice-resolution.json`
- `1-outputs/audio.index.json`
- `1-outputs/dialogue-table.md`
- `2-metrics/tts-metrics.json`
- `3-errors/<shotId>-error.json`
- `manifest.json`

其中：

- `voice-resolution.json`
  - 最重要
  - 能看出每个镜头最终用了谁说、什么性别、哪个 voice preset、是否走默认兜底
- `audio.index.json`
  - 记录生成结果索引
- `dialogue-table.md`
  - 适合人工快速核对角色、对白和声线

## 当前 metrics

- `dialogue_shot_count`
- `synthesized_count`
- `skipped_count`
- `failure_count`
- `default_voice_fallback_count`
- `unique_voice_count`
- `voice_usage`

这些指标已经足够回答几个关键问题：

- 有多少镜头真的合成了声音
- 有多少镜头只是因为没台词被跳过
- 默认兜底用了多少次
- 当前这集到底用到了哪些声线

## 失败策略

当前实现里，每个镜头都通过 `ttsQueue + queueWithRetry(...)` 执行。

如果某镜头失败：

- 会自动重试 3 次
- 最终失败不会炸掉整批 Promise
- 会把该镜头标成 failed
- 错误详情落到 `3-errors/<shotId>-error.json`

这是和图像生成 Agent 一样的“保住整批结果”策略。

## 常见问题

### 为什么 `voicePresetId` 不直接写在 `.env`

因为 `.env` 适合放平台默认值，不适合表达项目内角色差异。真正的角色声线选择属于项目数据，不属于环境变量。

### 为什么 `voice-resolution.json` 要单独落盘

因为“到底是谁在说、用了什么声线、是不是走了默认兜底”是最难从最终 mp3 倒推出来的信息，必须显式保存。

### 这个 Agent 会不会决定字幕内容

不会。字幕文本来自镜头本身，最终字幕文件由 [video-composer.md](video-composer.md) 生成。

## 不负责的内容

- 不负责角色模板生成
- 不负责图像和一致性检查
- 不负责视频合成

## 相关文档

- [角色设定 Agent（Character Registry）](character-registry.md)
- [导演 Agent 详细说明](director.md)
- [合成 Agent（Video Composer）](video-composer.md)
