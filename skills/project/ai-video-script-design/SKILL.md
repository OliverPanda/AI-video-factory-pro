---
name: ai-video-script-design
description: 用于把原始中文剧本转换成项目所需的结构化分镜数据，或检查 shot 字段默认值与归一化规则时。
---

# ai-video-script-design

## 概述

这个 skill 用来记录“原始剧本 -> 结构化分镜 JSON”的规则层约束。

它覆盖输出结构、默认值补齐和失败判定规则，但不替代 `src/agents/scriptParser.js` 的运行逻辑。

## 什么时候使用

- 需要把原始剧本文本转换成 `title + characters + shots` 结构
- 需要检查 LLM 返回的剧本 JSON 是否满足当前项目要求
- 需要补齐 `shot.id`、`duration`、`speaker`、`dialogue` 等默认值
- 需要处理 `characters` 被模型错误返回成对象数组的情况

## 输入约定

- 原始中文剧本文本
- 单个分镜的细化方向（可选）

## 输出约定

解析结果应当是一个包含以下字段的 JSON 对象：

- `title`: 剧名
- `totalDuration`: 总时长秒数
- `characters`: 角色数组
- `shots`: 分镜数组

每个 shot 应尽量包含：

- `id`
- `scene`
- `characters`
- `speaker`
- `action`
- `dialogue`
- `emotion`
- `camera_type`
- `duration`

## 必须遵守的规则

- `shots` 必须存在，且必须是数组；否则直接判失败。
- `characters` 必须存在，且必须是数组；否则直接判失败。
- 缺失的 `shot.id` 需要补成 `shot_001`、`shot_002` 这样的稳定编号。
- 缺失或假值 `duration` 统一补成 `3`。
- 缺失的 `characters` 统一补成 `[]`。
- 缺失的 `dialogue` 统一补成 `''`。
- 缺失的 `speaker` 统一补成 `''`。
- `shot.characters` 必须归一成字符串数组。
  如果元素是对象，优先取 `item.name`，否则转成字符串。

## Prompt 侧规则

- 输出必须是合法 JSON。
- 台词保持中文原文。
- 镜头类型应使用项目术语，如 `特写`、`近景`、`中景`、`全景`、`远景`。
- `duration` 单位是秒，应根据台词长度和场景复杂度估算。
- 角色元数据默认采用 `{ name, gender, age }` 结构。

## 常见失败场景

- `shots` 缺失或不是数组
- `characters` 缺失或不是数组
- `shot.characters` 被返回成对象数组而不是字符串数组
- shot 明明有台词但漏掉了 `speaker`
- `duration` 缺失，或者值不可用

## 处理建议

- 顶层 `shots` 或 `characters` 结构出错时应尽快失败。
- 解析后必须做字段归一化，不要直接信任模型原样输出。
- 默认值规则要保持简单、确定，保证下游 agent 拿到稳定数据。

## 不覆盖的内容

- Director 编排逻辑
- 状态持久化与断点续跑
- Provider 选择和 LLM 路由

## 来源文件

- `src/agents/scriptParser.js`
- `src/llm/prompts/scriptAnalysis.js`
