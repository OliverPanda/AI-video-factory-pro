# AI漫剧自动化生成系统

输入剧本文件，或按 `project / script / episode` 定位已有项目数据，自动生成可发布到抖音、视频号、快手、小红书的竖屏漫剧短视频。

![系统总览](docs/assets/readme-overview.png)

## 一眼看懂

- `Director` 是唯一调度中心。
- 生产链路大致是：预生产 -> 视频 -> 音频/口型 -> 合成。
- `TTS_PROVIDER` 负责 TTS 上层合同，`TTS_TRANSPORT_PROVIDER` 负责具体供应商切换。
- `VIDEO_PROVIDER=seedance` 是当前主视频口径，`shot / sequence / bridge` 共用同一条底层 client。

## 文档入口

- Agent 设计与输入输出：[docs/agents/README.md](docs/agents/README.md)
- 运行目录、成果物、断点续跑：[docs/runtime/README.md](docs/runtime/README.md)
- 排障、验收、接手流程：[docs/sop/README.md](docs/sop/README.md)
- 测试与 QA 验收：[docs/sop/qa-acceptance.md](docs/sop/qa-acceptance.md)
- 角色身份统一规范：[docs/superpowers/specs/2026-04-17-identity-resolution-regression-spec.md](docs/superpowers/specs/2026-04-17-identity-resolution-regression-spec.md)

## 运行模式

- 兼容模式：直接传入单个 `.txt` 剧本，CLI 会自动桥接成临时 `project / script / episode`
- 项目模式：显式指定 `projectId + scriptId + episodeId`，适合多项目、多剧集并行管理

当前核心层级：

```text
project
└── script
    └── episode
        └── shot plan
```

## 当前系统主流程

主流程可以理解成 5 段：

1. `Director`
   负责整条生产线编排、缓存、断点续跑、QA 汇总和最终交付决策。
2. `Script Parser`
   负责把原始剧本拆成 `project / script / episode / shots` 这套可运行结构。
3. `Character Registry`
   负责把剧本角色、分集角色、角色圣经合成统一角色视图，并给后续模块提供稳定身份锚点。
4. `Prompt Engineer`
   负责把角色、场景、镜头意图转成可执行的图像 prompt。
5. `Image Generator`
   负责批量出分镜图和重生成。
6. `Character Ref Sheet Generator`
   负责先为每个角色生成三视图参考纸，给后续角色一致性提供硬参考。
7. `Consistency Checker`
   负责检查同一角色在不同镜头里的外观是否漂移。
8. `Continuity Checker`
   负责检查镜头之间的连贯性，并标记高风险 cut。
9. `Motion Planner`
   负责给每个镜头规划镜头类型、时长、运镜和动态目标。
10. `Performance Planner`
   负责给每个镜头补表演模板、动作节拍和生成层级。
11. `Video Router`
   负责把镜头打包成视频生成请求，并把参考图、连续性约束、provider hint 组织好。
12. `Seedance Video Agent`
   负责真正调用视频 provider 生成单镜头视频。
13. `Bridge Shot Planner / Router / Clip Generator / QA`
   负责只在高风险 cut 上补桥，并决定 bridge 是否真的可用。
14. `Action Sequence Planner / Router / Clip Generator / QA`
   负责识别连续动作段、整段生成 sequence clip，并决定是否覆盖原始 shot timeline。
15. `Dialogue Normalizer`
   负责对白标准化、分句和时长预算。
16. `TTS Agent`
   负责给说话角色绑定 voice cast / voice preset，并生成对白音频。
17. `Lip-sync Agent`
   负责为需要张嘴表演的镜头生成口型片段。
18. `Video Composer`
   负责按 `sequence > video > bridge > lipsync > animation > image` 的优先级装配最终成片。

更细的职责说明见 [docs/agents/README.md](docs/agents/README.md)。

当前身份绑定总规则：

- 一律 `ID-first`
- `id / episodeCharacterId / mainCharacterTemplateId / characterBibleId` 才是绑定键
- `name` 只能用于展示、日志、prompt 文本、兼容老数据
- 角色图、三视图、voice cast、视频参考图都不应再按 `name` 作为主关联键

当前 compose 视觉优先级：

1. `sequenceClips`
2. `videoResults`
3. `bridgeClips`
4. `lipsyncResults`
5. `animationClips`
6. `imageResults`

Phase 4 的最小增量位置固定为：

- `Shot QA Agent`
- `Bridge Shot Planner -> Bridge Shot Router -> Bridge Clip Generator -> Bridge QA Agent`
- `Action Sequence Planner -> Action Sequence Router -> Sequence Clip Generator -> Sequence QA Agent`
- `Video Composer`

当前 MVP 只解决“连续动作段优先吃整段 sequence clip”这件事，还不包含：

- 多人群战自动编排闭环
- 语音驱动动作节拍闭环
- 商用品质级复杂表演保证

关于视频模型路线：

- 当前默认口径：`VIDEO_PROVIDER=seedance`
- 当前推荐理解：你只维护一个主视频中转站 / relay，`shot / sequence / bridge` 共用同一套底层 client
- 兼容别名：`VIDEO_PROVIDER=fallback_video`
- 当前实现现状：兼容别名仍可用，但它不是第二条视频链路；用户侧应始终按“一个主 provider”来理解

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制：

```bash
cp .env.example .env
```

当前默认主链路至少需要：

- `QWEN_API_KEY`
- `LAOZHANG_API_KEY`
- `MINIMAX_API_KEY`

如果要启用动态镜头主路径，还需要：

- `LAOZHANG_API_KEY`

跑默认 `Seedance 2.0` 主路径时，还需要：

- `ARK_API_KEY` 或 `SEEDANCE_API_KEY`

如果要把图像 / 视频请求统一收口到 `Vercel AI Gateway` 适配层，再补这些：

- `VIDEO_TRANSPORT_PROVIDER=vercel_ai_gateway`
- `IMAGE_TRANSPORT_PROVIDER=vercel_ai_gateway`
- `VERCEL_AI_GATEWAY_API_KEY` 或 `AI_GATEWAY_API_KEY`
- `VIDEO_MODEL_SHOT` / `VIDEO_MODEL_SEQUENCE` / `VIDEO_MODEL_BRIDGE`

说明：

- `TTS_PROVIDER` 当前默认是 `minimax`，也可以切到 `openai_compat` 作为统一合同入口
- `TTS_TRANSPORT_PROVIDER` 用来指定 `openai_compat` 下真正落地的供应商，当前可先填 `minimax`
- MiniMax 官方 HTTP TTS 常见配置是 `MINIMAX_API_KEY + MINIMAX_GROUP_ID + /v1/t2a_v2`
- 默认男女声音色可先用 `MINIMAX_TTS_VOICE_FEMALE=Warm_Girl`、`MINIMAX_TTS_VOICE_MALE=Reliable_Executive`
- `ARK_API_KEY / SEEDANCE_API_KEY` 对应当前默认的火山方舟 `Seedance` provider
- `VIDEO_FALLBACK_API_KEY + VIDEO_FALLBACK_*` 是沿用的历史变量名，本质上仍是在配置同一个主视频 relay / provider；若 `VIDEO_FALLBACK_BASE_URL` 指向 `laozhang`，也可继续复用 `LAOZHANG_API_KEY`
- `VIDEO_TRANSPORT_PROVIDER` 是“底层提交通道”，与 `VIDEO_PROVIDER` 这个业务语义口径分离；例如可保持 `VIDEO_PROVIDER=seedance`，但把 transport 切到 `vercel_ai_gateway`
- `IMAGE_TRANSPORT_PROVIDER` 只影响图像请求怎么提交，不改变 `REALISTIC_IMAGE_MODEL / THREED_IMAGE_MODEL / IMAGE_EDIT_MODEL` 的模型路由语义
- 当前仓库里的 `VERCEL_AI_GATEWAY_VIDEO_SUBMIT_PATH` / `VERCEL_AI_GATEWAY_IMAGE_SUBMIT_PATH` 是本项目适配层约定，主要用于后续接正式 SDK 或服务端代理前的过渡集成
- `VIDEO_FALLBACK_SEQUENCE_*` 只作用于连续动作段 sequence 子链，不影响普通单镜头视频请求
- `VIDEO_FALLBACK_SIZE` 现在是可选覆盖项；默认优先按 `VIDEO_WIDTH / VIDEO_HEIGHT` 自动推断，不用手填
- 推荐配置项见 [`.env.example`](.env.example)

推荐默认值见 [`.env.example`](.env.example)。

### 3. 安装 FFmpeg

```bash
winget install Gyan.FFmpeg
```

校验：

```bash
ffmpeg -version
ffprobe -version
```

### 4. 运行

兼容模式：

```bash
node scripts/run.js samples/寒烬宫变-pro.txt --style=realistic
```

项目模式：

```bash
node scripts/run.js --project=project-example --script=pilot --episode=episode-1 --style=realistic
```

跳过一致性检查：

```bash
node scripts/run.js samples/寒烬宫变-pro.txt --skip-consistency
```

## 运行与恢复命令

完整 production pipeline：

```bash
node scripts/run.js samples/寒烬宫变-pro.txt --style=realistic
```

默认 Seedance 主视频 provider：

```bash
$env:ARK_API_KEY="你的火山方舟Key"
node scripts/run.js samples/寒烬宫变-pro.txt --style=realistic
```

默认 MiniMax TTS 主链：

```bash
$env:TTS_PROVIDER="minimax"
$env:TTS_TRANSPORT_PROVIDER="minimax"
$env:MINIMAX_API_KEY="你的MiniMaxKey"
$env:MINIMAX_GROUP_ID="你的GroupId"
node scripts/run.js samples/寒烬宫变-pro.txt --style=realistic
```

试听样本批量生成：

```bash
npm run tts:preview -- samples/tts-eval-lines.txt temp/tts-eval-samples
```

走 Vercel AI Gateway transport，但业务上仍按 `seedance` 理解：

```bash
$env:VIDEO_PROVIDER="seedance"
$env:VIDEO_TRANSPORT_PROVIDER="vercel_ai_gateway"
$env:IMAGE_TRANSPORT_PROVIDER="vercel_ai_gateway"
$env:VERCEL_AI_GATEWAY_API_KEY="你的GatewayKey"
$env:VIDEO_MODEL_SHOT="bytedance/seedance-v1.5-pro"
$env:VIDEO_MODEL_SEQUENCE="bytedance/seedance-v1.5-pro"
$env:VIDEO_MODEL_BRIDGE="bytedance/seedance-v1.5-pro"
node scripts/run.js samples/寒烬宫变-pro.txt --style=realistic
```

仍要复用旧变量名 / 旧 relay 时：

```bash
$env:VIDEO_PROVIDER="seedance"
$env:VIDEO_FALLBACK_API_KEY="你的视频Key"
$env:VIDEO_FALLBACK_BASE_URL="https://api.laozhang.ai/v1"
$env:VIDEO_FALLBACK_MODEL="veo-3.0-fast-generate-001"
node scripts/run.js samples/寒烬宫变-pro.txt --style=realistic
```

如果你只是沿用旧环境变量名，不需要把 `VIDEO_PROVIDER` 改成 `fallback_video`；保留 `seedance` 更符合当前主链口径。

如果是 sequence 真实样本调优，推荐再补这两个可选项：

```bash
$env:VIDEO_FALLBACK_SEQUENCE_MODEL_CANDIDATES="grok-video-3"
$env:VIDEO_FALLBACK_SEQUENCE_RETRY_ATTEMPTS="2"
```

说明：

- `VIDEO_FALLBACK_SEQUENCE_MODEL_CANDIDATES`
  只给 sequence 子链追加候选模型，按逗号分隔；主模型仍以 `VIDEO_FALLBACK_MODEL` 为首选
- `VIDEO_FALLBACK_SEQUENCE_RETRY_ATTEMPTS`
  只控制 sequence 子链对同一请求的有限重试次数，默认 `2`
- `VIDEO_FALLBACK_SEQUENCE_SECONDS`
  可选；只在你想强制 sequence 固定请求秒数时填写。不填时，sequence 默认按自身 `durationTargetSec` 申请，不继承 `VIDEO_FALLBACK_SECONDS=4`

统一断点续跑：

```bash
node scripts/resume-from-step.js --step=lipsync samples/寒烬宫变-pro.txt --dry-run --style=realistic
node scripts/resume-from-step.js --step=lipsync samples/寒烬宫变-pro.txt --style=realistic
node scripts/resume-from-step.js --step=video samples/寒烬宫变-pro.txt --style=realistic
```

按指定历史 run 严格绑定续跑：

```bash
node scripts/resume-from-step.js --step=video samples/寒烬宫变-pro.txt --run-id=run_xxx --dry-run --style=realistic
node scripts/resume-from-step.js --step=video samples/寒烬宫变-pro.txt --run-id=run_xxx --style=realistic
```

`--run-id` 当前不是“尽量参考这次 run”，而是“严格绑定这次 run”：

- 前置状态以该 run 的 `state.snapshot.json` 为准
- 从 `video` 及后续步骤恢复时，参考图必须来自该 run
- 缺图、缺前置状态、或图片路径越界时会直接失败，不再静默回退到别的 run 或当前最新缓存
- `--dry-run` 会额外打印恢复模式、绑定 `run-id` 和复用参考图数，先看一眼再正式执行更稳

如果你是在做真实样本复盘，想验证 `run_id1` 的图生视频，就一定带上 `--run-id=run_id1`，否则默认仍是“继续当前最新可恢复状态”。

项目模式下交互选择 `project / script / episode`：

```bash
node scripts/resume-from-step.js --step=audio --style=realistic
```

Seedance 替换旧兼容视频路径的后续实现计划：

- [docs/superpowers/plans/2026-04-05-seedance-primary-video-engine-replacement-implementation.md](docs/superpowers/plans/2026-04-05-seedance-primary-video-engine-replacement-implementation.md)

## 测试与 QA

README 里只保留最常用入口；完整验收标准、排障步骤和交接口径见：

- [docs/sop/qa-acceptance.md](docs/sop/qa-acceptance.md)
- [docs/sop/runbook.md](docs/sop/runbook.md)
- [docs/sop/change-checklist.md](docs/sop/change-checklist.md)

### 单 Agent 生产向测试

```bash
npm run test:lipsync-agent:prod
npm run test:video-composer:prod
npm run test:director:prod
```

### 保留测试成果物

```bash
npm run test:video-composer:prod:keep-artifacts
npm run test:director:prod:keep-artifacts
```

### 串行验证主要 Agent

```bash
npm run test:agents:prod
```

### 动态镜头与 Bridge Shot 回归

```bash
node --test tests/bridgeShotPlanner.test.js tests/bridgeShotRouter.test.js tests/bridgeClipGenerator.test.js tests/bridgeQaAgent.test.js tests/director.bridge.integration.test.js tests/videoComposer.bridge.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js tests/pipeline.acceptance.test.js
```

### Phase 4 Action Sequence 收口验收

```bash
node --test tests/actionSequencePlanner.test.js tests/actionSequenceRouter.test.js tests/sequenceClipGenerator.test.js tests/sequenceQaAgent.test.js tests/videoComposer.sequence.test.js tests/director.sequence.integration.test.js tests/resumeFromStep.test.js tests/runArtifacts.test.js tests/pipeline.acceptance.test.js
```

### Phase 4 可解释性与覆盖摘要回归

```bash
node --test tests/actionSequenceRouter.test.js tests/seedanceVideoApi.test.js tests/sequenceQaAgent.test.js tests/director.sequence.integration.test.js tests/pipeline.acceptance.test.js
```

### QA 快速查看口

- 优先看 run 根目录的 `qa-overview.md`
- 看最终 `delivery-summary.md` 判断整轮是否通过、哪些 sequence 回退
- 做真实样本调优时，配合 [Sequence 调优 Checklist](docs/sop/2026-04-06-phase4-sequence-tuning-checklist.md)

## 目录总览

```text
src/
  agents/      Agent 主链路
  apis/        Provider Router 与外部服务接入
  domain/      Project / Asset / Character 等模型
  utils/       state、run-job、qa-summary、artifact 工具
scripts/
  run.js
  resume-from-step.js
docs/
  agents/
  runtime/
  sop/
temp/
  运行缓存、状态、run 包、单 agent 测试成果物
output/
  最终成片与 delivery summary
```

## 文档导航

### Agent

- [Agent 总览](docs/agents/README.md)
- [Agent 输入输出地图](docs/agents/agent-io-map.md)
- [运行包目录示例](docs/agents/run-package-example.md)

### Runtime

- [运行时目录总览](docs/runtime/README.md)
- [temp 目录说明](docs/runtime/temp-structure.md)
- [output 目录说明](docs/runtime/output-structure.md)
- [断点续跑说明](docs/runtime/resume-from-step.md)
- [Phase 1 验收报告](docs/superpowers/plans/2026-04-04-dynamic-shortdrama-phase1-acceptance.md)
- [Phase 2 设计文档](docs/superpowers/specs/2026-04-04-dynamic-shortdrama-phase2-design.md)
- [Phase 2 实施计划](docs/superpowers/plans/2026-04-04-dynamic-shortdrama-phase2-implementation.md)
- [Phase 3 Bridge Shot 设计文档](docs/superpowers/specs/2026-04-05-dynamic-shortdrama-phase3-bridge-shot-design.md)
- [Phase 3 Bridge Shot 实施计划](docs/superpowers/plans/2026-04-05-dynamic-shortdrama-phase3-bridge-shot-implementation.md)
- [Phase 4 Action Sequence 设计文档](docs/superpowers/specs/2026-04-05-dynamic-shortdrama-phase4-action-sequence-design.md)
- [Phase 4 Action Sequence 实施计划](docs/superpowers/plans/2026-04-05-dynamic-shortdrama-phase4-action-sequence-implementation.md)
- [Phase 4 收口后高价值任务计划](docs/superpowers/plans/2026-04-06-dynamic-shortdrama-phase4-high-value-followups-implementation.md)

### SOP

- [SOP 总览](docs/sop/README.md)
- [运行排障 Runbook](docs/sop/runbook.md)
- [QA 验收 SOP](docs/sop/qa-acceptance.md)
- [变更检查清单](docs/sop/change-checklist.md)

## 成果物规则

- 整体 production pipeline：落到 `temp/projects/<project>/scripts/<script>/episodes/<episode>/runs/...`
- 单独跑某个 Agent 并保留成果物：落到 `temp/<agentName>/...`
- 最终交付：落到 `output/<projectName>__<projectId>/第xx集__<episodeId>/`

如果你只想先判断“这一轮过没过、卡在哪”，优先看 run 根目录的 `qa-overview.md`。

## 动态镜头 / Bridge Shot 主链

当前成片主视觉优先级保持为：

1. `sequenceClips`
2. `videoResults`
3. `bridgeClips`
4. `lipsyncResults`
5. `animationClips`
6. `imageResults`

但 `videoResults` 的内部生成链路已经升级为：

```text
motionPlan
-> performancePlan
-> shotPackages
-> rawVideoResults
-> enhancedVideoResults
-> shotQaReportV2
-> videoResults
-> composer
```

也就是说：

- 配了同一个视频 relay 的 `VIDEO_FALLBACK_*` 配置后，`shot / sequence / bridge` 都会共用它
- 即使你沿用 `VIDEO_FALLBACK_*` 这组旧变量名，也仍然是在维护同一个主视频 provider
- 若 `VIDEO_PROVIDER=fallback_video`，也只是兼容别名切换，不代表你需要再单独维护第二套会员或第二个视频链路
- `videoComposer` 不直接理解 `rawVideoResults / enhancedVideoResults`，而是消费 `Director` 桥接后的 `videoResults + bridgeClips`
- 没有视频结果或 QA 不通过时，系统会显式回退到旧的静图/口型/动画路径

对应 run package 目录：

- `09a-motion-planner`
- `09b-performance-planner`
- `09c-video-router`
- `09d-sora2-video-agent`
- `09e-motion-enhancer`
- `09f-shot-qa`
- `10-video-composer`

在此基础上，系统还会按需触发一条 bridge shot 子链：

```text
continuityFlaggedTransitions
-> bridgeShotPlan
-> bridgeShotPackages
-> bridgeClipResults
-> bridgeQaReport
-> bridgeClips
-> composer timeline
```

对应 Phase 3 run package 目录：

- `09g-bridge-shot-planner`
- `09h-bridge-shot-router`
- `09i-bridge-clip-generator`
- `09j-bridge-qa`

当前 bridge shot 规则是：

- 只对高风险 cut 点触发，不会给所有镜头默认插桥
- 只有 `bridgeQaReport.entries[].finalDecision === "pass"` 的 bridge clip 才会进入 compose timeline
- `fallback_to_direct_cut / fallback_to_transition_stub / manual_review` 都不会破坏主链成片

当前 sequence 子链新增了 4 个最常用排查口：

- `09l-action-sequence-router/2-metrics/action-sequence-routing-metrics.json`
  看 `skipReasonBreakdown`，判断是缺图、缺视频、缺 bridge，还是素材混合不足
- `09n-sequence-qa/2-metrics/sequence-qa-metrics.json`
  看 `topFailureCategory / topRecommendedAction / fallbackSequenceIds / manualReviewSequenceIds`
- `10-video-composer/2-metrics/video-metrics.json`
  看 `sequence_coverage_shot_count / applied_sequence_ids / fallback_shot_ids`
- 最终 `delivery-summary.md`
  看整轮 `sequence_coverage_sequence_count / applied_sequence_ids / fallback_sequence_ids`

如果你要拿真实样本做调优，建议直接配合：

- [Sequence 调优 Checklist](docs/sop/2026-04-06-phase4-sequence-tuning-checklist.md)
