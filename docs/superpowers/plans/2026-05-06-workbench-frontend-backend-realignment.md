# 工作台前后端重构实施计划

> **给执行型 agent 的要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行。本文使用复选框 `- [ ]` 跟踪进度。

**目标：** 把当前静态视觉稿改造成一个清新风格、可维护、可直接读取 `temp/projects/...` 真实运行产物的导演工作台。

**架构：** 保留一个非常薄的本地 HTTP 服务作为工作台入口，但把文件系统扫描、QA 归一化、视图模型拼装都下沉到 `src/workbench/`。前端不再把样式、状态、渲染、请求混在一个 HTML 文件里，而是拆成静态壳 + 模块化浏览器脚本。

**技术栈：** Node.js `http`、ES Modules、静态 HTML/CSS/JS、本地文件系统运行产物、`node:test`

---

## 文件结构

### 现有文件：保留并重构

- `scripts/workbench-server.js`
  责任：只负责本地服务启动、静态文件托管、API 路由入口。
- `views/ai-video-factory-ui-visual-draft.html`
  责任：只保留应用壳和基础容器。
- `package.json`
  责任：暴露工作台启动命令。

### 新增后端文件

- `src/workbench/dataSources/runJobRepository.js`
  责任：扫描并读取 `temp/projects/.../run-jobs`。
- `src/workbench/dataSources/qaOverviewRepository.js`
  责任：读取并归一化 `qa-overview.json`。
- `src/workbench/dataSources/runArtifactRepository.js`
  责任：读取运行包目录结构和关键产物存在性。
- `src/workbench/transformers/workbenchViewModel.js`
  责任：把 run job、QA、artifact 数据拼成 `/api/workbench` 的稳定返回结构。
- `src/workbench/http/router.js`
  责任：处理 `/api/workbench` 和后续详情接口。

### 新增前端文件

- `views/workbench/app.js`
  责任：页面启动、数据加载、刷新行为。
- `views/workbench/api.js`
  责任：封装前端请求和错误处理。
- `views/workbench/render.js`
  责任：渲染阶段列表、QA 卡片、近期运行、CTA 状态。
- `views/workbench/state.js`
  责任：保存当前页面状态与派生数据。
- `views/workbench/styles.css`
  责任：清新风格视觉系统、布局与响应式样式。

### 新增测试文件

- `tests/workbench/runJobRepository.test.js`
- `tests/workbench/qaOverviewRepository.test.js`
- `tests/workbench/workbenchViewModel.test.js`
- `tests/workbench/workbenchServer.test.js`

### 新增测试夹具

- `tests/fixtures/workbench/minimal-run-jobs/...`
  责任：提供最小可重复的联调样例，不依赖真实 `temp/` 目录。

---

### 任务 1：先锁定工作台 API 契约

**文件：**
- 新建：`tests/workbench/workbenchViewModel.test.js`
- 新建：`src/workbench/transformers/workbenchViewModel.js`

- [ ] **步骤 1：先写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkbenchViewModel } from '../../src/workbench/transformers/workbenchViewModel.js';

test('buildWorkbenchViewModel 返回稳定工作台结构', () => {
  const model = buildWorkbenchViewModel({
    runJobs: [
      {
        id: 'run_1',
        projectId: 'project_a',
        scriptId: 'script_a',
        episodeId: 'episode_a',
        scriptTitle: '测试脚本',
        episodeTitle: '第一集',
        status: 'completed',
        startedAt: '2026-05-01T10:00:00.000Z',
        finishedAt: '2026-05-01T10:03:00.000Z',
        agentTaskRuns: [],
        artifactRunDir: 'temp/projects/p_a/scripts/s_a/episodes/e_a/runs/r_a'
      }
    ],
    qaOverviewsByRunId: {
      run_1: {
        status: 'warn',
        releasable: true,
        headline: '本轮可继续交付',
        summary: '有 1 个提醒项',
        passCount: 6,
        warnCount: 1,
        blockCount: 0,
        agentSummaries: []
      }
    }
  });

  assert.equal(model.summary.runCount, 1);
  assert.equal(model.currentRun.id, 'run_1');
  assert.equal(model.currentRun.qaOverview.status, 'warn');
  assert.ok(model.currentRun.stages.preproduction);
});
```

- [ ] **步骤 2：运行测试，确认它先失败**

运行：`node --test tests/workbench/workbenchViewModel.test.js`  
预期：因为模块或导出不存在而失败

- [ ] **步骤 3：写最小实现**

```js
export function buildWorkbenchViewModel({ runJobs = [], qaOverviewsByRunId = {} }) {
  const currentRun = runJobs[0] || null;
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      projectCount: new Set(runJobs.map((item) => item.projectId)).size,
      episodeCount: new Set(runJobs.map((item) => `${item.projectId}/${item.scriptId}/${item.episodeId}`)).size,
      runCount: runJobs.length,
      passCount: currentRun ? qaOverviewsByRunId[currentRun.id]?.passCount || 0 : 0,
      blockCount: currentRun ? qaOverviewsByRunId[currentRun.id]?.blockCount || 0 : 0,
    },
    currentRun: currentRun
      ? {
          id: currentRun.id,
          qaOverview: qaOverviewsByRunId[currentRun.id] || {
            status: 'running',
            releasable: false,
            agentSummaries: [],
          },
          stages: {
            preproduction: { items: [] },
            video: { items: [] },
            delivery: { items: [] },
          },
        }
      : null,
    recentRuns: [],
  };
}
```

- [ ] **步骤 4：重新运行测试，确认通过**

运行：`node --test tests/workbench/workbenchViewModel.test.js`  
预期：PASS

- [ ] **步骤 5：提交**

```bash
git add tests/workbench/workbenchViewModel.test.js src/workbench/transformers/workbenchViewModel.js
git commit -m "test: lock workbench api contract"
```

---

### 任务 2：抽离 run-jobs 扫描仓库层

**文件：**
- 新建：`src/workbench/dataSources/runJobRepository.js`
- 新建：`tests/workbench/runJobRepository.test.js`
- 新建：`tests/fixtures/workbench/minimal-run-jobs/...`
- 修改：`scripts/workbench-server.js`

- [ ] **步骤 1：先写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { listRunJobs } from '../../src/workbench/dataSources/runJobRepository.js';

test('listRunJobs 能从夹具目录读取 run-jobs', () => {
  const fixtureRoot = path.resolve('tests/fixtures/workbench/minimal-run-jobs');
  const runJobs = listRunJobs({ tempProjectsDir: fixtureRoot });
  assert.equal(runJobs.length, 2);
  assert.equal(runJobs[0].id, 'run_fixture_recent');
});
```

- [ ] **步骤 2：补最小夹具目录**

创建：
- `tests/fixtures/workbench/minimal-run-jobs/project_x/scripts/script_x/episodes/episode_x/run-jobs/run_fixture_recent.json`
- `tests/fixtures/workbench/minimal-run-jobs/project_y/scripts/script_y/episodes/episode_y/run-jobs/run_fixture_old.json`

- [ ] **步骤 3：实现仓库层**

要求：
- 只负责遍历 `project / script / episode / run-jobs`
- 解析 JSON
- 按 `startedAt` 倒序排序

- [ ] **步骤 4：跑测试**

运行：`node --test tests/workbench/runJobRepository.test.js`  
预期：PASS

- [ ] **步骤 5：把 server 里的内联扫描逻辑替换掉**

- [ ] **步骤 6：回归测试**

运行：`node --test tests/workbench/runJobRepository.test.js tests/workbench/workbenchViewModel.test.js`  
预期：PASS

- [ ] **步骤 7：提交**

```bash
git add tests/fixtures/workbench/minimal-run-jobs tests/workbench/runJobRepository.test.js src/workbench/dataSources/runJobRepository.js scripts/workbench-server.js
git commit -m "refactor: extract run job repository"
```

---

### 任务 3：抽离并归一化 QA Overview

**文件：**
- 新建：`src/workbench/dataSources/qaOverviewRepository.js`
- 新建：`tests/workbench/qaOverviewRepository.test.js`
- 修改：`scripts/workbench-server.js`

- [ ] **步骤 1：先写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQaOverview } from '../../src/workbench/dataSources/qaOverviewRepository.js';

test('normalizeQaOverview 会去掉空白 agent 行', () => {
  const result = normalizeQaOverview({
    status: 'pass',
    agentSummaries: [
      { agentName: '', headline: '', summary: '' },
      { agentName: 'Shot QA Agent', headline: '通过', summary: 'ok', status: 'pass' }
    ]
  });

  assert.equal(result.agentSummaries.length, 1);
  assert.equal(result.agentSummaries[0].agentName, 'Shot QA Agent');
});
```

- [ ] **步骤 2：实现归一化逻辑**

要求：
- 去掉空白 `agentSummaries`
- 当原始 `passCount / warnCount / blockCount` 缺失或失真时自动重算
- 保留 `releasable / headline / summary / runDebug`

- [ ] **步骤 3：运行测试**

运行：`node --test tests/workbench/qaOverviewRepository.test.js`  
预期：PASS

- [ ] **步骤 4：改 server 走 repository**

- [ ] **步骤 5：提交**

```bash
git add tests/workbench/qaOverviewRepository.test.js src/workbench/dataSources/qaOverviewRepository.js scripts/workbench-server.js
git commit -m "refactor: normalize qa overview loading"
```

---

### 任务 4：把 server 拆成 HTTP 层和 ViewModel 层

**文件：**
- 新建：`src/workbench/http/router.js`
- 修改：`scripts/workbench-server.js`
- 新建：`tests/workbench/workbenchServer.test.js`

- [ ] **步骤 1：先写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createWorkbenchServer } from '../../src/workbench/http/router.js';

test('GET /api/workbench 返回 200 和 json', async () => {
  const server = createWorkbenchServer({
    workspaceRoot: process.cwd(),
    tempProjectsDir: 'tests/fixtures/workbench/minimal-run-jobs'
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/api/workbench`, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, text }));
    }).on('error', reject);
  });

  assert.equal(body.statusCode, 200);
  assert.equal(JSON.parse(body.text).summary.runCount, 2);
  server.close();
});
```

- [ ] **步骤 2：实现 `createWorkbenchServer`**

职责：
- 处理 `/api/workbench`
- 提供 `views/` 静态文件
- 保留路径安全校验
- 内部调用 repository + transformer

- [ ] **步骤 3：把 `scripts/workbench-server.js` 收成薄启动器**

目标形态：

```js
import { createWorkbenchServer } from '../src/workbench/http/router.js';

const server = createWorkbenchServer({ workspaceRoot: process.cwd() });
server.listen(port, () => {
  console.log(`Workbench server running at ...`);
});
```

- [ ] **步骤 4：跑 server 测试**

运行：`node --test tests/workbench/workbenchServer.test.js`  
预期：PASS

- [ ] **步骤 5：提交**

```bash
git add tests/workbench/workbenchServer.test.js src/workbench/http/router.js scripts/workbench-server.js
git commit -m "refactor: split workbench server layers"
```

---

### 任务 5：把前端从单 HTML 文件拆成模块

**文件：**
- 新建：`views/workbench/app.js`
- 新建：`views/workbench/api.js`
- 新建：`views/workbench/render.js`
- 新建：`views/workbench/state.js`
- 新建：`views/workbench/styles.css`
- 修改：`views/ai-video-factory-ui-visual-draft.html`

- [ ] **步骤 1：把 CSS 抽到 `styles.css`**

- [ ] **步骤 2：把启动逻辑抽到 `app.js`**

- [ ] **步骤 3：把请求逻辑抽到 `api.js`**

```js
export async function fetchWorkbench() {
  const response = await fetch('/api/workbench');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
```

- [ ] **步骤 4：把 DOM 渲染抽到 `render.js`**

至少拆成：
- `renderSummary`
- `renderStageColumn`
- `renderQaPanel`
- `renderRecentRuns`
- `renderErrorState`

- [ ] **步骤 5：保留一个很小的状态模块**

```js
export const workbenchState = {
  data: null,
  setData(next) {
    this.data = next;
  },
};
```

- [ ] **步骤 6：HTML 改成引用模块脚本**

```html
<script type="module" src="/views/workbench/app.js"></script>
```

- [ ] **步骤 7：手动冒烟**

运行：`npm run workbench`  
打开：`http://127.0.0.1:4178/views/ai-video-factory-ui-visual-draft.html`

预期：
- 页面正常加载
- 控制台无错误
- 刷新按钮能重新请求数据

- [ ] **步骤 8：提交**

```bash
git add views/ai-video-factory-ui-visual-draft.html views/workbench
git commit -m "refactor: modularize workbench frontend"
```

---

### 任务 6：让清新 UI 真正贴后端语义

**文件：**
- 修改：`views/ai-video-factory-ui-visual-draft.html`
- 修改：`views/workbench/render.js`
- 修改：`views/workbench/styles.css`
- 参考：`docs/agents/README.md`

- [ ] **步骤 1：统一阶段命名为真实业务阶段**

使用：
- `预生产`
- `视频链`
- `音频与交付`

- [ ] **步骤 2：把按钮文案换成真实动作**

例如：
- `查看阶段产物`
- `查看路由与结果`
- `查看交付证据`
- `查看 QA 摘要`

- [ ] **步骤 3：每张卡片展示真实 provenance**

至少展示：
- `projectId`
- `scriptTitle / episodeTitle`
- 时间
- 状态

- [ ] **步骤 4：补“当前下一步”规则**

规则：
- `blockCount > 0`：优先处理阻断项
- `warnCount > 0`：优先看提醒项
- completed 且 releasable：优先看交付
- 否则：优先刷新状态

- [ ] **步骤 5：桌面和手机人工检查**

检查尺寸：
- `1440x1000`
- `390x844`

预期：
- 无横向溢出
- 状态文字不截断
- 主 CTA 在首屏可见

- [ ] **步骤 6：提交**

```bash
git add views/ai-video-factory-ui-visual-draft.html views/workbench/render.js views/workbench/styles.css
git commit -m "feat: align workbench ui with backend concepts"
```

---

### 任务 7：补运行详情和 QA drill-down 接口

**文件：**
- 新建：`src/workbench/dataSources/runArtifactRepository.js`
- 修改：`src/workbench/http/router.js`
- 修改：`views/workbench/api.js`
- 修改：`views/workbench/render.js`
- 修改：`tests/workbench/workbenchServer.test.js`

- [ ] **步骤 1：先写失败测试**

新增接口用例：
- `GET /api/workbench/run/:runId`
- `GET /api/workbench/run/:runId/qa`

- [ ] **步骤 2：实现 artifact repository**

只读取 UI 真需要的信息：
- `qa-overview.json`
- agent 目录列表
- `1-outputs/` 和 `2-metrics/` 下的关键文件标签

不要默认读取所有大文件内容。

- [ ] **步骤 3：暴露 drill-down 接口**

- [ ] **步骤 4：前端补点击交互**

点击：
- 运行卡片 => 加载该 run 的详情
- `查看 QA 摘要` => 加载 QA 详情面板

- [ ] **步骤 5：跑测试**

运行：`node --test tests/workbench/workbenchServer.test.js`  
预期：PASS

- [ ] **步骤 6：手动冒烟**

预期：
- 点击 run 卡片不整页刷新
- 右侧或下方详情区能切换内容

- [ ] **步骤 7：提交**

```bash
git add src/workbench/dataSources/runArtifactRepository.js src/workbench/http/router.js views/workbench/api.js views/workbench/render.js tests/workbench/workbenchServer.test.js
git commit -m "feat: add workbench artifact drill-down endpoints"
```

---

### 任务 8：补工作台文档

**文件：**
- 修改：`README.md`
- 新建：`docs/superpowers/specs/2026-05-06-workbench-data-contract.md`

- [ ] **步骤 1：补启动说明**

加上：

```bash
npm run workbench
```

和地址：

```text
http://127.0.0.1:4178/views/ai-video-factory-ui-visual-draft.html
```

- [ ] **步骤 2：写清前后端契约**

记录：
- `/api/workbench`
- run 选择逻辑
- artifact drill-down 接口
- 对 `temp/projects/...` 的依赖

- [ ] **步骤 3：写明当前限制**

包括：
- 当前数据源是本地文件系统，不是远程服务
- 缺产物时应优雅降级
- 夹具测试不能覆盖所有历史 `temp` 布局

- [ ] **步骤 4：提交**

```bash
git add README.md docs/superpowers/specs/2026-05-06-workbench-data-contract.md
git commit -m "docs: document workbench integration contract"
```

---

### 任务 9：最终验证

**文件：**
- 无需新增文件，除非发现问题

- [ ] **步骤 1：跑 workbench 单测**

```bash
node --test tests/workbench/runJobRepository.test.js tests/workbench/qaOverviewRepository.test.js tests/workbench/workbenchViewModel.test.js tests/workbench/workbenchServer.test.js
```

预期：PASS

- [ ] **步骤 2：跑一组已有回归**

```bash
npm run test:director:prod
```

如果本地太重或依赖环境不足，明确记录跳过原因。

- [ ] **步骤 3：手动验证工作台**

```bash
npm run workbench
```

打开：

```text
http://127.0.0.1:4178/views/ai-video-factory-ui-visual-draft.html
```

确认：
- 能读到真实 run-jobs
- 当前 run 选择合理
- 三列阶段内容正常
- QA 面板有真实内容
- 近期运行列表正常
- 手机端无横向溢出

- [ ] **步骤 4：最终提交**

```bash
git add .
git commit -m "feat: complete workbench frontend backend realignment"
```

---

## 执行注意事项

- 不要再把业务逻辑塞回 `views/ai-video-factory-ui-visual-draft.html`。
- 测试时不要依赖真实 `temp/` 树，尽量用夹具目录。
- 这轮不要扩 scope 到鉴权、多用户、数据库持久化或框架迁移。
- 保持小步提交，每完成一组任务就留一个可回退点。
