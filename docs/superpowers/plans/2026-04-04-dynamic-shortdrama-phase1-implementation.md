# 动态短剧升级 Phase 1 实施计划

> **Goal:** 在不重写 orchestrator 的前提下，把当前系统的默认视觉主路径从 `imageResults` 切换到 `videoResults`，并保持现有审计、续跑与交付机制可用。

---

## Task 1：定义协议层

**Files**

- 新增或修改：`src/agents/motionPlanner.js`
- 新增或修改：`src/agents/videoRouter.js`
- 新增或修改：`src/agents/shotQaAgent.js`
- 修改：`src/utils/runArtifacts.js`
- 修改：`scripts/resume-from-step.js`
- 测试：`tests/motionPlanner.test.js`
- 测试：`tests/videoRouter.test.js`
- 测试：`tests/resumeFromStep.test.js`

- [ ] 定义 `motionPlan` 最小字段结构并固定 `shotType` 集合
- [ ] 定义 `shotPackage` 最小字段结构并锁定 `preferredProvider / fallbackProviders`
- [ ] 定义 `videoResults` 与 `shotQaReport` 最小字段
- [ ] 将 `motionPlan / shotPackages / videoResults / shotQaReport` 纳入 state cache
- [ ] 将 `09a-motion-planner / 09b-video-router / 09c-runway-video-agent / 09d-shot-qa / 10-video-composer` 纳入 artifact layout
- [ ] 为 `resume-from-step` 增加 `video` 续跑阶段与缓存清理规则

## Task 2：新增 Motion Planner

**Files**

- 新增或修改：`src/agents/motionPlanner.js`
- 测试：`tests/motionPlanner.test.js`

- [ ] 用确定性规则生成 `motionPlan`
- [ ] 固定输出 `shotType / durationTargetSec / cameraIntent / videoGenerationMode`
- [ ] 至少覆盖五类镜头：
  - `dialogue_closeup`
  - `dialogue_medium`
  - `fight_wide`
  - `insert_impact`
  - `ambient_transition`
- [ ] 写入 `motion-plan.json`、metrics 与 QA summary

## Task 3：新增 Video Router

**Files**

- 新增或修改：`src/agents/videoRouter.js`
- 测试：`tests/videoRouter.test.js`

- [ ] 组装 `motionPlan + imageResults + promptList -> shotPackage`
- [ ] 规则固定：
  - 有合格参考图时，`preferredProvider = runway`
  - 缺少参考图时，允许回退到 `static_image`
- [ ] 输出可审计 `shot-packages.json`
- [ ] 记录 provider 选择分布 metrics

## Task 4：新增 Runway Video Agent

**Files**

- 新增或修改：`src/apis/runwayVideoApi.js`
- 新增或修改：`src/agents/runwayVideoAgent.js`
- 测试：`tests/runwayVideoApi.test.js`
- 测试：`tests/runwayVideoAgent.test.js`

- [ ] 实现官方 Runway API 的最小 `image-to-video` 路径
- [ ] 支持任务提交、轮询、下载
- [ ] 输出 `videoResults`
- [ ] 稳定分类错误：
  - `provider_auth_error`
  - `provider_rate_limit`
  - `provider_timeout`
  - `provider_invalid_request`
  - `provider_generation_failed`
- [ ] 在 agent artifact 中记录失败镜头明细

## Task 5：新增 Shot QA

**Files**

- 新增或修改：`src/agents/shotQaAgent.js`
- 测试：`tests/shotQaAgent.test.js`

- [ ] 对 `videoResults` 做结构化验收
- [ ] 固定验收规则：
  - 文件存在
  - 文件非空
  - `ffprobe` 可读
  - 时长非 0
  - 时长偏差在阈值内
- [ ] 对失败镜头显式记账 fallback
- [ ] 输出 `shotQaReport.json` 与 metrics

## Task 6：Director / Composer 集成

**Files**

- 修改：`src/agents/director.js`
- 修改：`src/agents/videoComposer.js`
- 测试：`tests/videoComposer.test.js`
- 测试：`tests/director.project-run.test.js`
- 测试：`tests/director.artifacts.test.js`
- 测试：`tests/pipeline.acceptance.test.js`

- [ ] `Director` 接入 `motion planner / video router / runway video agent / shot QA`
- [ ] `Director` 把 `videoResults / shotQaReport` 写入 state cache
- [ ] `Director` 生成 `videoClips` bridge，只把 QA 通过的视频送入 composer
- [ ] `videoComposer` 固定视觉优先级：
  1. `videoResults`
  2. `lipsyncResults`
  3. `animationClips`
  4. `imageResults`
- [ ] 当视频缺失或 QA fail 时，回退到旧路径
- [ ] 更新 run summary：
  - `planned_video_shot_count`
  - `generated_video_shot_count`
  - `video_provider_breakdown`
  - `fallback_video_shot_count`

## Test Plan

- [ ] 协议与规划：`motionPlan` 覆盖正确，`shotPackage` 字段完整
- [ ] Runway Agent：成功提交、轮询超时、4xx/5xx 分类、下载文件校验
- [ ] Shot QA：合法 mp4 通过、空文件失败、伪文件失败、时长异常失败、fallback 记录正确
- [ ] Director 集成：有 `videoResults` 时走视频主路径，缺失时回退，缓存命中不重复生成
- [ ] Resume：`--step=compose` 保留 `videoResults`，`--step=video` 只清视频及后续状态
- [ ] Acceptance：至少保留 1 个 production-style 样例，验证主交付来源支持视频镜头通道

## Documentation

**Files**

- 新增：`docs/superpowers/specs/2026-04-04-dynamic-shortdrama-phase1-design.md`
- 新增：`docs/superpowers/plans/2026-04-04-dynamic-shortdrama-phase1-implementation.md`
- 修改：`README.md`
- 修改：`docs/agents/README.md`
- 修改：`docs/agents/video-composer.md`

- [ ] README 说明新增 video 阶段与续跑规则
- [ ] Agent 文档补充 `motion planner / video router / runway video / shot QA`
- [ ] `video-composer` 文档明确新主路径优先级
- [ ] 说明 `RUNWAY_API_KEY` 为启用动态镜头的关键配置项
