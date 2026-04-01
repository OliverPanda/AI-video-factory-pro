# QA 审核 Agent 设计

## 目标

为当前项目新增一个项目级审核 Agent，对整条流水线的重要产出进行统一验收，并给出以下三类结论之一：

- `pass`：通过
- `warn`：有非阻断问题，可继续
- `block`：不满足最低标准，必须中止

这个 Agent 用来补齐当前架构中的一个空缺：

- `director` 负责流程编排和重试
- `consistencyChecker` 只负责视觉一致性验收
- 目前没有一个 Agent 对全链路产物承担统一质量验收职责

新 Agent 采用 `混合式`、`分级式` 审核模型：

- 先用规则做确定性检查
- 仅在未来有需要时，再补充 LLM 主观质量判断
- 审核结论固定为 `pass / warn / block`

## 当前项目背景

当前运行时主流程如下：

1. `scriptParser`
2. `characterRegistry`
3. `promptEngineer`
4. `imageGenerator`
5. `consistencyChecker`
6. `ttsAgent`
7. `videoComposer`

其中 `director` 负责调度各阶段、持久化 `state.json`，并写入 `RunJob` 与 `AgentTaskRun` 观测数据。

项目当前已经具备以下基础设施：

- `temp/<jobId>/state.json` 作为阶段缓存
- `temp/projects/<projectId>/.../run-jobs/<runJobId>.json` 作为运行级观测记录
- `src/agents/director.js` 作为唯一主控编排器

因此，新设计必须保留“单一 orchestrator”这一架构前提，不能引入第二个调度中心。

## 设计概览

新增一个运行时 Agent：

- 文件位置：`src/agents/qaAuditor.js`
- 核心职责：对流水线主要阶段的产物做统一验收
- 接入方式：由 `director` 在关键节点后调用

这个 Agent 不负责修复产物，也不直接调度其它生成 Agent。
它只负责“判定是否达标”，并将结构化审核结果返回给 `director`。

## 推荐方案

采用 `混合式分级审核 Agent`。

### 为什么不是纯规则审核

纯规则审核虽然稳定、便宜、容易测试，但无法覆盖一些未来可能需要的主观判断，例如：

- Prompt 是否明显过弱
- 图像是否明显偏离分镜动作
- 最终视频是否和剧情基调严重不符

### 为什么不是 LLM 优先审核

如果一开始就把大部分验收交给 LLM，会带来以下问题：

- 成本更高
- 结果波动更大
- 更难做稳定回归测试

这与当前 MVP 流水线的工程目标不匹配。

### 为什么混合式最合适

混合式能让第一版兼顾可靠性与扩展性：

- 结构性问题交给确定性规则
- 主观质量问题后续可按需引入 LLM
- 先把全链路验收闭环建立起来，而不额外破坏现有流程稳定性

## 审核结果模型

每个审核阶段都返回统一结构：

```json
{
  "stage": "asset_audit",
  "status": "warn",
  "findings": [
    {
      "severity": "warn",
      "code": "LOW_CONSISTENCY_SCORE",
      "message": "shot_003 的角色一致性接近阈值",
      "shotId": "shot_003"
    }
  ],
  "summary": "当前资产可继续使用，但建议人工复查一个镜头",
  "metrics": {
    "totalFindings": 1,
    "blockCount": 0,
    "warnCount": 1
  }
}
```

### 结果语义

- `pass`：没有阻断问题，也没有告警
- `warn`：存在非阻断问题，流程可继续
- `block`：存在阻断问题，流程必须中止

### finding 结构

每条问题统一采用如下结构：

```json
{
  "severity": "warn",
  "code": "PROMPT_TOO_SHORT",
  "message": "shot_003 的 prompt 过短",
  "shotId": "shot_003"
}
```

按具体场景可额外附带上下文字段，例如：

- `characterName`
- `path`
- `details`

## 审核阶段设计

第一版包含五个审核阶段。

### 1. `script_audit`

目的：确认剧本解析结果能够被下游正常消费。

`block` 条件：

- 缺少 `title`
- `shots` 不是数组或为空
- 任意镜头缺少 `id`
- 所有镜头都缺少可用的场景、动作和对白信息

`warn` 条件：

- 镜头中出现角色名，但顶层角色列表为空
- 一个或多个镜头 `duration` 缺失或不合法
- 某些镜头内容过于稀疏，可能导致后续 Prompt 质量偏弱

### 2. `character_audit`

目的：确认角色档案足以支持稳定出图和配音。

`block` 条件：

- 剧本里有角色，但 `characterRegistry` 为空
- 任一角色档案缺少 `name`
- 主要出场角色无法在角色档案中匹配到

`warn` 条件：

- 缺少 `basePromptTokens`
- `visualDescription` 过短
- 与语音相关的元数据不足，TTS 很可能会退回默认音色

### 3. `prompt_audit`

目的：确认每个镜头都拿到了可用于出图的 Prompt。

`block` 条件：

- Prompt 列表为空
- 某个镜头没有对应 Prompt
- `image_prompt` 为空

`warn` 条件：

- Prompt 过短
- 涉及角色的镜头 Prompt 中没有体现角色 token
- 缺少风格词或镜头词，可能导致出图不稳定

### 4. `asset_audit`

目的：在最终合成前，统一检查图像、视觉一致性结果和音频资产。

`block` 条件：

- 某个必需图像缺失或标记为失败
- 有对白的镜头没有音频文件
- 一致性检查要求重生成，但最终必需图像仍不可用

`warn` 条件：

- 一致性分数偏低但尚未达到阻断条件
- 无对白镜头没有音频，这种情况允许继续，但应记录
- 某些音频结果明显异常，可能会影响后续时间轴或合成节奏

### 5. `final_audit`

目的：确认最终交付物存在，且至少满足最低可交付标准。

`block` 条件：

- `composeVideo` 没有生成输出路径
- 输出路径不存在

`warn` 条件：

- 文件体积明显异常偏小
- 最终视频虽然生成成功，但依赖了降级后的中间资产，建议人工复查

## 与 Director 的集成方式

`director` 仍然是系统中唯一的 orchestrator。

建议在以下关键节点后调用审核 Agent：

1. 角色档案完成后：
   - `script_audit`
   - `character_audit`
2. Prompt 完成后：
   - `prompt_audit`
3. 图像、一致性处理和音频完成后：
   - `asset_audit`
4. 视频合成完成后：
   - `final_audit`

### Director 的处理逻辑

对每次审核结果，`director` 的行为固定如下：

- 只要出现任意 `block` finding，立即抛错并中止流程
- 如果只有 `warn`，记录结果并继续执行
- 如果是 `pass`，直接继续

这样可以保持一个控制中心，避免让审核 Agent 演变成第二个 orchestrator。

## 状态持久化与观测

审核结果应复用当前已有的持久化和观测层，而不是另起一套存储。

### 写入 `state.json`

在状态文件中新增 `qaAudits` 字段：

```json
{
  "qaAudits": {
    "script_audit": {},
    "character_audit": {},
    "prompt_audit": {},
    "asset_audit": {},
    "final_audit": {}
  }
}
```

作用包括：

- 支持断点续跑
- 支持查看过往审核结果
- 在适当场景下复用已完成审核

### 写入 `AgentTaskRun`

建议新增以下审核 task run：

- `audit_script`
- `audit_character`
- `audit_prompt`
- `audit_assets`
- `audit_final`

这些记录至少应包含：

- `status`
- `detail`
- `startedAt`
- `finishedAt`
- 问题数量汇总
- 阻断错误信息（如有）

## 边界约束

为了让第一版聚焦、可控，明确以下边界：

- 审核 Agent 不直接修复产物
- 审核 Agent 不主动调用生成 Agent
- 审核 Agent 不承担编排职责
- LLM 主观审核为后续扩展点，第一版默认关闭

重试、重生成和是否继续推进，仍然由 `director` 负责。

## 测试策略

第一版实现应坚持规则优先，确保可以通过稳定单测验证。

建议测试覆盖分两层：

1. `qaAuditor` 单元测试
   - 覆盖每个审核阶段的 `pass / warn / block` 场景
2. `director` 集成测试
   - `warn` 不会中断流程
   - `block` 会中断流程
   - 审核结果会写入 `state.json`
   - 审核阶段会写入 `AgentTaskRun`

第一版不把 LLM 审核纳入测试主面。

## 风险与缓解

### 风险 1：审核过严导致误阻断

如果规则定义过严，流程可能在“勉强可用”的结果上被过早终止。

缓解方式：

- 第一版只把最客观的问题放进 `block`
- 软性质量问题一律先进入 `warn`

### 风险 2：与现有 Agent 职责重复

某些检查项可能与现有模块逻辑有重叠。

缓解方式：

- 生成逻辑仍然属于各生成 Agent
- `qaAuditor` 只拥有验收逻辑

### 风险 3：审核规则与产物结构漂移

随着各 Agent 输出结构演进，审核规则可能过时。

缓解方式：

- 规则尽量贴近真实输出结构
- 在 Agent 契约变化时同步更新测试

## 实施方向

第一版实现建议按以下优先级推进：

1. 新建 `src/agents/qaAuditor.js`
2. 实现基于规则的阶段审核函数
3. 将审核 Agent 接入 `director`
4. 将审核结果写入 `state.json`
5. 将审核阶段写入 `AgentTaskRun`
6. 补充单元测试和集成测试

LLM 主观审核能力作为后续增强项，可放在明确的配置开关之后再接入。
