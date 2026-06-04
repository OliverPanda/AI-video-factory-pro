# Shot Chain Wrist Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent script-specific core props, such as the binding chain in `双生囚笼`, from drifting across adjacent storyboard images without hardcoding that prop into global prompts.

**Architecture:** Add a script/episode-level core prop registry that stores prop appearance, aliases, anchor rules, forbidden placements, and active shot ranges. Prompt Engineer consumes these prop contracts only when the current shot references that prop; Continuity Checker and Preflight QA validate prop-anchor continuity from structured metadata instead of hardcoded chain terms.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing Prompt Engineer, Continuity Checker, Preflight QA Agent, current OpenAI-compatible image provider.

---

## File Structure

- Create: `src/agents/corePropRegistry.js`
  - Extract or normalize script-specific core prop contracts from shots.
  - For `双生囚笼`, represent the binding chain as data, not global prompt text.
- Modify: `src/agents/director.js`
  - Build and persist `corePropRegistry` after character registry and before prompt generation.
- Modify: `src/agents/promptEngineer.js`
  - Consume active core prop contracts for the current shot.
  - Append prop-specific positive and negative constraints generated from registry data.
- Modify: `src/agents/continuityChecker.js`
  - Add prop-state checks using `corePropRegistry` anchor rules.
- Modify: `src/agents/preflightQaAgent.js`
  - Add issue guidance for `prop_anchor_drift` and `forbidden_body_anchor`.
- Test: `tests/corePropRegistry.test.js`
  - Assert script-specific prop extraction creates a binding-chain contract for `双生囚笼`.
- Test: `tests/promptEngineer.artifacts.test.js`
  - Assert shot7-style prompts include wrist endpoints only when a core prop contract is provided.
- Test: `tests/continuityChecker.test.js`
  - Assert chain prop state drift is reported when a current shot moves the chain anchor from wrist to neck/collar.
- Test: `tests/preflightQaAgent.test.js`
  - Assert prop anchor drift produces warn guidance and repair directives.

## Task 1: Script-Level Core Prop Registry

**Files:**
- Create: `src/agents/corePropRegistry.js`
- Test: `tests/corePropRegistry.test.js`

- [ ] **Step 1: Write the failing prop registry test**

Create a test with `双生囚笼`-style shots:

```js
const shots = [
  { id: 'shot_005', characters: ['陆衍'], action: '陆衍的手腕被一道半透明的黑色锁链缠住，锁链另一端没入黑暗。' },
  { id: 'shot_006', characters: ['零'], action: '他手腕上缠着锁链的另一端。' },
  { id: 'shot_007', characters: ['陆衍', '零'], action: '双人近景。零与陆衍面对面，锁链绷直。' },
];
```

Expected:

```js
assert.equal(registry[0].propId, 'binding_chain');
assert.deepEqual(registry[0].aliases, ['锁链', '黑色锁链']);
assert.equal(registry[0].placementPolicy.anchorType, 'wrist_endpoint_pair');
assert.deepEqual(registry[0].placementPolicy.forbiddenAnchors, ['neck', 'collar', 'throat']);
assert.deepEqual(registry[0].activeShotIds, ['shot_005', 'shot_006', 'shot_007']);
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/corePropRegistry.test.js
```

Expected: FAIL because `corePropRegistry.js` does not exist.

- [ ] **Step 3: Implement `buildCorePropRegistry(shots, options)`**

Create a small registry builder:

```js
export function buildCorePropRegistry(shots = [], options = {}) {
  const propCandidates = detectPropCandidates(shots);
  return propCandidates.map((candidate) => normalizeCorePropContract(candidate, options));
}
```

For the first pass, use conservative rule extraction:

```js
function detectPropCandidates(shots = []) {
  const chainShots = shots.filter((shot) => /锁链/.test([shot.action, shot.dialogue].filter(Boolean).join(' ')));
  if (chainShots.length < 2) return [];
  return [{
    propId: 'binding_chain',
    displayName: '绑定锁链',
    aliases: ['锁链', '黑色锁链'],
    appearance: 'semi-transparent black chain',
    activeShotIds: chainShots.map((shot) => shot.id),
    placementPolicy: {
      anchorType: 'wrist_endpoint_pair',
      requiredVisibleAnchors: ['left_character_wrist', 'right_character_wrist'],
      forbiddenAnchors: ['neck', 'collar', 'throat'],
    },
  }];
}
```

This is still script-specific because it is generated from the current shots and persisted in state; it is not a global prompt rule.

- [ ] **Step 4: Run the prop registry test**

Run:

```bash
node --test tests/corePropRegistry.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/corePropRegistry.js tests/corePropRegistry.test.js
git commit -m "feat: add script-level core prop registry"
```

## Task 2: Prompt-Level Prop Contract Consumption

**Files:**
- Modify: `src/agents/promptEngineer.js`
- Test: `tests/promptEngineer.artifacts.test.js`

- [ ] **Step 1: Write the failing prompt test**

Add a test using `generatePromptForShot()` with a shot and a `corePropRegistry` dependency:

```js
const shot = {
  id: 'shot_007',
  scene: '游戏登录空间·虚空蓝光',
  characters: ['陆衍', '零'],
  action: '双人近景。零与陆衍面对面，锁链绷直。',
  dialogue: '存活条件：锁链距离不可超过10米。',
};
```

Mock `chatJSON` to return `image_prompt_en: 'two men facing each other, chain taut between them'`.

Pass:

```js
corePropRegistry: [{
  propId: 'binding_chain',
  aliases: ['锁链', '黑色锁链'],
  appearance: 'semi-transparent black chain',
  activeShotIds: ['shot_007'],
  placementPolicy: {
    anchorType: 'wrist_endpoint_pair',
    forbiddenAnchors: ['neck', 'collar', 'throat'],
  },
}]
```

Expected assertions:

```js
assert.match(prompt.image_prompt_en, /semi-transparent black chain/i);
assert.match(prompt.image_prompt_en, /endpoint locked around .* wrist/i);
assert.match(prompt.negative_prompt_en, /chain around neck/i);
assert.match(prompt.negative_prompt_en, /collar chain/i);
```

Add a second assertion that the same shot without `corePropRegistry` does not inject these prop-specific tokens.

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/promptEngineer.artifacts.test.js --test-name-pattern "chain prop anchor"
```

Expected: FAIL because prompt generation does not consume prop contracts yet.

- [ ] **Step 3: Implement `getActivePropContracts(shot, corePropRegistry)`**

In `src/agents/promptEngineer.js`, add:

```js
function getActivePropContracts(shot = {}, corePropRegistry = []) {
  return (Array.isArray(corePropRegistry) ? corePropRegistry : []).filter((prop) =>
    Array.isArray(prop.activeShotIds) && prop.activeShotIds.includes(shot.id)
  );
}
```

- [ ] **Step 4: Implement `buildPropContractPromptTokens(shot, activeProps)`**

Generate text from data:

```js
function buildPropContractPromptTokens(shot = {}, activeProps = []) {
  const names = Array.isArray(shot.characters) ? shot.characters : [];
  return activeProps.flatMap((prop) => {
    if (prop?.placementPolicy?.anchorType !== 'wrist_endpoint_pair') return [];
    const pair =
      names.length >= 2
        ? `same ${prop.appearance}, one endpoint locked around ${names[0]}'s wrist, the other endpoint locked around ${names[1]}'s wrist`
        : `same ${prop.appearance}, endpoint locked around visible wrist`;
    return [
      pair,
      `${prop.displayName || prop.propId} continuity lock, chain stretched between visible wrists, both wrists in frame`,
    ];
  }).join(', ');
}
```

Add this output into `mergePromptSegments()` before camera keywords.

- [ ] **Step 5: Implement `buildPropContractNegativeTokens(activeProps)`**

Generate negatives from `forbiddenAnchors`:

```js
function buildPropContractNegativeTokens(activeProps = []) {
  return activeProps.flatMap((prop) => {
    const forbidden = prop?.placementPolicy?.forbiddenAnchors || [];
    return forbidden.flatMap((anchor) => [
      `${prop.appearance || prop.displayName || 'prop'} around ${anchor}`,
      `${anchor} restraint`,
    ]);
  }).join(', ');
}
```

Add it to `fullNegativePrompt` before `styleBase.negative`.

- [ ] **Step 6: Run the prompt test**

Run:

```bash
node --test tests/promptEngineer.artifacts.test.js --test-name-pattern "chain prop anchor"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agents/promptEngineer.js tests/promptEngineer.artifacts.test.js
git commit -m "fix: consume core prop contracts in prompts"
```

## Task 3: Continuity QA for Prop Anchor Drift

**Files:**
- Modify: `src/agents/continuityChecker.js`
- Test: `tests/continuityChecker.test.js`

- [ ] **Step 1: Write the failing continuity test**

Add a test that passes two adjacent shots with `continuityState.propStates`:

```js
{
  name: 'binding_chain',
  holderEpisodeCharacterId: 'zero',
  side: 'wrist',
  state: 'attached'
}
```

Current shot should move it to `side: 'neck'`.

Expected:

```js
assert.equal(report.items[0].hardViolations.some((v) => v.code === 'prop_state_break'), true);
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/continuityChecker.test.js --test-name-pattern "prop state"
```

Expected: FAIL if no direct fixture covers this exact drift.

- [ ] **Step 3: Add prop-contract anchor validation**

Use the active prop contract to compare allowed anchors. If a prop's `placementPolicy.anchorType` is `wrist_endpoint_pair`, any detected or declared `neck`, `collar`, or `throat` anchor is a violation.

```js
function validatePropContractAnchors(shot = {}, activeProps = []) {
  const violations = [];
  const text = [shot.action, shot.dialogue, shot.scene].filter(Boolean).join(' ');
  for (const prop of activeProps) {
    const forbiddenAnchors = prop?.placementPolicy?.forbiddenAnchors || [];
    if (forbiddenAnchors.some((anchor) => new RegExp(anchor, 'i').test(text))) {
      addViolation(violations, 'prop_anchor_drift', 'high', `${prop.displayName || prop.propId} 锚点漂移到禁用身体位置`);
    }
  }
  return violations;
}
```

- [ ] **Step 4: Run the continuity test**

Run:

```bash
node --test tests/continuityChecker.test.js --test-name-pattern "prop state|chain anchor"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/continuityChecker.js tests/continuityChecker.test.js
git commit -m "fix: detect core prop anchor drift across shots"
```

## Task 4: Preflight Guidance for Forbidden Body Anchors

**Files:**
- Modify: `src/agents/preflightQaAgent.js`
- Test: `tests/preflightQaAgent.test.js`

- [ ] **Step 1: Write the failing preflight test**

Create a shot package with:

```js
qualityIssues: ['prop_anchor_drift', 'forbidden_body_anchor']
```

Expected:

```js
assert.equal(reviewed[0].preflightDecision, 'warn');
assert.match(reviewed[0].preflightFixBrief.suggestions.join(' '), /手腕/);
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/preflightQaAgent.test.js --test-name-pattern "prop anchor"
```

Expected: FAIL because issue labels/guidance do not exist.

- [ ] **Step 3: Add issue guidance**

Add to `ISSUE_GUIDANCE`:

```js
prop_anchor_drift: {
  label: '道具锚点漂移',
  suggestion: '按当前剧本的 corePropRegistry 修正道具锚点，画面需要露出必需端点，禁止漂移到 forbiddenAnchors。',
},
forbidden_body_anchor: {
  label: '禁用身体锚点',
  suggestion: '把 forbiddenAnchors 从生成语义中排除，并重申 placementPolicy 指定的 anchorType。',
},
```

Map both to `promptEngineer`, `continuityChecker`, and `seedancePromptAgent` as needed.

- [ ] **Step 4: Run the preflight test**

Run:

```bash
node --test tests/preflightQaAgent.test.js --test-name-pattern "prop anchor"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/preflightQaAgent.js tests/preflightQaAgent.test.js
git commit -m "fix: add preflight guidance for prop anchor drift"
```

## Task 5: Regenerate and Verify Shot 6/7

**Files:**
- No code changes unless Tasks 1-3 reveal a regression.
- Runtime output: `temp/legacy_双生囚笼_第1集_regenerate_*/images/shot_006.png`
- Runtime output: `temp/legacy_双生囚笼_第1集_regenerate_*/images/shot_007.png`

- [ ] **Step 1: Rerun the first episode to video preflight**

Run:

```bash
node scripts/run.js temp/双生囚笼-第1集-regenerate-20260427_204942.txt --style=realistic --input-format=professional-script --stop-before-video
```

Expected: Completes before video generation.

- [ ] **Step 2: Inspect prompt state**

Run:

```bash
rg -n "chain endpoint|chain around neck|collar chain|shot_006|shot_007" temp/legacy_双生囚笼_第1集_regenerate_20260427_204942_21890907fd3b/state.json
```

Expected: shot6/shot7 prompts contain prop-registry-derived wrist endpoint positives and forbidden-anchor negatives.

- [ ] **Step 3: Visual check**

Open:

```text
temp/legacy_双生囚笼_第1集_regenerate_20260427_204942_21890907fd3b/images/shot_006.png
temp/legacy_双生囚笼_第1集_regenerate_20260427_204942_21890907fd3b/images/shot_007.png
```

Expected: chain is attached to visible wrists, not neck/collar.

- [ ] **Step 4: Commit verification notes**

```bash
git add docs/superpowers/plans/2026-04-27-shot-chain-wrist-continuity.md
git commit -m "docs: plan chain wrist continuity fix"
```

