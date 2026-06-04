# Consistency QA Tolerance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前统一阈值的一致性检查升级为“角色等级 × 镜头复杂度”的双轴 QA，并引入 `pass / warn / block` 与回锚重生成策略。

**Architecture:** 先补一个轻量的一致性判定协议层，把角色优先级、镜头复杂度、硬约束/软约束、推荐修复动作都标准化；再让 `Consistency Checker` 基于这套协议产出更业务化的结果；最后把 `Director` 的一致性补图从“统一 prompt 加强”升级为“按判定结果选择 prompt tighten 或 re-anchor regenerate”。保持现有 artifact、QA summary、`--stop-before-video`、preflight gate 和现有 JSON 状态兼容。

**Tech Stack:** Node.js ES modules, JSON artifact store, existing Director / Character Registry / Consistency Checker pipeline, Node test runner.

---

## File Map

- Create: `src/domain/consistencyQaPolicy.js`
  Responsibility: 统一角色等级、镜头复杂度、三段式 QA、阈值和推荐修复动作的纯函数协议。
- Create: `tests/consistencyQaPolicy.test.js`
  Responsibility: 覆盖双轴分级和 `pass / warn / block` 判定规则。
- Modify: `src/domain/characterBibleModel.js`
  Responsibility: 为角色主参考与角色优先级补默认字段，保持兼容。
- Modify: `src/agents/characterRegistry.js`
  Responsibility: 把 `CharacterBible` 中的 `priority / referenceImages / negativeDriftTokens` 等运行时暴露给下游一致性链路。
- Modify: `tests/characterBibleModel.test.js`
  Responsibility: 验证新增字段默认值和显式值保留。
- Modify: `tests/characterRegistry.test.js`
  Responsibility: 验证角色优先级与参考资产被注入 registry。
- Modify: `src/agents/consistencyChecker.js`
  Responsibility: 从“只看平均分 + needsRegeneration”升级为“报告 + QA decision + hard/soft reasons + regen strategy”。
- Modify: `src/llm/prompts/consistencyCheck.js`
  Responsibility: 让视觉判定输出更贴近硬/软约束分类，而不是只回一个总分。
- Modify: `tests/consistencyChecker.identity.test.js`
  Responsibility: 覆盖新判定语义、复杂镜头放宽、主角关键镜头更严等规则。
- Modify: `tests/ttsAgent.artifacts.test.js`
  Responsibility: 继续验证 consistency artifact，但断言新增输出字段。
- Modify: `tests/characterConsistency.acceptance.test.js`
  Responsibility: 用 acceptance 覆盖新 JSON/markdown/QA summary 落盘口径。
- Modify: `src/agents/director.js`
  Responsibility: 消费新的一致性结果，按 `regenStrategy` 执行 prompt tighten 或 re-anchor regenerate，并保持 `--stop-before-video` 不自动补图。
- Modify: `src/agents/imageGenerator.js`
  Responsibility: 如有必要，扩展 `regenerateImage(...)` 的可选参数以支持回锚参考图传递，但保持旧调用兼容。
- Modify: `tests/director.project-run.test.js`
  Responsibility: 覆盖 `warn / block`、回锚重生、stop-before-video 跳过自动补图等主流程行为。
- Modify: `docs/agents/consistency-checker.md`
  Responsibility: 更新 agent 说明，解释双轴 QA、三段式结果和新产物。
- Modify: `docs/agents/agent-io-map.md`
  Responsibility: 更新一致性链路输出 schema。
- Modify: `README.md`
  Responsibility: 补仓库级说明，避免继续把一致性理解成单阈值打分。

### Task 1: Add Consistency QA Policy Protocol

**Files:**
- Create: `src/domain/consistencyQaPolicy.js`
- Test: `tests/consistencyQaPolicy.test.js`

- [ ] **Step 1: Write the failing policy tests**

Add a new focused test file that defines the target behavior:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyShotConsistencyClass,
  resolveCharacterPriority,
  evaluateConsistencyDecision,
} from '../src/domain/consistencyQaPolicy.js';

test('lead + anchor warns below stricter threshold', () => {
  const decision = evaluateConsistencyDecision({
    overallScore: 8.2,
    characterPriority: 'lead',
    shotConsistencyClass: 'anchor',
    hardFailureReasons: [],
    softRiskTags: ['hair_drift'],
  });

  assert.equal(decision.status, 'warn');
});

test('hard identity failure blocks regardless of score', () => {
  const decision = evaluateConsistencyDecision({
    overallScore: 9.3,
    characterPriority: 'support',
    shotConsistencyClass: 'complex',
    hardFailureReasons: ['identity_swap'],
    softRiskTags: [],
  });

  assert.equal(decision.status, 'block');
  assert.equal(decision.regenStrategy, 'reanchor_regenerate');
});

test('support + complex can pass with moderate score when only soft risks exist', () => {
  const decision = evaluateConsistencyDecision({
    overallScore: 7.1,
    characterPriority: 'support',
    shotConsistencyClass: 'complex',
    hardFailureReasons: [],
    softRiskTags: ['palette_drift'],
  });

  assert.equal(decision.status, 'pass');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/consistencyQaPolicy.test.js`
Expected: FAIL because `src/domain/consistencyQaPolicy.js` does not exist yet.

- [ ] **Step 3: Implement the minimal policy module**

Create `src/domain/consistencyQaPolicy.js` with:

- `resolveCharacterPriority(card)`:
  - `card.priority ?? card.characterPriority ?? 'support'`
- `classifyShotConsistencyClass(shot)`:
  - return `anchor` for first appearance / close-up / key dialogue / single lead close shot
  - return `complex` for action / chase / crowd / occlusion / dark / wide
  - default `standard`
- `evaluateConsistencyDecision({...})`:
  - hard failures => `block`
  - else compare score against threshold matrix:
    - `lead+anchor=8.5`
    - `lead+standard=8.0`
    - `lead+complex=7.5`
    - `support+standard=7.5`
    - `support+complex=7.0`
  - if below threshold => `warn`
  - else `pass`
  - `regenStrategy`:
    - `block` => `reanchor_regenerate`
    - `warn` => `prompt_tighten`
    - `pass` => `none`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/consistencyQaPolicy.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/consistencyQaPolicy.js tests/consistencyQaPolicy.test.js
git commit -m "feat: add consistency qa policy protocol"
```

### Task 2: Surface Character Priority And Reference Assets In Runtime Registry

**Files:**
- Modify: `src/domain/characterBibleModel.js`
- Modify: `src/agents/characterRegistry.js`
- Test: `tests/characterBibleModel.test.js`
- Test: `tests/characterRegistry.test.js`

- [ ] **Step 1: Write/update the failing model and registry tests**

Add assertions like:

```js
assert.equal(bible.priority, 'support');
assert.deepEqual(bible.referenceImages, []);
```

and:

```js
assert.equal(registry[0].priority, 'lead');
assert.deepEqual(registry[0].referenceImages, ['ref/front.png']);
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `node --test tests/characterBibleModel.test.js tests/characterRegistry.test.js`
Expected: FAIL because `priority` is missing from the stable runtime contract.

- [ ] **Step 3: Add the minimal CharacterBible defaults**

Update `src/domain/characterBibleModel.js` so `createCharacterBible(input)` returns:

```js
priority: input.priority ?? 'support',
referenceImages: Array.isArray(input.referenceImages) ? input.referenceImages : [],
negativeDriftTokens: input.negativeDriftTokens ?? null,
```

Keep all existing fields backward compatible.

- [ ] **Step 4: Thread priority/reference assets through Character Registry**

Update `src/agents/characterRegistry.js` so each resolved runtime card includes:

- `priority`
- `referenceImages`
- `negativeDriftTokens`
- `characterBibleId`

Priority order:

1. explicit runtime override
2. `CharacterBible.priority`
3. fallback `'support'`

- [ ] **Step 5: Run the targeted tests**

Run: `node --test tests/characterBibleModel.test.js tests/characterRegistry.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/domain/characterBibleModel.js src/agents/characterRegistry.js tests/characterBibleModel.test.js tests/characterRegistry.test.js
git commit -m "feat: expose character priority and reference assets in registry"
```

### Task 3: Upgrade Consistency Checker To Dual-Axis QA Decisions

**Files:**
- Modify: `src/agents/consistencyChecker.js`
- Modify: `src/llm/prompts/consistencyCheck.js`
- Test: `tests/consistencyChecker.identity.test.js`
- Test: `tests/ttsAgent.artifacts.test.js`
- Test: `tests/characterConsistency.acceptance.test.js`

- [ ] **Step 1: Write the failing consistency checker tests**

Add/extend tests that assert:

- `lead + anchor` with score `8.2` becomes `warn`
- `support + complex` with score `7.1` and only soft risks can `pass`
- hard reasons such as `identity_swap` force `block`
- output report contains:
  - `characterPriority`
  - `shotConsistencyClass`
  - `qaDecision`
  - `hardFailureReasons`
  - `softRiskTags`
  - `regenStrategy`

Example assertion:

```js
assert.equal(result.reports[0].qaDecision.status, 'warn');
assert.equal(result.needsRegeneration[0].regenStrategy, 'prompt_tighten');
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `node --test tests/consistencyChecker.identity.test.js tests/ttsAgent.artifacts.test.js tests/characterConsistency.acceptance.test.js`
Expected: FAIL because the new decision schema is not emitted yet.

- [ ] **Step 3: Extend the consistency prompt contract minimally**

Update `src/llm/prompts/consistencyCheck.js` so the LLM output contract asks for:

```json
{
  "overallScore": 8,
  "identityDriftTags": ["hair_drift"],
  "hardFailureReasons": [],
  "softRiskTags": ["hair_drift"],
  "problematicImageIndices": [1],
  "suggestion": "..."
}
```

Compatibility rule:

- if `hardFailureReasons` missing => derive from known severe drift tags
- if `softRiskTags` missing => fall back to `identityDriftTags`

- [ ] **Step 4: Implement minimal normalization in `consistencyChecker.js`**

Normalize each report to include:

```js
{
  character,
  overallScore,
  characterPriority,
  shotConsistencyClass,
  identityDriftTags,
  hardFailureReasons,
  softRiskTags,
  qaDecision: {
    status,
    threshold,
    regenStrategy,
  },
}
```

Use the new policy module:

- derive `characterPriority` from runtime card
- derive `shotConsistencyClass` per affected shot
- aggregate per-shot `needsRegeneration` entries with:
  - `shotId`
  - `reason`
  - `regenStrategy`
  - `hardFailureReasons`
  - `softRiskTags`
  - `suggestion`

- [ ] **Step 5: Update markdown, metrics, and QA summary outputs**

Teach the artifact layer to write:

- decision counts
- block/warn/pass counts
- recommended regeneration strategy counts

Update summary copy so it no longer implies “all flagged shots must re-generate the same way”.

- [ ] **Step 6: Run the targeted tests**

Run: `node --test tests/consistencyChecker.identity.test.js tests/ttsAgent.artifacts.test.js tests/characterConsistency.acceptance.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/consistencyChecker.js src/llm/prompts/consistencyCheck.js tests/consistencyChecker.identity.test.js tests/ttsAgent.artifacts.test.js tests/characterConsistency.acceptance.test.js
git commit -m "feat: upgrade consistency checker to dual-axis qa decisions"
```

### Task 4: Teach Director To Execute Prompt Tighten Vs Re-Anchor Regeneration

**Files:**
- Modify: `src/agents/director.js`
- Modify: `src/agents/imageGenerator.js`
- Test: `tests/director.project-run.test.js`

- [ ] **Step 1: Add failing director tests for new regeneration behavior**

Add targeted tests that cover:

1. `prompt_tighten`:

```js
assert.match(regeneratePrompt, /highly consistent character appearance/i);
```

2. `reanchor_regenerate`:

```js
assert.deepEqual(regenerateOptions.referenceImages, ['ref/front.png']);
```

3. `--stop-before-video`:

```js
assert.equal(regenerateImageMock.callCount, 0);
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `node --test tests/director.project-run.test.js`
Expected: FAIL because director currently only does one uniform regeneration path.

- [ ] **Step 3: Implement minimal director branching**

Update the `regenerate_inconsistent_images` branch in `src/agents/director.js`:

- when `item.regenStrategy === 'prompt_tighten'`
  - keep current adjusted prompt path
- when `item.regenStrategy === 'reanchor_regenerate'`
  - prefer reference images from:
    1. `charCard.referenceImages`
    2. `charCard.referenceImagePath`
    3. existing best image fallback
  - pass them to `regenerateImage(...)` through a backward-compatible `options.referenceImages`

Do not change stop-before-video behavior.

- [ ] **Step 4: Implement minimal backward-compatible support in image generator if needed**

If `regenerateImage(...)` currently ignores `options.referenceImages`, add a no-op compatible path first so tests can assert the request is forwarded without breaking old callers.

- [ ] **Step 5: Run the targeted test**

Run: `node --test tests/director.project-run.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agents/director.js src/agents/imageGenerator.js tests/director.project-run.test.js
git commit -m "feat: route consistency regeneration by qa strategy"
```

### Task 5: Update Docs And Repository Contracts

**Files:**
- Modify: `docs/agents/consistency-checker.md`
- Modify: `docs/agents/agent-io-map.md`
- Modify: `README.md`

- [ ] **Step 1: Write the doc delta checklist in the branch**

Document the new contract:

- `characterPriority`
- `shotConsistencyClass`
- `qaDecision`
- `hardFailureReasons`
- `softRiskTags`
- `regenStrategy`

- [ ] **Step 2: Confirm docs are currently missing the new contract**

Run: `rg -n "qaDecision|regenStrategy|shotConsistencyClass|characterPriority" README.md docs/agents/consistency-checker.md docs/agents/agent-io-map.md`
Expected: no or incomplete matches

- [ ] **Step 3: Update the docs**

Make sure docs explain:

- current strategy is no longer “single threshold only”
- complex scenes can be more tolerant without allowing identity swaps
- director regeneration can choose between prompt tightening and re-anchoring

- [ ] **Step 4: Review doc diffs**

Run: `git diff -- README.md docs/agents/consistency-checker.md docs/agents/agent-io-map.md`
Expected: only documentation changes

- [ ] **Step 5: Commit**

```bash
git add README.md docs/agents/consistency-checker.md docs/agents/agent-io-map.md
git commit -m "docs: clarify dual-axis consistency qa contract"
```

### Task 6: Run Focused Regression Sweep

**Files:**
- Test only

- [ ] **Step 1: Run the focused consistency and director suite**

Run:

```bash
node --test tests/consistencyQaPolicy.test.js tests/characterBibleModel.test.js tests/characterRegistry.test.js tests/consistencyChecker.identity.test.js tests/ttsAgent.artifacts.test.js tests/characterConsistency.acceptance.test.js tests/director.project-run.test.js
```

Expected: PASS

- [ ] **Step 2: Run adjacent pipeline safety tests**

Run:

```bash
node --test tests/continuityChecker.test.js tests/preflightQaAgent.test.js tests/videoRouter.test.js tests/pipeline.acceptance.test.js
```

Expected: PASS

- [ ] **Step 3: Review final diff**

Run:

```bash
git diff --stat HEAD~6..HEAD
```

Expected: only consistency QA, director regeneration, and documentation related files changed.

- [ ] **Step 4: Final commit if the regression sweep required fixes**

```bash
git add -A
git commit -m "test: stabilize consistency qa tolerance rollout"
```

## Notes For Implementers

- Keep all old consumers working while new fields are introduced.
- Do not remove `needsRegeneration`; evolve its shape compatibly.
- Do not let this rollout trigger video generation in tests or real runs.
- Preserve `--stop-before-video` semantics: report risk, skip auto-spend.
- Favor pure helper functions for classification/policy logic so thresholds stay testable.

