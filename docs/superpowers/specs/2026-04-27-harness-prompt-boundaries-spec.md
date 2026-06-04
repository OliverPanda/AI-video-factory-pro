# Harness Prompt Boundaries Spec

**Goal:** 明确本项目 agent harness 中通用级、产品级、项目级、剧集级、场景级、镜头级提示词和结构化上下文的边界，避免把某个剧本的特殊规则写死到全局 prompt，同时让每次 run 都可审计、可复跑、可修复。

**Status:** Planning spec

**Related:**

- `docs/superpowers/specs/2026-04-17-harness-engineering-retrofit-spec.md`
- `docs/superpowers/plans/2026-04-21-prompt-contract-retrofit-plan.md`
- `docs/superpowers/plans/2026-04-27-shot-chain-wrist-continuity.md`
- `src/llm/prompts/promptEngineering.js`
- `src/agents/sceneGrammarAgent.js`
- `src/agents/directorPackAgent.js`
- `src/agents/seedancePromptAgent.js`

---

## Core Rule

Prompt 不按“谁先想到就写进哪里”管理，而按 **scope + lifecycle + ownership** 管理。

任何提示词/约束进入 harness 前，都必须回答：

1. **Scope:** 这条规则适用于所有项目、某个项目、某一集、某一场，还是某个镜头？
2. **Lifecycle:** 它是永久规则、项目资产、分集状态、单次 run 修复，还是一次 retry 的临时补丁？
3. **Owner:** 谁生成、谁消费、谁验证、谁能覆盖它？
4. **Evidence:** 它来自剧本、用户配置、QA 失败、人工标注，还是模型推断？

低层规则不能随意上升为高层全局规则。比如《双生囚笼》的“黑色半透明锁链必须绑手腕”只能是项目/剧集级核心道具约束，不能写入通用 prompt。

## Harness Context Levels

| Level | 名称 | 典型文件/模块 | 允许包含 | 禁止包含 |
|---|---|---|---|---|
| L0 | Harness System | shared prompt contract / agent runtime | 输出 JSON schema、错误恢复合同、语言分层、工具调用边界、不可违反的安全/审计规则 | 具体剧名、角色名、道具名、剧情设定、某 provider 私有写法 |
| L1 | Product Domain | `README.md`、`docs/agents/*`、通用 prompt presets | 漫剧短视频生产规则、竖屏交付、ID-first 身份绑定、execution/display 分离、通用质量门槛 | 某一部剧的世界观、某角色外貌、某镜头修复词 |
| L2 | Task / Provider Preset | `src/llm/prompts/*`、`src/apis/*` | 图像/视频/TTS 的任务角色、provider 需要的格式、通用质量词、通用负面词、输出字段 | 项目专属核心道具、剧集剧情、场景状态 |
| L3 | Project / Series Bible | `project.json`、建议新增 `visual-bible.json`、`core-props.json` | 项目世界观、长期视觉风格、主角身份锚点、核心道具、禁用漂移规则、长期声音/口吻 | 单集临时伤势、某一场站位、一次失败重试补丁 |
| L4 | Script / Season Arc | `script.json`、script parser 输出 | 全剧结构、集数列表、主线弧光、跨集伏笔、长期地点/组织 | 镜头级构图、单张图的局部修复 |
| L5 | Episode Context | `episode.json`、run `state.json` | 本集起止状态、本集角色状态、本集核心道具活跃区间、本集地点、情绪曲线 | 全局画质词、provider 私有参数、其他集未激活的设定 |
| L6 | Scene Pack | `sceneGrammarAgent` outputs | 场景目标、地点锚点、时间锚点、power shift、action beats、space layout、visual motif | 角色完整三视图描述、全项目规则、镜头外无关设定 |
| L7 | Shot Pack | `promptEngineer` / `videoRouter` / `seedancePromptAgent` outputs | 当前镜头动作、对白、景别、entry/exit、当前角色、当前道具状态、参考图绑定 | 不在当前镜头出现的角色/道具长描述、全局修复经验 |
| L8 | Candidate / Retry Patch | QA fix brief、repair directives | 针对一次失败的最小修复，如“露出两个手腕端点”“降低镜头运动” | 被提升为永久规则，除非人工确认并写入 L3/L5 |
| L9 | Human Override | 人工审阅备注、run override | 人类明确指定的局部覆盖、验收决定、冻结/重生指令 | 静默覆盖上层结构，不留审计痕迹 |

## Boundary Decisions

### L0 通用级提示词

**只放 invariant harness 行为。**

适合：

- 必须返回 JSON，不要解释。
- Provider-facing 字段必须是英文 execution text。
- Display 字段必须是中文审阅 text。
- 每个 agent 输出必须有 `status / summary / next_actions / artifacts`。
- 失败必须给出 `root_cause_hint / safe_retry_instruction / stop_condition`。
- 不要把低层剧本事实提升为全局规则。

不适合：

- “锁链必须在手腕”
- “陆衍穿白袍”
- “现实世界冷淡蓝灰调”
- “第 7 镜不能变成脖子链”

### L1 产品级提示词

**描述这个系统如何生产漫剧，不描述某部剧。**

适合：

- 输出面向短视频平台，默认竖屏。
- 角色身份绑定必须 ID-first。
- 角色图、三视图、voice cast、视频参考图都按稳定 ID 绑定。
- 视觉链路优先保护角色一致性、道具连续性、空间可读性。
- `image_prompt_en / negative_prompt_en` 是执行字段。
- `display_prompt_zh / display_negative_prompt_zh` 是审阅字段。

不适合：

- 某个项目的核心道具外观。
- 某个场景的蓝光虚空。
- 某一集的“强制绑定”生效条件。

### L2 任务/Provider 级提示词

**描述“这个任务怎么跟模型说话”。**

适合：

- 图像任务：主体、环境、构图、光线、质量词、通用负面词。
- 视频任务：entry/exit、timecoded beats、camera motion、reference binding。
- TTS 任务：voice preset、情绪、语速、停顿。
- Provider 差异：Seedance / OpenAI-compatible / MiniMax 的字段映射。

不适合：

- 剧本专属核心道具。
- 人工修某张图得到的经验。

### L3 项目级提示词 / Project Bible

**这是“某部作品”的长期事实层。**

建议新增或标准化：

- `visual-bible.json`
- `core-props.json`
- `character-bible.json` 或现有 character bible 的稳定扩展
- `style-bible.json`

适合：

- 世界观：现实世界、游戏世界、科技等级、末日美学。
- 长期视觉风格：高饱和废墟美学、霓虹血雾、现实冷淡蓝灰。
- 核心道具：绑定锁链、药剂包、传送门。
- 核心道具规则：外观、锚点、禁用漂移、活跃镜头范围。
- 主角长期身份锚点：发型、服装、轮廓、禁用漂移。

示例：

```json
{
  "projectId": "twins_cage",
  "visualBible": {
    "gameWorld": "high-saturation ruin aesthetic, neon blood mist",
    "realWorld": "cold blue-gray near-future holographic light"
  },
  "coreProps": [
    {
      "propId": "binding_chain",
      "displayName": "绑定锁链",
      "aliases": ["锁链", "黑色锁链"],
      "appearance": "semi-transparent black chain",
      "placementPolicy": {
        "anchorType": "wrist_endpoint_pair",
        "requiredVisibleAnchors": ["陆衍.wrist", "零.wrist"],
        "forbiddenAnchors": ["neck", "collar", "throat"]
      },
      "continuityPolicy": {
        "mustRemainSameObjectAcrossShots": true,
        "activeShotIds": ["shot_005", "shot_006", "shot_007", "shot_008", "shot_009"]
      }
    }
  ]
}
```

### L4 剧本/季弧提示词

**这是“整份剧本怎么展开”的结构层。**

适合：

- 集数列表。
- 每集标题、主事件、伏笔。
- 长期关系变化。
- 跨集状态：角色是否知道真相、道具是否仍存在、某地点是否毁坏。

不适合：

- 某一镜构图。
- 单次出图错误修复。

### L5 剧集级提示词 / Episode Context

**这是“一集内的运行状态”。**

适合：

- 本集开始状态和结束状态。
- 本集出场角色。
- 本集地点集合。
- 本集活跃核心道具。
- 本集 tone / pace / ending hook。
- 当前集继承自上一集的伤势、服装、道具、关系状态。

对于《双生囚笼》第 1 集：

```json
{
  "episodeNo": 1,
  "title": "链接",
  "episodeGoal": "建立陆衍与零的强制绑定关系",
  "activeCoreProps": ["binding_chain"],
  "startState": "陆衍进入游戏登录空间",
  "endState": "两人站在虚空悬崖边，传送门打开",
  "continuityLocks": [
    "binding_chain remains attached to wrists",
    "blue-white login void remains the scene anchor"
  ]
}
```

### L6 场景级提示词 / Scene Pack

**这是“一场戏”的可读性控制层。**

现有 `sceneGrammarAgent` 已经接近这个层级。

适合：

- `scene_goal`
- `dramatic_question`
- `start_state / end_state`
- `location_anchor / time_anchor`
- `cast`
- `action_beats`
- `space_layout`
- `camera_grammar`
- `hard_locks / forbidden_choices`

补充建议：

- `active_props`
- `prop_anchor_locks`
- `scene_reference_strategy`

例如：

```json
{
  "scene_id": "scene_001",
  "location_anchor": "游戏登录空间·虚空蓝光",
  "active_props": ["binding_chain"],
  "prop_anchor_locks": [
    {
      "propId": "binding_chain",
      "lock": "both endpoints stay on visible wrists"
    }
  ]
}
```

### L7 镜头级提示词 / Shot Pack

**这是唯一允许强绑定“当前画面该看见什么”的层。**

适合：

- 当前 shot 的 action / dialogue / camera。
- 当前 shot 的主体。
- 当前 shot 的参考图。
- 当前 shot 的 entry/exit。
- 当前 shot 的 active props。
- 当前 shot 的 prop endpoint。

shot7 应该消费 L3/L5/L6 的 `binding_chain`，编译为：

```text
two men facing each other,
same semi-transparent black chain,
one endpoint locked around Lu Yan's wrist,
the other endpoint locked around Zero's wrist,
chain stretched taut between their visible wrists
```

这段不是全局模板，而是由当前镜头命中 `binding_chain.placementPolicy` 后生成。

### L8 Candidate / Retry Patch

**这是一次失败后的临时修复层。**

适合：

- `shot_007 prop_anchor_drift`
- `show both wrists`
- `remove neck/collar chain`
- `reduce close-up crop so endpoints are visible`

规则：

- 默认只对当前 shot / 当前 retry 生效。
- 不自动写回项目级。
- 如果连续多次出现同类问题，Director 可以建议“提升为 L3 项目道具规则”，但必须可审计。

## Prompt Assembly Order

所有 agent 的 prompt 组装都应按这个顺序：

1. `L0 system contract`
2. `L1 product domain contract`
3. `L2 task/provider preset`
4. `L3 project/series bible`
5. `L5 episode context`
6. `L6 scene pack`
7. `L7 shot pack`
8. `L8 retry patch`
9. `output schema`

冲突优先级：

1. 用户本轮明确指令最高，但必须记录到 `run override`。
2. L8 可以临时覆盖 L7，但不能污染 L3。
3. L7 只能覆盖当前镜头表现，不能改项目事实。
4. L3 项目事实高于 L2 provider 风格词。
5. L0/L1 只处理执行规则，不处理剧情事实。

## Recommended Context Envelope

每个 agent 接收的上下文建议统一成 envelope：

```json
{
  "harness": {
    "schemaVersion": "harness.prompt.v1",
    "agentRole": "prompt_engineer",
    "taskType": "image_prompt",
    "outputContract": "json_only",
    "executionLanguage": "en",
    "displayLanguage": "zh"
  },
  "product": {
    "identityBinding": "id_first",
    "deliveryFormat": "vertical_short_drama",
    "promptFields": ["image_prompt_en", "negative_prompt_en", "display_prompt_zh"]
  },
  "providerPreset": {
    "provider": "openai_compat",
    "capabilities": ["text_to_image", "image_reference"],
    "genericNegativeRules": ["blurry", "low quality", "watermark"]
  },
  "project": {
    "projectId": "twins_cage",
    "visualBibleRef": "temp/projects/.../visual-bible.json",
    "corePropsRef": "temp/projects/.../core-props.json"
  },
  "episode": {
    "episodeId": "episode_001",
    "activeCoreProps": ["binding_chain"],
    "continuityLocks": []
  },
  "scene": {
    "sceneId": "scene_001",
    "locationAnchor": "游戏登录空间·虚空蓝光",
    "actionBeats": []
  },
  "shot": {
    "shotId": "shot_007",
    "action": "双人近景。零与陆衍面对面，锁链绷直。",
    "characters": [],
    "activeProps": []
  },
  "retryPatch": null
}
```

## Agent Responsibilities

### Director

- Owns context assembly.
- Persists every context layer into `state.json`.
- Decides whether L8 retry patch can be promoted to L3/L5.
- Must not let individual agents silently invent project facts.

### Script Parser

- Extracts L4/L5 facts from source text.
- Does not create polished visual prompt.
- Should preserve source evidence: episode number, raw block, shot number.

### Character Registry

- Owns character identity and ID binding.
- May write L3 character bible candidates.
- Must not absorb scene props into identity anchors.

### Core Prop Registry

Recommended new agent/module.

- Owns L3/L5 prop contracts.
- Extracts recurring script-specific props.
- Stores aliases, appearance, anchor policy, forbidden anchors, active shot ranges.
- Feeds Prompt Engineer, Continuity Checker, Video Router, Preflight QA.

### Prompt Engineer

- Consumes L2/L3/L5/L6/L7.
- Produces provider-facing image prompt.
- Must not hardcode project-specific facts in generic presets.
- Must keep execution/display fields separated.

### Scene Grammar Agent

- Owns L6 scene packs.
- Should reference active props by `propId`, not restate full project bible every time.

### Director Pack Agent

- Owns scene-level camera, blocking, candidate strategy.
- Should express prop constraints as continuity locks, not as global prompt text.

### Seedance Prompt Agent / Video Router

- Converts structured packs into provider-ready blocks.
- Should preserve `reference_binding`, `entry_exit`, `continuity_locks`, `negative_rules`.
- Must include active prop contracts when video generation depends on a prop.

### QA Agents

- Evaluate against the same structured contracts.
- If a shot violates a project prop rule, report `prop_anchor_drift` or similar structured issue.
- Do not invent new permanent rules without Director promotion.

## Observation Contract

Every agent should emit:

```json
{
  "status": "success|warning|error",
  "summary": "one-line result",
  "scopeConsumed": ["L2", "L3", "L6", "L7"],
  "scopeProduced": ["L7"],
  "next_actions": [],
  "artifacts": [],
  "recovery": {
    "root_cause_hint": null,
    "safe_retry_instruction": null,
    "stop_condition": null
  }
}
```

## Error Recovery Rules

| Failure | Scope | Default Action | Promotion Rule |
|---|---|---|---|
| JSON malformed | L0/L2 | retry same prompt, then fallback | never promote |
| identity drift | L3/L7 | reanchor regenerate | update character bible only after human review |
| core prop anchor drift | L3/L7 | retry current shot with prop contract + reference | promote only if same prop lacks policy |
| scene geography drift | L6/L7 | scene pack repair | promote to episode only if repeated across scene |
| provider timeout | L2 | retry provider / switch transport | never becomes prompt rule |
| QA false pass | L8 | add checker rule/test | may update L1 if domain-general |

## Context Budget Rules

1. L0/L1 must stay short and invariant.
2. L3 project bible is referenced by ID/path; only active snippets are inlined.
3. L5 episode context includes only active episode state.
4. L6 scene pack includes only the current scene.
5. L7 shot pack includes only current shot plus adjacent references when needed.
6. L8 retry patch expires after the retry unless persisted by Director.

## Immediate Implementation Plan

1. Add `src/domain/harnessContext.js`
   - Normalize scope envelope.
   - Validate allowed fields per scope.
2. Add `src/agents/corePropRegistry.js`
   - Extract script-specific recurring props.
   - Persist `core-props.json`.
3. Update `Director`
   - Build context envelope before Prompt Engineer and Seedance Prompt Agent.
   - Save `harness-context.snapshot.json` per run.
4. Update `Prompt Engineer`
   - Consume `corePropRegistry` instead of hardcoded prop terms.
   - Emit `scopeConsumed / scopeProduced`.
5. Update `Scene Grammar Agent`
   - Add `active_props` and `prop_anchor_locks`.
6. Update `Preflight QA`
   - Validate prop/identity/geography contracts using structured issue codes.
7. Add tests
   - `tests/harnessContext.test.js`
   - `tests/corePropRegistry.test.js`
   - prompt/continuity/preflight regression for `双生囚笼` shot6/shot7.

## Acceptance Criteria

1. A project-specific rule can be represented without editing global prompt constants.
2. `双生囚笼` binding chain is stored as data under project/episode scope.
3. shot7 prompt can be regenerated with wrist endpoints from `corePropRegistry`.
4. QA can report prop anchor drift as a structured issue.
5. Artifacts show which context levels each agent consumed and produced.
6. A retry patch does not silently become a global prompt rule.


