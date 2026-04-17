# Seedance 2.0 Prompt Architecture

## 背景

为了让 `shot / sequence / bridge` 三条视频生成语义在同一条 Seedance 主链上拥有更稳定的可控性，本仓库已将 Seedance 视频提示词重构为“结构化 block + 有序文本段”的双层方案。

本次设计主要参考火山引擎官方文档《Seedance 2.0 提示词指南》：

- 文档链接：https://www.volcengine.com/docs/82379/2222480?lang=zh
- 页面标题：`Seedance 2.0 提示词指南`
- 页面最近更新时间：`2026-04-02 18:32:19`

## 官方指南提炼出的核心原则

官方文档里，对 Seedance 2.0 提示词最关键的几条规律可以概括为：

1. 先明确“谁在做什么”
2. 再补“空间 / 光影 / 风格”
3. 再补“运镜 / 时序 / 声效”等进阶控制
4. 多模态参考必须显式指代，例如“图片1 / 视频1”
5. 文本提示词不应该只是抽象标签堆叠，而应尽量变成自然语言导演指令

因此，本仓库不再把 Seedance 输入仅仅视作：

- `visualGoal`
- `cameraSpec`
- `continuitySpec`

而是改为先组织结构化信息，再转成符合官方理解方式的自然语言段落。

## 当前落地位置

### 1. shot 主链

- 结构化 prompt block 生成：
  - [seedancePromptAgent.js](d:/My-Project/AI-video-factory-pro/src/agents/seedancePromptAgent.js)
- 最终 Seedance prompt 文本组装：
  - [seedanceVideoApi.js](d:/My-Project/AI-video-factory-pro/src/apis/seedanceVideoApi.js)

### 2. sequence 连续动作段

- sequence package 参考素材与 continuity 信息组装：
  - [actionSequenceRouter.js](d:/My-Project/AI-video-factory-pro/src/agents/actionSequenceRouter.js)
- 最终仍复用：
  - [seedanceVideoApi.js](d:/My-Project/AI-video-factory-pro/src/apis/seedanceVideoApi.js)

### 3. bridge 补桥

- bridge prompt directive 组装：
  - [bridgeShotRouter.js](d:/My-Project/AI-video-factory-pro/src/agents/bridgeShotRouter.js)
- bridge 统一 client 包装：
  - [bridgeClipGenerator.js](d:/My-Project/AI-video-factory-pro/src/agents/bridgeClipGenerator.js)

## 当前统一 Prompt 结构

无论来自 `shot / sequence / bridge` 哪一条语义链，最终传给 Seedance 的文本都尽量收敛为以下顺序：

1. `subject and action`
2. `scene and style`
3. `camera and timing`
4. `reference binding`
5. `entry / exit`
6. `continuity locks`
7. `hard continuity rules`

这样设计的原因是：

- 前 4 段对齐官方推荐的主信息顺序
- 后 3 段保留仓库内部对连续性和 handoff 的强约束

## shot Prompt 设计

### shot 的结构化 block

当前 `shot` 会优先生成这些 block：

- `subject_action`
- `scene_environment`
- `cinematography`
- `reference_binding`
- `cinematic_intent`
- `shot_goal`
- `entry_exit`
- `timecoded_beats`
- `camera_plan`
- `blocking`
- `continuity_locks`
- `negative_rules`
- `quality_target`

### shot 的关键约束

- `subject_action` 必须尽量接近“角色 + 动作 + 叙事目的”
- `scene_environment` 必须优先承接 `space_anchor / time_anchor / visual_motif`
- `cinematography` 必须把 `coverage_role / framing / move_type / camera_grammar / cinematic_intent` 合并
- `reference_binding` 必须显式写出 `image1 / image2`

## sequence Prompt 设计

### sequence 的目标

`sequence` 不是普通单镜头变体，而是连续动作段，因此它的 prompt 要额外承担三类职责：

1. 维持连续动作节奏
2. 明确 entry / exit handoff
3. 显式绑定多张图与参考视频

### sequence 当前约束

- 图像参考会区分：
  - `first_frame`
  - `supporting_reference`
- 视频参考会区分：
  - `motion_reference`

最终 prompt 里会显式出现：

- `image1 is the first frame ...`
- `image2 is the supporting reference ...`
- `video1 is the motion reference ...`

这样做的目标是让 Seedance 更明确知道：

- 哪张图是开场姿态锚点
- 哪张图是后续连续性补充
- 哪段视频是动作 / 运镜参考

## bridge Prompt 设计

### bridge 的目标

`bridge` 的职责不是“再来一条普通视频请求”，而是负责：

- 接前镜头
- 过渡 cut 点
- 落到后镜头

因此 `bridge` prompt 不能只写抽象标签，必须显式说明：

- 过渡意图
- 前后帧绑定
- 运镜过渡方式
- 连续性锁

### bridge 当前 directive 结构

当前 router 输出的 bridge 指令会优先组织为：

1. `transition brief`
2. `camera and timing`
3. `reference binding`
4. `continuity locks`
5. `preserve elements`

在统一 client 提交时，会同时带上：

- `first_frame`
- `last_frame`

这让 bridge 的 Seedance 输入更接近官方“多图参考 + 明确指代”的模式。

## 为什么不用纯自由文本

纯自由文本的问题是：

- 很难审计
- 很难统计缺失字段
- 很难做 preflight QA
- 很难给 agent 稳定续写

当前“结构化 block -> 有序文本段”的做法，兼顾了两点：

- 上游可以审计和补全
- 下游仍能给 Seedance 自然语言输入

## 当前验证覆盖

本设计当前已有本地测试覆盖：

- shot prompt block 结构
  - [seedancePromptAgent.test.js](d:/My-Project/AI-video-factory-pro/tests/seedancePromptAgent.test.js)
- Seedance 最终 prompt 文本顺序与引用绑定
  - [seedanceVideoApi.test.js](d:/My-Project/AI-video-factory-pro/tests/seedanceVideoApi.test.js)
- sequence 参考角色标注
  - [actionSequenceRouter.test.js](d:/My-Project/AI-video-factory-pro/tests/actionSequenceRouter.test.js)
- bridge prompt directive 与前后帧绑定
  - [bridgeShotRouter.test.js](d:/My-Project/AI-video-factory-pro/tests/bridgeShotRouter.test.js)
  - [bridgeClipGenerator.test.js](d:/My-Project/AI-video-factory-pro/tests/bridgeClipGenerator.test.js)

## 后续调优原则

后续如果要继续调 Seedance prompt，优先遵守下面这些原则：

1. 不要把 prompt 又退回成散乱标签列表
2. 不要删除 `reference binding` 里的显式 `image1 / video1` 指代
3. 不要把 `entry / exit` handoff 融掉到泛化描述里
4. `sequence` 和 `bridge` 的差异要保留，不能强行合并成单镜头模板
5. 如需新增字段，优先先进入结构化 block，再决定是否落入最终文本

## Agent 接手说明

后续 agent 若继续调 prompt，建议按以下顺序定位：

1. 看 [seedancePromptAgent.js](d:/My-Project/AI-video-factory-pro/src/agents/seedancePromptAgent.js)
2. 看 [seedanceVideoApi.js](d:/My-Project/AI-video-factory-pro/src/apis/seedanceVideoApi.js)
3. 看 [actionSequenceRouter.js](d:/My-Project/AI-video-factory-pro/src/agents/actionSequenceRouter.js)
4. 看 [bridgeShotRouter.js](d:/My-Project/AI-video-factory-pro/src/agents/bridgeShotRouter.js)
5. 先改测试，再改实现

推荐最小验证命令：

```bash
node --test tests/seedancePromptAgent.test.js tests/seedanceVideoApi.test.js tests/actionSequenceRouter.test.js tests/bridgeShotRouter.test.js tests/bridgeClipGenerator.test.js tests/sequenceClipGenerator.test.js tests/seedanceVideoAgent.test.js tests/videoRouter.test.js
```
