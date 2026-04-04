# Composition Agent Dual Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the composition pipeline to support both a platform-level composition contract and a legacy compatibility adapter without breaking the current `director -> videoComposer` flow.

**Architecture:** Keep the existing FFmpeg rendering path intact, but wrap it with a normalization layer that accepts either a platform `CompositionJob` or the current repo's legacy agent outputs. Preserve current artifact files and runtime behavior while returning a structured composition result with delivery report and artifact index.

**Tech Stack:** Node.js, fluent-ffmpeg, existing run-artifact layout, Node test runner

---

### Task 1: Add Protocol Shapes And Legacy Adapter

**Files:**
- Modify: `src/agents/videoComposer.js`
- Test: `tests/videoComposer.test.js`

- [ ] **Step 1: Write failing adapter tests**

Add tests for:
- mapping `shot.id -> shotId`
- preserving original shot order as `order`
- normalizing `duration || durationSec || 3`
- mapping `dialogue` to inline subtitle source
- selecting visuals with `lipsync > animation > static`

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/videoComposer.test.js`
Expected: FAIL because adapter helpers and protocol builders do not exist yet.

- [ ] **Step 3: Add internal protocol builders**

In `src/agents/videoComposer.js`, add focused helpers for:
- `normalizeLegacyShot(...)`
- `buildLegacyAssetBundle(...)`
- `adaptLegacyComposeInput(...)`
- `buildCompositionJobPlan(...)`

Keep these as internal functions plus selective `__testables` exports.

- [ ] **Step 4: Implement minimal passing adapter logic**

Implement:
- `shot.id -> shotId`
- `shots` array index -> `order`
- `durationMs` from `duration`, then `durationSec`, then `3s`
- inline subtitle source from `shot.dialogue`
- asset bundle generation from `imageResults`, `audioResults`, `animationClips`, `lipsyncResults`

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test tests/videoComposer.test.js`
Expected: PASS for adapter and plan-shape scenarios.

- [ ] **Step 6: Commit**

```bash
git add src/agents/videoComposer.js tests/videoComposer.test.js docs/superpowers/plans/2026-04-04-composition-agent-dual-protocol-implementation.md
git commit -m "feat: add composition protocol adapter"
```

### Task 2: Add Dual Entrypoints Without Breaking Legacy Callers

**Files:**
- Modify: `src/agents/videoComposer.js`
- Test: `tests/videoComposer.test.js`

- [ ] **Step 1: Write failing entrypoint tests**

Add tests for:
- `composeFromLegacy(...)`
- `composeFromJob(...)`
- old `composeVideo(...)` still accepting the current signature

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/videoComposer.test.js`
Expected: FAIL because dual entrypoints do not exist.

- [ ] **Step 3: Implement structured result flow**

Add:
- `composeFromLegacy(input, outputPath, options)`
- `composeFromJob(job, outputPath, options)`

Make old `composeVideo(...)` call `composeFromLegacy(...)` internally.

Structured result must include:
- `status`
- `outputVideo`
- `report`
- `artifacts`

Keep compatibility by ensuring `result.outputVideo.uri === outputPath`.

- [ ] **Step 4: Preserve current render behavior**

Do not rewrite FFmpeg flow. Reuse current:
- path validation
- subtitle generation
- visual segment build
- audio mix
- render path
- artifact file generation

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test tests/videoComposer.test.js`
Expected: PASS for legacy entrypoint, job entrypoint, and old-call compatibility.

- [ ] **Step 6: Commit**

```bash
git add src/agents/videoComposer.js tests/videoComposer.test.js
git commit -m "feat: add dual composition entrypoints"
```

### Task 3: Wire QA Blocking And Warning Aggregation

**Files:**
- Modify: `src/agents/videoComposer.js`
- Test: `tests/videoComposer.test.js`

- [ ] **Step 1: Write failing QA gate tests**

Add tests for:
- `ttsQaReport.status === "block"` blocks render
- `lipsyncReport.status === "block"` blocks render
- warning reports still render but surface warnings
- manual review ids are merged from TTS QA and lip-sync QA

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/videoComposer.test.js`
Expected: FAIL because QA gate logic is not yet enforced in composer.

- [ ] **Step 3: Implement legacy QA compatibility rules**

In `composeFromLegacy(...)`:
- stop before FFmpeg if `ttsQaReport.block` or `lipsyncReport.block`
- produce `blocked` result with reasons
- merge warning text into delivery report
- include `manualReviewPlan.recommendedShotIds`, `manualReviewShots`, `fallbackCount`, `fallbackShots`, `downgradedCount`

- [ ] **Step 4: Keep current delivery semantics**

Do not change `director` gate logic yet; composer should still be correct even if caller already blocks earlier.

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test tests/videoComposer.test.js`
Expected: PASS for block/warn/manual-review aggregation scenarios.

- [ ] **Step 6: Commit**

```bash
git add src/agents/videoComposer.js tests/videoComposer.test.js
git commit -m "feat: add composition qa gate compatibility"
```

### Task 4: Return Delivery Report And Artifact Index

**Files:**
- Modify: `src/agents/videoComposer.js`
- Test: `tests/videoComposer.artifacts.test.js`

- [ ] **Step 1: Write failing artifact result tests**

Add tests for:
- successful render returns artifact index paths
- failed render returns `ffmpeg-command` and `ffmpeg-stderr` paths
- delivery report matches generated metrics

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/videoComposer.artifacts.test.js`
Expected: FAIL because return value is not yet structured.

- [ ] **Step 3: Implement artifact index builder**

Map existing artifact files into:
- `composePlanUri`
- `segmentIndexUri`
- `metricsUri`
- `qaOverviewUri`
- optional failure evidence files

Use current artifact paths. Do not rename files or directories.

- [ ] **Step 4: Implement delivery report builder**

Populate:
- composed shot count
- downgraded shot count
- warnings
- blocked reasons
- simple QA summary for delivery readiness

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test tests/videoComposer.artifacts.test.js`
Expected: PASS for success/failure structured result assertions.

- [ ] **Step 6: Commit**

```bash
git add src/agents/videoComposer.js tests/videoComposer.artifacts.test.js
git commit -m "feat: return composition artifacts and delivery report"
```

### Task 5: Update Director For Structured Composer Results

**Files:**
- Modify: `src/agents/director.js`
- Test: `tests/director.project-run.test.js`
- Test: `tests/pipeline.acceptance.test.js`

- [ ] **Step 1: Write failing integration assertions**

Add or update tests to assert director still:
- composes successfully
- writes `delivery-summary.md`
- treats output video path correctly when composer returns structured result

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/director.project-run.test.js tests/pipeline.acceptance.test.js`
Expected: FAIL if director assumes composer returns a plain string.

- [ ] **Step 3: Update director integration**

Read composed output path from `result.outputVideo.uri`, while tolerating legacy string return if present during the transition.

- [ ] **Step 4: Preserve current summary behavior**

Do not change existing `delivery-summary.md` contents except where structured composer result is needed for correctness.

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test tests/director.project-run.test.js tests/pipeline.acceptance.test.js`
Expected: PASS with no regression in orchestration order or artifact generation.

- [ ] **Step 6: Commit**

```bash
git add src/agents/director.js tests/director.project-run.test.js tests/pipeline.acceptance.test.js
git commit -m "feat: wire director to structured composition results"
```

### Task 6: Document The Dual-Protocol Design

**Files:**
- Modify: `docs/agents/video-composer.md`
- Create: `docs/superpowers/specs/2026-04-04-composition-agent-dual-protocol-design.md`

- [ ] **Step 1: Write documentation updates**

Document:
- platform protocol
- legacy compatibility adapter
- current repo as V1 source protocol
- inline subtitle source default
- structured composition result

- [ ] **Step 2: Verify docs reflect actual implementation**

Check:
- entrypoint names match code
- artifact names match runtime output
- no outdated claim that composer only returns output path

- [ ] **Step 3: Commit**

```bash
git add docs/agents/video-composer.md docs/superpowers/specs/2026-04-04-composition-agent-dual-protocol-design.md
git commit -m "docs: describe dual protocol composition design"
```

### Task 7: Final Verification

**Files:**
- Test: `tests/videoComposer.test.js`
- Test: `tests/videoComposer.artifacts.test.js`
- Test: `tests/director.project-run.test.js`
- Test: `tests/pipeline.acceptance.test.js`

- [ ] **Step 1: Run focused composer tests**

Run: `node --test tests/videoComposer.test.js tests/videoComposer.artifacts.test.js`
Expected: PASS

- [ ] **Step 2: Run orchestration regression tests**

Run: `node --test tests/director.project-run.test.js tests/pipeline.acceptance.test.js`
Expected: PASS

- [ ] **Step 3: Review diff for protocol safety**

Confirm:
- no upstream agent protocol was changed
- artifact filenames are unchanged
- composer supports both legacy and job-based inputs

- [ ] **Step 4: Final commit**

```bash
git add src/agents/videoComposer.js src/agents/director.js tests/videoComposer.test.js tests/videoComposer.artifacts.test.js tests/director.project-run.test.js tests/pipeline.acceptance.test.js docs/agents/video-composer.md docs/superpowers/specs/2026-04-04-composition-agent-dual-protocol-design.md docs/superpowers/plans/2026-04-04-composition-agent-dual-protocol-implementation.md
git commit -m "feat: add dual protocol composition pipeline"
```
