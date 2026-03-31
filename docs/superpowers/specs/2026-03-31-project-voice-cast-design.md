# Project Voice Cast Design

**Goal:** 为 AI Video Factory Pro 增加“项目级声音库 + 分集角色选声”能力，使配音决策权从 `.env` 默认音色迁移到 `EpisodeCharacter -> voicePresetId`，同时为后续“试听、筛选、沉淀声音资产”保留清晰演进路径。

## Problem Statement

当前系统里的配音决策仍然偏全局兜底：

- `ttsAgent` 主要根据 speaker 的 `gender` 做选择
- `ttsApi` 再使用 `.env` 中的默认讯飞发音人

这对功能验证足够，但不适合连续剧、多角色、项目间差异明显的生产场景。主要问题是：

- 不同项目里的角色配音风格无法隔离
- 同一项目中的多个女性角色、多个男性角色容易共用一个默认声线
- 配音选择没有沉淀为可复用的项目资产
- 后续如果要做“试听、筛选、角色选声”，当前模型没有稳定落点

因此，需要把“角色该用哪个声音”的决策从 `.env` 提升到项目内容模型里，并且让声音本身能沉淀为项目级资产。

## Design Decision

本次设计确定采用：

```text
EpisodeCharacter -> voicePresetId -> VoicePreset
```

也就是：

- `EpisodeCharacter` 只保存所选声音资产的引用
- `VoicePreset` 作为项目级独立对象存在
- `.env` 只保留平台默认兜底值，不再承载项目角色差异

这比“直接把 `voice/rate/pitch/volume` 塞进 `EpisodeCharacter`”更适合长期演进，因为后续的试听、标签、筛选、推荐都可以围绕 `VoicePreset` 做，而不需要污染角色实例。

## Design Principles

1. **角色实例做选择，不做参数堆积**
   `EpisodeCharacter` 负责表达“本集这个角色选了哪个声音”，不直接保存整套讯飞参数。

2. **声音库是项目级资产**
   一个项目会逐渐沉淀出自己的声音库，供不同分集角色复用。

3. **运行时保持简单**
   TTS API 只接受最终 `voice/rate/pitch/volume`，不参与角色决策。

4. **默认值继续存在，但降级为兜底**
   如果没有选 `voicePresetId`，系统仍可回退到 `.env` 的默认男女声，保证流程不断。

5. **为试听与筛选留接口**
   `VoicePreset` 从第一天起就按“可成长资产”设计，而不是临时配置片段。

## Proposed Data Model

### 1. EpisodeCharacter

在现有 `EpisodeCharacter` 上新增：

- `voicePresetId`

含义：

- 指向当前项目下某个 `VoicePreset`
- 表达“这一集里这个角色最终选择了哪个声音”

它不直接保存 `voice/rate/pitch/volume`，避免角色实例承担过多平台细节。

### 2. VoicePreset

新增项目级 DTO：

- `id`
- `projectId`
- `name`
- `provider`
- `voice`
- `rate`
- `pitch`
- `volume`
- `tags`
- `sampleAudioPath`
- `status`
- `createdAt`
- `updatedAt`

字段建议说明：

- `provider`
  初版固定为 `xfyun`
- `voice`
  讯飞发音人 ID
- `rate / pitch / volume`
  TTS 调用时直接透传的参数
- `tags`
  为后续筛选和推荐准备，例如 `young_female`、`cold`、`narrator`
- `sampleAudioPath`
  指向该声音资产的试听样本
- `status`
  例如 `draft / ready / archived`

### 3. Relationship

关系定义如下：

- 一个 `Project` 可以有多个 `VoicePreset`
- 一个 `EpisodeCharacter` 最多引用一个 `VoicePreset`
- 一个 `VoicePreset` 可以被多个 `EpisodeCharacter` 复用

## Storage Layout

建议将声音库存到项目目录下：

```text
temp/projects/<projectId>/
  project.json
  voice-presets/
    <voicePresetId>.json
  voice-presets/samples/
    <voicePresetId>.mp3
  scripts/
    <scriptId>/
      script.json
      episodes/
        <episodeId>/
          episode.json
```

这样做的好处：

- 声音库自然属于 `Project`
- 分集角色通过 `voicePresetId` 轻量引用
- 试听样本和配置都能沉淀在项目目录内

## Runtime Resolution Rules

运行时建议按以下顺序解析当前 speaker 的配音参数：

1. 找到当前镜头 speaker 对应的 `EpisodeCharacter`
2. 读取该角色的 `voicePresetId`
3. 在项目声音库中加载对应 `VoicePreset`
4. 将 `voice/rate/pitch/volume` 传给 `textToSpeech`
5. 若未命中 preset，则回退到 `.env` 默认音色

也就是优先级：

```text
EpisodeCharacter.voicePresetId
-> Project VoicePreset
-> .env 默认值
```

### `.env` 的新角色

本次设计后，`.env` 中的：

- `XFYUN_TTS_VOICE_FEMALE`
- `XFYUN_TTS_VOICE_MALE`
- 以及其他全局默认参数

仍然保留，但它们的职责明确降级为：

- 启动默认值
- 兜底回退
- 本地快速验证

不再用于表达项目级角色差异。

## Responsibilities by Layer

### `ttsApi.js`

只负责：

- 调用讯飞在线语音合成
- 吃最终 `voice/rate/pitch/volume`

不负责：

- 决定某个角色该用哪个声音
- 解释项目级角色配置

### `ttsAgent.js`

负责：

- 找出当前镜头的 speaker
- 找到对应 `EpisodeCharacter`
- 解析 `voicePresetId`
- 加载 `VoicePreset`
- 计算最终 TTS options

### `voicePresetStore`

负责：

- 读写项目级 `VoicePreset`
- 根据 `projectId + voicePresetId` 加载声音资产

### `EpisodeCharacter`

负责：

- 表达“这集这个角色选择了哪个声音”

## Future Voice Library Evolution

本次设计故意让 `VoicePreset` 从一开始就具备“资产化”的形态，原因是后续你明确希望支持：

- 快速试听
- 角色挑选声音
- 声音库沉淀

后续非常自然可以演进为：

1. 为每个 `VoicePreset` 生成标准试听样本
2. 给 `VoicePreset` 打标签
3. 提供项目内声音库浏览与选择
4. 让 `EpisodeCharacter` 通过 `voicePresetId` 复用既有声音

到那时，角色选声流程会变成：

```text
EpisodeCharacter -> 选择 VoicePreset -> 试听确认 -> 正式 TTS
```

这条路径和当前设计完全一致，无需推倒重来。

## Fallback and Error Handling

1. `EpisodeCharacter` 没有 `voicePresetId`
   - 不报错
   - 回退到 `.env` 默认男女声

2. `voicePresetId` 指向不存在的 preset
   - 记录 warning
   - 回退到 `.env` 默认男女声

3. `VoicePreset` 中某些参数缺失
   - 只透传存在的字段
   - 其余字段回退到讯飞默认值或全局默认值

4. `sampleAudioPath` 不存在
   - 不影响正式 TTS
   - 仅影响后续试听能力

## Non-Goals

本次设计不包括：

- 自动根据“反派 / 女主 / 老人 / 小孩”智能推荐声音
- 跨项目共享的全局声音市场
- 图形化试听和选择 UI
- 多 TTS provider 同时支持
- 在线校验某个讯飞发音人是否仍可用

## Recommendation

建议初版实现只做最小闭环：

1. 新增 `VoicePreset` 项目级模型和本地 store
2. 在 `EpisodeCharacter` 上新增 `voicePresetId`
3. `ttsAgent` 运行时按 `voicePresetId` 解析 TTS 参数
4. 未命中时回退到 `.env`

这样既满足“每个项目/每个角色配音不同”的核心诉求，也为后续“试听、筛选、沉淀声音资产”搭好了结构基础。
