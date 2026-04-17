# Harness Engineering Retrofit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前漫剧生成系统改造成一个可观测、可回放、可调优的 harness，先让 `Director`、artifact、QA、provider 这条主链具备统一执行合同和统一恢复语义。

**Architecture:** 保留现有业务链路不动，只在 harness 层补统一输入输出合同、统一 observation envelope、统一 stop/retry 语义和统一 run-level 聚合。第一期先改 `Director`、`runArtifacts`、关键 agent 的 artifact 写法和 QA gate，再补测试和文档。

**Tech Stack:** Node.js, existing agent pipeline, Markdown docs, Node test runner

---

## File Structure

第一期只动这些文件，职责先锁死：

- Modify: `src/utils/runArtifacts.js`
  责任：定义统一的 run/agent artifact 结构、标准输出目录、输入输出摘要字段
- Modify: `src/agents/director.js`
  责任：作为 harness controller，统一收集每步输入输出、stop/retry 决策和 run-level 聚合
- Modify: `src/agents/characterRegistry.js`
  责任：补统一的 execution/observation envelope，确保身份问题可追踪
- Modify: `src/agents/characterRefSheetGenerator.js`
  责任：为三视图失败提供标准化错误摘要和 stop gate 输入
- Modify: `src/agents/videoRouter.js`
  责任：统一 provider hints / reference material 的 observation 输出
- Modify: `src/agents/ttsAgent.js`
  责任：统一 TTS 的 voice resolution 观察字段
- Modify: `src/utils/voiceCastStore.js`
  责任：统一 voice cast 的绑定/复用结果字段
- Modify: `src/agents/bridgeQaAgent.js`
  责任：统一 bridge QA 结果 envelope
- Modify: `src/agents/sequenceQaAgent.js`
  责任：统一 sequence QA 结果 envelope
- Modify: `src/agents/shotQaAgent.js`
  责任：统一 shot QA 结果 envelope
- Modify: `README.md`
  责任：补 harness 改造后的使用心智和验收入口
- Modify: `docs/agents/README.md`
  责任：说明新 harness 观察层和各 agent 的职责边界
- Test: `tests/director.project-run.test.js`
- Test: `tests/director.sequence.integration.test.js`
- Test: `tests/director.artifacts.test.js`
- Test: `tests/characterRefSheetGenerator.test.js`
- Test: `tests/videoRouter.test.js`
- Test: `tests/ttsAgent.voicePreset.test.js`
- Test: `tests/voiceCastStore.test.js`
- Test: `tests/bridgeQaAgent.test.js`
- Test: `tests/sequenceQaAgent.test.js`
- Test: `tests/shotQaAgent.test.js`

## Task 1: Define The Harness Contract

**Files:**
- Modify: `src/utils/runArtifacts.js`
- Modify: `src/agents/director.js`
- Test: `tests/director.artifacts.test.js`

- [ ] **Step 1: Write the failing contract tests**

Add tests that assert:

- run-level manifest can expose a normalized `status`
- each agent manifest can expose `status`, `summary`, `nextActions`, `artifacts`
- Director can aggregate the same shape across agents

- [ ] **Step 2: Run the targeted tests to verify the current gap**

Run:

```bash
node --test tests/director.artifacts.test.js
```

Expected:

- FAIL because the current artifact contract is still fragmented across agents.

- [ ] **Step 3: Implement minimal harness contract helpers**

Add helpers in `runArtifacts.js` for:

- normalized artifact envelope
- agent summary wrapper
- run-level aggregation wrapper

Keep the helpers small and backward-compatible.

- [ ] **Step 4: Run the tests again**

Run:

```bash
node --test tests/director.artifacts.test.js
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/runArtifacts.js src/agents/director.js tests/director.artifacts.test.js
git commit -m "feat: add normalized harness artifact contract"
```

## Task 2: Standardize Agent Observation Envelopes

**Files:**
- Modify: `src/agents/characterRegistry.js`
- Modify: `src/agents/characterRefSheetGenerator.js`
- Modify: `src/agents/videoRouter.js`
- Modify: `src/agents/ttsAgent.js`
- Modify: `src/utils/voiceCastStore.js`
- Test: `tests/characterRegistry.test.js`
- Test: `tests/characterRefSheetGenerator.test.js`
- Test: `tests/videoRouter.test.js`
- Test: `tests/ttsAgent.voicePreset.test.js`
- Test: `tests/voiceCastStore.test.js`

- [ ] **Step 1: Write the failing observation tests**

Add tests that assert each module can emit a compact observation object with:

- `status`
- `summary`
- `nextActions`
- `artifacts`

Focus on the most expensive / most failure-prone agents first.

- [ ] **Step 2: Run the tests to verify current outputs are inconsistent**

Run:

```bash
node --test tests/characterRegistry.test.js tests/characterRefSheetGenerator.test.js tests/videoRouter.test.js tests/ttsAgent.voicePreset.test.js tests/voiceCastStore.test.js
```

Expected:

- FAIL because current outputs are still ad hoc and file-specific.

- [ ] **Step 3: Implement minimal standardized observation fields**

Normalize existing artifact writers so they all emit the same top-level metadata.

- [ ] **Step 4: Run the tests again**

Run:

```bash
node --test tests/characterRegistry.test.js tests/characterRefSheetGenerator.test.js tests/videoRouter.test.js tests/ttsAgent.voicePreset.test.js tests/voiceCastStore.test.js
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/characterRegistry.js src/agents/characterRefSheetGenerator.js src/agents/videoRouter.js src/agents/ttsAgent.js src/utils/voiceCastStore.js tests/characterRegistry.test.js tests/characterRefSheetGenerator.test.js tests/videoRouter.test.js tests/ttsAgent.voicePreset.test.js tests/voiceCastStore.test.js
git commit -m "feat: standardize agent observation envelopes"
```

## Task 3: Add Early Stop Gates For High-Cost Failures

**Files:**
- Modify: `src/agents/director.js`
- Modify: `src/agents/characterRefSheetGenerator.js`
- Modify: `src/agents/bridgeQaAgent.js`
- Modify: `src/agents/sequenceQaAgent.js`
- Modify: `src/agents/shotQaAgent.js`
- Test: `tests/director.voicePreset.test.js`
- Test: `tests/bridgeQaAgent.test.js`
- Test: `tests/sequenceQaAgent.test.js`
- Test: `tests/shotQaAgent.test.js`

- [ ] **Step 1: Write the failing stop-gate tests**

Add tests that assert:

- 三视图失败会阻断后续视频链
- QA block 会阻断继续往下烧钱
- 关键 provider 前置条件不满足时会直接 stop

- [ ] **Step 2: Run the tests to verify the gap**

Run:

```bash
node --test tests/director.voicePreset.test.js tests/bridgeQaAgent.test.js tests/sequenceQaAgent.test.js tests/shotQaAgent.test.js
```

Expected:

- FAIL because some failure paths still rely on downstream fallback instead of explicit stop gates.

- [ ] **Step 3: Implement explicit stop / continue decisions**

Make Director and QA agents return enough structure to distinguish:

- hard stop
- safe retry
- fallback allowed
- manual review required

- [ ] **Step 4: Run the tests again**

Run:

```bash
node --test tests/director.voicePreset.test.js tests/bridgeQaAgent.test.js tests/sequenceQaAgent.test.js tests/shotQaAgent.test.js
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/director.js src/agents/characterRefSheetGenerator.js src/agents/bridgeQaAgent.js src/agents/sequenceQaAgent.js src/agents/shotQaAgent.js tests/director.voicePreset.test.js tests/bridgeQaAgent.test.js tests/sequenceQaAgent.test.js tests/shotQaAgent.test.js
git commit -m "feat: add harness stop gates for high-cost failures"
```

## Task 4: Surface Run-Level Debugging Signals

**Files:**
- Modify: `src/agents/director.js`
- Modify: `src/utils/runArtifacts.js`
- Modify: `README.md`
- Modify: `docs/agents/README.md`
- Test: `tests/director.project-run.test.js`

- [ ] **Step 1: Write the failing run-summary tests**

Add tests that assert the final run summary can answer:

- where it failed
- what was retried
- what was cached
- what was skipped
- what was manually reviewed

- [ ] **Step 2: Run the test to verify the current summary is too thin**

Run:

```bash
node --test tests/director.project-run.test.js
```

Expected:

- FAIL or expose missing fields in run summary output.

- [ ] **Step 3: Implement run-level summary upgrades**

Improve Director aggregation so the run summary is consistent and easy to scan.

- [ ] **Step 4: Run the test again**

Run:

```bash
node --test tests/director.project-run.test.js
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/director.js src/utils/runArtifacts.js README.md docs/agents/README.md tests/director.project-run.test.js
git commit -m "feat: improve run-level harness observability"
```

## Task 5: Update Documentation And Usage Guidance

**Files:**
- Modify: `README.md`
- Modify: `docs/agents/README.md`
- Modify: `docs/sop/qa-acceptance.md`
- Modify: `docs/superpowers/specs/2026-04-17-harness-engineering-retrofit-spec.md` if needed

- [ ] **Step 1: Update user-facing docs**

Document:

- why the harness changed
- what the new observation fields mean
- how to interpret stop gates
- where to look first when a run fails

- [ ] **Step 2: Review the docs manually**

Confirm the language is operational, not academic.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/agents/README.md docs/sop/qa-acceptance.md
git commit -m "docs: explain harness engineering retrofit"
```

