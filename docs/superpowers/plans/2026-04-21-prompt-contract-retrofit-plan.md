# Prompt Contract Retrofit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前项目的 prompt 体系改造成 `contract-first + preset + 少量示例` 的结构，让角色建档、三视图、分镜图、Seedance shot/sequence/bridge 都共享统一语义槽位，并把 `execution_en` / `display_zh` 完全分层。

**Architecture:** 先抽一个轻量的 prompt contract 层，定义各步骤统一的槽位和 preset；再逐步改造角色三视图、分镜图、Seedance 输入、sequence/bridge 路由；最后补齐快照测试和回归测试，确保 prompt 结构稳定、可审计、可切换 provider。

**Tech Stack:** Node.js, JavaScript, existing `src/agents`, `src/llm/prompts`, `src/apis`, `node --test`

---

## File Map

- Create: `src/domain/promptContract.js`
- Modify: `src/llm/prompts/promptEngineering.js`
- Modify: `src/agents/promptEngineer.js`
- Modify: `src/agents/seedancePromptAgent.js`
- Modify: `src/apis/seedanceVideoApi.js`
- Modify: `src/agents/actionSequenceRouter.js`
- Modify: `src/agents/bridgeShotRouter.js`
- Modify: `src/agents/preflightQaAgent.js`
- Modify: `src/agents/characterRegistry.js`
- Modify: `docs/sop/2026-04-20-致命抉择-各步骤最终prompt.md`
- Test: `tests/promptContract.test.js`
- Test: `tests/promptEngineer.artifacts.test.js`
- Test: `tests/seedancePromptAgent.test.js`
- Test: `tests/seedanceVideoApi.test.js`
- Test: `tests/actionSequenceRouter.test.js`
- Test: `tests/bridgeShotRouter.test.js`
- Test: `tests/preflightQaAgent.test.js`
- Test: `tests/characterRegistry.test.js`

## Plan

### Task 1: Define the shared prompt contract

**Files:**
- Create: `src/domain/promptContract.js`
- Test: `tests/promptContract.test.js`

- [ ] **Step 1: Write the failing contract test**

```js
import assert from 'node:assert/strict';
import { buildPromptContract, mergePromptPresets } from '../src/domain/promptContract.js';

test('buildPromptContract normalizes execution/display separation', () => {
  const contract = buildPromptContract({
    version: 'v1',
    taskRole: 'shot_prompt',
    displayZh: '中文展示',
    executionEn: 'english execution',
    hardConstraints: ['keep identity'],
  });

  assert.equal(contract.version, 'v1');
  assert.equal(contract.displayZh, '中文展示');
  assert.equal(contract.executionEn, 'english execution');
  assert.deepEqual(contract.hardConstraints, ['keep identity']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/promptContract.test.js
```

Expected: FAIL because `src/domain/promptContract.js` does not exist yet.

- [ ] **Step 3: Implement the minimal contract helpers**

Implement:

- `buildPromptContract(input)`
- `mergePromptPresets(...presets)`
- `serializePromptContract(contract)`
- shared defaults for:
  - `taskRole`
  - `hardConstraints`
  - `softPreferences`
  - `referenceBinding`
  - `negativeRules`
  - `outputSchema`
  - `tokenBudget`
  - `version`

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --test tests/promptContract.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/promptContract.js tests/promptContract.test.js
git commit -m "feat: add shared prompt contract primitives"
```

### Task 2: Refactor character and image prompt presets

**Files:**
- Modify: `src/agents/characterRegistry.js`
- Modify: `src/llm/prompts/promptEngineering.js`
- Test: `tests/characterRegistry.test.js`

- [ ] **Step 1: Write failing tests for identity presets and three-view exclusion**

Add assertions that:

- identity anchor fields exist on the merged character card
- `sanitizeCharacterIdentityTokens()` strips scene objects
- `buildCharacterRefSheetPrompt()` keeps the prompt focused on one person and pure white background

- [ ] **Step 2: Run the tests to verify failures**

Run:

```bash
node --test tests/characterRegistry.test.js
```

Expected: at least one assertion fails because the new preset fields are not wired yet.

- [ ] **Step 3: Implement character identity preset fields**

Update `characterRegistry.js` so cards expose stable preset fields such as:

- `identityAnchor`
- `styleFamily`
- `forbiddenIdentityTokens`
- `displayNameZh` if needed for UI separation

Keep `basePromptTokens` short and stable.

- [ ] **Step 4: Tighten the three-view prompt contract**

Update `buildCharacterRefSheetPrompt()` so the final prompt is assembled from contract pieces:

- task role: one person, turnaround sheet
- hard constraints: pure white seamless studio background, no props, no environment
- preset identity anchor: only human features
- negative rules: explicit scene-object exclusion

Do not reintroduce environment nouns into the positive prompt.

- [ ] **Step 5: Re-run tests**

Run:

```bash
node --test tests/characterRegistry.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agents/characterRegistry.js src/llm/prompts/promptEngineering.js tests/characterRegistry.test.js
git commit -m "feat: normalize character identity prompt presets"
```

### Task 3: Split prompt engineer into contract blocks

**Files:**
- Modify: `src/agents/promptEngineer.js`
- Modify: `src/llm/prompts/promptEngineering.js`
- Test: `tests/promptEngineer.artifacts.test.js`

- [ ] **Step 1: Write failing tests for bilingual execution/display separation**

Assert that:

- `executionEn` is used for image generation
- `displayZh` is present for UI/table output
- the fallback prompt still produces English execution text only

- [ ] **Step 2: Run the prompt engineer tests**

Run:

```bash
node --test tests/promptEngineer.artifacts.test.js
```

Expected: FAIL until the new contract output is wired.

- [ ] **Step 3: Implement contract-shaped prompt assembly**

Refactor prompt generation to use these blocks:

- `shot_intent`
- `scene_continuity`
- `character_anchors`
- `camera_style_negative`

Keep `display_prompt_zh` and `display_negative_prompt_zh` out of provider-facing content.

- [ ] **Step 4: Keep fallback behavior but make it contract-compliant**

Fallback should still:

- emit English execution text
- include scene/action/emotion/camera/quality
- avoid leaking Chinese display strings into provider input

- [ ] **Step 5: Re-run tests**

Run:

```bash
node --test tests/promptEngineer.artifacts.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agents/promptEngineer.js src/llm/prompts/promptEngineering.js tests/promptEngineer.artifacts.test.js
git commit -m "feat: split image prompt execution and display contracts"
```

### Task 4: Unify Seedance prompt blocks

**Files:**
- Modify: `src/agents/seedancePromptAgent.js`
- Modify: `src/apis/seedanceVideoApi.js`
- Test: `tests/seedancePromptAgent.test.js`
- Test: `tests/seedanceVideoApi.test.js`

- [ ] **Step 1: Write failing tests for contract block ordering**

Cover:

- `seedancePromptBlocks` contain stable keys in canonical order
- `seedanceVideoApi` uses blocks when present
- provider request stays English-only
- sequence and bridge continue to work with the same contract semantics

- [ ] **Step 2: Run Seedance tests**

Run:

```bash
node --test tests/seedancePromptAgent.test.js tests/seedanceVideoApi.test.js
```

Expected: FAIL on at least one ordering/shape assertion.

- [ ] **Step 3: Rebuild the prompt contract around blocks**

Make the contract explicit for:

- `cinematic_intent`
- `shot_goal`
- `subject_action`
- `scene_environment`
- `cinematography`
- `reference_binding`
- `entry_exit`
- `timecoded_beats`
- `camera_plan`
- `blocking`
- `continuity_locks`
- `negative_rules`
- `quality_target`

- [ ] **Step 4: Keep provider request assembly deterministic**

Update `seedanceVideoApi.js` so:

- blocks are serialized in fixed order
- `ensureEnglishPrompt()` remains on provider text
- `reference binding` stays explicit
- sequence/bridge special hints are additive, not replacing shared slots

- [ ] **Step 5: Re-run Seedance tests**

Run:

```bash
node --test tests/seedancePromptAgent.test.js tests/seedanceVideoApi.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agents/seedancePromptAgent.js src/apis/seedanceVideoApi.js tests/seedancePromptAgent.test.js tests/seedanceVideoApi.test.js
git commit -m "feat: standardize seedance prompt contract blocks"
```

### Task 5: Align sequence and bridge routing with the shared contract

**Files:**
- Modify: `src/agents/actionSequenceRouter.js`
- Modify: `src/agents/bridgeShotRouter.js`
- Test: `tests/actionSequenceRouter.test.js`
- Test: `tests/bridgeShotRouter.test.js`

- [ ] **Step 1: Write failing tests for shared contract semantics**

Assert that:

- sequence prompt packages still expose stable continuity fields
- bridge directives keep transition / reference / continuity / preserve slots
- both are compatible with the same contract vocabulary

- [ ] **Step 2: Run the routing tests**

Run:

```bash
node --test tests/actionSequenceRouter.test.js tests/bridgeShotRouter.test.js
```

Expected: FAIL until the contract fields are standardized.

- [ ] **Step 3: Refactor sequence router to use contract terms**

Keep the same runtime behavior, but rename/normalize fields so sequence packages map cleanly to:

- `reference_binding`
- `continuity_locks`
- `hard_constraints`
- `camera_flow`
- `entry_exit`

- [ ] **Step 4: Refactor bridge router to reuse the same contract language**

Ensure bridge directives remain minimal and explicit:

- transition brief
- camera and timing
- reference binding
- continuity locks
- preserve elements

- [ ] **Step 5: Re-run routing tests**

Run:

```bash
node --test tests/actionSequenceRouter.test.js tests/bridgeShotRouter.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agents/actionSequenceRouter.js src/agents/bridgeShotRouter.js tests/actionSequenceRouter.test.js tests/bridgeShotRouter.test.js
git commit -m "feat: align sequence and bridge prompts with shared contract"
```

### Task 6: Update preflight QA to understand the new contract

**Files:**
- Modify: `src/agents/preflightQaAgent.js`
- Test: `tests/preflightQaAgent.test.js`

- [ ] **Step 1: Write failing tests for contract-aware QA checks**

Assert that preflight checks still block when:

- entry / exit are missing
- continuity locks are missing
- repair blocks are added consistently
- hard blocks stop expensive generation

- [ ] **Step 2: Run preflight QA tests**

Run:

```bash
node --test tests/preflightQaAgent.test.js
```

Expected: FAIL until assertions are updated for the new prompt contract shape.

- [ ] **Step 3: Normalize QA against contract slots**

Keep existing behavior, but make the checks explicitly reference:

- `entry_exit`
- `continuity_locks`
- `reference_binding`
- `negative_rules`
- `repair_brief`

- [ ] **Step 4: Re-run tests**

Run:

```bash
node --test tests/preflightQaAgent.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/preflightQaAgent.js tests/preflightQaAgent.test.js
git commit -m "feat: make preflight qa contract-aware"
```

### Task 7: Refresh docs to match the contract-first model

**Files:**
- Modify: `docs/sop/2026-04-20-致命抉择-各步骤最终prompt.md`
- Modify: `docs/superpowers/specs/2026-04-21-prompt-contract-retrofit-design.md`

- [ ] **Step 1: Write the doc assertions first**

Add a short section that states:

- execution prompt and display prompt are separate
- stable facts live in preset fields
- Seedance / sequence / bridge share the same semantic contract

- [ ] **Step 2: Update the operational docs**

Adjust the current prompt inventory doc so it reflects the new contract vocabulary and no longer implies everything is free-form text.

- [ ] **Step 3: Re-read the docs for consistency**

Run:

```bash
git diff -- docs/sop/2026-04-20-致命抉择-各步骤最终prompt.md docs/superpowers/specs/2026-04-21-prompt-contract-retrofit-design.md
```

Expected: only contract wording changes, no accidental scope drift.

- [ ] **Step 4: Commit**

```bash
git add docs/sop/2026-04-20-致命抉择-各步骤最终prompt.md docs/superpowers/specs/2026-04-21-prompt-contract-retrofit-design.md
git commit -m "docs: describe contract-first prompt retrofit"
```

## Verification Gate

Before finishing, run the focused test set:

```bash
node --test tests/promptContract.test.js tests/characterRegistry.test.js tests/promptEngineer.artifacts.test.js tests/seedancePromptAgent.test.js tests/seedanceVideoApi.test.js tests/actionSequenceRouter.test.js tests/bridgeShotRouter.test.js tests/preflightQaAgent.test.js
```

Expected:

- all tests pass
- prompt contract fields are stable
- execution/display separation is enforced
- sequence and bridge still route correctly
- preflight still blocks expensive bad inputs

## Rollout Notes

- Do not change provider routing in the same step as prompt contract reshaping unless a test forces it.
- Keep prompt output deterministic before optimizing wording.
- If a step needs both structure and wording changes, land structure first, then wording.
- If any test starts needing broad snapshot rewrites, stop and reduce scope.


