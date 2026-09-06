# docs/refactor — AI 漫剧系统重构需求文档集

> 更新：2026-09-04（v1.2 落 D1）　|　性质：**面向重构 Agent 的需求与设计说明书（as-is 证据版）**
> **决策 D1（主理人）**：运行入口只保留**项目模式**；兼容单文件模式（位置参数 `.txt` 直跑、`--script-file`/`--project-id` 透传、txt→临时 `legacy_project_*` 自动桥接、`temp/legacy_*` 平铺产物）**整体移除**。
> ⚠️ 两轴分离：D1 删的是“输入模式轴”；“编排实现轴”（legacy `director.js` = 项目模式默认编排 vs experimental `Director.js`）与之正交，由 T1/T2/P2 收敛——**删兼容输入 ≠ 删 legacy director**。

## 交付物

| 文件 | 内容 | 阅读对象 |
|---|---|---|
| `ai-video-factory-重构需求说明书.md` | 主文档：产品/架构/数据模型/编排/逐模块需求/Provider 域/QA/观测/非功能约束/技术债清单/目标架构映射/Mastra 坑/分阶段重构与验收 | 执行重构的 Agent |
| `README.md` | 本文档（概览 + DoD） | 项目主理人 / 重构负责人 |

## 主文档要点速览

- **系统**：输入既有 project/script/episode（项目模式）→ 十余个 AI Agent 编排 → 竖屏漫剧短视频，可观测可复盘、付费 API 前有多级闸门。
- **D1 输入面**：唯一入口 `run.js --project=… --script=… --episode=…`（`runEpisodePipeline`）；续跑 `resume-from-step.js --run-id=…`；`samples/*.txt` 等脚本文件需先落为项目数据。
- **现状关键事实**：
  1. 项目模式默认编排 = legacy `src/agents/director.js`（~3000 行，state.json 字段缓存）；`src/director/Director.js + src/pipeline/*` 是实验性 Stage/Checkpoint 框架，尚未接管默认（编排实现轴，独立于 D1 收敛）。
  2. run 包 = `temp/projects/p_*_*/.../runs/r_<ts>_<hash>/`，每 agent 目录 `NN-name/{manifest.json,0-inputs,1-outputs,2-metrics,3-errors}`；run 根有 `qa-overview/timeline/runtime-journal/state.snapshot`。
  3. Provider 域已实现“统一合同 → router → transport → 真实供应商”分层（视频三层语义 VIDEO_PROVIDER/TRANSPORT/MODEL_*），重构时该层最不该被框架绑架。
  4. QA 语义三段式 pass/warn/block、一致性双轴阈值矩阵、compose 视觉优先级、ID-first 绑定均为对外契约红线。
- **目标架构**：Mastra（编排/断点/存储/HITL）+ Vercel AI SDK（LLM 与结构化输出底座）；CrewAI 仅作 Python 子系统参考。含 Mastra v1.x 五个已知坑与规避设计（HITL 两段式、runId 重发、禁止嵌套 await run.start 等）。
- **建议顺序**：P0 契约冻结 → P1 LLM/Provider 底座 → P2 编排单轨化（**含 D1 收尾：删兼容单文件全链路**）→ P3 存储收敛 → P4 各 agent 逐迁 → P5 HITL/后处理 → P6 观测/计费/Workbench；每阶段以 `node --test` 聚焦集 + 冒烟 run 验收。

## DoD（重构最终验收，展开见主文档 11.6）

- [ ] 全量测试通过（含 artifacts / acceptance / e2e / resume 集）
- [ ] CLI / resume / run 包 / QA 报告契约测试通过（项目模式面；`runCli.test.js` legacy 用例已改写/移除）
- [ ] 真实样本按项目模式跑到目标停止点成功（先落项目，不直跑 txt）
- [ ] `.env.example` 无静默变更，契约变更进 CHANGELOG
- [ ] 双 Director（编排实现轴）合并为一（或显式废弃其一）
- [ ] 【D1】兼容单文件输入模式整体移除：run.js/resume 无 legacy 分支、`buildLegacyBridgeIdentity` 无调用方、不再产生 `temp/legacy_*` 平铺产物
- [ ] 大文件（>1000 行）清单下降；docs 漂移消除

## 备注 / 待办

- `views/`（UI，132 文件）本次仅确认存在，未逐文件核对；其与后端的 HTTP 契约须在 P6 阶段复核。
- 主文档“证据基线：以源码为主文档为辅”；若发现与最新代码不一致处，以代码为准并回改本文档。
- 兼容模式存量：既有 `temp/legacy_*` 旧 run 只读保留策略待定（见主文档 T2b）；`samples/*.txt` 剧本文件保留作“导入素材”而非直跑入口。
