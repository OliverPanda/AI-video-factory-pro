# 导演 Agent（Director）

本文档基于 `src/agents/director.js`，聚焦导演 Agent 作为 Orchestrator 的实际行为，确保描述与当前实现一致。

## 职责
1. 读取用户提供的剧本文件并解析成分镜、角色、标题等结构化数据。
2. 管理所有子 Agent 的运行顺序（角色档案、Prompt、图像、音频、合成等），包含状态缓存与可选的一致性验证。
3. 处理状态机（`state.json`）的持久化、失败日志记录、重跑与一致性检查提示，最终输出视频路径。

## 输入
- `scriptFilePath`：必须的剧本文件路径，Director 会直接加载并解析。
- `options`（可选）：
  - `style`：覆盖默认 `process.env.IMAGE_STYLE` 的图像风格（默认 `realistic`）。
  - `skipConsistencyCheck`：若为 `true`，将跳过一致性验证阶段，不触发额外重生成流程。

## 输出
- 最终视频文件（MP4），保存在 `dirs.output` 中，文件名由剧名与 jobId 组合生成。
- 持久化文件 `state.json` 会记录最新的 `scriptData`、`characterRegistry`、`promptList`、`imageResults`、`audioResults`、`outputPath` 与时间戳，方便断点续跑。
- 失败时写入 `lastError` 与 `failedAt` 以便排查。

## 主流程/处理步骤
1. **初始化**：调用 `generateJobId`、`initDirs` 创建任务目录，加载已有 `state.json`，并封装 `saveState` 以便后续更新缓存。
2. **读取/解析剧本**：`readTextFile` 读取剧本原文，`parseScript` 将其转成 `shots`、`characters`、`title`，并缓存 `scriptData`。
3. **角色档案**：若缓存缺失则调用 `buildCharacterRegistry` 生成角色视觉卡片，输入包含角色列表、剧本前 500 字与风格。
4. **Prompt 生成**：通过 `generateAllPrompts` 为每个镜头基于角色、风格、角色档案产生图像 Prompt，结果缓存为 `promptList`。
5. **图像生成**：`generateAllImages` 按 Prompt 生成图像，保存路径与状态，附带每个镜头中的角色信息，用于后续一致性核查。
6. **一致性检查（可选）**：除非 `skipConsistencyCheck` 为 `true`，Director 会先检查 `state.consistencyCheckDone`，若未完成则调用 `runConsistencyCheck`。如发现一致性问题，使用 `regenerateImage` 重新发起出图并更新时间戳。
7. **配音**：`generateAllAudio` 为每个镜头转换角色与台词，结果缓存 `audioResults`。
8. **视频合成**：`composeVideo` 集合镜头、图像与音频，生成最终 MP4，并写入 `outputPath` 与完成时间戳。

## 依赖关系
- `scriptParser.parseScript`：提供结构化分镜与角色数据。
- `characterRegistry.buildCharacterRegistry`：生成角色卡片，供 Prompt 与一致性检查使用。
- `promptEngineer.generateAllPrompts`：输出图像 Prompt 列表。
- `imageGenerator.generateAllImages` & `regenerateImage`：负责批量出镜头图，支持一致性重生成。
- `consistencyChecker.runConsistencyCheck`：检查角色视效是否前后一致。
- `ttsAgent.generateAllAudio`：生成对白音轨。
- `videoComposer.composeVideo`：图像+音频拼装成视频。
- `utils/fileHelper`：提供 `initDirs`、`saveJSON`、`loadJSON`、`generateJobId`、`readTextFile` 等文件与状态操作。
- `utils/logger`：记录阶段日志、成功/失败提示。

## 常见问题
1. **为什么重跑仍然引用旧 Prompt？** Director 在一致性重生成时会在原 Prompt 基础上追加同步提示（`highly consistent character appearance`）并调用 `regenerateImage`，结果会覆盖 `imageResults` 中对应镜头。
2. **如何断点续跑？** 所有主阶段都先检查 `state.json` 中的缓存字段，已完成的步骤会跳过，Director 只在缺失时重新计算。
3. **什么时候会跳过一致性检查？** 若 `options.skipConsistencyCheck` 为 `true`，或 `state.consistencyCheckDone` 已存在，则不会再次调用 `runConsistencyCheck`。

## 不负责的内容
- 不负责解析剧本文本（交给 `scriptParser`）。
- 不负责直接生成 Prompt、图像或音频的具体策略 —— 相关 Agent 自行执行。
- 不处理视频播放、发布、云存储等后续传播环节。
- 不包含 UI 交互、调度多个剧本的批量任务，也不处理低层 API 凭据管理。

## 来源文件
- `src/agents/director.js`

## 相关 skill
- `scriptParser`：为下一阶段输出结构化 `shots` 与角色列表。
- `characterRegistry`：提供角色视觉信息，供 Prompt 与一致性策略引用。
- `promptEngineer`：将每个镜头扩展成图像 Prompt。
- `imageGenerator`：向图像 API 发送 Prompt 并记录本地 `imageResults`。
- `consistencyChecker`：检测并反馈需要重生成的镜头。
- `ttsAgent`：将台词转为角色音频。
- `videoComposer`：合成最终 MP4。
