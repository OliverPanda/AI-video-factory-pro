# Phase 2 试跑预复盘：寒烬宫变

基于：

- 样例文件：`samples/寒烬宫变-pro.txt`
- 当前输出：`output/寒烬宫变__legacy_project_寒烬宫变_pro_cc525a977dfe/第01集__legacy_episode_寒烬宫变_pro_cc525a977dfe/final-video.mp4`
- 当前交付摘要：`output/寒烬宫变__legacy_project_寒烬宫变_pro_cc525a977dfe/第01集__legacy_episode_寒烬宫变_pro_cc525a977dfe/delivery-summary.md`
- 当前运行状态：`temp/legacy_寒烬宫变_pro_cc525a977dfe/state.json`
- 当前 run-job：`temp/projects/legacy_project_寒烬宫变_pro_cc525a977dfe/scripts/legacy_script_寒烬宫变_pro_cc525a977dfe/episodes/legacy_episode_寒烬宫变_pro_cc525a977dfe/run-jobs/run_legacy_寒烬宫变_pro_cc525a977dfe_20260404120659287_4e717e31.json`

## 结论先说

这不是一份“严格意义上的 Phase 2 最终验收复盘”，而是一份 `预复盘 / 基线复盘`。

原因很明确：

- 最终成片已经存在，运行也成功完成
- 但当前保留下来的 `state.json` 中：
  - 没有 `motionPlan`
  - 没有 `performancePlan`
  - 没有 `shotPackages`
  - 没有 `rawVideoResults`
  - 没有 `enhancedVideoResults`
  - 没有 `videoResults`
  - 没有 `shotQaReportV2`
- 同一轮 `run-job` 里也没有当前 Phase 2 的视频主链步骤

因此，这份复盘更适合作为：

- `寒烬宫变` 的现状基线
- 重新跑当前 Phase 2 主链前的对照样本

不适合作为：

- `Phase 2 已通过真实样例验收` 的最终证据

## 1. 运行摘要

- 样例：`samples/寒烬宫变-pro.txt`
- 运行时间：`2026-04-04 12:06:59` 到 `2026-04-04 12:08:00`
- 风格：`realistic`
- 是否完整跑通：`是`
- 最终视频路径：`output/寒烬宫变__legacy_project_寒烬宫变_pro_cc525a977dfe/第01集__legacy_episode_寒烬宫变_pro_cc525a977dfe/final-video.mp4`
- 当前可追溯 run-job：`run_legacy_寒烬宫变_pro_cc525a977dfe_20260404120659287_4e717e31`
- run 包目录：run-job 中仍有路径记录，但当前对应 artifact 目录已不可直接读取，证据不完整

## 2. 工程结果

从当前 `state.json`、`delivery-summary.md` 和成片文件可以确认：

- 分镜总数：`46`
- 音频结果数：`46`
- lip-sync 结果数：`46`
- compose 状态：`completed_with_warnings`
- 最终成片：`已输出`
- 成片基础参数：
  - 编码：`h264 + aac`
  - 分辨率：`1080 x 1920`
  - 帧率：`24 fps`
  - 时长：`234s`
  - 文件大小：约 `11.1 MB`

但对于 Phase 2 最关键的指标，当前证据结论如下：

- planned video shot count：`无法确认`
- generated raw video shot count：`0 / 未走当前 Phase 2 主链`
- enhanced video shot count：`0 / 未走当前 Phase 2 主链`
- qa passed video shot count：`0 / 未走当前 Phase 2 主链`
- fallback shot count：`无法按 Phase 2 口径确认`
- manual review shot count：
  - `delivery-summary` 口径：`12`
  - `lipsyncReport` 口径：`7`

## 3. 为什么判定这次不是 Phase 2 主链试跑

当前 `state.json` 显示：

- `hasMotionPlan = false`
- `hasPerformancePlan = false`
- `hasShotPackages = false`
- `hasRawVideoResults = false`
- `hasEnhancedVideoResults = false`
- `hasVideoResults = false`
- `hasShotQaReportV2 = false`
- `hasLipsyncResults = true`
- `hasComposeResult = true`

这说明这次最终交付是由旧链路资产完成的：

- 图像
- 音频
- lip-sync
- compose

而不是由当前 Phase 2 的视频主路径完成：

```text
motionPlan
-> performancePlan
-> shotPackages
-> rawVideoResults
-> enhancedVideoResults
-> shotQaReportV2
-> videoResults
-> composer
```

## 4. 现有样例暴露出的真实问题

即使不把它当作 Phase 2 最终验收，这轮样例仍然已经暴露出几个很有价值的问题：

### 4.1 当前没有拿到真实视频主链证据

这是最关键的一点。

如果不重新在当前代码上完整跑一遍，就无法回答：

- `videoResults` 是否真的稳定进入主路径
- `Motion Enhancer` 是否有效
- `Shot QA v2` 是否真的在起作用

### 4.2 TTS fallback 使用率过高

`delivery-summary.md` 里明确记录：

- fallback voice 使用率：`100%`

这会直接影响样例主观体验：

- 表演感弱
- 角色辨识度受影响
- 即使画面升级，听感也会拖后腿

### 4.3 当前结果更像“旧链路可播样例”，不是“动态镜头验证样例”

现有可确认资产显示：

- 成片可播
- lip-sync 路径存在
- 但没有 Phase 2 的视频镜头证据

所以这轮更像是：

> 旧链路完成交付，而不是 Phase 2 视频主路径完成交付。

## 5. 镜头级观察表

由于当前 Phase 2 视频 artifact 已缺失，这里只能先按“证据可确认程度”填写第一版，不做虚构判断。

| Shot ID | 类型 | 当前可确认走向 | 动态感结论 | 主要问题 | 备注 |
| --- | --- | --- | --- | --- | --- |
| shot_002 | 对白近景 | 旧链路交付 | 无法按 Phase 2 判断 | TTS fallback | 在人工抽查建议中 |
| shot_011 | 对峙特写 | 旧链路交付 | 无法按 Phase 2 判断 | 需人工复核 | lipsync manual review |
| shot_015 | 动作镜头 | 旧链路交付 | 无法按 Phase 2 判断 | 需人工复核 | lipsync manual review |
| shot_023 | 对白/情绪镜头 | 旧链路交付 | 无法按 Phase 2 判断 | TTS fallback + 人工复核 | 高优先观察 |
| shot_025 | 近景重点镜头 | 旧链路交付 | 无法按 Phase 2 判断 | 人工复核 | 高优先观察 |
| shot_029 | 近景重点镜头 | 旧链路交付 | 无法按 Phase 2 判断 | 人工复核 | 高优先观察 |
| shot_033 | 近景重点镜头 | 旧链路交付 | 无法按 Phase 2 判断 | 人工复核 | 高优先观察 |
| shot_035 | 近景重点镜头 | 旧链路交付 | 无法按 Phase 2 判断 | 人工复核 | 高优先观察 |

## 6. 模板级初步结论

这部分当前只能给“待验证”结论：

- 最稳定模板：`待当前 Phase 2 真实试跑确认`
- 最容易失败模板：`待当前 Phase 2 真实试跑确认`
- 增强收益最高模板：`待当前 Phase 2 真实试跑确认`
- fallback 最高模板：`待当前 Phase 2 真实试跑确认`

原因不是没有问题，而是：

- 当前保留证据不属于 Phase 2 视频主链
- 现在下模板级结论会把旧链路问题和新链路问题混在一起

## 7. 根因分类

基于现有证据，当前最可信的根因分类如下：

- provider 原生生成不足：
  - `暂无法确认`
- enhancement 无法补救：
  - `暂无法确认`
- shot package 提示不足：
  - `暂无法确认`
- performance template 不够细：
  - `暂无法确认`
- compose 前桥接异常：
  - `当前更像是未进入 Phase 2 视频桥接，而不是桥接后失败`
- 语音侧问题：
  - `已确认存在，且 fallback voice 使用率 100%`

## 8. 这轮复盘的有效结论

这轮真正能确认的，不是“Phase 2 效果好不好”，而是下面 4 点：

1. `寒烬宫变` 是一个合适的真实验收样例  
它有对白、情绪推进、多人动作、冲突升级，适合做 Phase 2 与后续 Phase 3 的长期基线样本。

2. 当前仓库虽然已经实现了 Phase 2，但这份样例输出还没有形成 Phase 2 完整证据链  
所以不能拿这轮成片直接宣布“Phase 2 真实样例已通过”。

3. 语音侧已经是明显短板  
即使后面视频质量提升，如果 voice 仍大量 fallback，整体商用品质也会被显著拉低。

4. 下一步最该做的不是继续猜，而是重新在当前代码上完整跑一遍 `寒烬宫变-pro`

## 9. 对 Phase 3 的输入结论

基于这份预复盘，当前给 Phase 3 的输入不是“直接开做”，而是：

- 先补一轮当前代码上的 `寒烬宫变-pro` Phase 2 真试跑
- 真试跑后再判断：
  - 单镜头是否明显变得更像镜头
  - 哪些镜头模板最弱
  - 是 provider 问题、模板问题还是增强问题

如果只基于现有证据给出方向，优先级建议是：

1. 先拿到 `寒烬宫变` 的真实 Phase 2 视频主链证据
2. 再决定 Phase 3 是否优先做：
   - `Bridge Shot`
   - 多角色动作编排
   - 更细的 performance template
3. 语音侧 fallback 要单独立项压下去，否则成片主观体验会持续受限

## 10. 建议的下一步命令

建议直接在当前代码上重新跑一轮：

```bash
node scripts/run.js samples/寒烬宫变-pro.txt --style=realistic
```

如果中途失败，优先按下面顺序排查：

1. `qa-overview.md`
2. `09f-shot-qa/1-outputs/shot-qa-report.md`
3. `10-video-composer/3-errors/`

如果只想重做视频主链：

```bash
node scripts/resume-from-step.js --step=video samples/寒烬宫变-pro.txt --dry-run --style=realistic
node scripts/resume-from-step.js --step=video samples/寒烬宫变-pro.txt --style=realistic
```

## 11. 当前对外口径

当前更准确的说法应该是：

> `寒烬宫变` 已有一版可播的旧链路样例，可作为 Phase 2 的前后对照基线；但在当前代码上，还需要重新跑出一轮完整的 Phase 2 视频主链样例，才能做最终验收和决定是否进入下一阶段。
