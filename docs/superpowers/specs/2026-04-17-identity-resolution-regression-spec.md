# Identity Resolution Regression Spec

**Goal:** 统一项目内所有“身份识别”和“资产绑定”规则，避免中文名、英文名、别名、展示名被误当成不同实体。

## Core Rule

1. `id` 是唯一身份键。
2. `name` 只能用于展示、日志、兼容迁移。
3. `aliases` 只能用于搜索和兼容，不可作为主键。
4. 任何资产绑定都必须优先依赖稳定 ID，不允许用 `name` 充当主关联键。

## Identity Priority

推荐统一优先级如下：

```text
episodeCharacterId
-> id
-> mainCharacterTemplateId
-> characterBibleId
-> voicePresetId
```

说明：

- `episodeCharacterId`
  - 当前分集里的角色实例 ID，优先级最高。
- `id`
  - 通用实体 ID。
- `mainCharacterTemplateId`
  - 主角色模板引用。
- `characterBibleId`
  - 项目级角色身份资产引用。
- `voicePresetId`
  - 项目级声音资产引用。

## Why Name Matching Is Risky

`name` 有天然不唯一问题：

- 中文名和英文名会同时存在
- 别名、昵称、拼音、生成模型输出名会并存
- 同一角色在不同模块里可能被写成不同名字
- LLM 会改写名字，但不会保证稳定 ID

所以：

- `name` 可以做“人类可读标签”
- 不能做“身份主键”

## Module-Level Rules

### 1. Character Registry

负责把剧本角色、模板、角色圣经合成统一运行时角色视图。

必须：

- 用 `episodeCharacterId` / `id` 做角色合并主键
- 把中文名、英文名、别名统一进 `aliases`
- 允许 `name` 作为展示名，但不允许作为唯一身份

禁止：

- 用 `name` 直接判断是否是同一个角色

### 2. Character Ref Sheet Generator

负责按角色生成三视图参考纸。

必须：

- 以角色 ID 作为输出文件和任务绑定依据
- 参考图命名可以包含 `name`，但匹配逻辑必须认 ID

风险点：

- 如果 registry 里同时存在中英文名字而没有统一 ID，会重复生成

### 3. Prompt Engineer

负责把角色、镜头、场景转成图像 prompt。

必须：

- 角色 token 来源必须绑定到角色 ID
- `name` 只能用于 prompt 文本展示，不可用于身份决策

### 4. Consistency Checker

负责检查角色图是否一致。

必须：

- 按角色 ID 聚合图片
- `name` 只能用于报表标题

风险点：

- `name` 只要参与图片筛选，就可能漏检或错检

### 5. Continuity Checker

负责检查镜头间的连贯性。

必须：

- 角色相对关系使用 ID
- 道具状态使用稳定实体名或 ID

说明：

- `name` 可用于人类可读描述
- 不可用于判断“是不是同一个人”

### 6. Video Router

负责把 shot 路由到具体视频 provider。

必须：

- `referenceImagePath` 绑定到角色 ID
- `collectReferenceImages()` 必须先查 ID，再查模板 ID，再查别名

风险点：

- `episodeCharacterId || id || name` 这种写法是高风险兜底

### 7. Bridge Shot Planner

负责 bridge 镜头规划。

必须：

- 只用 ID 表达角色关系
- `name` 只能作为补充说明

### 8. Action Sequence Planner

负责 sequence 镜头规划。

必须：

- 只用 ID 表达角色关系
- `name` 只能用于文本输出或兼容老数据

### 9. TTS Agent / Voice Cast Store

负责配音资产绑定。

必须：

- 以 `characterId` / `episodeCharacterId` / `mainCharacterTemplateId` / `voicePresetId` 为主
- `displayName` 和 `name` 只能做辅助匹配

推荐：

- 角色声音绑定一次后，后续以 `voicePresetId` 为准

### 10. Seedance Prompt Agent

负责视频 prompt 包装。

必须：

- 角色顺序、角色阻断、角色参考图都来自 ID 视图
- 不可把 `name` 当成角色归一化锚点

### 11. Scene Grammar Agent

负责场景语法抽象。

说明：

- 这里使用角色名做 cast 展示是可以接受的
- 但它不应反向参与身份决策

### 12. Director Pack Agent

负责导演层约束。

说明：

- `name` 可作为可读文本
- `blocking_map` 的身份输入应来自上游 ID 结构

## Asset Rules

### Character Bible

建议作为角色身份的最高层资产。

字段建议：

- `id`
- `projectId`
- `aliases`
- `referenceImages`
- `coreTraits`
- `wardrobeAnchor`
- `lightingAnchor`
- `basePromptTokens`
- `negativeDriftTokens`

### Episode Character

建议作为分集实例层。

字段建议：

- `id`
- `projectId`
- `scriptId`
- `episodeId`
- `mainCharacterTemplateId`
- `characterBibleId`
- `voicePresetId`
- `lookOverride`
- `wardrobeOverride`
- `personalityOverride`

### Shot Character

建议作为分镜关系层。

字段建议：

- `episodeCharacterId`
- `isPrimary`
- `isSpeaker`
- `sortOrder`
- `poseIntent`
- `relativePosition`
- `facingDirection`

## High-Risk Patterns

以下模式都要重点清理：

```text
find((x) => x.name === y.name)
map((x) => x.name || x.id)
characterId || episodeCharacterId || name
displayName || name
characterName ?? relation.name
```

这些写法不一定全错，但只要出现在“身份绑定”路径里，就应该重构成：

```text
ID first, name last
```

## Review Checklist

做回归时，逐项确认：

- 角色合并是否只认 ID
- 三视图是否只按角色 ID 生成一次
- 配音是否只按 `voicePresetId` 复用
- 视频参考图是否只按角色 ID 绑定
- sequence / bridge 是否只靠 ID 传递角色关系
- `name` 是否只留在展示层

## Recommendation

后续所有新模块默认采用：

1. 先定义稳定 ID
2. 再定义别名
3. 最后才考虑展示名

如果某个模块没有稳定 ID，就不要让它参与资产绑定，只能做临时兼容。

