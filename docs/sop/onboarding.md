# 接手 SOP

这份文档面向两类人：

- 第一次接手本仓库的开发者
- 需要快速建立工作上下文的 AI 代理

目标不是讲完整原理，而是用最短路径确认：

- 仓库能不能跑
- 主要入口在哪里
- 改动某层时应该去看哪里

## 第一天先看什么

按这个顺序读：

1. [README.md](/d:/My-Project/AI-video-factory-pro/README.md)
2. [docs/agents/README.md](/d:/My-Project/AI-video-factory-pro/docs/agents/README.md)
3. [docs/agents/agent-io-map.md](/d:/My-Project/AI-video-factory-pro/docs/agents/agent-io-map.md)
4. [docs/runtime/temp-structure.md](/d:/My-Project/AI-video-factory-pro/docs/runtime/temp-structure.md)
5. [src/agents/director.js](/d:/My-Project/AI-video-factory-pro/src/agents/director.js)

如果你只需要理解某条链路，再补看对应 agent 专页：

- 分镜解析：`script-parser.md`
- 视觉链路：`character-registry.md`、`prompt-engineer.md`、`image-generator.md`
- 质量链路：`consistency-checker.md`、`continuity-checker.md`
- 音频和合成：`tts-agent.md`、`video-composer.md`

## 最小环境检查

开始前先确认：

- Node.js 版本满足 [package.json](/d:/My-Project/AI-video-factory-pro/package.json) 的 `>=18`
- 已安装依赖
- `.env` 存在并包含本次运行需要的 provider 配置
- FFmpeg 可用
- `temp/` 与 `output/` 可写

最小关注的环境变量：

- `IMAGE_STYLE`
- `LLM_PROVIDER`
- `PRIMARY_API_PROVIDER`
- `TTS_PROVIDER`
- `MINIMAX_API_KEY`
- `MINIMAX_GROUP_ID`
- `OUTPUT_DIR`
- `TEMP_DIR`

## 最小运行路径

如果你只是验证仓库没有完全坏掉，优先用兼容模式：

```bash
node scripts/run.js samples/test_script.txt --skip-consistency
```

注意：

- 当前 `--skip-consistency` 会同时跳过 `consistency check` 和 `continuity check`
- 这条命令更适合验证主链路通不通，不适合验证质量链路

如果你要验证项目模式入口，再跑：

```bash
node scripts/run.js --project=project-example --script=pilot --episode=episode-1 --style=realistic
```

前提是 `temp/projects/...` 下已经准备好结构化项目数据。

## 最小测试集

接手第一天不需要把所有测试都跑完，先跑最小信心集：

```bash
pnpm test
```

如果你正在处理一致性与 continuity 相关问题，再补：

```bash
pnpm run test:character-consistency
```

如果你只改了某一层，优先跑和它直接对应的 focused tests，映射见 [agent-matrix.md](agent-matrix.md)。

## 关键入口文件

- 总编排入口：[src/agents/director.js](/d:/My-Project/AI-video-factory-pro/src/agents/director.js)
- CLI 入口：[scripts/run.js](/d:/My-Project/AI-video-factory-pro/scripts/run.js)
- RunJob 持久化：[src/utils/jobStore.js](/d:/My-Project/AI-video-factory-pro/src/utils/jobStore.js)
- 审计运行包目录：[src/utils/runArtifacts.js](/d:/My-Project/AI-video-factory-pro/src/utils/runArtifacts.js)
- 临时目录与输出目录规则：[src/utils/fileHelper.js](/d:/My-Project/AI-video-factory-pro/src/utils/fileHelper.js)

## 按目标找文件

- 想改剧本解析
  看 [src/agents/scriptParser.js](/d:/My-Project/AI-video-factory-pro/src/agents/scriptParser.js)
- 想改角色视觉身份或说话者解析
  看 [src/agents/characterRegistry.js](/d:/My-Project/AI-video-factory-pro/src/agents/characterRegistry.js)
- 想改 Prompt 规则或 continuity prompt 修复
  看 [src/agents/promptEngineer.js](/d:/My-Project/AI-video-factory-pro/src/agents/promptEngineer.js)
- 想改生图重试或 provider 结果
  看 [src/agents/imageGenerator.js](/d:/My-Project/AI-video-factory-pro/src/agents/imageGenerator.js)
- 想改一致性规则
  看 [src/agents/consistencyChecker.js](/d:/My-Project/AI-video-factory-pro/src/agents/consistencyChecker.js)
- 想改连贯性规则和修复建议
  看 [src/agents/continuityChecker.js](/d:/My-Project/AI-video-factory-pro/src/agents/continuityChecker.js)
- 想改声线解析或 TTS 行为
  看 [src/agents/ttsAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/ttsAgent.js)
- 想改最终视频交付
  看 [src/agents/videoComposer.js](/d:/My-Project/AI-video-factory-pro/src/agents/videoComposer.js)

## 接手完成的最低标准

满足下面 4 条，就算完成了最小接手：

- 你知道主入口是 `director`
- 你知道一次 run 的轻量记录先看 `run-jobs/*.json`
- 你知道完整证据包在 `runs/<runDir>/`
- 你知道自己当前修改对应的 focused tests 是哪几个
