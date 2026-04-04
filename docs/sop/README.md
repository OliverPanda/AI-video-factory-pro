# SOP 总览

这组文档专门回答“怎么执行”：

- 开发者或 AI 新接手仓库时先看什么、先跑什么
- 一次运行失败后先去哪里找证据、怎么重跑
- QA 如何按 agent 做最小可执行验收
- 小白先看哪几份 QA 摘要，能快速判断这一轮是否达标
- 改动任一 agent 后，提交前至少要补哪些验证

它和 [docs/agents/README.md](/d:/My-Project/AI-video-factory-pro/docs/agents/README.md) 的分工如下：

- `docs/agents/*.md`
  负责职责、边界、输入输出、产物说明
- `docs/sop/*.md`
  负责接手、运行、排障、验收、变更流程

当前推荐的 QA 阅读顺序：

1. 先看 run 根目录 `qa-overview.md`
2. 再看对应 agent 的 `qa-summary.md`
3. 最后再下钻 `manifest.json / 3-errors/`

这样非研发也能先看懂“过没过、风险在哪”，研发再继续看原始证据。

## 导航

- [接手 SOP](onboarding.md)
- [运行排障 Runbook](runbook.md)
- [QA 验收 SOP](qa-acceptance.md)
- [TTS 落地方案（2026-04）](2026-04-03-tts-landing-plan.zh-CN.md)
- [Agent 验收矩阵](agent-matrix.md)
- [变更检查清单](change-checklist.md)

## 什么时候看哪份

- 想快速接手仓库
  先看 [接手 SOP](onboarding.md)
- 任务跑挂了，想知道先查哪里
  先看 [运行排障 Runbook](runbook.md)
- 想判断这轮 run 能不能签收
  先看 [QA 验收 SOP](qa-acceptance.md) 和 [Agent 验收矩阵](agent-matrix.md)
- 改了某个 agent，准备提测或提交
  先看 [变更检查清单](change-checklist.md)
