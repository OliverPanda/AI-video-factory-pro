---
name: ai-video-visual-design
description: 用于构建可复用的角色外观定义、生成分镜图像 Prompt，或把一致性检查结果转成具体视觉修正建议时。
---

# ai-video-visual-design

## 概述

这个 skill 记录项目里的视觉规则层：角色卡、Prompt 组合方式，以及一致性修正建议。

它对应 `characterRegistry`、`promptEngineer` 和 `consistencyChecker`，但不负责执行 provider 调用。

## 什么时候使用

- 需要为角色生成稳定可复用的视觉档案
- 需要为分镜生成图像 Prompt
- 需要补强风格词、镜头词和负面词的组合规则
- 需要把一致性检查结果转成可执行的修正建议

## 输入约定

- 来自剧本解析的角色列表
- 剧本上下文或分镜上下文
- 风格：`realistic` 或 `3d`
- 包含 `scene`、`characters`、`action`、`emotion`、`camera_type` 的分镜数据

## 输出约定

- 角色档案，包含：
  - `name`
  - `gender`
  - `age`
  - `visualDescription`
  - `basePromptTokens`
  - `personality`
- Prompt 结果，包含：
  - `shotId`
  - `image_prompt`
  - `negative_prompt`
  - `style_notes`
- 一致性报告，包含：
  - `overallScore`
  - `problematicImageIndices`
  - `suggestion`

## 必须遵守的规则

- 角色描述优先写可见特征。
  应先关注发型、五官、肤色、体型、服装，再写抽象性格。
- `visualDescription` 需要保持精炼，并且适合直接用于英文 Prompt。
- `basePromptTokens` 是角色的稳定身份词，跨镜头应持续复用。
- Prompt 组合顺序是分层的：
  角色 tokens -> 模型生成的 image prompt -> 镜头关键词 -> 光线词 -> 质量词
- negative prompt 需要单独维护，再和风格自带的负面词合并。
- 镜头术语遵循项目映射：
  `特写`、`近景`、`中景`、`全景`、`远景`
- 就算走降级 Prompt，也要保留 scene、action、camera 和 style quality 这些关键信息。

## 风格规则

- `realistic` 使用电影感、写实摄影取向的质量词和光线词。
- `3d` 使用 Pixar/Cinema4D 一类的渲染语言、全局光照和非写实负面词。
- 风格词应该服务于最终风格，而不是盖过角色身份特征。

## 一致性规则

- 只有当同一角色至少出现在 2 张有效图片里时，一致性检查才有意义。
- 图像检查应分批执行，避免多模态请求过大。
- 多批次结果最终取平均分。
- 如果评分低于阈值，重生成建议应直接指向发生漂移的可见特征。
- 好的建议必须具体且可视化。
  例如“恢复长黑发和浅米色外套”优于“保持一致一点”。

## 常见失败场景

- 角色外观在不同镜头之间漂移
- 风格词太重，角色身份词被冲淡
- negative prompt 缺失或过弱
- 一致性反馈太抽象，无法直接指导重生成
- 角色 tokens 没有真正注入最终 Prompt

## 处理建议

- 可复用身份词既要稳定，也要足够短，才能长期重复使用。
- 修正建议优先作用在稳定角色特征上，其次才是场景风格。
- 把风格当作表现层，不要让它替代角色身份。
- 如果 LLM 生成 Prompt 失败，应该平滑降级到确定性的 Prompt 拼装。

## 不覆盖的内容

- 图像 provider API 调用
- 当前 Prompt 生成流程之外的重试调度和队列编排
- Director 级别的重生成策略

## 来源文件

- `src/agents/characterRegistry.js`
- `src/agents/promptEngineer.js`
- `src/llm/prompts/promptEngineering.js`
- `src/agents/consistencyChecker.js`
