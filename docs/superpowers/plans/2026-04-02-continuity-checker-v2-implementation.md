# Continuity Checker V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade continuity checking from a placeholder auditor into a mixed rule + visual-review + repair-planning system that can guide regeneration without breaking the main pipeline.

**Architecture:** Keep the existing `continuityChecker` / `director` / `promptEngineer` structure, but strengthen it in-place. Add a deterministic continuity contract layer, expand the continuity report schema, introduce repair planning artifacts, and let `director` handle continuity repair with the same “best effort, preserve original output” posture already used elsewhere.

**Tech Stack:** Node.js ESM, JSON file artifacts, existing agent pipeline, `node:test`

---

## File Structure

- `src/agents/continuityChecker.js`
  - Extend from simple score filter to mixed report builder + repair planner
- `src/agents/director.js`
  - Consume continuity repair plans and continue pipeline when repair attempts fail
- `src/agents/promptEngineer.js`
  - Provide continuity-aware regeneration hints without replacing the current prompt path
- `src/utils/runArtifacts.js`
  - Reuse existing layout; no new top-level agent directory needed
- `docs/agents/continuity-checker.md`
  - Update agent contract, artifacts, metrics, and current boundaries
- `tests/continuityChecker.test.js`
  - Add rule-layer and mixed decision coverage
- `tests/continuityChecker.artifacts.test.js`
  - Assert new output schema and new artifact files
- `tests/director.project-run.test.js`
  - Verify continuity repair planning and failure-tolerant behavior

## Task 1: Write the Failing Continuity V2 Tests

**Files:**
- Modify: `tests/continuityChecker.test.js`
- Modify: `tests/continuityChecker.artifacts.test.js`
- Modify: `tests/director.project-run.test.js`

- [ ] **Step 1: Add rule-layer expectations to `tests/continuityChecker.test.js`**

Add tests that expect:

```js
assert.deepEqual(report.hardViolations.map((item) => item.code), ['camera_axis_flip']);
assert.equal(report.recommendedAction, 'regenerate_prompt_and_image');
```

- [ ] **Step 2: Add artifact expectations to `tests/continuityChecker.artifacts.test.js`**

Assert these files exist and contain expected keys:

```js
'continuity-report.json'
'flagged-transitions.json'
'repair-plan.json'
'repair-attempts.json'
'continuity-report.md'
'continuity-metrics.json'
```

- [ ] **Step 3: Add director behavior expectations to `tests/director.project-run.test.js`**

Add coverage for:

- continuity flagged transition with `recommendedAction = regenerate_prompt_and_image`
- continuity repair failure preserves original image and continues
- continuity `manual_review` does not attempt regeneration

- [ ] **Step 4: Run the focused tests to verify they fail**

Run:

```bash
node --test --test-isolation=none tests/continuityChecker.test.js tests/continuityChecker.artifacts.test.js tests/director.project-run.test.js
```

Expected:

- FAIL because current continuity reports do not expose `hardViolations`, `softWarnings`, `repair-plan.json`, or repair planning behavior

- [ ] **Step 5: Commit the red tests**

```bash
git add tests/continuityChecker.test.js tests/continuityChecker.artifacts.test.js tests/director.project-run.test.js
git commit -m "test: add continuity checker v2 coverage"
```

## Task 2: Implement Continuity Contract and Mixed Report Schema

**Files:**
- Modify: `src/agents/continuityChecker.js`
- Test: `tests/continuityChecker.test.js`

- [ ] **Step 1: Implement continuity contract helpers**

Add focused helpers inside `src/agents/continuityChecker.js`:

- `normalizeAxis(value)`
- `compareLighting(previousShot, currentShot)`
- `comparePropStates(previousShot, currentShot)`
- `buildHardViolations(previousShot, currentShot)`

- [ ] **Step 2: Upgrade the continuity report shape**

Return reports in this shape:

```js
{
  previousShotId,
  shotId,
  checkedDimensions,
  hardViolations,
  softWarnings,
  continuityScore,
  llmObservations,
  repairHints,
  recommendedAction,
  repairMethod,
  continuityTargets,
  postprocessHints,
}
```

- [ ] **Step 3: Keep injected `checkTransition` compatible**

If `options.checkTransition` is provided:

- accept its partial report
- normalize it into the V2 schema
- merge with rule-layer hard violations

- [ ] **Step 4: Run focused continuity tests**

Run:

```bash
node --test --test-isolation=none tests/continuityChecker.test.js
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/continuityChecker.js tests/continuityChecker.test.js
git commit -m "feat: add continuity contract and mixed reports"
```

## Task 3: Add Repair Planning Artifacts and Metrics

**Files:**
- Modify: `src/agents/continuityChecker.js`
- Test: `tests/continuityChecker.artifacts.test.js`

- [ ] **Step 1: Write `repair-plan.json` and `repair-attempts.json`**

`repair-plan.json` should summarize flagged transitions and recommended actions.  
`repair-attempts.json` should start as an empty array from checker output and be appended later by `director`.

- [ ] **Step 2: Expand metrics**

Write these metrics:

```js
checked_transition_count
flagged_transition_count
avg_continuity_score
hard_violation_count
soft_warning_count
hard_rule_fail_count
llm_review_fail_count
action_pass_count
action_regenerate_count
action_manual_review_count
```

- [ ] **Step 3: Upgrade markdown output**

Include per-transition:

- score
- hard violations
- soft warnings
- repair hints
- recommended action

- [ ] **Step 4: Run artifact tests**

Run:

```bash
node --test --test-isolation=none tests/continuityChecker.artifacts.test.js
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/continuityChecker.js tests/continuityChecker.artifacts.test.js
git commit -m "feat: add continuity repair artifacts"
```

## Task 4: Integrate Continuity Repair Planning Into Director

**Files:**
- Modify: `src/agents/director.js`
- Modify: `src/agents/promptEngineer.js`
- Test: `tests/director.project-run.test.js`

- [ ] **Step 1: Add continuity repair execution in `director`**

Use continuity reports after `runContinuityCheck` to:

- skip when `recommendedAction = pass`
- attempt regeneration when `recommendedAction = regenerate_prompt_and_image`
- keep original image when `recommendedAction = manual_review`

- [ ] **Step 2: Reuse continuity repair hints during regeneration**

Add a narrow prompt path so regeneration can inject continuity repair hints without replacing normal prompt generation.

- [ ] **Step 3: Preserve failure-tolerant behavior**

If continuity regeneration fails:

- append an entry to `repair-attempts.json`
- log the failure
- keep the original image
- continue to `tts` and `compose`

- [ ] **Step 4: Run director-focused tests**

Run:

```bash
node --test --test-isolation=none tests/director.project-run.test.js
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/director.js src/agents/promptEngineer.js tests/director.project-run.test.js
git commit -m "feat: execute continuity repair plans"
```

## Task 5: Update Agent Documentation

**Files:**
- Modify: `docs/agents/continuity-checker.md`
- Optionally Modify: `README.md`

- [ ] **Step 1: Update continuity checker responsibilities**

Describe:

- continuity contract
- visual soft review
- repair planning

- [ ] **Step 2: Update artifact list and metrics**

Add:

- `repair-plan.json`
- `repair-attempts.json`
- expanded metrics

- [ ] **Step 3: Clarify current boundary**

Document that:

- phase 1 improves pre/post generation continuity control
- local inpaint / optical flow / color match are future hooks, not current built-ins

- [ ] **Step 4: Review docs for consistency**

Check wording against:

- `docs/runtime/temp-structure.md`
- `README.md`

- [ ] **Step 5: Commit**

```bash
git add docs/agents/continuity-checker.md README.md
git commit -m "docs: update continuity checker v2 guide"
```

## Task 6: Final Verification

**Files:**
- Review: `src/agents/continuityChecker.js`
- Review: `src/agents/director.js`
- Review: `src/agents/promptEngineer.js`
- Review: `docs/agents/continuity-checker.md`

- [ ] **Step 1: Run the focused verification suite**

Run:

```bash
node --test --test-isolation=none tests/continuityChecker.test.js tests/continuityChecker.artifacts.test.js tests/director.project-run.test.js
```

Expected:

- PASS

- [ ] **Step 2: Run the broader continuity-related acceptance coverage**

Run:

```bash
node --test --test-isolation=none tests/pipeline.acceptance.test.js tests/characterConsistency.acceptance.test.js
```

Expected:

- PASS

- [ ] **Step 3: Do a quick syntax check on touched production files**

Run:

```bash
node --check src/agents/continuityChecker.js
node --check src/agents/director.js
node --check src/agents/promptEngineer.js
```

Expected:

- PASS

- [ ] **Step 4: Commit final fixes if needed**

```bash
git add src/agents/continuityChecker.js src/agents/director.js src/agents/promptEngineer.js docs/agents/continuity-checker.md tests/continuityChecker.test.js tests/continuityChecker.artifacts.test.js tests/director.project-run.test.js
git commit -m "test: finalize continuity checker v2 verification"
```

- [ ] **Step 5: Handoff**

Deliver:

- continuity v2 implementation
- updated agent docs
- verification command summary
