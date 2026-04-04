# Agent 文档总览

本文档作为 agents 相关内容的入口，按执行顺序列出全部 Agent，并指向更细的链路文档与主 README。

如果你现在更关心“怎么接手、怎么排障、怎么验收”，请先看 [docs/sop/README.md](/d:/My-Project/AI-video-factory-pro/docs/sop/README.md)。

从当前版本开始，大多数运行中的 agent 在产出核心成果物后，还会额外写出一份面向非研发读者的轻量 QA 摘要：

- `1-outputs/qa-summary.md`
- `2-metrics/qa-summary.json`

Director 还会在 run 根目录汇总生成：

- `qa-overview.md`
- `qa-overview.json`

如果你只想先快速判断“这一轮有没有达标、最该先看什么问题”，建议先看这两层摘要，再决定是否深入看原始证据。

## Agent 总览

| 序号 | 名称 | 关键职责 | 代码位置 |
|------|------|----------|----------|
| 1 | 导演Agent（Orchestrator） | 拆解剧本、调度子 Agent、管理状态与异常 | `src/agents/director.js` |
| 2 | 编剧Agent（Script Parser） | 将剧本解析为结构化分镜 JSON | `src/agents/scriptParser.js` |
| 3 | 角色设定Agent（Character Registry） | 生成角色视觉 ID 卡，确保跨镜头一致 | `src/agents/characterRegistry.js` |
| 4 | 视觉设计Agent（Prompt Engineer） | 为每个分镜生成图像 Prompt，注入角色/风格/镜头词 | `src/agents/promptEngineer.js` |
| 5 | 图像生成Agent（Image Generator） | 调用图像 API，批量并发出图并重试 | `src/agents/imageGenerator.js` |
| 6 | 一致性验证Agent（Consistency Checker） | 使用多模态 LLM 检查角色外观一致性并触发重生成 | `src/agents/consistencyChecker.js` |
| 7 | 连贯性检查Agent（Continuity Checker） | 检查跨分镜的基础连贯性并标记问题转场 | `src/agents/continuityChecker.js` |
| 8 | 配音Agent（TTS） | 批量合成对白音频，自动区分角色音色 | `src/agents/ttsAgent.js` |
| 9 | TTS QA Agent | 对配音结果做最小自动验收，输出 `pass / warn / block` | `src/agents/ttsQaAgent.js` |
| 10 | Lip-sync Agent | 为需要说话表演的镜头生成口型片段，并输出 fallback / 人工复核建议 | `src/agents/lipsyncAgent.js` |
| 11 | 合成Agent（Video Composer） | 图像+音频+字幕合成最终视频，生成 1080×1920 输出 | `src/agents/videoComposer.js` |

## 执行顺序

1. 导演Agent 读取剧本与运行状态，按顺序触发子 Agent。
2. 编剧Agent → 角色设定Agent → 视觉设计Agent 顺序构建分镜与 Prompt。
3. 图像生成Agent 负责批量出图，随后一致性验证Agent 检查并在必要时触发重试。
4. 一致性验证之后，连贯性检查Agent 评估跨分镜承接。
5. 配音Agent 生成对白音频，TTS QA Agent 做最小自动验收。
6. Lip-sync Agent 为需要说话表演的镜头生成口型同步片段，并给出 fallback / 人工复核信息。
7. 合成Agent 最终拼装图像、配音、口型片段与字幕。

## 详细文档入口

- [导演 Agent 详细说明](director.md)
- [编剧 Agent 详细说明（Script Parser）](script-parser.md)
- [角色设定 Agent（Character Registry）](character-registry.md)
- [视觉设计 Agent（Prompt Engineer）](prompt-engineer.md)
- [图像生成 Agent（Image Generator）](image-generator.md)
- [一致性验证 Agent（Consistency Checker）](consistency-checker.md)
- [连贯性检查 Agent（Continuity Checker）](continuity-checker.md)
- [配音 Agent（TTS）](tts-agent.md)
- [合成 Agent 详细说明（Video Composer）](video-composer.md)
- [视觉设计链路说明](visual-design.md)
- [Agent 间输入输出关系图](agent-io-map.md)
- [运行包目录示例](run-package-example.md)
- [temp/ 目录说明](../runtime/temp-structure.md)
- [output/ 目录说明](../runtime/output-structure.md)
- [SOP 总览](../sop/README.md)
- [运行排障 Runbook](../sop/runbook.md)
- [QA 验收 SOP](../sop/qa-acceptance.md)

主 README 的“Agent 详细说明”节提供整体职责、输入输出与系统架构背景，请参考：  
[README.md 中的 Agent 详细说明](../../README.md#agent-详细说明)

