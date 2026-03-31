# Project Voice Cast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为项目增加项目级声音库与分集角色选声能力，使 `EpisodeCharacter` 通过 `voicePresetId` 选择项目内 `VoicePreset`，并在 TTS 阶段解析为最终讯飞参数。

**Architecture:** 引入新的 `VoicePreset` 项目级 DTO 和本地 store，把“角色该用哪个声音”的决策放在 `EpisodeCharacter -> voicePresetId`。`ttsAgent` 负责运行时解析，`ttsApi` 继续只吃最终 `voice/rate/pitch/volume`，`.env` 仅保留默认兜底。

**Tech Stack:** Node.js 18+, ES Modules, JSON 文件存储, node:test, 讯飞在线语音合成 WebSocket API

---

## File Structure

**Existing files to modify**
- `src/domain/characterModel.js`
  Responsibility: 为 `EpisodeCharacter` 增加 `voicePresetId` 默认字段。
- `src/agents/ttsAgent.js`
  Responsibility: 解析 speaker 的 `voicePresetId` 并加载项目 `VoicePreset`。
- `src/agents/director.js`
  Responsibility: 在分集运行时加载项目 voice preset，并传给 TTS 阶段。
- `src/utils/projectStore.js`
  Responsibility: 补充项目级 `VoicePreset` 的读写接口。
- `src/utils/fileHelper.js`
  Responsibility: 补充 `voice-presets/` 目录和文件路径辅助函数。
- `README.md`
  Responsibility: 记录 `VoicePreset` 和 `EpisodeCharacter.voicePresetId` 的使用方式。
- `.env.example`
  Responsibility: 明确 `.env` 中 TTS 相关变量只作为默认兜底。

**New files to create**
- `src/domain/voicePresetModel.js`
  Responsibility: 定义 `VoicePreset` DTO 工厂。
- `src/utils/voicePresetStore.js`
  Responsibility: 读写项目级 `VoicePreset` JSON。
- `tests/voicePresetModel.test.js`
  Responsibility: 验证 `VoicePreset` DTO 的默认值与字段约束。
- `tests/voicePresetStore.test.js`
  Responsibility: 验证项目级声音库的落盘和读取。
- `tests/ttsAgent.voicePreset.test.js`
  Responsibility: 验证 `ttsAgent` 通过 `voicePresetId` 解析角色声音。
- `samples/voice-presets.example/voice-presets/heroine.json`
  Responsibility: 提供一个最小 `VoicePreset` 样例。

---

### Task 1: Add VoicePreset DTO

**Files:**
- Create: `src/domain/voicePresetModel.js`
- Test: `tests/voicePresetModel.test.js`

- [ ] **Step 1: Write the failing VoicePreset DTO tests**

```js
test('createVoicePreset returns a project-scoped preset with defaults', () => {
  const preset = createVoicePreset({
    projectId: 'project_1',
    name: '沈清-主声线',
    voice: 'xiaoyan',
  });

  assert.equal(preset.projectId, 'project_1');
  assert.equal(preset.provider, 'xfyun');
  assert.equal(preset.status, 'draft');
});

test('createVoicePreset preserves optional tuning fields', () => {
  const preset = createVoicePreset({
    projectId: 'project_1',
    name: '旁白',
    voice: 'x_xiaomei',
    rate: 42,
    pitch: 55,
    volume: 60,
    tags: ['narrator'],
  });

  assert.equal(preset.rate, 42);
  assert.deepEqual(preset.tags, ['narrator']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/voicePresetModel.test.js`
Expected: FAIL because `src/domain/voicePresetModel.js` does not exist

- [ ] **Step 3: Implement minimal VoicePreset DTO factory**

实现：
- `createVoicePreset`

要求：
- 自动填充 `id/status/createdAt/updatedAt`
- 默认 `provider='xfyun'`
- 默认 `tags=[]`
- 默认 `sampleAudioPath=null`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/voicePresetModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/voicePresetModel.js tests/voicePresetModel.test.js
git commit -m "feat: add project voice preset dto model"
```

### Task 2: Extend EpisodeCharacter With voicePresetId

**Files:**
- Modify: `src/domain/characterModel.js`
- Test: `tests/characterModel.test.js`

- [ ] **Step 1: Add the failing EpisodeCharacter voice preset test**

```js
test('EpisodeCharacter defaults voicePresetId to null', () => {
  const character = createEpisodeCharacter({
    projectId: 'p1',
    episodeId: 'e1',
    name: '沈清',
  });

  assert.equal(character.voicePresetId, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/characterModel.test.js`
Expected: FAIL because `voicePresetId` is not yet set by default

- [ ] **Step 3: Implement minimal EpisodeCharacter extension**

在 `createEpisodeCharacter` 中新增：
- `voicePresetId: null`

不要在此阶段引入更多 voice 参数字段，保持角色实例只引用 preset。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/characterModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/characterModel.js tests/characterModel.test.js
git commit -m "feat: add voice preset reference to episode characters"
```

### Task 3: Add Project VoicePreset Store

**Files:**
- Modify: `src/utils/fileHelper.js`
- Modify: `src/utils/projectStore.js`
- Create: `src/utils/voicePresetStore.js`
- Test: `tests/voicePresetStore.test.js`

- [ ] **Step 1: Write the failing voice preset storage tests**

```js
test('saveVoicePreset stores project voice presets under voice-presets', () => {
  // 保存 preset 并断言路径在 temp/projects/<projectId>/voice-presets/<id>.json
});

test('loadVoicePreset returns null for missing preset', () => {
  // 读取不存在的 preset 返回 null
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/voicePresetStore.test.js`
Expected: FAIL because voice preset store helpers do not exist

- [ ] **Step 3: Implement minimal file/path helpers**

在 `src/utils/fileHelper.js` 中新增：
- `getVoicePresetsDir(projectId, baseTempDir?)`
- `getVoicePresetFilePath(projectId, voicePresetId, baseTempDir?)`

在 `src/utils/voicePresetStore.js` 中实现：
- `saveVoicePreset(projectId, preset, options?)`
- `loadVoicePreset(projectId, voicePresetId, options?)`

在 `src/utils/projectStore.js` 中决定是否只 re-export 这些能力；若现有模式不适合 re-export，则保持独立 store 文件。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/voicePresetStore.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/fileHelper.js src/utils/voicePresetStore.js src/utils/projectStore.js tests/voicePresetStore.test.js
git commit -m "feat: add project voice preset store"
```

### Task 4: Teach TTS Agent to Resolve voicePresetId

**Files:**
- Modify: `src/agents/ttsAgent.js`
- Test: `tests/ttsAgent.voicePreset.test.js`

- [ ] **Step 1: Write the failing TTS voice preset tests**

```js
test('tts agent resolves speaker voice from episodeCharacter.voicePresetId', async () => {
  // mock textToSpeech, voicePreset lookup and speaker relation
  // assert voice/rate/pitch/volume are forwarded
});

test('tts agent falls back to gender defaults when voicePresetId is missing', async () => {
  // assert existing gender fallback still works
});

test('tts agent falls back to gender defaults when voicePresetId cannot be loaded', async () => {
  // preset missing should not fail the whole shot
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ttsAgent.voicePreset.test.js`
Expected: FAIL because `generateAllAudio` does not yet accept project voice presets

- [ ] **Step 3: Implement minimal runtime resolution**

调整 `generateAllAudio` 签名，例如：

```js
generateAllAudio(shots, characterRegistry, audioDir, options = {})
```

并支持：
- `options.voicePresetLoader`
- `options.projectId`

运行时逻辑：
1. 解析当前 speaker
2. 找到其 `EpisodeCharacter`
3. 读取 `voicePresetId`
4. 若成功加载 `VoicePreset`，将 `voice/rate/pitch/volume` 传给 `textToSpeech`
5. 否则回退到现有 gender 默认值

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ttsAgent.voicePreset.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/ttsAgent.js tests/ttsAgent.voicePreset.test.js
git commit -m "feat: resolve role voices from project voice presets"
```

### Task 5: Wire VoicePreset Resolution Through Director

**Files:**
- Modify: `src/agents/director.js`
- Test: `tests/director.project-run.test.js`

- [ ] **Step 1: Write the failing director integration test**

```js
test('director passes project-scoped voice preset resolution into tts stage', async () => {
  // mock loadVoicePreset and assert generateAllAudio receives project-aware options
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-isolation=none tests/director.project-run.test.js`
Expected: FAIL because director does not yet pass voice preset loading context

- [ ] **Step 3: Implement minimal director wiring**

在 `createDirector` 中注入：
- `loadVoicePreset`

在调用 `generateAllAudio` 时传入：
- `projectId`
- 一个按 `projectId + voicePresetId` 解析的 loader

要求：
- 不改变旧无 preset 配置时的行为
- 不因为缺失 preset 而中断整条 pipeline

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-isolation=none tests/director.project-run.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/director.js tests/director.project-run.test.js
git commit -m "feat: wire project voice presets through director"
```

### Task 6: Add Sample VoicePreset and Documentation

**Files:**
- Create: `samples/voice-presets.example/voice-presets/heroine.json`
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Create a minimal sample VoicePreset**

```json
{
  "id": "voice_heroine_main",
  "projectId": "project-example",
  "name": "沈清-主声线",
  "provider": "xfyun",
  "voice": "xiaoyan",
  "rate": 48,
  "pitch": 52,
  "volume": 55,
  "tags": ["heroine", "calm"],
  "sampleAudioPath": null,
  "status": "ready"
}
```

- [ ] **Step 2: Update README**

补充：
- `VoicePreset` 是项目级声音资产
- `EpisodeCharacter.voicePresetId` 是角色选声入口
- `.env` 中 TTS 变量仅作为兜底

- [ ] **Step 3: Tighten .env.example wording**

将 `.env.example` 中：
- `XFYUN_TTS_VOICE_*`

说明明确为：
- “默认回退音色”
- “不用于项目级角色差异表达”

- [ ] **Step 4: Review docs and sample together**

Run:
- `Get-Content README.md`
- `Get-Content .env.example`
- `Get-Content samples/voice-presets.example/voice-presets/heroine.json`

Expected: 文档、示例、字段命名一致

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example samples/voice-presets.example/voice-presets/heroine.json
git commit -m "docs: add project voice preset usage guide"
```

### Task 7: Full Verification

**Files:**
- Review: `src/domain/voicePresetModel.js`
- Review: `src/utils/voicePresetStore.js`
- Review: `src/agents/ttsAgent.js`
- Review: `src/agents/director.js`
- Review: `README.md`

- [ ] **Step 1: Run focused tests**

Run:
- `node --test tests/voicePresetModel.test.js`
- `node --test tests/voicePresetStore.test.js`
- `node --test tests/ttsAgent.voicePreset.test.js`

Expected: PASS

- [ ] **Step 2: Run integration regression**

Run:
- `node --test --test-isolation=none tests/director.project-run.test.js tests/ttsAgent.test.js`

Expected: PASS

- [ ] **Step 3: Run repo-level stable regression**

Run:
- `pnpm test`

Expected: PASS through the current repo test entry (`node scripts/run-tests.js`)

- [ ] **Step 4: Review spec/plan alignment**

Run:
- `Get-Content docs/superpowers/specs/2026-03-31-project-voice-cast-design.md`
- `Get-Content docs/superpowers/plans/2026-03-31-project-voice-cast-implementation.md`

Expected: plan matches the approved spec without introducing unrelated scope

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-03-31-project-voice-cast-design.md docs/superpowers/plans/2026-03-31-project-voice-cast-implementation.md
git commit -m "docs: finalize project voice cast design and plan"
```
