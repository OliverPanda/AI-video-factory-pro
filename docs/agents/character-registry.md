# 角色设定 Agent（Character Registry）

本文档基于 [src/agents/characterRegistry.js](/d:/My-Project/AI-video-factory-pro/src/agents/characterRegistry.js)，描述当前实现里角色设定 Agent 的真实职责、输入输出、产物与边界。

## 负责什么

1. 把剧本角色、主角色模板、分集角色实例整理成可复用的角色档案。
2. 为后续 Prompt、配音和一致性检查提供稳定的角色身份信息。
3. 在 LLM 漏掉角色时，用 source character 做保底合并，避免角色在后续链路里“消失”。

## 入口函数

- `buildCharacterRegistry(characters, scriptContext, style, deps)`
- `buildEpisodeCharacterRegistry(mainCharacterTemplates, episodeCharacters)`
- `resolveShotParticipants(shot, registry)`
- `resolveShotSpeaker(shot, registry)`
- `getShotCharacterTokens(shot, registry)`

## 输入

`buildCharacterRegistry` 的核心输入是：

- `characters`
  - 通常来自 `script.characters` 或 `episodeCharacters`
  - 至少包含 `name`
  - 可包含 `id`、`episodeCharacterId`、`mainCharacterTemplateId`、`gender`、`age`
- `scriptContext`
  - 当前剧本或分集的上下文摘要
- `style`
  - `realistic` 或 `3d`
- `deps.chatJSON`
  - 可注入的 LLM 调用，测试里常用
- `deps.artifactContext`
  - 可审计运行包上下文

## 输出

主输出是角色档案数组。单个角色通常会包含：

- `id`
- `episodeCharacterId`
- `mainCharacterTemplateId`
- `name`
- `gender`
- `age`
- `visualDescription`
- `basePromptTokens`
- `personality`
- `defaultVoiceProfile`

这些字段会被后续几层直接消费：

- `Prompt Engineer` 读取 `basePromptTokens` 和 `visualDescription`
- `TTS Agent` 读取 `gender`、`voicePresetId` 或 speaker 身份
- `Consistency Checker` 用 `name` 和视觉档案聚合同角色镜头

## 关键流程

1. 用 `CHARACTER_SYSTEM + prompt` 调 LLM，尝试为每个角色生成视觉描述。
2. 把 LLM 返回的 `generatedCharacters` 和输入的 `sourceCharacters` 做 `mergeCharacterSources(...)`。
3. 对没被 LLM 返回的角色，保留 source fallback，防止角色被丢失。
4. 输出角色档案，并在有 `artifactContext` 时落盘。

## 角色关系解析

除了“生成角色卡”，这份文件还负责运行时的角色关系解析：

- `buildEpisodeCharacterRegistry(...)`
  - 把 `MainCharacterTemplate` 和 `EpisodeCharacter` 合并成分集运行时角色
- `resolveShotParticipants(...)`
  - 优先读 `shot.shotCharacters`
  - 没有关系数据时回退到 `shot.characters`
- `resolveShotSpeaker(...)`
  - 优先读 `ShotCharacter.isSpeaker`
  - 再读 `shot.speaker`
  - 最后回退到第一个参演角色

这也是为什么 `TTS Agent` 和 `Prompt Engineer` 都依赖这里，而不是各自再做一套角色解析。

## 可审计成果物

当导演传入 `artifactContext` 时，会落这些文件：

- `1-outputs/character-registry.json`
- `1-outputs/character-registry.md`
- `1-outputs/character-name-mapping.json`
- `2-metrics/character-metrics.json`
- `manifest.json`

其中最关键的是：

- `character-name-mapping.json`
  - 能看出角色是 LLM 命中，还是 source fallback
- `character-metrics.json`
  - 包含覆盖率、fallback 数、缺 profile 数

## 常见问题

### 为什么角色卡和 `EpisodeCharacter` 不是一回事

`EpisodeCharacter` 更像运行时角色实例；`Character Registry` 是当前流程真正消费的统一角色视图。它把模板、分集实例和 LLM 生成描述压平成一层，方便后续 agent 使用。

### 为什么 LLM 少返回角色也不直接失败

因为一旦这里直接失败，后面的 Prompt、TTS、一致性检查都会断。当前实现更偏“稳运行”：宁可缺少详细视觉描述，也不让角色丢失。

### 这个 Agent 会不会决定角色最终配音

不会。它只负责角色身份和基础资料。真正的声线解析在 [tts-agent.md](tts-agent.md) 对应的 `TTS Agent`。

## 不负责的内容

- 不负责分镜拆解
- 不负责图像 Prompt 的镜头级拼装
- 不直接做一致性检查
- 不直接调用 TTS 或图像 API

## 相关文档

- [导演 Agent 详细说明](director.md)
- [视觉设计 Agent（Prompt Engineer）](prompt-engineer.md)
- [一致性验证 Agent（Consistency Checker）](consistency-checker.md)
- [配音 Agent（TTS）](tts-agent.md)
