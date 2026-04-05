# Seedance 主视频引擎替换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏当前 `Director`、`resume-from-step`、artifact、QA 与 fallback 体系的前提下，把当前单镜头视频主引擎从 `Runway` 平滑切换到 `Seedance`。

**Architecture:** 保持 `Director` 为唯一 orchestrator，不引入新的调度中心。现有 `Video Router -> Runway Video Agent -> Shot QA -> Video Composer` 主链改造为“协议先行、provider 适配隔离、渐进切换”的模式：先抽象视频 provider 协议与 router 输出，再新增 `Seedance Video Agent`，最后把主链默认 provider 从 `Runway` 切到 `Seedance`，同时保留 `Runway` 和静图/bridge/sequence/lipsync 作为工程保护层。

**Tech Stack:** Node.js、原生 `node:test`、现有 agent 架构、FFmpeg/ffprobe、外部视频 provider API（当前实现 `Runway`，目标接入 `Seedance`）

---

## 文件结构与职责

本计划默认沿用当前目录组织，不做大范围重构。

- `src/apis/`
  - 新增或扩展视频 provider API 封装
  - 负责请求构造、任务提交、轮询、下载、错误分类
- `src/agents/`
  - `videoRouter.js`：从“Runway request builder”升级为“视频 provider 路由与请求打包层”
  - 新增 `seedanceVideoAgent.js`
  - 可能抽出 provider 无关的 `shotPackage -> provider request` 转换逻辑
- `src/utils/`
  - 如有必要，新增 provider 协议工具、错误码标准化工具、结果协议校验工具
- `src/agents/director.js`
  - 控制默认主视频引擎、缓存与 summary 记账、resume 兼容
- `src/agents/videoComposer.js`
  - 继续优先消费 `sequenceClips -> videoResults -> bridgeClips -> ...`
  - 不感知底层是 `Runway` 还是 `Seedance`
- `tests/`
  - provider API / agent / router / director / resume / acceptance 回归
- `README.md`
  - 对外说明“当前实现”和“目标方向”
- `.env.example`
  - 只保留当前代码实际读取的变量；对未接入但已确定方向的 `Seedance` 仅做说明，不伪造未实现变量
- `docs/agents/*.md`
  - 在接入落地时同步更新 `video-router`、`runway-video-agent`、未来的 `seedance-video-agent`、`director`、`video-composer`

## Task 1: 固定 Seedance 替换边界与协议

**Files:**
- Modify: `docs/superpowers/specs/2026-04-05-seedance-module-assessment-review.md`
- Create: `docs/superpowers/specs/2026-04-05-seedance-primary-video-engine-design.md`
- Test: 无

- [ ] **Step 1: 写一版 Seedance 主引擎替换 spec**

Spec 必须锁死：

- `Director` 仍是唯一 orchestrator
- `videoResults` 协议保持兼容，避免影响 `composer`
- `Shot QA`、`resume-from-step`、artifact 编号与缓存字段不因 provider 替换而破坏
- `Seedance` 接入优先覆盖 Phase 1 单镜头视频主路径
- `bridge`、`sequence`、`lipsync`、静图 fallback 暂不删除

- [ ] **Step 2: 明确 provider 抽象最小边界**

Spec 中明确统一字段：

- `provider`
- `providerJobId`
- `providerRequest`
- `providerMetadata`
- `failureType`
- `downloadedAssetPath`

- [ ] **Step 3: 写明切换策略**

Spec 中固定 3 段式切换：

1. 协议抽象与双 provider 共存
2. 接入 `Seedance` 但不默认切流
3. 默认主 provider 切到 `Seedance`，`Runway` 降级 fallback

- [ ] **Step 4: 提交 spec 文档**

Run:

```bash
git add docs/superpowers/specs/2026-04-05-seedance-module-assessment-review.md docs/superpowers/specs/2026-04-05-seedance-primary-video-engine-design.md
git commit -m "docs: 明确 Seedance 替换主视频引擎的设计边界"
```

## Task 2: 抽象视频 provider API 协议

**Files:**
- Create: `src/apis/videoProviderProtocol.js`
- Modify: `src/apis/runwayVideoApi.js`
- Test: `tests/videoProviderProtocol.test.js`, `tests/runwayVideoApi.test.js`

- [ ] **Step 1: 先写 provider 协议测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVideoProviderResult } from '../src/apis/videoProviderProtocol.js';

test('normalizeVideoProviderResult keeps provider metadata stable', () => {
  const result = normalizeVideoProviderResult({
    provider: 'seedance',
    jobId: 'job-1',
    assetPath: 'temp/video/shot_001.mp4',
  });

  assert.equal(result.provider, 'seedance');
  assert.equal(result.providerJobId, 'job-1');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/videoProviderProtocol.test.js
```

Expected: FAIL，提示协议工具尚不存在。

- [ ] **Step 3: 实现最小 provider 协议层**

实现最小能力：

- provider 结果标准化
- provider 错误类型标准化
- provider request 摘要序列化

- [ ] **Step 4: 回归 `Runway` API 封装**

确保 `runwayVideoApi` 输出能适配新协议，不改变现有功能。

- [ ] **Step 5: 跑协议与 Runway API 测试**

Run:

```bash
node --test tests/videoProviderProtocol.test.js tests/runwayVideoApi.test.js
```

- [ ] **Step 6: 提交**

```bash
git add src/apis/videoProviderProtocol.js src/apis/runwayVideoApi.js tests/videoProviderProtocol.test.js tests/runwayVideoApi.test.js
git commit -m "refactor: 抽象视频 provider 协议并兼容 Runway"
```

## Task 3: 改造 Video Router 为 provider 无关打包层

**Files:**
- Modify: `src/agents/videoRouter.js`
- Modify: `tests/videoRouter.test.js`
- Test: `tests/videoRouter.test.js`

- [ ] **Step 1: 先补路由测试**

补至少 3 个 case：

- 默认主 provider 为 `runway`
- 配置切换后主 provider 为 `seedance`
- 缺少可用参考图时路由到静图 fallback

- [ ] **Step 2: 跑路由测试看失败点**

Run:

```bash
node --test tests/videoRouter.test.js
```

- [ ] **Step 3: 实现 provider 无关输出**

`videoRouter` 输出改为：

- `preferredProvider`
- `fallbackProviders`
- `providerRequestHints`
- 仍保留 `shotPackage`

- [ ] **Step 4: 确保写盘结果可审计**

`09b-video-router/1-outputs` 中保留：

- 原始 `shotPackage`
- provider 路由结果
- request hints

- [ ] **Step 5: 跑测试**

Run:

```bash
node --test tests/videoRouter.test.js tests/runArtifacts.test.js
```

- [ ] **Step 6: 提交**

```bash
git add src/agents/videoRouter.js tests/videoRouter.test.js
git commit -m "refactor: 将视频路由升级为 provider 无关请求打包层"
```

## Task 4: 新增 Seedance API 与 Seedance Video Agent

**Files:**
- Create: `src/apis/seedanceVideoApi.js`
- Create: `src/agents/seedanceVideoAgent.js`
- Modify: `src/agents/director.js`
- Test: `tests/seedanceVideoApi.test.js`, `tests/seedanceVideoAgent.test.js`

- [ ] **Step 1: 根据官方 API 文档写测试桩**

覆盖最小场景：

- 提交任务成功
- 轮询超时
- 认证失败
- 限流错误
- 非法请求
- 下载到空/坏文件

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
node --test tests/seedanceVideoApi.test.js tests/seedanceVideoAgent.test.js
```

- [ ] **Step 3: 实现 `seedanceVideoApi`**

能力要求：

- API Key 鉴权
- 提交异步任务
- 查询任务状态
- 下载视频
- 标准化错误分类

- [ ] **Step 4: 实现 `seedanceVideoAgent`**

能力要求：

- 输入 `shotPackage`
- 读取参考资产
- 调用 Seedance API
- 产出兼容 `videoResults`
- 把 provider request / response / metrics / errors 写盘

- [ ] **Step 5: 把 `Director` 接成双 provider 模式**

短期先支持：

- `VIDEO_PROVIDER=runway`
- `VIDEO_PROVIDER=seedance`

默认值先不切，避免一次性扩大改动面。

- [ ] **Step 6: 跑测试**

Run:

```bash
node --test tests/seedanceVideoApi.test.js tests/seedanceVideoAgent.test.js tests/director.project-run.test.js tests/director.artifacts.test.js
```

- [ ] **Step 7: 提交**

```bash
git add src/apis/seedanceVideoApi.js src/agents/seedanceVideoAgent.js src/agents/director.js tests/seedanceVideoApi.test.js tests/seedanceVideoAgent.test.js
git commit -m "feat: 接入 Seedance 视频生成 agent 并支持双 provider 切换"
```

## Task 5: 保证 QA / Resume / Composer 不受 provider 替换破坏

**Files:**
- Modify: `src/agents/shotQaAgent.js`
- Modify: `src/agents/videoComposer.js`
- Modify: `scripts/resume-from-step.js`
- Modify: `tests/shotQaAgent.test.js`
- Modify: `tests/videoComposer.test.js`
- Modify: `tests/resumeFromStep.test.js`

- [ ] **Step 1: 先补测试**

覆盖：

- `videoResults` 来自 `seedance` 也能通过 QA
- `resume --step=compose` 不清理已生成 `seedance` 结果
- `resume --step=video` 只清视频及后续，不影响前序资产
- `composer` 不关心 provider 名称，只看 QA 通过的 `videoResults`

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
node --test tests/shotQaAgent.test.js tests/videoComposer.test.js tests/resumeFromStep.test.js
```

- [ ] **Step 3: 最小实现**

修改点：

- `Shot QA` 对 provider 无关
- `videoComposer` 不写死 `Runway`
- `resume-from-step` 清理逻辑保持 step 级，不升级成 sequence/shot 级 CLI

- [ ] **Step 4: 跑测试**

Run:

```bash
node --test tests/shotQaAgent.test.js tests/videoComposer.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js
```

- [ ] **Step 5: 提交**

```bash
git add src/agents/shotQaAgent.js src/agents/videoComposer.js scripts/resume-from-step.js tests/shotQaAgent.test.js tests/videoComposer.test.js tests/resumeFromStep.test.js
git commit -m "refactor: 保持 QA Composer Resume 与视频 provider 解耦"
```

## Task 6: 默认主 provider 切到 Seedance 并保留 Runway fallback

**Files:**
- Modify: `src/agents/director.js`
- Modify: `src/agents/videoRouter.js`
- Modify: `tests/director.project-run.test.js`
- Modify: `tests/pipeline.acceptance.test.js`

- [ ] **Step 1: 先补验收测试**

至少覆盖：

- 开启 `VIDEO_PROVIDER=seedance` 时主链优先走 Seedance
- Seedance 失败时正确记账并回退到允许的 fallback
- acceptance 能证明主视频链路来源于真实视频镜头主路径，而不是静图默认拼接

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
node --test tests/director.project-run.test.js tests/pipeline.acceptance.test.js
```

- [ ] **Step 3: 切默认值**

当代码和文档都准备好之后：

- 默认主 provider 改为 `seedance`
- `Runway` 降级为 fallback / compatibility provider

- [ ] **Step 4: 跑回归**

Run:

```bash
node --test tests/videoRouter.test.js tests/seedanceVideoApi.test.js tests/seedanceVideoAgent.test.js tests/shotQaAgent.test.js tests/videoComposer.test.js tests/resumeFromStep.test.js tests/director.project-run.test.js tests/director.artifacts.test.js tests/pipeline.acceptance.test.js tests/runArtifacts.test.js
```

- [ ] **Step 5: 提交**

```bash
git add src/agents/director.js src/agents/videoRouter.js tests/director.project-run.test.js tests/pipeline.acceptance.test.js
git commit -m "feat: 将 Seedance 切为默认主视频 provider 并保留 Runway 回退"
```

## Task 7: 更新文档与运行口径

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/agents/README.md`
- Modify: `docs/agents/video-router.md`
- Modify: `docs/agents/runway-video-agent.md`
- Create: `docs/agents/seedance-video-agent.md`
- Modify: `docs/agents/director.md`
- Modify: `docs/agents/video-composer.md`

- [ ] **Step 1: 更新根 README**

明确区分：

- 当前实现
- 目标方向
- 何时需要 `RUNWAY_API_KEY`
- 何时需要未来的 `SEEDANCE_*` 配置

- [ ] **Step 2: 更新 `.env.example`**

要求：

- 只展示当前代码实际支持的变量
- 对未来 `Seedance` 用注释说明“预期接入，不代表已启用”

- [ ] **Step 3: 更新 agent 文档**

把 provider 相关说明统一为：

- 当前单镜头视频 provider：`Runway`
- 下一阶段主引擎方向：`Seedance`
- `Video Router` 是 provider 无关打包层

- [ ] **Step 4: 文档自检**

手工核对：

- 文档不出现“已经接好 Seedance”这种误导表述
- 也不出现“Runway 是永久方案”这种过时表述

- [ ] **Step 5: 提交**

```bash
git add README.md .env.example docs/agents/README.md docs/agents/video-router.md docs/agents/runway-video-agent.md docs/agents/seedance-video-agent.md docs/agents/director.md docs/agents/video-composer.md
git commit -m "docs: 更新主视频引擎切换口径与运行说明"
```

## 最终验收命令

- [ ] **Step 1: 跑 provider 与主链协议测试**

```bash
node --test tests/videoProviderProtocol.test.js tests/videoRouter.test.js tests/runwayVideoApi.test.js tests/seedanceVideoApi.test.js tests/seedanceVideoAgent.test.js tests/shotQaAgent.test.js
```

- [ ] **Step 2: 跑 orchestration / resume / composer 回归**

```bash
node --test tests/videoComposer.test.js tests/resumeFromStep.test.js tests/director.project-run.test.js tests/director.artifacts.test.js tests/runArtifacts.test.js
```

- [ ] **Step 3: 跑 acceptance**

```bash
node --test tests/pipeline.acceptance.test.js
```

- [ ] **Step 4: 跑一次总收口命令**

```bash
node --test tests/videoProviderProtocol.test.js tests/videoRouter.test.js tests/runwayVideoApi.test.js tests/seedanceVideoApi.test.js tests/seedanceVideoAgent.test.js tests/shotQaAgent.test.js tests/videoComposer.test.js tests/resumeFromStep.test.js tests/director.project-run.test.js tests/director.artifacts.test.js tests/pipeline.acceptance.test.js tests/runArtifacts.test.js
```

- [ ] **Step 5: 收口提交**

```bash
git add .
git commit -m "feat: 完成 Seedance 主视频引擎替换一期收口"
```
