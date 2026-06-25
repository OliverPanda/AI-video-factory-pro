# AI漫剧自动化生成系统 — 7月25日交付里程碑计划 v2

## Context

**当前日期**：2026年6月19日（周四）  
**目标交付日**：2026年7月25日（周五）  
**剩余自然日**：36天 | **剩余工作日**：约25天（扣除周末10天 + 预留1天缓冲）  
**当前分支**：`codex/postprocessing-loop`（7个commit领先origin，25个文件未提交）  
**产品定位**：AI驱动的漫剧短视频自动化生成系统，输入剧本→自动生成竖屏短视频

> ⚠️ **人力假设**：本计划假设 **2后端 + 1前端 + 1全栈QA**（共4人）。若为单人开发，建议将最终交付目标延至 **8月15日**，或大幅裁剪M2/M3范围仅交付审片台MVP（只读模式）。

---

## 当前状态与关键决策

### 各子系统成熟度

| 子系统 | 成熟度 | 关键文件 | 待解决问题 |
|--------|--------|----------|------------|
| 核心生产管线（30+ Agent） | ★★★★★ | `src/agents/director.js` (3959行) | 稳定 |
| 视频Provider架构 | ★★★★★ | `src/apis/videoAdapters.js` | 稳定 |
| 治理闭环（QA/成本/人审） | ★★★★☆ | `src/utils/costGovernance.js` | 已实现，需补端到端验收 |
| 前端 Workbench | ★★★★☆ | `views/src/` | Dashboard / Project / Asset / Settings 已落地；Editor 仍是原型 |
| 错误处理 & 配置管理 | ★★★★☆ | `src/utils/errors.js`、`src/utils/envConfigStore.js` | 已接入 Director / Settings；其余 Agent 仍需补齐统一接入 |
| 后处理闭环（4个Agent） | ★★★★☆ | 见下方详表 | 主体代码已落地，缺真实样本验收与前端消费 |
| 审片工作台 | ★☆☆☆☆ | `views/preview-review-workstation.html` | 仅静态HTML原型 |

### 后处理4个Agent当前状态

| Agent | 文件 | 当前行数 | 实际上写了什么 | 缺什么 |
|-------|------|----------|----------------|--------|
| `storyboardContextAgent` | `src/agents/storyboardContextAgent.js` | 22行 | 已调用 `storyboardContextMemory` domain，支持 context pack 与 artifacts 输出 | 缺真实样本验收、fixture 固化 |
| `crossVideoConsistencyAgent` | `src/agents/crossVideoConsistencyAgent.js` | 137行 | 已生成 report / markdown / metrics / QA summary | 缺真实样本回归、前端消费接口 |
| `avPackagingAgent` | `src/agents/avPackagingAgent.js` | 123行 | 已生成 packaging plan、metrics、QA summary | 缺真实混音/字幕落地消费 |
| `postComposeReviewAgent` | `src/agents/postComposeReviewAgent.js` | 177行 | 已生成 `post-compose-review.json` 与 `edit-task-pack.json` | 缺审片台读写链路与人工审批入口 |

### 关键决策（已确认）

1. ✅ **D1：审片台播放器** → **原生 `<video>` + 自定义控件**。Remotion仅保留给GoldCombo特效预览。

2. ✅ **D2：`edit-task-pack.json` Schema** → **直接使用现有 `src/domain/postComposeReview.js`** 中已定义的 `edit-task-pack.v1` schema。该domain model 488行，已包含完整的 Finding/Task/HumanReview 结构和8种动作类型。前后端以 `import { buildPostComposeReview } from '../domain/postComposeReview.js'` 为共同契约，无需新建文件。

3. ✅ **D3：部署目标环境** → **阿里云ECS + Caddy反向代理**（公网生产环境）。详细费用见下方[部署费用分析](#部署费用分析)。

4. ✅ **D4：E2E测试策略** → **生视频走Mock，其余走真实API**。视频生成是最大费用项（单次run ¥30-100），Mock可节省90%+测试成本。LLM/图像/TTS/口型调用费用低廉（单次run ¥5-15），使用真实API确保集成质量。

5. 🔴 **D5：人力配置** → 暂不讨论。

---

## 截至 2026-06-19 的已完成部分和功能点

> 说明：本节按“代码已落地”统计，不等于“全部验收已完成”。未专门跑通的项，仍需在对应里程碑补验证。

### 已完成的基础能力

- [x] 核心 Director 主链、Provider 抽象、Bridge / Sequence / TTS / Lipsync / Composer 主流程已存在
- [x] Workbench 首页、项目页、剧集页、设置页、资产库页已接入真实本地运行产物
- [x] 项目创建、剧本上传/编辑/删除、运行触发、SSE 运行状态订阅已落地
- [x] 运行模式已支持 `full / after_ref_sheets / after_images / before_video / continue / retry`
- [x] Settings 配置页、Provider 配置读写、批量预检、LLM 健康检查 API 已落地
- [x] Style Preset 选择器已接入，`views/public/style-presets/` 下已有 7 张预览图素材
- [x] 资产库页已接入角色注册表与一致性报告富化展示
- [x] 错误友好化已具备基础能力：`formatRunError()`、前端 `translateError()`、SSE run stream

### 已完成的后处理闭环能力

- [x] `storyboardContextAgent` 已接入 `storyboardContextMemory` domain，并可写出 artifacts
- [x] `crossVideoConsistencyAgent` 已生成 report / markdown / metrics / QA summary
- [x] `avPackagingAgent` 已生成 packaging plan / metrics / QA summary
- [x] `postComposeReviewAgent` 已生成 `post-compose-review.json`、`edit-task-pack.json`
- [x] `director.js` 已串入 4 个后处理步骤，且 `runArtifacts` 中已有对应 agent 目录命名
- [x] 后处理相关测试已存在：`storyboardContextMemory.test.js`、`crossVideoConsistency.test.js`、`avPackagingPlan.test.js`、`postComposeReview.test.js`、`postProcessingLoop.e2e.test.js`

### 已经明确但仍是原型/只读的部分

- [x] 审片工作台已有静态原型：`views/preview-review-workstation.html`
- [x] Editor 页面已存在，但当前仍使用硬编码示例图和 `/api/storyboard/render` 原型接口
- [x] Character / Scene / Voice 管理页已改为真实产物展示，但当前仍为只读

---

## 当前未完成功能点与按时段开发排期（勾选版）

### M0：基础稳固（6月19日 → 6月23日）

- [ ] 清理并拆分当前未提交改动，整理为可推送的独立 commit
- [x] Settings CRUD、Provider 预检、SSE run stream、继续运行/重试模式代码已落地
- [x] `edit-task-pack` 契约已确定复用 `src/domain/postComposeReview.js`
- [ ] 跑完并记录 M0 基线测试结果，形成“通过/遗留/需外部依赖”清单
- [ ] 统一确认 `.env`、FFmpeg、`views/` dev server、静态资源代理路径可用

### M1：后处理闭环（6月24日 → 6月28日）

- [x] 4 个后处理 Agent 代码与产物输出已落地
- [x] Director 已串入后处理步骤
- [ ] 补一轮真实样本验收，确认 4 份 JSON 产物结构可稳定消费
- [ ] 产出 `tests/fixtures/post-processing/` mock 数据，供 M2 前端直接联调
- [ ] `resume-from-step` 仍未支持 `post-review` / `cross-consistency` 级别恢复，需补
- [ ] 补 `pipeline.acceptance.test.js` 对后处理步骤的断言结果

### M2：审片工作台（7月1日 → 7月8日）

- [ ] 新增 review 后端 API：`/api/runs/:id/review`
- [ ] 新增 review 后端 API：`/api/runs/:id/review/clips`
- [ ] 新增 review 后端 API：`/api/runs/:id/review/tasks/:taskId`
- [ ] 新增 review 后端 API：`/api/runs/:id/review/video`
- [ ] 注册 React 路由 `/review/:runId`
- [ ] 落地 `PreviewReviewPage`
- [ ] 落地 `PreviewTopbar`
- [ ] 落地 `TimelineNavigator`
- [ ] 落地 `PreviewPlayerPanel`
- [ ] 落地 `FindingInspector`
- [ ] 落地 `EditTaskDrawer`
- [ ] 在 `DramaDetail.tsx` / `ProjectDetail.tsx` 增加“审片”入口

### M3：编辑器与资产管理（7月9日 → 7月14日）

- [ ] 重写 `Editor.tsx`，去掉 Unsplash 示例数据与原型接口依赖
- [ ] 新增 storyboard 读取 API
- [ ] 新增 shot 编辑 API
- [ ] 新增 character 编辑 API
- [ ] 新增 scene 编辑 API
- [ ] 新增 voice 编辑 API
- [ ] CharacterManager 从只读升级为可编辑
- [ ] SceneManager 从只读升级为可编辑
- [ ] VoiceManager 从只读升级为可编辑
- [x] Style Preset 图片素材已就位
- [ ] Style Preset 规格仍需统一到最终格式要求（当前仓库为 `.png`，计划目标为 `.webp`）
- [ ] 视时间决定是否拆分 `src/workbench/http/router.js`

### M4：集成联调与打磨（7月15日 → 7月21日）

- [ ] 后端 E2E 补后处理断言并跑通
- [ ] 前端关键路径 E2E（Dashboard → ProjectDetail → DramaDetail → Review）
- [ ] 真实 API 联调 1-2 次（视频继续 Mock）
- [x] 错误友好化基础能力已落地
- [ ] 其余 Agent 补齐统一错误接入与前端展示
- [ ] 审片视频静态流支持 `Range 206`
- [ ] 做一轮 P0 / P1 Bug Bash 清零

### M5：上线交付（7月22日 → 7月25日）

- [ ] 补齐 `README.md` 的后处理闭环、审片工作台、部署说明
- [ ] 完成 `docs/user-guide.md`
- [ ] 完成 `docs/deployment.md`
- [ ] 完成 `docs/limitations-v1.md`
- [ ] 完成 `CHANGELOG.md`
- [ ] 跑完 3 个 UAT 剧本并逐项打勾
- [ ] 打 `v1.0.0` tag
- [ ] 产出 Demo 视频

---

## 里程碑总览

```
 6/19 ─── 6/23      6/24 ── 6/28       7/1 ──── 7/8        7/9 ──── 7/14       7/15 ─── 7/21       7/22 ─ 7/25
 [M0] 基础稳固    [M1] 后处理闭环     [M2] 审片工作台    [M3] 编辑器与资产    [M4] 集成打磨     [M5] 上线
   3工作日           4工作日              5工作日             5工作日              5工作日           3工作日
                     ↑ domain model已完成                  ↑ M2-M3并行开发接口
                     (验证为主，非从零开发)                   └─ 7/9前定义完成
```

### 依赖关系与缓冲

```
M0 ──► M1 ──► M4（E2E后端部分）
  │      │
  │      └──► M2 ──► M4（E2E前端部分）
  │               │
  └───────────────┴──► M3 ──► M4
                              │
                              └──► M5
```

- M1 末尾（6/27-6/28）产出 **真实管线产物**（视频Mock，其余真实） 给M2前端并行开工
- M2 和 M3 由不同人并行执行（前端M2 + 后端M3 API）
- M4 包含两天的 **合并缓冲期**（7/19-7/21），消化前序延迟
- 若M1延迟超过2天，M2自动切换为"只读审片台"（MVP模式），不实现编辑交互

---

## M0：基础稳固（6月19日 → 6月23日，3个工作日）

### 目标
收拢所有进行中工作到稳定基线，定义核心数据契约，扫清后续冲刺障碍。

### T0.1 代码基线整合
- 逐个审查25个未提交文件，按关注点拆分为独立commit：
  - `feat: error friendly translation + env config store`
  - `feat: SSE run streaming endpoint`
  - `feat: settings CRUD + provider precheck API`
  - `feat: project creation modal + style presets`
  - `feat: asset library page`
  - `feat: episode repair + retry/continue run modes`
  - `fix: router cleanup + migration guards`
- 每个commit后运行相关测试，确保不引入回退
- Push `codex/postprocessing-loop` 到 origin

### T0.2 测试基线确认
- 区分两类测试的运行策略：

| 测试类型 | 命令 | 预期 | 使用真实API？ |
|----------|------|------|---------------|
| 纯单元测试 | `node --test tests/errors.test.js tests/consistencyQaPolicy.test.js tests/costGovernance.test.js ...` | 全绿 | 否 |
| Agent+Domain测试 | `node --test tests/storyboardContextAgent.test.js ...` | 全绿 | 否（走Mock，验证逻辑） |
| 管线验收测试 | `node --test tests/pipeline.acceptance.test.js` | 全绿 | 否（全Mock，包括视频） |
| 后处理真实API验证 | M1末尾 1次 | 全链路产物完整 | **是**（LLM/图像/TTS/口型真实，**视频Mock**） |
| Agent生产测试 | `npm run test:<agent>:prod`（按需） | 按需 | **是**（部分） |

- 记录当前测试失败清单（如有），标注"本次修复"vs"已知遗留"vs"需Provider配合"
- **关键**：`pipeline.acceptance.test.js` 必须全绿——它用DI Mock所有外部依赖，不依赖任何Provider

### T0.3 数据契约确认（本里程碑关键产出）
- ✅ **不需要新建domain model文件**：调研发现4个后处理domain model已经非常完整
- **确认 `edit-task-pack.json` Schema**：已在 `src/domain/postComposeReview.js` 中定义（`edit-task-pack.v1`）
- **验证产物结构完整性**：逐一确认4个build函数的输出JSON结构，确保可被前端无歧义消费
- **发现并记录**：如果在验证中发现字段缺失/不一致，记录到M1修复清单

### T0.4 环境与依赖验证
- 确认 `.env` 所有Provider连通性（使用新增的 `/api/health/llm` endpoint）
- 确认 FFmpeg ≥ 5.0 可用，`sharp` 正常处理图片
- 确认 `views/` 可独立 `pnpm install && pnpm dev` 启动
- 确认前端proxy到workbench server正常（`/api`、`/temp`、`/output` 路径可达）

### T0.5 技术决策确认（全部已完成）
- ✅ **审片台播放器**：原生 `<video>` + 自定义控件（非Remotion Player）
- ✅ **前端路由**：`/review/:runId` 为独立全屏页面（无Sidebar Layout），类似 `/editor`
- ✅ **edit-task-pack Schema**：直接使用 `src/domain/postComposeReview.js` 中 `edit-task-pack.v1`
- ✅ **部署架构**：阿里云ECS + Caddy反向代理（见费用分析）
- ✅ **E2E策略**：生视频Mock，其余真实API

### 完成标准（可验证的）

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | 未提交文件已拆分为≤8个commit并推送 | `git log --oneline -10` |
| 2 | `tests/pipeline.acceptance.test.js` 全绿 | `node --test tests/pipeline.acceptance.test.js` |
| 3 | `src/domain/postComposeReview.js` 和 `editTaskPack.js` 存在且可import | `node -e "import './src/domain/editTaskPack.js'"` |
| 4 | `.env` 所有Provider健康检查通过 | `curl http://127.0.0.1:4180/api/health/llm` |
| 5 | 4个关键决策已记录结论 | plan文档底部"决策记录"表 |

---

## M1：后处理闭环核心（6月24日 → 6月28日，4个工作日）

> ⚠️ **关键发现（6/19调研）**：4个后处理 domain model 实际上已经非常完整——
> `storyboardContextMemory.js` 1387行、`crossVideoConsistency.js` 959行、
> `avPackagingPlan.js` 430行、`postComposeReview.js` 488行。
> Agent文件之所以小（22-177行），是**有意设计成薄封装层**（domain model + 文件IO）。
> M1不需要"从零写逻辑"，而是**验证集成、补测试、串入Director**。

### 目标
验证后处理闭环的 domain→agent→director 链路完整可用，补齐测试覆盖，产出mock数据供M2前端开工。

### 前置条件
- M0 T0.3 已完成（确认domain model schema，无需新建）

### T1.1 验证 Storyboard Context Memory 链路
**当前**：domain model 1387行 ✅ | agent 23行 ✅（调用domain + 写制品）  
**M1动作**：
- 验证 `buildStoryboardContext()` 产物结构（用 `samples/test_script.txt` 的6个分镜输入）
- 验证场景分组、角色出场链、道具追踪、情绪弧线四个维度输出正确
- 验证 `buildDirectorContextPack()` 的Token预算控制逻辑
- 确认agent写制品路径与 `runArtifacts.js` 布局一致
- 编写/扩展单元测试 ≥6个（重点：边界+冲突检测+去重压缩）

### T1.2 验证 Cross-Video Consistency Checker 链路
**当前**：domain model 959行 ✅ | agent 137行 ✅（框架完整）  
**M1动作**：
- 验证7个检查维度（character_drift/scene_drift/pose_mismatch/reference_gap/bridge_coverage_gap/lipsync_risk/insufficient_evidence）
- 验证 HappyHorse 专项检查逻辑
- 验证判定结果与 `consistencyQaPolicy.js` 规则体系一致
- 确认agent制品写入正确
- 编写/扩展单元测试 ≥6个

### T1.3 验证 AV Packaging Agent 链路
**当前**：domain model 430行 ✅ | agent 123行 ✅（BGM/SFX/字幕均已实现）  
**M1动作**：
- 验证BGM映射规则表覆盖所有情绪关键词
- 验证字幕样式与lighting反色关系
- 验证SFX cue生成（sword/impact/transition）
- 确认agent制品写入正确
- 编写/扩展单元测试 ≥6个

### T1.4 验证 Post-Compose Review Agent 链路
**当前**：domain model 488行 ✅ | agent 177行 ✅（聚合+任务生成+人审路由均实现）  
**M1动作**：
- 验证多QA报告聚合去重逻辑（shotQa/bridgeQa/sequenceQa/lipsync/crossVideo/avPackaging/costGovernance 共7个源）
- 验证任务优先级排序（blocker > high > warn > info）
- 验证人审路由规则（高风险+高成本→HumanReviewQueue，低风险→pending_approval，info→仅记录）
- 确认 `edit-task-pack.json` 产物结构符合schema
- 编写/扩展单元测试 ≥8个

### T1.5 Director集成（核心任务）
- 确认 `director.js` 中 videoComposer之后 是否正确串入4个后处理步骤
- 确认状态缓存（state.json）覆盖后处理产物引用
- 确认 `resume-from-step.js` 支持 `--step=post-review` 和 `--step=cross-consistency`
- 运行 `pipeline.acceptance.test.js` 验证集成不破坏现有管线

### T1.6 Mock数据产出（6月27-28日，供M2前端并行开工）
- 基于 `samples/test_script.txt` 跑一次真实管线（除视频走Mock），产出完整后处理文件
- 放置于 `tests/fixtures/post-processing/`，M2前端直接fetch

### 完成标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | 4个后处理Agent链路验证通过，产物JSON结构合法 | `node -e "JSON.parse(fs.readFileSync(...))"` + domain model校验 |
| 2 | 4个Agent的单元测试 ≥24个用例全绿 | `node --test tests/storyboardContextAgent.test.js ...` |
| 3 | Director集成后 `pipeline.acceptance.test.js` 全绿（含后处理步骤断言） | `node --test tests/pipeline.acceptance.test.js` |
| 4 | `resume-from-step --step=post-review` 可正常恢复 | 中断一次run后resume验证 |
| 5 | Mock数据6个JSON文件就位，workbench server可serve | `curl` mock数据路径返回200 |

---

## M2：审片工作台（7月1日 → 7月8日，5个工作日）

### 目标
将静态HTML原型升级为React页面，接入真实数据。

### 前置条件
- M1 Mock数据已就位（`tests/fixtures/post-processing/`）
- M0已确认播放器技术选型（原生video标签）和路由方式（独立全屏页面）

### T2.1 后端API新增

| 方法 | 路径 | 功能 | 返回数据 |
|------|------|------|----------|
| GET | `/api/runs/:id/review` | 获取审片数据 | 聚合 post-compose-review + edit-task-pack |
| GET | `/api/runs/:id/review/clips` | 获取时间线片段列表 | shots + sequences + bridges + audioPackages，含时间区间和风险标记 |
| PUT | `/api/runs/:id/review/tasks/:taskId` | 更新任务审批状态 | `{ status: "approved" \| "skipped" \| "manual_review" }` → 200 |
| GET | `/api/runs/:id/review/video` | 视频文件流 | `final.mp4` 的静态文件路径（Range请求支持seek） |

### T2.2 前端组件创建（按依赖顺序）

| 顺序 | 组件 | 职责 | 数据源 | 关键交互 |
|------|------|------|--------|----------|
| 1 | `PreviewReviewPage` | 页面容器，四区flex布局 | URL param `:runId` | 管理全局状态（当前选中clip、当前播放时间） |
| 2 | `PreviewTopbar` | 顶栏：项目名/Run状态/成本/操作按钮 | `/api/runs/:id/review` | "发起复查"按钮触发刷新；状态badge联动 |
| 3 | `TimelineNavigator` | 左侧片段树，筛选+搜索 | `/api/runs/:id/review/clips` | 筛选pills（shot/sequence/bridge/audio），点击通知Player跳转 |
| 4 | `PreviewPlayerPanel` | 中间播放器+时间轴 | `/api/runs/:id/review/video` | 原生`<video>`+自定义控件；时间轴风险标记；seek联动Navigator |
| 5 | `FindingInspector` | 右侧问题面板 | `review.findings[]` | 展示当前clip的Findings；推荐动作按钮→加入EditTaskDrawer |
| 6 | `EditTaskDrawer` | 底部任务抽屉 | `edit-task-pack` | 任务卡片列表；Approve/Skip/ManualReview三按钮；调用PUT API |

**状态管理**：页面级React Context `ReviewContext` 持有：
```typescript
{
  selectedClipId: string | null,
  currentTimeSec: number,
  filterMode: 'all' | 'shot' | 'sequence' | 'bridge' | 'audio' | 'blocked' | 'warn',
  searchQuery: string,
  editTasks: EditTask[],
  drawerOpen: boolean,
}
```

### T2.3 核心交互链路（5个Given-When-Then验收场景）

**场景A：点击片段→播放器跳转**
```
Given 审片台加载完成，左侧显示6个shot片段
When  用户点击第3个shot卡片
Then  播放器跳转到该shot的startTime
And   左侧第3个shot卡片高亮
And   右侧FindingInspector显示该shot关联的Findings
```

**场景B：播放器时间变化→左侧高亮同步**
```
Given 用户正在播放视频
When  播放时间进入第4个shot的时间区间
Then  左侧第4个shot卡片自动高亮
And   右侧FindingInspector自动切换为第4个shot的Findings
```

**场景C：选择推荐动作→加入任务抽屉**
```
Given 右侧FindingInspector显示shot_003的blocker级别Finding
When  用户点击"regenerate_shot"推荐动作
Then  底部EditTaskDrawer弹出
And   新任务卡片显示action=regenerate_shot, target=shot_003, status=pending_approval
And   任务计数+1
```

**场景D：审批通过→状态更新**
```
Given 底部EditTaskDrawer中有3个任务
When  用户点击第2个任务的"Approve"按钮
Then  第2个任务状态变为approved
And   后端PUT /api/runs/.../tasks/task_002 调用成功
```

**场景E：视频加载失败→错误提示**
```
Given 审片台页面已加载
When  视频文件无法访问（404/网络错误）
Then  播放器区域显示友好错误提示"无法加载成片视频"
And   提示中包含"查看Artifact"链接
```

### T2.4 路由与导航
- 在 `main.tsx` 注册路由 `/review/:runId`（独立全屏，无Layout/Sidebar）
- 从 `DramaDetail.tsx` 的已完成run添加"审片"入口按钮（仅当postComposeReview产物存在时可用）
- 从 `ProjectDetail.tsx` 的已完成run列表添加"审片"链接

### 完成标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | 5个GWT验收场景全部通过 | 手动测试 + 截图 |
| 2 | 所有数据来自API（非硬编码） | Chrome DevTools Network面板确认 |
| 3 | 空白/错误/加载中三态均有UI处理 | 模拟空数据、API超时、视频404 |
| 4 | 审批操作可写回并持久化（刷新页面状态保留） | PUT后重新GET验证 |
| 5 | 播放器支持seek（HTTP 206 Range请求） | DevTools确认Range请求返回206 |

---

## M3：编辑器与资产管理（7月9日 → 7月14日，5个工作日）

### 目标
补齐剩余原型/只读功能，形成完整闭环。**后端API开发（T3.1-T3.2）与前端实现可并行进行。**

### T3.1 Storyboard Editor 真实实现
**当前问题**：`Editor.tsx` 使用硬编码Unsplash数据，调用不存在的 `/api/storyboard/render`

**后端API新增**：
| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/projects/:id/scripts/:sid/episodes/:eid/storyboard` | 返回分镜编辑数据（shots + scenes + characters） |
| PUT | `/api/projects/:id/scripts/:sid/episodes/:eid/shots/:shotId` | 编辑单个分镜字段（dialogue/emotion/cameraType/scene/durationSec） |

**前端重写 `Editor.tsx`**：
- 从API加载分镜数据
- 拖拽排序（复用已安装的 `@dnd-kit`）
- 内联编辑shot字段（点击字段→输入框→失焦保存或Enter确认）
- 乐观更新：先更新UI，后台同步；失败回滚+toast提示

### T3.2 资产编辑API
| 方法 | 路径 | 功能 |
|------|------|------|
| PUT | `/api/projects/:id/scripts/:sid/episodes/:eid/characters/:charId` | 编辑角色属性 |
| PUT | `/api/projects/:id/scripts/:sid/episodes/:eid/scenes/:sceneId` | 编辑场景属性 |
| PUT | `/api/projects/:id/scripts/:sid/episodes/:eid/voices/:voiceId` | 编辑配音配置 |

**前端页面改造**：
- `CharacterManager.tsx`：添加编辑按钮→内联表单→PUT保存（移除"只读"提示）
- `SceneManager.tsx`：同上
- `VoiceManager.tsx`：同上

### T3.3 Style Preset 素材
**规格要求**：
- 尺寸：800×450 px，WebP格式
- 内容：7个风格各一张代表性预览图（写实摄影/日系动漫/美漫/国风水墨/3D渲染/油画/赛博朋克）
- 生成方式：使用本项目的 `ImageGenerator` 生成（Prompt = 风格关键词 + "sample scene from a vertical short drama, 9:16 aspect ratio"）
- 存放位置：`views/public/style-presets/`

**验收**：CreateProjectModal中选择风格时图片正常显示（非404）

### T3.4 Router拆分重构（可选，视时间决定）
- 当前 `router.js` 1525行，新增6-7个endpoint后将达2000+行
- 如时间允许：将router按领域拆分为 `routes/projects.js`、`routes/scripts.js`、`routes/runs.js`、`routes/review.js`、`routes/settings.js`
- 如时间不允许：不做拆分，在M5 known-limitations中标记"router待重构"

### 完成标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | Editor页面从API加载真实分镜数据 | Network面板确认无Unsplash调用 |
| 2 | 分镜编辑保存后重新加载数据保留修改 | 编辑→刷新页面→数据仍为修改后 |
| 3 | CharacterManager/SceneManager/VoiceManager均支持编辑 | 各页面存在编辑按钮且PUT成功 |
| 4 | 7个Style Preset图片在 `/style-presets/` 下可访问 | 浏览器直接访问返回200 |
| 5 | 乐观更新失败时UI回滚+toast提示 | 模拟PUT 500→确认UI回滚 |

---

## M4：集成联调与打磨（7月15日 → 7月21日，5个工作日）

### 目标
端到端集成测试、Bug修复、性能优化。

### T4.1 分层E2E测试

**后端E2E（M1完成后即可开始，不依赖M2/M3）**：
- 扩展 `pipeline.acceptance.test.js` 覆盖后处理步骤
- 验证：剧本→分镜→...→视频→后处理→edit-task-pack.json 产物完整
- 使用DI Mock所有外部依赖（不消耗API费用）

**前端E2E（M2+M3完成后）**：
- 编写前端关键路径测试：Dashboard → ProjectDetail → DramaDetail → Review → 审批任务
- 可使用 Playwright 或 Cypress（视团队偏好）

**真实API E2E（M4后半段，限2次完整run + 视频Mock）**：
- 使用 `samples/test_script.txt`（6个分镜）跑完整管线
- LLM/图像/TTS/口型走真实API，**视频生成走Mock**
- **费用控制**：每次run约¥10-15，整个M4真实API费用 ≤ ¥50

### T4.2 Bug Bash
- 产品+开发+QA各手动跑一轮完整流程
- Bug分级：

| 等级 | 定义 | 处理策略 |
|------|------|----------|
| P0 | 阻断主流程（run失败、页面白屏、API 500） | **必须全部修复** |
| P1 | 影响体验（显示异常、交互不顺畅、边缘情况崩溃） | **必须全部修复**（v1去掉了"80%"目标） |
| P2 | 优化建议（文案调整、样式微调、加载速度） | 视时间修，不修记录到known-limitations |

### T4.3 错误处理统一接入
- 所有Agent的异常捕获统一使用 `formatRunError()`（`src/utils/errors.js`）
- 确保失败的run-job的 `error` 字段包含友好描述（而非裸stack trace）
- 前端统一错误处理：
  - API错误 → `friendlyError()` 翻译为中文 → toast提示
  - SSE断开 → 自动重连（EventSource重连 ≤5次，间隔 1s/2s/4s/8s/16s，4xx不重试）
  - 网络不可用 → "网络连接异常，请检查网络后重试"

### T4.4 性能优化
| 指标 | 目标 | 测量方式 |
|------|------|----------|
| Dashboard首屏加载 | < 3s（Fast 3G模拟） | Chrome DevTools Lighthouse |
| 片段列表 >50个shot | 渲染不阻塞，滚动流畅 | React DevTools Profiler |
| 视频静态服务 | 支持HTTP 206 Range请求 | `curl -H "Range: bytes=0-1024"` 返回206 |
| 审片台视频加载 | 首次缓冲 < 2s | 手动计时 |

### 完成标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | 后端E2E（Mock模式）全绿 | `node --test tests/pipeline.acceptance.test.js` |
| 2 | P0 Bug清单为空 | Bug跟踪工具确认 |
| 3 | P1 Bug清单为空 | Bug跟踪工具确认 |
| 4 | 各Agent失败时run-job error字段友好可读 | 手动触发一个失败run，读取error字段 |
| 5 | Lighthouse Performance Score ≥ 80 | Chrome DevTools |

---

## M5：上线交付（7月22日 → 7月25日，3个工作日）

### 目标
文档、UAT、发布。

### T5.1 文档（分散到前期编写，M5只做终审）

| 文档 | 负责阶段 | M5动作 |
|------|----------|--------|
| `docs/user-guide.md` | M4起草稿 | 终审+截图更新 |
| `docs/deployment.md` | M0起草稿 | 按实际部署环境验证并更新 |
| `docs/limitations-v1.md` | M3起草稿 | 终审+补充遗漏 |
| `CHANGELOG.md` | M5 | 基于git log生成 |
| `docs/agents/` 增量 | 各阶段随开发写 | 终审 |
| `README.md` | M5 | 补充后处理闭环+审片工作台+部署说明 |

### T5.2 用户验收测试
准备3个不同复杂度的测试剧本：

| 剧本 | 复杂度 | 分镜数 | 角色数 | 验收重点 |
|------|--------|--------|--------|----------|
| 剧本A | 简单 | 4-6个 | 2个 | 基础管线：上传→分镜→角色→成片，全程无阻断 |
| 剧本B | 中等 | 10-15个 | 3-4个 | 多角色协调、转场镜头、一致性检查不误报 |
| 剧本C | 复杂 | 20-25个 | 5-6个 | 复杂剧情、多场景、后处理闭环、审片台审批 |

UAT Checklist（每个剧本通用）：
- [ ] 剧本上传 → 解析成功，分镜数正确
- [ ] 角色档案生成 → 每个角色有完整的视觉档案
- [ ] 分镜图生成 → 风格一致，无明显崩坏
- [ ] 配音 + 口型 → 同步准确，无明显音画错位
- [ ] 视频合成 → final.mp4 可正常播放
- [ ] 后处理 → 四份产物JSON全部生成
- [ ] 审片工作台 → 片段列表无遗漏，Findings可定位到具体shot
- [ ] 任务审批 → Approve/Skip/ManualReview按钮功能正常

### T5.3 发布
- Git tag `v1.0.0`
- 前端 `pnpm build`，产出 `views/dist/` 静态文件
- 确认 `.env.example` 与实际 `.env` 一致
- 录制3分钟Demo视频（录屏：项目创建→剧本上传→触发run→审片→审批）

### 完成标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | 3个UAT剧本全部通过 | UAT Checklist逐项打勾 |
| 2 | 按部署手册操作，新环境可在合理时间内跑通 | 找一位非本项目开发者按文档操作 |
| 3 | `v1.0.0` tag + CHANGELOG | `git tag -l` |
| 4 | Demo视频完成 | 文件存在且可播放 |
| 5 | 所有文档终审通过 | 项目负责人签字确认 |

---

## 部署费用分析

> ⚠️ 以下价格为2026年6月市场参考价，实际以阿里云/腾讯云官网当日为准。所有价格均为**中国大陆地域**（杭州/上海/广州）。

### 云服务器 ECS/CVM 对比

| 规格 | 阿里云 ECS | 腾讯云 CVM | 说明 |
|------|-----------|-----------|------|
| 2vCPU 4GB 40GB SSD 3Mbps | **¥204/月**（包年）或 ¥0.47/时 | ¥210/月（包年）或 ¥0.49/时 | 够用，适合日均 <20次run |
| 4vCPU 8GB 80GB SSD 5Mbps | **¥408/月**（包年）或 ¥0.94/时 | ¥420/月（包年）或 ¥0.98/时 | **推荐**，留FFmpeg合成余量 |
| 8vCPU 16GB 160GB SSD 8Mbps | ¥816/月（包年）或 ¥1.88/时 | ¥840/月（包年）或 ¥1.96/时 | 高频使用（日均>50次run） |

**推荐：阿里云 4vCPU 8GB 80GB SSD 5Mbps，¥408/月**。理由：FFmpeg视频合成是CPU密集型操作，2核可能成为瓶颈；且阿里云与项目已有的DashScope（Qwen）、MiniMax等服务在同一生态，网络延迟更低。

### 对象存储 OSS/COS 对比（用于视频/图片制品）

| 项目 | 阿里云 OSS | 腾讯云 COS | 月估算（100次run产出） |
|------|-----------|-----------|----------------------|
| 存储 | ¥0.12/GB/月 | ¥0.118/GB/月 | ~¥6（按50GB存量） |
| 外网下载 | ¥0.50/GB | ¥0.50/GB | ~¥50（按100GB/月） |
| CDN加速 | ¥0.24/GB | ¥0.21/GB | ~¥24（按100GB/月） |
| **OSS月费合计** | — | — | **~¥80/月** |

> 制品产出后建议30天自动过期删除，控制存储成本。每次run的制品（图片+音频+视频）约200-500MB。

### 各Provider API费用（核心运营成本）

| Provider | 服务 | 单价 | 单次run用量 | 单次run费用 |
|----------|------|------|-------------|-------------|
| DeepSeek | LLM文本调用 | ¥0.001/1K input + ¥0.002/1K output | ~60K tokens | ~**¥0.10** |
| Qwen-VL-Max | 视觉一致性检查 | ¥0.003/1K input | ~20K tokens + 6图 | ~**¥0.15** |
| Together AI / Stability | 图像生成 | ~¥0.30/张 | 6张 + 可能回锚重生成 | ~**¥2-5** |
| MiniMax / CosyVoice | TTS配音 | ¥0.015/千字 | ~500字 + 6段音频 | ~**¥0.20** |
| 口型API | Lipsync | ¥0.50-2/段 | 4-6段（仅对白shot） | ~**¥3-8** |
| ~~视频生成~~ | — | **Mock** | 0 | **¥0** |
| **合计（不含视频）** | — | — | — | **~¥5-14/run** |

### 月度总费用估算

| 场景 | 月run量 | 服务器 | OSS | API | **月总计** |
|------|---------|--------|-----|-----|-----------|
| 轻度使用 | 30次 | ¥204 | ¥40 | ¥210-420 | **¥454-664** |
| 中度使用（推荐规格） | 100次 | ¥408 | ¥80 | ¥700-1400 | **¥1,188-1,888** |
| 重度使用 | 300次 | ¥816 | ¥200 | ¥2100-4200 | **¥3,116-5,216** |

### 开发阶段费用

| 阶段 | API调用 | 估算 |
|------|---------|------|
| M0-M4 日常开发 | Mock为主，真实API验证 2次 | ¥30-50 |
| M4 集成E2E | 1次全链路真实API（不含视频） | ¥10-15 |
| M5 UAT | 3个剧本各1次（A简单/B中等/C复杂） | ¥50-100 |
| **开发阶段合计** | — | **~¥90-165** |

### 阿里云 vs 腾讯云选择建议

| 维度 | 阿里云 | 腾讯云 |
|------|--------|--------|
| ECS价格 | 略优（包年9折左右） | 持平 |
| 与项目生态匹配 | ✅ DashScope/Qwen/MiniMax同生态 | ❌ 无相关服务 |
| FFmpeg支持 | ✅ 镜像市场有预装方案 | ✅ 同样支持 |
| Caddy部署 | ✅ 标准Linux部署 | ✅ 标准Linux部署 |
| 新用户优惠 | 通常有3-6个月免费试用 | 通常有1-3个月 |

**最终推荐：阿里云 ECS 4vCPU 8GB + OSS + Caddy**。核心优势是已有Provider服务（Qwen/DashScope）在同一账号体系，网络延迟更低，且与项目技术栈匹配度最高。

---

## 风险与降级策略

| # | 风险 | 概率 | 影响 | 降级方案 |
|---|------|------|------|----------|
| R1 | M1后处理Agent逻辑需大量返工 | 低 | 中 | domain model已完成3264行核心逻辑（storyboardContext 1387 + crossVideo 959 + avPackaging 430 + postComposeReview 488），agent只是薄封装。实际工作为验证+集成+补测试 |
| R2 | M2审片台前端工作量超预期 | 高 | 高 | **M2自动降级为"只读审片台"（MVP模式）**：去掉EditTaskDrawer编辑功能，去掉任务审批交互，仅保留"片段导航→播放→查看Findings"的只读浏览功能。编辑交互推迟到v1.1 |
| R3 | 某个Provider API不可用 | 中 | 中 | 利用现有多Provider fallback架构切换。如全部视频Provider不可用，审片台使用静态图slideshow模式 |
| R4 | M0未提交代码合并冲突 | 低 | 中 | 渐进式commit，每个关注点独立提交 |
| R5 | LLM输出格式不稳定 | 中 | 中 | 复用 `chatJSON()` 的 retry + schema validation 模式；关键字段加fallback默认值 |
| R6 | API费用超预算 | 低 | 中 | 视频生成占费用90%+，已Mock；其余API单次run仅¥5-14。开发阶段总预算¥100-200 |
| R7 | 人力不足 | 未评估 | 高 | D5暂缓讨论，计划暂按多人协作编写。若最终单人开发需重新排期 |

---

## 决策记录

| # | 决策项 | 状态 | 结论 | 决策日期 |
|---|--------|------|------|----------|
| D1 | 审片台播放器技术选型 | ✅ 已决 | 原生 `<video>` + 自定义控件 | 6/19 |
| D2 | `edit-task-pack.json` Schema | ✅ 已决 | 直接使用现有 `src/domain/postComposeReview.js` 的 `edit-task-pack.v1` schema | 6/19 |
| D3 | 部署目标环境 | ✅ 已决 | 阿里云ECS + Caddy反向代理（详见费用分析） | 6/19 |
| D4 | E2E测试API调用策略 | ✅ 已决 | 生视频走Mock（最大费用项），其余走真实API | 6/19 |
| D5 | 人力配置确认 | ⏸️ 暂缓 | 待后续讨论 | — |

---

## 附录：关键文件清单

### 本计划涉及的新增/修改文件

**M0（数据契约与决策实施）**：
- 确认：`src/domain/postComposeReview.js`（488行，schema已定义，作为edit-task-pack共同契约）
- 确认：`src/domain/storyboardContextMemory.js`（1387行，完整）
- 确认：`src/domain/crossVideoConsistency.js`（959行，完整）
- 确认：`src/domain/avPackagingPlan.js`（430行，完整）
- 无需新建domain model文件

**M1（后处理Agent — 验证+集成+补测试）**：
- 验证：`src/agents/storyboardContextAgent.js`（23行，调用domain model的薄封装）
- 验证：`src/agents/crossVideoConsistencyAgent.js`（137行）
- 验证：`src/agents/avPackagingAgent.js`（123行）
- 验证：`src/agents/postComposeReviewAgent.js`（177行）
- 修改：`src/agents/director.js`（确认/补全后处理步骤集成）
- 修改：`scripts/resume-from-step.js`（新增 `--step=post-review` 和 `--step=cross-consistency`）
- 新增/扩展测试：
  - `tests/storyboardContextAgent.test.js`
  - `tests/crossVideoConsistencyAgent.test.js`
  - `tests/avPackagingAgent.test.js`
  - `tests/postComposeReviewAgent.test.js`
- 新增Mock数据：`tests/fixtures/post-processing/`（6个JSON文件）

**M2（审片工作台）**：
- 修改：`src/workbench/http/router.js`（新增4个review endpoint）
- 新增：`views/src/pages/PreviewReviewPage.tsx`
- 新增：`views/src/components/review/PreviewTopbar.tsx`
- 新增：`views/src/components/review/TimelineNavigator.tsx`
- 新增：`views/src/components/review/PreviewPlayerPanel.tsx`
- 新增：`views/src/components/review/FindingInspector.tsx`
- 新增：`views/src/components/review/EditTaskDrawer.tsx`
- 修改：`views/src/main.tsx`（注册 `/review/:runId` 路由）
- 修改：`views/src/pages/DramaDetail.tsx`（添加"审片"按钮）

**M3（编辑器与资产）**：
- 修改：`src/workbench/http/router.js`（新增5-6个edit endpoint）
- 重写：`views/src/pages/Editor.tsx`
- 修改：`views/src/pages/CharacterManager.tsx`
- 修改：`views/src/pages/SceneManager.tsx`
- 修改：`views/src/pages/VoiceManager.tsx`
- 新增：`views/public/style-presets/`（7张WebP图片）
