# Project Skills

这个目录存放 AI Video Factory Pro 的项目级 skills。

## Available Skills

- `ai-video-script-design`
  使用场景：拆解剧本、校验分镜字段、统一脚本输出结构时。
- `ai-video-visual-design`
  使用场景：构建角色视觉档案、生成图像 Prompt、整理一致性修正建议时。
- `ai-video-render-planning`
  使用场景：规划镜头合成、音频时间线、字幕对齐和 FFmpeg 排障时。

## Source Mapping

- `ai-video-script-design`
  来源文件：`src/agents/scriptParser.js`, `src/llm/prompts/scriptAnalysis.js`
- `ai-video-visual-design`
  来源文件：`src/agents/characterRegistry.js`, `src/agents/promptEngineer.js`, `src/llm/prompts/promptEngineering.js`, `src/agents/consistencyChecker.js`
- `ai-video-render-planning`
  来源文件：`src/agents/videoComposer.js`, `README.md`

## 边界说明

- 这些 skills 记录的是项目规则，不是运行时代码。
- 当前阶段刻意不为 `director`、`imageGenerator`、`ttsAgent` 单独编写 skill。
- 如果运行时代码和文档不一致，优先以 `src/` 中的当前实现为准。
