# ADR-002：runEpisodePipelineImpl 编排引擎终态 —— Mastra step 化，排除 CrewAI

> Status: Accepted（2026-09-04，架构决策）
> 关联：`P2任务书-编排单轨收敛.md` P2d v2、`AGENTS.md` §1.1/§1.2、重构需求说明书 §11.4/§11.5

## Context

P2d v1 已把 `runEpisodePipeline` 入口接入 Mastra workflow（单 plan step 承载 `runEpisodePipelineImpl` 的 25+ 阶段顺序编排）。下一步 v2 面临选型：把闭包内阶段提升为**独立 Mastra step**，还是改用 **CrewAI** 重写编排？决策依据是可靠性（失败面/可恢复性/护栏强度）与 ROI（增量成本 vs 重写成本）。

代码事实：
- 流水线是**确定性制造工序**：25+ 阶段各调一次专用 agent（单次 LLM/API 调用 + 落 state），阶段间靠闭包共享 ~40 个局部变量（`imageResults` 被一致性修复原地回写、`promptList` 被 reference 注入改写等），非「多角色 agent 协商」问题。
- 全部契约在 Node 侧：state.json 字段协议、resume 12 步链（`scripts/resume-from-step.js`）、workbench `stageConfig` step 名、687 个测试（含 54 例 director 护栏）。
- 项目为 Node.js ESM 单进程（Windows）；AGENTS.md §1.2 禁止平行技术栈。

## Decision

1. **排除 CrewAI**：Python 框架与 Node 仓库形成双运行时；其核心价值（role-play 多智能体协作、动态任务委派）与本流水线形状零匹配；重写将作废全部测试护栏并引入跨语言 IPC 失败面。ROI 为负。
2. **继续 Mastra step 化（P2d v2）**：阶段逻辑逐步提升为独立 Mastra step，数据流显式化，最终删除 `runEpisodePipelineImpl` 骨架。

### v2 落地路径

1. **数据流显式化（前置）**：引入 `pipelineCtx` 对象承载闭包共享变量（characterRegistry / promptList / imageResults / consistencyResult / shotPackages / preflightShotPackages / rawVideoResults / enhancedVideoResults / shotQaReport / videoResults / bridge* / sequence* / normalizedShots / audio* / lipsync* / compose* …），`saveState`/`recordStep`/`appendStepRun` 收敛为 ctx 方法。此步不改行为，全量绿为证。
2. **分批提 step**：按执行序 4–6 批（资产批：registry+refSheets+governance；生产批：prompts+images+恢复；QA 批：consistency+continuity+repair；规划批：scene/director/motion/performance/storyboard/routing/preflight；视频批：videoGen+enhance+shotQa+bridge/sequence；交付批：dialogue/audio/lipsync/cross/av/compose/postReview/delivery）。每批独立 step + 全量绿闸门，可随时停在任意中间态。
3. **收尾**：删除 `runEpisodePipelineImpl` 与单 step 壳，`runEpisodeViaWorkflow` 直接挂 step 图；CHANGELOG 记录；DoD「1000+ 行文件清单下降」核销。

### 规避既有五坑（§11.4，v2 仍适用）

- 坑1 HITL（P5 才涉及）：两段式 workflow + 自持 approval store，不在 suspend 后写逻辑。
- 坑2：不在任一 step 内 `await` 另一 `run.start()`；跨 workflow 用 `.then()` + `setImmediate`。
- 坑3：每个 step 返回对象重发 `rid = inputData.runId || runId`（ctx 中显式携带）。
- 坑4：`run.start()` resolve-on-throw，统一在 `runEpisodeViaWorkflow` 检查 `result.status==='failed'` 后从 `steps[id].error` 还原（已实现）。
- 坑5：测试 mock fetch 放行 loopback；node --test 每文件独立进程。

## Consequences

**变得更容易**：编排可观测（Mastra run 记录/OTel 接入点）、可单 step 重跑、HITL 有挂点；删巨石后满足 DoD「双 Director 合一 + 1000 行清单下降」；依赖树单一。

**变得更难/放弃的东西**：v2 需一次性显式化闭包数据流（约 2–4 天，其中 ctx 化占大头）；放弃「用成熟多智能体框架的协作语义」——本系统不需要；放弃 Python 生态（本系统本就不在 Python 上）。

**重新评估触发条件**：仅当产品需求变为「多个 LLM 角色就同一创作决策多轮协商」（如导演/编剧 agent 辩论分镜）时重开选型；届时优先评估 Node 侧方案（Mastra agent / 自研循环）而非引入 Python。

---

## Addendum（2026-09-05）：VideoClaw 评估 —— 维持 Mastra step 化，排除引入

**VideoClaw 家族定性**（已核实，2026-09 检索）：哈工大深圳 HITsz-TMG 开源 6 阶段系统、Synclip node 画布 SaaS、npm `videoclaw` CLI（Veo/Seedance/Runway provider），共性 = **成品端到端管线产品**（自带 UI/项目目录/产物/checkpoint 协议），非可嵌入的编排框架。

**对比结论**：对本仓库 Mastra step 化（v2）ROI 显著更高。依据：
- VideoClaw 仅覆盖本流水线前 ~60%（剧本→角色/场景→分镜→参考图→视频→合成），**不含**后段深度逻辑：bridge/action sequence、一致性阈值矩阵+重生成、continuity repair、TTS QA、lipsync、跨视频一致性、音画包装、后审编辑任务包、cost governance、人审队列、分润结算、resume-from-step 12 步链、workbench run 模型、state.json 字段协议。
- 引入形态必为 big-bang（数据模型冲突，桥接或全换二选一），687 测试护栏作废，商业闭环需在外部重建。
- v2 为引擎层增量替换（2–4 天、每批可停、契约/测试/产物全保留）。

**可借鉴（产品层，不引代码）**：VideoClaw 的「阶段产物可见可改 + WebUI 精调 + IM 集成」形态可作为本系统 P5 HITL 与交付体验的产品参照。

**重新评估触发**：仅当产品战略转向「放弃 QA/分润/人审闭环的一句话出片工具」时才重开本决策（属战略转向，非技术选型）。
