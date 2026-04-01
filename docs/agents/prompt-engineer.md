# 视觉设计 Agent（Prompt Engineer）

本文档基于 [src/agents/promptEngineer.js](/d:/My-Project/AI-video-factory-pro/src/agents/promptEngineer.js)，聚焦当前实现里的 Prompt Engineer 如何把分镜转换成稳定可用的生图 Prompt。

## 负责什么

1. 为每个分镜生成结构化图像 Prompt。
2. 把角色档案、镜头语言、风格基础词和负面词拼接成最终 `image_prompt`。
3. 在 LLM 返回非法 JSON 或异常时，自动降级为本地 fallback Prompt，避免整条链路中断。

## 入口函数

- `generatePromptForShot(shot, characterRegistry, style, deps)`
- `generateAllPrompts(shots, characterRegistry, style, deps)`

## 输入

- `shot`
  - 典型字段有 `id`、`scene`、`action`、`emotion`、`camera_type/cameraType`
  - 如果存在 `shotCharacters`，会优先按关系数据解析角色
- `characterRegistry`
  - 来自 Character Registry 的角色档案数组
- `style`
  - `realistic` 或 `3d`
- `deps.chatJSON`
  - 可注入 LLM 调用
- `deps.artifactContext`
  - 可审计运行包上下文

## 输出

单个分镜输出：

- `shotId`
- `image_prompt`
- `negative_prompt`
- `style_notes`

批量输出是上述对象数组。

## 关键流程

1. 用 `getShotCharacterCards(...)` 找出当前镜头真正出场的角色。
2. 用 `PROMPT_ENGINEER_SYSTEM` + `PROMPT_ENGINEER_USER(...)` 请求 LLM 返回结构化 JSON。
3. 本地再做一次增强：
   - 注入 `getShotCharacterTokens(...)`
   - 注入 `CAMERA_KEYWORDS`
   - 注入 `STYLE_BASE.lighting`
   - 注入 `STYLE_BASE.quality`
4. 拼出最终 `image_prompt` 和 `negative_prompt`。

## 降级逻辑

这是当前实现里非常关键的一层。

如果 LLM 失败：

- `generateAllPrompts(...)` 不会直接抛错中断全流程
- 会记录 warning
- 调用 `fallbackPrompt(...)`
- 用 `scene + action + camera + quality` 拼一个基础 prompt

降级后的 `style_notes` 会写成：

- `降级生成（LLM调用失败）`

## 可审计成果物

传入 `artifactContext` 时，会落这些文件：

- `1-outputs/prompts.json`
- `1-outputs/prompt-sources.json`
- `1-outputs/prompts.table.md`
- `2-metrics/prompt-metrics.json`
- `3-errors/<shotId>-fallback-error.json`
- `manifest.json`

其中：

- `prompt-sources.json`
  - 标记每个镜头来自 `llm` 还是 `fallback`
- `prompts.table.md`
  - 适合人工快速审 prompt
- `fallback-error.json`
  - 保存失败镜头、错误信息和最终 fallback 内容

## 关键指标

当前 metrics 里主要有：

- `prompt_count`
- `llm_success_count`
- `fallback_count`
- `fallback_rate`
- `avg_prompt_length`

对排查“为什么优选方案老失败”最有用的就是 `fallback_count` 和每个镜头的 fallback 证据。

## 常见问题

### 为什么 Prompt Engineer 不直接完全相信 LLM 输出

因为当前实现里，镜头词、风格灯光词和质量词是固定增强项。把这些稳定信息放在本地逻辑里，比完全交给 LLM 更稳。

### 为什么有了 LLM 还要保留 fallback

真实运行里，LLM 可能返回坏 JSON、被截断或直接跑偏。没有 fallback，整条 pipeline 会在 prompt 这一步直接停住。

### 这个 Agent 会不会决定最终模型路由

不会。它只负责生成 prompt。真正调用哪个图像 provider / model 是 [image-generator.md](image-generator.md) 的职责。

## 不负责的内容

- 不负责角色档案生成
- 不负责真正出图
- 不负责图像一致性检查
- 不负责字幕、音频和视频合成

## 相关文档

- [角色设定 Agent（Character Registry）](character-registry.md)
- [图像生成 Agent（Image Generator）](image-generator.md)
- [一致性验证 Agent（Consistency Checker）](consistency-checker.md)
