# Changelog

## Unreleased

### Refactor（P2：编排单轨收敛）

- **P2b legacy 拆分**（纯移动不改行为）：`src/agents/director.js` 纯函数区（71 符号：state 初始化/缓存签名/图像与三视图整形/clip bridge/QA 与 delivery 汇总/run QA overview）搬至 `src/agents/director/runtimeSupport.js`；30 处缓存命中样板收敛为 `logCachedStepRun`；bridge/sequence 同构 4 步（plan→route→generate→qa）合并为参数化 `runContinuitySubPipeline`。文件从 3615 行降至 1938 行（-46%）。`__testables` 导出面不变。
- **P2d v1 Mastra 编排接入**：`runEpisodePipeline` 对外契约不变，实际执行经 `src/agents/director/workflowRuntime.js` 的 Mastra workflow（单 plan step 承载 legacy 编排；v2 再细化多 step）。内部实现改名 `runEpisodePipelineImpl`。`run.start()` 在 step 抛错时 resolve 而非 reject，调用侧已按 `result.status==='failed'` 防御并从 `steps[id].error` 还原错误。
- 新增依赖 `@mastra/core@^1.64.0`（Apache-2.0）。

### Removed（P2c：实验轨整体移除，主理人决策「双轨都删、终态 Mastra 单轨」）

- `src/director/`（Director.js / index.js / rerunPolicy.js / runtimeSelection.js）与 `src/pipeline/`（自研 Stage/Checkpoint/Pipeline 框架 + 10 个 Stage）整体删除。
- `scripts/run.js`：`--runtime=legacy|experimental` 参数与 experimental 分发分支删除，入口只走 legacy `runEpisodePipeline`（P2d 起）。
- Workbench：`experimentalRuntimeRunner` 注册与透传（`legacyServer.js` / `server.js`）删除；`runCommandRoutes.js` 的 `resume_runtime` / `rerun_stage` 控制面 action 移除，请求返回 410 Gone；`runtimeControlPlaneView` 仅保留人审 action。
- 测试：`tests/pipeline.acceptance.test.js` / `tests/pipeline.framework.test.js` 删除；`runCli.test.js` experimental 分发用例删除；`workbenchServer.test.js` 控制面用例改为 410 守护 + availableActions 否定断言。
- 保留：三档 `--stop-at` 协议已由 legacy `normalizeStopAt` 承接（`after_ref_sheets` / `after_images` / `before_video`）；人审控制面 action 不受影响。

### Refactor（P1：LLM 底座 → Vercel AI SDK）

- `src/llm/client.js` 传输层从 axios REST（openai-compat）+ `@anthropic-ai/sdk` 迁移到 Vercel AI SDK（`ai@7` + `@ai-sdk/openai-compatible` + `@ai-sdk/anthropic`）。导出契约 `chat` / `visionChat` / `chatJSON` / `parseJSONResponse` / `healthCheck` / `default` 保持不变，8 个调用方零改动。
- LLM 调用统一收口到共享队列出口 `callWithPolicy`（全仓唯一入队点，走既有 `llmQueue` 策略；test 路径 `useRealQueue=false` 直跑）；`promptEngineer.generateAllPrompts` 移除调用侧 `llmQueue.add`，消除双重入队死锁风险。
- 移除依赖 `@anthropic-ai/sdk`（代码零引用确认，`package.json` + `pnpm-lock.yaml` 同步）。
- 一致性检查测试 mock 点从 axios 传输层上移至 `visionChat` 注入：`checkCharacterConsistency`（`options.visionChat`）与 `runConsistencyCheck`（`deps.visionChat`）新增覆盖通道，默认行为不变。
- `.env.example` 补 provider 模型覆盖变量（`QWEN_MODEL` / `QWEN_VISION_MODEL` / `DEEPSEEK_MODEL` / `ANTHROPIC_MODEL` / `ANTHROPIC_VISION_MODEL`）与 `LLM_QUEUE_CONCURRENCY`。

### Removed（D1：兼容单文件输入模式整体移除）

- `scripts/run.js`：位置参数 `.txt` 直跑、`--project-id` 透传、`mode:'legacy'` 分支删除；入口只接受 `--project/--script/--episode` 项目模式三参数，位置参数与 `--project-id` 现在显式报错。
- `scripts/resume-from-step.js`：`--script-file` / `--project-id` 透传与 legacy 分支、内嵌 `buildLegacyBridgeIdentity` 删除；续跑只面向项目模式 run。
- `src/agents/director.js`：legacy 单文件桥接 `runPipeline(scriptFilePath)`、`createRunPipeline`、`buildLegacyBridgeIdentity` / `canReuseExistingParsedLegacyData` / `readLegacyInputFormatMetadata` / `sanitizeFileSegment` 及相应导出删除；`runEpisodePipeline`（项目模式默认编排）保持不变。
- `src/agents/director/helpers/legacyBridge.js`：无引用孤儿文件删除。
- 不再产生 `temp/legacy_*` 平铺产物与 `legacy_project_*` 临时项目；存量旧 run 仅保留历史可读/迁移评估能力。
- 测试：`runCli.test.js` / `resumeFromStep.test.js` 改为锁定项目模式 + 位置参数报错；`director.project-run.test.js` 移除 8 个 legacy `runPipeline` 用例；`director.voicePreset.test.js` 改为项目模式 harness（保留语音 preset / voice cast / 三视图硬阻断覆盖）；`scriptParser.artifacts.test.js` 移除 legacy 直跑用例。
- 文档：README 运行章节、`docs/user-guide.md`、`docs/runtime/temp-structure.md` 同步为项目模式唯一入口。

### Fixed

- 回退不完整拆分的坏提交 `6cd50e4`（其 5 个 `src/utils/*` 拆分文件从未落盘导致 `director.js` 不可加载）：`src/agents/director.js` 与 `tests/director.project-run.test.js` 恢复到最后可加载基线 `6cd50e4^`，D1 删除在其上落地。`6cd50e4` 的 skip/hard-block 语义修复仍保留于 git 历史，P2 编排单轨化时按测试期望重放。

### Added

- Workbench 审片工作台 React 页面：
  - `/review/:runId`
  - `PreviewReviewPage`
  - `PreviewTopbar`
  - `TimelineNavigator`
  - `PreviewPlayerPanel`
  - `FindingInspector`
  - `EditTaskDrawer`
- review 后端 API：
  - `GET /api/runs/:id/review`
  - `GET /api/runs/:id/review/clips`
  - `PUT /api/runs/:id/review/tasks/:taskId`
  - `GET /api/runs/:id/review/video`
- 后处理 fixtures：
  - `tests/fixtures/post-processing/`
- 自测与交付文档：
  - `docs/superpowers/test-reports/2026-06-19-M0-M4-自测报告.md`
  - `docs/superpowers/plans/2026-06-19-交付现状与开发排期勾选清单.md`

### Changed

- `Director` 已串入 4 个后处理步骤：
  - storyboard context
  - cross-video consistency
  - AV packaging
  - post-compose review
- `resume-from-step` 已支持：
  - `post_review`
  - `cross_consistency`
- `Editor.tsx` 已切换为真实 storyboard API，不再依赖原型接口
- Character / Scene / Voice 页面已切到真实 run 数据并支持基础编辑写回
- Workbench 前端对保存后回读逻辑做了修正：
  - 同一 run 重新打开时优先读取最新 episode detail
- 审片页对 grouped `review/clips` payload 的消费已修正
- 审片页过滤后选中 clip 的回退逻辑已修正
- `DramaDetail` 在失效 `run` 查询参数下会回退到当前实际 run

### Fixed

- `review/clips` grouped 返回结构导致前端 `.map()` 报错的问题
- 保存后重新打开同一 run 时，shot / character / scene / voice 被旧 snapshot 覆盖的问题
- 审片页过滤刷新后，当前选中 clip 可能落到隐藏项的问题

### Verified

- `node --test tests/pipeline.acceptance.test.js tests/postProcessingLoop.e2e.test.js tests/resumeFromStep.test.js`
- `NODE_OPTIONS=--experimental-strip-types node --test tests/workbench/reviewClips.frontend.test.mjs tests/workbench/workbenchProject.frontend.test.mjs tests/workbench/workbenchServer.test.js`
- `pnpm --dir views build`
