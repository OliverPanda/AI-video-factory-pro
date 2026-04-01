# Auditable Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an auditable run-package workflow where every agent writes stable, inspectable artifacts under `temp/`, while `output/` remains limited to final delivery files.

**Architecture:** Introduce a dedicated run-artifact layer that creates human-readable plus stable-ID directory structures and agent-scoped artifact contracts. Wire that layer into `director` first so every run gets a manifest, timeline, and per-agent folders, then incrementally teach each agent to write inputs, outputs, metrics, and errors into its own directory. Finish by upgrading tests from function-only assertions to artifact-contract and real integration verification.

**Tech Stack:** Node.js ES modules, local JSON/Markdown artifact files, existing `projectStore`/`jobStore`, FFmpeg, current real providers for LLM/image/TTS, `node:test`

---

## File Map

### New Files

- `src/utils/naming.js`
  Responsibility: convert project/script/episode titles into readable directory names like `项目名__projectId` and `第01集__episodeId`.

- `src/utils/runArtifacts.js`
  Responsibility: build run-package directory trees, write agent manifests, write metrics/error files, and expose helper APIs for per-agent artifact paths.

- `tests/runArtifacts.test.js`
  Responsibility: validate naming rules, run-directory layout, and artifact helper output paths.

- `tests/director.artifacts.test.js`
  Responsibility: verify `director` creates run manifest, timeline, and agent directories even when downstream steps are stubbed.

- `tests/scriptParser.artifacts.test.js`
  Responsibility: verify parser artifacts such as `shots.flat.json`, `shots.table.md`, and metrics are written.

- `tests/promptEngineer.artifacts.test.js`
  Responsibility: verify prompt artifact contract, especially fallback and invalid-json evidence files.

- `tests/imageGenerator.artifacts.test.js`
  Responsibility: verify image artifact index, retry log, and per-shot error evidence writing.

- `tests/ttsAgent.artifacts.test.js`
  Responsibility: verify voice-resolution, audio index, and metrics artifact writing.

- `tests/videoComposer.artifacts.test.js`
  Responsibility: verify compose plan, segment index, and FFmpeg stderr/command evidence writing.

- `tests/pipeline.acceptance.test.js`
  Responsibility: run a minimal pipeline with controlled stubs and assert that the full run package is materialized.

- `tests/outputLayout.test.js`
  Responsibility: verify final delivery files land under `output/项目名__projectId/第01集__episodeId/` and intermediate artifacts stay under `temp/`.

### Modified Files

- `src/utils/fileHelper.js`
  Add readable directory helpers and keep compatibility wrappers small.

- `src/utils/jobStore.js`
  Extend run job schema to point to artifact directories and summary metadata without mixing all detail into one JSON blob.

- `src/utils/projectStore.js`
  Continue providing project metadata and ensure `director` can load `project.name` for readable directory naming.

- `src/agents/director.js`
  Make `director` the single entry that creates run packages, root manifests, timelines, and agent-scoped artifact contexts.

- `src/agents/scriptParser.js`
  Teach parser to persist source input, decomposition outputs, tables, and parser metrics/errors when artifact context is present.

- `src/agents/characterRegistry.js`
  Teach registry to persist role cards, name mappings, coverage metrics, and invalid-response evidence when artifact context is present.

- `src/agents/promptEngineer.js`
  Teach prompt generation to persist prompt tables, source markers, metrics, and invalid JSON/retry evidence.

- `src/agents/imageGenerator.js`
  Teach image generation to persist image index, provider config snapshot, retry log, contact sheet hook, and structured shot errors.

- `src/agents/consistencyChecker.js`
  Teach consistency checking to persist reports, flagged shots, metrics, and LLM evidence.

- `src/agents/ttsAgent.js`
  Teach TTS to persist voice resolution, audio index, dialogue table, metrics, and per-shot errors.

- `src/agents/videoComposer.js`
  Teach composer to persist compose plan, segment index, subtitle path, video metrics, and FFmpeg command/stderr evidence.

- `scripts/run.js`
  Keep CLI compatible while surfacing the new run-package location in terminal output.

- `README.md`
  Update directory structure, run outputs, and test commands to reflect auditable workflow behavior.

## Task 1: Build Naming and Run-Artifact Foundations

**Files:**
- Create: `src/utils/naming.js`
- Create: `src/utils/runArtifacts.js`
- Test: `tests/runArtifacts.test.js`

- [ ] **Step 1: Write the failing naming and layout tests**

```js
test('buildProjectDirName combines readable title with stable id', () => {
  assert.equal(buildProjectDirName('咖啡馆相遇', 'project_123'), '咖啡馆相遇__project_123');
});

test('buildEpisodeDirName normalizes episode numbers into 第01集 format', () => {
  assert.equal(buildEpisodeDirName({ episodeNo: 1, id: 'episode_001' }), '第01集__episode_001');
});

test('createRunArtifactContext creates root manifest-friendly folder structure', () => {
  const ctx = createRunArtifactContext({
    baseTempDir: tempRoot,
    projectId: 'project_123',
    projectName: '咖啡馆相遇',
    scriptId: 'script_001',
    scriptTitle: '第一卷',
    episodeId: 'episode_001',
    episodeTitle: '试播集',
    episodeNo: 1,
    runJobId: 'run_abc',
    startedAt: '2026-04-01T09:00:00.000Z',
  });

  assert.ok(fs.existsSync(path.join(ctx.runDir, 'manifest.json')) === false);
  assert.ok(ctx.agents.scriptParser.dir.endsWith(path.join('01-script-parser')));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/runArtifacts.test.js`  
Expected: FAIL because `naming.js` and `runArtifacts.js` do not exist yet

- [ ] **Step 3: Implement minimal naming and artifact helpers**

```js
export function buildReadableIdName(label, id) {
  const safeLabel = normalizeReadableSegment(label || 'untitled');
  return `${safeLabel}__${id}`;
}

export function buildEpisodeDirName(episode) {
  const no = String(Number(episode?.episodeNo) || 1).padStart(2, '0');
  return `第${no}集__${episode.id}`;
}

export function createRunArtifactContext(input) {
  const runDir = path.join(/* project/script/episode/runs/... */);
  const agents = {
    scriptParser: createAgentContext(runDir, '01-script-parser'),
    characterRegistry: createAgentContext(runDir, '02-character-registry'),
    promptEngineer: createAgentContext(runDir, '03-prompt-engineer'),
    imageGenerator: createAgentContext(runDir, '04-image-generator'),
    consistencyChecker: createAgentContext(runDir, '05-consistency-checker'),
    ttsAgent: createAgentContext(runDir, '06-tts-agent'),
    videoComposer: createAgentContext(runDir, '07-video-composer'),
  };
  return { runDir, agents };
}
```

Each `createAgentContext(...)` should expose:

```js
{
  dir,
  manifestPath,
  inputsDir,
  outputsDir,
  metricsDir,
  errorsDir,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/runArtifacts.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/naming.js src/utils/runArtifacts.js tests/runArtifacts.test.js
git commit -m "feat: add auditable run artifact scaffolding"
```

## Task 2: Make Director Create Root Run Packages

**Files:**
- Modify: `src/agents/director.js`
- Modify: `src/utils/jobStore.js`
- Test: `tests/director.artifacts.test.js`

- [ ] **Step 1: Write the failing director artifact test**

```js
test('director creates manifest timeline and agent directories for an episode run', async () => {
  const director = createDirector({
    parseScript: async () => { throw new Error('should not be used in project mode'); },
    buildCharacterRegistry: async () => [],
    generateAllPrompts: async () => [],
    generateAllImages: async () => [],
    generateAllAudio: async () => [],
    composeVideo: async () => '/tmp/final.mp4',
    loadProject: () => ({ id: 'project_123', name: '咖啡馆相遇' }),
    loadScript: () => ({ id: 'script_001', title: '第一卷', characters: [], sourceText: '...' }),
    loadEpisode: () => ({ id: 'episode_001', title: '试播集', episodeNo: 1, shots: [] }),
    createRunJob: (input) => input,
    appendAgentTaskRun: () => {},
    finishRunJob: () => {},
    initDirs: () => ({ root: legacyRoot, images: `${legacyRoot}/images`, audio: `${legacyRoot}/audio`, output: `${legacyRoot}/output` }),
  });

  await director.runEpisodePipeline({ projectId: 'project_123', scriptId: 'script_001', episodeId: 'episode_001', options: { storeOptions: { baseTempDir: tempRoot } } });

  assert.ok(fs.existsSync(path.join(expectedRunDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(expectedRunDir, 'timeline.json')));
  assert.ok(fs.existsSync(path.join(expectedRunDir, '01-script-parser')));
  assert.ok(fs.existsSync(path.join(expectedRunDir, '01-script-parser', 'manifest.json')));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-isolation=none tests/director.artifacts.test.js`  
Expected: FAIL because `director` does not yet create run-package artifacts

- [ ] **Step 3: Implement minimal director wiring**

```js
const artifactContext = createRunArtifactContext({
  baseTempDir: options.storeOptions?.baseTempDir,
  projectId,
  projectName: project.name || projectId,
  scriptId,
  scriptTitle,
  episodeId,
  episodeTitle,
  episodeNo: episode.episodeNo,
  runJobId: runJobRef.id,
  startedAt: new Date().toISOString(),
});

writeRunManifest(artifactContext, {/* ids, names, style, provider summary */});
appendTimelineEvent(artifactContext, {/* step, status, startedAt */});
writeAgentManifest(artifactContext.agents.scriptParser, { status: 'pending' });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-isolation=none tests/director.artifacts.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/director.js src/utils/jobStore.js tests/director.artifacts.test.js
git commit -m "feat: create auditable run packages from director"
```

## Task 3: Add Script Parser Artifacts

**Files:**
- Modify: `src/agents/scriptParser.js`
- Modify: `src/agents/director.js`
- Test: `tests/scriptParser.artifacts.test.js`

- [ ] **Step 1: Write the failing parser artifact test**

```js
test('script parser writes source script shot table and parser metrics', async () => {
  const chatJSON = async () => ({
    title: '咖啡馆相遇',
    totalDuration: 6,
    characters: [{ name: '小红', gender: 'female' }],
    episodes: [{ episodeNo: 1, title: '试播集', summary: '...' }],
  });

  const ctx = createRunArtifactContext(/* temp root + ids */);
  await parseScript('原始剧本文本', { chatJSON, artifactContext: ctx.agents.scriptParser });

  assert.ok(fs.existsSync(path.join(ctx.agents.scriptParser.outputsDir, 'shots.flat.json')));
  assert.ok(fs.existsSync(path.join(ctx.agents.scriptParser.outputsDir, 'shots.table.md')));
  assert.ok(fs.existsSync(path.join(ctx.agents.scriptParser.metricsDir, 'parser-metrics.json')));
  assert.ok(fs.existsSync(ctx.agents.scriptParser.manifestPath));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/scriptParser.artifacts.test.js`  
Expected: FAIL because parser does not write artifacts yet

- [ ] **Step 3: Implement minimal parser artifact writing**

```js
function writeParserArtifacts(artifactContext, payload) {
  saveJSON(path.join(artifactContext.inputsDir, 'parser-config.json'), payload.config);
  saveJSON(path.join(artifactContext.outputsDir, 'shots.flat.json'), payload.shots);
  saveText(path.join(artifactContext.outputsDir, 'shots.table.md'), renderShotsTable(payload.shots));
  saveJSON(path.join(artifactContext.metricsDir, 'parser-metrics.json'), buildParserMetrics(payload));
  saveJSON(artifactContext.manifestPath, { status: 'completed', shotCount: payload.shots.length });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scriptParser.artifacts.test.js tests/scriptParser.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/scriptParser.js src/agents/director.js tests/scriptParser.artifacts.test.js tests/scriptParser.test.js
git commit -m "feat: persist script parser artifacts"
```

## Task 4: Add Character Registry and Prompt Engineer Artifacts

**Files:**
- Modify: `src/agents/characterRegistry.js`
- Modify: `src/agents/promptEngineer.js`
- Modify: `src/agents/director.js`
- Test: `tests/promptEngineer.artifacts.test.js`
- Test: `tests/ttsAgent.test.js`

- [ ] **Step 1: Write the failing artifact tests**

```js
test('character registry writes registry cards and coverage metrics', async () => {
  const ctx = createRunArtifactContext(/* ... */);
  await buildCharacterRegistry(characters, storyContext, style, { artifactContext: ctx.agents.characterRegistry, chatJSON });
  assert.ok(fs.existsSync(path.join(ctx.agents.characterRegistry.outputsDir, 'character-registry.json')));
  assert.ok(fs.existsSync(path.join(ctx.agents.characterRegistry.outputsDir, 'character-registry.md')));
  assert.ok(fs.existsSync(ctx.agents.characterRegistry.manifestPath));
});

test('prompt engineer writes prompt table source map and invalid json evidence', async () => {
  const ctx = createRunArtifactContext(/* ... */);
  await generateAllPrompts(shots, registry, 'realistic', { artifactContext: ctx.agents.promptEngineer, chatJSON });
  assert.ok(fs.existsSync(path.join(ctx.agents.promptEngineer.outputsDir, 'prompts.json')));
  assert.ok(fs.existsSync(path.join(ctx.agents.promptEngineer.outputsDir, 'prompt-sources.json')));
  assert.ok(fs.existsSync(path.join(ctx.agents.promptEngineer.metricsDir, 'prompt-metrics.json')));
  assert.ok(fs.existsSync(ctx.agents.promptEngineer.manifestPath));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/promptEngineer.artifacts.test.js`  
Expected: FAIL because these agents do not persist artifact files yet

- [ ] **Step 3: Implement minimal artifact persistence**

```js
saveJSON(path.join(artifactContext.outputsDir, 'character-registry.json'), registry);
saveText(path.join(artifactContext.outputsDir, 'character-registry.md'), renderCharacterCards(registry));
saveJSON(artifactContext.manifestPath, { status: 'completed', characterCount: registry.length });

saveJSON(path.join(promptArtifact.outputsDir, 'prompts.json'), promptList);
saveJSON(path.join(promptArtifact.outputsDir, 'prompt-sources.json'), sourceMap);
saveJSON(path.join(promptArtifact.metricsDir, 'prompt-metrics.json'), buildPromptMetrics(promptList, sourceMap));
saveJSON(promptArtifact.manifestPath, { status: 'completed', promptCount: promptList.length });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/promptEngineer.artifacts.test.js tests/ttsAgent.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/characterRegistry.js src/agents/promptEngineer.js src/agents/director.js tests/promptEngineer.artifacts.test.js tests/ttsAgent.test.js
git commit -m "feat: persist registry and prompt artifacts"
```

## Task 5: Add Image Generator Artifacts and Failure Evidence

**Files:**
- Modify: `src/agents/imageGenerator.js`
- Modify: `src/agents/director.js`
- Test: `tests/imageGenerator.artifacts.test.js`
- Test: `tests/imageApi.integration.test.js`

- [ ] **Step 1: Write the failing image artifact test**

```js
test('image generator writes image index metrics and retry evidence', async () => {
  const artifactContext = createRunArtifactContext(/* ... */).agents.imageGenerator;
  const generateImage = async (prompt, negativePrompt, outputPath) => {
    fs.writeFileSync(outputPath, Buffer.from('png'));
    return outputPath;
  };

  const results = await generateAllImages(promptList, imagesDir, {
    style: 'realistic',
    artifactContext,
    generateImage,
  });

  assert.equal(results.length, 2);
  assert.ok(fs.existsSync(path.join(artifactContext.outputsDir, 'images.index.json')));
  assert.ok(fs.existsSync(path.join(artifactContext.metricsDir, 'image-metrics.json')));
  assert.ok(fs.existsSync(artifactContext.manifestPath));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/imageGenerator.artifacts.test.js`  
Expected: FAIL because image artifact files are not written yet

- [ ] **Step 3: Implement minimal image artifact writing**

```js
saveJSON(path.join(artifactContext.inputsDir, 'provider-config.json'), { style, provider: process.env.PRIMARY_API_PROVIDER });
saveJSON(path.join(artifactContext.outputsDir, 'images.index.json'), results);
saveJSON(path.join(artifactContext.metricsDir, 'image-metrics.json'), buildImageMetrics(results));
saveJSON(path.join(artifactContext.errorsDir, 'retry-log.json'), retryEvents);
saveJSON(artifactContext.manifestPath, { status: 'completed', successCount: buildImageMetrics(results).success_count });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/imageGenerator.artifacts.test.js tests/imageApi.integration.test.js`  
Expected: PASS when the real image provider is available

- [ ] **Step 5: Commit**

```bash
git add src/agents/imageGenerator.js src/agents/director.js tests/imageGenerator.artifacts.test.js tests/imageApi.integration.test.js
git commit -m "feat: persist image generation artifacts"
```

## Task 6: Add Consistency Checker and TTS Artifacts

**Files:**
- Modify: `src/agents/consistencyChecker.js`
- Modify: `src/agents/ttsAgent.js`
- Modify: `src/agents/director.js`
- Test: `tests/ttsAgent.artifacts.test.js`
- Test: `tests/ttsAgent.voicePreset.test.js`

- [ ] **Step 1: Write the failing artifact tests**

```js
test('consistency checker writes report and agent manifest', async () => {
  const artifactContext = createRunArtifactContext(/* ... */).agents.consistencyChecker;
  await runConsistencyCheck(imageResults, registry, {
    artifactContext,
    chatVision: async () => ({ flaggedShots: [], averageScore: 9 }),
  });

  assert.ok(fs.existsSync(path.join(artifactContext.outputsDir, 'consistency-report.json')));
  assert.ok(fs.existsSync(artifactContext.manifestPath));
});

test('tts agent writes voice resolution audio index and metrics', async () => {
  const artifactContext = createRunArtifactContext(/* ... */).agents.ttsAgent;
  await generateAllAudio(shots, registry, audioDir, {
    artifactContext,
    textToSpeech,
  });

  assert.ok(fs.existsSync(path.join(artifactContext.inputsDir, 'voice-resolution.json')));
  assert.ok(fs.existsSync(path.join(artifactContext.outputsDir, 'audio.index.json')));
  assert.ok(fs.existsSync(path.join(artifactContext.metricsDir, 'tts-metrics.json')));
  assert.ok(fs.existsSync(artifactContext.manifestPath));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/ttsAgent.artifacts.test.js`  
Expected: FAIL because TTS artifact files are not written yet

- [ ] **Step 3: Implement minimal consistency and TTS artifact persistence**

```js
saveJSON(path.join(consistencyContext.outputsDir, 'consistency-report.json'), report);
saveJSON(consistencyContext.manifestPath, { status: 'completed', flaggedCount: report.flaggedShots.length });
saveJSON(path.join(ttsContext.inputsDir, 'voice-resolution.json'), voiceResolution);
saveJSON(path.join(ttsContext.outputsDir, 'audio.index.json'), audioResults);
saveJSON(path.join(ttsContext.metricsDir, 'tts-metrics.json'), buildTtsMetrics(audioResults, voiceResolution));
saveJSON(ttsContext.manifestPath, { status: 'completed', synthesizedCount: audioResults.length });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/ttsAgent.artifacts.test.js tests/ttsAgent.voicePreset.test.js tests/ttsAgent.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/consistencyChecker.js src/agents/ttsAgent.js src/agents/director.js tests/ttsAgent.artifacts.test.js tests/ttsAgent.voicePreset.test.js tests/ttsAgent.test.js
git commit -m "feat: persist consistency and tts artifacts"
```

## Task 7: Add Video Composer Artifacts and FFmpeg Evidence

**Files:**
- Modify: `src/agents/videoComposer.js`
- Modify: `src/agents/director.js`
- Test: `tests/videoComposer.artifacts.test.js`
- Test: `tests/videoComposer.test.js`

- [ ] **Step 1: Write the failing composer artifact test**

```js
test('video composer writes compose plan metrics and ffmpeg stderr on failure', async () => {
  const artifactContext = createRunArtifactContext(/* ... */).agents.videoComposer;

  await assert.rejects(
    () => composeVideo(shots, imageResults, audioResults, outputPath, { artifactContext, ffmpegFactory: failingFactory }),
    /FFmpeg/
  );

  assert.ok(fs.existsSync(path.join(artifactContext.outputsDir, 'compose-plan.json')));
  assert.ok(fs.existsSync(path.join(artifactContext.errorsDir, 'ffmpeg-stderr.txt')));
  assert.ok(fs.existsSync(artifactContext.manifestPath));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/videoComposer.artifacts.test.js`  
Expected: FAIL because composer does not yet write those artifacts

- [ ] **Step 3: Implement minimal composer artifact persistence**

```js
saveJSON(path.join(artifactContext.outputsDir, 'compose-plan.json'), plan);
saveJSON(path.join(artifactContext.outputsDir, 'segment-index.json'), segmentJobs);
saveJSON(path.join(artifactContext.metricsDir, 'video-metrics.json'), buildVideoMetrics(plan, outputPath));
saveText(path.join(artifactContext.errorsDir, 'ffmpeg-command.txt'), commandText);
saveText(path.join(artifactContext.errorsDir, 'ffmpeg-stderr.txt'), stderrText);
saveJSON(artifactContext.manifestPath, { status: 'completed', composedShotCount: plan.length });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/videoComposer.artifacts.test.js tests/videoComposer.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/videoComposer.js src/agents/director.js tests/videoComposer.artifacts.test.js tests/videoComposer.test.js
git commit -m "feat: persist video composer artifacts"
```

## Task 8: Build Pipeline Acceptance and Run Summary Coverage

**Files:**
- Modify: `src/agents/director.js`
- Test: `tests/pipeline.acceptance.test.js`
- Test: `tests/director.project-run.test.js`

- [ ] **Step 1: Write the failing acceptance test**

```js
test('pipeline acceptance run produces a complete auditable run package', async () => {
  const director = createDirector({
    loadScript: () => script,
    loadEpisode: () => episode,
    buildCharacterRegistry: async () => registry,
    generateAllPrompts: async () => promptList,
    generateAllImages: async () => imageResults,
    generateAllAudio: async () => audioResults,
    composeVideo: async () => finalVideoPath,
  });

  const outputPath = await director.runEpisodePipeline({
    projectId: 'project_123',
    scriptId: 'script_001',
    episodeId: 'episode_001',
    options: { storeOptions: { baseTempDir: tempRoot }, skipConsistencyCheck: true },
  });

  assert.equal(outputPath, finalVideoPath);
  assert.ok(fs.existsSync(path.join(runDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'timeline.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'summary.md')));
  assert.ok(fs.existsSync(path.join(runDir, '04-image-generator', '1-outputs', 'images.index.json')));
  assert.ok(fs.existsSync(path.join(runDir, '07-video-composer', 'manifest.json')));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-isolation=none tests/pipeline.acceptance.test.js`  
Expected: FAIL because the complete run package is not yet materialized end-to-end

- [ ] **Step 3: Implement minimal run summary generation**

```js
writeRunSummary(artifactContext, {
  shotCount,
  characterCount,
  promptSuccessRate,
  imageSuccessRate,
  ttsSuccessRate,
  finalStatus,
  finalOutputPath,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-isolation=none tests/pipeline.acceptance.test.js tests/director.project-run.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/director.js tests/pipeline.acceptance.test.js tests/director.project-run.test.js
git commit -m "feat: add auditable pipeline acceptance coverage"
```

## Task 9: Enforce Output Boundary and Delivery Layout

**Files:**
- Modify: `src/utils/fileHelper.js`
- Modify: `src/agents/director.js`
- Modify: `src/agents/videoComposer.js`
- Test: `tests/outputLayout.test.js`

- [ ] **Step 1: Write the failing output layout test**

```js
test('final delivery lands under structured output while intermediate artifacts stay in temp', async () => {
  const delivery = buildDeliveryPaths({
    outputDir: outputRoot,
    projectId: 'project_123',
    projectName: '咖啡馆相遇',
    episodeId: 'episode_001',
    episodeNo: 1,
  });

  assert.equal(
    delivery.videoPath,
    path.join(outputRoot, '咖啡馆相遇__project_123', '第01集__episode_001', 'final-video.mp4')
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/outputLayout.test.js`  
Expected: FAIL because no structured delivery path helper exists yet

- [ ] **Step 3: Implement minimal output boundary helpers**

```js
export function buildDeliveryPaths(input) {
  const episodeDir = path.join(
    input.outputDir,
    buildProjectDirName(input.projectName, input.projectId),
    buildEpisodeDirName({ episodeNo: input.episodeNo, id: input.episodeId })
  );

  return {
    rootDir: episodeDir,
    videoPath: path.join(episodeDir, 'final-video.mp4'),
    summaryPath: path.join(episodeDir, 'delivery-summary.md'),
    posterFramePath: path.join(episodeDir, 'poster-frame.jpg'),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/outputLayout.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/fileHelper.js src/agents/director.js src/agents/videoComposer.js tests/outputLayout.test.js
git commit -m "feat: enforce auditable output delivery layout"
```

## Task 10: Update CLI and README to Surface Auditable Outputs

**Files:**
- Modify: `scripts/run.js`
- Modify: `README.md`
- Test: `tests/runCli.test.js`

- [ ] **Step 1: Write the failing CLI expectation test**

```js
test('cli reports run package path alongside final output', async () => {
  const logs = [];
  const cli = createCli({
    director: { runEpisodePipeline: async () => '/tmp/final.mp4' },
    console: { log: (line) => logs.push(line), error: () => {} },
  });

  await cli.run(['samples/test_script.txt', '--skip-consistency']);

  assert.match(logs.join('\n'), /run package/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/runCli.test.js`  
Expected: FAIL because CLI does not yet announce the run-package location

- [ ] **Step 3: Implement minimal CLI and README updates**

```js
console.log(`Run package: ${result.runDir}`);
console.log(`Final output: ${result.outputPath}`);
```

README updates should include:

- the new `temp/项目名__projectId/.../runs/...` directory structure
- per-agent artifact contract summary
- updated test commands for artifact tests and integration tests

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/runCli.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/run.js README.md tests/runCli.test.js
git commit -m "docs: document auditable workflow outputs"
```

## Task 11: Final Verification Sweep

**Files:**
- Review: `src/utils/naming.js`
- Review: `src/utils/runArtifacts.js`
- Review: `src/agents/director.js`
- Review: `src/agents/scriptParser.js`
- Review: `src/agents/characterRegistry.js`
- Review: `src/agents/promptEngineer.js`
- Review: `src/agents/imageGenerator.js`
- Review: `src/agents/consistencyChecker.js`
- Review: `src/agents/ttsAgent.js`
- Review: `src/agents/videoComposer.js`
- Review: `README.md`

- [ ] **Step 1: Run focused artifact and workflow tests**

Run:

```bash
node --test --test-isolation=none tests/runArtifacts.test.js tests/director.artifacts.test.js tests/scriptParser.artifacts.test.js tests/promptEngineer.artifacts.test.js tests/imageGenerator.artifacts.test.js tests/ttsAgent.artifacts.test.js tests/videoComposer.artifacts.test.js tests/pipeline.acceptance.test.js tests/outputLayout.test.js
```

Expected: PASS

- [ ] **Step 2: Run existing regression tests for touched workflow areas**

Run:

```bash
node --test --test-isolation=none tests/projectStore.test.js tests/scriptParser.test.js tests/director.project-run.test.js tests/ttsAgent.test.js tests/ttsAgent.voicePreset.test.js tests/videoComposer.test.js tests/runCli.test.js
```

Expected: PASS

- [ ] **Step 3: Run real provider smoke tests that now must leave evidence**

Run:

```bash
node --test tests/imageApi.integration.test.js
```

Expected: PASS when provider group/channel is healthy; if FAIL, inspect the newly-written error evidence under the run artifact directory and summarize the exact upstream failure type

- [ ] **Step 4: Manual smoke run**

Run:

```bash
node scripts/run.js samples/test_script_qwen_debug_groupfix.txt --skip-consistency
```

Expected:

- terminal prints final output path and run package path
- `temp/项目名__projectId/.../runs/<timestamp>__<runJobId>/` exists
- each agent folder contains `0-inputs/`, `1-outputs/`, `2-metrics/`, `3-errors/`
- failures, if any, are inspectable without reading terminal logs

- [ ] **Step 5: Commit**

```bash
git add src tests scripts README.md
git commit -m "feat: add auditable workflow run packages"
```
