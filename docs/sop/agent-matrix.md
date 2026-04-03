# Agent 验收矩阵

这张表只记录最小可执行标准，不追求覆盖所有理想情况。

| Agent | 核心产物 | 通过条件 | 失败证据 | 阻断级别 | 对应测试 |
|---|---|---|---|---|---|
| Director | `manifest.json`、`timeline.json`、`output/final-video.mp4` | run 目录完整，最终状态明确；成功时存在成片 | `run-jobs/*.json`、根 `manifest.json`、`timeline.json` | `block` | [tests/director.artifacts.test.js](/d:/My-Project/AI-video-factory-pro/tests/director.artifacts.test.js)、[tests/director.project-run.test.js](/d:/My-Project/AI-video-factory-pro/tests/director.project-run.test.js)、[tests/pipeline.acceptance.test.js](/d:/My-Project/AI-video-factory-pro/tests/pipeline.acceptance.test.js) |
| Script Parser | `shots.flat.json`、`shots.table.md` | shots 非空，shot id 完整，镜头内容可读 | 空 `shots.flat.json`、坏结构、解析错误文件 | `block` | [tests/scriptParser.test.js](/d:/My-Project/AI-video-factory-pro/tests/scriptParser.test.js)、[tests/scriptParser.artifacts.test.js](/d:/My-Project/AI-video-factory-pro/tests/scriptParser.artifacts.test.js) |
| Character Registry | `character-registry.json`、`character-name-mapping.json` | 主要角色都能映射到 registry，关键角色有视觉锚点 | 角色缺失、映射漂移、fallback 过多 | `block` | [tests/characterModel.test.js](/d:/My-Project/AI-video-factory-pro/tests/characterModel.test.js)、[tests/characterBibleModel.test.js](/d:/My-Project/AI-video-factory-pro/tests/characterBibleModel.test.js)、[tests/characterBibleStore.test.js](/d:/My-Project/AI-video-factory-pro/tests/characterBibleStore.test.js) |
| Prompt Engineer | `prompts.json`、`prompt-sources.json`、`prompts.table.md` | 每个 shot 都有 prompt；角色镜头带角色锚点；fallback 比例可接受 | 空 prompt、fallback error、source 异常 | `block` | [tests/promptEngineer.artifacts.test.js](/d:/My-Project/AI-video-factory-pro/tests/promptEngineer.artifacts.test.js) |
| Image Generator | `images.index.json`、`image-metrics.json` | 关键镜头出图成功，整体成功率达标 | `retry-log.json`、`<shotId>-error.json`、低成功率 metrics | `block` | [tests/imageGenerator.artifacts.test.js](/d:/My-Project/AI-video-factory-pro/tests/imageGenerator.artifacts.test.js)、[tests/imageApi.integration.test.js](/d:/My-Project/AI-video-factory-pro/tests/imageApi.integration.test.js) |
| Consistency Checker | `consistency-report.json`、`flagged-shots.json` | 主要角色完成检查，未留下未处理高风险镜头 | 低分报告、`identityDriftTags`、未修复 flagged shots | `warn` / `block` | [tests/consistencyChecker.identity.test.js](/d:/My-Project/AI-video-factory-pro/tests/consistencyChecker.identity.test.js)、[tests/characterConsistency.acceptance.test.js](/d:/My-Project/AI-video-factory-pro/tests/characterConsistency.acceptance.test.js) |
| Continuity Checker | `continuity-report.json`、`flagged-transitions.json`、`repair-attempts.json` | 关键转场无硬违规；需修复项已关闭或降级为人工复核 | `hardViolations`、低 continuity score、repair 失败 | `warn` / `block` | [tests/continuityChecker.test.js](/d:/My-Project/AI-video-factory-pro/tests/continuityChecker.test.js)、[tests/continuityChecker.artifacts.test.js](/d:/My-Project/AI-video-factory-pro/tests/continuityChecker.artifacts.test.js)、[tests/continuityOnly.acceptance.test.js](/d:/My-Project/AI-video-factory-pro/tests/continuityOnly.acceptance.test.js) |
| TTS Agent | `voice-resolution.json`、`audio.index.json` | 所有有对白镜头都有音频；speaker 和 voice 解析合理 | 音频缺失、speaker unresolved、fallback 过高 | `block` | [tests/ttsAgent.test.js](/d:/My-Project/AI-video-factory-pro/tests/ttsAgent.test.js)、[tests/ttsAgent.artifacts.test.js](/d:/My-Project/AI-video-factory-pro/tests/ttsAgent.artifacts.test.js)、[tests/ttsAgent.voicePreset.test.js](/d:/My-Project/AI-video-factory-pro/tests/ttsAgent.voicePreset.test.js) |
| Video Composer | `compose-plan.json`、`segment-index.json`、`final-video.mp4` | 成功产出视频；镜头、时长、字幕基本完整 | `ffmpeg-command.txt`、`ffmpeg-stderr.txt`、缺失成片 | `block` | [tests/videoComposer.test.js](/d:/My-Project/AI-video-factory-pro/tests/videoComposer.test.js)、[tests/videoComposer.artifacts.test.js](/d:/My-Project/AI-video-factory-pro/tests/videoComposer.artifacts.test.js) |

## `warn` 和 `block` 的细化规则

- `Consistency Checker`
  - 主角高风险身份漂移未关闭：`block`
  - 次要角色轻微漂移或已知可接受偏差：`warn`
- `Continuity Checker`
  - 硬规则违规未关闭：`block`
  - 只有软警告：`warn`

## 使用方式

实际验收时，建议这样用这张表：

1. 先确认本轮要签收的 agent 范围
2. 先看 run 根目录 `qa-overview.md`，再看各 agent 的 `qa-summary.md`
3. 对照“通过条件”做最小核对
4. 一旦不满足，通过“失败证据”列直接跳到首查文件
5. 最后把是否 `pass / warn / block` 记录到验收结论中
