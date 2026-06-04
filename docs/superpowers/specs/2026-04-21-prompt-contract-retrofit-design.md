# Prompt Contract Retrofit Design

## 背景

当前项目的 prompt 体系已经覆盖：

- 角色建档
- 角色三视图
- 分镜图生成
- 一致性 QA
- Seedance shot / sequence / bridge

但从调研看，现有写法更像“运行台账 + 长文本拼接”，还不是成熟的 prompt contract 体系。主要问题是：

1. 同一类信息会在多个步骤重复展开，容易漂移
2. execution prompt 和 UI display prompt 还没有彻底分层
3. 稳定信息散落在自然语言里，不利于复用和切换供应商
4. prompt 的可测性不够强，缺少固定槽位和版本边界

本次设计目标不是把 prompt 写得更长，而是把 prompt 改成更稳、更可控、更容易做回归比较的 contract 体系。

## 设计目标

1. 提升分镜图和视频链路的一致性稳定性。
2. 把 prompt 的“稳定信息”下沉为结构化字段和 preset。
3. 统一 `execution_en` / `display_zh` 的分层。
4. 让 shot / sequence / bridge 共享同一套 prompt contract 语义。
5. 保留当前可审计能力，不破坏现有 QA 和 artifact 体系。

## 设计原则

1. **Contract First**
   每一步先定义固定输入槽位，再决定如何拼成自然语言。

2. **Execution and Display Separation**
   `execution_en` 只给模型或 provider，`display_zh` 只给 UI 和审阅。

3. **Stable Facts Move Down**
   角色锚点、镜头语法、连续性锁、负面规则等稳定信息尽量下沉成 preset 或结构化字段。

4. **Few-shot Only Where It Matters**
   只在最容易跑偏的步骤加少量 good/bad examples，不做大规模 few-shot 堆叠。

5. **Shared Semantics Across Assets**
   三视图、分镜图、shot video、sequence、bridge 都复用同一组语义槽位。

## 方案对比

### 方案 A: 示例驱动

保留现有 prompt 结构，在关键步骤里加入 few-shot 示例。

优点：

- 改动小
- 见效快

缺点：

- prompt 容易越来越长
- 后期维护成本高
- 切模型时波动仍然明显

### 方案 B: 极简 prompt + 强 QA

prompt 尽量短，把稳定性主要交给 QA、preflight、rerank 和回退逻辑。

优点：

- prompt 干净
- 结构简单

缺点：

- 短期一致性提升不够稳
- 适合成熟期，不适合当前仍在调优的阶段

### 方案 C: Contract-first + preset + 少量示例

把每一步 prompt 改造成固定 contract：

- `role`
- `hard_constraints`
- `soft_preferences`
- `reference_binding`
- `negative_rules`
- `output_schema`

稳定内容下沉成 preset，关键步骤补少量示例。

优点：

- 一致性最好
- 适合多模型 / 多 provider 切换
- 最容易做 QA 和回归

缺点：

- 前期整理工作量较大
- 需要同步改文档、测试和 artifact 结构

### 推荐

采用 **方案 C**。

原因很直接：

- 你的项目已经有完整链路和 QA，但稳定性仍是核心问题
- 你明确希望后续能切供应商、统一中转，不想每个 API 都单独维护 prompt
- 当前最需要的是“可控性”和“可比较性”，不是继续堆自然语言长度

## 目标架构

### 1. Prompt Contract Layer

每个 prompt 步骤统一抽象成以下槽位：

- `task_role`
- `hard_constraints`
- `soft_preferences`
- `reference_binding`
- `negative_rules`
- `output_schema`
- `token_budget`
- `version`

这些槽位不要求都写在自然语言里，但必须存在于结构化输入中。

### 2. Preset Layer

把稳定信息沉到 preset：

- 角色 identity anchor
- 三视图纯白底规则
- 分镜镜头语言
- Seedance reference binding
- bridge 过渡规则
- sequence 连续动作规则

### 3. Execution Layer

最后交给模型/provider 的，只保留最少必要自然语言：

- 这一步要干什么
- 必须遵守什么
- 参考什么
- 不要什么

### 4. Display Layer

给 UI / 审阅看的内容独立存储，不混进执行文本。

## 各步骤改造方向

### 角色建档

当前问题：

- `visualDescription` 和 `basePromptTokens` 仍偏自由文本

目标改造：

- 增加固定字段：`identity_anchor`、`style_family`、`forbidden_identity_tokens`
- 让角色视觉描述更模板化
- 让 `basePromptTokens` 更短、更稳

### 角色三视图

当前问题：

- identity 还是会被场景词污染

目标改造：

- 把身份锚点和环境排除项完全独立成 preset
- prompt 只保留：
  - 单人
  - 纯白底
  - front / side / back
  - 全身
  - 同一套服装

### 分镜图 Prompt Engineer

当前问题：

- LLM 输出、camera keywords、style base、continuity tokens 混在一起

目标改造：

- 改成四段 contract：
  - `shot intent`
  - `scene / continuity`
  - `character anchors`
  - `camera / style / negative`
- `display_prompt_zh` 独立给 UI
- `execution_en` 只保留英文执行文本

### Seedance shot / sequence / bridge

当前问题：

- shot、sequence、bridge 语义不同，但有大量共享信息
- 现在靠多个 router 分别拼文本，容易不一致

目标改造：

- 统一为一个 video prompt contract
- 区分 `mode = shot | sequence | bridge`
- 共享：
  - `reference_binding`
  - `continuity_locks`
  - `negative_rules`
  - `camera_flow`
- mode 特有项只做增量覆盖

## 推荐落地顺序

### Phase 1: 分层与字段统一

先统一数据结构，不改最终模型行为：

- execution / display 分层
- prompt contract 字段命名统一
- 三视图 / 分镜图 / Seedance / bridge 的槽位对齐

### Phase 2: 稳定信息下沉

把重复出现的稳定词转成 preset：

- identity anchor preset
- camera language preset
- continuity lock preset
- negative rule preset

### Phase 3: 少量示例补强

只给最容易跑偏的环节加少量示例：

- 角色三视图
- 分镜图 prompt
- Seedance 结构化 blocks

### Phase 4: QA 回归

统一做 prompt contract regression：

- 结构字段是否齐全
- 负面词是否污染 execution
- display / execution 是否分离
- sequence / bridge 是否还保留各自语义

## 风险与边界

### 风险

- 字段抽象过多会让 prompt 工程变得过重
- preset 设计不当会变成新的硬编码噪音
- 如果不做 regression，改造后可能只是“更规整但不更稳”

### 边界

- 本次不重写整条视频生成链路
- 不改变当前 provider 路由策略
- 不把所有 prompt 都改成纯模板，不追求过度简化
- 不删除现有 QA / manifest / artifact 结构

## 成功标准

如果改造成功，应该满足：

1. 每一步都能清楚分出 `execution_en` 和 `display_zh`
2. prompt 中的稳定信息不再到处重复
3. 角色一致性和镜头一致性更稳
4. 切 provider 时只需要换 transport / client，不需要重写 prompt 逻辑
5. QA 可以直接按 contract 字段判断缺失项

## 建议验证方式

- 先跑 prompt contract 快照测试
- 再跑分镜图和三视图回归
- 再看 Seedance / sequence / bridge 的 prompt blocks 是否保持一致
- 最后对比同一剧本下新旧 prompt 的 QA 分数和 fallback 率

## 交付物建议

后续实现时，建议同步产出三份文档：

1. `prompt contract 规范`
2. `preset / example bank`
3. `step-by-step prompt 映射表`

这样后续 agent 和人都能直接查，不需要回源码猜语义。


