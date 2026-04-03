# 运行排障 Runbook

这份文档面向本地排障、值班排查和人工复盘。

目标是用最短路径回答 3 个问题：

- 这次运行到底跑到了哪一步
- 失败证据应该先去哪里找
- 下一步应该重跑、清缓存，还是只做人工记录

## 先记住 3 条规则

1. 不要先盲翻 `runs/`
   一次运行的最好入口通常是 `run-jobs/<runJobId>.json`
2. `temp/` 放证据，`output/` 放交付
   正式输出目录是根级 `output/`，不是 `temp/output`
3. 当前 `--skip-consistency` 会同时跳过 `consistency` 和 `continuity`

## 如何定位一次运行

推荐顺序：

1. 先从终端输出、delivery summary 或已知 `projectId/scriptId/episodeId` 确认目标运行
2. 打开对应分集目录下的 `run-jobs/<runJobId>.json`
3. 先看：
   - `status`
   - `error`
   - `artifactRunDir`
   - `agentTaskRuns`
4. 再根据 `artifactRunDir` 进入完整运行包

`run-jobs/*.json` 是当前最可靠的首屏入口，因为它至少会持续记录：

- run 总状态
- 失败原因
- step 级任务记录
- 完整证据包路径

## 两棵目录树怎么对应

当前运行记录是双路径结构：

- 裸 ID 树
  - `temp/projects/<projectId>/scripts/<scriptId>/episodes/<episodeId>/run-jobs/`
- 可读名审计树
  - `temp/projects/<projectName>__<projectId>/scripts/<scriptTitle>__<scriptId>/episodes/<episodeDir>/runs/<runDir>/`

含义：

- `run-jobs/*.json`
  适合先定位一次 run
- `runs/<runDir>/`
  适合查完整证据和 agent 产物

不要假设这两棵树目录名完全一样，优先通过 `artifactRunDir` 做跳转。

## 根级文件怎么用

进入 `runs/<runDir>/` 后，优先级如下：

1. `manifest.json`
   - 用来确认本次 run 的元数据
2. `timeline.json`
   - 当前只保证初始化事件存在，不应把它当成唯一进度来源
3. 各 agent `manifest.json`
   - 用来判断单层状态
4. 各 agent `1-outputs/`
   - 看主结果
5. 各 agent `3-errors/`
   - 看原始失败证据

注意：

- 根 `manifest.json` 和 `timeline.json` 当前更适合看元信息，不足以单独回答“完整进度”或“最终卡点”
- 真正的 step 级状态优先看 `run-jobs/*.json` 的 `agentTaskRuns`

## 按症状分流

### 没出片

先看：

- `run-jobs/*.json`
- `08-video-composer/manifest.json`
- `08-video-composer/3-errors/ffmpeg-command.txt`
- `08-video-composer/3-errors/ffmpeg-stderr.txt`

### 生图失败或部分镜头缺图

先看：

- `04-image-generator/1-outputs/images.index.json`
- `04-image-generator/2-metrics/image-metrics.json`
- `04-image-generator/3-errors/retry-log.json`
- `04-image-generator/3-errors/<shotId>-error.json`

### 角色外观漂移

先看：

- `05-consistency-checker/1-outputs/consistency-report.json`
- `05-consistency-checker/1-outputs/flagged-shots.json`
- `05-consistency-checker/3-errors/`

### continuity 结果缺失

先看：

- `run-jobs/*.json` 里 `continuity_check` 的状态
- 是否使用了 `--skip-consistency`
- 上游 `regenerate_inconsistent_images` 是否提前失败
- `06-continuity-checker/manifest.json`

当前如果跳过一致性检查，也会一并跳过 continuity。

### 声线不对或音频缺失

先看：

- `07-tts-agent/0-inputs/voice-resolution.json`
- `07-tts-agent/1-outputs/audio.index.json`
- `07-tts-agent/1-outputs/dialogue-table.md`
- `07-tts-agent/3-errors/<shotId>-error.json`

### Prompt 看起来不对

先看：

- `03-prompt-engineer/1-outputs/prompts.json`
- `03-prompt-engineer/1-outputs/prompt-sources.json`
- `03-prompt-engineer/3-errors/`

## 每个 agent 的首查文件

- `Director`
  先看 `run-jobs/*.json`
- `Script Parser`
  先看 `01-script-parser/1-outputs/shots.table.md`
- `Character Registry`
  先看 `02-character-registry/1-outputs/character-registry.json`
- `Prompt Engineer`
  先看 `03-prompt-engineer/1-outputs/prompt-sources.json`
- `Image Generator`
  先看 `04-image-generator/1-outputs/images.index.json`
- `Consistency Checker`
  先看 `05-consistency-checker/1-outputs/flagged-shots.json`
- `Continuity Checker`
  先看 `06-continuity-checker/1-outputs/flagged-transitions.json`
- `TTS Agent`
  先看 `07-tts-agent/0-inputs/voice-resolution.json`
- `Video Composer`
  先看 `08-video-composer/1-outputs/compose-plan.json`

## 缓存与重跑

兼容模式下还有一层旧缓存：

- `temp/<jobId>/state.json`

它主要影响：

- 角色档案复用
- Prompt 复用
- 图像结果复用
- 一致性 / continuity 标记复用
- 音频结果复用

重跑策略建议：

- 只是下游合成失败
  优先保留缓存，先查 `video composer`
- 只是 TTS 配置错了
  先看是否需要让 `audioResults` 失效重跑
- Prompt 或角色设定规则变了
  不要盲信旧 `state.json`
- 一致性 / continuity 逻辑变了
  不要复用旧 `consistencyCheckDone` 或 `continuityCheckDone`
- 项目级 voice preset 变了
  不要复用旧音频结果

原则：

- 想复盘问题，先保留现有 `temp/` 证据
- 想验证修复是否生效，再考虑清掉会干扰结果的缓存层

## 运行前预检

运行前最少确认：

- Node 版本正确
- FFmpeg 可用
- `.env` 中 provider 配置齐全
- 输出目录磁盘空间足够
- `temp/` 和 `output/` 可写

## 证据保全

一次失败 run 至少保留这些文件：

- `run-jobs/<runJobId>.json`
- 对应 `runs/<runDir>/`
- 失败 agent 的 `3-errors/`
- 最终 `delivery-summary.md`

如果需要人工复盘，再附：

- `shots.table.md`
- `prompts.table.md`
- `dialogue-table.md`
- `consistency-report.md`
- `continuity-report.md`

## 什么时候该升级为人工 review

满足任一条件时，不建议只靠自动重跑：

- 主角身份持续漂移
- continuity 存在硬规则违规
- voice preset 明显映射到错误角色
- FFmpeg 反复失败且 stderr 指向素材损坏
- 单次 run 同时跨多个 agent 失败
