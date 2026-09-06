# AI 漫剧自动化系统（ai-video-factory-pro）重构需求说明书

> 面向执行重构的 Agent（Mastra / Vercel AI SDK / CrewAI 选型）
> 版本：v1.2　｜　日期：2026-09-04（v1.1 2026-09-03 → v1.2 落 D1）　｜　证据基线：**以 `src/` 源码为主，`docs/` 与 README 为辅**
> 阅读建议：先看本文件第 0、1 章建立全局认知；第 5、6 章是重构时的“逐模块需求来源”；第 10、11 章直接指导目标架构与任务拆分。

> **决策记录 D1（2026-09-04，主理人）**：重构后运行入口**只保留项目模式**，兼容单文件模式（位置参数 `.txt` 直跑、`--script-file`/`--project-id` 透传、txt→临时 `legacy_project_*` project/script/episode 自动桥接、`temp/legacy_<jobId>/` 平铺产物）**整体移除**。
> 注意两轴分离，勿混为一谈：
> - **输入模式轴（本决策作用对象）**：项目模式 vs 兼容单文件模式 → 删后者，只留前者。
> - **编排实现轴（与 D1 正交，由 T1/T2/P2 收敛）**：legacy `src/agents/director.js`（同时是**项目模式的默认编排**，`runEpisodePipeline`）vs experimental `src/director/Director.js`。**删除兼容输入模式不等于删除 legacy director**。
> 本文档 v1.2 已按此改写第 1、2、4、10、11 章及 `docs/refactor/README.md`；涉及“兼容单文件模式”的段落一律标注【D1 移除对象】。

---

## 0. 文档目的与使用方法

本说明书的唯一目的：让一个**不了解本项目的新 Agent** 在只读本仓库时，能回答“这个系统要什么、怎么做、边界在哪、哪些是硬约束”，并据此在不破坏既有行为的前提下，用 Mastra / Vercel AI SDK / CrewAI 完成重构。

对重构 Agent 的硬性要求：

1. **行为契约优先于代码结构**：本说明书第 3~9 章描述的输入输出、产物、失败语义、缓存/断点、QA 放行规则，重构后必须 1:1 保留（或显式变更并记录到 CHANGELOG）。
2. **不要把“旧实现存在两份”当成重构理由而擅自二选一**：第 2.5 / 4.3 / 10 章说明了新旧双轨的来源与合并建议，最终取舍需在重构计划中明示。**已由 D1 明确的不在此列**：兼容单文件输入模式（第 2.2/4.1 章【D1 移除对象】）是主理人拍板的删除项，直接删除，无需再论证。
3. 任何环境变量、CLI 参数、run 包目录命名、artifact 文件名的变更都属于**契约变更**，不得静默进行。
4. 重构完成后必须通过第 11.6 节的验收清单（沿用既有 `node --test` 测试集作为回归护栏）。

---

## 1. 产品与业务需求

### 1.1 一句话定义

输入既有 `project / script / episode` 数据（项目模式），自动编排十余个 AI Agent，生成可发布到抖音 / 视频号 / 快手 / 小红书等平台的**竖屏漫剧短视频**。

### 1.2 业务价值与成功口径

- 一套流水线覆盖：剧本结构化 → 角色资产 → 分镜出图 → 一致性/连贯性 QA → 动态镜头视频 → 口型/配音 → 最终合成。
- 可观测、可复盘：每一步都有“给人看的报告 + 给机器看的 JSON + 失败上下文”，能回答“这轮卡在哪、为什么、能不能放行”。
- 成本可控：视频/生图是付费 API，系统在付费动作前提供多级闸门（见 1.6、7、9）。
- 角色一致性可交付：跨镜头“同一角色看起来是同一人”，是本系统区别于一般文生视频 demo 的核心卖点。

### 1.3 输入与输出

| 项 | 说明 |
|---|---|
| 输入（项目模式） | 显式 `projectId + scriptId + episodeId`（`run.js --project=… --script=… --episode=…`），支持多项目/多剧集。剧本文本需先落为项目数据（`init-sample-project` / 项目创建），不再接受脚本文件直跑 |
| 【D1 移除对象】输入（兼容单文件模式） | ~~位置参数 `.txt` 直跑，CLI 自动桥接为临时 `legacy_project_*` project/script/episode~~（v1.2 起移除，见 D1） |
| 输入格式 | `professional-script`（含 `【画面N】`）/ `raw-novel` / `auto`（剧本文本进入项目时的解析口径） |
| 输出 | `output/<项目名>/第xx集__<episodeId>/` 下的最终成片 + delivery-summary |
| 中间产物 | `temp/` 下 run 包（证据仓，非临时垃圾桶） |

### 1.4 核心层级

```text
project
└── script
    └── episode
        └── shot plan（分镜）
```

### 1.5 关键业务术语表（稳定语义，重构必须沿用）

| 术语 | 语义 |
|---|---|
| run / run job / run package | 一次执行的逻辑单元 / 其持久化记录（run-jobs/*.json）/ 其产物目录（`runs/r_<ts>_<hash>/`） |
| artifact | 某个 agent 在 run 包 `NN-name/0-inputs|1-outputs|2-metrics|3-errors` 下落盘的文件 |
| step / stage | 主流程上的一个编排单位（legacy Director 口径叫 step，新 pipeline 口径叫 stage） |
| checkpoint | stage 输出 JSON 缓存（`<stage>.json`），存在即可跳过该 stage |
| snapshot / journal | `state.snapshot.json`（run 终态快照）、`runtime-journal.json`（运行记录） |
| pass / warn / block | QA 三段式判定；block=硬失败/阻断交付，warn=可放行但留证 |
| regenStrategy | `prompt_tighten`（收紧 prompt）或 `reanchor_regenerate`（带参考图回锚重生） |
| 身份绑定 | ID-first：`id / episodeCharacterId / mainCharacterTemplateId / characterBibleId` 才是绑定键；`name` 只用于展示/日志/prompt |
| provider / transport / model | 业务意图层 / 提交通道层 / 实际模型层（视频域三层语义，见 3.5） |
| shot plan | 分镜实体集合，含 prompt、图、QA、视频候选等组装结果 |

### 1.6 v1 已声明限制（`docs/limitations-v1.md`，重构非目标清单）

- 无完整浏览器 E2E 证据闭环（Dashboard→…→Review 多页面）。
- Editor 不是完整 DCC 编辑器（仅 dialogue/scene/cameraType/durationSec 有限字段编辑）。
- 单机形态：不承诺多租户、弹性伸缩、完整权限、SaaS 调度。
- 真实 API 成本与稳定性靠人为控制：先 `--max-shots`、`--stop-before-video`、video 续跑先 `--dry-run`。
- M5 上线材料（UAT、v1.0.0 tag、Demo 视频）未收口。

---

## 2. 总体架构现状（as-is）

### 2.1 分层视图（证据：`src/` 目录 + package.json）

```text
入口层    scripts/run.js · scripts/resume-from-step.js · scripts/workbench-server.js · scripts/init-sample-project.js
编排层    Director（编排实现两套并存：src/agents/director.js【legacy，项目模式默认】与 src/director/Director.js【experimental】）
          + 新 Pipeline 框架（src/pipeline：Stage/CheckpointManager/RunOrchestrator + rerunPolicy）
Agent 层  src/agents/*（30+ 业务 agent，纯决策/执行逻辑，多依赖 utils/runArtifacts 协议）
Provider  src/apis/*（视频/图像/TTS/口型/ASR 的统一合同 + router + transport + 各供应商实现）
          src/llm/*（chat/visionChat/chatJSON 客户端 + 提示词）
领域/策略 src/domain/*（实体/协议/治理规则）· src/policy/*（qualityGate/videoProviderPolicy）
存储层    src/utils/*Store.js + contracts/* + storeBindings（全部为本地文件 JSON 存储，无数据库）
状态协议  src/runtime/schemas/*（runState/decisionRecord/humanReviewRecord/runtimeJournal + normalize）
观测层    src/workbench/* + src/app/workbench/*（只读 HTTP + 少量控制面）
计费层    src/billing/*（ledger、openmeter 元数据、gateway sync、log 聚合）
```

依赖全景：`@anthropic-ai/sdk`（Claude 直连）、`axios`、`dotenv`、`fluent-ffmpeg`（合成/探针）、`p-queue`（并发）、`sharp`、`ws`。**无数据库、无队列中间件、无进程编排框架**——全部自研文件方案。

### 2.2 运行模式与编排实现（两轴分离）

**输入模式轴：仅保留项目模式（D1）。**

| 输入模式 | 入口 | 状态/缓存 | v1.2 后 |
|---|---|---|---|
| 项目模式（唯一保留） | `run.js --project=<projectId> --script=<scriptId> --episode=<episodeId>`（`runEpisodePipeline`）；断点续跑用 `resume-from-step.js --run-id=<runJobId>` | 结构化 run 包（见 2.3）+ `state.snapshot.json` / `runtime-journal.json`；checkpoint 目录 `<stage>.json` | ✅ 唯一输入面 |
| 【D1 移除对象】兼容单文件模式 | ~~`run.js samples/test_script.txt`（位置参数）走 `runPipeline(scriptFilePath)`~~；`buildLegacyBridgeIdentity` 自动桥接 `legacy_project_*`/`legacy_script_*`/`legacy_episode_*` | ~~`temp/legacy_<jobId>/` 平铺产物 + 根级 `state.json`~~ | ❌ 入口与桥接整体删除 |

**编排实现轴（与 D1 正交，由 T1/T2/P2 收敛，不因删兼容模式而删除）：** 项目模式的默认编排是 legacy `src/agents/director.js`（`runEpisodePipeline`）；`--runtime=experimental` 或 `AIVF_RUNTIME_MODE=experimental/workflow` 可切换到 `src/director/Director.js`。

`resolveRuntimeMode`（`src/director/runtimeSelection.js`）默认返回 `legacy`；runState 的默认 `workflowVersion` 却写 `experimental_director_v1`——**这是历史演进未对齐的证据**（见第 10 章债项）。

### 2.3 运行时目录规范

【D1 移除对象】兼容单文件平铺产物（存量旧 run 仅供历史回读/迁移，不再产生新例）：
```text
temp/legacy_<job-id>/{state.json, images/, audio/, video/}
```
项目模式结构化根（`.env` 的 `TEMP_DIR` 默认 `./temp`）——**v1.2 起唯一产物布局**：
```text
temp/projects/p_<hash>_<可读名>/scripts/s_<hash>_<可读名>/episodes/e<NN>_<hash>_<可读名>/runs/
  r_<时间戳>_<hash>/                    ← run package（AGENT_ARTIFACT_LAYOUT，见 src/utils/runArtifacts.js）
    manifest.json  timeline.json  qa-overview.json|md  runtime-journal.json  state.snapshot.json
    01-script-parser/…/12-human-review-queue/           ← 每个 agent 目录：
        manifest.json 0-inputs/ 1-outputs/ 2-metrics/ 3-errors/
```
另有：`temp/projects/<projectId>/` 存储 project.json / script.json / episode.json / run-jobs/ / character-bibles/ / voice-cast.json / voice-presets/ / pronunciation-lexicon.json（见 `src/utils/fileHelper.js` 路径函数）。run 包目录用**哈希+可读段**，项目 JSON 用**裸 id**——两套命名并存（债项）。

### 2.4 状态机与持久化

- **run job 生命周期**：`createRunJob({status:'running'}) → appendAgentTaskRun(...) → finishRunJob({status})`；run job 文件在 `episodeDir/run-jobs/<runJobId>.json`；带 `runKey`（`rk_sha1(id|project|script|episode|startedAt)[:12]`），可被 locator 命中。
- **stage 级状态**（新 pipeline）：`<stage>.json` = 完成态输出（存在即“已完成”），`<stage>.partial.json` = 运行中增量（`saveState()` 落盘），`<stage>.meta.json` = 执行元数据（开始/耗时/复用标记/error）。写盘统一 `tmp + rename` 原子化。
- **run 终态协议**：`writeRuntimeJournal()` 同时产出 `runtime-journal.json`、`timeline.json`（追加 `runtime_stage_execution` 事件）、`state.snapshot.json`（含规范化后的 `run/stageRuns/decisionRecords/artifactRecords/humanReviewRecords`）。
- **stage 状态枚举**：pending / running / completed / failed / skipped / blocked / invalidated（`Pipeline.js` 与 `runtimeJournal.js` 一致）。

### 2.5 版本演进史（重构必须理解的“为什么有两套”）

- **Phase 1–4**（`docs/superpowers/plans|specs/*2026-04*`）：单镜头视频主链 → bridge 子链 → action sequence 子链，都在 legacy `src/agents/director.js` 内以**巨型 if-else/阶段函数 + state.json 字段缓存**实现。
- **后处理闭环**：`storyboardContextAgent → crossVideoConsistencyAgent → avPackagingAgent → postComposeReviewAgent`，产物 `storyboard-context-memory.json / cross-video-consistency-report.* / av-packaging-plan.* / post-compose-review.json / edit-task-pack.json / human-review-queue.json`（`tests/fixtures/post-processing/` 有 fixture）。
- **身份治理**：`2026-04-17-identity-resolution-regression-spec` 后全面 ID-first，`characterRegistry`/`characterBibleStore`/`voiceCastStore`/`referenceImageAsset` 等围绕稳定 ID 重做。
- **新 Director 实验框架**：`src/director/* + src/pipeline/*` 试图“瘦编排 + 可断点 Stage 化”，由 `src/director/Director.js` 组装 10 个 Stage；**默认仍未切换**。

**现状结论：legacy Director 是项目模式的默认编排；experimental 框架是“已验证但未接管”的第二条编排主线，二者共享同一批 agent 与 store。**（D1 只移除“兼容单文件输入模式”这一输入轴；两套编排实现如何收敛见 T2/P2。）

---

## 3. 数据模型与领域语言（需求级 Schema）

### 3.1 project / script / episode / shot（结合 `entityFactory.js`、state 字段、projectStore 校验）

- 实体统一由 `createEntity(input, prefix)` 生成：`id = <prefix>_<uuid>`、`status`（默认 draft）、`createdAt/updatedAt`。project/script/episode 之间用 `projectId/scriptId/episodeId` 强校验父子链（`projectStore.js` 的 `validateParentLink`）。
- legacy Director（编排实现轴，项目模式默认也用它）`state.json` 的关键缓存字段（恢复/失效的字典来源，`docs/runtime/resume-from-step.md`）：`scriptData/scriptList?`、`characterRegistry`、`promptList`、`imageResults`、`normalizedShots`、`motionPlan`、`performancePlan`、`shotPackages`、`rawVideoResults`、`enhancedVideoResults`、`videoResults`、`shotQaReport(V2)`、`bridgeShotPlan/bridgeShotPackages/bridgeClipResults/bridgeQaReport`、`actionSequencePlan/actionSequencePackages/sequenceClipResults/sequenceQaReport`、`audioResults/audioVoiceResolution/audioProjectId`、`lipsyncResults/lipsyncReport`、`composeResult/outputPath/deliverySummaryPath`、`lastError/failedAt/completedAt`。**该 state 字段协议不因删除兼容输入模式而废弃**（项目模式续跑仍依赖它，直到 P2 迁入 checkpoint 后评估收敛）。
- shot 级常见字段（散落于 scriptParser/characterRegistry/videoRouter/promptEngineer）：`id、sceneId、order、shotType、sceneType、location、dialogue、sfx、caption、cameraType、durationSec、characterIds、participants、tags、prompt 双语组、imageResult、motionEntry、performanceEntry、package…`。**重构时不要凭猜重建，应以现有 seed/sample run 的 json 为 schema 基线。**

### 3.2 Prompt 合同（`src/domain/promptContract.js` + promptEngineer）

- `displayZh/displayNegativeZh`（UI/QA 展示）、`executionEn/executionNegativeEn`（模型与 provider 执行）、兼容别名 `image_prompt/negative_prompt` 当前指向英文执行字段。
- `hardConstraints[]`、`softPreferences[]`、`negativeRules[]`、`referenceBinding`、`outputSchema`、`tokenBudget`。
- 规则：**模型/视频调用优先使用 execution 字段**；prompt 中保留分镜编号；角色绑定走 ID 而非名字。

### 3.3 角色身份与资产（ID-first）

- 稳定键：`id / episodeCharacterId / mainCharacterTemplateId / characterBibleId`。`name` 仅展示。
- `characterRegistry.js` 提供身份 token/锚点解析族（`getCharacterIdentityAnchor`、`findCharacterByIdentity`、`resolveShotSpeaker` 等），并负责 episode 角色注册（`buildEpisodeCharacterRegistry`）。
- 项目级资产（全部文件 JSON，按 projectId 分目录）：`character-bibles/<id>.json`、`voice-cast.json`、`voice-presets/<id>.json`、`pronunciation-lexicon.json`；参考图资产经 `referenceImageAsset.js` 固化到 `promptList.referenceImages` 供视频路由消费。
- 治理产物：`characterAssetGovernance` 报告 + `characterRefSheetGenerator` 三视图 + `corePropRegistry` 核心道具契约（道具跨镜头锚定）。

### 3.4 QA / 决策 / 运行记录 Schema（`src/runtime/schemas/*`）

- `decisionRecord`：`decisionType / policySource / decisionKey / timestamp / inputSnapshot / outputSnapshot / rationale / tags`（如 quality_gate、run_rerun、run_resume、routing_decision…）。
- `humanReviewRecord`：`reviewId / blockedStage / blockingReason / status(pending|blocked|approved|rejected|needs_changes|manual_review) / resolutionPayload / taskIds`。
- `stageRun` + `runtimeJournal`：status 枚举见 2.4，含 `reusedCheckpoint`、`checkpointPath`、`outputKeys`、`error`。
- `runState`：顶层归一化 view（run 基本信息、stageRuns、decisions、artifacts、humanReview），workbench/review 消费。

### 3.5 视频 provider / transport / model 三层语义

- 业务意图 `VIDEO_PROVIDER`：`seedance / veo / sora / happyhorse`（`sora2`、`fallback_video` 别名归一到 `sora`）。
- 提交通道 `VIDEO_TRANSPORT_PROVIDER`：`official / relay_openai / relay_media_task / relay_seedance_v2 / dashscope_async / gateway(=vercel_ai_gateway)`。
- 实际模型 `VIDEO_MODEL_SHOT / _SEQUENCE / _BRIDGE`（与 `VIDEO_FALLBACK_MODEL`、`SEEDANCE_MODEL_ID`、`ZDAI_SORA2_MODEL`、`HAPPYHORSE_MODEL_ID` 兼容链）。
- 能力表 `videoProviderCapabilities`：参考图/参考视频支持、首尾帧、时长范围、连续性模式等；bridge 策略选择器 `chooseBridgeContinuityStrategy` 按风险与能力降级。

---

## 4. 编排与运行框架需求细节

### 4.1 CLI 契约（重构后必须保留的参数语义）

`scripts/run.js`（项目模式，唯一入口）：
- **必填** `--project=<projectId> --script=<scriptId> --episode=<episodeId>`（三者齐全进入项目模式）；`--style=realistic|3d`；`--input-format=professional-script|raw-novel|auto`；`--max-shots=N`（截取前 N 分镜）；`--stop-at=full|after_ref_sheets|after_images|before_video`；`--skip-consistency`；`--continue/--continue-job-id`；`--run-attempt-id`（前后端状态对齐）；`--runtime=legacy|experimental`（编排实现选择，默认 legacy）；`--provider`（临时覆盖 LLM_PROVIDER）。
- **【D1 移除对象】**：~~位置参数剧本文件（`run.js <file>`）~~、~~`--project-id`（voice preset 归属的旧单文件透传参数）~~——两分支（`mode:'legacy'` + `runPipeline(scriptFilePath)` + `buildLegacyBridgeIdentity` 自动桥接临时 project）整体删除。

`scripts/resume-from-step.js`（项目模式续跑，唯一入口）：
- `--step`（见下方步骤链）、`--dry-run`（只打印恢复计划）、`--prepare-only`（只重置不开跑）、`--run-id`（**严格绑定**某次历史 run：以该 run 的 `state.snapshot.json` 为基线；从 video 起恢复时参考图必须属于该 run；缺前置/越界直接失败而非回退）、`--confirm-paid-video`（video 续跑付费保护开关，默认不触发真实生成）。
- 续跑语义（文档与代码一致）：不是行级续跑，而是“删除该 step 及后续的 state 缓存字段 + 清理产物 → 重调主流程”；前置缓存不全时警告并从更早步骤重跑（严格绑定模式下改为失败）。
- **【D1 移除对象】**：~~位置参数/`--script-file=<path>` 的 legacy 剧本恢复分支~~（`buildLegacyBridgeIdentity` 同 run.js，一并删除）。

### 4.2 主流程分阶段需求（legacy 编排与 experimental pipeline 两套口径，均服务项目模式）

**Legacy 主链步骤（resume step 顺序 + video 内部链）：**
`character_registry → prompts → images → consistency → continuity → video → dialogue → audio → lipsync → compose`
video 内部：`plan_motion → plan_performance → route_video_shots → generate_raw_video_clips → enhance_video_clips → shot_qa_v2 → [bridge: plan→route→generate→qa] → [sequence: plan→route→generate→qa]`

**Experimental pipeline Stage 顺序（`rerunPolicy.js` 定义，也是失效顺序基准）：**
`character → prompts → images → consistency → video_planning → video_routing → video_generation → post_process → compose → cross_video_consistency`

两者是同一业务链的两种表达；**业务阶段语义以 legacy 的 resume step 为“契约基线”**（因为它被 CLI/文档/测试引用最多）。

### 4.3 两套 Director 并存的具体分工

| | legacy `src/agents/director.js`（~3000 行） | experimental `src/director/Director.js`（~730 行） |
|---|---|---|
| 编排方式 | 巨型函数内联 step + state.json 字段缓存 | 10 个 Stage 类 + CheckpointManager + Pipeline |
| resume | step 级（删缓存字段） | stage 级（checkpoint 文件 + rerunPolicy 失效） |
| 人审恢复 | 有（humanReviewRecords blocked→approved） | 有（resumeOptions/assertResumeAllowed） |
| 产物 | run 包 + state | run 包 + snapshot/journal + delivery-summary（sequence 口径） |
| 停止点 | `--stop-at` | `stopAfterRefSheets/stopAfterImages/stopBeforeVideo` 截断 stage 数组 |
| 付费保护 | resume `--confirm-paid-video` | 由 stop 与 resume 门禁覆盖 |

`src/agents/director.js`（144-167 行）与 `scripts/resume-from-step.js`（374 行起）各自**内嵌一份** `buildLegacyBridgeIdentity` / `canReuseExistingParsedLegacyData`；`src/agents/director/helpers/legacyBridge.js` 是它们的同源抽取版（当前无 import 引用，属孤儿文件）。这套实现全部服务于兼容单文件输入桥接，归入【D1 移除对象】（见 T2b）——注意：不要把它与 bridge shot 子链（`src/agents/bridgeShot*`）混淆，后者是正常保留的镜头过渡子链。

### 4.4 缓存 / 失效 / 恢复规则

- Stage 默认 `shouldSkip = (checkpoint != null)`。
- 显式失效表（`rerunPolicy.js`）：rerun 某一 stage 会级联失效其**之后**所有 stage（例：rerun `images` 失效 images 及之后 8 个）。
- resume 校验（`Director.js`）：`resumeFromStage` 必须在 `PIPELINE_STAGE_ORDER`；否则需 snapshot 存在 + blocked + 已 approved。
- 兼容 `state.json` 老 checkpoint 迁移：若旧 state 有 `characterRegistry` 且 character stage 未完成，先写入 character checkpoint（`Director.js` 迁移逻辑）。

### 4.5 run job 与观测写入点

- 新 run：`runJobStore.createRunJob`（记录 artifactRunDir/manifest/timeline 路径）→ 每个 stage 完成 `onStageComplete` 同步 state.json → 收尾 `writeRuntimeJournal` + `writeRunQaOverview` + `finishRunJob`。
- 失败：catch 后写 `state.json(lastError/failedAt)` → journal(status=failed) → finishRunJob(status=failed,error) → rethrow。
- 每个 agent 完成时写自己的 `manifest.json / 1-outputs/qa-summary.md / 2-metrics/qa-summary.json`（harness 规范，`writeAgentQaSummary`）。
- Director 聚合写 run 根 `qa-overview.json|md`（含 `Run Debug Signals`）。

---

## 5. 逐 Agent / 模块需求明细（重构“行为规格”主体）

> 通用约定（所有 agent）：
> - 输出双份摘要：`1-outputs/qa-summary.md` + `2-metrics/qa-summary.json`；
> - 失败模式二选一：**阶段级失败 throw Error（中文可读）**；**批量单项失败返回 `{success:false,error}`** 由调用方汇总；
> - 多数 agent 为“纯函数式”入口（输入 shots/registry/…，输出结果 + 自己写 artifact 目录），便于独立 prod-test 与 mock。

### 5.1 文本与预生产层

**Script Parser**（`scriptParser.js`）
- `parseScript(text, deps)`：按 `inputFormat` 分流；`decomposeScriptToEpisodes`（专业剧本按集/场景/`【画面N】`拆）+ `parseRawNovelScript`（小说改编成结构）+ `parseEpisodeToShots` + `refineShot`。
- 产出：`scriptData / episodes / 扁平 shots / characters`（写入 `01-script-parser`）。
- 判定：`detectInputFormat` 依据是否含 `【画面N】`；`resolveInputFormat` 校验合法值。
- `professionalScriptParser.js`（旧强约束版）与 `sceneGrammarAgent.js`（场景语法）并存，scene grammar 供 seedance prompt 使用。

**Character Registry**（`characterRegistry.js`）
- `buildCharacterRegistry(characters, scriptContext, style)`：统一角色视图（项目角色×剧本角色）；每角色生成身份 token/锚点/禁用 token 集（防“同名不同人/中英名拆两人”）。
- `buildEpisodeCharacterRegistry / resolveShotParticipants / resolveShotSpeaker / getShotCharacterCards`：镜头级参与者与说话人解析（ID 优先）。
- 治理链路依赖：`characterRefSheetGenerator`（三视图，失败即整链停止）、`corePropRegistry`（核心道具）、`characterAssetGovernance`（报告 + reviewItems）。
- 硬失败信号：参考图/三视图失败 → 后续烧钱步骤不启动（见 7.3 的 hard block reason codes）。

**Prompt Engineer**（`promptEngineer.js`）
- `generateAllPrompts / generatePromptForShot`：把角色卡+场景+镜头意图 → 双语 prompt 合同；`applyContinuityRepairHints` 支持按 continuity 报告修 prompt。
- 产出 `promptList`（含每个 shot 的 `image_prompt_en/display_prompt_zh` 等 + `referenceImages`）。

**Image Generator**（`imageGenerator.js`）
- `generateAllImages / regenerateImage`：批量出分镜图与定向重生（regenerate 支持 prompt_tighten/reanchor 语义）；走 `imageApi` 队列（并发默认 5，间隔 3s）。
- 失败：单项失败收集，命中 `{success:false}`；三视图等关键资产失败整体 throw。

### 5.2 质量闸门与一致性/连贯性

**Preflight QA**（`preflightQaAgent.js`，视频前最后一道视觉闸门）
- `runPreflightQa(shotPackages)`：对每个 shot package 打分并 `inferDecision`，产出 entries（含 reasons、decision pass/warn/block）；对 warn 的 package 可 `rewriteWarnPackage`。
- 其 entries 被 `qualityGatePolicy.evaluateQualityGate` 消费。

**Consistency Checker**（`consistencyChecker.js`）
- 双轴策略：`rolePriority(lead/support) × shotConsistencyClass(anchor/standard/complex)`，阈值矩阵（`consistencyQaPolicy.js`）：
  lead{anchor:8.5, standard:8.0, complex:7.5}；support{anchor:8.0, standard:7.5, complex:7.0}；reviewBand 默认 0.4。
- 判定线：`score < threshold-0.4 → warn(prompt_tighten)`；`score < threshold+0.4 或带软风险标签 → pass_with_review`；低于 hardFailure（硬失败原因）→ block(reanchor_regenerate)。
- 产出 `reports[]`（每角色 qaDecision + overallScore + hardFailureReasons + softRiskTags + 候选重生成镜头），`needsRegeneration[]`；visual QA 使用 `visionChat`。
- 硬失败原因解析含 identity drift tags（`resolveHardFailureReasons`）。

**Continuity Checker**（`continuityChecker.js`）
- 按相邻 shot 对（`buildContinuityPairs`）检查：角色空间/道具锚点/场景/时间；输出 `continuityFlaggedTransitions`（高风险 cut 供 motion/bridge 消费）；硬违规（hardViolations code+severity）+ 软警告；阈值默认 7。

### 5.3 单镜头视频主链

- **Motion Planner**：每镜头规划 `motionPlan`（镜头类型、运镜、动态目标、时长 targetSec）。
- **Performance Planner**：补 `performancePlan`（表演模板、动作节拍、生成层级）。
- **Video Router**：`routeVideoShots` → `shotPackages`（含 resolved prompt、参考图集合、`preferredProvider/fallbackProviders`、quality 分）；参考图收集顺序见 6.1。
- **Video Generation（统一）**：`videoGenerationAgent.runVideoGeneration` 是“瘦执行器”（幂等 skip 判定、output 路径、统一 run 记录、report 聚合），实际提交走 unified client；`seedanceVideoAgent / sora2VideoAgent` 是两个业务分支执行器（保留 provider 语义）。
- **Motion Enhancer**：`decideEnhancement` 决定增强或透传（`rawVideoResults → enhancedVideoResults`）。
- **Shot QA**：`runShotQa` 对每条视频 `probeVideo`（ffprobe 时长）+ 运动验收（阈值按 performanceTemplate），输出 `shotQaReportV2` entries 与 metrics。

### 5.4 Bridge 子链（只在高风险 cut 触发）

- `bridgeShotPlanner`：仅在 `continuityFlaggedTransitions` 高风险项上规划；`inferBridgeType`（motion_carry / spatial_transition 等）→ `bridgeShotPlan`。
- `bridgeShotRouter` → `bridgeShotPackages`（provider hint 与参考绑定）；`bridgeClipGenerator` 生成 clip 或可解释失败（分类原因）；`bridgeQaAgent` 输出 `finalDecision ∈ {pass, fallback_to_direct_cut, fallback_to_transition_stub, manual_review}`。
- **只有 `pass` 的 bridge clip 进入 compose timeline**；其它回退不破坏主链（`docs` 与 `10-video-composer` 消费方一致）。

### 5.5 Action Sequence 子链（高价值连续动作段）

- `actionSequencePlanner`：对追逐/打斗/逃离等连续动作打分（`scoreFightExchange/scoreChaseRun/scoreEscapeTransition`）→ `actionSequencePlan`（覆盖 shotIds、镜头数、秒数预算）。
- `actionSequenceRouter`：候选素材分层打分选优（videoResult 优先于 image 参考，bridge pass 结果可兜底）；`skipReasonBreakdown` 解释为何没发 sequence 请求（缺图/缺视频/缺 bridge/素材混合不足）。
- `sequenceClipGenerator`：生成整段 sequence clip，记录 provider 失败分类。
- `sequenceQaAgent`：四项检查（engineCheck / durationCheck / entryExitCheck / continuityCheck）→ `finalDecision ∈ {pass, pass_with_enhancement, fallback_to_shot_clips, manual_review…}`；`topFailureCategory/topRecommendedAction` 指导调优；QA metrics 落 `2-metrics/sequence-qa-metrics.json`。
- **覆盖规则**：只有 approved 的 sequence 覆盖原始 shot timeline，其余 fallback 回逐镜视频。

### 5.6 对白与音频

- `dialogueNormalizer`：`normalizeDialogueText`（发音词典/标点归一）→ `splitDialogueSegments` → `estimateDialogueDurationMs` → `normalizedShots`（含分句与时长预算）。
- `ttsAgent`：`findVoiceCastEntry`（voice cast by id）→ 每句合成（provider 由 ttsApi 路由）→ `audioResults` + `audioVoiceResolution`；支持分句音频 `combineAudioSegmentFiles`。
- `ttsQaAgent`：时长对齐（probe）、ASR 回读、voice drift、人工抽检规划 → pass/warn/block。
- `lipsyncAgent`：`shouldApplyLipsync`（近景/说话/口型必要性）→ `runLipsync` 生成口型片段或降级，输出 `lipsyncResults/lipsyncReport`，失败给 root-cause view + 人工复核建议。

### 5.7 合成与交付

**Video Composer**（`videoComposer.js`）
- 输入 `shots / imageResults / audioResults / videoResults / bridgeClips / sequenceClips / lipsyncResults / animationClips`。
- **视觉优先级（契约）**：`sequenceClips > videoResults > bridgeClips > lipsyncResults > animationClips > imageResults`；按此在 timeline 覆盖同一时间槽。
- 装配：ffmpeg（含字幕/配音/转场）；字体探测 `detectChineseFont`；产出 `finalOutputPath` + `10-video-composer/2-metrics/video-metrics.json`（sequence_coverage 等）。
- 三种入口：`composeVideo`（新，推荐）/ `composeFromLegacy`（从 legacy 编排 state 合成，**服务于编排实现轴 legacy Director 的 state 协议，非 D1 移除对象**）/ `composeFromJob`（从既有 run job 合成）。D1 删除兼容输入模式后此三入口仍保留（项目模式 legacy 编排仍产出 legacy 结构 state）。

### 5.8 后处理闭环（新链）

| Agent | 用途 | 关键产物 |
|---|---|---|
| storyboardContextAgent | 跨 run 的分镜上下文记忆（新鲜度失效管理 `recordInvalidation`） | `storyboard-context-memory.json` |
| crossVideoConsistencyAgent | 跨镜头/跨视频一致性复检（domain `crossVideoConsistency.js`） | `cross-video-consistency-report.*` |
| avPackagingAgent | 音画包装计划 | `av-packaging-plan.*` |
| postComposeReviewAgent | 成片后审 + 编辑任务包 | `post-compose-review.json`、`edit-task-pack.json` |
| humanReviewQueue | 汇总资产治理/质量门/成本产生的人工决策点 | `human-review-queue.json` + md + metrics |

---

## 6. 媒体 Provider 域需求

### 6.1 视频统一客户端合同（`unifiedVideoProviderClient.js`）

对外三步 API：`submit(videoPackage, outputPath) → {requestId, taskId, provider, model, transport, outputUrl, providerRequest, providerMetadata}`、`poll(taskId)`、`download(outputUrl, outputPath)`。内部注册表 `taskRegistry/outputRegistry` 维持 task↔request 映射；支持**注入 handler bundle**（`seedanceHandlers/fallbackHandlers/vercelHandlers`，测试替身与网关后端的扩展点）。

请求构造链：`resolveVideoGenerationConfig`（provider/model/transport/baseUrl/apiKey/protocol/submitPath/pollPath/downloadPath/providerParams）→ `createVideoGenerationRequest` → `router.resolve`（route table）→ `adapter.buildProviderRequest` → `transport.submit/poll/download`。

**参考图策略（契约）**：videoPackage 由上游固化 `referenceImages`（角色卡参考图 + 当前镜头出图）；transport 层按 provider 能力选择：HTTP URL 直传 → 无公网 URL 转 dataURL/base64 → 多图超限合成单张 composite（适配层统一做，不新增站点 provider）。
**失败分类**：统一错误带 `code/category/status/details`（`normalizeVideoProviderError`）；`videoGenerationContract.createVideoGenerationResult` 归一失败结果（failureCategory/errorCode/errorStatus）。

### 6.2 Transport 矩阵（route table 源码值）

| provider | 可用 transport | 提交路径 | 备注 |
|---|---|---|---|
| seedance | official / relay_openai / relay_seedance_v2 / gateway | official: `/contents/generations/tasks`；relay_seedance_v2: `/api/v1/tasks/generations`；relay_openai: `/videos` | 默认模型 `doubao-seedance-2-0-260128`（或 env） |
| veo | relay_openai / gateway | `/videos` | |
| sora | relay_media_task / relay_openai / gateway | relay_media_task: `/v1/media/generate`(+`/v1/media/status`) | 默认模型 `sora-2`；baseUrl 域名命中 `zdai88.com/api.lingkeai.ai/api.lk888.ai/api.lk666.ai` 自动推断 relay_media_task |
| happyhorse | dashscope_async | `/api/v1/services/aigc/video-generation/video-synthesis`；轮询 `/api/v1/tasks/{id}` | 默认模型 `happyhorse-1.0-r2v`；参数 `HAPPYHORSE_RESOLUTION=720P/RATIO=9:16/WATERMARK/SEED/ALLOW_DATA_URL_REFERENCES=true`；模型与 endpoint/key 须同地域 |

兼容层要点：transport 显式未配时按 baseUrl/模型启发式推断（`inferLegacyTransport`）；`official` transport 与 `/v1`、`yunwu.ai`、`laozhang` 类 baseUrl 冲突直接抛 `VIDEO_TRANSPORT_BASEURL_MISMATCH`；历史变量（`VIDEO_FALLBACK_*`、`ZDAI_SORA2_*`、`LINGKEAI_*`、`DASHSCOPE_*`）仍参与推断，但**新配置只推荐 `VIDEO_TRANSPORT_*`**。

### 6.3 Prompt 翻译层（`translatePrompt.js`）

`ensureEnglishPrompt(text)`：无中文直接透传；含中文 → provider 判定（默认 `llm`；配了 `PROMPT_TRANSLATION_BASE_URL` 则走 libretranslate 兼容 `/translate`）→ 失败自动回退 LLM 翻译 → 仍失败返回原文。内存 Map 缓存。LLM 翻译有严格规则 system prompt（保留镜头/运镜/技术/转场/质量术语英文、结构不变、人名拼音化）。兼容 `SORA2_TRANSLATION_*`。

### 6.4 图像域（`imageApi.js` + `unifiedImageProviderClient.js` + `laozhangImageProvider.js`）

- 任务类型 `IMAGE_TASK_TYPES`：realistic_image / threed_image / image_edit / realistic_video / threed_video（后两者为抽象模型路由）。
- 路由：`taskType → {provider, model}`（默认 `REALISTIC_IMAGE_MODEL` 等 env），provider 目前只有 `openai_compat(=laozhangImageProvider)`；transport 可切 `vercel_ai_gateway`。
- `generateImage(prompt, negativePrompt, outputPath, options)`：支持 references/referenceGroups(character/scene/props) 传入做参考绑定；返回文件路径。批量并发由外部队列（imageQueue）控制。

### 6.5 音频/口型/ASR 域

- **TTS 两层合同**（`ttsApi.js`）：`TTS_PROVIDER` 选上层语义（minimax 默认 / xfyun / cosyvoice / fish-speech / mock / openai_compat / tencent、volcengine 为 placeholder）；`TTS_TRANSPORT_PROVIDER` 在 `openai_compat` 下选真实供应商。`textToSpeech(text, outputPath, {gender, voice,…})` 空台词返回 null。
- MiniMax 要点：HTTP `/v1/t2a_v2`+`GroupId`；voice_setting（voice_id/speed/vol/pitch/emotion）+ audio_setting（采样率/码率/格式/声道）；男/女默认音色与旧值 `Warm_Girl / Reliable_Executive` 归一；响应 hex audio → buffer 落盘。
- **Lip-sync chain**（`lipsyncApi.js`）：provider 链 + fallback 列表；仅当错误类别 ∈ {timeout, network_error, provider_5xx} 才切下一家（`shouldFallbackToNextProvider`）；返回 `{provider, videoPath, attemptedProviders, fallbackApplied}`。
- ASR：`asrApi` + `mockAsrApi`（真实供应商未接，TTS QA 的 ASR 回读当前 mock 化）。

### 6.6 LLM 客户端（`llm/client.js` + `llm/prompts/*`）

- `chat(messages, {provider,temperature,maxTokens,jsonMode})`、`visionChat(text, imageUrls)`（qwen 用 OpenAI 兼容 image_url；claude 专用格式/URL 或 base64）、`chatJSON`（json_object 模式 + 健壮 JSON 解析 `parseJSONResponse`：剥 code block → 直接 parse → 正则抓首对象/数组 → 失败抛错带原文）、`healthCheck`。
- providers：qwen（默认）/deepseek（openai-compat）、claude（anthropic SDK）。
- 提示词资产：`consistencyCheck.js`（一致性检查）、`promptEngineering.js`（prompt 工程）、`scriptAnalysis.js`（剧本分析）。
- **无自带重试**：重试在队列层（见 6.7）。

### 6.7 并发 / 重试 / 成本

- 队列（`queue.js`，p-queue）：image 并发 5（interval 3s/cap 5）、llm 5、video 3、tts 3、lipsync 3；`QUEUE_EXECUTION_POLICY` / `NODE_ENV=test` 切 test 模式（`useRealQueue=false`、默认 maxRetries=1），生产默认重试 3；指数退避（429 → 8s 起×2 封顶 60s，其它 1s 起封顶 30s）。
- **成本护栏**（`costGovernance.js` + resume `--confirm-paid-video`）：估计单元=视频请求数 + reanchor 重生成×2 + prompt_tighten×1；blockers/warnings 进 humanReviewQueue；非生成 provider（static_image/skip/fallback_direct_cut/direct_cut）不计费。
- **Billing ledger**（`src/billing/*`）：`billing-ledger.json`（run 根）记录每笔（category/provider/amount/status billed|waived|failed/idempotencyKey/openmeter 元数据）；`operationClassifier` 分类；`logAggregation` 聚合日志；`gatewaySync`（adapterRegistry/gatewayMatch/scheduler/syncGatewayLedger）按 env（`GATEWAY_SYNC_*`）把用量同步到网关（默认 /usage）；backfill 脚本补记旧账。

---

## 7. 质量治理与 QA 策略需求

- **判定语义**：`pass`=可放行；`warn`=有偏差但放行（须留证据）；`block`=阻断交付。全局发布门槛：所有 block 级 agent 均为 pass + 无未关闭关键错误 + 最终交付物存在。
- **人工验收顺序**（`docs/sop/qa-acceptance.md`）：run-jobs → delivery-summary → agent-matrix 通过条件 → 抽查 5 份关键表（shots.table / prompts.table / consistency-report / continuity-report / dialogue-table）→ 异常看 `3-errors/`。
- **抽查/阻断对照**：block 典型：final-video.mp4 缺失、主角身份漂移未修复、三视图失败、绑定错（同名不同人/中英名拆两人）、continuity 硬违规未关、说话镜头缺音频、关键镜头未出图。
- **quality gate 硬阻断码**（`qualityGatePolicy.js`）：`anatomy_structure_invalid / anatomy_pose_invalid / limb_structure_invalid / character_identity_corrupted / reference_sheet_background_invalid / scene_spatial_continuity_break`；另有 `no_visual_assets` / `preflight_block`（静态 fallback 可豁免）。
- **人审记录**：状态机 pending→blocked/approved/rejected/needs_changes/manual_review（`humanReviewRecord` + `humanReviewQueue` 双层：资产维 quality_gate × 镜头维 shot_regeneration）。
- **agent 级 QA 摘要规范**：每个 agent `qa-summary.{md,json}`；Director `qa-overview.{md,json}`（Run Debug Signals 列出缓存/跳过/重试/人工/失败步骤、视觉阻断镜头、上游失败镜头）。
- **回归护栏（现有测试）**：`tests/` ~110 个 `node --test` 文件，覆盖单测、artifact contract（`*.artifacts.test.js`）、集成（`director.bridge/sequence.integration`、`pipeline.acceptance`、`postProcessingLoop.e2e`、`resumeFromStep`、`workbench/workbenchServer`）；prod 向单 agent 测试入口 `scripts/run-agent-prod-tests.js <agent>`（`.env` 注入真 key 可跑真链）。
- **【D1 波及】测试与文档同步清理**：`tests/runCli.test.js` 有 5+ 用例锁定 legacy 单文件解析/分发（`parseCliArgs keeps legacy single-script mode intact`、`createCli dispatches legacy mode to runPipeline` 等）——删除兼容入口后这些用例需改写为“位置参数直接报错”或移除；同时同步清理 `scripts/run.js` 顶部 usage 示例（40-42 行的 `run.js samples/test_script.txt` 示例）、`.env.example`/README 中残留的单文件示例与 `docs/runtime/resume-from-step.md` 的 legacy 透传描述。

---

## 8. 观测与可交付需求（Workbench）

- 服务：`npm run workbench` → `scripts/workbench-server.js` → Fastify 壳 `src/app/workbench/server.js`（端口 4180，默认 host 127.0.0.1）内部桥接/流式转发 legacy Node http handlers（`src/app/workbench/legacyServer.js`）。**现状是“legacy handler 大路由 + 新 Fastify 壳”的过渡形态**。
- 页面契约（README/user-guide 声明）：`/projects`、`/project/:id`、`/drama/:id`、`/review/:runId`、`/editor`、`/drama/:id/characters|scenes|voices`。
- API 面：`/api/runs/:runId`（+`/review`、`/review/clips`、`/review/video`、`/artifacts/file`）、`/api/logs`（+/runs、/sync）、`/api/scripts/professionalize`；数据源仓库：runJobRepository / qaOverviewRepository / runArtifactRepository / runStateResolver（live `state.json` fallback）；ViewModel 由 `transformers/workbenchViewModel.js` 组装。
- 读/写边界：主要只读；写面包括 `runCommandRoutes`（run 控制/重开）、`humanReviewActions`（审批放行）、`runJobReconciler`（进程存活对账）、`runtimeControlPlaneView`、`settingsRoutes`（env 读写 `envConfigStore`）、脚本一键优化、`/api/logs/sync` 网关同步触发。非 GET 方法受 Workbench Token 保护（`shouldProtectWithWorkbenchToken`）。
- 风险标注来源：post-compose-review.json / edit-task-pack.json / human-review-queue.json；`run.error` 兜底构造 QA fallback 视图。
- UI 仓库（`views/`，132 文件）：本次仅确认存在，未逐文件核对；重构边界：与后端仅通过上述 HTTP 契约交互，后端重构不得破坏该契约（Editor 只编辑 dialogue/scene/cameraType/durationSec 等受限字段）。

---

## 9. 非功能 / 工程约束（沿用 AGENTS.md 与工程惯例）

1. **技术选型纪律**：优先成熟第三方/已有依赖；Node ESM + Fastify 主栈；禁止为“可控”重写成熟能力（HTTP/queue/媒体/测试基建）。
2. **模块治理**：单文件 >1000 行必须拆（现状重灾区见第 10 章）；单函数 >150 行且多职责要重构；编排/纯拼装/provider 特有逻辑分层放置。
3. **命名/注释**：camelCase 源文件、中文注释、注释讲“为什么”；目录职责约定见 AGENTS.md §3（agents/apis/domain/policy/utils/workbench/billing 各自归位）。
4. **错误可见性**：错误信息三处一致（日志 / artifact·state·report / workbench 文案）；禁止空数组/占位符伪装成功；禁止“看起来成功”的假状态。
5. **日志规范**：`utils/logger.js`，`logger.info(模块名, 消息)`；LOG_LEVEL 控制；禁止裸 console.log（queue 层残留少量 console.warn 属技术债）。
6. **环境变量**：UPPER_SNAKE_CASE；`.env.example` 为唯一权威文档；新增必须同步；无运行时校验库（手写 normalize）。
7. **排查纪律**：代码+日志驱动，禁止猜根因；失败要能答“哪一层/为什么/workbench 为何看到该现象/真正该改哪层”。
8. **回归/验证**：重构每阶段跑 `node --test` 对应聚焦集；全量 `npm run test` 冒烟 + 关键 prod 单 agent 测试。
9. **兼容与收敛**：主行为收敛为一条主链；识别到的废弃路径（旧 provider 别名、legacy 目录、placeholder）须评估清理而非保留“双实现”。

---

## 10. 已知技术债与重构动机清单（给任务拆分用）

| # | 债项 | 证据 | 重构建议方向 |
|---|---|---|---|
| T1 | legacy Director 3007 行巨型编排，state 字段缓存 + 巨型函数 | `src/agents/director.js` | 迁入 Stage/Workflow，删 state 字段散写 |
| T2 | 编排实现双轨并存（legacy director 默认 vs experimental Director），`workflowVersion` 默认值不齐 | `runtimeSelection.js`、`src/agents/director.js` vs `src/director/Director.js` | 明确“一条主链”，二选一并迁移（**注意：与 D1 移除兼容输入模式是两件事，legacy director 在项目模式下仍是默认编排**） |
| T2b | 【D1 移除对象】兼容单文件输入模式残留：`run.js`/`resume-from-step.js` 的 `mode:'legacy'` 分支、`buildLegacyBridgeIdentity`（`scripts/run.js` 与 `scripts/resume-from-step.js` 各一份）、`--project-id` 透传、`temp/legacy_<jobId>/` 平铺产物 | `scripts/run.js`、`scripts/resume-from-step.js`、`director.js runPipeline` | 入口、桥接、平铺目录支持整体删除；存量旧 run 仅保留只读/迁移能力评估 |
| T3 | 全部手写文件 JSON 存储（无 DB、无统一事务），两套命名（hash run 目录 vs 裸 id project 目录） | `utils/*Store.js`、`fileHelper.js`、`runArtifacts.js` | 评估 Mastra storage / SQLite / Postgres；先统一命名 |
| T4 | 兼容变量蔓延：`VIDEO_FALLBACK_*`、`SORA2_TRANSLATION_*`、`ZDAI_*`、`LINGKEAI_*`、`DASHSCOPE_*`、`BAILIAN_*` 均参与推断 | `videoGenerationConfig.js` | 收敛为 `VIDEO_TRANSPORT_*`/`VIDEO_MODEL_*`/`PROMPT_TRANSLATION_*` 单一口径 |
| T5 | 大文件：videoComposer 1272、storyboardContextMemory 1708、crossVideoConsistency 976、characterRegistry 852、sequenceQaAgent 787、seedanceVideoApi 810、fallbackVideoApi 885、videoTransports 647 | wc 结果 | 按 AGENTS.md §1.3 拆分 |
| T6 | LLM 调用无结构化输出（全 chatJSON + 手写解析），无 schema 校验 | `llm/client.js` | Vercel AI SDK `generateObject` + zod |
| T7 | 编排无中间件/无事件溯源，运行期对账靠文件扫描 + 进程存活探测 | `runJobReconciler.js`、legacy/http | Workflow/durable execution 替代 |
| T8 | Workbench 双 server（legacy http handler 桥接 Fastify）+ 只读/写面边界模糊 | `app/workbench/server.js`、`legacyServer.js`、`http/router.js` | 收敛单一 server；写面显式控制面 |
| T9 | LLM/媒体 provider 调用散落（部分 agent 直接 chat，部分走队列+重试），观测点不一致 | 各 agent | 统一 LLM 调用封装 + 队列/重试/观测 |
| T10 | 文档漂移（README 主推 experimental 描述 vs 默认 legacy；部分 agent 无文档或旧文档） | 各 docs | 重构后按代码事实重写 docs 地图 |
| T11 | `mock/placeholder` 供应商（TTS tencent/volcengine、ASR、lipsync 默认 mock） | `providers/*`、`lipsyncApi` | 保持为“测试/demo 回退”，明确启用开关 |
| T12 | 翻译、参考图选择、语音归一等“跨域小逻辑”散落且重复 | `translatePrompt`、`videoRouter`、`ttsAgent` | 抽 domain/policy 纯函数 |
| T13 | queue.js 内 console.warn / fileHelper 内 console.warn 违反日志规范 | `queue.js:188`、`fileHelper.js:151` | 换 logger |

---

## 11. 目标架构（to-be）：框架选型映射与重构策略

### 11.1 框架定位（2026-09 语境）

- **Mastra**（TypeScript，Apache-2.0）：Agent + Workflow（step/branch/parallel/suspend）+ memory/storage（libSQL/Postgres/Upstash）+ RAG + evals + OTel 观测 + 内置 server/Studio；底层模型调用就是 Vercel AI SDK。最贴合本项目“TS 主栈 + 多步流水线 + 需要断点/续跑/可观测”的诉求。
- **Vercel AI SDK**：传输层 primitives（`streamText/generateObject/tool` + 多 provider），不提供编排/记忆/存储。适合承接本项目 LLM 客户端与结构化输出、以及未来前端流的底座。
- **CrewAI**：Python 系角色协作；与当前 Node ESM 主栈直接冲突，仅适合“若未来单独把某策划/评审做成独立服务”的参考，不建议作为主重构基座。

推荐基线：**Mastra 为主编排基座（agents/workflows/tools/storage），Vercel AI SDK 为模型与结构化输出底座（Mastra 内部本身使用它）**；CrewAI 不引入主链（除非明确要 Python 子系统）。最终选型矩阵以需求为准，不做框架崇拜。

### 11.2 职责映射矩阵（现模块 → 目标抽象）

| 现状 | 目标抽象 | 迁移要点 |
|---|---|---|
| legacy/experimental Director + Pipeline/Stage/Checkpoint | Mastra Workflow（或多个 workflow 编排） | 每一 legacy resume-step / pipeline stage ≈ 一个 workflow step；step 输出即 checkpoint 数据 |
| 断点续跑/resume CLI/checkpoint 文件 | Workflow durable run + Mastra storage（或自持 run store） | 保留“run id + step 进度 + 缓存可复用”的外部契约（resume-from-step CLI 语义不变） |
| 各业务 agent（scriptParser→videoComposer） | Mastra Agent / 工具化纯函数 step | 纯规则/拼装类→普通 step 函数；LLM 决策类→Agent + tools 或 workflow step 内调 AI SDK |
| consistency/continuity/各 QA + qualityGate | 门禁 step（纯判定，可测试） | 阈值矩阵、reason code、三段式语义 1:1 迁移 |
| `llm/client.js`（chat/visionChat/chatJSON） | Vercel AI SDK（`generateText/generateObject` 或 Mastra model） | 保留 provider 名与 env 语义；结构化输出补 zod schema |
| provider/transport/model 适配层（apis/*） | 保持独立 adapter 域，仅把“是否 LLM 可调用”暴露为 Mastra tool | **这是最不该被框架绑架的层**：契约（contract/config/router/transports）原样保留 |
| 文件 JSON stores / run-jobs | Mastra storage（Postgres/SQLite）或保留 fs 实现换统一接口 | 现有 `contracts/*Store.js` 已是接口化，天然可换实现 |
| human-in-the-loop / 人审放行 / blocked→approved | Mastra `suspend/resume`（注意 11.4 坑）或自有 store 两段式 | 保持 humanReviewRecord 状态机外部可见 |
| billing ledger / costGovernance | 独立中间件/工具 step 切面 | 保留 runDir 级 ledger 与幂等键 |
| workbench HTTP | Mastra server / 自定义 API 读 Mastra storage | 保留页面与 API 契约 |

### 11.3 必须保留的对外契约（红线）

CLI 参数与退出语义（**项目模式面**：`--project/--script/--episode`、`--style`、`--input-format`、`--max-shots`、`--stop-at`、`--skip-consistency`、`--continue*`、`--run-attempt-id`、`--runtime`、`--provider`；resume 面：`--step/--dry-run/--prepare-only/--run-id` 严格绑定）、run 包目录与 `NN-name/` artifact 布局、`qa-overview/delivery-summary` 内容语义、pass/warn/block 三段式、consistency 阈值矩阵、compose 视觉优先级、`VIDEO_*/IMAGE_*/TTS_*/PROMPT_TRANSLATION_*` 环境变量口径、`.env.example` 权威性、现有 `tests/` 全部通过、agent 级 qa-summary 双写规范、`12-…` 序号与 `AGENT_ARTIFACT_LAYOUT`。
**D1 例外（显式变更，不属于红线保留项）**：兼容单文件入口（位置参数 `.txt`、`--script-file`、`--project-id` 透传、`temp/legacy_*` 平铺产物）为删除项，删除动作需进 CHANGELOG，不得静默遗漏。

### 11.4 Mastra 已知坑（重构时必须在设计中规避；来源 mastra-workflow-gotchas skill，v1.x）

1. `suspend()` 在 step execute 内**恒 resolve undefined**，且 resume 后**不会继续下游 DAG** → HITL 采用“两段式 workflow + 自持 approval store + 冷启动第二阶段”，勿把 approve 后逻辑写在 suspend 之后。
2. 在父 run 的 continuation 里 `await` 另一个 `run.start()` 会**挂死**（step 永不执行）→ 用 `.then()` 脱离观察 + `setImmediate` 跳出 AsyncLocalStorage。
3. 多段 workflow 拆分时 `runId` 会混入 Mastra 内部 id → **每个 step 的返回对象必须重发 `runId`**，下游与 deliver 统一 `rid = inputData.runId || runId`。
4. 首段 step throw 时 `run.start()` **resolve 而非 reject**（状态已 failed）→ 后续动作必须查 `getRun(runId).status` 再决定是否冷启动第二阶段。
5. 测试 mock `globalThis.fetch` 时要放行 localhost/loopback，避免劫持自建 HTTP；env 在 import 前设置；`node --test` 每文件独立进程最稳。

### 11.5 建议重构顺序（低风险→高价值，与任务拆分对齐）

1. **P0 契约冻结**：把第 11.3 红线固化为契约测试/快照（现有 tests 即是护栏）。
2. **P1 LLM/Provider 底座**：`llm/client.js → Vercel AI SDK`；apis 域保持（可后置），先统一“调用封装+队列+重试+观测”为共享层。
3. **P2 编排单轨化**：以 legacy resume-step 语义为契约基线，把 legacy Director 逐步改写为 Workflow stage；删 experimental 或让 experimental 成为唯一实现（二者择一）。**另在此阶段完成 D1 收尾**：删除兼容单文件输入模式全链路（run.js/resume 的 legacy 分支 + `buildLegacyBridgeIdentity` 两处 + `--project-id` 透传 + 平铺产物支持），只留项目模式入口。
4. **P3 存储收敛**：stores 接口保持，落 Mastra storage/DB；统一目录命名；run-jobs→storage 视图。
5. **P4 各 agent 逐迁**：QA 类纯判定 step 先行（迁移成本低且测试全），再 LLM 决策类 agent（scriptParser/characterRegistry/promptEngineer/…）。
6. **P5 HITL 与后处理**：bridge/sequence QA fallback 决策、人审放行、post-processing 闭环迁入 suspend/resume 语义。
7. **P6 观测/Billing/Workbench**：接 Mastra OTel/Storage 作为 read model；billing 保留 run 级 ledger；workbench 收敛单一 server。
8. 每阶段保持可运行（对应 `node --test` 聚焦集 + 冒烟 run），并更新 docs 地图消除漂移。

### 11.6 重构验收（DoD）

- [ ] `node --test` 全量通过（含 artifacts/acceptance/e2e/resume 集）；
- [ ] 关键 prod 单 agent 测试冒烟通过（真 .env 时）；
- [ ] CLI/resume/run 包/QA 报告契约测试通过（第 11.3 红线）；
- [ ] 一条真实样本跑到目标停止点成功，qa-overview 语义正确（样本须先按项目模式落为 project/script/episode，如 `init-sample-project` 或 `samples/project-example/` 导入后 `run.js --project=… --script=… --episode=…`；不再支持 `samples/*.txt` 直跑）；
- [ ] 环境变量与 `.env.example` 无静默变更；CHANGELOG 记录所有契约变更；
- [ ] 双 Director（编排实现轴）合并为一（或显式废弃其一并有迁移说明）；
- [ ] 【D1】兼容单文件输入模式已整体移除：`run.js`/`resume-from-step.js` 无 legacy 分支、`buildLegacyBridgeIdentity` 无调用方、不再产生 `temp/legacy_*` 平铺产物；入口只接受项目模式三参数；
- [ ] 1000+ 行文件清单较现状下降（T5）；
- [ ] docs 地图按代码事实更新（消除 T10 漂移）。

---

## 12. 附录索引（速查）

- Agent→文件：`src/agents/*.js` 与 `docs/agents/README.md` 表格一致；run 包序号见 `src/utils/runArtifacts.js` 的 `AGENT_ARTIFACT_LAYOUT`。
- 环境变量分段（`.env.example`）：必填主链 → 可选 LLM Provider → 图像/编辑/视频模型路由 → 视频生成 → Vercel AI Gateway → 替换 TTS Provider → ASR/语音回写 → Lip-sync → 运行与输出参数。
- 测试：见 `package.json scripts` 与第 7 章“回归护栏”。
- 迁移风险参考：`docs/superpowers/specs|plans/*`（Phase1-4 设计意图）、`mastra-workflow-gotchas` skill。
