# Agent 文档总览

本文档作为 `docs/agents/` 的入口，按当前项目真实执行顺序整理全部核心 agent / 环节，并指向对应专页。

如果你更关心：

- 运行目录和产物位置：看 [../runtime/README.md](../runtime/README.md)
- 排障、验收、交接：看 [../sop/README.md](../sop/README.md)
- 全链路输入输出：看 [agent-io-map.md](agent-io-map.md)
- 角色身份与资产绑定规则：看 [../superpowers/specs/2026-04-17-identity-resolution-regression-spec.md](../superpowers/specs/2026-04-17-identity-resolution-regression-spec.md)

## 统一身份规则

从 2026-04-17 起，当前项目统一按下面口径理解角色身份：

- `id / episodeCharacterId / mainCharacterTemplateId / characterBibleId` 是真正可绑定的稳定键
- `name` 只用于展示、日志、prompt 文本和兼容迁移
- 角色三视图、参考图、voice cast、视频参考素材都必须优先按 ID 绑定
- 看到 `episodeCharacterId || id || name`、`displayName || name`、`find(... name === ...)` 这类写法时，应默认视为高风险信号

## 先看哪层摘要

当前大多数 agent 都会额外落两层“给人直接看”的摘要：

- `1-outputs/qa-summary.md`
- `2-metrics/qa-summary.json`

Director 还会在 run 根目录再聚合：

- `qa-overview.md`
- `qa-overview.json`

如果只想先判断“这一轮能不能交付、最该先看哪里”，建议先看这两层摘要。

## 模块分层视图

当前 Agent 体系可以按模块理解成 7 层：

- 编排层：
  - `Director`
- 文本与视觉预生产层：
  - `Script Parser`
  - `Character Registry`
  - `Prompt Engineer`
  - `Image Generator`
  - `Consistency Checker`
  - `Continuity Checker`
- 单镜头视频主链：
  - `Motion Planner`
  - `Performance Planner`
  - `Video Router`
  - `Seedance Video Agent`
  - `Fallback Video Adapter`
  - `Motion Enhancer`
  - `Shot QA Agent`
- 高风险 cut 补桥子链：
  - `Bridge Shot Planner`
  - `Bridge Shot Router`
  - `Bridge Clip Generator`
  - `Bridge QA Agent`
- 连续动作段子链：
  - `Action Sequence Planner`
  - `Action Sequence Router`
  - `Sequence Clip Generator`
  - `Sequence QA Agent`
- 音频与口型子链：
  - `Dialogue Normalizer`
  - `TTS Agent`
  - `TTS QA Agent`
  - `Lip-sync Agent`
- 总装交付层：
  - `Video Composer`

## Agent 总览

| 序号 | 名称 | 关键职责 | 代码位置 | 文档 |
|------|------|----------|----------|------|
| 1 | 导演 Agent | 单一 orchestrator，负责缓存、续跑、桥接与交付 | `src/agents/director.js` | [director.md](director.md) |
| 2 | Script Parser | 剧本拆分为分集与扁平分镜 | `src/agents/scriptParser.js` | [script-parser.md](script-parser.md) |
| 3 | Character Registry | 角色建档与身份映射 | `src/agents/characterRegistry.js` | [character-registry.md](character-registry.md) |
| 4 | Prompt Engineer | 生成分镜级视觉 prompt | `src/agents/promptEngineer.js` | [prompt-engineer.md](prompt-engineer.md) |
| 5 | Image Generator | 批量出图与重生成 | `src/agents/imageGenerator.js` | [image-generator.md](image-generator.md) |
| 6 | Consistency Checker | 角色外观一致性检查 | `src/agents/consistencyChecker.js` | [consistency-checker.md](consistency-checker.md) |
| 7 | Continuity Checker | 跨镜头连贯性检查与高风险 cut 标记 | `src/agents/continuityChecker.js` | [continuity-checker.md](continuity-checker.md) |
| 8 | Dialogue Normalizer | 对白标准化、分段、时长预算 | `src/agents/dialogueNormalizer.js` | [dialogue-normalizer.md](dialogue-normalizer.md) |
| 9 | TTS Agent | 配音生成与声线解析 | `src/agents/ttsAgent.js` | [tts-agent.md](tts-agent.md) |
| 10 | TTS QA Agent | 音频时长、ASR、voice drift 与人工抽检规划 | `src/agents/ttsQaAgent.js` | [tts-qa-agent.md](tts-qa-agent.md) |
| 11 | Lip-sync Agent | 口型片段生成、降级和人工复核建议 | `src/agents/lipsyncAgent.js` | [lipsync-agent.md](lipsync-agent.md) |
| 12 | Motion Planner | 镜头类型、运镜、时长目标规划 | `src/agents/motionPlanner.js` | [motion-planner.md](motion-planner.md) |
| 13 | Performance Planner | 表演模板、生成层级、动作节拍规划 | `src/agents/performancePlanner.js` | [performance-planner.md](performance-planner.md) |
| 14 | Video Router | 组装 `shotPackages` 并决定 provider 路由 | `src/agents/videoRouter.js` | [video-router.md](video-router.md) |
| 15 | Seedance Video Agent | 调用火山方舟 `Seedance 2.0` 生成 `rawVideoResults` | `src/agents/seedanceVideoAgent.js` | [seedance-video-agent.md](seedance-video-agent.md) |
| 16 | Fallback Video Adapter | 作为兼容 provider 生成 `rawVideoResults`，用户侧通过 `VIDEO_PROVIDER=fallback_video` 选择，当前内部仍映射到 `sora2` runtime branch | `src/agents/sora2VideoAgent.js` | [fallback-video-adapter.md](fallback-video-adapter.md) |
| 17 | Motion Enhancer | 增强或透传原始视频结果 | `src/agents/motionEnhancer.js` | [motion-enhancer.md](motion-enhancer.md) |
| 18 | Shot QA Agent | 动态镜头工程验收与 motion 验收 | `src/agents/shotQaAgent.js` | [shot-qa-agent.md](shot-qa-agent.md) |
| 19 | Bridge Shot Planner | 只为高风险 cut 规划桥接镜头 | `src/agents/bridgeShotPlanner.js` | [bridge-shot-planner.md](bridge-shot-planner.md) |
| 20 | Bridge Shot Router | 组装 `bridgeShotPackages` | `src/agents/bridgeShotRouter.js` | [bridge-shot-router.md](bridge-shot-router.md) |
| 21 | Bridge Clip Generator | 生成 bridge clip 或返回可解释失败 | `src/agents/bridgeClipGenerator.js` | [bridge-clip-generator.md](bridge-clip-generator.md) |
| 22 | Bridge QA Agent | 决定 `pass / direct_cut / transition_stub / manual_review` | `src/agents/bridgeQaAgent.js` | [bridge-qa-agent.md](bridge-qa-agent.md) |
| 23 | Action Sequence Planner | 识别高价值连续动作段并生成 `actionSequencePlan` | `src/agents/actionSequencePlanner.js` | [action-sequence-planner.md](action-sequence-planner.md) |
| 24 | Action Sequence Router | 组装 `actionSequencePackages` 并选择参考素材层级 | `src/agents/actionSequenceRouter.js` | [action-sequence-router.md](action-sequence-router.md) |
| 25 | Sequence Clip Generator | 生成连续动作段视频并记录 provider 失败分类 | `src/agents/sequenceClipGenerator.js` | [sequence-clip-generator.md](sequence-clip-generator.md) |
| 26 | Sequence QA Agent | 决定 sequence 是否可覆盖原始 shot timeline | `src/agents/sequenceQaAgent.js` | [sequence-qa-agent.md](sequence-qa-agent.md) |
| 27 | Video Composer | 以 `sequence > video > bridge > lipsync > animation > image` 合成成片 | `src/agents/videoComposer.js` | [video-composer.md](video-composer.md) |

## 当前执行顺序

1. `Director` 读取剧本或 `project / script / episode`，初始化 `state.json`、run package 和可观测产物。
2. `Script Parser` 生成扁平 `shots`、角色抽取结果和镜头表。
3. `Character Registry -> Character Ref Sheet Generator -> Prompt Engineer -> Image Generator` 完成角色建档、角色三视图、prompt 生成和首轮出图。
4. `Consistency Checker` 检查角色外观一致性，必要时由 `Director` 触发重生成。
5. `Continuity Checker` 标记高风险 cut，为后续 `Motion Planner` 和 bridge 子链提供输入。
6. `Motion Planner -> Performance Planner -> Video Router -> Seedance / Fallback Video Adapter -> Motion Enhancer -> Shot QA Agent` 形成动态镜头主链。
7. `Dialogue Normalizer -> TTS Agent -> TTS QA Agent -> Lip-sync Agent` 形成音频与表演链。
8. `Bridge Shot Planner -> Bridge Shot Router -> Bridge Clip Generator -> Bridge QA Agent` 只在高风险 cut 上按需触发。
9. `Action Sequence Planner -> Action Sequence Router -> Sequence Clip Generator -> Sequence QA Agent` 只在高价值连续动作段上按需触发，默认沿用当前 `Seedance` 主视频 provider，显式 `fallback video` 仍兼容，内部仍映射到 `sora2` runtime branch。
10. `Video Composer` 消费 `sequenceClips + videoResults + bridgeClips + lipsyncResults + animationClips + imageResults` 完成合成。

## Phase 4 新增的排查入口

如果你现在重点在调 `action sequence` 主链，建议固定按下面顺序看：

1. `09l-action-sequence-router/2-metrics/action-sequence-routing-metrics.json`
   先判断有没有大量 `skip_generation`，以及 `skipReasonBreakdown` 主要卡在哪类素材缺口
2. `09n-sequence-qa/2-metrics/sequence-qa-metrics.json`
   先看 `topFailureCategory` 和 `topRecommendedAction`，判断这轮应优先补 prompt、补参考、还是直接回退
3. `10-video-composer/2-metrics/video-metrics.json`
   看 `sequence_coverage_shot_count / applied_sequence_ids / fallback_shot_ids`
4. 分集 `delivery-summary.md`
   看 run 级 `sequence_coverage_sequence_count / applied_sequence_ids / fallback_sequence_ids`

当前口径可以简单理解成：

- `Action Sequence Router`
  负责解释“为什么没发 sequence 请求”
- `Sequence QA Agent`
  负责解释“为什么 sequence 没过”
- `Video Composer`
  负责解释“哪些 sequence 最终真的进了成片”

## 最常用文档

- [Agent 间输入输出关系图](agent-io-map.md)
- [运行包目录示例](run-package-example.md)
- [视觉设计链路说明](visual-design.md)
- [配音链路说明](tts-agent.md)
- [合成 Agent 详细说明](video-composer.md)

## 单 Agent 生产向测试

当前仓库保留的常用单 agent production-style 测试入口：

- `npm run test:script-parser:prod`
- `npm run test:character-registry:prod`
- `npm run test:prompt-engineer:prod`
- `npm run test:image-generator:prod`
- `npm run test:consistency-checker:prod`
- `npm run test:continuity-checker:prod`
- `npm run test:tts-agent:prod`
- `npm run test:tts-qa:prod`
- `npm run test:lipsync-agent:prod`
- `npm run test:video-composer:prod`
- `npm run test:director:prod`

如果要保留成果物，使用对应的 `:keep-artifacts` 版本。

## 相关文档

- [仓库 README](../../README.md)
- [运行时目录文档](../runtime/README.md)
- [SOP 总览](../sop/README.md)
