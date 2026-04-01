# 视觉设计链路（Character Registry / Prompt Engineer / Consistency Checker）

本文档是视觉链路总览，对应 `src/agents/characterRegistry.js`、`src/agents/promptEngineer.js` 与 `src/agents/consistencyChecker.js`。它适合快速理解整条链路；如果你要查单个 Agent 的细节，请优先看各自的专页文档。

## 这条链路负责什么

1. 为每个角色生成可复用的视觉档案，沉淀外观描述、核心 Prompt 词和性格信息。
2. 为每个分镜生成图像 Prompt，并自动注入角色词、镜头词、风格词和质量词。
3. 在图像生成后，使用多模态模型检查同一角色是否跨镜头保持一致，并给出重生成建议。

## 处理顺序

1. `buildCharacterRegistry` 先读取角色列表、剧本摘要和风格，为每个角色生成视觉卡片。
2. `generateAllPrompts` 再按分镜逐条生成图像 Prompt，并在本地做增强与降级兜底。
3. 图像生成完成后，`runConsistencyCheck` 按角色聚合镜头，对角色外观一致性做批量检查。

## 详细专页

- [角色设定 Agent（Character Registry）](character-registry.md)
- [视觉设计 Agent（Prompt Engineer）](prompt-engineer.md)
- [一致性验证 Agent（Consistency Checker）](consistency-checker.md)

## Character Registry

**文件**：`src/agents/characterRegistry.js`

### 职责

- 把剧本角色列表转成角色视觉档案。
- 为后续 Prompt 生成提供稳定的 `basePromptTokens`。
- 把风格差异提前编码到角色卡里，避免后续每个分镜从零描述角色。

### 输入

- `characters`：来自 Script Parser 的角色数组，至少包含 `name`，通常包含 `gender`、`age`。
- `scriptContext`：剧本摘要或片段，用来辅助理解角色气质和背景。
- `style`：`realistic` 或 `3d`。

### 输出

返回角色卡数组，每个角色通常包含：

- `name`
- `gender`
- `age`
- `visualDescription`
- `basePromptTokens`
- `personality`

### 关键规则

- 角色描述优先写“可见特征”，例如发型、发色、肤色、体型、服装。
- `basePromptTokens` 是后续每次生成该角色都应优先复用的核心词。
- `getCharacterTokens` 和 `getShotCharacterTokens` 负责把角色卡转成分镜级 Prompt 词串。

## Prompt Engineer

**文件**：`src/agents/promptEngineer.js`

### 职责

- 为单个分镜生成图像 Prompt。
- 把角色卡、镜头语言和风格基础词自动组合到最终 Prompt。
- 在 LLM 调用失败时退回到基础拼装方案，避免整个流程中断。

### 输入

- `shot`：分镜对象，至少含 `id`、`scene`、`action`、`camera_type`、`characters`。
- `characterRegistry`：角色卡数组。
- `style`：`realistic` 或 `3d`。

### 输出

每条 Prompt 输出包含：

- `shotId`
- `image_prompt`
- `negative_prompt`
- `style_notes`

### 关键规则

- 先用 `PROMPT_ENGINEER_SYSTEM` 和 `PROMPT_ENGINEER_USER` 让 LLM 产出结构化 Prompt 结果。
- 再由本地逻辑注入：
  - 角色词：`getShotCharacterTokens`
  - 镜头词：`CAMERA_KEYWORDS`
  - 风格灯光与质量词：`STYLE_BASE`
- `generateAllPrompts` 通过 `llmQueue` 串行限流，避免大量镜头时触发模型 RPM 限制。
- 如果 LLM 失败，`fallbackPrompt` 会直接用 `scene + action + camera + quality` 组装基础 Prompt。

## Consistency Checker

**文件**：`src/agents/consistencyChecker.js`

### 职责

- 对同一角色在多张图片中的外观一致性做多模态检查。
- 找出问题镜头并生成重生成建议。
- 控制单次发送给视觉模型的图片批量大小，降低 base64 负担。

### 输入

- `characterRegistry`：角色卡数组。
- `imageResults`：图像结果数组，元素通常包含 `shotId`、`imagePath`、`characters`、`success`。

### 输出

`runConsistencyCheck` 返回：

- `reports`：每个角色的一致性报告
- `needsRegeneration`：需要重生成的镜头列表，包含 `shotId`、`reason`、`suggestion`

### 关键规则

- 少于 2 张有效图片的角色直接跳过，并标记 `skipped: true`。
- 每批最多发送 `CONSISTENCY_BATCH_SIZE` 张图，默认 6。
- 总分阈值由 `CONSISTENCY_THRESHOLD` 控制，默认 7 分。
- 多批结果取平均分，问题图索引会做全局偏移后去重。

## 常见问题

### 为什么角色卡和 Prompt 要拆成两层

因为角色卡更稳定，属于跨镜头复用资产；Prompt 是分镜级动态产物。先沉淀角色卡，再按镜头组装 Prompt，能减少外观漂移。

### 为什么一致性检查按角色而不是按分镜做

当前实现的目标是检查“同一角色跨镜头是否稳定”，所以会先把 `imageResults` 按角色聚合，再逐角色送入多模态模型。

### 为什么一致性检查可能没有触发重生成

常见原因有三种：

- 某角色有效图片不足 2 张，被跳过。
- 分数没有低于 `CONSISTENCY_THRESHOLD`。
- 批次检查全部失败，此时会返回默认高分并记录错误摘要。

## 不负责的内容

- 不直接调用图像平台生成图片，真正出图由 `imageGenerator` 负责。
- 不负责调度整个任务，也不负责状态持久化，相关逻辑在 `director`。
- 不负责字幕、音频和视频合成。

## 来源文件

- `src/agents/characterRegistry.js`
- `src/agents/promptEngineer.js`
- `src/agents/consistencyChecker.js`

## 相关文档

- [导演 Agent 详细说明](director.md)
- [编剧 Agent 详细说明（Script Parser）](script-parser.md)
- [角色设定 Agent（Character Registry）](character-registry.md)
- [视觉设计 Agent（Prompt Engineer）](prompt-engineer.md)
- [一致性验证 Agent（Consistency Checker）](consistency-checker.md)
- [合成 Agent 详细说明（Video Composer）](video-composer.md)
