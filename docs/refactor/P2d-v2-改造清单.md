# P2d v2 改造清单：runEpisodePipelineImpl → Mastra 多 step 编排

> 状态：待执行 ｜ 决策依据：ADR-002（Accepted，排除 CrewAI / VideoClaw，终态 = Mastra step 化）
> 前置：P2b 拆分完成（director.js 1938 行，纯函数在 `director/runtimeSupport.js`）；P2d v1 已接 Mastra 单 step（`director/workflowRuntime.js`）
> 执行铁律：**每个 Batch 独立 commit，以「全量 0 fail」为唯一闸门，可停在任意 Batch 并回退**（git 保留每批提交）。

## 1. 目标与验收

- **目标**：把 `runEpisodePipelineImpl`（单 step 内 25+ 阶段的顺序闭包编排）拆为独立 Mastra step 图，最终删除单 step 壳，`runEpisodePipeline` 对外契约（projectId/scriptId/episodeId/options → outputPath|status）不变。
- **终态 DoD**：
  - [ ] `director.js` 无 `runEpisodePipelineImpl`（编排骨架删净），只剩 `createDirector` 工厂与导出
  - [ ] workflow step 图覆盖 25+ 阶段，每个阶段 step 独立可观测（run 记录含 step 粒度）
  - [ ] resume-from-step 12 步链全量兼容（它删 state 键后调 `runEpisodePipeline` → workflow 按 state 缓存自动跳过已完成 step）
  - [ ] stopAt 三档（after_ref_sheets/after_images/before_video）在 workflow 下行为等价
  - [ ] 全量 `NODE_TEST_CONTEXT=1 QUEUE_EXECUTION_POLICY=test node scripts/run-tests.js` = 0 fail；director 聚焦 89/0
  - [ ] CHANGELOG Unreleased 记 Refactor；HANDOFF/任务书状态回写

## 2. 架构决策（执行中不许漂移）

- **D1 state-as-store（核心）**：每个 step 的输入不从 Mastra inputData 取阶段间数据，而是**从 state（state.json 内存态）读**；产物**写回 state + artifact**（saveState 保持现状）。Mastra 只做编排拓扑与 run 记录。理由：① 与 resume-from-step 语义天然兼容（删键=重跑该步）；② 49 处 saveState/30+ 键的读写边界已是现成 step 边界；③ 避免大批量 base64/图过 Mastra 内存（走文件路径）。
  - step 间唯一经 Mastra 传递的：`runId`（坑3 必须每步重发）与 `progress/lastStep`（观测用）。
- **D2 ctx 收敛**：把闭包共享量（characterRegistry/promptList/imageResults/… 约 40 个）收敛为一个 `pipelineCtx` 对象。它是**每个 step 内部**从 state 恢复的局部工作区，step 结束释放（防跨步意外共享）。壳层只保留：initDirs/jobId/artifactContext/runJobRef/saveState 底座/收尾。
- **D3 stopAt 短路**：Mastra 静态 step 图无法中途跳变。三档 stop 在对应 step 完成处置位 `ctx.stopStatus`，其后每个 step 开头 `if (ctx.stopStatus) return { runId, stopStatus, skipped: true }`（等价 nowrap，跳过后续）。最终 workflow output 的 status 取 stopStatus 或 completed。
- **D4 失败收尾留壳**：`runEpisodePipelineImpl` 现 catch 段的「writeRunQaOverview(failed) + finishRunJob(failed) + rethrow」**留在壳层**（runEpisodeViaWorkflow 的 executePipeline 包裹处），不进 step 图。step throw → Mastra 记 failed → 壳层还原错误并做原收尾（坑4 已按 result.status 防御）。
- **D5 阶段步沿用现有粒度**：bridge/sequence 已参数化为 `runContinuitySubPipeline`，直接作为两个 step 的 execute 主体复用；一致性/连贯性 repair 各自成 step（它们原地回写 imageResults，经 state 读回）。

## 3. 分批清单（按数据依赖拓扑；每批含：改动内容 / DoD 判定）

### Batch 0 — ctx 化前置（行为零变化，工作量最大头，约占 60%）
- 改动：`runEpisodePipelineImpl` 内 ~40 个 `let x = state.x` 局部收敛为 `const ctx = createPipelineCtx(loadedState)`（读 state 惰性、写经 ctx.commit→saveState）；阶段代码改从 ctx 读写；recordStep/appendStepRun/logCachedStepRun 收为 ctx 方法。
- 判定：单 step workflow 全流程与 v1 行为逐字节一致（聚焦 director.project-run 38 例全过即证）。
- ⚠️ 此批不切 step，只为后续切割提供「每步输入=ctx 子集」的显式边界。

### Batch 1 — 资产 step（registry + refSheets + governance）
- 切出 step：`load_assets`（project/script/episode/empty-shots 重建）、`character_registry`、`generate_ref_sheets`（含 after_ref_sheets stop 判定）。
- 判定：全量绿；project-run 用例（empty shots 重建、character bibles、ref sheets stop）过。

### Batch 2 — prompt/image/repair step（imageResults 回写链，最敏感）
- 切出 step：`generate_prompts`（含 attachShotReferenceImagesToPrompts 改写）、`generate_images`（含磁盘恢复/增量补图 onResult 部分落盘）、`image_reference_backfill`（把角色 referenceImagePath 从 imageResults 回填）。
- 判定：全量绿；image 恢复/补图/prompt reference 注入用例过。**与 Batch 3 同批提交更稳**（consistency/continuity repair 写回 imageResults 后即被后续读，跨批切会破坏数据流）——建议 2+3 合并为一个 commit。

### Batch 3 — QA 修复 step（consistency + continuity + repair 回写）
- 切出 step：`consistency_check`（含 regenerate_inconsistent_images）、`continuity_check`（含 repair 闭包），两者均把修复后的 imageResults 经 state 写回。
- 判定：全量绿；consistency/continuity repair 用例过。

### Batch 4 — 规划 step（scene→directorPack→motion→performance→storyboard→routing→preflight→cost→humanReview）
- 切出 step：`plan_scene_director_motion`、`build_storyboard_context`、`route_video_shots`（含 preflight）、`cost_human_review`（含 after_images/before_video stop 判定——before_video 在本批尾）。
- 判定：全量绿；before_video stop 用例过。

### Batch 5 — 视频 step
- 切出 step：`generate_video_clips`（多 provider allSettled 分发）、`enhance_video`、`shot_qa`、`bridge_sub_pipeline`、`sequence_sub_pipeline`（直接复用 runContinuitySubPipeline 两实例）。
- 判定：全量绿；bridge/sequence integration 用例过。

### Batch 6 — 交付 step + 收尾
- 切出 step：`dialogue_normalize`、`generate_audio`（cache-key 判定）+ `tts_qa`、`lipsync`、`cross_video_consistency`、`av_packaging`、`compose`（含 delivery gate 断言 + normalizeComposeResult）、`post_compose_review` + humanReviewQueue 重建、`delivery_summary`（pipelineSummary + overview + finishRunJob 成功路径）。
- 收尾动作：workflow step 图最终化；删除单 step 壳与 `runEpisodePipelineImpl`；`runEpisodeViaWorkflow` 直挂 step 图；resume/stopAt 回归全量确认。

## 4. 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| 1 | imageResults 修复回写（Batch2/3）跨步依赖被切断 | 2+3 合并 commit；步间一律经 state 读回（D1），禁止隐式闭包捕获 |
| 2 | stopAt 提前退出在静态 step 图失效 | D3 短路模式；after_ref_sheets/before_video 用例作护栏 |
| 3 | 失败 QA overview 收尾丢失 | D4 壳层保留；project-run 失败用例断言 overview/finishRunJob(failed) 仍在 |
| 4 | resume-from-step 语义漂移 | 每步缓存判定与 `if(!state.X)` 一一对应；resumeFromStep.test.js 为护栏 |
| 5 | Mastra step 间 runId 丢失（坑3） | 每个 step 返回对象必含 `runId`（ctx.runId） |
| 6 | 单 step 内大批量 base64 撑爆内存 | D1 走文件路径，不经 Mastra 内存传递 |
| 7 | Batch 切割后行号漂移难定位 | 以 grep step 名/state 键为准，不依赖行号 |

## 5. 每批提交前验证（三件套）

```bash
# 1) 全量闸门（0 fail）
NODE_TEST_CONTEXT=1 QUEUE_EXECUTION_POLICY=test node scripts/run-tests.js
# 2) director 聚焦护栏
node --test tests/director.project-run.test.js tests/director.bridge.integration.test.js tests/director.sequence.integration.test.js tests/director.stopAt.test.js tests/resumeFromStep.test.js
# 3) 语法/加载
node --check src/agents/director.js && node --check src/agents/director/workflowRuntime.js
```

## 6. 完成后回写

- [ ] `P2任务书-编排单轨收敛.md` P2d 状态 → 完成（附 v2 记录）
- [ ] CHANGELOG Refactor(P2) 补 v2 条目
- [ ] HANDOFF 顶部进度更新（骨架已删、DoD 核销）
- [ ] ADR-002 状态 → Accepted，附 v2 落地结果
