# Fix Run Episode Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "Run Episode" flow so uploaded scripts can be executed successfully.

**Architecture:** When a script is uploaded, automatically create a minimal episode structure in the pipeline format. When "Run" is clicked, use the correct episode ID. This bridges the gap between uploaded scripts and the pipeline's episode requirement.

**Tech Stack:** Node.js (backend), TypeScript (frontend), JSON file storage

---

## Problem Summary

Currently, when a user uploads a script and clicks "Run":
1. Frontend sends `episodeId: 'default'` which doesn't exist
2. Pipeline crashes because `loadEpisode()` fails
3. Two separate script systems (uploaded vs pipeline) are not connected

## Solution

1. **Backend:** Add episode creation when uploading scripts
2. **Frontend:** Store and use the correct episode ID when running
3. **API:** Add episode ID to script upload response

---

### Task 1: Add Episode Creation to Script Upload API

**Files:**
- Modify: `src/workbench/http/router.js:361-387`

- [ ] **Step 1: Import project model functions**

Add import at top of router.js:
```javascript
import { createEpisode } from '../../domain/projectModel.js';
import { saveEpisode, loadEpisode } from '../utils/projectStore.js';
```

- [ ] **Step 2: Modify POST /api/projects/:id/scripts handler**

After creating the uploaded script entry, also create a minimal episode:

```javascript
if (method === 'POST') {
  try {
    const body = await parseBody(request);
    if (!body.title || typeof body.title !== 'string') {
      return sendJson(response, 400, { error: '剧本标题不能为空' });
    }
    if (!body.content || typeof body.content !== 'string') {
      return sendJson(response, 400, { error: '剧本内容不能为空' });
    }

    const scriptId = `script_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const episodeId = `episode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const entry = { 
      id: scriptId, 
      title: body.title.trim(), 
      createdAt: now, 
      updatedAt: now, 
      charCount: body.content.length,
      episodeId  // Add episode ID to the entry
    };

    // Ensure directories & index
    if (!safeExists(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
    const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];
    index.push(entry);
    fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');

    // Write content file
    fs.writeFileSync(path.join(scriptsDir, `${scriptId}.txt`), body.content, 'utf8');

    // Create minimal episode structure for pipeline
    const episode = createEpisode({
      id: episodeId,
      projectId: targetProjectId,
      scriptId: scriptId,
      title: body.title.trim(),
      summary: null,
      targetDurationSec: 120,
      shots: [],  // Empty shots - pipeline will parse from script content
    });
    
    // Save episode using projectStore
    const baseTempDir = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');
    saveEpisode(targetProjectId, scriptId, episode, { baseTempDir });

    return sendJson(response, 201, entry);
  } catch (err) {
    return sendJson(response, 500, { error: `Failed to upload script: ${err.message}` });
  }
}
```

- [ ] **Step 3: Test script upload creates episode**

Run: Upload a script via the UI and verify the episode directory is created.

Expected: `temp/projects/<projectId>/scripts/<scriptId>/episodes/<episodeId>/episode.json` exists.

- [ ] **Step 4: Commit changes**

```bash
git add src/workbench/http/router.js
git commit -m "feat: create episode when uploading script"
```

---

### Task 2: Update Frontend to Use Correct Episode ID

**Files:**
- Modify: `views/src/pages/ProjectDetail.tsx:155-167`

- [ ] **Step 1: Update handleRun to use episodeId from script entry**

The script entry now includes `episodeId`. Update the handler:

```typescript
const handleRun = async (entry: ScriptEntry) => {
  if (!confirm(`确认运行剧本「${entry.title}」？`)) return;
  setRunningScriptId(entry.id);
  setError(null);
  try {
    // Use episodeId from script entry, fallback to 'default'
    const episodeId = (entry as any).episodeId || 'default';
    await triggerRun(projectId, entry.id, episodeId);
    alert('运行已触发，请刷新页面查看结果');
  } catch (err) {
    setError(err instanceof Error ? err.message : '运行失败');
  } finally {
    setRunningScriptId(null);
  }
};
```

- [ ] **Step 2: Update ScriptEntry type to include episodeId**

In `views/src/lib/workbench.ts`, update the ScriptEntry type:

```typescript
export type ScriptEntry = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  charCount: number;
  episodeId?: string;  // Add episode ID
};
```

- [ ] **Step 3: Test run button uses correct episode ID**

Run: Click "Run" on a script and verify the correct episodeId is sent.

Expected: Network tab shows `episodeId: "episode_xxx"` instead of `"default"`.

- [ ] **Step 4: Commit changes**

```bash
git add views/src/pages/ProjectDetail.tsx views/src/lib/workbench.ts
git commit -m "feat: use correct episode ID when running script"
```

---

### Task 3: Handle Existing Scripts (Migration)

**Files:**
- Modify: `src/workbench/http/router.js:389-392`

- [ ] **Step 1: Add episode creation for existing scripts on GET**

When listing scripts, check if any are missing episodeId and create episodes for them:

```javascript
// GET — list scripts
const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];

// Migration: Create episodes for scripts that don't have episodeId
const baseTempDir = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');
let migrationNeeded = false;
for (const script of index) {
  if (!script.episodeId) {
    const episodeId = `episode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    script.episodeId = episodeId;
    
    // Create episode
    const episode = createEpisode({
      id: episodeId,
      projectId: targetProjectId,
      scriptId: script.id,
      title: script.title,
      summary: null,
      targetDurationSec: 120,
      shots: [],
    });
    saveEpisode(targetProjectId, script.id, episode, { baseTempDir });
    migrationNeeded = true;
  }
}

if (migrationNeeded) {
  fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');
}

return sendJson(response, 200, index);
```

- [ ] **Step 2: Test migration of existing scripts**

Run: Upload a script before this change, then after. Verify both have episodeId.

Expected: All scripts in the list have episodeId.

- [ ] **Step 3: Commit changes**

```bash
git add src/workbench/http/router.js
git commit -m "feat: migrate existing scripts to include episodeId"
```

---

### Task 4: Add Error Handling for Missing Episode

**Files:**
- Modify: `src/workbench/http/router.js:464-470`

- [ ] **Step 1: Add validation in POST /api/runs handler**

Before spawning the pipeline, verify the episode exists:

```javascript
if (method === 'POST') {
  try {
    const body = await parseBody(request);
    const { projectId, scriptId, episodeId, style } = body;

    if (!projectId || !scriptId || !episodeId) {
      return sendJson(response, 400, { error: 'projectId, scriptId, episodeId are required' });
    }

    // Verify episode exists
    const baseTempDir = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');
    const episode = loadEpisode(projectId, scriptId, episodeId, { baseTempDir });
    if (!episode) {
      return sendJson(response, 404, { error: 'Episode not found. Please re-upload the script.' });
    }

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const args = [
      'scripts/run.js',
      `--project=${projectId}`,
      `--script=${scriptId}`,
      `--episode=${episodeId}`,
    ];
    if (style) args.push(`--style=${style}`);

    const child = spawn('node', args, {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
    });
    child.unref();

    return sendJson(response, 200, {
      success: true,
      runId,
      message: 'Pipeline triggered',
    });
  } catch (err) {
    return sendJson(response, 500, { error: `Failed to trigger run: ${err.message}` });
  }
}
```

- [ ] **Step 2: Add import for loadEpisode**

Note: `loadEpisode` import was already added in Task 1.

- [ ] **Step 3: Test run with missing episode**

Run: Try to run a script that doesn't have an episode.

Expected: Returns 404 with helpful error message.

- [ ] **Step 4: Commit changes**

```bash
git add src/workbench/http/router.js
git commit -m "feat: validate episode exists before running pipeline"
```

---

### Task 5: Update Frontend to Handle Episode Not Found

**Files:**
- Modify: `views/src/pages/ProjectDetail.tsx:155-167`

- [ ] **Step 1: Improve error handling in handleRun**

```typescript
const handleRun = async (entry: ScriptEntry) => {
  if (!confirm(`确认运行剧本「${entry.title}」？`)) return;
  setRunningScriptId(entry.id);
  setError(null);
  try {
    const episodeId = (entry as any).episodeId || 'default';
    const result = await triggerRun(projectId, entry.id, episodeId);
    if (result.success) {
      alert('运行已触发，请刷新页面查看结果');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '运行失败';
    if (message.includes('Episode not found')) {
      setError('剧本对应的分集不存在，请重新上传剧本');
    } else {
      setError(message);
    }
  } finally {
    setRunningScriptId(null);
  }
};
```

- [ ] **Step 2: Test error message display**

Run: Try to run a script with missing episode.

Expected: Error message shows "剧本对应的分集不存在，请重新上传剧本".

- [ ] **Step 3: Commit changes**

```bash
git add views/src/pages/ProjectDetail.tsx
git commit -m "feat: improve error handling for missing episode"
```

---

## Verification

After completing all tasks:

1. **Upload a new script** → Verify episode is created
2. **Click Run** → Verify correct episodeId is used
3. **Pipeline starts** → Verify no "找不到分集" error
4. **Existing scripts** → Verify they get episodeId on next load
5. **Missing episode** → Verify helpful error message

## Notes

- The episode created is minimal (empty shots array). The pipeline will parse the script content and populate shots during execution.
- This is a minimal fix. Future improvements could include:
  - Real-time progress updates via WebSocket
  - Script parsing to pre-populate shots
  - Episode management UI
