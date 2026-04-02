# `temp/` 目录说明

本文档专门解释运行时 `temp/` 目录的用途、层级和排障价值。

一句话总结：

- `temp/` 放中间过程
- `temp/` 放审计证据
- `temp/` 放失败上下文
- `temp/` 不是最终交付目录

## 为什么需要 `temp/`

这套工作流不是“一步出一个 mp4”，而是多 Agent 串联：

1. 分镜解析
2. 角色档案
3. Prompt 生成
4. 生图
5. 一致性验证
6. 连贯性检查
7. 配音
8. 合成

如果这些过程都不落盘，出问题时就只能看终端日志，很难知道：

- 哪一步失败
- 每一步实际输入输出是什么
- 角色一致性报告写了什么
- FFmpeg 到底吃了什么参数

所以 `temp/` 是运行时证据仓，不是临时垃圾桶。

## 顶层结构

当前 `temp/` 里主要有两类内容：

```text
temp/
  <legacy-job-id>/
  projects/
```

含义分别是：

- `temp/<legacy-job-id>/`
  - 旧单文件入口的兼容缓存
  - 典型内容：`state.json / images / audio`
- `temp/projects/`
  - 新项目模式的结构化存储根目录
  - 包含项目资产、分集数据、run jobs、可审计运行包

## 兼容模式结构

如果你跑的是：

```bash
node scripts/run.js samples/test_script.txt
```

通常会看到：

```text
temp/
  test_script_1775000000000/
    state.json
    images/
    audio/
```

这个目录的用途是：

- 缓存旧入口每一步结果
- 允许同一个 job 复跑时跳过已完成步骤

这里最关键的文件是：

- `state.json`
  - 兼容模式缓存总状态
  - 常见字段：
    - `scriptData`
    - `characterRegistry`
    - `promptList`
    - `imageResults`
    - `audioResults`
    - `consistencyCheckDone`
    - `continuityCheckDone`
    - `outputPath`
    - `lastError`

## 项目模式结构

如果你跑的是：

```bash
node scripts/run.js --project=character-consistency-demo --script=pilot --episode=episode-1 --style=realistic
```

结构大致是：

```text
temp/
  projects/
    项目名__projectId/
      project.json
      character-bibles/
      voice-presets/
      scripts/
        剧本名__scriptId/
          script.json
          episodes/
            第01集__episodeId/
              episode.json
              run-jobs/
              runs/
                YYYY-MM-DD_HHMMSS__runJobId/
```

### 每层分别干什么

#### `project.json`

项目元数据：

- 项目名
- 描述
- 状态

#### `character-bibles/`

角色身份锚点资产：

- 发型
- 面部特征
- 主服装
- 主配色
- negative drift tokens

这是角色一致性控制最关键的项目级资产之一。

#### `voice-presets/`

项目级声音库资产。

当前如果项目没有用到，也可能不存在。

#### `script.json`

剧本级结构化数据，常见包括：

- 标题
- 原始剧本文本摘要
- 主角色模板 `mainCharacterTemplates`

#### `episode.json`

分集级运行输入，常见包括：

- `episodeCharacters`
- `shots`
- `continuityState`
- `shotCharacters`

## `run-jobs/` 和 `runs/` 的区别

这两个目录都重要，但用途不同。

### `run-jobs/`

这是“轻量观测记录”。

典型内容：

```text
run-jobs/
  run_xxx.json
```

主要记录：

- 这次 run 的基本信息
- 状态 `running / completed / failed`
- 起止时间
- 指向运行包的路径

适合程序侧快速列出历史运行记录。

### `runs/`

这是“完整可审计运行包”。

典型内容：

```text
runs/
  2026-04-02_152602__run_xxx/
    manifest.json
    timeline.json
    01-script-parser/
    02-character-registry/
    03-prompt-engineer/
    04-image-generator/
    05-consistency-checker/
    06-continuity-checker/
    07-tts-agent/
    08-video-composer/
```

适合人工 review、排障、验收。

## Agent 子目录结构

每个 Agent 目录都尽量保持统一结构：

```text
<agent>/
  manifest.json
  0-inputs/
  1-outputs/
  2-metrics/
  3-errors/
```

### `manifest.json`

这一层的总状态。

你先看它，就能知道：

- 这一步有没有跑
- 跑完是成功还是带错误
- 产出了哪些关键文件

### `0-inputs/`

这一步真正消费了什么输入。

比如：

- `character-bibles.json`
- `character-registry.json`
- `voice-resolution.json`
- `provider-config.json`

### `1-outputs/`

这一步真正产出的主成果物。

比如：

- `prompts.json`
- `images.index.json`
- `consistency-report.json`
- `continuity-report.json`
- `audio.index.json`
- `compose-plan.json`

### `2-metrics/`

量化指标。

比如：

- prompt fallback 比例
- image success rate
- identity drift tag 统计
- continuity 平均分

### `3-errors/`

失败证据。

这是排障时最值得看的目录。

常见文件：

- `retry-log.json`
- `<shotId>-error.json`
- `<character>-batch-1-error.json`
- `ffmpeg-command.txt`
- `ffmpeg-stderr.txt`

## 对应你的当前问题，优先看哪里

如果你遇到的是生图失败：

先看：

```text
04-image-generator/2-metrics/image-metrics.json
04-image-generator/3-errors/retry-log.json
04-image-generator/3-errors/<shotId>-error.json
```

如果你遇到的是 FFmpeg 合成失败：

先看：

```text
08-video-composer/1-outputs/compose-plan.json
08-video-composer/3-errors/ffmpeg-command.txt
08-video-composer/3-errors/ffmpeg-stderr.txt
```

如果你怀疑角色不稳：

先看：

```text
02-character-registry/0-inputs/character-bibles.json
05-consistency-checker/1-outputs/consistency-report.json
06-continuity-checker/1-outputs/continuity-report.json
```

## `temp/` 里的内容会不会自动清理

当前默认不会帮你做激进清理。

原因是：

- 这些文件本身就是排障证据
- 一旦自动删掉，很难复盘线上/本地异常

所以更合理的策略是：

- 让 `temp/` 可读
- 让 `temp/` 可追踪
- 需要时再手工清理旧 run

## 你最该先学会看的 8 个文件

如果只想快速掌控一轮运行结果，我建议优先看这几个：

```text
manifest.json
timeline.json
01-script-parser/1-outputs/shots.table.md
02-character-registry/1-outputs/character-registry.md
03-prompt-engineer/1-outputs/prompts.table.md
04-image-generator/1-outputs/images.index.json
05-consistency-checker/1-outputs/consistency-report.md
08-video-composer/3-errors/ffmpeg-stderr.txt
```

## 相关文档

- [运行包目录示例](../agents/run-package-example.md)
- [Agent 间输入输出关系图](../agents/agent-io-map.md)
- [output/ 目录说明](output-structure.md)
