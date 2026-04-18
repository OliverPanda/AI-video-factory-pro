# Bilingual Prompt Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separate English prompt fields for model/provider calls and Chinese prompt fields for UI/audit display, while keeping backward compatibility with the current prompt pipeline.

**Architecture:** Extend the Prompt Engineer output contract from a single `image_prompt`/`negative_prompt` pair to a bilingual prompt payload. The English fields remain the execution source of truth for image/video providers, while new Chinese display fields are generated and persisted for UI, QA, and artifact browsing. Roll out compatibly by preserving existing fields during migration, then teaching downstream consumers to prefer explicit English execution fields and Chinese display fields.

**Tech Stack:** Node.js, ES modules, project JSON artifacts, existing Prompt Engineer / Director / Video Router pipeline, Node test runner.

---

## File Map

- Modify: `src/agents/promptEngineer.js`
  Responsibility: produce bilingual prompt outputs, persist artifacts, and keep fallback behavior backward compatible.
- Modify: `src/llm/prompts/promptEngineering.js`
  Responsibility: change LLM output contract so prompt generation returns English execution prompt plus Chinese display summary.
- Modify: `src/agents/videoRouter.js`
  Responsibility: ensure downstream video planning reads explicit English execution prompt fields rather than UI display text.
- Modify: `src/apis/imageApi.js`
  Responsibility: keep provider invocation locked to English execution prompt fields only.
- Modify: `tests/promptEngineer.artifacts.test.js`
  Responsibility: cover bilingual prompt artifact contract and fallback payload shape.
- Modify: `tests/videoRouter.test.js`
  Responsibility: verify shot packages route with English execution prompt while keeping Chinese display prompt available.
- Modify: `README.md`
  Responsibility: document prompt field semantics for UI vs model execution.
- Modify: `docs/agents/agent-io-map.md`
  Responsibility: update prompt engineer output schema and downstream consumer contract.

### Task 1: Document Current Prompt Contract Gaps

**Files:**
- Modify: `README.md`
- Modify: `docs/agents/agent-io-map.md`

- [ ] **Step 1: Write the failing docs assertions as a checklist in the plan implementation branch**

Add/update docs notes to reflect the target contract:

```md
- `image_prompt_en`: only for model/provider execution
- `negative_prompt_en`: only for model/provider execution
- `display_prompt_zh`: only for UI / QA / artifact browsing
- `display_negative_prompt_zh`: optional Chinese negative prompt explanation for UI
```

- [ ] **Step 2: Confirm current docs are missing the bilingual contract**

Run: `rg -n "image_prompt_en|display_prompt_zh|negative_prompt_en" README.md docs/agents/agent-io-map.md`
Expected: no matches

- [ ] **Step 3: Add the minimal documentation changes**

Update docs so readers understand:

```md
Prompt Engineer outputs both execution fields and display fields.
Providers consume English execution fields only.
UI and QA dashboards should render Chinese display fields by default.
```

- [ ] **Step 4: Review docs diffs**

Run: `git diff -- README.md docs/agents/agent-io-map.md`
Expected: only prompt contract documentation changes

- [ ] **Step 5: Commit**

```bash
git add README.md docs/agents/agent-io-map.md
git commit -m "docs: clarify bilingual prompt field contract"
```

### Task 2: Add Bilingual Prompt Output Contract in Prompt Engineer

**Files:**
- Modify: `src/llm/prompts/promptEngineering.js`
- Modify: `src/agents/promptEngineer.js`
- Test: `tests/promptEngineer.artifacts.test.js`

- [ ] **Step 1: Write the failing test for bilingual prompt output**

Add a focused test case like:

```js
test('prompt engineer emits english execution fields and chinese display fields', async () => {
  const prompts = await generateAllPrompts(shots, registry, 'realistic', {
    chatJSON: async () => ({
      image_prompt_en: 'cinematic warehouse standoff',
      negative_prompt_en: 'blurry',
      display_prompt_zh: '仓库内三人对峙，陈默前压一步',
      display_negative_prompt_zh: '避免模糊、畸形手部',
      style_notes: '突出陈默的压迫感',
    }),
  });

  assert.equal(prompts[0].image_prompt_en, 'cinematic warehouse standoff');
  assert.equal(prompts[0].display_prompt_zh, '仓库内三人对峙，陈默前压一步');
  assert.equal(prompts[0].image_prompt.includes('cinematic warehouse standoff'), true);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `node --test tests/promptEngineer.artifacts.test.js`
Expected: FAIL because new fields are missing

- [ ] **Step 3: Extend the LLM prompt contract**

Update `PROMPT_ENGINEER_USER` JSON schema from:

```json
{
  "image_prompt": "...",
  "negative_prompt": "...",
  "style_notes": "..."
}
```

to:

```json
{
  "image_prompt_en": "English execution prompt",
  "negative_prompt_en": "English execution negative prompt",
  "display_prompt_zh": "Chinese UI display prompt",
  "display_negative_prompt_zh": "Chinese UI display negative prompt",
  "style_notes": "Chinese design notes"
}
```

- [ ] **Step 4: Implement minimal compatibility logic in `generatePromptForShot`**

Return a normalized shape like:

```js
return {
  shotId: shot.id,
  image_prompt_en: enhancedPromptEn,
  negative_prompt_en: fullNegativePromptEn,
  display_prompt_zh: result.display_prompt_zh || buildChineseDisplayPrompt(shot),
  display_negative_prompt_zh: result.display_negative_prompt_zh || '',
  image_prompt: enhancedPromptEn,
  negative_prompt: fullNegativePromptEn,
  style_notes: result.style_notes || '',
};
```

Compatibility rule:
- keep legacy `image_prompt` / `negative_prompt` for old readers
- set them equal to English execution fields during migration

- [ ] **Step 5: Update fallback prompt payload**

Fallback should emit:

```js
{
  shotId,
  image_prompt_en: englishFallbackPrompt,
  negative_prompt_en: styleBase.negative,
  display_prompt_zh: `${shot.scene}｜${shot.action}`,
  display_negative_prompt_zh: '避免低质量、卡通感、结构畸形',
  image_prompt: englishFallbackPrompt,
  negative_prompt: styleBase.negative,
  style_notes: '降级生成（LLM调用失败）',
}
```

Important:
- fallback execution prompt still needs to be English-first
- do not keep Chinese scene/action inside provider-facing prompt

- [ ] **Step 6: Run prompt engineer tests**

Run: `node --test tests/promptEngineer.artifacts.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/llm/prompts/promptEngineering.js src/agents/promptEngineer.js tests/promptEngineer.artifacts.test.js
git commit -m "feat: add bilingual prompt engineer outputs"
```

### Task 3: Separate UI Display Text from Provider Execution Text Downstream

**Files:**
- Modify: `src/agents/videoRouter.js`
- Modify: `src/apis/imageApi.js`
- Test: `tests/videoRouter.test.js`

- [ ] **Step 1: Write the failing downstream contract test**

Add/update a test like:

```js
test('video router prefers english execution prompt fields over display prompt fields', () => {
  const promptList = [{
    shotId: 'shot_001',
    image_prompt_en: 'english execution prompt',
    display_prompt_zh: '中文展示提示词',
    image_prompt: 'english execution prompt',
  }];

  const result = routeVideoShots(shots, { promptList, motionPlan, imageResults });
  assert.equal(result[0].visualGoal, 'english execution prompt');
});
```

- [ ] **Step 2: Run the targeted downstream test to verify it fails**

Run: `node --test tests/videoRouter.test.js`
Expected: FAIL if downstream still reads the wrong field or lacks explicit priority

- [ ] **Step 3: Implement minimal downstream priority rules**

Provider-facing consumers should read fields in this order:

```js
const executionPrompt =
  promptEntry?.image_prompt_en ||
  promptEntry?.image_prompt ||
  motionEntry.visualGoal;
```

For negative prompt:

```js
const executionNegativePrompt =
  promptEntry?.negative_prompt_en ||
  promptEntry?.negative_prompt ||
  '';
```

- [ ] **Step 4: Leave UI-oriented Chinese fields untouched in artifacts**

Do not feed `display_prompt_zh` into:
- image provider request
- video provider request
- continuity repair execution prompt

- [ ] **Step 5: Run downstream tests**

Run: `node --test tests/videoRouter.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agents/videoRouter.js src/apis/imageApi.js tests/videoRouter.test.js
git commit -m "refactor: separate execution prompts from display prompts"
```

### Task 4: Update Artifact Rendering for UI and Audit Friendliness

**Files:**
- Modify: `src/agents/promptEngineer.js`
- Test: `tests/promptEngineer.artifacts.test.js`

- [ ] **Step 1: Write the failing artifact/table expectation**

Add assertions like:

```js
assert.match(promptsTable, /Display Prompt ZH/);
assert.match(promptsTable, /Execution Prompt EN/);
```

- [ ] **Step 2: Run the artifact test to verify it fails**

Run: `node --test tests/promptEngineer.artifacts.test.js`
Expected: FAIL because the markdown table only has legacy columns

- [ ] **Step 3: Expand artifact table columns with backward compatibility**

Update `buildPromptsTable(...)` to include:

```md
| Shot ID | Source | Display Prompt ZH | Execution Prompt EN | Negative Prompt EN | Style Notes |
```

Keep `prompts.json` bilingual, not duplicated into a second file unless a real UI consumer needs a dedicated projection.

- [ ] **Step 4: Run artifact tests**

Run: `node --test tests/promptEngineer.artifacts.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/promptEngineer.js tests/promptEngineer.artifacts.test.js
git commit -m "feat: expose bilingual prompt artifacts for UI"
```

### Task 5: Regression Pass on Main Prompt Pipeline

**Files:**
- Modify: none unless regressions are found
- Test: `tests/promptEngineer.artifacts.test.js`
- Test: `tests/videoRouter.test.js`
- Test: `tests/ttsAgent.test.js`

- [ ] **Step 1: Run prompt engineer regression tests**

Run: `node --test tests/promptEngineer.artifacts.test.js`
Expected: PASS

- [ ] **Step 2: Run video router regression tests**

Run: `node --test tests/videoRouter.test.js`
Expected: PASS

- [ ] **Step 3: Run prompt-related TTS regression tests**

Run: `node --test tests/ttsAgent.test.js`
Expected: PASS

- [ ] **Step 4: Review final diff**

Run: `git diff --stat HEAD~4..HEAD`
Expected: prompt contract changes are limited to prompt generation, artifact rendering, docs, and downstream prompt readers

- [ ] **Step 5: Commit final polish if needed**

```bash
git add .
git commit -m "test: verify bilingual prompt contract regressions"
```

