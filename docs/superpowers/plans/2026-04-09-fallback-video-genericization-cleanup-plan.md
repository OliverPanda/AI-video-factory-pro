# Fallback Video Genericization Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the genericization of the fallback video integration so filenames, APIs, tests, docs, and runtime-facing names no longer misleadingly imply the path is Sora2-only, while preserving chain integrity and backward compatibility for existing runs.

**Architecture:** Keep runtime provider semantics stable for now: `VIDEO_PROVIDER=fallback_video` still resolves to the internal `sora2` provider branch so existing orchestration, cached state, and QA logic continue to work. Genericize the adapter layer and developer-facing names first, then optionally introduce a second-stage rename for agent/artifact keys only behind compatibility aliases.

**Tech Stack:** Node.js, ESM modules, environment-based provider configuration, existing director/video router orchestration, Node test runner.

---

## File Structure

**Primary runtime files**
- Modify: `src/apis/fallbackVideoApi.js`
  Responsibility: generic fallback video HTTP adapter, request building, polling, download, provider-specific normalization.
- Modify: `src/agents/sora2VideoAgent.js`
  Responsibility: current runtime execution wrapper for the internal `sora2` fallback provider branch.
- Modify: `src/agents/sequenceClipGenerator.js`
  Responsibility: sequence generation path that reuses the fallback video adapter.
- Modify: `src/agents/bridgeClipGenerator.js`
  Responsibility: bridge clip generation path that reuses the fallback video adapter.
- Modify: `src/agents/director.js`
  Responsibility: orchestration-level labels, QA overview names, provider branch routing.
- Modify: `src/utils/runArtifacts.js`
  Responsibility: agent artifact directory naming and compatibility layout.

**Tests**
- Modify: `tests/fallbackVideoApi.test.js`
- Modify: `tests/sora2VideoAgent.test.js`
- Modify: `tests/director.project-run.test.js`
- Modify: `tests/director.bridge.integration.test.js`
- Modify: `tests/director.sequence.integration.test.js`
- Modify: `tests/pipeline.acceptance.test.js`
- Modify: `tests/runArtifacts.test.js`
- Modify: `tests/director.artifacts.test.js`

**Scripts and docs**
- Modify: `scripts/test-video-fallback-min.js`
- Modify: `README.md`
- Modify: `docs/agents/README.md`
- Modify: `docs/runtime/README.md`
- Modify: `docs/sop/README.md`
- Modify: `docs/sop/runbook.md`

**Optional second-stage compatibility files**
- Modify: `src/agents/sora2VideoAgent.js`
- Create: `src/agents/fallbackVideoAgent.js`
- Modify: `src/utils/runArtifacts.js`
  Responsibility: introduce generic agent naming while preserving reads of existing `sora2VideoAgent` / `09d-sora2-video-agent`.

## Scope Split

This work naturally breaks into two layers:

1. **Adapter genericization**
   API file names, script names, helper function names, tests, and docs.

2. **Runtime surface genericization**
   Agent names, artifact directories, QA overview labels, and possibly internal provider identifiers.

Implement layer 1 first. Only start layer 2 after layer 1 is green, because layer 2 touches persisted artifact names and historical compatibility.

### Task 1: Stabilize Generic Adapter Naming

**Files:**
- Modify: `src/apis/fallbackVideoApi.js`
- Modify: `src/agents/sora2VideoAgent.js`
- Modify: `src/agents/sequenceClipGenerator.js`
- Modify: `src/agents/bridgeClipGenerator.js`
- Test: `tests/fallbackVideoApi.test.js`
- Test: `tests/sora2VideoAgent.test.js`

- [ ] **Step 1: Write or update failing import tests for the new generic API module name**

Target assertions:
- `tests/fallbackVideoApi.test.js` imports from `src/apis/fallbackVideoApi.js`
- No remaining imports reference `src/apis/sora2VideoApi.js`

- [ ] **Step 2: Run focused grep to verify any old import paths still exist**

Run: `rg -n "sora2VideoApi\\.js|test-sora2-min\\.js" src tests scripts README.md docs`
Expected: no results

- [ ] **Step 3: Finish generic helper renames inside the API file**

Rename:
- `resolveSora2ApiKey` -> `resolveFallbackVideoApiKey`
- `resolveSora2Model` -> `resolveFallbackVideoModel`
- `buildSora2ModelCandidates` -> `buildFallbackVideoModelCandidates`
- `buildSora2VideoRequest` -> `buildFallbackVideoRequest`
- `classifySora2Error` -> `classifyFallbackVideoError`
- `sora2ImageToVideo` -> `fallbackImageToVideo`
- `createSora2VideoClip` -> `createFallbackVideoClip`

Keep return payload `provider: 'sora2'` unchanged in this task.

- [ ] **Step 4: Update all call sites to use the renamed generic helper exports**

Touch:
- `src/agents/sora2VideoAgent.js`
- `src/agents/sequenceClipGenerator.js`
- `src/agents/bridgeClipGenerator.js`

- [ ] **Step 5: Update test names and assertions to the generic API wording**

Examples:
- `buildFallbackVideoRequest ...`
- `fallbackImageToVideo ...`
- `classifyFallbackVideoError ...`

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/fallbackVideoApi.test.js tests/sora2VideoAgent.test.js`
Expected: PASS

- [ ] **Step 7: Run syntax verification**

Run: `node --check src/apis/fallbackVideoApi.js; node --check src/agents/sora2VideoAgent.js; node --check src/agents/sequenceClipGenerator.js; node --check src/agents/bridgeClipGenerator.js`
Expected: no output

- [ ] **Step 8: Commit**

```bash
git add src/apis/fallbackVideoApi.js src/agents/sora2VideoAgent.js src/agents/sequenceClipGenerator.js src/agents/bridgeClipGenerator.js tests/fallbackVideoApi.test.js tests/sora2VideoAgent.test.js
git commit -m "refactor: genericize fallback video adapter naming"
```

### Task 2: Complete Minimal Script Genericization

**Files:**
- Modify: `scripts/test-video-fallback-min.js`
- Modify: `README.md`

- [ ] **Step 1: Verify the script filename and usage docs match**

Expected script path:
- `scripts/test-video-fallback-min.js`

- [ ] **Step 2: Update any old references in docs or notes**

Search targets:
- `test-sora2-min.js`
- `sora2-min`

- [ ] **Step 3: Ensure script logging is generic**

Prefer:
- `[video-fallback-min]`
- wording like “fallback video”

Avoid:
- “sora2” in user-facing usage text unless explicitly describing the internal provider branch.

- [ ] **Step 4: Run syntax check**

Run: `node --check scripts/test-video-fallback-min.js`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add scripts/test-video-fallback-min.js README.md
git commit -m "refactor: rename fallback video smoke test script"
```

### Task 3: Audit and Update User-Facing Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/agents/README.md`
- Modify: `docs/runtime/README.md`
- Modify: `docs/sop/README.md`
- Modify: `docs/sop/runbook.md`

- [ ] **Step 1: Identify doc statements that still imply “fallback path == Sora2-only”**

Search:
- `Sora2 Video Agent`
- `sora2VideoApi`
- `test-sora2-min`
- `09d-sora2-video-agent`

- [ ] **Step 2: Update API/script wording to generic names**

Use:
- “fallback video adapter”
- `fallbackVideoApi`
- `test-video-fallback-min.js`

- [ ] **Step 3: Preserve the internal routing explanation**

Docs should explicitly say:
- `VIDEO_PROVIDER=fallback_video` is the env-facing switch
- it currently maps internally onto the `sora2` branch for runtime compatibility

- [ ] **Step 4: Separate “internal compatibility name” from “user-facing concept”**

Recommended wording:
- User-facing: “Fallback Video”
- Internal runtime branch: “currently implemented on the `sora2` provider branch”

- [ ] **Step 5: Run targeted grep**

Run: `rg -n "sora2VideoApi|test-sora2-min|Sora2 Video Agent|09d-sora2-video-agent" README.md docs`
Expected: only intentional mentions remain

- [ ] **Step 6: Commit**

```bash
git add README.md docs/agents/README.md docs/runtime/README.md docs/sop/README.md docs/sop/runbook.md
git commit -m "docs: clarify generic fallback video naming"
```

### Task 4: Decide Whether Agent/Artifact Names Should Also Go Generic

**Files:**
- Review: `src/agents/sora2VideoAgent.js`
- Review: `src/utils/runArtifacts.js`
- Review: `src/agents/director.js`
- Test: `tests/runArtifacts.test.js`
- Test: `tests/director.artifacts.test.js`
- Test: `tests/pipeline.acceptance.test.js`

- [ ] **Step 1: Document current compatibility constraint**

Current persisted names still in use:
- `sora2VideoAgent`
- `09d-sora2-video-agent`
- `Runway Video Agent`
- `09d-runway-video-agent`

- [ ] **Step 2: Decide if this task should stop at docs-only clarification**

If preserving historical run readability is more important than cosmetic consistency, keep:
- `sora2VideoAgent`
- `09d-sora2-video-agent`

and only update labels/descriptions.

- [ ] **Step 3: If proceeding, design alias-first migration**

Required behavior:
- New runs can write a generic alias
- Old tests and old artifact readers still work
- QA overview can read both old and new agent keys

- [ ] **Step 4: Write failing tests before changing artifact names**

Examples:
- `createRunArtifactContext` still exposes old agent keys if compatibility mode is required
- new generic alias appears if desired
- old artifact expectations still pass or are intentionally migrated

- [ ] **Step 5: Only implement if the compatibility strategy is explicit**

Do not rename artifact directories directly without one of:
- dual-write strategy
- alias mapping
- read-both / write-new migration

- [ ] **Step 6: Run artifact regression**

Run: `node --test tests/runArtifacts.test.js tests/director.artifacts.test.js tests/pipeline.acceptance.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/runArtifacts.js src/agents/director.js tests/runArtifacts.test.js tests/director.artifacts.test.js tests/pipeline.acceptance.test.js
git commit -m "refactor: add compatibility-safe fallback video artifact naming"
```

### Task 5: Clean Remaining Runway Residuals That Conflict With Generic Story

**Files:**
- Review: `src/utils/runArtifacts.js`
- Review: `src/agents/director.js`
- Review: `tests/runArtifacts.test.js`
- Review: `tests/director.artifacts.test.js`
- Review: `tests/pipeline.acceptance.test.js`
- Review: `docs/agents/README.md`

- [ ] **Step 1: Separate true compatibility residue from active runtime dependence**

Examples to classify:
- `runwayVideoAgent`
- `09d-runway-video-agent`
- docs mentioning `Runway Video Agent`

- [ ] **Step 2: Keep only what is still needed for historical compatibility**

If a name is no longer used by runtime and not needed by artifact readers, remove it.

- [ ] **Step 3: Update QA overview ordering and labels consistently**

Avoid showing both:
- “Runway Video Agent”
- “Sora2 Video Agent”

when the user-facing concept is now “Fallback Video”.

- [ ] **Step 4: Run full targeted regression**

Run: `node --test tests/videoRouter.test.js tests/director.project-run.test.js tests/director.bridge.integration.test.js tests/director.sequence.integration.test.js tests/pipeline.acceptance.test.js tests/runArtifacts.test.js tests/director.artifacts.test.js tests/fallbackVideoApi.test.js tests/sora2VideoAgent.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/director.js src/utils/runArtifacts.js tests/videoRouter.test.js tests/director.project-run.test.js tests/director.bridge.integration.test.js tests/director.sequence.integration.test.js tests/pipeline.acceptance.test.js tests/runArtifacts.test.js tests/director.artifacts.test.js docs/agents/README.md
git commit -m "refactor: align fallback video compatibility naming"
```

## Recommended Execution Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4 only after explicit compatibility decision
5. Task 5 after Task 4 or as a docs-only cleanup if Task 4 is deferred

## Risks To Watch

- Renaming agent keys or artifact directories can break:
  - old run inspection
  - persisted state assumptions
  - QA overview aggregation
  - artifact-related tests
- Renaming internal provider identifiers from `sora2` to something generic too early can break:
  - router expectations
  - bridge/sequence tests
  - director provider branching

## Non-Goals For This Plan

- Do not remove unrelated lipsync `runway` provider references in this pass
- Do not refactor all historical planning docs unless they actively mislead current implementation work
- Do not change env-facing `VIDEO_PROVIDER=fallback_video`
- Do not change runtime provider result payload `provider: 'sora2'` in this pass unless a dedicated migration plan is written first

## Definition of Done

- No code import references remain to `sora2VideoApi.js`
- No user-facing script references remain to `test-sora2-min.js`
- Adapter-layer helper names are generic
- Docs clearly distinguish env-facing fallback video from the internal `sora2` compatibility branch
- All targeted tests pass

