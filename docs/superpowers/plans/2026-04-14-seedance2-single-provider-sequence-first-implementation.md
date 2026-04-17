# Seedance Single-Provider Sequence-First Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前视频链路收口为单一 provider client，并把 `sequence` 提升为主路径能力、把 `bridge` 收缩为段间与高风险切口修复层。

**Architecture:** 保留 `shot / sequence / bridge` 三种业务语义，但统一到底层视频 provider client。先完成 provider client 收口与职责边界约束，再调整 planner/router/composer 的优先级与互斥规则，最后更新文档与配置口径。

**Tech Stack:** Node.js, existing agent pipeline, Seedance/fallback video API adapters, Markdown docs, Node test runner

---

## File Structure

本计划涉及的核心文件和责任如下：

- Modify: `src/apis/seedanceVideoApi.js`
  责任：主 Seedance provider request 构造与提交执行
- Modify: `src/apis/fallbackVideoApi.js`
  责任：现有 fallback/relay provider request 构造与提交执行
- Create: `src/apis/unifiedVideoProviderClient.js`
  责任：统一 `shot / sequence / bridge` 的 provider client 接口、提交、轮询、下载与错误归一
- Modify: `src/agents/seedanceVideoAgent.js`
  责任：改为调用统一 client，而不是直接复用 fallback clip API
- Modify: `src/agents/sora2VideoAgent.js`
  责任：兼容旧入口，但收缩为统一 client 的兼容壳层
- Modify: `src/agents/sequenceClipGenerator.js`
  责任：让 `sequence` 显式走统一 client，并区分 `seedance` 主路径与兼容路径
- Modify: `src/agents/bridgeClipGenerator.js`
  责任：让 `bridge` 走统一 client，并限制其职责为段间修复层
- Modify: `src/agents/bridgeShotPlanner.js`
  责任：加入 sequence 边界意识，避免 sequence 内部重复规划 bridge
- Modify: `src/agents/actionSequencePlanner.js`
  责任：维持 sequence 识别，但明确其主路径优先级
- Modify: `src/agents/actionSequenceRouter.js`
  责任：强化 sequence package 作为 Seedance 2.0 主输入包装层
- Modify: `src/agents/videoRouter.js`
  责任：统一用户配置口径，减少 `fallback_video` 对主路径的影响
- Modify: `src/agents/director.js`
  责任：收紧 `sequence / shot / bridge` 的覆盖优先级、互斥关系和 compose 输入
- Modify: `README.md`
  责任：更新单 provider 口径与主流程说明
- Modify: `.env.example`
  责任：收口用户侧配置入口，弱化 `fallback_video`
- Test: `tests/seedanceVideoApi.test.js`
- Test: `tests/videoRouter.test.js`
- Test: `tests/bridgeClipGenerator.test.js`
- Test: `tests/actionSequenceRouter.test.js`
- Test: `tests/sequenceClipGenerator.test.js`
- Test: `tests/director.sequence.integration.test.js`
- Test: `tests/videoComposer.sequence.test.js`

### Task 1: Freeze Current Behavior With Targeted Tests

**Files:**
- Modify: `tests/videoRouter.test.js`
- Modify: `tests/sequenceClipGenerator.test.js`
- Modify: `tests/bridgeClipGenerator.test.js`
- Modify: `tests/director.sequence.integration.test.js`

- [x] **Step 1: Write failing tests for desired provider behavior**

Add tests that assert:

- `VIDEO_PROVIDER=seedance` routes shot packages to `seedance`
- `sequence` packages prefer unified Seedance client on main path
- `bridge` planning does not re-plan inside approved sequence-covered shot spans
- director compose priority remains `sequence > shot video > bridge`

- [x] **Step 2: Run the targeted tests to verify gaps**

Run:

```bash
node --test tests/videoRouter.test.js tests/sequenceClipGenerator.test.js tests/bridgeClipGenerator.test.js tests/director.sequence.integration.test.js
```

Expected:

- At least one test fails because current implementation still routes `seedance` work through fallback wrappers or lacks sequence/bridge exclusivity.

- [ ] **Step 3: Commit the failing test baseline**

```bash
git add tests/videoRouter.test.js tests/sequenceClipGenerator.test.js tests/bridgeClipGenerator.test.js tests/director.sequence.integration.test.js
git commit -m "test: lock target provider and sequence bridge behavior"
```

### Task 2: Introduce Unified Video Provider Client

**Files:**
- Create: `src/apis/unifiedVideoProviderClient.js`
- Modify: `src/apis/seedanceVideoApi.js`
- Modify: `src/apis/fallbackVideoApi.js`
- Test: `tests/seedanceVideoApi.test.js`

- [x] **Step 1: Write the failing client-level tests**

Add tests that assert a unified client can:

- accept `shot / sequence / bridge` package metadata
- submit via `seedance` or fallback-backed protocol
- normalize request summaries and provider errors consistently

- [x] **Step 2: Run the API tests to verify they fail**

Run:

```bash
node --test tests/seedanceVideoApi.test.js
```

Expected:

- FAIL due to missing `unifiedVideoProviderClient` interface or mismatched provider routing behavior.

- [x] **Step 3: Implement the minimal unified client**

Implement `src/apis/unifiedVideoProviderClient.js` with:

- provider selection
- request assembly dispatch
- task execution dispatch
- normalized result/error contract

Keep `seedanceVideoApi.js` and `fallbackVideoApi.js` focused on provider-specific request building and execution.

- [x] **Step 4: Run the API tests to verify they pass**

Run:

```bash
node --test tests/seedanceVideoApi.test.js
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/apis/unifiedVideoProviderClient.js src/apis/seedanceVideoApi.js src/apis/fallbackVideoApi.js tests/seedanceVideoApi.test.js
git commit -m "feat: add unified video provider client"
```

### Task 3: Move Shot, Sequence, and Bridge Generators Onto The Unified Client

**Files:**
- Modify: `src/agents/seedanceVideoAgent.js`
- Modify: `src/agents/sora2VideoAgent.js`
- Modify: `src/agents/sequenceClipGenerator.js`
- Modify: `src/agents/bridgeClipGenerator.js`
- Test: `tests/sequenceClipGenerator.test.js`
- Test: `tests/bridgeClipGenerator.test.js`

- [x] **Step 1: Write failing generator tests**

Add tests that assert:

- `seedanceVideoAgent` no longer directly imports fallback clip generation
- `sequenceClipGenerator` uses unified client for `seedance`
- `bridgeClipGenerator` uses unified client for both `seedance` and compatibility paths

- [x] **Step 2: Run the generator tests to verify failure**

Run:

```bash
node --test tests/sequenceClipGenerator.test.js tests/bridgeClipGenerator.test.js
```

Expected:

- FAIL because current code still calls fallback clip generation directly.

- [x] **Step 3: Implement minimal generator refactor**

Refactor agents to call the unified client with business-specific package types while preserving existing artifact output shapes.

- [x] **Step 4: Run the generator tests to verify pass**

Run:

```bash
node --test tests/sequenceClipGenerator.test.js tests/bridgeClipGenerator.test.js
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/seedanceVideoAgent.js src/agents/sora2VideoAgent.js src/agents/sequenceClipGenerator.js src/agents/bridgeClipGenerator.js tests/sequenceClipGenerator.test.js tests/bridgeClipGenerator.test.js
git commit -m "refactor: route video generators through unified client"
```

### Task 4: Enforce Sequence-First Planning And Bridge Narrowing

**Files:**
- Modify: `src/agents/actionSequencePlanner.js`
- Modify: `src/agents/actionSequenceRouter.js`
- Modify: `src/agents/bridgeShotPlanner.js`
- Modify: `src/agents/videoRouter.js`
- Test: `tests/actionSequenceRouter.test.js`
- Test: `tests/videoRouter.test.js`

- [x] **Step 1: Write failing planning tests**

Add tests that assert:

- `sequence` remains the preferred path for qualifying action spans
- `bridge` is not planned inside sequence-covered spans
- `videoRouter` defaults align with single-provider semantics

- [x] **Step 2: Run planning tests to verify failure**

Run:

```bash
node --test tests/actionSequenceRouter.test.js tests/videoRouter.test.js
```

Expected:

- FAIL because bridge/sequence exclusivity and provider semantics are not yet fully enforced.

- [x] **Step 3: Implement planning and routing changes**

Update planners/routers so that:

- `sequence` packages are first-class Seedance 2.0 inputs
- `bridge` only targets uncovered, high-risk boundaries
- provider naming is normalized around the single-provider user story

- [x] **Step 4: Run planning tests to verify pass**

Run:

```bash
node --test tests/actionSequenceRouter.test.js tests/videoRouter.test.js
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/actionSequencePlanner.js src/agents/actionSequenceRouter.js src/agents/bridgeShotPlanner.js src/agents/videoRouter.js tests/actionSequenceRouter.test.js tests/videoRouter.test.js
git commit -m "feat: enforce sequence first and narrow bridge planning"
```

### Task 5: Update Director Compose Rules And Delivery Semantics

**Files:**
- Modify: `src/agents/director.js`
- Test: `tests/director.sequence.integration.test.js`
- Test: `tests/videoComposer.sequence.test.js`

- [x] **Step 1: Write failing integration tests**

Add tests that assert:

- sequence-approved spans suppress duplicate bridge/shot insertion for covered shots
- bridge clips only remain on valid uncovered segment boundaries
- delivery summaries still report sequence and bridge usage clearly

- [x] **Step 2: Run the integration tests to verify failure**

Run:

```bash
node --test tests/director.sequence.integration.test.js tests/videoComposer.sequence.test.js
```

Expected:

- FAIL because current director logic still permits overlapping semantics in edge cases.

- [x] **Step 3: Implement minimal director changes**

Update `director.js` to:

- keep `sequence > shot video > bridge` ordering
- suppress sequence-internal bridge application
- preserve existing QA gate behavior

- [x] **Step 4: Run the integration tests to verify pass**

Run:

```bash
node --test tests/director.sequence.integration.test.js tests/videoComposer.sequence.test.js
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/director.js tests/director.sequence.integration.test.js tests/videoComposer.sequence.test.js
git commit -m "feat: align director timeline with sequence first semantics"
```

### Task 6: Update User-Facing Config And Docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-04-14-seedance2-sequence-bridge-architecture-review.md`

- [x] **Step 1: Write the documentation diffs**

Update docs to reflect:

- single-provider user story
- `sequence` as main continuity gain layer
- `bridge` as narrowed transition layer
- reduced emphasis on `fallback_video` in user-facing setup

- [x] **Step 2: Verify documentation references stay coherent**

Run:

```bash
rg -n "fallback_video|Seedance|sequence|bridge" README.md .env.example docs/superpowers/plans/2026-04-14-seedance2-sequence-bridge-architecture-review.md
```

Expected:

- References remain intentional, with `fallback_video` no longer presented as the primary user path.

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md docs/superpowers/plans/2026-04-14-seedance2-sequence-bridge-architecture-review.md
git commit -m "docs: update single provider sequence first guidance"
```

### Task 7: Full Verification

**Files:**
- No new files

- [x] **Step 1: Run the focused regression suite**

Run:

```bash
node --test tests/seedanceVideoApi.test.js tests/videoRouter.test.js tests/actionSequenceRouter.test.js tests/sequenceClipGenerator.test.js tests/bridgeClipGenerator.test.js tests/director.sequence.integration.test.js tests/videoComposer.sequence.test.js
```

Expected:

- PASS

- [x] **Step 2: Run the broader acceptance suite**

Run:

```bash
node --test tests/runArtifacts.test.js tests/resumeFromStep.test.js tests/pipeline.acceptance.test.js
```

Expected:

- PASS

- [x] **Step 3: Review final diff**

Run:

```bash
git diff --stat HEAD~6..HEAD
git diff -- src/apis/unifiedVideoProviderClient.js src/agents/seedanceVideoAgent.js src/agents/sequenceClipGenerator.js src/agents/bridgeClipGenerator.js src/agents/director.js README.md .env.example
```

Expected:

- Diff shows unified client introduction, sequence-first routing, narrowed bridge semantics, and updated user-facing docs.

- [ ] **Step 4: Commit verification checkpoint**

```bash
git add -A
git commit -m "chore: verify seedance single provider sequence first refactor"
```

## Notes For Agentic Workers

- Keep `shot / sequence / bridge` as separate business package types even after client unification.
- Do not delete `bridge` outright in this refactor.
- Do not remove compatibility code until all targeted tests and acceptance tests pass.
- Preserve artifact file names unless there is a strong reason to migrate them, because downstream SOP and runbook docs may depend on them.
- If real provider differences force a temporary adapter layer, keep it inside `src/apis/unifiedVideoProviderClient.js` instead of leaking that complexity back into agents.

## Expected End State

- 用户侧默认只理解一个主视频 provider 口径
- `sequence` 成为连续动作段的主路径能力
- `bridge` 只处理段间与高风险切口
- 底层视频 API 调用统一到一个 provider client
- 现有 artifact、resume、QA 和 compose 闭环继续可用
