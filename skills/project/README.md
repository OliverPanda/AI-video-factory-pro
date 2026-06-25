# Project Skills

这个目录存放 AI Video Factory Pro 的项目级 skills。

## Available Skills

- `ai-video-script-design`
  使用场景：拆解剧本、校验分镜字段、统一脚本输出结构时。
- `ai-video-visual-design`
  使用场景：构建角色视觉档案、生成图像 Prompt、整理一致性修正建议时。
- `ai-video-render-planning`
  使用场景：规划镜头合成、音频时间线、字幕对齐和 FFmpeg 排障时。
- `ai-video-harness-engineering`
  使用场景：重构或评审 Director / artifacts / QA gate / provider contract，确保 run 可观测、可回放、可调优时。

## Source Mapping

- `ai-video-script-design`
  来源文件：`src/agents/scriptParser.js`, `src/llm/prompts/scriptAnalysis.js`
- `ai-video-visual-design`
  来源文件：`src/agents/characterRegistry.js`, `src/agents/promptEngineer.js`, `src/llm/prompts/promptEngineering.js`, `src/agents/consistencyChecker.js`
- `ai-video-render-planning`
  来源文件：`src/agents/videoComposer.js`, `README.md`
- `ai-video-harness-engineering`
  来源文件：`docs/superpowers/specs/2026-04-17-harness-engineering-retrofit-spec.md`, `docs/superpowers/specs/2026-04-27-harness-prompt-boundaries-spec.md`, `tests/videoProviderHarness.test.js`, `tests/runArtifacts.test.js`

## 边界说明

- 这些 skills 记录的是项目规则，不是运行时代码。
- 当前阶段刻意不为 `director`、`imageGenerator`、`ttsAgent` 单独编写 skill。
- 如果运行时代码和文档不一致，优先以 `src/` 中的当前实现为准。
- 新增 provider、artifact contract 或 stop gate 时，优先补充对应 harness skill，再决定是否需要扩展其他 agent skill。
