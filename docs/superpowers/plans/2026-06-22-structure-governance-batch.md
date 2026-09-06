# AI漫剧自动化生成系统 - 结构治理批次

> 更新时间：2026-06-22  
> 目标：对 `router.js / director.js / storyboardContextMemory.js` 做首轮低风险切片  
> 原则：先切职责，不改行为；先抽纯函数和路由段，不引入第二调度中心

## 1. 当前现状

- `src/workbench/http/router.js`
  - 约 `2510` 行
  - 仅导出 `createWorkbenchServer`
  - 同时承载 settings、project、storyboard、review、video、SSE、静态资源等多类职责

- `src/agents/director.js`
  - 约 `3983` 行
  - 导出 `createDirector`、`createRunPipeline`
  - `runEpisodePipeline()` 仍是唯一主编排入口，后处理、状态存储、错误落盘、legacy 兼容都在同一文件

- `src/domain/storyboardContextMemory.js`
  - 约 `1751` 行
  - 导出 `buildDirectorContextPack`、`buildStoryboardContextMemory`、`buildStoryboardContextMemoryMarkdown`
  - 文件内同时包含 normalize、signature、freshness、memory build、markdown 输出等多类纯逻辑

## 2. 本批次范围

这批次只做首轮结构治理，不做平台化重构：

- [x] 明确切分目标和顺序
- [x] 明确每个文件的第一刀应该切哪里
- [x] 明确哪些内容可以先抽，哪些内容本轮不碰
- [ ] 不在本批次强行一次拆完所有大文件

## 3. 推荐顺序

1. `router.js`
2. `storyboardContextMemory.js`
3. `director.js`

原因：

- `router.js` 路由段天然分块，最容易保持行为不变
- `storyboardContextMemory.js` 纯函数比例高，便于抽 helper
- `director.js` 是主编排器，风险最高，应该最后动

## 4. router.js 首轮切片

### 4.1 可直接抽离的段

- [ ] settings 相关 helper
  - `buildSettingsPayload()`
  - `collectSettingsUpdates()`
  - `runBatchProviderPrecheck()`

- [x] video 响应 helper
  - `sendVideoFile()`

- [x] review 相关 helper
  - `resolveTrustedAbsoluteFinalVideoPath()`
  - `findArtifactFileByName()`
  - `loadRunArtifactJson()`
  - `buildReviewClips()`
  - `syncEditTaskPackStatusFields()`
  - `syncPostComposeReviewStatusFields()`
  - `syncHumanReviewQueueStatusFields()`

- [ ] review 路由处理段
  - `/api/runs/:runId/review`
  - `/api/runs/:runId/review/clips`
  - `/api/runs/:runId/review/tasks`
  - `/api/runs/:runId/review/video`

- [ ] storyboard 路由处理段
  - `/api/projects/:projectId/scripts/:scriptId/episodes/:episodeId/storyboard`

### 4.2 推荐落点

- [ ] `src/workbench/http/settingsRoutes.js`
- [x] `src/workbench/http/settingsSupport.js`
- [x] `src/workbench/http/reviewSupport.js`
- [ ] `src/workbench/http/reviewRoutes.js`
- [ ] `src/workbench/http/storyboardRoutes.js`
- [x] `src/workbench/http/videoResponses.js`

### 4.3 保持不变的边界

- [ ] `createWorkbenchServer()` 仍保留为唯一入口
- [ ] `WORKBENCH_TOKEN` 的鉴权逻辑继续放在入口最前面
- [ ] `withRunLock()` 的行为不变

## 5. storyboardContextMemory.js 首轮切片

### 5.1 可直接抽离的段

- [ ] normalize / id / text helper
- [ ] source artifact helper
- [ ] signature / freshness helper
- [x] markdown render helper

### 5.2 推荐落点

- [ ] `src/domain/storyboardContextMemory/normalize.js`
- [ ] `src/domain/storyboardContextMemory/sourceArtifacts.js`
- [ ] `src/domain/storyboardContextMemory/signature.js`
- [x] `src/domain/storyboardContextMemory/markdown.js`
- [ ] `src/domain/storyboardContextMemory/index.js`

### 5.3 保持不变的边界

- [ ] 现有导出名不变
- [ ] memory schema 不变
- [ ] `isMemoryFresh()` 对外语义不变

## 6. director.js 首轮切片

### 6.1 可先抽 helper，不碰调度主链

- [x] legacy 兼容辅助
- [ ] cache/signature 辅助
- [ ] artifact 汇总辅助
- [ ] 后处理阶段的参数组装辅助
- [ ] human review queue 写回辅助

### 6.2 暂时不动的核心段

- [ ] `runEpisodePipeline()` 仍保持唯一 orchestrator
- [ ] 不引入第二个 pipeline coordinator
- [ ] 不重写 stop-at / resume / paid video 等控制语义

### 6.3 推荐落点

- [x] `src/agents/director/helpers/legacyBridge.js`
- [ ] `src/agents/director/helpers/cacheSignatures.js`
- [ ] `src/agents/director/helpers/postProcessingAssembly.js`
- [ ] `src/agents/director/helpers/reviewQueueAssembly.js`

## 7. 验收口径

- [ ] 每次切一刀都必须保持现有测试可复用
- [ ] 先跑受影响路径测试，再考虑扩大回归
- [ ] 不接受“结构更好看但行为边界变了”的改法

## 8. 当前结论

这一批次已经开始执行，首轮已完成一刀低风险切片：

- [x] 从 `src/workbench/http/router.js` 抽离 `sendVideoFile()`
- [x] 新增 `src/workbench/http/videoResponses.js`
- [x] 从 `src/workbench/http/router.js` 抽离 settings helper
- [x] 新增 `src/workbench/http/settingsSupport.js`
- [x] 从 `src/workbench/http/router.js` 抽离 review helper
- [x] 新增 `src/workbench/http/reviewSupport.js`
- [x] 从 `src/domain/storyboardContextMemory.js` 抽离 markdown render helper
- [x] 新增 `src/domain/storyboardContextMemory/markdown.js`
- [x] 从 `src/agents/director.js` 抽离 legacy 兼容 helper
- [x] 新增 `src/agents/director/helpers/legacyBridge.js`
- [x] 保持 `createWorkbenchServer()` 入口不变
- [x] 保持 review video 路由调用语义不变
- [x] 定向测试与前端构建验证通过
- [x] storyboardContextMemory 定向测试与 pipeline acceptance 验证通过
- [x] `director.project-run`、`runCli`、`resumeFromStep` 回归通过

下一刀仍建议从 `router.js` 继续，优先抽 review / storyboard 路由段，不先动 `director.js` 主编排。
