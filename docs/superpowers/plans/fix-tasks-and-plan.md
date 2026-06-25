# AI漫剧自动化生成系统 Fix Tasks And Plan

> 更新时间：2026-06-23  
> 文件位置：`docs/superpowers/plans/fix-tasks-and-plan.md`  
> 评审输入：`C:\Users\zzjhy\.qoderwork\workspace\mqp5bub3j58h8f9p\outputs\AI漫剧自动化生成系统-CodeReview-Report.md`  
> 范围：当前 `AI-video-factory-pro` 交付收口、缺口补齐与后续低风险治理  
> 原则：只修真实问题，只补交付缺口，不为消 review 数字做过度设计

## 1. 结论

Qwen 这份 review 报告总体方向是对的，但优先级需要按当前项目现实重排。

- 应立即吸收：路径校验、`.env` 边界、settings 白名单、保存失败兜底、测试污染、部署文档边界
- 应拆成后续批次：真实交付证据、voice 保存回读、浏览器 E2E、结构治理、最小部署安全补证
- 当前明确不做：完整 SaaS 鉴权、多租户、安全体系化并发锁、一次性大拆核心大文件、全量性能与可访问性整改

## 2. 三栏勾选清单

| 必修 | 后置 | 不做 |
|---|---|---|
| [x] 收紧 `.env` 读写边界，仅允许工作区受控 `.env` 文件 | [x] 补真实样本 review 成片证据 | [ ] 本轮引入完整鉴权体系 |
| [x] 对 `projectId / scriptId / episodeId / entityId` 增加 path segment 校验 | [x] 补真实样本 voice 保存回读证据 | [ ] 本轮引入多用户 / 多租户安全模型 |
| [x] Settings 保存保持白名单 key 限制，阻断未知配置写入 | [~] 补 `/review/:runId`、`/editor`、`/voices` 浏览器级 E2E | [ ] 本轮引入完整 CSRF 方案 |
| [x] Settings 保存失败时阻断 precheck 继续执行 | [ ] 补真实样本后处理 4 Agent 产物验收 | [ ] 本轮引入体系化文件锁 / 并发控制框架 |
| [x] 为 `parseBody` 增加请求体大小限制，避免无界内存占用 | [ ] 为旧 run 的失效视频路径提供迁移 / 修复策略 | [ ] 本轮一次性拆完 `router.js` |
| [x] 清理 `workbenchServer.test.js` 的 `process.env` 污染 | [ ] `router.js` 继续按低风险职责切片 | [ ] 本轮一次性拆完 `director.js` |
| [x] 为非法 path 参数、unknown key、workspace `.env` 约束补回归测试 | [ ] `director.js` 继续抽纯 helper / legacy bridge / 后处理装配 | [ ] 本轮一次性拆完 `storyboardContextMemory.js` |
| [x] 修正文档中的绝对路径、旧 CLI 参数、失效样例引用 | [ ] `storyboardContextMemory` 继续拆纯函数，不改 schema | [ ] 本轮做全量 performance 优化 |
| [x] 为 `WORKBENCH_TOKEN` 补独立测试与部署说明 | [ ] 评估是否给少量高风险读接口补保护 | [ ] 本轮做全量 accessibility 整改 |
| [x] 明确默认仅本机监听、局域网暴露前提与最小鉴权边界 | [ ] 统一 README / deployment / user-guide / SOP 历史命令口径 | [ ] 本轮为了消掉 review 数字做大范围重构 |
| [x] 为失联子进程导致的假 `running` run 增加 stale-run reconcile | [x] 真实样本从 `audio` 续跑，确认 TTS / voice cast 已恢复 | [ ] 本轮补齐所有 P2/P3 建议 |
| [x] 对必修项完成定向测试与前端构建验证 | [x] 固化截图、录像、自测记录和验收清单 | [ ] 本轮引入大规模前后端类型重构 |

## 3. 必修

这些项与当前交付质量直接相关，且已经完成首轮修复。

### 3.1 已完成修复

- [x] `src/utils/envConfigStore.js`
  - 收紧 `.env` 文件读写边界
  - 增加工作区允许根校验
  - 增加受控文件名约束

- [x] `src/workbench/http/router.js`
  - 为核心 URL 参数补 `validatePathSegment()`
  - 覆盖 `projectId / scriptId / episodeId / entityId`
  - 把非法值拦在 `path.resolve / fs` 之前

- [x] Settings 写入链路
  - 保持白名单 key 限制
  - unknown key 被忽略
  - 阻断借 Settings 写入任意环境变量

- [x] `views/src/pages/Settings.tsx`
  - `handlePrecheck()` 先保存
  - 保存失败直接返回
  - 不再继续 `runAllChecks()`

- [x] 请求体安全
  - 为 `parseBody` 增加 body size 限制
  - 避免异常大请求导致 Node 进程无界内存占用

- [x] `tests/workbench/workbenchServer.test.js`
  - 增加 `process.env` 保存与恢复
  - 补非法 `projectId`
  - 补非法 storyboard locator
  - 补 unknown settings key 被忽略
  - 补 `.env` 工作区边界约束

- [x] stale-run reconcile
  - 读取 run 列表 / 详情时，补 run 失联兜底
  - 子进程已退出且 snapshot 无完成标记时，自动把假 `running` 修正为 `failed`
  - 避免 UI 长时间卡在错误状态判断

- [x] 文档修正
  - `docs/deployment.md` 去掉绝对 Windows 路径
  - CLI 参数统一成 `--stop-at=before_video`
  - 补 `WORKBENCH_TOKEN`、本机监听和局域网边界说明
  - `docs/user-guide.md` 移除失效样例引用并修正续跑命令

### 3.2 已完成的结构治理首轮

- [x] `src/workbench/http/router.js`
  - 已抽出 `src/workbench/http/videoResponses.js`
  - 已抽出 `src/workbench/http/settingsSupport.js`
  - 已抽出 `src/workbench/http/reviewSupport.js`

- [x] `src/domain/storyboardContextMemory.js`
  - 已抽出 `src/domain/storyboardContextMemory/markdown.js`
  - 保持原导出兼容，不改调用方接口

- [x] `src/agents/director.js`
  - 已补齐 `legacyBridge` 拆分后的缺失导出 / 导入
  - 修复 `sanitizeFileSegment` 回归

### 3.3 必修项验证

- [x] `node --test tests/director.project-run.test.js`
- [x] `node --test tests/runCli.test.js tests/resumeFromStep.test.js`
- [x] `node --test --test-name-pattern "reconciles stale running runs|WORKBENCH_TOKEN|settings|storyboard rejects invalid locator|rejects invalid projectId" tests/workbench/workbenchServer.test.js`
- [x] `pnpm --dir views build`

## 4. 后置

这些项值得做，但不应与当前 fix 批次混成一锅。

### 4.1 批次 A：交付证据补齐

目标：把“代码已接通”补成“真实样本可交付”。

- [x] 选定真实 run，优先使用当前失败在 `tts_qa` 的样本继续排查
- [x] 从 `audio` 续跑真实样本，确认当前代码下 voice cast 是否已正确命中
- [x] 验证 `audioVoiceResolution` 已产生真实数据：`14` 条 voice resolution，页面聚合 `3` 个说话人
- [x] 验证 live `state.outputPath` 对应真实 `final-video.mp4` 存在且可播放
- [x] 验证 `/api/runs/:id/review/video` 返回真实成片：`206 Partial Content`
- [~] 验证 `/review/:runId` 页面可打开、渲染、播放、任务写回：页面和播放链路已验证，真实 review task 写回未执行以避免污染任务状态
- [x] 验证 `/voices` 页面存在真实数据并完成保存回读
- [ ] 验证 `/editor` 的 shot / scene / emotion 保存回读
- [x] 补截图、自测记录、验收勾选清单

验收标准：

- [x] 至少 1 个真实样本完整跑通到 review 成片
- [x] 至少 1 轮浏览器级联调证据可回放
- [x] 至少 1 份 voice 保存回读证据可复核

### 4.2 批次 B：部署安全最小化收口

目标：把当前 workbench 的本机 / 局域网使用边界说清楚、测清楚。

- [x] `WORKBENCH_TOKEN` 已有代码与测试覆盖
- [x] 部署文档已明确 token 使用方式
- [x] 已明确默认仅本机监听
- [x] 已明确局域网访问和公网部署不是一回事
- [ ] 评估是否给少量高风险读接口补保护
- [ ] 评估局域网暴露策略是否需要更窄默认值

验收标准：

- [ ] README / deployment / user-guide 三份文档口径一致
- [ ] 最小可接受部署边界清晰，无“默认裸奔到公网”的误解

### 4.3 批次 C：结构治理第二轮

目标：降低维护成本，但不打断交付收口。

- [ ] `router.js` 继续按职责切片，保持小步拆分
- [ ] `director.js` 只抽纯 helper、legacy bridge、后处理装配
- [ ] `storyboardContextMemory` 继续拆纯函数与格式化辅助
- [ ] 每切一刀先补定向测试，再做代码搬运
- [ ] 不改 schema，不改现有 API 契约，不做一次性总重构

验收标准：

- [ ] 每次切片都能用现有测试快速回归
- [ ] 体量下降，但不引入新行为变化

## 5. 不做

这些项不是永远不做，而是当前批次明确不做。

- [ ] 全量鉴权 / 完整用户系统 / 多租户安全体系
- [ ] 全量 CSRF 方案
- [ ] 多用户并发与文件锁体系化治理
- [ ] 一次性拆完 `router.js / director.js / storyboardContextMemory.js`
- [ ] 全量 performance 优化
- [ ] 全量 accessibility 整改
- [ ] 前后端大规模类型系统重构
- [ ] 为了消掉 review 数字而做与当前交付无关的铺垫工程

## 6. 正式执行计划

### Phase 1

- [x] 完成必修修复首轮
- [x] 完成定向测试与前端构建验证
- [x] 完成 fix 基线文档整理

### Phase 2

- [x] 执行“交付证据补齐”批次
- [x] 以真实样本从 `audio` 续跑，优先确认 TTS / voice cast 问题
- [x] 形成 review 成片、voice 回读、浏览器 E2E 证据

### Phase 3

- [ ] 执行“部署安全最小化收口”批次
- [ ] 只补本机 / 局域网边界需要的最小保护

### Phase 4

- [ ] 执行“结构治理”批次
- [ ] 保持小步、低风险、可回归

## 7. 对 review 报告的最终判断

这份 review 报告合理，但不能按原始 P0/P1/P2/P3 机械落地。

- 合理且已吸收：
  - 路径越界
  - settings 注入
  - 测试污染
  - 文档口径
  - 最小部署边界
  - stale run 状态修正

- 合理但后置：
  - 真实样本 review 成片
  - voice 回读
  - 浏览器 E2E
  - 结构治理
  - 最小部署安全补证

- 过度设计，当前不做：
  - 全量鉴权
  - 完整并发锁
  - 一次性大拆
  - 全量性能优化
  - 全量可访问性整改

最终执行原则：

- [x] 修真实问题
- [x] 保交付节奏
- [x] 对过度设计保持克制
