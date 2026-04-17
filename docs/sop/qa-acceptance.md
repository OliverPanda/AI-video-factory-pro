# QA 验收 SOP

这份文档定义一轮 run 的最小可执行验收规则。

它不替代 agent 详细文档；它只关心：

- 能不能签收
- 哪些问题只是提醒
- 哪些问题必须阻断交付

在当前项目里，验收时还要额外盯住一个横切原则：

- 任何角色、参考图、voice cast、三视图、视频参考素材，都必须优先按稳定 ID 绑定
- 如果某个模块只能回答“我是按名字猜的”，默认就不是通过态

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
- 三视图生成失败，导致后续角色参考锚点不成立
- 角色资产、voice cast、参考图出现“同名不同人”或“中英文名被拆成两个人”的绑定错误
- continuity 出现硬违规且仍未关闭
- 有对白镜头音频缺失或说话者明显错误
- 关键镜头未成功出图

## 测试与验收的关系

自动化测试不能替代人工验收，但它可以快速证明两件事：

- artifact contract 没坏
- 主链路关键步骤仍可执行

每个 agent 对应的推荐测试见 [agent-matrix.md](agent-matrix.md)。

## 当前运行时 QA 能力

当前仓库已经补上一层轻量统一 QA 汇总：

- 每个已接入的 agent 会在自己的目录下输出：
  - `1-outputs/qa-summary.md`
  - `2-metrics/qa-summary.json`
- Director 会在 run 根目录汇总输出：
  - `qa-overview.md`
  - `qa-overview.json`

这层汇总的目标不是替代原始证据，而是让非研发或新同学也能先快速回答：

- 这个 agent 达标了吗
- 是提醒还是阻断
- 应该先看哪份证据

从这次 harness 改造开始，`qa-overview.md` 还会额外带一段 `Run Debug Signals`，可以直接看：

- 卡点步骤
- 缓存步骤
- 跳过步骤
- 人工复核步骤
- 预览输出和最近错误

如果是三视图失败、TTS QA block、lip-sync block 这类高成本失败，原则上都应该直接停，不要继续往下跑。

但它仍然是“轻量 QA 总结”，不是全自动签收系统，所以：

- 最终是否放行，仍要结合原始成果物和错误证据判断
- 遇到 `warn / block` 时，仍建议回看对应 agent 的原始报告和 `3-errors/`
