# 编剧 Agent（Script Parser）

本文档基于 `src/agents/scriptParser.js`，描述当前脚本解析链路的真实实现。

## 负责什么

当前 `Script Parser` 不只是“把剧本拆成 shots”，而是两阶段解析：

1. 先把原始剧本文本拆成分集概要 `episodes`
2. 再把每一集拆成结构化 `shots`
3. 最后输出兼容旧链路的扁平 `shots`

因此它既支持：

- 分集化数据模型
- 旧版扁平主链

## 入口函数

- `decomposeScriptToEpisodes(scriptText, deps)`
- `parseEpisodeToShots(episodeTextOrSummary, deps)`
- `parseScript(scriptText, deps)`
- `refineShot(shot, direction, deps)`

当前主链实际调用的是 `parseScript(...)`。

## 输入

- `scriptText`
- 可选 `deps`：
  - `chatJSON`
  - `artifactContext`

## 输出

`parseScript(...)` 当前返回：

- `title`
- `totalDuration`
- `characters`
- `shots`

其中单条 `shot` 至少会被标准化出：

- `id`
- `scene`
- `characters`
- `action`
- `dialogue`
- `speaker`
- `duration`

## 当前解析流程

1. `decomposeScriptToEpisodes(...)`
   - 用 `SCRIPT_DECOMPOSITION_SYSTEM / USER`
   - 输出 `episodes`
2. `parseEpisodeToShots(...)`
   - 对每一集使用 `EPISODE_STORYBOARD_SYSTEM / USER`
   - 输出该集分镜
3. `parseScript(...)`
   - 拼平所有分镜
   - 对镜头统一重编号
   - 计算总时长
   - 写 run artifacts

## 标准化规则

`normalizeShots(...)` 会保证：

- 缺失 `id` 时补 `shot_001` 这类编号
- 扁平拼接时会重新编号，避免各集重复
- 缺失 `duration` 时默认 `3`
- 缺失 `characters` 时默认 `[]`
- 缺失 `dialogue` / `speaker` 时默认空字符串
- `characters` 中的对象会被归一成字符串名称

## 当前可审计产物

传入 `artifactContext` 时，当前会写出：

- `0-inputs/source-script.txt`
- `0-inputs/parser-config.json`
- `1-outputs/shots.flat.json`
- `1-outputs/shots.table.md`
- `1-outputs/characters.extracted.json`
- `2-metrics/parser-metrics.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

## 当前 metrics

- `shot_count`
- `dialogue_shot_count`
- `silent_shot_count`
- `character_count`
- `total_duration_sec`
- `avg_shot_duration_sec`

## 不负责的内容

- 不负责角色建档
- 不负责 speaker 到 voice preset 的解析
- 不负责视觉 prompt
- 不负责质量检查和重生成

## 相关文档

- [Agent 总览](README.md)
- [角色设定 Agent](character-registry.md)
- [Agent 输入输出关系图](agent-io-map.md)
