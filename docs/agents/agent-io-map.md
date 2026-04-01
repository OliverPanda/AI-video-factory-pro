# Agent 间输入输出关系图

本文档把当前工作流里 8 个 agent 的输入、输出、落盘位置和下游消费者串起来看，重点服务两个目的：

1. 快速理解整条 pipeline 到底怎么流转。
2. 审查“每个 agent 有没有留下可审计成果物”。

## 总览图

```mermaid
flowchart TD
    A[原始剧本 .txt / Project-Script-Episode] --> B[Director]
    B --> C[Script Parser]
    C --> D[Character Registry]
    D --> E[Prompt Engineer]
    E --> F[Image Generator]
    F --> G[Consistency Checker]
    G -->|needsRegeneration| B
    D --> H[TTS Agent]
    C --> H
    F --> I[Video Composer]
    H --> I
    C --> I
    I --> J[output/final-video.mp4]
```

## 分层关系

```text
输入层
- 原始剧本文件
- 已持久化的 project / script / episode 数据
- .env 平台配置
- VoicePreset 项目资产

编排层
- Director

内容生成层
- Script Parser
- Character Registry
- Prompt Engineer

资产生成层
- Image Generator
- TTS Agent

质检层
- Consistency Checker

交付层
- Video Composer
- output/
```

## 单 Agent 输入输出表

| Agent | 主要输入 | 主要输出 | 主要落盘位置 | 下游消费者 |
|------|------|------|------|------|
| Director | `scriptFilePath` 或 `projectId/scriptId/episodeId` | `outputPath`、`RunJob`、`AgentTaskRun` | `temp/<jobId>/state.json`、`temp/projects/.../run-jobs/`、`runs/<runId>/` | 全局编排 |
| Script Parser | `scriptText` | `title / characters / shots` | `01-script-parser/` | Character Registry、TTS、Video Composer |
| Character Registry | `characters + scriptContext + style` | `character-registry` | `02-character-registry/` | Prompt Engineer、Consistency Checker、TTS |
| Prompt Engineer | `shots + characterRegistry + style` | `prompts` | `03-prompt-engineer/` | Image Generator |
| Image Generator | `prompts + style + provider route` | `imageResults / KeyframeAsset refs` | `04-image-generator/` | Consistency Checker、Video Composer |
| Consistency Checker | `characterRegistry + imageResults` | `reports + needsRegeneration` | `05-consistency-checker/` | Director |
| TTS Agent | `shots + characterRegistry + voice presets` | `audioResults + voiceResolution` | `06-tts-agent/` | Video Composer |
| Video Composer | `shots + imageResults + audioResults + animationClips` | `final video`、compose artifacts | `07-video-composer/`、`output/` | 最终交付 |

## 详细流转

### 1. Director

输入：

- 原始剧本文件，或 `projectId + scriptId + episodeId`
- 运行选项，例如 `style`、`skipConsistencyCheck`

输出：

- 编排后的最终 `outputPath`
- `RunJob / AgentTaskRun`
- 一次分集运行对应的 auditable run package

关键落盘：

- 兼容模式缓存：`temp/<jobId>/state.json`
- 分集运行记录：`temp/projects/<projectId>/scripts/<scriptId>/episodes/<episodeId>/run-jobs/`
- 审计运行包：`temp/projects/<projectName>__<projectId>/scripts/<scriptTitle>__<scriptId>/episodes/<episodeDir>/runs/<runDir>/`

### 2. Script Parser

输入：

- `scriptText`

输出：

- `title`
- `characters`
- `shots`

关键落盘：

- `01-script-parser/0-inputs/source-script.txt`
- `01-script-parser/1-outputs/shots.flat.json`
- `01-script-parser/1-outputs/shots.table.md`

下游：

- `Character Registry` 读 `characters`
- `TTS Agent` 和 `Video Composer` 读 `shots`

### 3. Character Registry

输入：

- `characters`
- `scriptContext`
- `style`

输出：

- 统一角色档案数组
- `resolveShotParticipants / resolveShotSpeaker` 所需身份视图

关键落盘：

- `02-character-registry/1-outputs/character-registry.json`
- `02-character-registry/1-outputs/character-name-mapping.json`
- `02-character-registry/2-metrics/character-metrics.json`

下游：

- `Prompt Engineer`
- `Consistency Checker`
- `TTS Agent`

### 4. Prompt Engineer

输入：

- `shots`
- `characterRegistry`
- `style`

输出：

- `prompts`
- `promptSources`

关键落盘：

- `03-prompt-engineer/1-outputs/prompts.json`
- `03-prompt-engineer/1-outputs/prompt-sources.json`
- `03-prompt-engineer/3-errors/<shotId>-fallback-error.json`

下游：

- `Image Generator`

### 5. Image Generator

输入：

- `prompts`
- `style`
- provider route

输出：

- `imageResults`
- `KeyframeAsset` 风格结果对象

关键落盘：

- `04-image-generator/0-inputs/provider-config.json`
- `04-image-generator/1-outputs/images.index.json`
- `04-image-generator/2-metrics/image-metrics.json`
- `04-image-generator/3-errors/retry-log.json`

下游：

- `Consistency Checker`
- `Video Composer`

### 6. Consistency Checker

输入：

- `characterRegistry`
- `imageResults`

输出：

- `reports`
- `needsRegeneration`

关键落盘：

- `05-consistency-checker/1-outputs/consistency-report.json`
- `05-consistency-checker/1-outputs/flagged-shots.json`
- `05-consistency-checker/3-errors/<character>-batch-<n>-error.json`

下游：

- `Director`

说明：

- 当前这层只负责“角色外观一致性”
- 不负责完整的时序连贯性

### 7. TTS Agent

输入：

- `shots`
- `characterRegistry`
- `voicePresetLoader`

输出：

- `audioResults`
- `voiceResolution`

关键落盘：

- `06-tts-agent/0-inputs/voice-resolution.json`
- `06-tts-agent/1-outputs/audio.index.json`
- `06-tts-agent/1-outputs/dialogue-table.md`
- `06-tts-agent/3-errors/<shotId>-error.json`

下游：

- `Video Composer`

### 8. Video Composer

输入：

- `shots`
- `imageResults`
- `audioResults`
- `animationClips`

输出：

- `final-video.mp4`
- 合成计划与 FFmpeg 证据

关键落盘：

- `07-video-composer/1-outputs/compose-plan.json`
- `07-video-composer/1-outputs/segment-index.json`
- `07-video-composer/2-metrics/video-metrics.json`
- `07-video-composer/3-errors/ffmpeg-command.txt`
- `07-video-composer/3-errors/ffmpeg-stderr.txt`
- `output/<...>/final-video.mp4`

## 审计检查清单

如果要判断一次运行是否“每个 agent 都有成果物”，最小检查可以看：

```text
runs/<runDir>/
  manifest.json
  timeline.json
  01-script-parser/manifest.json
  02-character-registry/manifest.json
  03-prompt-engineer/manifest.json
  04-image-generator/manifest.json
  05-consistency-checker/manifest.json
  06-tts-agent/manifest.json
  07-video-composer/manifest.json
```

再进一步看每层的核心产物是否存在：

- 分镜表：`shots.table.md`
- 角色档案：`character-registry.json`
- Prompt 表：`prompts.table.md`
- 生图索引：`images.index.json`
- 一致性报告：`consistency-report.json`
- 声线解析：`voice-resolution.json`
- 合成计划：`compose-plan.json`

## 当前最关键的边界

为了避免职责混乱，当前建议把两个概念分开看：

- `Consistency Checker`
  - 角色外观一致性
- 未来可能新增的 `Continuity Checker`
  - 镜头动作衔接
  - 视线连续
  - 构图连续
  - 场面调度连贯性

这样工作流会更清楚，也更容易单独量化。

## 相关文档

- [Agent 文档总览](README.md)
- [导演 Agent 详细说明](director.md)
- [视觉设计链路说明](visual-design.md)
