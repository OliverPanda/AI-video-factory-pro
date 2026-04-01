# Agent Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a focused agent documentation layer for AI Video Factory Pro using one overview document plus four core agent/chain documents.

**Architecture:** Keep runtime logic in `src/agents/` and add `docs/agents/` as a reader-friendly explanation layer. The overview document explains the full system map, while the four detailed documents cover the most important and complex agent boundaries without falling into one-file-per-agent sprawl.

**Tech Stack:** Markdown, existing source files in `src/agents/`, existing docs in `README.md`, Git

---

## File Structure

**Existing files to modify**
- `README.md`
  Responsibility: add a short pointer to the new `docs/agents/` documentation entry point.

**New files to create**
- `docs/agents/README.md`
  Responsibility: system overview, agent list, execution order, and entry points into detailed docs.
- `docs/agents/director.md`
  Responsibility: orchestration boundaries, pipeline steps, state handling, and resume/caching responsibilities.
- `docs/agents/script-parser.md`
  Responsibility: script parsing contract, output schema, defaults, and downstream dependencies.
- `docs/agents/visual-design.md`
  Responsibility: combined character registry, prompt engineering, and consistency review chain.
- `docs/agents/video-composer.md`
  Responsibility: render planning, audio timeline, subtitles, FFmpeg dependencies, and troubleshooting.

---

### Task 1: Create the Agent Documentation Entry Point

**Files:**
- Create: `docs/agents/README.md`
- Modify: `README.md`

- [ ] **Step 1: Write the initial overview skeleton**

```md
# Agent Documentation

## Agent List
- Director
- Script Parser
- Character Registry
- Prompt Engineer
- Consistency Checker
- TTS Agent
- Video Composer
```

- [ ] **Step 2: Add system flow and ownership summary**

```md
## Execution Order
1. Director loads script
2. Script Parser creates structured shots
3. Visual chain prepares characters and prompts
4. TTS and rendering stages complete the output
```

- [ ] **Step 3: Add links to detailed docs**

```md
## Detailed Docs
- `director.md`
- `script-parser.md`
- `visual-design.md`
- `video-composer.md`
```

- [ ] **Step 4: Add a pointer from the main README**

```md
## Agent Docs

See `docs/agents/README.md` for a guided explanation of the runtime agents.
```

- [ ] **Step 5: Review the overview and README together**

Run:
- `Get-Content docs/agents/README.md`
- `Get-Content README.md`

Expected: both documents consistently point readers to the agent documentation layer

- [ ] **Step 6: Commit**

```bash
git add docs/agents/README.md README.md
git commit -m "docs: add agent documentation overview"
```

---

### Task 2: Write `director.md`

**Files:**
- Create: `docs/agents/director.md`
- Modify: `docs/agents/README.md`

- [ ] **Step 1: Write the document skeleton with required sections**

```md
# Director

## 职责

## 输入

## 输出

## 主流程 / 处理步骤

## 依赖关系

## 常见问题

## 不负责的内容

## 来源文件

## 相关 skill
```

- [ ] **Step 2: Fill in the orchestration scope**

```md
## 职责
- 主编排入口
- 管理状态文件和断点续跑
- 控制各子 agent 的执行顺序
```

- [ ] **Step 3: Document state and resume behavior**

```md
## 常见问题
- 为什么重跑会重复执行
- 状态文件如何影响跳步
- 哪些结果会被缓存
```

- [ ] **Step 4: Add explicit “not responsible” boundaries**

```md
## 不负责的内容
- 不直接定义剧本结构规则
- 不直接定义视觉 Prompt 规则
- 不直接定义 FFmpeg 参数策略
```

- [ ] **Step 5: Add source references and related docs**

```md
## 来源文件
- `src/agents/director.js`

## 相关 skill
- `skills/project/ai-video-script-design/SKILL.md`
- `skills/project/ai-video-visual-design/SKILL.md`
- `skills/project/ai-video-render-planning/SKILL.md`
```

- [ ] **Step 6: Review against source**

Run:
- `Get-Content docs/agents/director.md`
- `Get-Content src/agents/director.js`

Expected: document explains orchestration behavior without copying code line-for-line

- [ ] **Step 7: Commit**

```bash
git add docs/agents/director.md docs/agents/README.md
git commit -m "docs: add director agent document"
```

---

### Task 3: Write `script-parser.md`

**Files:**
- Create: `docs/agents/script-parser.md`
- Modify: `docs/agents/README.md`

- [ ] **Step 1: Write the document skeleton**

```md
# Script Parser

## 职责

## 输入

## 输出

## 主流程 / 处理步骤

## 依赖关系

## 常见问题

## 不负责的内容

## 来源文件

## 相关 skill
```

- [ ] **Step 2: Add the output contract**

```md
## 输出
- `title`
- `characters`
- `shots[]`
- 每个 shot 的 `id`、`duration`、`dialogue`、`speaker`、`characters`
```

- [ ] **Step 3: Document normalization and defaults**

```md
## 主流程 / 处理步骤
- 调用文本 LLM 解析剧本
- 校验最小结构
- 补默认值
- 归一化 `characters`
```

- [ ] **Step 4: Add downstream dependency notes**

```md
## 依赖关系
- Character Registry 依赖角色列表
- Prompt Engineer 依赖 shots 字段
- TTS 依赖 dialogue / speaker
```

- [ ] **Step 5: Add source and related skill references**

```md
## 来源文件
- `src/agents/scriptParser.js`
- `src/llm/prompts/scriptAnalysis.js`

## 相关 skill
- `skills/project/ai-video-script-design/SKILL.md`
```

- [ ] **Step 6: Review against source**

Run:
- `Get-Content docs/agents/script-parser.md`
- `Get-Content src/agents/scriptParser.js`
- `Get-Content src/llm/prompts/scriptAnalysis.js`

Expected: document accurately describes parser outputs and normalization rules

- [ ] **Step 7: Commit**

```bash
git add docs/agents/script-parser.md docs/agents/README.md
git commit -m "docs: add script parser agent document"
```

---

### Task 4: Write `visual-design.md`

**Files:**
- Create: `docs/agents/visual-design.md`
- Modify: `docs/agents/README.md`

- [ ] **Step 1: Write the combined chain skeleton**

```md
# Visual Design Chain

## 覆盖范围
- Character Registry
- Prompt Engineer
- Consistency Checker
```

- [ ] **Step 2: Add chain responsibilities**

```md
## 职责
- 生成人物视觉档案
- 生成分镜图像 Prompt
- 审核角色跨镜头一致性
```

- [ ] **Step 3: Add the data flow between the three parts**

```md
## 主流程 / 处理步骤
1. Character Registry 产出角色卡
2. Prompt Engineer 组合 Prompt
3. Consistency Checker 给出评分与修正建议
```

- [ ] **Step 4: Add boundaries and failure cases**

```md
## 常见问题
- 角色特征漂移
- Prompt 词汇污染
- 一致性建议不可执行

## 不负责的内容
- 不直接执行图像 provider 调用
- 不负责任务状态编排
```

- [ ] **Step 5: Add source and skill references**

```md
## 来源文件
- `src/agents/characterRegistry.js`
- `src/agents/promptEngineer.js`
- `src/agents/consistencyChecker.js`

## 相关 skill
- `skills/project/ai-video-visual-design/SKILL.md`
```

- [ ] **Step 6: Review against source**

Run:
- `Get-Content docs/agents/visual-design.md`
- `Get-Content src/agents/characterRegistry.js`
- `Get-Content src/agents/promptEngineer.js`
- `Get-Content src/agents/consistencyChecker.js`

Expected: document explains the chain coherently and does not split overlapping responsibilities artificially

- [ ] **Step 7: Commit**

```bash
git add docs/agents/visual-design.md docs/agents/README.md
git commit -m "docs: add visual design chain document"
```

---

### Task 5: Write `video-composer.md`

**Files:**
- Create: `docs/agents/video-composer.md`
- Modify: `docs/agents/README.md`

- [ ] **Step 1: Write the document skeleton**

```md
# Video Composer

## 职责

## 输入

## 输出

## 主流程 / 处理步骤

## 依赖关系

## 常见问题

## 不负责的内容

## 来源文件

## 相关 skill
```

- [ ] **Step 2: Add the render planning scope**

```md
## 职责
- 基于分镜、图片、音频生成 composition plan
- 生成字幕文件
- 调用 FFmpeg 产出最终视频
```

- [ ] **Step 3: Add audio and subtitle planning notes**

```md
## 主流程 / 处理步骤
- 过滤失败镜头
- 生成 composition plan
- 对齐字幕时间轴
- 处理音频输入并执行最终合成
```

- [ ] **Step 4: Add troubleshooting and platform notes**

```md
## 常见问题
- FFmpeg 未安装
- 多段音频对齐失败
- 字幕字体缺失
- 不同平台行为差异
```

- [ ] **Step 5: Add source and skill references**

```md
## 来源文件
- `src/agents/videoComposer.js`
- `README.md`

## 相关 skill
- `skills/project/ai-video-render-planning/SKILL.md`
```

- [ ] **Step 6: Review against source**

Run:
- `Get-Content docs/agents/video-composer.md`
- `Get-Content src/agents/videoComposer.js`
- `Get-Content README.md`

Expected: document reflects current rendering behavior and known operational concerns

- [ ] **Step 7: Commit**

```bash
git add docs/agents/video-composer.md docs/agents/README.md
git commit -m "docs: add video composer agent document"
```

---

### Task 6: Cross-Check the Documentation Set

**Files:**
- Modify: `docs/agents/README.md`
- Modify: `docs/agents/director.md`
- Modify: `docs/agents/script-parser.md`
- Modify: `docs/agents/visual-design.md`
- Modify: `docs/agents/video-composer.md`

- [ ] **Step 1: Re-read all agent docs as one set**

Run:
- `Get-Content docs/agents/README.md`
- `Get-Content docs/agents/director.md`
- `Get-Content docs/agents/script-parser.md`
- `Get-Content docs/agents/visual-design.md`
- `Get-Content docs/agents/video-composer.md`

Expected: responsibilities are complementary and there is no accidental one-agent-one-doc drift

- [ ] **Step 2: Tighten overlaps and boundaries**

```md
## 不负责的内容
- 指向相邻文档，而不是重复解释对方职责
```

- [ ] **Step 3: Ensure each detailed doc links back to the overview**

```md
See also: `docs/agents/README.md`
```

- [ ] **Step 4: Spot-check source references**

Run: `rg -n "来源文件|相关 skill|See also" docs/agents -S`
Expected: every detailed doc includes sources and related links

- [ ] **Step 5: Commit**

```bash
git add docs/agents
git commit -m "docs: refine agent documentation set"
```

---

## Notes for the Implementer

- Keep the scope limited to the five approved files.
- Do not create separate docs for `imageGenerator`, `ttsAgent`, or standalone `consistencyChecker` in this phase.
- Prefer boundary explanations over long code walkthroughs.
- Where `docs/agents` overlaps with `skills/project`, keep `docs/agents` focused on structure and flow, not rule templates.
