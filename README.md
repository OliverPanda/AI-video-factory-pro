# AI漫剧自动化生成系统

输入剧本文件，或按项目/剧本/分集定位已有内容，自动生成可发布到抖音/视频号/快手/小红书的竖屏漫剧短视频。

## 多项目模型

当前运行模型同时支持两种入口：

- 兼容模式：直接传入单个 `.txt` 剧本，CLI 会自动桥接成一个临时项目、剧本、分集并继续走分集导演流程。
- 项目模式：显式指定 `projectId + scriptId + episodeId`，直接调用分集级导演入口，适合多剧集、多项目并行管理。

当前已落地的核心层级如下：

```text
project
└── script
    └── episode
        └── shot plan
```

本地运行时的持久化结构位于 `temp/projects/<projectId>/...`，并额外按分集保存：

- `project.json / script.json / episode.json`
- `run-jobs/<runJobId>.json`
- 兼容旧入口的 `temp/<jobId>/state.json`

仓库里的 `samples/project-example/` 只是说明性的最小示例，用来帮助理解项目元数据和原始剧本文本如何对应；项目模式真正读取的是 `temp/projects/...` 下已经存在的结构化数据。

运行时目录说明见：

- [docs/runtime/temp-structure.md](docs/runtime/temp-structure.md)
- [docs/runtime/output-structure.md](docs/runtime/output-structure.md)

## 系统架构

```
用户输入剧本（.txt）
        │
  ┌─────▼──────┐
  │ 导演Agent  │  ← LLM主控，拆解任务、调度子Agent
  └─────┬──────┘
        │
  ┌─────▼──────┐
  │ 编剧Agent  │
  └─────┬──────┘
        │
  ┌─────▼──────┐
  │ 角色设定   │
  │ Agent      │
  └─────┬──────┘
        │
  ┌─────▼──────┐
  │ 视觉设计   │
  │ Agent      │
  └─────┬──────┘
        │
  ┌─────▼──────┐        ┌──────────────┐
  │ 图像生成   │◄──────►│ 一致性验证   │
  │ Agent      │        │ Agent（LLM） │
  └─────┬──────┘        └──────────────┘
        │
  ┌─────▼──────┐
  │ 连贯性检查 │
  │ Agent      │
  └─────┬──────┘
        │
  ┌─────▼──────┐
  │  配音Agent │
  │  (TTS)     │
  └─────┬──────┘
        │
  ┌─────▼──────┐
  │ TTS QA     │
  │ Agent      │
  └─────┬──────┘
        │
  ┌─────▼──────┐
  │ Lip-sync   │
  │ Agent      │
  └─────┬──────┘
        │
  ┌─────▼──────┐
  │ 合成Agent  │  FFmpeg
  └─────┬──────┘
        │
  ┌─────▼────────────┐
  │ 最终视频输出      │
  │ 1080×1920 竖屏    │
  └──────────────────┘
```

当前运行包除了核心成果物，还会额外生成两层“给人看的 QA 摘要”：

- 每个主要 agent：`1-outputs/qa-summary.md`、`2-metrics/qa-summary.json`
- 整轮 run 根目录：`qa-overview.md`、`qa-overview.json`

如果你只想先知道“这轮过没过、卡在哪”，优先看 `qa-overview.md`。

## Agent 详细说明

### Agent 1：导演Agent（Orchestrator）
**文件**：`src/agents/director.js`

**职责**：按分集编排解析、角色、Prompt、关键帧、音频和合成步骤，处理缓存、失败重试、审计产物和兼容模式桥接。

**当前入口**：
- `runEpisodePipeline({ projectId, scriptId, episodeId, options })`
- `runPipeline(scriptFilePath)` 仍保留为兼容桥，会先映射成临时 `project/script/episode` 再转入分集级入口

**核心机制**：
- 每个步骤完成后将结果写入 `temp/<jobId>/state.json`，下次运行同一 job 时自动跳过已完成步骤
- 每次分集运行还会在 `temp/projects/<projectId>/scripts/<scriptId>/episodes/<episodeId>/run-jobs/` 下落一份 `RunJob` 记录，并为主要步骤追加 `AgentTaskRun`
- 每次分集运行还会生成一份可审计运行包，位于 `temp/projects/<projectName>__<projectId>/.../runs/<timestamp>__<runJobId>/`

**执行流程**：
1. 读取剧本文件
2. 调用编剧Agent解析分镜
3. 调用角色设定Agent构建视觉档案
4. 调用视觉设计Agent生成图像Prompt
5. 调用图像生成Agent批量出图
6. 调用一致性验证Agent检查角色身份漂移并触发重生成
7. 调用连贯性检查Agent检查跨分镜承接
8. 调用配音Agent批量合成音频
9. 调用 TTS QA Agent 做最小自动验收
10. 调用 Lip-sync Agent 为需要说话表演的镜头生成口型片段
11. 调用合成Agent输出最终视频

---

### Agent 2：编剧Agent（Script Parser）
**文件**：`src/agents/scriptParser.js`

**职责**：将原始剧本文本先拆分为剧集，再将单集拆分为结构化分镜；同时保留旧的平铺 `parseScript()` 输出做兼容桥接。

**输入**：剧本文本（.txt）

**输出**：
```json
{
  "title": "剧名",
  "totalDuration": 60,
  "characters": [
    { "name": "小明", "gender": "male", "age": "20多岁" }
  ],
  "shots": [
    {
      "id": "shot_001",
      "scene": "咖啡馆白天",
      "characters": ["小明", "小红"],
      "action": "小明递过一杯咖啡",
      "dialogue": "给你，加了糖",
      "emotion": "温柔、害羞",
      "camera_type": "中景",
      "duration": 3
    }
  ]
}
```

**当前补充**：
- 支持 `script -> episodes -> shots` 的项目模型
- 兼容旧 `parseScript()` 平铺输出
- 在审计运行包里会落 `source-script.txt / shots.flat.json / shots.table.md / parser-metrics.json`

**LLM调用**：当前默认推荐 `Qwen` 作为文本主力，`DeepSeek` 作为备选。

---

### Agent 3：角色设定Agent（Character Registry）
**文件**：`src/agents/characterRegistry.js`

**职责**：为剧本中所有角色构建视觉档案，生成可复用的英文 Prompt 描述词，并解析 `EpisodeCharacter / ShotCharacter` 关系，给 Prompt、TTS 和一致性检查提供统一角色视图。

**输出**（每个角色的视觉ID卡）：
```json
{
  "id": "episode_char_001",
  "episodeCharacterId": "episode_char_001",
  "name": "小红",
  "gender": "female",
  "visualDescription": "young Asian woman, long black hair, fair skin, casual outfit...",
  "basePromptTokens": "young Asian woman, long black hair, fair skin, bright eyes",
  "personality": "温柔内敛，眼神清澈"
}
```

**当前补充**：
- LLM 漏掉角色时会自动用 source character 做 fallback 合并
- 项目模式下可直接合并 `MainCharacterTemplate + EpisodeCharacter + CharacterBible`
- 审计运行包里会落 `character-registry.json / character-name-mapping.json / character-metrics.json`
- `resolveShotParticipants()` 和 `resolveShotSpeaker()` 也在这一层完成

---

### Agent 4：视觉设计Agent（Prompt Engineer）
**文件**：`src/agents/promptEngineer.js`

**职责**：为每个分镜生成结构化图像 Prompt，自动注入角色词、风格词、镜头词，并在 LLM 返回坏 JSON 时自动降级为本地 fallback Prompt。

**两种风格示例**：

写实风格：
```
young Asian woman, long black hair, fair skin, bright eyes,
cozy coffee shop interior, warm window lighting, passing coffee cup,
shy smile, medium shot, bokeh background,
cinematic, photorealistic, 8k uhd, hyperdetailed, sharp focus
```

3D风格：
```
young Asian woman, long black hair, fair skin, bright eyes,
cozy coffee shop, warm ambient lighting, passing coffee cup,
shy expression, medium shot,
3D render, Pixar style, Cinema4D, octane render, 8k, subsurface scattering
```

**镜头类型映射**：特写 / 近景 / 中景 / 全景 / 远景 → 对应英文Camera关键词

**当前补充**：
- 默认推荐 `Qwen` 作为 JSON Prompt 主力，`DeepSeek` 作为备选
- `ShotContinuityState` 会进入 prompt 约束块，注入光照、轴线、道具状态和风险标签
- 审计运行包里会落 `prompts.json / prompt-sources.json / prompts.table.md / prompt-metrics.json`
- 每个 fallback 镜头都会单独落错误证据文件

---

### Agent 5：图像生成Agent（Image Generator）
**文件**：`src/agents/imageGenerator.js`

**职责**：调用图像API批量生成分镜图，含并发控制和自动重试。

| 风格 | API | 备注 |
|------|-----|------|
| 写实 | LaoZhang 图像路由 | `IMAGE_STYLE=realistic` |
| 3D | LaoZhang 图像路由 | `IMAGE_STYLE=3d` |

**并发控制**：队列并发控制 + 自动重试 3 次。

**当前补充**：
- 结果会包装成 `KeyframeAsset` 风格的 runtime object
- 审计运行包里会落 `provider-config.json / images.index.json / image-metrics.json / retry-log.json`
- 每个失败镜头都会落 `<shotId>-error.json`

---

### Agent 6：一致性验证Agent（Consistency Checker）
**文件**：`src/agents/consistencyChecker.js`

**职责**：用多模态 LLM 检查同一角色在多张图片中的外观一致性，评分不达标时通知导演 Agent 触发重生成。

**关键边界**：
- 当前做的是“角色外观一致性”
- 还不是完整的“镜头时序连贯性 / 场面调度连续性 Agent”
- 它更关注发型、脸型、服装、明显可视特征是否漂移

**LLM调用**：当前通过视觉 LLM 做多图检查，默认按批次处理，避免单次 base64 过大。

**评分维度**：
- 面部特征（五官、肤色）
- 发型发色
- 服装穿搭
- 体型比例

**触发规则**：总分 < 7分（可通过 `CONSISTENCY_THRESHOLD` 环境变量调整）时，将问题图像标记为需要重生成，并附上改进建议。

**当前补充**：
- 少于 2 张有效图的角色会被跳过
- 多批结果会取平均分，问题图索引会做全局偏移
- 报告会额外输出 `identityDriftTags / anchorSummary`
- 审计运行包里会落 `consistency-report.json / consistency-report.md / flagged-shots.json / consistency-metrics.json`
- 批次失败时会落 `<character>-batch-<n>-error.json`

---

### Agent 7：连贯性检查Agent（Continuity Checker）
**文件**：`src/agents/continuityChecker.js`

**职责**：按 `previous shot -> current shot` 的承接关系检查跨分镜基础连贯性，重点关注光照语义、镜头轴线、道具承接与高风险转场。

**当前补充**：
- 已从 `Consistency Checker` 中独立出来，避免把“角色身份一致性”和“镜头连贯性”混成一个 Agent
- 审计运行包里会落 `continuity-report.json / flagged-transitions.json / continuity-report.md / continuity-metrics.json`
- `Director` 会在一致性验证后、配音前执行这一层

**重要说明**：
- `06-continuity-checker/` 只有在流程真正走到 `continuity_check` 这一步时才会写入成果物
- 如果在一致性重生成阶段提前失败，例如 `regenerate_inconsistent_images` 被上游生图接口 `503` 打断，那么该目录会只保留初始化时的空骨架和 `pending` manifest，这不是“剧本不支持”，而是流程尚未执行到该步骤

---

### Agent 8：配音Agent（TTS）
**文件**：`src/agents/ttsAgent.js`

**职责**：为每段对白生成配音音频，无台词分镜自动跳过；按 `ShotCharacter.isSpeaker / shot.speaker / characters` 解析说话者，并按 `voicePresetId` 决定声线。

| 提供商 | 环境变量 | 特点 |
|--------|---------|------|
| 讯飞 | `TTS_PROVIDER=xfyun` | 当前代码主实现 |

**角色音色**：
- 优先 `voicePresetId -> VoicePreset`
- 找不到 preset 时回退到性别默认值
- `.env` 中的发音人配置只做默认兜底，不承载项目内角色差异

**当前补充**：
- 审计运行包里会落 `voice-resolution.json / audio.index.json / dialogue-table.md / tts-metrics.json`
- 失败镜头会落 `<shotId>-error.json`

---

### Agent 9：TTS QA Agent
**文件**：`src/agents/ttsQaAgent.js`

**职责**：对配音结果做“最小自动验收”，把研发日志翻译成更容易理解的质量结论，输出 `pass / warn / block`。

**当前检查内容**：
- 音频文件是否真的生成出来
- 音频时长是否明显偏离分镜预算
- ASR 回写和原台词偏差是否过大
- 是否大量使用 fallback 声线
- 是否需要人工抽查重点镜头

**当前补充**：
- 会生成 `voice-cast-report.md / manual-review-sample.md`
- 会额外生成 `qa-summary.md / qa-summary.json`
- 如果结论是 `block`，Director 会阻断交付

---

### Agent 10：Lip-sync Agent
**文件**：`src/agents/lipsyncAgent.js`

**职责**：为需要明显说话表演的镜头生成口型同步片段，并输出可直接给小白看的风险说明。

**触发原则**：
- 有对白
- 且属于特写 / 近景 / 中景 / 明确要求口型表现的镜头

**当前补充**：
- 会输出 `lipsync.index.json / lipsync-report.md / lipsync-report.json`
- 会统计 `fallbackCount / fallbackShots / manualReviewShots`
- 只在可重试类错误上做轻量 fallback，例如 `timeout / network_error / provider_5xx`
- `provider_4xx / invalid_response` 这类问题不会盲目 fallback

---

### Agent 11：合成Agent（Video Composer）
**文件**：`src/agents/videoComposer.js`

**职责**：将图像序列 + 配音音频 + 字幕文件用FFmpeg合成最终视频。

**字幕**：自动生成ASS格式字幕文件（支持中文，微软雅黑字体，带描边）

**输出规格**：
- 分辨率：1080×1920（竖屏9:16）
- 编码：H.264 + AAC 128kbps
- 帧率：24fps
- 字幕：硬字幕嵌入

**当前补充**：
- 优先合成 `Lip-sync Clip / AnimationClip`，没有 clip 时回退为单张关键帧静态镜头
- 审计运行包里会落 `compose-plan.json / segment-index.json / video-metrics.json`
- FFmpeg 失败时会额外落 `ffmpeg-command.txt / ffmpeg-stderr.txt`

完整 Agent 文档入口见 [docs/agents/README.md](docs/agents/README.md)。

如果你更关心接手、排障、验收和提交流程，入口见 [docs/sop/README.md](docs/sop/README.md)。

最终交付目录当前统一为：

```text
output/
  项目名__projectId/
    第01集__episodeId/
      final-video.mp4
      delivery-summary.md
```

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Node.js 18+，ES Modules |
| LLM文本 | Qwen（首选）/ DeepSeek / Claude |
| LLM视觉 | 当前视觉 provider 路由 |
| 图像生成 | LaoZhang 图像路由 |
| 配音TTS | 讯飞语音合成 + 可扩展 Provider Router |
| 配音验收 | TTS QA + ASR 回写校验 |
| 口型同步 | Lip-sync Provider Router |
| 视频合成 | FFmpeg + fluent-ffmpeg |
| 并发控制 | 自定义队列 |
| 数据存储 | 本地JSON文件（MVP阶段） |

## LLM选型说明

中文剧本场景对LLM有特殊要求：理解古装/现代中文口语、人名地名识别、情感词准确提取。

| 用途 | 模型 | 优势 |
|------|------|------|
| 剧本解析/Prompt生成 | **Qwen**（首选） | 当前实测 JSON 输出更稳 |
| 文本备选 | DeepSeek | 中文能力强、成本低，但 JSON 输出稳定性波动更大 |
| 视觉一致性验证 | 视觉 LLM | 当前实现按 provider 路由调用 |
| 全能备选 | Claude Sonnet | 综合能力强，支持多模态 |

切换方式：修改 `.env` 中的 `LLM_PROVIDER` 和 `LLM_VISION_PROVIDER`。

## 文件结构

```
AI-video-factory-pro/
├── src/
│   ├── agents/
│   │   ├── director.js           # Agent 1：主编排
│   │   ├── scriptParser.js       # Agent 2：编剧
│   │   ├── characterRegistry.js  # Agent 3：角色设定
│   │   ├── promptEngineer.js     # Agent 4：视觉设计
│   │   ├── imageGenerator.js     # Agent 5：图像生成
│   │   ├── consistencyChecker.js # Agent 6：一致性验证
│   │   ├── continuityChecker.js  # Agent 7：连贯性检查
│   │   ├── ttsAgent.js           # Agent 8：配音
│   │   ├── ttsQaAgent.js         # Agent 9：配音QA
│   │   ├── lipsyncAgent.js       # Agent 10：口型同步
│   │   └── videoComposer.js      # Agent 11：合成
│   ├── llm/
│   │   ├── client.js             # 统一LLM客户端（多Provider）
│   │   └── prompts/
│   │       ├── scriptAnalysis.js
│   │       ├── promptEngineering.js
│   │       └── consistencyCheck.js
│   ├── apis/
│   │   ├── imageApi.js           # LaoZhang 图像路由
│   │   ├── ttsApi.js             # TTS Provider Router
│   │   └── lipsyncApi.js         # Lip-sync Provider Router
│   ├── domain/
│   │   ├── assetModel.js         # Keyframe / AnimationClip / Voice / Subtitle / EpisodeCut DTO
│   │   ├── characterBibleModel.js# CharacterBible DTO
│   │   ├── characterModel.js     # MainCharacterTemplate / EpisodeCharacter / ShotCharacter DTO
│   │   ├── entityFactory.js      # 通用实体构造辅助
│   │   └── projectModel.js       # Project / Script / Episode / ShotPlan DTO
│   └── utils/
│       ├── queue.js              # 并发控制与重试
│       ├── logger.js             # 日志工具
│       ├── fileHelper.js         # 文件读写工具
│       ├── jobStore.js           # RunJob / AgentTaskRun 持久化
│       ├── characterBibleStore.js# CharacterBible 项目资产存储
│       ├── projectStore.js       # project/script/episode JSON 存储
│       ├── qaSummary.js          # agent / run QA 摘要输出
│       └── runArtifacts.js       # Agent 审计成果物目录
├── scripts/
│   └── run.js                    # CLI入口
├── samples/
│   ├── test_script.txt           # 旧单文件入口示例
│   └── project-example/
│       ├── project.json          # 示例项目元数据
│       └── script.txt            # 示例原始剧本
├── tests/
│   ├── director.project-run.test.js
│   ├── jobStore.test.js
│   ├── projectModel.test.js
│   ├── projectStore.test.js
│   └── ttsAgent.test.js
├── temp/                         # 临时文件（图片、音频、状态）
├── output/                       # 最终输出视频
├── .env.example                  # 环境变量模板
└── package.json
```

### 示例项目结构

```text
samples/project-example/
├── project.json
├── script.txt
├── script.example.json
├── episode-1.example.json
└── character-bibles/
    └── bible-shenqing.json
```

`project.json` 用来说明示例中的 `projectId / scriptId / episodeId`，`script.txt` 保留原始剧本文本。`script.example.json / episode-1.example.json / character-bibles/` 用来展示结构化项目资产应该长什么样。实际运行时，项目模式读取的是 `temp/projects/...` 下预先存在的结构化 `project.json / script.json / episode.json / character-bibles/*.json` 数据，而不是直接消费这个示例目录。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入API Key（阶段1最少需要）：
- `QWEN_API_KEY` — 文本 LLM 首选
- `DEEPSEEK_API_KEY` — 文本 LLM 备选
- `LAOZHANG_API_KEY` — 图像路由
- `XFYUN_APP_ID / XFYUN_API_KEY / XFYUN_API_SECRET` — 讯飞 TTS

默认推荐：

- `LLM_PROVIDER=qwen`
- `PRIMARY_API_PROVIDER=laozhang`
- `TTS_PROVIDER=xfyun`

### 3. 安装 FFmpeg

```bash
# Windows（推荐）
winget install Gyan.FFmpeg

# 或手动下载：https://ffmpeg.org/download.html
```

### 4. 运行

```bash
# 使用测试剧本，跳过一致性验证（加速）
node scripts/run.js samples/test_script.txt --skip-consistency

# 使用3D风格
node scripts/run.js samples/test_script.txt --style=3d

# 按项目 / 剧本 / 分集运行
# 前提：temp/projects/project-example/... 下已经存在对应的结构化数据
node scripts/run.js --project=project-example --script=pilot --episode=episode-1 --style=realistic

# 完整流程（含一致性验证）
node scripts/run.js your_script.txt
```

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<script-file>` | 旧单文件入口，兼容模式 | 无 |
| `--project=<id>` | 项目标识，需与 `--script` / `--episode` 同时提供 | 无 |
| `--script=<id>` | 剧本标识，需与 `--project` / `--episode` 同时提供 | 无 |
| `--episode=<id>` | 分集标识，需与 `--project` / `--script` 同时提供 | 无 |
| `--style=realistic\|3d` | 视觉风格 | `realistic` |
| `--skip-consistency` | 跳过一致性验证 | 关闭 |
| `--provider=qwen\|deepseek\|claude` | 覆盖LLM提供商 | `.env`配置 |

## 测试与验证

当前仓库里有两类“测试”入口，它们的用途不同：

- `pnpm test`
  当前会执行 `node scripts/run-tests.js`，属于稳定的本地测试入口。
- `node --test ...`
  这是本次多项目升级新增和扩展的稳定单测入口，适合本地回归。

与角色一致性直接相关的 focused tests：

```bash
pnpm run test:character-consistency
```

与本轮 TTS / QA / Lip-sync 直接相关的 focused tests：

```bash
pnpm run test:tts
node --test tests/ttsQaAgent.test.js tests/lipsyncAgent.test.js
node --test tests/runArtifacts.test.js tests/director.project-run.test.js tests/pipeline.acceptance.test.js
```

本轮多项目升级验证使用的 focused tests：

```bash
node --test tests/projectModel.test.js
node --test tests/characterModel.test.js
node --test tests/projectStore.test.js
node --test tests/scriptParser.test.js
node --test tests/director.project-run.test.js
node --test tests/ttsAgent.test.js
node --test tests/videoComposer.test.js
node --test tests/runCli.test.js
node --test tests/jobStore.test.js
```

## 成本估算

| 服务 | 单次成本 | 月预算参考 |
|------|---------|----------|
| Qwen / DeepSeek（文本） | 取决于 provider 路由 | 按实际调用量 |
| 视觉 LLM（一致性验证） | 取决于 provider 路由 | 按实际调用量 |
| LaoZhang 图像生成 | 取决于模型与分组渠道 | 按实际调用量 |
| 讯飞TTS（配音） | 取决于字符数与套餐 | 按实际调用量 |
| FFmpeg（视频合成） | 免费 | 0 |
| **合计** | | **以当前中转站 / provider 实际计费为准** |

## 角色一致性方案

**MVP阶段（无需训练）**：
1. 角色首次出现时，生成"视觉ID卡"（`basePromptTokens`）
2. 后续每张包含该角色的图像，自动在Prompt中注入ID卡特征词
3. 生成后按角色聚合同名镜头，做角色外观一致性检查
4. 评分 < 7分时调整Prompt重新生成

**当前边界**：
- 已做：角色外观一致性
- 已做：基础连贯性检查 Agent（光照、轴线、道具承接）
- 仍未做重型能力：动作衔接识别、视线连续、多人场面调度连续性

**输入边界**：
- 只提供小说原文时，系统可以先自动拆分镜、出图，再做“弱一致性”检查
- 但如果希望角色一致性更可控，仍推荐补充 `CharacterBible`
- 原因是小说原文通常不足以稳定提供发型、服装轮廓、负向漂移词等身份锚点

**进阶阶段（可选）**：
- IP-Adapter（参考图引导生成，外观更稳定）
- LoRA微调（针对特定角色训练，最高一致性）

## MVP实施路线

**阶段1（核心流程）**
- [x] 项目结构搭建
- [ ] 配置API Keys，安装依赖
- [ ] 测试 scriptParser：输入剧本 → 验证JSON输出
- [ ] 测试 promptEngineer：分镜 → 验证Prompt质量
- [ ] 测试图像生成：生成第一批分镜图
- [ ] 测试FFmpeg合成无声视频

**阶段2（完整Pipeline）**
- [ ] 角色一致性验证闭环
- [ ] TTS配音集成
- [ ] 完整视频合成（含字幕）

**阶段3（持续优化）**
- [ ] Prompt模板库优化
- [ ] 写实 vs 3D效果对比
- [ ] 多平台格式适配（封面图、不同时长）
