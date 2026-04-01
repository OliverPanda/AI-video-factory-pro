# 2026-04-01 Character Consistency System Design

## Goal

为 AI Video Factory Pro 设计一套**可控、渐进式、可审计**的角色一致性系统，使项目在多分镜、多分集场景下，尽可能稳定地保持：

1. 角色身份一致
2. 跨分镜外观一致
3. 跨分镜基础连贯
4. 多人场景下的角色区分和相对关系稳定

本设计不是论文式“全栈研究平台”，而是面向当前代码架构的可落地产品方案。

## Why This Design

对 [AIGC角色一致性方案审查.docx](d:/ComfyUI/笔记/AIGC角色一致性方案审查.docx) 的讨论结论如下：

### 值得保留的方向

- 参考图 / 角色 ID 锚定
- 分层角色特征管理
- 长短期角色记忆
- 光照一致性单独建模
- 多人场景约束单独建模

### 不直接采用的重型部分

- 首版直接上 `Milvus`
- 首版直接上 `MemLong`
- 首版直接做对抗训练 / 特征向量正则训练
- 首版直接做完整多人骨骼约束网络

原因不是这些方向错，而是：

- 当前产品是 Node.js + JSON store + agent pipeline
- 现在最大短板是“前置约束不足、后验检查过弱、状态没有被结构化”
- 先把角色资产、连续状态、QA 证据做扎实，收益远高于先上重型基础设施

## Final Decision

最终方案采用 **4 层混合架构**：

1. `Character Bible`
   - 项目级角色身份资产
2. `Shot Continuity State`
   - 分镜级连续状态
3. `Generation Constraints`
   - 生成前约束注入
4. `Post-Generation QA`
   - 生成后身份质检 + 连贯性质检

并把当前的 `Consistency Checker` 明确拆分为两个能力：

- `Identity Consistency`
  - 角色外观一致性
- `Shot Continuity`
  - 跨分镜基础连贯性

当前 `Consistency Checker` 将继续存在，但它的职责只保留“角色外观一致性”；新增的“连贯性检查”作为独立层设计。

## Scope

### In Scope

- 项目级角色身份资产
- 角色参考图和锚点字段
- 分镜级连续状态字段
- Prompt 生成前的连续性约束注入
- 身份一致性质检
- 连贯性质检
- 多人场景的角色区分规则
- 光照锚点的轻量化表达
- 完整的审计成果物落盘

### Out of Scope

- 训练自定义扩散模型
- 向量数据库基础设施
- 复杂骨骼网络训练
- 对抗训练
- 真正的视频级时序模型

## Core Architecture

```text
Project
├── CharacterBible[]
├── Scripts
│   └── Episodes
│       ├── EpisodeCharacter[]
│       ├── ShotPlan[]
│       │   ├── ShotCharacter[]
│       │   └── ShotContinuityState
│       └── Runs
│           ├── IdentityConsistencyReport
│           └── ContinuityReport
```

## Data Model

### 1. CharacterBible

新增项目级角色身份资产，作用是替代“只有 basePromptTokens 的轻量角色卡”。

建议结构：

```json
{
  "id": "char_bible_xiaohong",
  "projectId": "cafe_story",
  "name": "小红",
  "aliases": ["小红", "女主", "红红"],
  "tier": "lead",
  "referenceImages": [
    "temp/projects/cafe_story/character-bibles/references/xiaohong-front.png",
    "temp/projects/cafe_story/character-bibles/references/xiaohong-side.png",
    "temp/projects/cafe_story/character-bibles/references/xiaohong-fullbody.png"
  ],
  "coreTraits": {
    "faceShape": "oval face",
    "hairStyle": "long straight black hair",
    "skinTone": "fair skin",
    "bodyType": "slim",
    "ageRange": "20s"
  },
  "wardrobeAnchor": {
    "primaryColors": ["white", "navy"],
    "signatureItems": ["simple white blouse", "silver bracelet"]
  },
  "lightingAnchor": {
    "baseTone": "soft natural light",
    "skinExposureBias": "neutral"
  },
  "basePromptTokens": "young asian woman, long straight black hair, fair skin, delicate face, white blouse, silver bracelet",
  "negativeDriftTokens": "different hairstyle, different face shape, heavy makeup, different outfit silhouette",
  "notes": "笑起来眼神明亮，现代都市感",
  "status": "approved"
}
```

### 2. EpisodeCharacter

`EpisodeCharacter` 不再只表达“这一集有没有这个角色”，还要引用项目级角色身份资产：

- `characterBibleId`
- `lookOverride`
- `wardrobeOverride`
- `voicePresetId`

规则：

- 项目默认身份来自 `CharacterBible`
- 分集可做轻量覆盖
- 不允许直接复制整套核心身份字段，避免漂移

### 3. ShotCharacter

`ShotCharacter` 继续作为分镜角色实例关系层，新增：

- `poseIntent`
- `relativePosition`
- `facingDirection`
- `interactionTargetEpisodeCharacterId`

示例：

```json
{
  "episodeCharacterId": "ep_xiaohong",
  "isPrimary": true,
  "isSpeaker": true,
  "sortOrder": 1,
  "poseIntent": "leaning_forward",
  "relativePosition": "left",
  "facingDirection": "right",
  "interactionTargetEpisodeCharacterId": "ep_xiaoming"
}
```

### 4. ShotContinuityState

新增分镜级连续状态对象。

```json
{
  "carryOverFromShotId": "shot_007",
  "sceneLighting": "warm indoor dusk",
  "cameraAxis": "screen_left_to_right",
  "propStates": [
    { "name": "coffee_cup", "holderEpisodeCharacterId": "ep_xiaoming", "side": "right-hand" }
  ],
  "emotionState": {
    "ep_xiaohong": "soft_smile",
    "ep_xiaoming": "nervous"
  },
  "continuityRiskTags": ["two-character interaction", "prop continuity"]
}
```

这个对象不是为了学术完备，而是为了让 Prompt 和 QA 都有明确的连续约束源。

## Generation Strategy

### Before Generation

生成前的约束顺序：

1. `CharacterBible`
   - 核心身份锚点
2. `EpisodeCharacter`
   - 分集服装 / look 覆盖
3. `ShotCharacter`
   - 当前镜头姿态、站位、朝向
4. `ShotContinuityState`
   - 和上一镜的承接关系

### Prompt Composition

`Prompt Engineer` 需要升级成四段式：

1. `Identity Block`
   - 固定角色身份锚点
2. `Scene Block`
   - 当前场景和动作
3. `Continuity Block`
   - 承接上一镜、光照、道具、角色相对位置
4. `Camera Block`
   - 镜头类型和构图说明

### Reference Strategy

首版不直接上向量数据库，但必须支持项目级参考图资产：

- `CharacterBible.referenceImages`
- 可选 `anchorFrameImage`

如果 provider 支持参考图，就走参考图；
如果不支持，就仍然使用文本锚点，但保留参考图路径和审计记录。

## QA Strategy

### A. Identity Consistency

保留并升级当前 `Consistency Checker`：

- 继续按角色聚合
- 继续输出分数和重生成建议
- 增加以下检查项：
  - 发型是否漂移
  - 服装主轮廓是否漂移
  - 面部年龄感是否漂移
  - 主配色是否漂移

### B. Continuity Checker

新增 `Continuity Checker`，目标不是检查“像不像同一个人”，而是检查：

- 视线方向是否跳变
- 左右站位是否乱掉
- 道具位置是否突变
- 情绪推进是否断裂
- 光照语义是否突变

输入：

- 当前 shot 图像
- 上一镜 / 关键前序镜图像
- `ShotContinuityState`
- 当前 `ShotCharacter[]`

输出：

- `continuityScore`
- `violations[]`
- `needsRegeneration`
- `repairHints`

## Multi-Character Strategy

多人场景不做复杂骨骼网络，但必须先把“角色区分规则”做结构化：

1. 每个角色有明确 `relativePosition`
2. 每个角色有明确 `facingDirection`
3. 每个角色有独立 identity block
4. Prompt 中显式声明人物关系
5. QA 中检查“左右位置/服装/主角色归属”是否混淆

这能解决 80% 的多人混角问题，比直接上复杂骨骼约束更符合现阶段收益。

## Lighting Strategy

跨场景光照一致性不做重型向量化，首版采用：

- `CharacterBible.lightingAnchor`
- `ShotContinuityState.sceneLighting`
- Prompt 中显式区分：
  - 角色肤色 / 曝光基线
  - 场景光照环境

原则：

- 允许场景光照变化
- 不允许角色肤色、服装主色因为光照变化被错误漂白 / 染色

## Storage Layout

建议新增项目级角色资产目录：

```text
temp/projects/<projectId>/
  character-bibles/
    <characterBibleId>.json
    references/
      <characterBibleId>-front.png
      <characterBibleId>-side.png
      <characterBibleId>-fullbody.png
```

分集内新增：

```text
episode.json
  episodeCharacters[]
  shots[]
    shotCharacters[]
    continuityState
```

运行包内新增：

```text
02-character-registry/
  0-inputs/
    character-bibles.json
  1-outputs/
    character-registry.json

05-consistency-checker/
  1-outputs/
    consistency-report.json

06-continuity-checker/
  1-outputs/
    continuity-report.json
    flagged-transitions.json
```

## Agent Changes

### Character Registry

升级为：

- 加载 `CharacterBible`
- 与 `EpisodeCharacter` 合并
- 输出统一运行时角色视图

### Prompt Engineer

升级为：

- 读取 `CharacterBible + EpisodeCharacter + ShotCharacter + ShotContinuityState`
- 生成 identity-aware + continuity-aware prompt

### Consistency Checker

保留，但更明确命名为：

- `Identity Consistency Checker`

### New Continuity Checker

新增独立 agent，不再把“连贯性”继续混进现有一致性检查里。

### Director

新顺序：

1. Script Parser
2. Character Registry
3. Prompt Engineer
4. Image Generator
5. Identity Consistency Checker
6. Continuity Checker
7. TTS Agent
8. Video Composer

## Phasing

### Phase 1: High ROI, No Heavy Infra

- `CharacterBible`
- `ShotContinuityState`
- Prompt continuity injection
- Identity consistency upgrade
- New continuity checker

### Phase 2: Better Retrieval

- 角色快照库
- 最近有效镜头检索
- 项目级 reference selection

### Phase 3: Advanced Constraints

- 轻量 pose extraction
- 多人相对位置自动校验
- 跨集角色回溯校准

## Success Criteria

系统被认为达标，需要至少满足：

1. 同角色跨 10+ 分镜的外观漂移显著下降
2. 多人场景角色混淆率下降
3. 道具 / 站位 / 朝向的连续错误可被结构化发现
4. 每次运行都能在审计目录里解释：
   - 为什么认为某镜头不一致
   - 为什么认为某个切换不连贯
   - 重生成建议是什么

## Decision Summary

最终结果不是“继续堆强一点的 Consistency Checker”，而是：

- 用 `CharacterBible` 管角色身份
- 用 `ShotContinuityState` 管连续状态
- 用 `Prompt Engineer` 做前置约束
- 用 `Identity Consistency Checker + Continuity Checker` 做后置质检

这是当前项目里最现实、最可控、最能渐进升级的角色一致性最终方案。
