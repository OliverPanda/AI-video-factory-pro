# 2026-04-01 Auditable Workflow Design

## 1. Goal

将当前 AI 视频工作流从“能跑出结果的流水线”升级为“可审计的运行包工作流”。

本设计的目标不是增加更多 agent，也不是直接进入创作工作台，而是让一次运行具备以下能力：

- 每个 agent 都有清晰、稳定、可落盘的成果物
- 每个步骤都能回答“输入是什么、输出是什么、质量如何、失败在哪”
- `temp/` 中间过程对人类可读、对机器稳定
- `output/` 只承载最终交付物，不混入中间缓存和调试证据
- 测试从“函数通过”升级为“成果物契约通过”

## 2. Scope

### In Scope

- 重构 `temp/` 下的运行目录命名和层级
- 为每个 agent 建立固定的成果物契约
- 为每个 agent 建立最小量化指标集
- 为每次运行建立总清单、时间线和摘要
- 补充围绕中间成果物的结构契约测试与真实集成测试

### Out of Scope

- 人工挑图、人工试听、人工重跑 UI
- 跨项目角色库、声音库、分镜库资产治理
- 完整的长期资产工厂设计
- 新增新的创作型 agent

## 3. Problem Statement

当前 README 中已经把系统描述成一条多 agent 生产线，但实际落盘仍主要依赖以下内容：

- `temp/<jobId>/state.json`
- 零散的图片与音频文件
- 少量 FFmpeg 中间文件
- 最终视频文件

这带来几个核心问题：

1. 运行结果不可审计
   只能看到“这次有没有成功”，很难快速回答“每一步到底产出了什么”。

2. 失败证据不完整
   Prompt JSON 失效、生图 403/503、FFmpeg 失败等证据主要存在于终端日志，而非运行目录。

3. 成果物边界不清晰
   缓存、调试证据、中间产物、最终交付物混在一起，不利于人类理解，也不利于后续自动化。

4. README 与实际运行现实断层
   文档中每个 agent 都有明确职责，但磁盘上没有对应的、稳定可复盘的成果物体系。

5. 测试无法证明工作流真的“交付了成果物”
   现有测试大多证明函数行为和局部数据结构，无法证明某次流程运行是否形成了完整的运行包。

## 4. Design Principles

本设计遵循以下原则：

### 4.1 `temp/` 是运行证据库

`temp/` 承载：

- 中间过程
- 每个 agent 的输入输出
- 指标与错误证据
- 单次运行的可复盘审计包

### 4.2 `output/` 只承载最终交付

`output/` 不存放原始 prompt、失败日志、缓存图片、音频、FFmpeg 中间片段等，仅存放最终用户要拿走的内容。

### 4.3 命名必须人类可读且机器稳定

目录命名采用“可读名 + 稳定 ID”模式，而不是只有 hash/jobId，也不是只有中文标题。

### 4.4 每个 agent 的成果物是一等公民

agent 的价值不只体现在“被调用过”，还必须体现在“留下了可以检查、比较、复盘的产物”。

### 4.5 测试验证成果物，不只验证函数

测试必须覆盖：

- 成果物有没有落盘
- 产物结构是否满足契约
- 失败时是否留下证据

## 5. Directory Structure

建议将 `temp/` 组织为按项目、剧本、分集、单次运行分层的结构：

```text
temp/
  项目名__projectId/
    project.json
    scripts/
      剧本名__scriptId/
        script.json
        episodes/
          第01集__episodeId/
            episode.json
            runs/
              2026-04-01_170225__runJobId/
                manifest.json
                timeline.json
                summary.md
                01-script-parser/
                02-character-registry/
                03-prompt-engineer/
                04-image-generator/
                05-consistency-checker/
                06-tts-agent/
                07-video-composer/
```

### Naming Rules

- 项目目录：`项目名__projectId`
- 剧本目录：`剧本名__scriptId`
- 分集目录：`第01集__episodeId`
- 运行目录：`YYYY-MM-DD_HHMMSS__runJobId`

### Rationale

- 对人类：一眼可定位到“哪个剧组、哪一集、哪次运行”
- 对机器：保留稳定 ID，便于缓存、引用、比对、测试
- 对审计：同一集多次运行并存，方便比较不同 provider、不同参数或不同中转站分组的效果

## 6. Per-Agent Artifact Contract

每个 agent 目录都统一采用以下四类子目录：

```text
0-inputs/
1-outputs/
2-metrics/
3-errors/
```

并在 agent 目录根下放一个 `manifest.json`，用于快速说明该 agent 本次运行状态。

### 6.1 Script Parser

目录：`01-script-parser/`

必须落盘：

- `0-inputs/source-script.txt`
- `0-inputs/parser-config.json`
- `0-inputs/llm-request.json`
- `1-outputs/script-outline.json`
- `1-outputs/shots.flat.json`
- `1-outputs/shots.table.md`
- `1-outputs/characters.extracted.json`
- `2-metrics/parser-metrics.json`
- `3-errors/invalid-response-*.txt`

必须量化：

- `shot_count`
- `dialogue_shot_count`
- `silent_shot_count`
- `character_count`
- `total_duration_sec`
- `avg_shot_duration_sec`
- `fallback_used`
- `schema_validation_passed`

### 6.2 Character Registry

目录：`02-character-registry/`

必须落盘：

- `0-inputs/characters.raw.json`
- `0-inputs/story-context.txt`
- `0-inputs/llm-request.json`
- `1-outputs/character-registry.json`
- `1-outputs/character-registry.md`
- `1-outputs/character-name-mapping.json`
- `2-metrics/character-metrics.json`
- `3-errors/invalid-response-*.txt`

必须量化：

- `character_count`
- `registry_coverage_rate`
- `template_backed_count`
- `fallback_merged_count`
- `missing_profile_count`

### 6.3 Prompt Engineer

目录：`03-prompt-engineer/`

必须落盘：

- `0-inputs/shots.flat.json`
- `0-inputs/character-registry.json`
- `0-inputs/prompt-config.json`
- `1-outputs/prompts.json`
- `1-outputs/prompts.table.md`
- `1-outputs/prompt-sources.json`
- `2-metrics/prompt-metrics.json`
- `3-errors/shot_XXX-invalid-json.txt`
- `3-errors/shot_XXX-retries.json`

必须量化：

- `prompt_count`
- `llm_success_count`
- `fallback_count`
- `fallback_rate`
- `avg_prompt_length`
- `oversized_prompt_count`
- `invalid_json_count`

### 6.4 Image Generator

目录：`04-image-generator/`

必须落盘：

- `0-inputs/prompts.json`
- `0-inputs/provider-config.json`
- `1-outputs/images/shot_001.png`
- `1-outputs/images.index.json`
- `1-outputs/image-contact-sheet.jpg`
- `2-metrics/image-metrics.json`
- `3-errors/shot_XXX-error.json`
- `3-errors/shot_XXX-response.txt`
- `3-errors/retry-log.json`

必须量化：

- `request_count`
- `success_count`
- `failure_count`
- `success_rate`
- `avg_latency_ms`
- `avg_file_size_bytes`
- `retry_count`
- `http_403_count`
- `http_429_count`
- `http_503_count`

### 6.5 Consistency Checker

目录：`05-consistency-checker/`

必须落盘：

- `0-inputs/images.index.json`
- `0-inputs/character-registry.json`
- `1-outputs/consistency-report.json`
- `1-outputs/consistency-report.md`
- `1-outputs/flagged-shots.json`
- `2-metrics/consistency-metrics.json`
- `3-errors/llm-response-*.txt`

必须量化：

- `checked_shot_count`
- `flagged_shot_count`
- `avg_consistency_score`
- `regeneration_count`
- `post_regeneration_pass_rate`

### 6.6 TTS Agent

目录：`06-tts-agent/`

必须落盘：

- `0-inputs/shots.flat.json`
- `0-inputs/voice-resolution.json`
- `1-outputs/audio/shot_001.mp3`
- `1-outputs/audio.index.json`
- `1-outputs/dialogue-table.md`
- `2-metrics/tts-metrics.json`
- `3-errors/shot_XXX-error.json`

必须量化：

- `dialogue_shot_count`
- `synthesized_count`
- `skipped_count`
- `failure_count`
- `avg_audio_duration_sec`
- `total_audio_duration_sec`
- `voice_preset_usage`
- `default_voice_fallback_count`

### 6.7 Video Composer

目录：`07-video-composer/`

必须落盘：

- `0-inputs/compose-plan-input.json`
- `1-outputs/compose-plan.json`
- `1-outputs/subtitles.ass`
- `1-outputs/segments/`
- `1-outputs/segment-index.json`
- `1-outputs/final-video.mp4`
- `2-metrics/video-metrics.json`
- `3-errors/ffmpeg-command.txt`
- `3-errors/ffmpeg-stderr.txt`

必须量化：

- `planned_shot_count`
- `composed_shot_count`
- `dropped_shot_count`
- `final_video_duration_sec`
- `subtitle_count`
- `compose_duration_ms`
- `ffmpeg_first_pass_success`

## 7. Run-Level Manifest

每次运行目录根下新增三个统一文件：

- `manifest.json`
- `timeline.json`
- `summary.md`

### `manifest.json`

最小字段建议：

- `projectId`
- `scriptId`
- `episodeId`
- `runJobId`
- `projectName`
- `scriptTitle`
- `episodeTitle`
- `style`
- `providerSummary`
- `startedAt`
- `finishedAt`
- `finalStatus`
- `finalOutputPath`
- `stepStatus`

### `timeline.json`

记录每个步骤：

- `step`
- `agent`
- `status`
- `startedAt`
- `finishedAt`
- `durationMs`

### `summary.md`

给人类快速阅读，建议包含：

- 分镜解析结果
- Prompt 成功与 fallback 情况
- 生图成功率与失败原因分布
- 配音成功率
- 一致性检查结果
- 合成结果
- 最终交付物路径

## 8. Output Boundary

`output/` 只保留最终交付物，结构建议如下：

```text
output/
  项目名__projectId/
    第01集__episodeId/
      final-video.mp4
      delivery-summary.md
      poster-frame.jpg
```

### Included in `output/`

- 最终视频
- 轻量交付摘要
- 可选封面帧

### Excluded from `output/`

- 原始 Prompt
- 原始 LLM 响应
- 中间图片全集
- 音频全集
- 错误日志
- FFmpeg 中间片段
- 单次运行调试证据

## 9. Testing Strategy

测试升级为三层。

### 9.1 Artifact Contract Tests

目标：保证每个 agent 的目录结构和必需清单存在。

示例：

- `scriptParser` 运行后必须存在 `shots.flat.json`、`shots.table.md`、`parser-metrics.json`
- `promptEngineer` 运行后必须存在 `prompts.json`、`prompt-sources.json`
- `imageGenerator` 运行后必须存在 `images.index.json`，并且失败时必须存在错误文件
- `videoComposer` 失败时必须落盘 `ffmpeg-stderr.txt`

### 9.2 Real Integration Tests

目标：尽量使用真实 provider，验证真实成果物落盘。

建议新增：

- `script-parser.integration.test.js`
- `prompt-engineer.integration.test.js`
- `image-generator.integration.test.js`
- `tts-agent.integration.test.js`
- `video-composer.integration.test.js`

这些测试的成功标准，不再只是返回值正确，而是：

- 产物真的存在
- 产物结构合法
- 指标文件可读
- 失败时有证据文件

### 9.3 End-to-End Acceptance Test

准备一个最小验收剧本，跑完整链路后断言：

- 每个 agent 目录存在
- 根级 `manifest.json / timeline.json / summary.md` 存在
- 最终视频存在，或失败原因完整落盘

## 10. Success Criteria

完成本设计后，一次运行至少应该满足：

1. 能在 `temp/` 中快速定位到具体剧组、剧本、分集和某一次运行
2. 每个 agent 都有独立可读的输入、输出、指标和错误证据
3. 不看终端日志也能知道每一步成功、失败与原因
4. `output/` 保持干净，仅包含最终交付物
5. 测试能够证明“工作流形成了完整运行包”，而不是只证明“函数没报错”

## 11. Non-Goals and Follow-ups

本设计刻意不处理以下内容：

- 人工审核工作台
- 角色资产库与声音资产库的长期治理
- 跨项目版本化 Prompt 资产管理

这些属于下一阶段，可以在本设计落地后再继续扩展。

