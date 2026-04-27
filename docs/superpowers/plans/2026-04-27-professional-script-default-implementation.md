# Professional Script Default Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `professional-script` the default CLI input mode and add a deterministic, reusable parser that preserves authored episode/scene/picture-beat structure.

**Architecture:** Add an input-format router around the existing `scriptParser` flow. The new `professionalScriptParser` handles structured scripts deterministically and produces the same legacy-compatible `title / characters / shots` output plus richer source/audio metadata; the existing LLM decomposition path becomes explicit `raw-novel` mode. CLI and director only pass mode metadata through, keeping downstream agents unchanged.

**Tech Stack:** Node.js ES modules, built-in `node:test`, existing artifact utilities, JSON run artifacts.

---

## Scope Check

This plan implements one cohesive parser behavior change:

- CLI default input format changes to `professional-script`.
- Professional scripts are parsed without LLM rewrite.
- Raw novel adaptation remains available behind `--input-format=raw-novel`.
- Tests and docs cover generic professional scripts, not only `双生囚笼`.

Out of scope:

- Prompt-engineering changes.
- Video generation changes.
- Binary reference image upload changes.
- Full project import UI for selecting one episode out of a 30-episode source. The parser should preserve episode metadata now; richer episode-selection UX can be planned separately.

## File Structure

- Create: `src/agents/professionalScriptParser.js`
  - Deterministic parser for professional short-drama scripts.
  - Exports `parseProfessionalScript(scriptText, options)` and focused helpers through `__testables`.
  - No network calls.

- Modify: `src/agents/scriptParser.js`
  - Add input format constants and routing.
  - Rename/wrap current LLM flow as raw-novel behavior internally.
  - Extend artifact config/metrics to record parser mode and professional metrics.

- Modify: `scripts/run.js`
  - Add `--input-format=professional-script|raw-novel|auto`.
  - Default to `professional-script`.
  - Pass `inputFormat` to legacy and project options.

- Modify: `src/agents/director.js`
  - Pass `options.inputFormat` into `parseScriptDeps`.
  - Persist compatibility metadata where appropriate.
  - Avoid changing downstream episode-run behavior.

- Modify: `README.md`
  - Document default professional-script mode and explicit raw-novel mode.

- Modify: `docs/agents/script-parser.md`
  - Document mode router, deterministic professional parsing, and raw-novel adaptation.

- Create: `tests/professionalScriptParser.test.js`
  - Unit tests for generic professional script parsing.

- Modify: `tests/scriptParser.test.js`
  - Integration tests for mode routing and raw-novel legacy behavior.

- Modify: `tests/scriptParser.artifacts.test.js`
  - Artifact tests for parser config/metrics in professional and raw-novel modes.

- Modify: `tests/runCli.test.js`
  - CLI tests for default, explicit raw-novel, explicit auto, invalid values, and option propagation.

## Task 1: Add CLI Input-Format Contract

**Files:**
- Modify: `scripts/run.js`
- Modify: `tests/runCli.test.js`

- [ ] **Step 1: Write failing tests for CLI parsing**

Add tests near existing `parseCliArgs` tests:

```js
test('parseCliArgs defaults inputFormat to professional-script', () => {
  const result = parseCliArgs(['samples/test_script.txt']);

  assert.equal(result.inputFormat, 'professional-script');
});

test('parseCliArgs accepts raw-novel input format', () => {
  const result = parseCliArgs(['samples/test_script.txt', '--input-format=raw-novel']);

  assert.equal(result.inputFormat, 'raw-novel');
});

test('parseCliArgs accepts auto input format', () => {
  const result = parseCliArgs(['samples/test_script.txt', '--input-format=auto']);

  assert.equal(result.inputFormat, 'auto');
});

test('parseCliArgs rejects invalid input format', () => {
  assert.throws(
    () => parseCliArgs(['samples/test_script.txt', '--input-format=wild']),
    /--input-format 必须是 professional-script、raw-novel 或 auto/
  );
});
```

Update existing deep-equality assertions in `tests/runCli.test.js` to include:

```js
inputFormat: 'professional-script',
```

- [ ] **Step 2: Write failing tests for dispatch propagation**

In `createCli dispatches legacy mode to runPipeline`, expect:

```js
inputFormat: 'professional-script',
```

inside `options`.

Add a new test:

```js
test('createCli passes explicit raw-novel input format to runPipeline', async () => {
  const calls = [];
  const cli = createCli({
    runPipeline: async (scriptPath, options) => {
      calls.push({ scriptPath, options });
      return '/tmp/raw-novel.mp4';
    },
    runEpisodePipeline: async () => {
      throw new Error('should not run project mode');
    },
    exit: () => {
      throw new Error('exit should not be called');
    },
    resolveScriptPath: (scriptPath) => scriptPath,
    writeBanner: () => {},
    writeSuccess: () => {},
  });

  await cli.run(['samples/test_script.txt', '--input-format=raw-novel']);

  assert.equal(calls[0].options.inputFormat, 'raw-novel');
});
```

Also update project-mode dispatch expectations so `options.inputFormat` is passed.

- [ ] **Step 3: Run CLI tests and verify failure**

Run:

```bash
node --test tests/runCli.test.js
```

Expected: FAIL because `inputFormat` is not parsed or propagated yet.

- [ ] **Step 4: Implement CLI parsing**

In `scripts/run.js`:

```js
const INPUT_FORMATS = new Set(['professional-script', 'raw-novel', 'auto']);

function normalizeInputFormat(value) {
  const normalized = normalizeId(value) || 'professional-script';
  if (!INPUT_FORMATS.has(normalized)) {
    throw new Error('--input-format 必须是 professional-script、raw-novel 或 auto。');
  }
  return normalized;
}
```

In `parseCliArgs(args)`:

```js
const inputFormat = normalizeInputFormat(getFlagValue(args, 'input-format'));
```

Return it:

```js
inputFormat,
```

Pass into project mode:

```js
inputFormat: parsedArgs.inputFormat,
```

Pass into legacy mode:

```js
inputFormat: parsedArgs.inputFormat,
```

Update `USAGE`:

```text
  --input-format=professional-script|raw-novel|auto
                             输入文本类型（默认：professional-script）
```

- [ ] **Step 5: Run CLI tests and verify pass**

Run:

```bash
node --test tests/runCli.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add scripts/run.js tests/runCli.test.js
git commit -m "feat: add input format cli option"
```

## Task 2: Build Generic Professional Script Parser

**Files:**
- Create: `src/agents/professionalScriptParser.js`
- Create: `tests/professionalScriptParser.test.js`

- [ ] **Step 1: Write failing tests for generic professional scripts**

Create `tests/professionalScriptParser.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProfessionalScript } from '../src/agents/professionalScriptParser.js';

const GENERIC_SCRIPT = `
《霜刃契约》短剧剧本
【tag】
古风、悬疑、双强

【世界观前置说明】
雪都被结界封锁，城中所有契约都会留下银色烙印。

第1集《雪门》
【场景】 雪都城门·夜

【画面1】
远景。暴雪压城，城门上悬着银色契约印。
SFX：风雪呼啸。

【画面2】
特写。沈砚抬手，掌心烙印亮起。
系统音：契约者身份确认。
沈砚（低声）：门开了。

【画面3】
黑屏。
字幕浮现：第1集·雪门 完。

第2集《入城》
【场景】 雪都长街·夜

【画面1】
中景。洛迟从灯影里走出，挡住沈砚。
洛迟：你不该来。
`;

test('parseProfessionalScript maps every picture block to one shot', () => {
  const result = parseProfessionalScript(GENERIC_SCRIPT);

  assert.equal(result.title, '霜刃契约');
  assert.equal(result.episodes.length, 2);
  assert.equal(result.shots.length, 4);
  assert.deepEqual(result.shots.map((shot) => shot.source.pictureNo), [1, 2, 3, 1]);
  assert.deepEqual(result.shots.map((shot) => shot.source.episodeNo), [1, 1, 1, 2]);
});

test('parseProfessionalScript preserves scene and authored order', () => {
  const result = parseProfessionalScript(GENERIC_SCRIPT);

  assert.equal(result.shots[0].scene, '雪都城门·夜');
  assert.equal(result.shots[2].blackScreen, true);
  assert.equal(result.shots[3].scene, '雪都长街·夜');
  assert.equal(result.shots[3].speaker, '洛迟');
  assert.equal(result.shots[3].dialogue, '你不该来。');
});

test('parseProfessionalScript preserves audio cues, sfx, subtitles, and raw block', () => {
  const result = parseProfessionalScript(GENERIC_SCRIPT);
  const shot = result.shots[1];

  assert.deepEqual(shot.audioCues, [
    { type: 'system_voice', speaker: '系统音', text: '契约者身份确认。' },
    { type: 'dialogue', speaker: '沈砚', performance: '低声', text: '门开了。' },
  ]);
  assert.equal(result.shots[0].sfx[0].text, '风雪呼啸。');
  assert.equal(result.shots[2].subtitle, '第1集·雪门 完。');
  assert.match(shot.source.rawBlock, /【画面2】/);
});

test('parseProfessionalScript extracts generic character names from dialogue and action', () => {
  const result = parseProfessionalScript(GENERIC_SCRIPT);

  assert.deepEqual(
    result.characters.map((character) => character.name),
    ['沈砚', '洛迟']
  );
  assert.deepEqual(result.shots[1].characters, ['沈砚']);
  assert.deepEqual(result.shots[3].characters, ['洛迟', '沈砚']);
});

test('parseProfessionalScript blocks professional input with no picture blocks', () => {
  assert.throws(
    () => parseProfessionalScript('第1集《空镜》\\n【场景】 空房间'),
    /professional-script 模式未找到任何【画面N】/
  );
});
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```bash
node --test tests/professionalScriptParser.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal parser module**

Create `src/agents/professionalScriptParser.js`.

Implementation outline:

```js
const TITLE_RE = /《([^》]+)》/;
const EPISODE_HEADING_RE = /^第\\s*(\\d+)\\s*集(?:《([^》]+)》)?\\s*$/;
const SCENE_RE = /^【场景】\\s*(.+)$/;
const PICTURE_RE = /^【画面\\s*(\\d+)】\\s*$/;
const SFX_RE = /^(?:SFX|音效)[:：]\\s*(.+)$/i;
const SUBTITLE_RE = /^字幕(?:浮现)?[:：]\\s*(.+)$/;
const SPEAKER_RE = /^([^：:（）()\\s]{1,20})(?:[（(]([^）)]+)[）)])?[:：]\\s*(.+)$/;
const CAMERA_PREFIX_RE = /^(特写|近景|中景|全景|远景|俯拍|航拍|推镜|拉镜|摇镜|跟拍)[。\\.、,，]?\\s*/;
```

Required exports:

```js
export function parseProfessionalScript(scriptText, options = {}) { ... }

export const __testables = {
  splitProfessionalEpisodes,
  parsePictureBlock,
  extractCharacters,
};
```

Data model to return:

```js
{
  title,
  totalDuration,
  characters,
  episodes,
  shots,
  parserMetadata: {
    inputFormat: 'professional-script',
    parserMode: 'deterministic-professional-script',
    fallbackUsed: false,
    llmRewriteUsed: false,
    metrics,
  },
}
```

Implementation details:

- Normalize line endings to `\n`.
- Extract title from the first `《...》` before the first episode heading, fallback to `options.title || '未命名剧本'`.
- Treat content before the first episode as `preamble`.
- Split episodes by lines matching `EPISODE_HEADING_RE`.
- Within each episode:
  - Track current scene from `【场景】`.
  - Start a new block at `【画面N】`.
  - Add following lines to that block until the next `【画面N】`, `【场景】`, or episode heading.
- If no picture blocks are found, throw:

```js
throw new Error('professional-script 模式未找到任何【画面N】，如需改编散文/小说请使用 --input-format=raw-novel');
```

`parsePictureBlock` should:

- Preserve `source.rawBlock`.
- Set `camera_type` from camera prefix if present.
- Put visual lines into `action`.
- Put `SFX：...` lines into `sfx`.
- Put `字幕浮现：...` into `subtitle`.
- Set `blackScreen` when a line contains `黑屏`.
- Treat `系统音：...` as `audioCues` type `system_voice`, with `speaker = '系统音'`.
- Treat `角色（表演）：台词` as dialogue cue.
- For compatibility, set `speaker/dialogue` to the first dialogue-like cue, preferring real dialogue over `system_voice` if both exist.
- Estimate `duration` deterministically:
  - Base 3 seconds.
  - Add `Math.ceil(dialogueText.length / 12)` for dialogue-heavy shots.
  - Clamp to 3-8 seconds.

Character extraction should be generic:

- From dialogue speakers except `系统音`, `旁白`, `字幕`, `SFX`.
- From action lines using known names discovered from dialogue.
- Do not hard-code `陆衍` or `零`.
- Return objects like `{ name }` for top-level `characters`.

- [ ] **Step 4: Run parser tests and verify pass**

Run:

```bash
node --test tests/professionalScriptParser.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/agents/professionalScriptParser.js tests/professionalScriptParser.test.js
git commit -m "feat: parse professional scripts deterministically"
```

## Task 3: Route Script Parser Modes

**Files:**
- Modify: `src/agents/scriptParser.js`
- Modify: `tests/scriptParser.test.js`

- [ ] **Step 1: Write failing route tests**

In `tests/scriptParser.test.js`, update the existing compatibility bridge test to explicitly use raw-novel:

```js
const result = await parseScript('测试剧本', {
  inputFormat: 'raw-novel',
  chatJSON: fakeChatJSON,
});
```

Add:

```js
test('parseScript defaults to professional-script and does not call chatJSON', async () => {
  const professionalText = `
《通用剧本》
第1集《开端》
【场景】 控制室·夜
【画面1】
全景。警报灯亮起。
SFX：警报声。
【画面2】
林澈：开始。
`;

  let called = false;
  const result = await parseScript(professionalText, {
    chatJSON: async () => {
      called = true;
      throw new Error('should not call llm');
    },
  });

  assert.equal(called, false);
  assert.equal(result.title, '通用剧本');
  assert.equal(result.shots.length, 2);
});

test('parseScript raw-novel uses existing llm decomposition flow', async () => {
  let callCount = 0;
  const result = await parseScript('散文式文本', {
    inputFormat: 'raw-novel',
    chatJSON: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          title: '旧流程',
          totalDuration: 3,
          characters: [],
          episodes: [{ episodeNo: 1, title: '第一集', summary: '概述' }],
        };
      }
      return { shots: [{ scene: '街角', action: '抬头' }] };
    },
  });

  assert.equal(callCount, 2);
  assert.equal(result.title, '旧流程');
  assert.equal(result.shots.length, 1);
});

test('parseScript auto detects professional picture markers', async () => {
  const result = await parseScript('第1集《开端》\\n【场景】 房间\\n【画面1】\\n特写。门开了。', {
    inputFormat: 'auto',
    chatJSON: async () => {
      throw new Error('should not call llm for professional markers');
    },
  });

  assert.equal(result.shots.length, 1);
});
```

- [ ] **Step 2: Run route tests and verify failure**

Run:

```bash
node --test tests/scriptParser.test.js
```

Expected: FAIL because `parseScript` still always uses the LLM flow.

- [ ] **Step 3: Refactor script parser mode router**

In `src/agents/scriptParser.js`:

Import:

```js
import { parseProfessionalScript } from './professionalScriptParser.js';
```

Add:

```js
export const INPUT_FORMATS = Object.freeze({
  PROFESSIONAL_SCRIPT: 'professional-script',
  RAW_NOVEL: 'raw-novel',
  AUTO: 'auto',
});

export function resolveInputFormat(inputFormat = INPUT_FORMATS.PROFESSIONAL_SCRIPT) {
  const normalized = typeof inputFormat === 'string' && inputFormat.trim()
    ? inputFormat.trim()
    : INPUT_FORMATS.PROFESSIONAL_SCRIPT;
  if (!Object.values(INPUT_FORMATS).includes(normalized)) {
    throw new Error(`未知 inputFormat：${normalized}`);
  }
  return normalized;
}

export function detectInputFormat(scriptText) {
  return /【画面\\s*\\d+】/.test(scriptText) || /^第\\s*\\d+\\s*集/m.test(scriptText)
    ? INPUT_FORMATS.PROFESSIONAL_SCRIPT
    : INPUT_FORMATS.RAW_NOVEL;
}
```

Extract the current body of `parseScript` into:

```js
export async function parseRawNovelScript(scriptText, deps = {}) { ...current parseScript body... }
```

Then make `parseScript` route:

```js
export async function parseScript(scriptText, deps = {}) {
  const requestedFormat = resolveInputFormat(deps.inputFormat);
  const inputFormat =
    requestedFormat === INPUT_FORMATS.AUTO ? detectInputFormat(scriptText) : requestedFormat;

  if (inputFormat === INPUT_FORMATS.PROFESSIONAL_SCRIPT) {
    logger.info('ScriptParser', '开始解析专业剧本...');
    const result = parseProfessionalScript(scriptText, deps);
    validateLegacyScriptData(result);
    writeParserArtifacts(scriptText, result, deps.artifactContext);
    logger.info('ScriptParser', `专业剧本解析完成：${result.shots.length} 个分镜，共 ${result.characters.length} 个角色`);
    return result;
  }

  return parseRawNovelScript(scriptText, {
    ...deps,
    resolvedInputFormat: INPUT_FORMATS.RAW_NOVEL,
  });
}
```

Make sure `parseRawNovelScript` still calls `writeParserArtifacts`.

- [ ] **Step 4: Run route tests and verify pass**

Run:

```bash
node --test tests/scriptParser.test.js tests/professionalScriptParser.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/agents/scriptParser.js tests/scriptParser.test.js
git commit -m "feat: route script parser by input format"
```

## Task 4: Update Parser Artifacts And Metrics

**Files:**
- Modify: `src/agents/scriptParser.js`
- Modify: `tests/scriptParser.artifacts.test.js`

- [ ] **Step 1: Write failing artifact tests**

In the existing raw-novel artifact test, pass `inputFormat: 'raw-novel'` and update expected `parserConfig`:

```js
assert.deepEqual(parserConfig, {
  inputFormat: 'raw-novel',
  parserMode: 'llm-raw-novel',
  detectedFormat: null,
  fallbackUsed: false,
  decompositionPrompt: 'script_decomposition',
  storyboardPrompt: 'episode_storyboard',
});
```

Update `parserMetrics` expectation to include:

```js
input_format: 'raw-novel',
parser_mode: 'llm-raw-novel',
episode_count: 1,
picture_block_count: 0,
preserved_picture_count: 0,
sfx_count: 0,
system_voice_count: 0,
subtitle_count: 0,
black_screen_count: 0,
llm_rewrite_used: true,
```

Add a new test:

```js
test('professional script parser artifacts record structure metrics', async (t) => {
  await withManagedTempRoot(t, 'aivf-professional-script-artifacts', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_professional',
      projectName: '专业剧本',
      scriptId: 'script_professional',
      scriptTitle: '专业剧本',
      episodeId: 'episode_001',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_professional_parser',
      startedAt: '2026-04-27T09:00:00.000Z',
    });

    await parseScript(
      [
        '《通用短剧》',
        '第1集《开场》',
        '【场景】 天台·夜',
        '【画面1】',
        '远景。城市灯光闪烁。',
        'SFX：风声。',
        '【画面2】',
        '黑屏。',
        '字幕浮现：第1集·开场 完。',
      ].join('\\n'),
      { artifactContext: ctx.agents.scriptParser }
    );

    const parserConfig = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.scriptParser.inputsDir, 'parser-config.json'), 'utf-8')
    );
    assert.equal(parserConfig.inputFormat, 'professional-script');
    assert.equal(parserConfig.parserMode, 'deterministic-professional-script');

    const metrics = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.scriptParser.metricsDir, 'parser-metrics.json'), 'utf-8')
    );
    assert.equal(metrics.picture_block_count, 2);
    assert.equal(metrics.preserved_picture_count, 2);
    assert.equal(metrics.sfx_count, 1);
    assert.equal(metrics.subtitle_count, 1);
    assert.equal(metrics.black_screen_count, 1);
    assert.equal(metrics.llm_rewrite_used, false);

    assert.equal(
      fs.existsSync(path.join(ctx.agents.scriptParser.outputsDir, 'professional-script-structure.json')),
      true
    );
  }, 'professional-script-parser');
});
```

- [ ] **Step 2: Run artifact tests and verify failure**

Run:

```bash
node --test tests/scriptParser.artifacts.test.js
```

Expected: FAIL because artifacts still use legacy config/metrics.

- [ ] **Step 3: Extend artifact writing**

In `buildParserMetrics(result)`:

- Preserve existing keys.
- Merge parser metadata metrics when present:

```js
const metadata = result?.parserMetadata || {};
const metadataMetrics = metadata.metrics || {};
return {
  input_format: metadata.inputFormat || 'raw-novel',
  parser_mode: metadata.parserMode || 'llm-raw-novel',
  episode_count: metadataMetrics.episode_count ?? 0,
  picture_block_count: metadataMetrics.picture_block_count ?? 0,
  preserved_picture_count: metadataMetrics.preserved_picture_count ?? 0,
  sfx_count: metadataMetrics.sfx_count ?? 0,
  system_voice_count: metadataMetrics.system_voice_count ?? 0,
  subtitle_count: metadataMetrics.subtitle_count ?? 0,
  black_screen_count: metadataMetrics.black_screen_count ?? 0,
  llm_rewrite_used: metadata.llmRewriteUsed ?? true,
  shot_count: shots.length,
  ...
};
```

In `writeParserArtifacts(...)`, replace the hard-coded parser config with:

```js
const metadata = result?.parserMetadata || {};
saveJSON(path.join(artifactContext.inputsDir, 'parser-config.json'), {
  inputFormat: metadata.inputFormat || 'raw-novel',
  parserMode: metadata.parserMode || 'llm-raw-novel',
  detectedFormat: metadata.detectedFormat || null,
  fallbackUsed: metadata.fallbackUsed === true,
  decompositionPrompt:
    metadata.inputFormat === 'professional-script' ? null : 'script_decomposition',
  storyboardPrompt:
    metadata.inputFormat === 'professional-script' ? null : 'episode_storyboard',
});
```

When professional structure exists:

```js
if (result.professionalStructure) {
  saveJSON(path.join(artifactContext.outputsDir, 'professional-script-structure.json'), result.professionalStructure);
}
```

Update manifest output files dynamically to include `professional-script-structure.json` only when present.

- [ ] **Step 4: Ensure raw-novel metadata is set**

In `parseRawNovelScript`, add:

```js
parserMetadata: {
  inputFormat: 'raw-novel',
  parserMode: 'llm-raw-novel',
  fallbackUsed: false,
  llmRewriteUsed: true,
  metrics: {
    episode_count: episodeData.episodes.length,
    picture_block_count: 0,
    preserved_picture_count: 0,
    sfx_count: 0,
    system_voice_count: 0,
    subtitle_count: 0,
    black_screen_count: 0,
  },
},
```

- [ ] **Step 5: Run artifact tests and verify pass**

Run:

```bash
node --test tests/scriptParser.artifacts.test.js tests/scriptParser.test.js tests/professionalScriptParser.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/agents/scriptParser.js tests/scriptParser.artifacts.test.js
git commit -m "feat: record parser input format artifacts"
```

## Task 5: Pass Input Format Through Director

**Files:**
- Modify: `src/agents/director.js`
- Modify: `tests/scriptParser.artifacts.test.js`
- Modify: `tests/director.project-run.test.js` if existing expectations fail

- [ ] **Step 1: Write failing director propagation test**

In `tests/scriptParser.artifacts.test.js`, inside `legacy runPipeline keeps parser artifacts...`, add assertions around the fake parser deps:

```js
let receivedInputFormat = null;
```

Inside `chatJSON`, this will not see deps directly. Instead override `parseScript` through director dependencies if available. If not ergonomic, add a focused test in a new or existing director test using `createDirector({ parseScript: async (_text, deps) => { receivedInputFormat = deps.inputFormat; ... } })`.

Suggested test:

```js
test('legacy runPipeline passes inputFormat to parseScript', async (t) => {
  await withManagedTempRoot(t, 'aivf-director-input-format', async (tempRoot) => {
    let receivedInputFormat = null;
    const legacyRoot = path.join(tempRoot, 'legacy-job');
    const scriptFilePath = path.join(tempRoot, 'professional.txt');
    fs.writeFileSync(scriptFilePath, '第1集《开端》\\n【画面1】\\n全景。', 'utf-8');

    const director = createDirector({
      initDirs: () => createLegacyDirs(legacyRoot),
      readTextFile: () => fs.readFileSync(scriptFilePath, 'utf-8'),
      parseScript: async (_scriptText, deps) => {
        receivedInputFormat = deps.inputFormat;
        return {
          title: '输入格式测试',
          totalDuration: 3,
          characters: [],
          shots: [{ id: 'shot_001', scene: '测试', characters: [], action: '全景。', dialogue: '', speaker: '', duration: 3 }],
        };
      },
      loadProject: () => null,
      saveProject: () => {},
      loadScript: () => null,
      saveScript: () => {},
      loadEpisode: () => null,
      saveEpisode: () => {},
      buildCharacterRegistry: async () => [],
      generateCharacterRefSheets: async () => [],
      generateAllPrompts: async () => [],
      generateAllImages: async () => [],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      planSceneGrammar: async () => [],
      planDirectorPacks: async () => [],
      planMotion: async () => [],
      planPerformance: async () => [],
      routeVideoShots: async () => [],
      runPreflightQa: async () => ({ reviewedPackages: [], report: { entries: [] } }),
    });

    await director.runPipeline(scriptFilePath, {
      inputFormat: 'raw-novel',
      stopBeforeVideo: true,
      storeOptions: { baseTempDir: tempRoot },
    });

    assert.equal(receivedInputFormat, 'raw-novel');
  }, 'director-input-format');
});
```

- [ ] **Step 2: Run targeted test and verify failure**

Run:

```bash
node --test tests/scriptParser.artifacts.test.js
```

Expected: FAIL if director is not passing `inputFormat` into `parseScript`.

- [ ] **Step 3: Implement director propagation**

In `src/agents/director.js`, locate:

```js
scriptData = await deps.parseScript(scriptText, {
  ...options.parseScriptDeps,
  artifactContext: bootstrapParserArtifactContext,
});
```

Change to:

```js
scriptData = await deps.parseScript(scriptText, {
  ...options.parseScriptDeps,
  inputFormat: options.inputFormat || options.parseScriptDeps?.inputFormat,
  artifactContext: bootstrapParserArtifactContext,
});
```

In compatibility state, include:

```js
inputFormat: options.inputFormat || options.parseScriptDeps?.inputFormat || 'professional-script',
```

Do not reparse existing persisted episodes if source hash matches.

- [ ] **Step 4: Run director/parser tests and verify pass**

Run:

```bash
node --test tests/scriptParser.artifacts.test.js tests/runCli.test.js tests/scriptParser.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/agents/director.js tests/scriptParser.artifacts.test.js
git commit -m "feat: pass input format through director"
```

## Task 6: Add Professional Fixture Acceptance For 10 Picture Beats

**Files:**
- Modify: `tests/professionalScriptParser.test.js`
- Optionally read: `samples/双生囚笼.txt`

- [ ] **Step 1: Add a compact 10-picture fixture test**

Do not rely on the full sample file for this unit test. Add a compact fixture that mirrors professional structure but stays generic:

```js
test('professional parser preserves ten authored picture beats', () => {
  const text = [
    '《十画面测试》',
    '第1集《链接》',
    '【场景】 登录空间·蓝光',
    ...Array.from({ length: 10 }, (_, index) => [
      `【画面${index + 1}】`,
      index === 9 ? '黑屏。' : `中景。角色在第${index + 1}个画面行动。`,
    ].join('\\n')),
  ].join('\\n');

  const result = parseProfessionalScript(text);

  assert.equal(result.shots.length, 10);
  assert.equal(result.parserMetadata.metrics.picture_block_count, 10);
  assert.equal(result.parserMetadata.metrics.preserved_picture_count, 10);
});
```

- [ ] **Step 2: Add a sample-based smoke test if stable**

If reading `samples/双生囚笼.txt` is acceptable in tests, add a smoke test that extracts only episode 1 text between `第1集《链接》` and `第2集《初见》`:

```js
test('双生囚笼 episode 1 preserves authored picture count', () => {
  const sample = fs.readFileSync(path.join(process.cwd(), 'samples', '双生囚笼.txt'), 'utf-8');
  const episode1 = sample.match(/第1集《链接》[\\s\\S]*?(?=\\n第2集《初见》)/)?.[0];
  assert.ok(episode1);

  const result = parseProfessionalScript(`《双生囚笼》\\n${episode1}`);

  assert.equal(result.shots.length, 10);
});
```

If repository policy avoids sample-dependent tests, skip this and keep the compact 10-picture fixture.

- [ ] **Step 3: Run parser test**

Run:

```bash
node --test tests/professionalScriptParser.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit Task 6**

```bash
git add tests/professionalScriptParser.test.js
git commit -m "test: guard professional picture preservation"
```

## Task 7: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/agents/script-parser.md`

- [ ] **Step 1: Update README CLI docs**

Add near run examples:

````markdown
默认输入格式是 `professional-script`。适合已经写成分集、场景、画面、台词、SFX 的专业短剧/漫剧剧本：

```bash
node scripts/run.js samples/双生囚笼.txt --style=realistic
```

等价于：

```bash
node scripts/run.js samples/双生囚笼.txt --style=realistic --input-format=professional-script
```

如果输入是野生小说、散文章节或故事大纲，需要显式启用改编模式：

```bash
node scripts/run.js samples/source.txt --input-format=raw-novel --style=realistic
```
````

- [ ] **Step 2: Update script parser docs**

In `docs/agents/script-parser.md`, add:

- Input modes.
- Default is professional-script.
- Professional parser preserves `【画面N】`.
- Raw-novel mode keeps the LLM rewrite path.
- Artifact changes.

- [ ] **Step 3: Run doc-adjacent checks**

Run:

```bash
node --test tests/runCli.test.js tests/scriptParser.test.js tests/scriptParser.artifacts.test.js tests/professionalScriptParser.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit Task 7**

```bash
git add README.md docs/agents/script-parser.md
git commit -m "docs: document professional script input mode"
```

## Task 8: Final Regression Run And Manual Acceptance

**Files:**
- No code changes expected.
- May generate temp artifacts.

- [ ] **Step 1: Run full targeted parser and CLI suite**

Run:

```bash
node --test tests/runCli.test.js tests/scriptParser.test.js tests/scriptParser.artifacts.test.js tests/professionalScriptParser.test.js
```

Expected: PASS.

- [ ] **Step 2: Run broader affected tests**

Run:

```bash
node --test tests/director.project-run.test.js tests/runArtifacts.test.js tests/promptEngineer.artifacts.test.js
```

Expected: PASS. If failures occur, inspect whether tests assume old parser config shape and update only those expectations.

- [ ] **Step 3: Run professional-script stop-before-video acceptance**

Use a small `--max-shots` first to avoid spend:

```bash
node scripts/run.js samples/双生囚笼.txt --style=realistic --max-shots=2 --stop-before-video
```

Expected:

- Parser artifacts show `inputFormat: professional-script`.
- First two authored picture beats become two shots.
- No video generation runs.

Then, when spend is acceptable:

```bash
node scripts/run.js samples/双生囚笼.txt --style=realistic --stop-before-video
```

Expected for episode 1 / selected slice:

- Authored `【画面】` count is preserved.
- `rawVideoResults` and `videoResults` remain empty due to stop-before-video.

Note: If running the full 30-episode script is too broad for legacy mode, extract episode 1 to a temp file as done during discovery and run that file. This is an operational acceptance step, not parser logic.

- [ ] **Step 4: Inspect artifacts manually**

Open latest parser metrics:

```bash
Get-ChildItem temp\projects -Recurse -Filter parser-metrics.json |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 |
  ForEach-Object { Get-Content $_.FullName -Raw }
```

Expected:

```json
{
  "input_format": "professional-script",
  "parser_mode": "deterministic-professional-script",
  "llm_rewrite_used": false
}
```

- [ ] **Step 5: Final status check**

Run:

```bash
git status --short
```

Expected: only intentional generated artifacts are untracked/modified. Do not stage temp outputs.

- [ ] **Step 6: Commit any final fixes**

If Task 8 required code/doc fixes:

```bash
git add <intentional files>
git commit -m "fix: stabilize professional script default mode"
```

Otherwise no commit is needed.

## Implementation Notes

- Keep parser rules generic. Do not special-case `双生囚笼`, `陆衍`, `零`, `系统音` beyond generic cue classification.
- Preserve authored shot count over aesthetic cleanup.
- Downstream agents consume the existing compatibility fields first; extra fields are additive.
- Avoid calling LLM in `professional-script` unit tests.
- If a professional script contains unusual labels, preserve unknown lines in `action` rather than dropping them.
- If a test must use Chinese paths or names, keep assertions semantic rather than path-fragile.

## Execution Handoff

Plan complete when this file is saved and reviewed. Recommended execution is task-by-task with a fresh worker per task because the repo has a dirty worktree and the change touches parser, CLI, artifacts, docs, and tests.
