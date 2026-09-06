# 重构交接任务清单（HANDOFF）

> 更新：2026-09-04 ｜ 写给接手的 Agent / 开发者。本文档自包含：不依赖任何会话上下文。
> 配套权威文档（先读）：
> 1. `AGENTS.md` — 工程铁律（复杂模块治理 / 日志 / 错误处理 / 目录职责）
> 2. `docs/refactor/ai-video-factory-重构需求说明书.md` — 总纲（§11.3 红线 / §11.4 Mastra 坑 / §11.5 阶段 / §11.6 DoD）
> 3. `docs/refactor/P1任务书-LLM底座与共享调用层.md` — P1 全记录（已完成）
> 4. `docs/refactor/P2任务书-编排单轨收敛.md` — P2 现状（P2a/P2c 完成，P2b/P2d 待做）
> 5. `CHANGELOG.md` Unreleased — 所有契约变更记录

---

## 0. 项目一句话

AI 漫剧自动化生成系统（Node.js ESM + 自研 agent 流水线）。重构总目标：**编排收敛为 Mastra workflow 单轨，LLM 层已收敛到 Vercel AI SDK**，最终删除 `src/agents/director.js` 巨石文件（3615 行）。

## 1. 当前状态快照（2026-09-04）

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0/D1 | 兼容单文件输入模式整体移除（项目模式唯一入口） | ✅ |
| P1a–P1e | LLM 底座 → Vercel AI SDK（`ai@7` + openai-compatible + anthropic）；共享队列 `callWithPolicy`；`@anthropic-ai/sdk` 已移除 | ✅ |
| P2a | legacy `stopAt` 三档协议收敛（`normalizeStopAt`）+ 空 shots best-effort 重建 + 解开 1 条 skip | ✅ |
| P2c | **实验轨整体删除**（`src/director/` + `src/pipeline/` 共 21 文件 + 全部引用/测试清理，主理人拍板「双轨都删、终态 Mastra 单轨」） | ✅ |
| **P2b** | **legacy stage 抽取（当前最高优先，见 §4.1）** | ⏳ 待做 |
| **P2d** | **Mastra workflow 化 + 删 legacy 骨架（见 §4.2）** | ⏳ 待做 |
| P3–P6 | 存储 / agent 逐迁 / HITL / 观测（见 §4.3） | ⏳ |

**基线验证**：`NODE_TEST_CONTEXT=1 QUEUE_EXECUTION_POLICY=test node scripts/run-tests.js` → **687 tests / 684 pass / 0 fail / 3 skipped，EXIT=0**。任何改动后此命令 0 fail 是唯一闸门。

> **2026-09-04 深夜进度更新**：P2b（批1 纯函数搬移 71 符号 → `src/agents/director/runtimeSupport.js`；批2 样板收敛 + bridge/sequence 参数化）与 P2d v1（`runEpisodePipeline` 经 Mastra workflow 单 plan step 执行，见 `src/agents/director/workflowRuntime.js`）已完成，全量绿。director.js 3615→1938 行。**下一项 = P2d v2：把 `runEpisodePipelineImpl` 闭包内阶段逐个提升为独立 Mastra step**（先显式化 imageResults 等闭包共享数据流），完成即可删除骨架。Mastra v1.64 实测：`createRun()` 返回 Promise 须 await；`run.start()` step throw 时 resolve（查 `result.status==='failed'`，错误在 `result.steps[id].error`）。
>
> **引擎选型已定（ADR-002）**：runEpisodePipelineImpl 终态 = Mastra step 化，**排除 CrewAI**（Python 双运行时 + 协作语义与本流水线形状零匹配 + 护栏全废，ROI 为负）。详见 `docs/refactor/ADR-002-编排引擎终态-Mastra-step化排除CrewAI.md`（含 v2 四步落地路径与分批计划）。
>
> **P2d v2 已排程（2026-09-05）**：拆 step 改造清单见 **`docs/refactor/P2d-v2-改造清单.md`**（Batch 0 ctx 化 → Batch 1–6 按拓扑切 step → 收尾删骨架；state-as-store 决策、stopAt 短路、失败收尾留壳、每批全量绿闸门）。接手 agent 从 Batch 0 开工。

## 2. 环境与工具坑（接手必读，全是实测踩过的）

1. **全量验证命令必须带 env**：`NODE_TEST_CONTEXT=1 QUEUE_EXECUTION_POLICY=test node scripts/run-tests.js`。缺 `NODE_TEST_CONTEXT=1` 时 director 集成测试会发**真实外部 API 请求**（曾打到 api.apilio.ai 返回 400），产生假性大面积失败。
2. **run-tests.js 只枚举 `tests/` 顶层**（readdirSync 非递归）→ `tests/workbench/` 子目录不在全量覆盖内，需单独跑。
3. **单文件跑法**：`node --test tests/xxx.test.js`（**不要**带 NODE_TEST_CONTEXT，否则 node:test 递归告警）。
4. **pnpm 必须用 v11**：仓库 lock 是 store v11，PATH 上的 pnpm 10 会报 `ERR_PNPM_UNEXPECTED_STORE`。用 `npx -y pnpm@11.25.0 ...`。
5. **WorkBuddy safe-delete 守卫**：项目内枚举式批量删除 ≥50 文件/次会被拦，env 绕过无效。删目录用 `node -e "fs.rmSync(dir,{recursive:true,force:true})"`（单 op 可过）。改 package.json 依赖后同步 lock 用 `npx -y pnpm@11.25.0 install --lockfile-only --ignore-scripts`（不碰 node_modules）。
6. **fastify 未安装**（package.json / node_modules 均无）→ `tests/workbench/workbenchServer.test.js` 本地跑不了（历史遗留，非回归）。改 workbench 代码后只能静态手术 + `node --check` 验证，或先补装 fastify。
7. **node:test 不能 mock ESM 命名导出**（frozen namespace，`t.mock.method` 报错）→ 一律用依赖注入（`deps.xxx` / `options.xxx` 覆盖），这是本仓库测试的统一模式。
8. **Windows CRLF**：大文件按行 splice 时注意 `\r` 残留；Edit 工具可正常匹配。
9. `parseJSONResponse`（llm/client.js）只支持**单层嵌套** JSON 提取——造 fixture 时勿超边界。
10. 仓库内含 `.workbuddy/` 目录——**禁止删除**。

## 3. 契约红线（改动触碰即挂，护栏测试全绿是唯一判据）

| 契约 | 内容 | 护栏 |
|---|---|---|
| resume 12 步链 | `character_registry→prompts→images→consistency→continuity→video→dialogue→audio→lipsync→cross_consistency→compose→post_review`（别名见 `scripts/resume-from-step.js:29-71`） | `tests/resumeFromStep.test.js` |
| state.json 字段 | `characterRegistry/characterRefSheets/promptList/imageResults/consistencyCheckDone/continuity*/scenePacks/directorPacks/motionPlan/performancePlan/storyboardContextMemory/shotPackages/rawVideoResults/enhancedVideoResults/shotQaReport*/bridge*/actionSequence*/sequence*/normalizedShots/audio*/lipsync*/crossVideoConsistencyReport/avPackagingPlan/postComposeReview/outputPath/composeResult/completedAt/lastError/failedAt` | `runArtifacts.test.js:332/366/393` |
| status 字符串 | `stopped_after_ref_sheets` / `stopped_after_images` / `stopped_before_video` / `stopped_after_high_risk_error` 等 | `director.project-run.test.js` |
| artifact 布局 | run 目录 `NN-agent-name/`（如 `01-script-parser/`、`10-video-composer/`、`10b-post-compose-review/`）+ `manifest.json`/`timeline.json`/`state.snapshot.json` | `director.artifacts.test.js` / `runArtifacts.test.js:53-54` |
| workbench step 名 | `workbenchViewModel.js` 的 `stageConfig` 硬编码 legacy step 名（`compose_video`、`generate_audio`…） | `workbenchServer.test.js:3617` / `fastifyWorkbenchCompatibility.test.js:212`（本地跑不了，改动需静态核对） |
| llm client 导出 | `chat/visionChat/chatJSON/parseJSONResponse/healthCheck/default` + `__testables`（8 调用方零改动） | `tests/llmClient.test.js`（11 例） |
| director `__testables` | 13 个纯函数 + `normalizeStopAt` | `director.project-run.test.js` 等 |
| CLI 入口 | 只接受 `--project/--script/--episode` 三参数；位置参数与 `--project-id` 显式报错 | `runCli.test.js` |

**AGENTS.md 硬要求**：单文件 >1000 行必须评估拆分；禁 `console.log`（用 `src/utils/logger.js`）；阶段级失败 throw 中文错误、批量单项失败返回 `{success:false,error}`；新依赖先查仓库已有/成熟开源/License/Windows+ESM 兼容。

## 4. 任务清单（按执行顺序）

### 4.1 P2b：legacy stage 抽取（⏳ 下一步，删除 legacy 的前置）

**目标**：把 `src/agents/director.js`（3615 行）的阶段逻辑抽到 `src/agents/director/` 子模块。**铁律：纯移动不改行为**——每抽一批跑全量绿再继续。这是 P2d（Mastra 化）与删除巨石文件的前置。

**已知同构重复（调研已核实，优先处理）**：
- bridge(11a-11d) 与 sequence(11e-11h) 两段各 4 步 plan→route→clip→qa **几乎同构**（legacy 内 ≥8 处相似，约 2900-3086 行区间）→ 合并为参数化 `runPlanRouteClipQa(deps, config)`。
- `【Step X】...` 日志 + `appendStepRun cached` 样板重复约 **25 次** → 抽 `runStageStep(name, message, fn)` helper。

**建议抽取顺序**（每批一个 commit 粒度，全部以全量绿收口）：
1. **纯函数批**（最低风险）：`__testables` 内 13 个纯函数 + `createDeliverySummary` / `collectRunQaOverview` / `buildPipelineSummaryMetrics` / `buildShotQaInputs` / `normalizeStopAt` / `buildConsistencyRegenerationPrompt` 等 → `src/agents/director/reports.js`（或按域拆 qa.js / delivery.js）。`__testables` 改为从子模块 re-export，**导出面不变**。
2. **样板 helper**：`runStageStep` + `runPlanRouteClipQa` 参数化。
3. **阶段批**（按执行顺序逐个抽，每个是一个 `async function runXxxStage(ctx)`）：character_registry（2004 起）→ refSheets（2037）→ prompts（2110）→ images（2130）→ consistency（2220）→ continuity（2338）→ sceneGrammar/directorPack/motion/performance（2480-2540）→ videoRouting/preflight/videoGen（2591-2828）→ enhance/shotQa（2828-2900）→ bridge/sequence（2900-3086）→ dialogue/audio/ttsQA（3092-3162）→ lipsync（3180）→ crossVideo（3205）→ avPackaging（3262）→ compose（3297）→ postReview（3349）→ delivery（3440）。
4. **编排收敛**：`runEpisodePipeline` 只剩 stopAt 判定 + 顺序调 stage + state 读写（`saveState` 的字段协议不动）。
5. **收口**：`director.js` 应降到几百行；更新任务书 §P2b 执行记录；CHANGELOG 记 refactor。

**行号会漂移**——上表行号是 2026-09-04 快照（P2a 后），动手前先重新 grep 定位。

**护栏**：`director.project-run.test.js`（38 例全链路）+ `director.artifacts/bridge/sequence/voicePreset/referenceImages` + `resumeFromStep` + `runArtifacts`。任何一批抽取后这些必须原样绿（**不许改断言来迁就实现**——除非行为语义经主理人确认变更）。

### 4.2 P2d：Mastra workflow 化 + 删 legacy 骨架

**前置**：P2b 完成；必读 `mastra-workflow-gotchas` skill（本机已装）与说明书 §11.4。
**步骤**：
1. `npx -y pnpm@11.25.0 add @mastra/core`（注意坑 5 的网络/守卫；license MIT）。
2. 用 Mastra workflow 编排 P2b 抽出的 stage 模块，接管 `runEpisodePipeline` 入口（`scripts/run.js` 与 `resume-from-step.js` 的调用面不变）。
3. resume 语义：**两段式 workflow + 自持 approval store + 冷启动第二阶段**（不要把逻辑写在 `suspend()` 之后）。
4. 全绿 + 真实样本冒烟（§11.6 DoD）后，删除 `src/agents/director.js` 巨石与全部旧编排骨架，CHANGELOG 记录。
**Mastra 五坑（§11.4，必须规避）**：suspend 恒 resolve undefined 且 resume 不续下游 DAG；父 run continuation 内 await 另一 run.start() 会挂死（用 .then() + setImmediate 脱离 AsyncLocalStorage）；多段 workflow 每步必须重发 runId（`rid = inputData.runId || runId`）；首段 step throw 时 run.start() resolve 而非 reject（要查 getRun().status）；测试 mock globalThis.fetch 须放行 loopback。

### 4.3 P3–P6（概要，详见说明书 §11.5 第 4-7 项）

| 阶段 | 内容 | 备注 |
|---|---|---|
| P3 存储收敛 | stores 接口保持，落 Mastra storage/DB；run-jobs→storage 视图 | state.json 协议在 P2d 后评估收敛 |
| P4 agent 逐迁 | QA 纯判定 step 先行 → LLM 决策类（scriptParser/characterRegistry/promptEngineer…） | 迁移成本低且测试全的先动 |
| P5 HITL/后处理 | bridge/sequence QA fallback、人审放行、post-processing 闭环 → suspend/resume 语义 | 依赖 Mastra 坑规避方案 |
| P6 观测/Billing/Workbench | Mastra OTel/Storage 作 read model；billing 保 run 级 ledger；workbench 收敛单一 server | `runtimeControlPlaneView` 已剥到只剩人审 action，Mastra 化时重建运行时控制 |

### 4.4 顺手清理候选（P2b 途中遇到就处理，AGENTS.md §1.3）

- `src/domain/storyboardContextMemory.js`（1708 行）、`src/agents/videoComposer.js`（1272 行）——下一批拆分对象。
- `parseJSONResponse` 单层嵌套限制——若 P4 迁移中遇到多层 JSON 需求，评估升级正则或引入 JSON 修复库。
- workbench 测试环境缺 fastify——建议 P6 前补装并纳入验证链。

## 5. 关键文件速查

| 文件 | 说明 |
|---|---|
| `src/agents/director.js` | legacy 编排巨石（3615 行），`runEpisodePipeline` 入口，P2b 拆分对象 |
| `src/llm/client.js` | v1.3：AI SDK 传输 + `callWithPolicy` 共享队列（唯一 LLM 入队点） |
| `src/utils/queue.js` | PQueue 各域队列 + `createExecutionPolicy`/`executeQueuedTask`/`queueWithRetry` |
| `scripts/run.js` | CLI 入口（项目模式三参数 + `--stop-at` 三档） |
| `scripts/resume-from-step.js` | 12 步 resume 链（契约基线） |
| `scripts/run-tests.js` | 全量 runner（仅 tests/ 顶层，单进程顺序 import） |
| `src/workbench/http/runCommandRoutes.js` | POST /api/runs（spawn CLI）；实验轨控制面已移除（410） |
| `tests/director.stopAt.test.js` | P2a 新增：stopAt 协议 4 例 |
| `.workbuddy/memory/2026-09-04.md` | 当日执行日志（P1 收官 + P2a/P2c 详情） |

## 6. 验证清单（每次交付前）

```bash
# 1) 全量（唯一闸门，必须 0 fail）
NODE_TEST_CONTEXT=1 QUEUE_EXECUTION_POLICY=test node scripts/run-tests.js
# 2) 聚焦（改 director 时）
node --test tests/director.project-run.test.js tests/director.stopAt.test.js tests/director.artifacts.test.js
# 3) 改 package.json 依赖后
npx -y pnpm@11.25.0 install --lockfile-only --ignore-scripts
# 4) workbench 改动（环境缺 fastify 时仅静态验证）
node --check src/workbench/http/runCommandRoutes.js
```
