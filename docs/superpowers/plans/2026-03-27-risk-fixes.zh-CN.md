# AI Video Factory Pro 风险修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 修复当前流水线里已经确认的正确性与可靠性问题，让断点续跑、Claude provider、音频合成和一致性重绘流程真正按照文档承诺工作。

**架构：** 保持当前单进程流水线和模块边界不变，重点加固 `director`、`llm/client`、`consistencyChecker`、`videoComposer` 之间的协作契约。先为高风险连接点补上聚焦型回归测试，再逐个修复实现，保证每个修复都能独立验证、独立提交。

**技术栈：** Node.js 18+、ES Modules、`node:test`、Anthropic SDK、Axios、fluent-ffmpeg、p-queue

---

## 文件结构

**需要修改的现有文件**
- `src/utils/fileHelper.js`
  职责：任务目录命名、文件工具、临时文件清理辅助函数。
- `src/agents/director.js`
  职责：断点续跑、一致性重绘编排、任务结束后的清理。
- `src/llm/client.js`
  职责：不同 provider 的文本和视觉请求组装。
- `src/agents/videoComposer.js`
  职责：FFmpeg 合成规划、音频拼接、字幕生成、平台安装提示。
- `src/agents/consistencyChecker.js`
  职责：一致性检查结果组织、待重绘镜头去重。
- `scripts/run.js`
  职责：CLI 帮助文案与真实支持能力保持一致。
- `README.md`
  职责：面向用户的行为说明与安装文档。
- `.env.example`
  职责：配置项说明，如果新增开关需要同步文档。

**需要新增的测试文件**
- `tests/fileHelper.resume.test.js`
  验证任务 ID 稳定性与断点续跑路径解析。
- `tests/llm.client.claude.test.js`
  验证 Anthropic 文本与视觉请求的 payload 组装。
- `tests/consistencyChecker.dedupe.test.js`
  验证待重绘镜头候选会被正确去重。
- `tests/videoComposer.plan.test.js`
  验证多分镜时间线下的音频合成规划与 concat 准备逻辑。
- `tests/director.regeneration.test.js`
  验证导演层使用基于队列的并行重绘流程，且输入已去重。

**必要时可新增的辅助文件**
- `src/agents/videoComposer/audioTimeline.js`
  只有当 `videoComposer.js` 变得难以测试时才拆出，用来承载纯规划逻辑，避免 FFmpeg 执行细节和时间线计算耦合在一起。

---

### Task 1：补上稳定的断点续跑语义

**文件：**
- Modify: `src/utils/fileHelper.js`
- Modify: `src/agents/director.js`
- Test: `tests/fileHelper.resume.test.js`
- Test: `tests/director.regeneration.test.js`

- [ ] **Step 1：先写一个会失败的断点续跑测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getJobPathsForScript } from '../src/utils/fileHelper.js';

test('同一个剧本路径应解析到同一个状态文件位置', () => {
  const first = getJobPathsForScript('D:/repo/samples/test_script.txt');
  const second = getJobPathsForScript('D:/repo/samples/test_script.txt');

  assert.equal(first.jobId, second.jobId);
  assert.equal(first.stateFile, second.stateFile);
});
```

- [ ] **Step 2：运行测试，确认它先失败**

运行：`node --test tests/fileHelper.resume.test.js`  
预期：FAIL，因为 `getJobPathsForScript` 还不存在，而且当前任务 ID 是基于时间戳生成的。

- [ ] **Step 3：实现稳定的任务标识**

```js
export function getStableJobId(scriptFilePath) {
  const normalized = path.resolve(scriptFilePath).toLowerCase();
  const safeBase = path.basename(normalized, path.extname(normalized)).replace(/\s+/g, '_');
  const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 10);
  return `${safeBase}_${digest}`;
}

export function getJobPathsForScript(scriptFilePath) {
  const jobId = getStableJobId(scriptFilePath);
  const dirs = initDirs(jobId);
  return {
    jobId,
    dirs,
    stateFile: path.join(dirs.root, 'state.json'),
  };
}
```

- [ ] **Step 4：让 director 改用稳定任务路径**

```js
const { jobId, dirs, stateFile } = getJobPathsForScript(scriptFilePath);
const state = loadJSON(stateFile) || {};
```

- [ ] **Step 5：重新跑测试，验证断点续跑行为**

运行：`node --test tests/fileHelper.resume.test.js`  
预期：PASS

- [ ] **Step 6：提交**

```bash
git add src/utils/fileHelper.js src/agents/director.js tests/fileHelper.resume.test.js
git commit -m "fix: make pipeline resume state deterministic"
```

---

### Task 2：修复 Anthropic Claude provider 兼容性

**文件：**
- Modify: `src/llm/client.js`
- Test: `tests/llm.client.claude.test.js`
- Modify: `scripts/run.js`
- Modify: `README.md`

- [ ] **Step 1：先写一个会失败的 Claude payload 测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClaudeMessages } from '../src/llm/client.js';

test('Claude 文本调用应正确抽离 system 消息', () => {
  const input = [
    { role: 'system', content: 'system rule' },
    { role: 'user', content: 'hello' },
  ];

  assert.deepEqual(normalizeClaudeMessages(input), {
    system: 'system rule',
    messages: [{ role: 'user', content: 'hello' }],
  });
});
```

- [ ] **Step 2：运行测试，确认它先失败**

运行：`node --test tests/llm.client.claude.test.js`  
预期：FAIL，因为 helper 还不存在，当前 Claude 调用也会传入错误的消息结构。

- [ ] **Step 3：实现 provider 专属消息归一化**

```js
export function normalizeClaudeMessages(messages) {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  return {
    system: systemParts.join('\n\n') || undefined,
    messages: messages.filter((m) => m.role !== 'system'),
  };
}
```

- [ ] **Step 4：在 `callClaude` 中使用归一化后的 payload**

```js
const { system, messages: claudeMessages } = normalizeClaudeMessages(messages);
const response = await client.messages.create({
  model,
  system,
  messages: claudeMessages,
  max_tokens,
  temperature,
});
```

- [ ] **Step 5：让 CLI 和文档与真实支持能力一致**

修改：
- `scripts/run.js`：帮助文案改成 `deepseek|qwen|claude`
- `README.md`：明确说明 Claude 配好后可作为正式 provider 使用

- [ ] **Step 6：重新跑测试，验证 Claude 兼容性**

运行：`node --test tests/llm.client.claude.test.js`  
预期：PASS

- [ ] **Step 7：提交**

```bash
git add src/llm/client.js scripts/run.js README.md tests/llm.client.claude.test.js
git commit -m "fix: support claude provider message formatting"
```

---

### Task 3：修复重绘候选重复和串行执行问题

**文件：**
- Modify: `src/agents/consistencyChecker.js`
- Modify: `src/agents/director.js`
- Modify: `src/utils/queue.js`
- Test: `tests/consistencyChecker.dedupe.test.js`
- Test: `tests/director.regeneration.test.js`

- [ ] **Step 1：先写一个会失败的去重测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRegenerationCandidates } from '../src/agents/consistencyChecker.js';

test('重复的镜头重绘请求应被合并', () => {
  const merged = mergeRegenerationCandidates([
    { shotId: 'shot_001', reason: 'A', suggestion: 'keep red coat' },
    { shotId: 'shot_001', reason: 'B', suggestion: 'same hairstyle' },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].shotId, 'shot_001');
  assert.match(merged[0].suggestion, /red coat/);
  assert.match(merged[0].suggestion, /hairstyle/);
});
```

- [ ] **Step 2：运行测试，确认它先失败**

运行：`node --test tests/consistencyChecker.dedupe.test.js`  
预期：FAIL，因为 helper 还不存在，当前逻辑会保留重复项。

- [ ] **Step 3：在 consistency checker 中加入稳定的合并 helper**

```js
export function mergeRegenerationCandidates(items) {
  const map = new Map();
  for (const item of items) {
    const current = map.get(item.shotId);
    if (!current) {
      map.set(item.shotId, { ...item });
      continue;
    }
    current.reason = `${current.reason}; ${item.reason}`;
    current.suggestion = [current.suggestion, item.suggestion].filter(Boolean).join('; ');
  }
  return [...map.values()];
}
```

- [ ] **Step 4：让 `runConsistencyCheck` 返回去重后的候选**

```js
return {
  reports,
  needsRegeneration: mergeRegenerationCandidates(needsRegeneration),
};
```

- [ ] **Step 5：再写一个会失败的并行重绘测试**

```js
test('director 应通过 imageQueue 支撑的任务并行调度重绘', async () => {
  assert.equal(regenerateImageMock.callCount, 2);
  assert.ok(queueAddMock.called);
});
```

- [ ] **Step 6：把串行 `for...of await` 改成基于队列的 `Promise.all`**

```js
await Promise.all(
  needsRegeneration.map((item) =>
    queueWithRetry(imageQueue, async () => {
      // regenerate and patch imageResults here
    }, 3, item.shotId)
  )
);
```

- [ ] **Step 7：重新跑测试，验证正确性和调度方式**

运行：
- `node --test tests/consistencyChecker.dedupe.test.js`
- `node --test tests/director.regeneration.test.js`

预期：PASS

- [ ] **Step 8：提交**

```bash
git add src/agents/consistencyChecker.js src/agents/director.js tests/consistencyChecker.dedupe.test.js tests/director.regeneration.test.js
git commit -m "fix: dedupe and parallelize regeneration tasks"
```

---

### Task 4：围绕单一时间线重建音频合成逻辑

**文件：**
- Modify: `src/agents/videoComposer.js`
- Test: `tests/videoComposer.plan.test.js`
- Modify: `README.md`

- [ ] **Step 1：先写一个会失败的音频时间线测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudioTimeline } from '../src/agents/videoComposer.js';

test('应生成可用于 concat 的音频时间线，并为无对白镜头补静音段', () => {
  const timeline = buildAudioTimeline([
    { shotId: 'shot_001', duration: 3, audioPath: 'a.mp3' },
    { shotId: 'shot_002', duration: 2, audioPath: null },
  ]);

  assert.equal(timeline.length, 2);
  assert.equal(timeline[1].type, 'silence');
  assert.equal(timeline[1].duration, 2);
});
```

- [ ] **Step 2：运行测试，确认它先失败**

运行：`node --test tests/videoComposer.plan.test.js`  
预期：FAIL，因为当前还没有音频时间线 helper，也没有真正做音频拼接。

- [ ] **Step 3：先补纯规划层的音频时间线 helper**

```js
export function buildAudioTimeline(plan) {
  return plan.map((item) => (
    item.audioPath
      ? { type: 'audio', source: item.audioPath, duration: item.duration, shotId: item.shotId }
      : { type: 'silence', duration: item.duration, shotId: item.shotId }
  ));
}
```

- [ ] **Step 4：实现临时音频 concat 准备逻辑**

```js
// 为无对白镜头生成静音段
// 把所有片段统一到同一种编码和采样率
// 写出 audio_concat.txt
// 调用 ffmpeg concat demuxer 生成最终合并音轨
```

- [ ] **Step 5：让最终 FFmpeg 合成只接入一条音轨输入**

```js
cmd = ffmpeg()
  .input(concatListPath)
  .input(mergedAudioPath)
  .outputOptions(['-map', '0:v:0', '-map', '1:a:0', '-shortest']);
```

- [ ] **Step 6：保持字幕时间轴仍然对齐视觉分镜时长**

修改 `generateSubtitleFile(plan, subtitlePath)`，确保字幕时序继续以视觉分镜时长为准，而不是直接跟随原始 TTS 文件长度。

- [ ] **Step 7：重新跑测试，验证时间线生成**

运行：`node --test tests/videoComposer.plan.test.js`  
预期：PASS

- [ ] **Step 8：提交**

```bash
git add src/agents/videoComposer.js tests/videoComposer.plan.test.js README.md
git commit -m "fix: stitch shot audio into a single aligned track"
```

---

### Task 5：补强 FFmpeg 提示与临时文件清理

**文件：**
- Modify: `src/agents/videoComposer.js`
- Modify: `src/utils/fileHelper.js`
- Modify: `src/agents/director.js`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1：先写一个会失败的清理测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { clearJobTempFiles } from '../src/utils/fileHelper.js';

test('应清理指定任务目录下的临时文件', () => {
  // 创建测试文件，调用 helper，断言文件被删除
});
```

- [ ] **Step 2：运行测试，确认它先失败**

运行：`node --test tests/fileHelper.resume.test.js`  
预期：FAIL，因为扩展测试后会用到尚未实现的清理 helper。

- [ ] **Step 3：实现按平台区分的 FFmpeg 安装提示**

```js
function getFFmpegInstallHint() {
  switch (process.platform) {
    case 'win32':
      return 'Windows: winget install Gyan.FFmpeg';
    case 'darwin':
      return 'macOS: brew install ffmpeg';
    default:
      return 'Linux: use apt/yum/pacman to install ffmpeg';
  }
}
```

- [ ] **Step 4：加入临时文件清理 helper 和配置开关**

```js
export function clearJobTempFiles(jobId) {
  fs.rmSync(path.join(TEMP_DIR, jobId), { recursive: true, force: true });
}

const shouldCleanup = process.env.CLEANUP_TEMP_FILES === 'true';
if (shouldCleanup) clearJobTempFiles(jobId);
```

- [ ] **Step 5：补充配置和文档说明**

修改：
- `.env.example`：新增 `CLEANUP_TEMP_FILES=false`
- `README.md`：补充清理行为与各平台的 FFmpeg 安装提示

- [ ] **Step 6：重新跑测试，验证清理 helper**

运行：`node --test tests/fileHelper.resume.test.js`  
预期：PASS

- [ ] **Step 7：提交**

```bash
git add src/agents/videoComposer.js src/utils/fileHelper.js src/agents/director.js .env.example README.md tests/fileHelper.resume.test.js
git commit -m "chore: add cleanup controls and platform ffmpeg guidance"
```

---

### Task 6：执行回归验证收口

**文件：**
- Test: `tests/fileHelper.resume.test.js`
- Test: `tests/llm.client.claude.test.js`
- Test: `tests/consistencyChecker.dedupe.test.js`
- Test: `tests/videoComposer.plan.test.js`
- Test: `tests/director.regeneration.test.js`
- Modify: `package.json`

- [ ] **Step 1：补一个真正可用的测试脚本**

```json
{
  "scripts": {
    "test": "node --test tests/*.test.js"
  }
}
```

- [ ] **Step 2：执行聚焦型回归测试**

运行：`npm test`  
预期：PASS，所有新增回归测试都通过。

- [ ] **Step 3：做一次 CLI 帮助文案冒烟检查**

运行：`node scripts/run.js`  
预期：usage 输出中包含 `--provider=deepseek|qwen|claude`

- [ ] **Step 4：提交**

```bash
git add package.json tests
git commit -m "test: add regression coverage for pipeline risk fixes"
```

---

## 给执行者的说明

- 除非某个已确认缺陷必须改动接口，否则不要改变当前对外流水线形态。
- 每个任务都要保持可独立 review、可独立运行。
- 优先把规划逻辑抽成纯函数 helper，这样 FFmpeg 相关行为就能在不真正起进程的情况下测试。
- 如果音频归一化需要额外临时文件，把它们放在任务级 temp 目录下，保证清理边界清晰。
- 如果仓库里已经有未提交改动，不要覆盖或回滚无关文件。
