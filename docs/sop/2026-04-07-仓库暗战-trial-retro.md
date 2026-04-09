# 2026-04-07 真实样例试跑复盘：仓库暗战

本文档记录对样例 `samples/仓库暗战.txt` 的一次真实试跑复盘，目的不是回答“命令有没有跑通”，而是回答：

- 当前主链实际交付表现怎样
- Phase 4 sequence 子链有没有真正起效
- 下一轮最值得改什么

## 1. 试跑结论

本轮可以归纳为一句话：

> 主链跑通并成功产出成片，但动态视频与 sequence 主链都没有真正参与交付，最终仍主要依赖静图 + TTS + mock lipsync 完成视频。

这意味着：

- `工程结果：通过`
- `Phase 4 结果：未触发`
- `产品结果：可看作一轮完整真实试跑，但不能证明 sequence 线已经在该样例上起效`

## 2. 样例与输出

- 输入样例：`samples/仓库暗战.txt`
- 最终视频：
  - [final-video.mp4](/d:/My-Project/AI-video-factory-pro/output/逆境之战__legacy_project_仓库暗战_855e4beea847/第01集__legacy_episode_仓库暗战_855e4beea847/final-video.mp4)
- 交付摘要：
  - [delivery-summary.md](/d:/My-Project/AI-video-factory-pro/output/逆境之战__legacy_project_仓库暗战_855e4beea847/第01集__legacy_episode_仓库暗战_855e4beea847/delivery-summary.md)
- 运行记录：
  - [run-job.json](/d:/My-Project/AI-video-factory-pro/temp/projects/legacy_project_仓库暗战_855e4beea847/scripts/legacy_script_仓库暗战_855e4beea847/episodes/legacy_episode_仓库暗战_855e4beea847/run-jobs/run_legacy_仓库暗战_855e4beea847_20260407032438212_cfc01954.json)
- 本轮运行状态快照：
  - [state.json](/d:/My-Project/AI-video-factory-pro/temp/legacy_仓库暗战_855e4beea847/state.json)

## 3. 这轮实际发生了什么

### 3.1 文本与图像链路

本轮脚本解析结果：

- 分镜数：`7`
- 角色数：`3`

图像链路表现：

- 首轮图像生成：`7/7`
- 一致性检查后需要重生成镜头：`6`
- 连贯性检查标记的高风险转场：`0`

这说明静态图交付链条是工作的，但一致性成本比较高。

### 3.2 动态视频主链

动态视频主链在流程上是执行了的，但交付上没有真正生效。

从 [delivery-summary.md](/d:/My-Project/AI-video-factory-pro/output/逆境之战__legacy_project_仓库暗战_855e4beea847/第01集__legacy_episode_仓库暗战_855e4beea847/delivery-summary.md) 可以直接看到：

- `Planned Video Shots: 7`
- `Generated Video Shots: 0`
- `Fallback Video Shots: 7`

从 [state.json](/d:/My-Project/AI-video-factory-pro/temp/legacy_仓库暗战_855e4beea847/state.json) 中的 `shotQaReport` 可以看到：

- `plannedShotCount: 7`
- `passedCount: 0`
- `fallbackCount: 7`
- 每个镜头的 `decisionReason` 都是 `video_unavailable`

这说明这轮不是“视频生成质量差”，而是视频结果根本没有进入可用交付状态。

## 4. Phase 4 sequence 线为什么没有体现

这轮最关键的结论在这里：

- `Planned Sequences: 0`
- `Generated Sequences: 0`
- `sequence_coverage_shot_count: 0`
- `sequence_coverage_sequence_count: 0`

也就是说：

- 这轮并不是 `Sequence QA` 把 sequence 卡死了
- 也不是 sequence 过了 QA 但 composer 没覆盖进去
- 而是 `Action Sequence Planner` 根本没有在这份样例里产出任何 sequence

从 [state.json](/d:/My-Project/AI-video-factory-pro/temp/legacy_仓库暗战_855e4beea847/state.json) 可见：

- `actionSequencePlan: []`
- `actionSequencePackages: []`
- `sequenceClipResults: []`
- `sequenceQaReport.entries: []`

所以这轮样例对我们刚做的“提高已发起 sequence 的 QA 通过率”优化，实际上没有形成真实验证机会。

## 5. 为什么这很重要

`仓库暗战` 表面上看是一个打斗样例，但当前 planner 仍没有把它识别成可做 sequence 的连续动作段。

这说明当前 Phase 4 的主要问题在这份样例上不是：

- prompt 不够强
- sequence QA 太严
- composer 没覆盖

而更像是：

- `Action Sequence Planner` 的触发规则过于保守
- 或当前脚本解析出的 shot 粒度还不足以满足 sequence 规划条件
- 或 planner 对“短促打斗 + 台词穿插”的场景识别不够敏感

## 6. 音频与口型链路

音频链路是通的，但质量层有明显告警。

从 [delivery-summary.md](/d:/My-Project/AI-video-factory-pro/output/逆境之战__legacy_project_仓库暗战_855e4beea847/第01集__legacy_episode_仓库暗战_855e4beea847/delivery-summary.md) 可见：

- `TTS QA: warn`
- `Lip-sync QA: pass`
- `TTS Warnings: ... fallback 使用率 100.0%`

本轮有台词的镜头共 4 个：

- `shot_002`
- `shot_003`
- `shot_004`
- `shot_006`

这些镜头全部使用了 fallback voice。

这不会阻断交付，但会明显拖低“真实成片观感”。

## 7. 这轮真正暴露出的 3 个问题

### 7.1 问题一：Phase 4 在该样例上没有触发

这是本轮最重要的问题。

当前结论：

- 这份样例不能用来验证“sequence 更容易过 QA”
- 因为 sequence 根本没有被规划出来

下一步应该优先看：

- `Action Sequence Planner` 为什么没识别 `shot_002 ~ shot_005` 这一段为高价值连续动作段

### 7.2 问题二：动态视频主链整体不可用

本轮所有视频镜头都 `video_unavailable`，导致：

- `Generated Video Shots: 0`
- `Fallback Video Shots: 7`

结合当前 `.env`，这轮实际很可能处于“文本 / 图像 / TTS 是实跑，视频 provider 不可用”的状态。

所以本轮更接近：

- `静图主路径实跑`
- `视频主路径工程上走到位，但结果不可用`

### 7.3 问题三：legacy 模式 artifact 路径存在漂移

本轮还有一个工程问题值得明确记账：

- [run-job.json](/d:/My-Project/AI-video-factory-pro/temp/projects/legacy_project_仓库暗战_855e4beea847/scripts/legacy_script_仓库暗战_855e4beea847/episodes/legacy_episode_仓库暗战_855e4beea847/run-jobs/run_legacy_仓库暗战_855e4beea847_20260407032438212_cfc01954.json)
  中的 `artifactRunDir` 指向了 run artifact 目录
- 但该路径在本地并不存在

也就是说：

- legacy 模式运行成功了
- 但 `run-jobs` 记录的 artifact 路径和真实落盘之间存在漂移

这会直接影响：

- QA 证据回看
- 运行复盘
- 自动化 health check

## 8. 本轮最准确的复盘口径

建议把这轮结论固定成下面这句话：

> `仓库暗战` 已成功完成一次真实试跑并产出成片，但当前交付主要依赖静图与音频链；视频主链全部回退，Phase 4 sequence 子链在该样例上未被触发，因此这轮不能作为 sequence QA 优化成效的有效验证样本。

## 9. 下一轮最值得做什么

按优先级建议如下：

1. 优先检查 `Action Sequence Planner`

- 重点看为什么 `shot_002 ~ shot_005` 这段打斗没有形成 sequence plan
- 如果 planner 不触发，后续所有 sequence prompt / QA 优化都无法在这类样例上体现价值

2. 其次恢复真实视频 provider 可用性

- 当前这轮 `video_unavailable` 太重，导致很难判断动态镜头质量
- 在 provider 真可用前，很多“动态观感”结论都会失真

3. 把 legacy 模式 artifact 路径漂移单独记成工程修复项

- 这不是观感问题
- 但它会严重影响后续复盘和自动化验收

## 10. 一眼判断版

- `命令有没有跑通：跑通了`
- `有没有最终成片：有`
- `视频主链有没有真正生效：没有`
- `Phase 4 sequence 有没有真正进入成片：没有`
- `这轮能不能验证 sequence QA 优化：不能`
- `下一轮先改什么：先看 planner 触发规则，再看视频 provider，可并行记账 artifact 路径问题`
