# 编剧 Agent（Script Parser）

本文档基于 `src/agents/scriptParser.js` 和 `src/agents/professionalScriptParser.js`，描述当前脚本解析链路的真实实现。

## 负责什么

`Script Parser` 负责把输入文本变成后续生产链路可消费的 `title / characters / shots`，同时保留分集和结构化来源信息。

它支持两类输入：

- `professional-script`：默认模式。输入已经是专业剧本，包含 `第N集`、`【场景】`、`【画面N】`、台词、SFX、字幕等结构。
- `raw-novel`：显式改编模式。输入是小说、散文、故事大纲等未分镜文本，需要 LLM 先拆分集、再拆 shots。

还有 `auto` 模式：只有检测到 `【画面N】` 时才走 `professional-script`；普通 `第N集` 散文标题仍走 `raw-novel`。

## 入口函数

- `parseScript(scriptText, deps)`：主入口，按 `deps.inputFormat` 路由。
- `parseRawNovelScript(scriptText, deps)`：旧 LLM 改编流程。
- `parseProfessionalScript(scriptText, options)`：确定性专业剧本解析，无网络调用。
- `decomposeScriptToEpisodes(scriptText, deps)`：raw-novel 第一阶段，拆分集。
- `parseEpisodeToShots(episodeTextOrSummary, deps)`：raw-novel 第二阶段，拆单集 shots。
- `refineShot(shot, direction, deps)`：细化单个 shot。

## 输入

`parseScript(...)` 接收：

- `scriptText`
- 可选 `deps.chatJSON`
- 可选 `deps.artifactContext`
- 可选 `deps.inputFormat`

`deps.inputFormat` 可为：

- `professional-script`
- `raw-novel`
- `auto`

CLI 默认传入 `professional-script`。如果要把小说或散文交给 LLM 改编，需要显式传 `--input-format=raw-novel`。

## 输出

主链兼容字段：

- `title`
- `totalDuration`
- `characters`
- `shots`

单条 `shot` 至少包含：

- `id`
- `scene`
- `characters`
- `action`
- `dialogue`
- `speaker`
- `duration`

专业剧本模式还会附加：

- `audioCues`：结构化台词、系统音等声音线索。
- `sfx`：音效线索。
- `subtitle`：字幕文本。
- `blackScreen`：是否包含黑屏画面。
- `source.inputFormat`
- `source.episodeNo`
- `source.episodeTitle`
- `source.pictureNo`
- `source.rawBlock`

`shot.dialogue` 只保留可直接用于 TTS 的口播文本；角色名、表演提示和系统音类型等结构化信息放在 `audioCues`。

## professional-script 流程

1. 读取剧名前置说明和分集标题。
2. 按 `第N集` 切分分集。
3. 在每集内按 `【场景】` 更新当前场景。
4. 每个 `【画面N】` 生成一个 shot。
5. 保留画面顺序、画面编号和原始 block。
6. 从通用台词格式抽取角色，不硬编码具体剧名或角色名。

这个模式不调用 LLM，也不会二次改写专业剧本画面。

## raw-novel 流程

1. `decomposeScriptToEpisodes(...)`
   - 使用 `SCRIPT_DECOMPOSITION_SYSTEM / USER`
   - 输出分集概要 `episodes`
2. `parseEpisodeToShots(...)`
   - 对每一集使用 `EPISODE_STORYBOARD_SYSTEM / USER`
   - 输出该集分镜
3. `parseRawNovelScript(...)`
   - 拼平所有分镜
   - 重新编号
   - 写 run artifacts

## 标准化规则

`normalizeShots(...)` 会保证：

- 缺失 `id` 时补 `shot_001` 这类编号。
- 扁平拼接时可重新编号，避免各集重复。
- 缺失 `duration` 时默认 `3`。
- 缺失 `characters` 时默认 `[]`。
- 缺失 `dialogue` / `speaker` 时默认空字符串。
- `characters` 中的对象会被归一成字符串名称。

## 可审计产物

传入 `artifactContext` 时会写出：

- `0-inputs/source-script.txt`
- `0-inputs/parser-config.json`
- `1-outputs/shots.flat.json`
- `1-outputs/shots.table.md`
- `1-outputs/characters.extracted.json`
- `1-outputs/professional-script-structure.json`（仅 professional-script）
- `2-metrics/parser-metrics.json`
- `manifest.json`
- `qa-summary.md / qa-summary.json`

`parser-config.json` 会记录：

- `inputFormat`
- `parserMode`
- `detectedFormat`
- `fallbackUsed`
- `decompositionPrompt`
- `storyboardPrompt`

## Metrics

`parser-metrics.json` 会记录：

- `input_format`
- `parser_mode`
- `episode_count`
- `picture_block_count`
- `preserved_picture_count`
- `sfx_count`
- `system_voice_count`
- `subtitle_count`
- `black_screen_count`
- `llm_rewrite_used`
- `shot_count`
- `dialogue_shot_count`
- `silent_shot_count`
- `character_count`
- `total_duration_sec`
- `avg_shot_duration_sec`

## 不负责的内容

- 不负责角色建档。
- 不负责 speaker 到 voice preset 的解析。
- 不负责视觉 prompt。
- 不负责质量检查和重生成。
- 不负责从多集源文本中选择某一集的 UI；当前只保留 episode metadata 供后续链路使用。

## 相关文档

- [Agent 总览](README.md)
- [角色设定 Agent](character-registry.md)
- [Agent 输入输出关系图](agent-io-map.md)
