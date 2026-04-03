# QA 验收 SOP

这份文档定义一轮 run 的最小可执行验收规则。

它不替代 agent 详细文档；它只关心：

- 能不能签收
- 哪些问题只是提醒
- 哪些问题必须阻断交付

## 判定语义

- `pass`
  核心产物存在，满足最小通过条件，没有未关闭阻断项
- `warn`
  产物存在，但有偏差或风险，需要在验收记录中显式保留证据
- `block`
  核心产物缺失、关键质量失败，或该问题会阻断交付

## 全局发布门槛

一轮 run 只有在下面条件都满足时才可放行：

- 所有 `block` 级 agent 均为 `pass`
- 没有未关闭的关键错误证据
- 最终交付物存在

允许带 `warn` 放行，但必须：

- 记录具体 agent
- 记录证据文件路径
- 记录为什么允许放行

## 人工验收顺序

建议统一按这个顺序做人工验收：

1. 看 `run-jobs/*.json`
2. 看 `delivery-summary.md`
3. 看 [agent-matrix.md](agent-matrix.md) 对应的通过条件
4. 逐层抽查关键产物
5. 如果有异常，再看对应 `3-errors/`

## 一次验收最少要附的证据

至少保留这些路径：

- `run-jobs/<runJobId>.json`
- `delivery-summary.md`
- 触发判定的关键产物文件
- 对应 agent 的 `manifest.json`

如果本轮存在 `warn` 或 `block`，还要附：

- 对应 `3-errors/` 下的原始错误文件
- 需要人工判断的表格或报告

## 抽查优先级

如果时间有限，优先人工抽查下面 5 份：

- `01-script-parser/1-outputs/shots.table.md`
- `03-prompt-engineer/1-outputs/prompts.table.md`
- `05-consistency-checker/1-outputs/consistency-report.md`
- `06-continuity-checker/1-outputs/continuity-report.md`
- `07-tts-agent/1-outputs/dialogue-table.md`

## 常见放行规则

适合记 `warn` 的情况：

- 次要角色出现轻微身份漂移，但主角稳定
- continuity 只有软警告，没有硬违规
- 默认 voice fallback 存在，但听感可接受
- Prompt 有少量 fallback，但最终图像质量正常

适合记 `block` 的情况：

- `final-video.mp4` 缺失
- 主角镜头存在明显身份漂移且未修复
- continuity 出现硬违规且仍未关闭
- 有对白镜头音频缺失或说话者明显错误
- 关键镜头未成功出图

## 测试与验收的关系

自动化测试不能替代人工验收，但它可以快速证明两件事：

- artifact contract 没坏
- 主链路关键步骤仍可执行

每个 agent 对应的推荐测试见 [agent-matrix.md](agent-matrix.md)。

## 当前已知限制

当前仓库尚未实现统一的 `qa auditor` 运行时 agent，因此：

- `pass / warn / block` 仍由人工按本 SOP 判断
- 需要人工把问题与证据文件路径关联起来
