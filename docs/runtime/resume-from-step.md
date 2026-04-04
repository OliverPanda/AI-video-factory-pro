# 断点续跑

`resume-from-step.js` 用来统一处理“从某个步骤之后继续跑”。

它会自动做三件事：

1. 找到对应 `state.json`
2. 删除该步骤及后续步骤的缓存字段
3. 清理对应临时产物，然后重新调用主流程

## 适用场景

- `08b-lipsync-agent` 出错，想从 lipsync 之后继续
- `07-tts-agent` 出错，想从音频重新生成
- `09-video-composer` 出错，只想重做最终合成
- 不想再手工改 `state.json`

## 常用命令

### 先预演，不实际修改

```bash
node scripts/resume-from-step.js --step=lipsync samples/寒烬宫变-pro.txt --dry-run --style=realistic
```

`--dry-run` 只打印：

- 会删哪些 state 字段
- 会清哪些文件
- 当前缓存是否足够从目标步骤继续

### 正式执行

```bash
node scripts/resume-from-step.js --step=lipsync samples/寒烬宫变-pro.txt --style=realistic
```

### 只重置，不自动开跑

```bash
node scripts/resume-from-step.js --step=audio samples/寒烬宫变-pro.txt --prepare-only
```

## 支持的 step

- `character_registry`
- `prompts`
- `images`
- `consistency`
- `continuity`
- `dialogue`
- `audio`
- `lipsync`
- `compose`

常见别名也支持，例如：

- `lipsync-agent` -> `lipsync`
- `tts` / `tts-agent` -> `audio`
- `video-composer` -> `compose`

## 两种运行模式

### 兼容模式

直接传剧本文件：

```bash
node scripts/resume-from-step.js --step=lipsync samples/寒烬宫变-pro.txt --style=realistic
```

### 项目模式

如果你不想手输 `project / script / episode`，可以直接让脚本交互选择：

```bash
node scripts/resume-from-step.js --step=audio --style=realistic
```

也可以半自动：

```bash
node scripts/resume-from-step.js --step=audio --project=demo-project --style=realistic
```

这时脚本只会继续让你选择剧本和分集。

## 脚本如何判断从哪继续

项目当前不是按“步骤号”恢复，而是按 `state.json` 里有没有缓存字段决定是否跳过。

例如：

- 从 `lipsync` 继续时，会清掉：
  - `lipsyncResults`
  - `lipsyncReport`
  - `composeResult`
  - `outputPath`
  - `deliverySummaryPath`
  - `completedAt`
  - `lastError`
  - `failedAt`

- 从 `audio` 继续时，会额外清掉：
  - `audioResults`
  - `audioVoiceResolution`
  - `audioProjectId`

## 为什么指定了 `lipsync`，却又从更早步骤开始

如果当前 `state.json` 里已经缺了前置缓存，例如：

- `imageResults`
- `normalizedShots`
- `audioResults`

那就算你指定 `--step=lipsync`，实际上也无法从 lipsync 继续，只能从更早步骤开始。

脚本会主动输出 warning，告诉你缺了哪些前置缓存。

## 推荐使用方式

建议总是先跑一次：

```bash
node scripts/resume-from-step.js --step=lipsync samples/寒烬宫变-pro.txt --dry-run
```

确认计划没问题，再去掉 `--dry-run` 正式执行。
