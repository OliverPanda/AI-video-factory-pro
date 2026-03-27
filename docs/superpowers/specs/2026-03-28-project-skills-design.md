# Project Skills Design

**项目：** AI Video Factory Pro  
**日期：** 2026-03-28  
**状态：** Draft reviewed with user

---

## 1. 背景

当前项目已经在 `src/agents/`、`src/llm/prompts/`、`README.md` 中沉淀出一批稳定的项目知识，包括：

- 原始剧本如何拆成结构化分镜
- 角色视觉设定如何生成与复用
- 分镜 Prompt 如何组合
- 一致性检查失败后如何给出重绘建议
- 图片、音频、字幕如何规划为最终视频

这些知识目前主要散落在运行时代码、Prompt 模板和说明文档中。结果是：

- 规则与实现耦合，理解成本高
- 后续修改 Prompt 或流程时，缺少统一的“规则层”落点
- 新人或 AI 代理接手时，需要从多处代码反推项目约束
- 项目知识难以作为长期资产积累

因此，需要在当前仓库中引入一层“项目级 skills”，专门沉淀稳定的方法、规则、输入输出约束与失败处理经验。

---

## 2. 目标

本设计的目标是：

- 为当前项目建立一层独立于运行时代码的项目知识层
- 把高复用、规则稳定的能力抽成项目专用 skill
- 降低后续维护 Prompt、流程规则和交接成本
- 让 AI 代理或开发者能先读 skill，再读代码
- 保持 skill 与现有 `src/agents` 的职责边界清晰

---

## 3. 非目标

本次设计**不**做以下事情：

- 不把运行时代码迁移为 skill
- 不把 skill 放进某个 agent 的代码目录
- 不做跨项目通用 skill 市场化设计
- 不把 `director` 这类强项目编排逻辑抽成 skill
- 不先处理 provider 执行层封装，如 `imageGenerator`、`ttsAgent`

本设计只服务于**当前项目长期复用**。

---

## 4. 设计原则

### 4.1 规则层与执行层分离

- `src/agents/*` 继续负责运行时执行
- `skills/project/*` 负责沉淀规则、模板、边界、输入输出约定

### 4.2 项目专用优先于通用抽象

只保留当前项目真正长期会反复使用的知识，不为未来未知项目过度设计。

### 4.3 少而稳

现阶段只抽 3 个 project skill，避免一开始拆得太细导致维护负担变重。

### 4.4 规则优先，不复制实现

skill 文档应该描述：

- 什么时候使用
- 输入是什么
- 输出长什么样
- 必须遵守哪些规则
- 常见失败场景与处理建议

skill 不应该复制大段运行时代码实现。

### 4.5 可追溯

每个 skill 都要明确标注其来源文件，避免后续规则和代码漂移。

---

## 5. 目录规范

推荐采用如下目录结构：

```text
skills/
  project/
    ai-video-script-design/
      SKILL.md
    ai-video-visual-design/
      SKILL.md
    ai-video-render-planning/
      SKILL.md
```

### 为什么不放在某个 agent 文件夹下

不建议将 skill 放在 `src/agents/<agent>/` 目录内部，原因如下：

- skill 不是运行时代码
- skill 不应该被误解为某个 agent 私有附属物
- 多个 agent 可能共享同一个项目 skill
- 将方法论与执行代码分开放置更利于长期维护

### 为什么推荐 `skills/project/`

- 语义清晰，明确表示这是项目级资产
- 与 `src/` 代码分层明显
- 后续如需接入 agent 工具链，更自然
- 不会和 `docs/superpowers/specs`、`plans` 混在一起

---

## 6. 候选 Skills

本项目现阶段建议只抽取以下 3 个 skills。

### 6.1 `ai-video-script-design`

**定位：**  
沉淀“原始剧本如何拆成项目可执行的结构化分镜”的规则。

**适用场景：**

- 输入一段故事文本，生成结构化分镜
- 需要统一 `shots`、`characters`、`speaker`、`duration` 字段
- 需要补齐缺失字段或做合理默认值修正

**应沉淀的内容：**

- 分镜输出 JSON 结构
- 字段定义与必填约束
- 默认值补齐规则
- 角色数组归一化规则
- 时长分配和镜头类型约定
- 失败输出的判定标准

**主要来源文件：**

- `/src/agents/scriptParser.js`
- `/src/llm/prompts/scriptAnalysis.js`

**不包含的内容：**

- 具体的 LLM API 调用实现
- 缓存、状态恢复、任务编排

---

### 6.2 `ai-video-visual-design`

**定位：**  
沉淀“角色视觉设定 + 分镜 Prompt 设计 + 一致性修正建议”的规则。

**适用场景：**

- 为角色生成视觉档案
- 为分镜生成图像 Prompt
- 在风格切换时保持角色特征稳定
- 一致性检查失败后生成可执行的修正建议

**应沉淀的内容：**

- 角色视觉档案结构
- `basePromptTokens` 编写规则
- 风格词、镜头词、质量词的组合原则
- negative prompt 组织方式
- 一致性不足时的建议格式
- 哪些特征必须稳定、哪些特征允许变化

**主要来源文件：**

- `/src/agents/characterRegistry.js`
- `/src/agents/promptEngineer.js`
- `/src/llm/prompts/promptEngineering.js`
- `/src/agents/consistencyChecker.js`

**不包含的内容：**

- 实际图像生成 provider 调用
- 图像文件落盘与重试执行逻辑

---

### 6.3 `ai-video-render-planning`

**定位：**  
沉淀“如何把镜头、音频、字幕稳定规划为最终视频”的规则。

**适用场景：**

- 规划音频时间线
- 处理无对白镜头的静音补齐
- 规划字幕时序与视觉时长对齐
- 决定最终 FFmpeg 合成策略
- 进行 FFmpeg 与平台环境相关排障

**应沉淀的内容：**

- 渲染计划结构
- 音频时间线规划规则
- 音频对齐与静音补齐原则
- 字幕与视觉计划的对齐原则
- FFmpeg 常见失败排查 checklist
- 跨平台安装、字体、路径问题说明

**主要来源文件：**

- `/src/agents/videoComposer.js`
- `/README.md`

**不包含的内容：**

- fluent-ffmpeg 的具体实现细节
- 项目输出目录与状态文件管理逻辑

---

## 7. 明确不抽出的部分

### 7.1 `director`

`director` 是项目主编排器，强依赖：

- 状态恢复
- 任务顺序
- 错误处理
- 缓存策略
- 输出路径组织

这些内容属于运行时 orchestration，不适合作为 skill。

### 7.2 `imageGenerator`

当前 `imageGenerator` 更接近执行层与 provider 调用层，方法论沉淀价值不高，现阶段不建议抽成独立 skill。

### 7.3 `ttsAgent`

当前 `ttsAgent` 主要承担 API 封装职责，除非后续项目沉淀出稳定的“角色配音策略规范”，否则不建议独立 skill 化。

---

## 8. 每个 Skill 的推荐文档结构

建议每个 `SKILL.md` 至少包含以下部分：

```md
---
name: ai-video-script-design
description: 用于把原始剧本拆解成项目可执行的结构化分镜数据。
---

# ai-video-script-design

## 什么时候使用

## 输入

## 输出

## 必须遵守的规则

## 来源文件

## 常见失败场景

## 处理建议
```

### 强制字段建议

每个 skill 文档应至少具备：

- `什么时候使用`
- `输入`
- `输出`
- `必须遵守的规则`
- `来源文件`
- `常见失败场景`
- `处理建议`

这样可以确保 skill 不只是概念说明，而是具有实际复用价值的项目资产。

---

## 9. 与现有 Agents 的关系

skills 与 agents 的关系应当是：

- `agents` = 执行层
- `skills` = 规则层

即：

- `scriptParser.js` 继续真正负责解析剧本
- `ai-video-script-design` 说明“什么是合格的解析结果”

- `characterRegistry.js` / `promptEngineer.js` 继续真正生成角色设定与 Prompt
- `ai-video-visual-design` 说明“这些输出应该遵循什么规则”

- `videoComposer.js` 继续真正做视频合成
- `ai-video-render-planning` 说明“怎样的渲染计划才合理、稳定、可排障”

这种分层的好处是：

- 新人或 AI 代理可先看 skill 再看代码
- 规则不再散落在多个实现文件里
- 后续修改规则时有明确落点
- 可用于 review 代码是否偏离项目设计

---

## 10. 落地顺序

推荐按以下顺序落地：

### 阶段 1：`ai-video-script-design`

优先级最高，原因：

- 输入输出最稳定
- 边界最清晰
- 是整条链路的上游

### 阶段 2：`ai-video-visual-design`

第二优先级，原因：

- 覆盖角色设定与 Prompt 设计，是项目中复用频率最高的一类知识
- 可以同时纳入一致性修正建议

### 阶段 3：`ai-video-render-planning`

第三优先级，原因：

- 很重要，但当前底层合成逻辑还在迭代
- 等渲染和音频时间线方案更稳定后再沉淀，避免频繁返工

---

## 11. 风险与维护策略

### 风险 1：skill 与代码漂移

**问题：**  
代码更新后，skill 没同步，出现两套“真相”。

**对策：**

- 每个 skill 明确写 `来源文件`
- 每次修改关键 prompt、字段结构、流程规则时，同步更新 skill
- 将“是否需要更新对应 skill”加入变更 checklist

### 风险 2：skill 粒度过细

**问题：**  
拆太多 skill 会导致维护成本高、使用成本高。

**对策：**

- 当前只做 3 个
- 不把执行层或项目编排层硬拆成 skill
- 后续只有在某部分规则明显膨胀时才继续拆分

### 风险 3：skill 写成代码注释翻版

**问题：**  
如果 skill 只是重复源码，没有新增结构化认知，价值会很低。

**对策：**

- skill 只写规则、边界、失败场景、判断原则
- 不复制大段实现代码
- 用“输入/输出/约束/例外”方式组织内容

---

## 12. 最终结论

当前项目**有必要**抽出项目级 skills，但只应抽取长期复用、规则稳定、与执行层边界清晰的部分。

推荐结论如下：

- skill 不放在某个 agent 文件夹下
- skill 单独放在 `skills/project/`
- 现阶段只抽 3 个 project skills：
  - `ai-video-script-design`
  - `ai-video-visual-design`
  - `ai-video-render-planning`
- `director`、`imageGenerator`、`ttsAgent` 暂不抽 skill
- skill 与 `src/agents` 采用“规则层 / 执行层”分工

这是当前项目最稳妥、长期成本最低的做法。

