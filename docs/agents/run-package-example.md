# 运行包目录示例

本文档展示当前可审计工作流在 `temp/` 下的真实目录组织方式，重点回答两个问题：

1. 跑完一次流程后，磁盘上到底会出现什么。
2. 每个 agent 的成果物、QA 摘要、报错证据应该去哪里找。

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

## 先记住两条目录规则

从当前版本开始，`temp/` 下的成果物分成两类：

1. 整体跑完整 production pipeline
   - 落到 `temp/projects/<project>/scripts/<script>/episodes/<episode>/runs/...`
2. 单独跑某个 agent / 模块测试，并保留成果物
   - 落到 `temp/<agentName>/...`

这两类目录并不冲突，分别服务“完整交付复盘”和“单模块契约验证”。

## 示例 1：项目模式

假设：

- `projectName = 咖啡馆相遇`
- `projectId = cafe_story`
- `scriptTitle = 第一卷`
- `scriptId = script_001`
- `episodeNo = 1`
- `episodeId = episode_001`
- `runJobId = run_cafe_story_20260403_ab12cd34`
- `startedAt = 2026-04-03T21:45:10.000Z`

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
                run_cafe_story_20260403_ab12cd34.json
              runs/
                2026-04-03_214510__run_cafe_story_20260403_ab12cd34/
                  manifest.json
                  timeline.json
                  qa-overview.md
                  qa-overview.json
                  state.snapshot.json
                  01-script-parser/
                    manifest.json
                    0-inputs/
                      source-script.txt
                      parser-config.json
                    1-outputs/
                      script-outline.json
                      shots.flat.json
                      shots.table.md
                      qa-summary.md
                    2-metrics/
                      parser-metrics.json
                      qa-summary.json
                    3-errors/
                  02-character-registry/
                    manifest.json
                    1-outputs/
                      character-registry.json
                      character-registry.md
                      character-name-mapping.json
                      qa-summary.md
                    2-metrics/
                      character-metrics.json
                      qa-summary.json
                    3-errors/
                  03-prompt-engineer/
                    manifest.json
                    1-outputs/
                      prompts.json
                      prompt-sources.json
                      prompts.table.md
                      qa-summary.md
                    2-metrics/
                      prompt-metrics.json
                      qa-summary.json
                    3-errors/
                      shot_007-fallback-error.json
                  04-image-generator/
                    manifest.json
                    0-inputs/
                      provider-config.json
                    1-outputs/
                      images.index.json
                      qa-summary.md
                    2-metrics/
                      image-metrics.json
                      qa-summary.json
                    3-errors/
                      retry-log.json
                      shot_009-error.json
                  05-consistency-checker/
                    manifest.json
                    1-outputs/
                      consistency-report.json
                      consistency-report.md
                      flagged-shots.json
                      qa-summary.md
                    2-metrics/
                      consistency-metrics.json
                      qa-summary.json
                    3-errors/
                      小红-batch-1-error.json
                  06-continuity-checker/
                    manifest.json
                    1-outputs/
                      continuity-report.json
                      flagged-transitions.json
                      continuity-report.md
                      qa-summary.md
                    2-metrics/
                      continuity-metrics.json
                      qa-summary.json
                    3-errors/
                  07-tts-agent/
                    manifest.json
                    0-inputs/
                      voice-resolution.json
                    1-outputs/
                      audio.index.json
                      dialogue-table.md
                      qa-summary.md
                    2-metrics/
                      tts-metrics.json
                      qa-summary.json
                    3-errors/
                      shot_002-error.json
                  08-tts-qa/
                    manifest.json
                    1-outputs/
                      voice-cast-report.md
                      manual-review-sample.md
                      qa-summary.md
                    2-metrics/
                      tts-qa.json
                      asr-report.json
                      qa-summary.json
                    3-errors/
                  08b-lipsync-agent/
                    manifest.json
                    1-outputs/
                      lipsync.index.json
                      lipsync-report.md
                      qa-summary.md
                    2-metrics/
                      lipsync-report.json
                      qa-summary.json
                    3-errors/
                      shot_003-lipsync-error.json
                  09-video-composer/
                    manifest.json
                    1-outputs/
                      compose-plan.json
                      segment-index.json
                      qa-summary.md
                    2-metrics/
                      video-metrics.json
                      qa-summary.json
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
                2026-04-03_220011__run_legacy_test_script_xxxxxxxx_...
                  ...
```

含义是：

- `temp/<jobId>/state.json`
  - 兼容旧入口的缓存桥
- `temp/projects/.../runs/...`
  - 新的可审计运行包

所以你看到两套目录并不冲突，这是当前兼容策略的一部分。

## 示例 3：单 Agent 测试保留成果物

如果你跑的是：

```bash
npm run test:tts-agent:prod:keep-artifacts
```

那么成果物会落到：

```text
temp/
  tts-agent/
    aivf-tts-agent-artifacts-xxxxxx/
      projects/
        咖啡馆相遇__project_123/
          scripts/
            第一卷__script_001/
              episodes/
                第01集__episode_001/
                  runs/
                    2026-04-01_090000__run_tts_artifacts/
                      07-tts-agent/
                        manifest.json
                        0-inputs/
                        1-outputs/
                        2-metrics/
                        3-errors/
```

同理：

- `npm run test:script-parser:prod:keep-artifacts` -> `temp/script-parser/`
- `npm run test:prompt-engineer:prod:keep-artifacts` -> `temp/prompt-engineer/`
- `npm run test:image-generator:prod:keep-artifacts` -> `temp/image-generator/`
- `npm run test:continuity-checker:prod:keep-artifacts` -> `temp/continuity-checker/`
- `npm run test:lipsync-agent:prod:keep-artifacts` -> `temp/lipsync-agent/`
- `npm run test:video-composer:prod:keep-artifacts` -> `temp/video-composer/`

这里依然会保留 `projects/.../runs/...` 这套内部结构，只是最外层根目录从完整流水线的 `temp/projects/` 变成了该 agent 对应的 `temp/<agentName>/`。

## 小白先看哪里

如果你不是研发，只是想先判断“这一轮能不能交付”，建议按这个顺序看：

1. `qa-overview.md`
   - 一眼看整轮是 `pass / warn / block`
2. `delivery-summary.md`
   - 看最终交付说明、人工抽查建议、fallback 情况
3. 对应 agent 的 `qa-summary.md`
   - 看哪一层过了、哪一层有风险
4. 最后才看 `manifest.json / 3-errors/`
   - 这是研发排障用的原始证据

## 研发排查时的建议顺序

如果你是研发，建议按这个顺序看：

1. `qa-overview.md`
   - 先知道整体阻断点在哪
2. `timeline.json`
   - 看卡在哪个 step
3. 对应 agent 的 `manifest.json`
   - 看状态是 `completed / completed_with_errors / failed / pending`
4. 对应 agent 的 `qa-summary.md`
   - 看“问题翻译成人话”后的版本
5. 该 agent 的 `1-outputs/`
   - 看核心成果物
6. 最后看 `3-errors/`
   - 找原始报错证据

## 针对当前链路最常看的几个位置

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
05-consistency-checker/1-outputs/qa-summary.md
```

### 看连贯性问题修到了哪里

看：

```text
06-continuity-checker/1-outputs/continuity-report.md
06-continuity-checker/1-outputs/flagged-transitions.json
06-continuity-checker/1-outputs/qa-summary.md
```

### 看角色到底用了什么声线

看：

```text
07-tts-agent/0-inputs/voice-resolution.json
07-tts-agent/1-outputs/dialogue-table.md
08-tts-qa/1-outputs/voice-cast-report.md
08-tts-qa/1-outputs/manual-review-sample.md
```

### 看口型同步为什么降级或失败

看：

```text
08b-lipsync-agent/1-outputs/lipsync-report.md
08b-lipsync-agent/2-metrics/lipsync-report.json
08b-lipsync-agent/3-errors/<shotId>-lipsync-error.json
```

### 看 FFmpeg 为什么挂

看：

```text
09-video-composer/3-errors/ffmpeg-command.txt
09-video-composer/3-errors/ffmpeg-stderr.txt
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

- 分镜表、prompt 表、角色档案、生图索引、QA 摘要、TTS QA 报告、Lip-sync 报告，都应该在 `temp/`
- 最终视频和对外说明，应该进 `output/`

## 最后建议

如果你要人工 review 一次运行效果，我建议先开这 9 个文件：

```text
qa-overview.md
01-script-parser/1-outputs/shots.table.md
02-character-registry/1-outputs/character-registry.md
03-prompt-engineer/1-outputs/prompts.table.md
04-image-generator/1-outputs/images.index.json
05-consistency-checker/1-outputs/consistency-report.md
07-tts-agent/1-outputs/dialogue-table.md
08-tts-qa/1-outputs/manual-review-sample.md
08b-lipsync-agent/1-outputs/lipsync-report.md
```

这套组合基本能覆盖“内容对不对、图画出来没有、角色稳不稳、声音是不是对的人在说、口型需不需要人工复核”。

## 相关文档

- [Agent 文档总览](/d:/My-Project/AI-video-factory-pro/docs/agents/README.md)
- [Agent 间输入输出关系图](/d:/My-Project/AI-video-factory-pro/docs/agents/agent-io-map.md)
- [SOP 总览](/d:/My-Project/AI-video-factory-pro/docs/sop/README.md)
