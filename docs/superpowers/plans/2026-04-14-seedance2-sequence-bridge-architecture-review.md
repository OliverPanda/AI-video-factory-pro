# Seedance 2.0 Sequence / Bridge Architecture Review

日期：2026-04-14

## 背景

本次审查基于当前仓库实现，模拟“字节跳动旗下 AIGC 视频团队”的内部方案评审口径，审查主题为：

- 在 `Seedance 2.0` 能力增强的前提下，是否还需要保留 `sequence` 连续动作段
- 是否还需要保留 `bridge` 补桥
- 是否应该收口为单一视频 provider client

本结论不是字节真实意见，而是基于当前代码、现有设计文档和公开能力边界做的高标准审查。

## 审查结论

- `sequence` 需要保留，并建议提升为 `Seedance 2.0` 主能力承接层
- `bridge` 需要保留，但建议收缩为“段间过渡与高风险 cut 修复层”
- `fallback_video` 的用户侧语义建议收口，但必须先统一底层 provider client，再收口业务流程
- 当前方向可以继续推进，但不建议直接大改主链；应先完成能力对齐、互斥规则和真实样本验证

一句话结论：

> 不是删除 `sequence` 和 `bridge`，而是把 `sequence` 前置、把 `bridge` 收缩，并把底层视频调用统一到单一 provider client。

## 审查依据

### 1. Seedance 2.0 的能力边界

公开资料显示，`Seedance 2.0` 已强调：

- 更强的复杂运动、复杂交互、主体一致性与镜头语言控制
- 支持多模态输入，包含文本、图片、视频、音频
- 支持最多 `9` 张图、`3` 段视频、`3` 段音频、最长 `15` 秒
- 支持续拍、延拍、镜头段级连续性

这些能力意味着：

- `sequence` 这类“把一段动作当成完整输入单元”的能力更有价值
- `bridge` 的必要性下降，但不会完全消失

参考资料：

- <https://developer.volcengine.com/articles/7606009619928449070>
- <https://developer.volcengine.com/articles/7622325633040793641>

### 2. 当前仓库里 `sequence` 的真实职责

当前 `sequence` 不是“多余补丁”，而是在把多 shot 组织成完整动作段：

- 识别连续动作类型：[`actionSequencePlanner.js`](d:/My-Project/AI-video-factory-pro/src/agents/actionSequencePlanner.js)
- 组织参考图、参考视频、bridge 参考、entry/exit 约束：[`actionSequenceRouter.js`](d:/My-Project/AI-video-factory-pro/src/agents/actionSequenceRouter.js)
- 生成完整 sequence clip：[`sequenceClipGenerator.js`](d:/My-Project/AI-video-factory-pro/src/agents/sequenceClipGenerator.js)

因此，`sequence` 解决的是“段内连续性”，这与单镜头视频链并不等价。

### 3. 当前仓库里 `bridge` 的真实职责

当前 `bridge` 不是简单 QA 修补，而是在处理段间切口的镜头语言问题：

- 识别 `motion_carry / camera_reframe / spatial_transition / emotional_transition`：[`bridgeShotPlanner.js`](d:/My-Project/AI-video-factory-pro/src/agents/bridgeShotPlanner.js)
- 绑定前后镜头参考图与能力要求：[`bridgeShotRouter.js`](d:/My-Project/AI-video-factory-pro/src/agents/bridgeShotRouter.js)
- 生成桥接视频片段：[`bridgeClipGenerator.js`](d:/My-Project/AI-video-factory-pro/src/agents/bridgeClipGenerator.js)

因此，`bridge` 解决的是“段间连续性”，不能被简单视为“低质量时补一下”。

## 关键问题

### 1. 当前 `seedance` 与 `fallback_video` 仍高度耦合

当前实现中，名义上的 `seedance` 主链并没有完全独立：

- [`seedanceVideoAgent.js`](d:/My-Project/AI-video-factory-pro/src/agents/seedanceVideoAgent.js) 仍复用 `createFallbackVideoClip`
- [`sequenceClipGenerator.js`](d:/My-Project/AI-video-factory-pro/src/agents/sequenceClipGenerator.js) 的 `seedance` workflow 也复用 fallback client
- [`bridgeClipGenerator.js`](d:/My-Project/AI-video-factory-pro/src/agents/bridgeClipGenerator.js) 里的 `seedance` bridge 仍走 fallback 包装

这意味着：

- 当前“主 Seedance 路径”和“fallback 路径”在业务语义上已经分开
- 但在实际 provider 调用实现上还没有真正分开

如果不先统一 provider client，后续的 `sequence` 前置和 `bridge` 收缩很容易只变成“换命名”，而不是能力升级。

### 2. 缺少 sequence 与 bridge 的互斥规则

如果 `sequence` 前置，必须明确定义：

- 被 `sequence` 覆盖的 shot，不再在 sequence 内部继续规划 bridge
- `bridge` 只允许出现在 sequence 边界或非 sequence 区域
- composer 不能同时把同一段内容按 `sequence + shot + bridge` 重复消费

否则会造成：

- 双生成
- 双花费
- timeline 冲突

### 3. 缺少真实样本驱动的收口指标

当前还没有足够证据说明：

- `sequence` 覆盖后到底能替代多少 `bridge`
- 哪些桥接场景仍然必须保留
- 总调用成本、时延和成片质量是否真的改善

因此，`bridge` 的收缩幅度不能靠主观判断决定，必须由真实样本数据决定。

## 推荐方向

### 1. `sequence` 保留并前置

建议将 `sequence` 提升为 `Seedance 2.0` 的主增益层：

- 连续动作段优先走 `sequence`
- 单镜头只处理真正独立、短促、不需要整段连续性的 shot
- composer 的视觉优先级保持 `sequence > shot video > bridge`

### 2. `bridge` 保留但缩窄

建议将 `bridge` 从“常规连续性子链”收缩为：

- 段间过渡器
- 高风险 cut 修复器
- sequence 失败后的保守回退层

不建议把 `bridge` 直接收缩成纯 QA 补丁，因为：

- `spatial_transition`
- `emotional_transition`
- `camera_reframe`

这些本质上仍属于镜头语法的一部分，而不是简单错误恢复。

### 3. 先统一 provider client，再统一用户口径

推荐顺序：

1. 统一底层视频 provider client
2. 统一 `shot / bridge / sequence` 的提交、轮询、下载、错误分类
3. 再移除用户侧 `fallback_video` 语义
4. 最后再清理旧命名和旧兼容层

## 推荐决策

建议采用以下正式口径：

- `sequence`：保留，提升为主路径能力
- `bridge`：保留，缩窄为段间与高风险切口修复层
- `fallback_video`：对用户隐藏，内部逐步收敛
- `provider client`：统一成单底座

## 不建议立即做的事

- 不建议直接删除 `bridge`
- 不建议先删 `fallback_video` 再做 client 收口
- 不建议在没有真实样本验证的情况下大幅降低 bridge 触发率

## 下一步建议

建议按以下顺序推进：

1. 设计统一视频 provider client 协议
2. 明确 `shot / sequence / bridge` 的职责边界与互斥规则
3. 让 `sequence` 成为 `Seedance 2.0` 主路径的正式承接层
4. 跑真实样本，统计 bridge 的剩余必要性
5. 再决定 bridge 收缩幅度和是否移除 `fallback_video` 用户口径

## 当前落地状态

截至本轮实现，仓库内已经完成的收口动作包括：

- 已引入统一视频 provider client：[`unifiedVideoProviderClient.js`](d:/My-Project/AI-video-factory-pro/src/apis/unifiedVideoProviderClient.js)
- `shot / sequence / bridge` 三条生成链已开始统一走同一 client 协议
- `sequence` 默认主路径已切到统一 client 语义，不再默认落回旧 `seedance` workflow 命名
- `bridge` 在 planner 与 director compose 两层都开始避开 sequence 内部切口

仍待继续观察与验证的部分：

- `fallback_video` 用户侧口径目前还是兼容保留，并未彻底删除
- director 主流程中的 `bridge -> sequence` 编排顺序还可以继续优化为更强的 sequence-first 规划
- 仍需用真实样本验证 bridge 收缩后的覆盖率、成本与时延表现

配套 agent 执行方案见：

- [2026-04-14-seedance2-single-provider-sequence-first-implementation.md](d:/My-Project/AI-video-factory-pro/docs/superpowers/plans/2026-04-14-seedance2-single-provider-sequence-first-implementation.md)
