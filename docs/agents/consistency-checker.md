# 一致性验证 Agent（Consistency Checker）

本文档基于 [src/agents/consistencyChecker.js](/d:/My-Project/AI-video-factory-pro/src/agents/consistencyChecker.js)，重点解释当前实现里“角色一致性 / 连贯性”这层到底做什么、怎么做、产出什么证据。

## 先说结论

当前这个 Agent 的真实职责是：

- 检查同一角色在多张分镜图中的外观一致性
- 输出身份漂移标签与锚点摘要
- 给出评分、问题图索引和重生成建议
- 为导演提供“哪些镜头该重画”的决策依据

它**还不是**一个完整的“时序连贯性 Agent”。

也就是说，它现在更偏：

- 角色外观一致性
  - 发型
  - 脸型
  - 服装
  - 明显可视特征

而不是严格意义上的：

- 镜头语言连贯性
- 动作衔接连续性
- 视线方向连续性
- 180 度线 / 场面调度连续性

如果后面要做真正的“镜头连贯性 Agent”，建议在它之外单独建一层，不要混在当前 `Consistency Checker` 里。

## 负责什么

1. 按角色聚合同一角色出现过的镜头图像。
2. 对每个角色做多模态一致性评分。
3. 找出低于阈值的镜头，并返回给导演重生成。
4. 把报告、标记镜头、批次失败证据落到审计目录。

## 入口函数

- `checkCharacterConsistency(characterName, characterCard, imageList, options)`
- `runConsistencyCheck(characterRegistry, imageResults, deps)`

## 输入

`runConsistencyCheck(...)` 的核心输入：

- `characterRegistry`
  - 来自 Character Registry 的角色档案
- `imageResults`
  - 图像生成结果数组
  - 典型字段有 `shotId`、`imagePath`、`success`、`characters`
- `deps.checkCharacterConsistency`
  - 可注入测试替身
- `deps.artifactContext`
  - 可审计运行包上下文

## 核心流程

1. 遍历 `characterRegistry`。
2. 对每个角色，从 `imageResults` 里筛出：
   - `success === true`
   - `characters` 包含该角色名
3. 每个角色调用 `checkCharacterConsistency(...)`。
4. 如果 `overallScore < CONSISTENCY_THRESHOLD`，把问题镜头加入 `needsRegeneration`。

## 批量策略

当前实现不是一次把所有图都塞进视觉模型，而是分批：

- `CONSISTENCY_BATCH_SIZE`
  - 默认 `6`
- 每批单独调用 `visionChat(...)`
- 多批结果做平均分
- `problematicImageIndices` 会做全局偏移后再去重

这是为了避免：

- 单次 base64 过大
- 多图请求太重导致视觉模型失败

## 跳过与失败策略

### 有效图不足 2 张

如果某角色有效图片小于 2 张：

- 直接跳过
- 返回 `skipped: true`
- 默认 `overallScore: 10`

### 某个批次失败

如果某一批视觉检查失败：

- 记录 warning
- 跳过该批
- 继续处理剩余批次

### 所有批次都失败

如果所有批次都失败：

- 返回一个保守报告
- `overallScore: 10`
- `error: '所有批次均失败'`

这是一种“不中断主流程”的设计取向。  
优点是流程稳；缺点是如果视觉模型持续坏掉，可能会把问题伪装成“高分跳过”。所以这一步的审计证据非常重要。

## 可审计成果物

传入 `artifactContext` 时，会落这些文件：

- `0-inputs/character-registry.json`
- `0-inputs/image-results.json`
- `1-outputs/consistency-report.json`
- `1-outputs/consistency-report.md`
- `1-outputs/flagged-shots.json`
- `2-metrics/consistency-metrics.json`
- `3-errors/<character>-batch-<n>-error.json`
- `manifest.json`

其中最关键的是：

- `consistency-report.json`
  - 每个角色的评分、建议、问题索引、`identityDriftTags`、`anchorSummary`
- `flagged-shots.json`
  - 导演真正会消费的“哪些镜头该重生成”
- `consistency-report.md`
  - 给人快速 review
- `<character>-batch-<n>-error.json`
  - 保留失败批次的角色名、批次号、镜头列表、错误信息

## 当前 metrics

- `checked_character_count`
- `checked_shot_count`
- `flagged_shot_count`
- `avg_consistency_score`
- `identity_drift_tag_counts`
- `regeneration_count`

## 新增的身份漂移信号

当前报告会优先沉淀这些“可量化漂移标签”：

- `hair_drift`
- `outfit_drift`
- `palette_drift`
- `age_feel_drift`

如果后面要做更细的质检面板，这几个标签会是第一批可直接聚合统计的字段。

## 它和导演的关系

这个 Agent 不直接重画图。

真正的闭环是：

1. `Consistency Checker` 输出 `needsRegeneration`
2. `Director` 拿到这个列表
3. `Director` 在原 prompt 基础上追加一致性提示
4. `Director` 调 `imageGenerator.regenerateImage(...)`

所以这个 Agent 更像“质检 + 建议器”，不是执行器。

## 常见问题

### 角色一致性和镜头连贯性是不是一回事

不是。

当前实现只做“同角色跨图外观一致性”。  
如果你要检查镜头动作衔接、构图连续、视线匹配，那是另一个问题域。

### 为什么一致性检查按角色，而不是按 shot 对 shot

因为当前目标是避免同一个角色在不同镜头里长相漂移。按角色聚合，比按镜头对更贴近这个目标。

### 为什么有时没有触发重生成

常见原因：

- 有效图不足 2 张，被跳过
- 分数没有低于阈值
- 视觉检查批次全失败，但流程采取了保守返回

## 不负责的内容

- 不负责真正出图
- 不负责决定图像模型
- 不负责时序连贯性 / 场面调度连续性
- 不负责音频与视频合成

## 相关文档

- [导演 Agent 详细说明](director.md)
- [图像生成 Agent（Image Generator）](image-generator.md)
- [视觉设计链路说明](visual-design.md)
