# Project Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three project-level skills for AI Video Factory Pro so script design, visual design, and render planning rules are documented as reusable project assets outside runtime code.

**Architecture:** Keep all runtime behavior in `src/` and add a separate `skills/project/` layer that captures stable rules, templates, boundaries, and failure-handling guidance. Each skill is written from existing source files and docs, then cross-checked against current implementation so the skill becomes a trustworthy rules layer rather than a loose summary.

**Tech Stack:** Markdown, project source files in `src/`, existing project docs in `README.md`, Git

---

## File Structure

**Existing files to modify**
- `README.md`
  Responsibility: add a short reference to project-level skills once the first three are created.

**New files to create**
- `skills/project/ai-video-script-design/SKILL.md`
  Responsibility: document script-to-storyboard rules, field contracts, defaults, and failure handling.
- `skills/project/ai-video-visual-design/SKILL.md`
  Responsibility: document character registry rules, prompt composition rules, and consistency-fix guidance.
- `skills/project/ai-video-render-planning/SKILL.md`
  Responsibility: document render plan rules, audio timeline strategy, subtitle alignment, and FFmpeg troubleshooting.
- `skills/project/README.md`
  Responsibility: explain what project skills exist, when to use them, and where their source-of-truth code lives.

---

### Task 1: Create Project Skills Index

**Files:**
- Create: `skills/project/README.md`
- Modify: `README.md`

- [ ] **Step 1: Write the initial project skills index draft**

```md
# Project Skills

This directory contains project-specific skills for AI Video Factory Pro.

## Available Skills
- `ai-video-script-design`
- `ai-video-visual-design`
- `ai-video-render-planning`
```

- [ ] **Step 2: Save the draft and verify the file exists**

Run: `Get-Item skills/project/README.md`
Expected: file is present in the new `skills/project/` directory

- [ ] **Step 3: Add source-of-truth mapping**

```md
## Source Mapping
- `ai-video-script-design` -> `src/agents/scriptParser.js`, `src/llm/prompts/scriptAnalysis.js`
- `ai-video-visual-design` -> `src/agents/characterRegistry.js`, `src/agents/promptEngineer.js`, `src/agents/consistencyChecker.js`
- `ai-video-render-planning` -> `src/agents/videoComposer.js`, `README.md`
```

- [ ] **Step 4: Add a short pointer in the main README**

```md
## Project Skills

See `skills/project/README.md` for reusable project rules and workflow guidance.
```

- [ ] **Step 5: Review both files for clarity**

Run:
- `Get-Content skills/project/README.md`
- `Get-Content README.md`

Expected: both files mention the project skills directory consistently

- [ ] **Step 6: Commit**

```bash
git add skills/project/README.md README.md
git commit -m "docs: add project skills index"
```

---

### Task 2: Author `ai-video-script-design`

**Files:**
- Create: `skills/project/ai-video-script-design/SKILL.md`
- Modify: `skills/project/README.md`

- [ ] **Step 1: Draft the required skill header and usage section**

```md
---
name: ai-video-script-design
description: 用于把原始剧本拆解成项目可执行的结构化分镜数据。
---

# ai-video-script-design

## 什么时候使用
- 需要把剧本转换成结构化分镜
- 需要统一 `shots`、`characters`、`speaker`、`duration`
```

- [ ] **Step 2: Add input and output contracts**

```md
## 输入
- 原始剧本文本
- 风格或时长约束（可选）

## 输出
- `title`
- `characters`
- `shots[]`
```

- [ ] **Step 3: Add rules pulled from source behavior**

```md
## 必须遵守的规则
- `shots` 必须是数组
- 每个 shot 必须有稳定 `id`
- `duration` 缺失时补默认值
- `characters` 必须归一为字符串数组
- `speaker` 缺失时允许为空字符串
```

- [ ] **Step 4: Add failure cases and handling advice**

```md
## 常见失败场景
- `characters` 返回成对象数组
- `shots` 缺失或为空
- `duration` 不合理

## 处理建议
- 先做字段归一化
- 不满足最小结构时直接判失败
```

- [ ] **Step 5: Add source references and update index**

```md
## 来源文件
- `src/agents/scriptParser.js`
- `src/llm/prompts/scriptAnalysis.js`
```

- [ ] **Step 6: Review the skill against current source**

Run:
- `Get-Content skills/project/ai-video-script-design/SKILL.md`
- `Get-Content src/agents/scriptParser.js`
- `Get-Content src/llm/prompts/scriptAnalysis.js`

Expected: the skill matches current runtime expectations and does not invent unsupported rules

- [ ] **Step 7: Commit**

```bash
git add skills/project/ai-video-script-design/SKILL.md skills/project/README.md
git commit -m "docs: add script design project skill"
```

---

### Task 3: Author `ai-video-visual-design`

**Files:**
- Create: `skills/project/ai-video-visual-design/SKILL.md`
- Modify: `skills/project/README.md`

- [ ] **Step 1: Draft the skill header and usage section**

```md
---
name: ai-video-visual-design
description: 用于沉淀角色视觉设定、分镜 Prompt 设计与一致性修正建议。
---

# ai-video-visual-design

## 什么时候使用
- 需要生成角色视觉档案
- 需要为分镜生成图像 Prompt
- 需要整理一致性修正建议
```

- [ ] **Step 2: Add input and output sections**

```md
## 输入
- 角色列表
- 分镜信息
- 风格

## 输出
- 角色视觉档案
- `basePromptTokens`
- `image_prompt`
- `negative_prompt`
- 一致性修正建议
```

- [ ] **Step 3: Add prompt and character rules**

```md
## 必须遵守的规则
- 角色视觉特征要优先描述可见信息
- `basePromptTokens` 需稳定复用
- 风格词、镜头词、质量词分层组合
- negative prompt 单独维护
```

- [ ] **Step 4: Add consistency guidance**

```md
## 常见失败场景
- 角色外观漂移
- 风格词污染主体特征
- 修正建议过于抽象

## 处理建议
- 建议必须落到可见特征
- 修正建议优先作用于角色稳定特征
```

- [ ] **Step 5: Add source references and update index**

```md
## 来源文件
- `src/agents/characterRegistry.js`
- `src/agents/promptEngineer.js`
- `src/llm/prompts/promptEngineering.js`
- `src/agents/consistencyChecker.js`
```

- [ ] **Step 6: Review the skill against current source**

Run:
- `Get-Content skills/project/ai-video-visual-design/SKILL.md`
- `Get-Content src/agents/characterRegistry.js`
- `Get-Content src/agents/promptEngineer.js`
- `Get-Content src/agents/consistencyChecker.js`

Expected: the skill stays at the rules layer and matches current behavior

- [ ] **Step 7: Commit**

```bash
git add skills/project/ai-video-visual-design/SKILL.md skills/project/README.md
git commit -m "docs: add visual design project skill"
```

---

### Task 4: Author `ai-video-render-planning`

**Files:**
- Create: `skills/project/ai-video-render-planning/SKILL.md`
- Modify: `skills/project/README.md`

- [ ] **Step 1: Draft the skill header and usage section**

```md
---
name: ai-video-render-planning
description: 用于沉淀视频渲染计划、音频时间线、字幕对齐和 FFmpeg 排障规则。
---

# ai-video-render-planning

## 什么时候使用
- 需要规划镜头、音频、字幕如何合成为成片
- 需要整理 FFmpeg 合成策略
- 需要排查视频合成失败
```

- [ ] **Step 2: Add input and output sections**

```md
## 输入
- `shots`
- `imageResults`
- `audioResults`
- 输出视频要求

## 输出
- 渲染计划
- 音频时间线
- 字幕对齐原则
- FFmpeg 排障建议
```

- [ ] **Step 3: Add render planning rules**

```md
## 必须遵守的规则
- 先构建稳定的 composition plan
- 音频时间线必须覆盖全部分镜
- 无对白镜头需要明确静音策略
- 字幕时间以视觉计划为主
```

- [ ] **Step 4: Add troubleshooting and platform guidance**

```md
## 常见失败场景
- 多段音频未正确拼接
- 字幕时间轴与视频不一致
- FFmpeg 未安装或字体缺失

## 处理建议
- 先验证 render plan 再执行 FFmpeg
- 区分 Windows / macOS / Linux 安装方式
```

- [ ] **Step 5: Add source references and update index**

```md
## 来源文件
- `src/agents/videoComposer.js`
- `README.md`
```

- [ ] **Step 6: Review the skill against current source**

Run:
- `Get-Content skills/project/ai-video-render-planning/SKILL.md`
- `Get-Content src/agents/videoComposer.js`
- `Get-Content README.md`

Expected: the skill documents current planning rules without copying implementation details verbatim

- [ ] **Step 7: Commit**

```bash
git add skills/project/ai-video-render-planning/SKILL.md skills/project/README.md
git commit -m "docs: add render planning project skill"
```

---

### Task 5: Cross-Check the Three Skills as a Cohesive Set

**Files:**
- Modify: `skills/project/README.md`
- Modify: `skills/project/ai-video-script-design/SKILL.md`
- Modify: `skills/project/ai-video-visual-design/SKILL.md`
- Modify: `skills/project/ai-video-render-planning/SKILL.md`

- [ ] **Step 1: Review for overlap and missing boundaries**

Run:
- `Get-Content skills/project/ai-video-script-design/SKILL.md`
- `Get-Content skills/project/ai-video-visual-design/SKILL.md`
- `Get-Content skills/project/ai-video-render-planning/SKILL.md`

Expected: no skill owns `director`, provider execution, or generic runtime orchestration

- [ ] **Step 2: Tighten the README index wording**

```md
## Boundary Notes
- These skills document project rules, not runtime code.
- `director`, `imageGenerator`, and `ttsAgent` are intentionally not skillized in this phase.
```

- [ ] **Step 3: Add “not covered” notes where needed**

```md
## 不覆盖的内容
- provider 调用实现
- 状态恢复与任务编排
```

- [ ] **Step 4: Re-read all four markdown files**

Run:
- `Get-Content skills/project/README.md`
- `Get-Content skills/project/ai-video-script-design/SKILL.md`
- `Get-Content skills/project/ai-video-visual-design/SKILL.md`
- `Get-Content skills/project/ai-video-render-planning/SKILL.md`

Expected: wording is consistent and boundaries are explicit

- [ ] **Step 5: Commit**

```bash
git add skills/project/README.md skills/project/ai-video-script-design/SKILL.md skills/project/ai-video-visual-design/SKILL.md skills/project/ai-video-render-planning/SKILL.md
git commit -m "docs: refine project skill boundaries"
```

---

### Task 6: Final Verification

**Files:**
- Modify: `README.md`
- Modify: `skills/project/README.md`
- Modify: `skills/project/ai-video-script-design/SKILL.md`
- Modify: `skills/project/ai-video-visual-design/SKILL.md`
- Modify: `skills/project/ai-video-render-planning/SKILL.md`

- [ ] **Step 1: Verify all skill files exist**

Run:
- `Get-Item skills/project/README.md`
- `Get-Item skills/project/ai-video-script-design/SKILL.md`
- `Get-Item skills/project/ai-video-visual-design/SKILL.md`
- `Get-Item skills/project/ai-video-render-planning/SKILL.md`

Expected: all files are present

- [ ] **Step 2: Verify repository references are still accurate**

Run: `rg -n "skills/project|ai-video-script-design|ai-video-visual-design|ai-video-render-planning" README.md skills/project -S`
Expected: references resolve to the new project skills and use consistent naming

- [ ] **Step 3: Spot-check source mappings**

Run:
- `rg -n "scriptParser|characterRegistry|promptEngineer|consistencyChecker|videoComposer" skills/project -S`

Expected: each skill points back to the right runtime source files

- [ ] **Step 4: Commit**

```bash
git add README.md skills/project
git commit -m "docs: add initial project skill set"
```

---

## Notes for the Implementer

- Keep the scope limited to the three approved skills from the spec.
- Do not move runtime code into `skills/`.
- Prefer concise, directive writing over narrative explanation inside each `SKILL.md`.
- If current code and current docs disagree, record the rule that matches runtime behavior and note the source file explicitly.
