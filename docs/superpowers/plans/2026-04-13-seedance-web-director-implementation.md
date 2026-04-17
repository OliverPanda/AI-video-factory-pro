# Seedance Web Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Seedance production path into a scene-first, director-pack-driven workflow that targets stable 80-point narrative coherence and cinematic readability.

**Architecture:** Introduce protocol/domain schemas for `ScenePack`, `DirectorPack`, `GenerationPack`, and `CandidateReview`, then implement a new pre-generation director layer via focused skills and agents before integrating it into the existing `director -> videoRouter -> seedance` path. Preserve the current delivery pipeline as a fallback path while moving continuity logic from post-generation QA into pre-generation constraints.

**Tech Stack:** Node.js ESM, existing agent pipeline in `src/agents`, JSON protocol modules in `src/domain` and `src/utils`, markdown skills under project skills, Node test runner, FFmpeg-based composer.

---

## File Structure

### New Files

- `src/domain/seedanceSceneProtocol.js`
  - Schema creation/normalization for `ScenePack`
- `src/domain/seedanceDirectorProtocol.js`
  - Schema creation/normalization for `DirectorPack`
- `src/domain/seedanceGenerationProtocol.js`
  - Schema creation/normalization for `ShotGenerationPack` and `SequenceGenerationPack`
- `src/domain/seedanceReviewProtocol.js`
  - Scoring dimensions, failure taxonomy, rewrite patch schema
- `src/agents/sceneGrammarAgent.js`
  - Transform parsed script shots into scene packs
- `src/agents/directorPackAgent.js`
  - Transform scene packs into director packs
- `src/agents/seedancePromptAgent.js`
  - Translate generation packs into Seedance-ready prompt blocks
- `src/agents/seedanceCandidateReviewer.js`
  - Rank candidates and emit structured review results
- `src/agents/seedanceFailureDiagnoser.js`
  - Map observed failures into canonical taxonomy
- `src/agents/seedanceRewritePlanner.js`
  - Produce rewrite patches for reruns
- `skills/seedance-web-director/SKILL.md`
  - Official-web-style director input rules
- `skills/cinematic-scene-grammar/SKILL.md`
  - Scene grammar for realistic cinematic storytelling
- `skills/seedance-candidate-review/SKILL.md`
  - Candidate ranking and rejection heuristics
- `skills/seedance-rewrite-playbook/SKILL.md`
  - Rewrite rules by failure type
- `tests/sceneGrammarAgent.test.js`
- `tests/directorPackAgent.test.js`
- `tests/seedancePromptAgent.test.js`
- `tests/seedanceCandidateReviewer.test.js`
- `tests/seedanceRewritePlanner.test.js`

### Modified Files

- `src/agents/director.js`
  - Insert scene/director/generation pack flow ahead of video routing
- `src/agents/motionPlanner.js`
  - Reduce role to beat skeleton generation or adapt into scene inputs
- `src/agents/performancePlanner.js`
  - Emit actor blocking and pacing primitives consumed by director pack
- `src/agents/videoRouter.js`
  - Replace direct provider hint assembly with generation pack builder flow
- `src/agents/actionSequenceRouter.js`
  - Rework into sequence generation pack builder or delegate to new module
- `src/apis/seedanceVideoApi.js`
  - Accept structured prompt blocks and reference stack metadata
- `src/apis/fallbackVideoApi.js`
  - Keep provider abstraction but pass through richer generation-pack data
- `README.md`
  - Document new Seedance web-director workflow at a high level

## Task 1: Define Scene Pack Protocol

**Files:**
- Create: `src/domain/seedanceSceneProtocol.js`
- Test: `tests/sceneGrammarAgent.test.js`
- Reference: `docs/superpowers/specs/2026-04-13-seedance-web-director-design.md`

- [ ] **Step 1: Write the failing protocol tests**

Add tests covering:
- a valid `ScenePack` with all required fields
- normalization of optional arrays/strings
- rejection or downgrade of invalid scene structure

Run: `node --test tests/sceneGrammarAgent.test.js`
Expected: FAIL because protocol and agent do not exist yet

- [ ] **Step 2: Implement minimal `ScenePack` protocol**

Add:
- `createScenePack(input)`
- `normalizeScenePack(input)`
- required-field defaults and validation helpers

- [ ] **Step 3: Extend tests with `仓库暗战` scene fixture**

Add a fixture representing:
- warehouse confrontation main scene
- warehouse escape tail scene

- [ ] **Step 4: Run the protocol tests**

Run: `node --test tests/sceneGrammarAgent.test.js`
Expected: PASS for protocol-only assertions

- [ ] **Step 5: Commit**

```bash
git add src/domain/seedanceSceneProtocol.js tests/sceneGrammarAgent.test.js
git commit -m "feat: add seedance scene pack protocol"
```

## Task 2: Implement Scene Grammar Agent

**Files:**
- Create: `src/agents/sceneGrammarAgent.js`
- Modify: `src/agents/director.js`
- Test: `tests/sceneGrammarAgent.test.js`

- [ ] **Step 1: Write the failing agent test**

Cover:
- parsed script shots grouped into one or more scene packs
- `scene_goal`, `dramatic_question`, `action_beats`, and `delivery_priority` emitted

Run: `node --test tests/sceneGrammarAgent.test.js`
Expected: FAIL because agent is missing

- [ ] **Step 2: Implement minimal scene grouping logic**

Use heuristics first:
- location anchor
- time anchor
- action continuity
- cast overlap

Avoid LLM dependency in the first pass.

- [ ] **Step 3: Wire scene grammar into `director.js` without changing downstream behavior yet**

Store `scenePacks` in state, but do not switch video generation logic yet.

- [ ] **Step 4: Run scene grammar tests**

Run: `node --test tests/sceneGrammarAgent.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/sceneGrammarAgent.js src/agents/director.js tests/sceneGrammarAgent.test.js
git commit -m "feat: add scene grammar agent"
```

## Task 3: Define Director Pack Protocol

**Files:**
- Create: `src/domain/seedanceDirectorProtocol.js`
- Test: `tests/directorPackAgent.test.js`

- [ ] **Step 1: Write failing tests for `DirectorPack` schema**

Cover required fields:
- `coverage_strategy`
- `axis_map`
- `blocking_map`
- `pace_design`
- `continuity_locks`
- `candidate_strategy`

- [ ] **Step 2: Implement protocol helpers**

Add:
- `createDirectorPack(input)`
- `normalizeDirectorPack(input)`
- helper enums for coverage and pacing

- [ ] **Step 3: Run tests**

Run: `node --test tests/directorPackAgent.test.js`
Expected: PASS for protocol assertions

- [ ] **Step 4: Commit**

```bash
git add src/domain/seedanceDirectorProtocol.js tests/directorPackAgent.test.js
git commit -m "feat: add director pack protocol"
```

## Task 4: Implement Director Pack Agent

**Files:**
- Create: `src/agents/directorPackAgent.js`
- Modify: `src/agents/motionPlanner.js`
- Modify: `src/agents/performancePlanner.js`
- Modify: `src/agents/director.js`
- Test: `tests/directorPackAgent.test.js`

- [ ] **Step 1: Write failing tests for director-pack generation**

Cover:
- scene pack -> director pack conversion
- generation of `entry_master_state`, `exit_master_state`
- axis and blocking rules for a realistic action scene

- [ ] **Step 2: Refactor motion/performance planners into upstream data suppliers**

`motionPlanner` should emit beat skeleton and camera primitives.

`performancePlanner` should emit actor blocking and pacing primitives.

- [ ] **Step 3: Implement `directorPackAgent`**

Generate:
- coverage strategy
- shot order plan
- axis rules
- blocking progression
- continuity locks

- [ ] **Step 4: Wire director pack into pipeline state**

Store `directorPacks` in `state.json` and run artifacts.

- [ ] **Step 5: Run tests**

Run: `node --test tests/directorPackAgent.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agents/directorPackAgent.js src/agents/motionPlanner.js src/agents/performancePlanner.js src/agents/director.js tests/directorPackAgent.test.js
git commit -m "feat: add director pack agent"
```

## Task 5: Define Generation Pack Protocols

**Files:**
- Create: `src/domain/seedanceGenerationProtocol.js`
- Test: `tests/seedancePromptAgent.test.js`

- [ ] **Step 1: Write failing tests for shot and sequence generation packs**

Cover:
- `ShotGenerationPack` requires `timecoded_beats`, `entry_state`, `exit_state`, `reference_stack`
- `SequenceGenerationPack` requires `mid_state`, `blocking_progression`, `camera_progression`

- [ ] **Step 2: Implement protocol creators**

Add:
- `createShotGenerationPack`
- `createSequenceGenerationPack`
- normalization helpers for references and negative rules

- [ ] **Step 3: Run tests**

Run: `node --test tests/seedancePromptAgent.test.js`
Expected: protocol assertions PASS

- [ ] **Step 4: Commit**

```bash
git add src/domain/seedanceGenerationProtocol.js tests/seedancePromptAgent.test.js
git commit -m "feat: add seedance generation pack protocols"
```

## Task 6: Replace Direct Video Routing With Generation Pack Builder

**Files:**
- Create: `src/agents/seedancePromptAgent.js`
- Modify: `src/agents/videoRouter.js`
- Modify: `src/agents/actionSequenceRouter.js`
- Modify: `src/apis/seedanceVideoApi.js`
- Modify: `src/apis/fallbackVideoApi.js`
- Test: `tests/seedancePromptAgent.test.js`

- [ ] **Step 1: Write failing integration tests**

Cover:
- scene/director inputs produce structured shot generation pack
- sequence packs are only created for high-value beats
- Seedance API payload receives structured prompt blocks and ordered references

- [ ] **Step 2: Implement `seedancePromptAgent`**

Responsibilities:
- convert generation pack into Seedance-friendly prompt text blocks
- preserve time-coded beats in the prompt
- preserve explicit entry/exit constraints

- [ ] **Step 3: Refactor `videoRouter.js`**

Replace direct `providerRequestHints` assembly with generation pack construction.

- [ ] **Step 4: Refactor `actionSequenceRouter.js`**

Make it generate sequence packs instead of generic route packages.

- [ ] **Step 5: Update provider adapters**

`seedanceVideoApi.js` and `fallbackVideoApi.js` must:
- accept richer prompt structure
- serialize ordered reference stack
- keep provider-agnostic abstraction

- [ ] **Step 6: Run tests**

Run: `node --test tests/seedancePromptAgent.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/seedancePromptAgent.js src/agents/videoRouter.js src/agents/actionSequenceRouter.js src/apis/seedanceVideoApi.js src/apis/fallbackVideoApi.js tests/seedancePromptAgent.test.js
git commit -m "feat: build seedance generation packs"
```

## Task 7: Add Candidate Review Protocol And Reviewer Agent

**Files:**
- Create: `src/domain/seedanceReviewProtocol.js`
- Create: `src/agents/seedanceCandidateReviewer.js`
- Test: `tests/seedanceCandidateReviewer.test.js`

- [ ] **Step 1: Write failing tests for review protocol**

Cover:
- scorecard dimensions
- weighted ranking
- canonical failure taxonomy

- [ ] **Step 2: Implement review protocol**

Add:
- `createCandidateReview`
- `scoreCandidate`
- `rankCandidates`
- taxonomy constants

- [ ] **Step 3: Implement reviewer agent**

Use deterministic heuristics first:
- path validity
- duration sanity
- continuity metadata presence
- provider outputs

Leave model-assisted aesthetic ranking optional for later.

- [ ] **Step 4: Run tests**

Run: `node --test tests/seedanceCandidateReviewer.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/seedanceReviewProtocol.js src/agents/seedanceCandidateReviewer.js tests/seedanceCandidateReviewer.test.js
git commit -m "feat: add seedance candidate reviewer"
```

## Task 8: Add Failure Diagnoser And Rewrite Planner

**Files:**
- Create: `src/agents/seedanceFailureDiagnoser.js`
- Create: `src/agents/seedanceRewritePlanner.js`
- Test: `tests/seedanceRewritePlanner.test.js`

- [ ] **Step 1: Write failing tests**

Cover:
- failure type mapping
- rewrite patch generation for each supported failure

- [ ] **Step 2: Implement diagnoser**

Map candidate review output into:
- `space_confusion`
- `identity_drift`
- `motion_weight_missing`
- `axis_break`
- `entry_state_missing`
- `exit_state_missing`
- `overactive_camera`
- `under_directed_action`
- `tone_not_realistic`
- `artifact_visible`

- [ ] **Step 3: Implement rewrite planner**

Produce structured rewrite patches for:
- generation pack changes
- reference stack changes
- candidate policy changes

- [ ] **Step 4: Run tests**

Run: `node --test tests/seedanceRewritePlanner.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/seedanceFailureDiagnoser.js src/agents/seedanceRewritePlanner.js tests/seedanceRewritePlanner.test.js
git commit -m "feat: add seedance rewrite planning"
```

## Task 9: Shift Existing QA Agents To Delivery-Only Role

**Files:**
- Modify: `src/agents/shotQaAgent.js`
- Modify: `src/agents/bridgeQaAgent.js`
- Modify: `src/agents/sequenceQaAgent.js`
- Modify: `src/agents/director.js`
- Test: `tests/director.project-run.test.js`
- Test: `tests/director.sequence.integration.test.js`

- [ ] **Step 1: Write failing integration tests**

Cover:
- continuity logic comes from director pack, not QA defaults
- QA only blocks missing/incomplete evidence, not artistic choice upstream

- [ ] **Step 2: Refactor QA agents**

Make them responsible for:
- artifact validation
- delivery gating
- reviewer integration

- [ ] **Step 3: Update `director.js` orchestration**

Ensure:
- pre-generation control happens before video generation
- post-generation QA no longer invents continuity semantics

- [ ] **Step 4: Run integration tests**

Run:
- `node --test tests/director.project-run.test.js`
- `node --test tests/director.sequence.integration.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/shotQaAgent.js src/agents/bridgeQaAgent.js src/agents/sequenceQaAgent.js src/agents/director.js tests/director.project-run.test.js tests/director.sequence.integration.test.js
git commit -m "refactor: make qa agents delivery-focused"
```

## Task 10: Add Skills And Docs

**Files:**
- Create: `skills/seedance-web-director/SKILL.md`
- Create: `skills/cinematic-scene-grammar/SKILL.md`
- Create: `skills/seedance-candidate-review/SKILL.md`
- Create: `skills/seedance-rewrite-playbook/SKILL.md`
- Modify: `README.md`

- [ ] **Step 1: Write skill docs**

Each skill must include:
- when to trigger
- required inputs
- expected outputs
- anti-patterns

- [ ] **Step 2: Add top-level README integration note**

Document:
- new scene/director/generation flow
- why it differs from direct API prompting

- [ ] **Step 3: Manual review of docs**

Verify docs match actual file names and protocol names.

- [ ] **Step 4: Commit**

```bash
git add skills/seedance-web-director/SKILL.md skills/cinematic-scene-grammar/SKILL.md skills/seedance-candidate-review/SKILL.md skills/seedance-rewrite-playbook/SKILL.md README.md
git commit -m "docs: add seedance web director skills"
```

## Task 11: End-to-End Pilot On `仓库暗战`

**Files:**
- Modify: `samples/仓库暗战.txt` only if fixture annotations are needed
- Modify: pilot-related test/docs as needed

- [ ] **Step 1: Create a deterministic pilot fixture**

Use `仓库暗战` as the canonical validation scene.

- [ ] **Step 2: Run scene -> director -> generation pack pipeline without provider calls**

Run a dry validation command or targeted script.

- [ ] **Step 3: Verify generated packs**

Check:
- scene split is sane
- only worthy beats are promoted to sequence
- director pack contains axis, blocking, and handoff constraints

- [ ] **Step 4: Run a real provider pilot**

Use one scene with limited candidates and save artifacts.

- [ ] **Step 5: Review candidate ranking and rewrite output**

Ensure review loop produces actionable rewrite patches.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "test: validate seedance web director pilot"
```

## Verification Checklist

Before claiming completion:

- Run all new protocol and agent tests
- Run updated integration tests
- Run one dry end-to-end pack generation on `仓库暗战`
- Run one real pilot through Seedance using strict run binding
- Inspect output artifacts:
  - `scene-pack.json`
  - `director-pack.json`
  - `generation-pack.json`
  - `candidate-review.json`
  - `rewrite-patch.json`

## Risks To Watch

- Overbuilding the director layer before proving basic pack quality
- Letting QA logic duplicate reviewer logic
- Making sequence generation the default instead of a selective path
- Mixing provider abstraction concerns into high-level cinematic schema
- Reintroducing prompt-string concatenation instead of structured packs
