# Multi-Project Story Factory Design

**Goal:** 将 AI Video Factory Pro 从“单剧本任务流水线”升级为“多剧组、多剧集、分镜动画工厂”的最小可用版本，并以尽量少的破坏逐层迁移现有 `director / scriptParser / promptEngineer / ttsAgent / videoComposer`。

## Implementation Status

截至 `2026-03-31`，当前分支已经完成以下落地：

- 已引入 `Project -> Script -> Episode -> ShotPlan` 内容骨架和本地 JSON store。
- 已引入 `MainCharacterTemplate / EpisodeCharacter / ShotCharacter` 关系模型。
- 已引入 `KeyframeAsset / AnimationClip / VoiceAsset / SubtitleAsset / EpisodeCut` DTO，并把关键帧与动画片段接入当前运行时桥接。
- `director` 已升级为按 `episode` 运行，旧 `runPipeline(scriptFilePath)` 通过兼容桥转入新的分集入口。
- CLI 已支持 `--project / --script / --episode`。
- 已引入 `RunJob / AgentTaskRun` JSON 观测层，落盘到分集目录下。

## Current Runtime Shape

当前实现遵循下面这条主链：

```text
Project
└── Script
    └── Episode
        ├── ShotPlan[]
        ├── EpisodeCharacter[]
        ├── AnimationClip[]   # 可为空，空时回退静态关键帧合成
        └── RunJob[]
```

分镜侧的运行时桥接链路为：

```text
ShotPlan -> KeyframeAsset -> AnimationClip? -> VoiceAsset -> EpisodeCut
```

其中 `AnimationClip` 当前仍允许为空；`videoComposer` 在没有 clip 时回退到静态图拼接，这属于刻意保留的增量兼容策略，而不是最终形态。

## Persistence Layout

当前本地存储目录：

```text
temp/projects/<projectId>/project.json
temp/projects/<projectId>/scripts/<scriptId>/script.json
temp/projects/<projectId>/scripts/<scriptId>/episodes/<episodeId>/episode.json
temp/projects/<projectId>/scripts/<scriptId>/episodes/<episodeId>/run-jobs/<runJobId>.json
```

旧单文件入口仍保留 `temp/<jobId>/state.json` 作为步骤缓存。

## Runtime Compatibility Rules

为了避免推倒重来，当前分支刻意保留了几条兼容规则：

- `scriptParser.parseScript()` 仍返回旧的平铺 `{ title, totalDuration, characters, shots }` 结构。
- `scriptParser` 同时新增了 `decomposeScriptToEpisodes()` 与 `parseEpisodeToShots()`，供新编排逐步迁移。
- `director.runPipeline(scriptFilePath)` 会为 legacy 模式构造稳定的 `projectId / scriptId / episodeId / jobId`，然后转调 `runEpisodePipeline(...)`。
- `promptEngineer` 和 `ttsAgent` 优先使用 `ShotCharacter`，但仍兼容旧的 `shot.characters` / `shot.speaker` 桥接数据。
- `videoComposer` 优先消费 `AnimationClip.videoPath`，否则回退到静态关键帧。

## Observability Contract

本轮实现中的 `RunJob` / `AgentTaskRun` 约束如下：

- 一个分集运行会创建一个新的 `RunJob.id`。
- 同一条业务任务可复用稳定 `jobId`，但每次运行的 `RunJob.id` 必须唯一。
- 主要编排步骤会记录 `completed / cached / skipped / failed`。
- 观测写入是 best-effort：
  - `createRunJob` 失败不应中断主流程。
  - `appendAgentTaskRun` 失败会停止后续 task-run 追加，但仍允许最终 `finishRunJob` 写入尾态。

## Deferred / Not Yet Implemented

以下内容仍在设计里，但当前分支没有做满：

- `ProductionProfile`
- 独立的 animation planning / video clip generation agents
- 将 `metrics.js` 正式收敛为 `AgentTaskRun` 的统一来源
- 多写者并发更新同一 `RunJob` 的锁与合并策略

## Verification Reality

当前仓库的 `pnpm test` 不是离线单测，而是直接执行 `node scripts/run.js samples/test_script.txt`。因此它依赖真实 LLM / 图像 / TTS 凭证；在未配置可用凭证的环境里会报 `401`。

本次多项目升级的稳定验证依赖新增的 focused `node:test` 用例，而不是 `pnpm test`。
