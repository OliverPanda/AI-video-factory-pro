# 运行包目录示例（按 `temp/` 实际结构展开）

本文档展示当前可审计工作流在 `temp/` 下的真实目录组织方式，重点回答两个问题：

1. 跑完一次流程后，磁盘上到底会出现什么。
2. 每个 agent 的成果物应该去哪里找。

## 命名规则

当前目录命名规则来自：

- [runArtifacts.js](/d:/My-Project/AI-video-factory-pro/src/utils/runArtifacts.js)
- [naming.js](/d:/My-Project/AI-video-factory-pro/src/utils/naming.js)

核心规则：

- 项目目录：`项目名__projectId`
- 剧本目录：`剧本名__scriptId`
- 分集目录：`第01集__episodeId`
- 运行目录：`YYYY-MM-DD_HHMMSS__runJobId`

也就是说，目录既可读，又保留稳定 ID。

## 示例 1：项目模式

假设：

- `projectName = 咖啡馆相遇`
- `projectId = cafe_story`
- `scriptTitle = 第一卷`
- `scriptId = script_001`
- `episodeNo = 1`
- `episodeId = episode_001`
- `runJobId = run_cafe_story_20260401_ab12cd34`
- `startedAt = 2026-04-01T21:45:10.000Z`

那么运行包会落成：

```text
temp/
  projects/
    咖啡馆相遇__cafe_story/
      project.json
      voice-presets/
        heroine.json
        narrator.json
      scripts/
        第一卷__script_001/
          script.json
          episodes/
            第01集__episode_001/
              episode.json
              run-jobs/
                run_cafe_story_20260401_ab12cd34.json
              runs/
                2026-04-01_214510__run_cafe_story_20260401_ab12cd34/
                  manifest.json
                  timeline.json
                  summary.md
                  01-script-parser/
                    manifest.json
                    0-inputs/
                      source-script.txt
                      parser-config.json
                    1-outputs/
                      script-outline.json
                      shots.flat.json
                      shots.table.md
                    2-metrics/
                      parser-metrics.json
                    3-errors/
                      invalid-response-001.txt
                  02-character-registry/
                    manifest.json
                    0-inputs/
                    1-outputs/
                      character-registry.json
                      character-registry.md
                      character-name-mapping.json
                    2-metrics/
                      character-metrics.json
                    3-errors/
                  03-prompt-engineer/
                    manifest.json
                    0-inputs/
                    1-outputs/
                      prompts.json
                      prompt-sources.json
                      prompts.table.md
                    2-metrics/
                      prompt-metrics.json
                    3-errors/
                      shot_007-fallback-error.json
                  04-image-generator/
                    manifest.json
                    0-inputs/
                      provider-config.json
                    1-outputs/
                      images.index.json
                    2-metrics/
                      image-metrics.json
                    3-errors/
                      retry-log.json
                      shot_009-error.json
                  05-consistency-checker/
                    manifest.json
                    0-inputs/
                      character-registry.json
                      image-results.json
                    1-outputs/
                      consistency-report.json
                      consistency-report.md
                      flagged-shots.json
                    2-metrics/
                      consistency-metrics.json
                    3-errors/
                      小红-batch-1-error.json
                  06-continuity-checker/
                    manifest.json
                    1-outputs/
                      continuity-report.json
                      flagged-transitions.json
                      continuity-report.md
                    2-metrics/
                      continuity-metrics.json
                    3-errors/
                  07-tts-agent/
                    manifest.json
                    0-inputs/
                      voice-resolution.json
                    1-outputs/
                      audio.index.json
                      dialogue-table.md
                    2-metrics/
                      tts-metrics.json
                    3-errors/
                      shot_002-error.json
                  08-video-composer/
                    manifest.json
                    0-inputs/
                    1-outputs/
                      compose-plan.json
                      segment-index.json
                    2-metrics/
                      video-metrics.json
                    3-errors/
                      ffmpeg-command.txt
                      ffmpeg-stderr.txt
```

## 示例 2：兼容模式

如果你跑的是：

```bash
node scripts/run.js samples/test_script.txt --skip-consistency
```

Director 会先把单文件桥接成一个临时项目，再继续走分集模式。

这时你会同时看到两类目录：

```text
temp/
  legacy_test_script_xxxxxxxx/
    state.json
    images/
    audio/

  projects/
    test_script__legacy_project_test_script_xxxxxxxx/
      scripts/
        test_script__legacy_script_test_script_xxxxxxxx/
          episodes/
            第01集__legacy_episode_test_script_xxxxxxxx/
              run-jobs/
              runs/
                2026-04-01_220011__run_legacy_test_script_xxxxxxxx_...
                  ...
```

含义是：

- `temp/<jobId>/state.json`
  - 兼容旧入口的缓存桥
- `temp/projects/.../runs/...`
  - 新的可审计运行包

所以你看到两套目录并不冲突，这是当前兼容策略的一部分。

## 每层应该先看什么

如果你只是想快速排查，不必每层都翻。

建议按这个顺序看：

1. `runs/<runDir>/summary.md`
   - 先看这次整体成功还是失败
2. `runs/<runDir>/timeline.json`
   - 看卡在哪个 step
3. 对应 agent 的 `manifest.json`
   - 看这层状态是 `completed / completed_with_errors / failed / pending`
4. 再看该层的 `1-outputs/`
   - 看主成果物
5. 如果失败，再看 `3-errors/`
   - 找原始证据

## 针对你当前工作流最常看的几个位置

### 看分镜拆得对不对

看：

```text
01-script-parser/1-outputs/shots.table.md
01-script-parser/1-outputs/shots.flat.json
```

### 看 Prompt 有没有掉 fallback

看：

```text
03-prompt-engineer/1-outputs/prompt-sources.json
03-prompt-engineer/3-errors/
```

### 看生图为什么失败

看：

```text
04-image-generator/2-metrics/image-metrics.json
04-image-generator/3-errors/retry-log.json
04-image-generator/3-errors/<shotId>-error.json
```

### 看角色一致性到底检查了什么

看：

```text
05-consistency-checker/1-outputs/consistency-report.md
05-consistency-checker/1-outputs/flagged-shots.json
05-consistency-checker/3-errors/
```

### 看角色到底用了什么声线

看：

```text
06-continuity-checker/1-outputs/continuity-report.md
06-continuity-checker/1-outputs/flagged-transitions.json
07-tts-agent/0-inputs/voice-resolution.json
07-tts-agent/1-outputs/dialogue-table.md
```

### 看 FFmpeg 为什么挂

看：

```text
08-video-composer/3-errors/ffmpeg-command.txt
08-video-composer/3-errors/ffmpeg-stderr.txt
```

## output/ 和 temp/ 的分工

当前约定是：

- `temp/`
  - 中间过程
  - 可审计证据
  - 失败上下文
  - 指标与报告
- `output/`
  - 最终交付物

也就是说：

- 分镜表、prompt 表、角色档案、生图索引、TTS 声线解析，都应该在 `temp/`
- 最终视频才应该进 `output/`

## 最后建议

如果你要人工 review 一次运行效果，我建议只开这 7 个文件就够了：

```text
summary.md
01-script-parser/1-outputs/shots.table.md
02-character-registry/1-outputs/character-registry.md
03-prompt-engineer/1-outputs/prompts.table.md
04-image-generator/1-outputs/images.index.json
05-consistency-checker/1-outputs/consistency-report.md
06-continuity-checker/1-outputs/continuity-report.md
07-tts-agent/1-outputs/dialogue-table.md
```

这套组合基本能覆盖“内容对不对、图画出来没有、角色稳不稳、声音是不是对的人在说”。

## 相关文档

- [Agent 文档总览](README.md)
- [Agent 间输入输出关系图](agent-io-map.md)
