# 2026-04-01 Character Consistency System Implementation

## Goal

将角色一致性方案升级为“项目级角色身份资产 + 分镜级连续状态 + 双层质检”的可落地系统。

## Architecture

本实施计划按最适合当前仓库渐进升级的顺序拆分：

1. 先补 `CharacterBible` DTO 与 store
2. 再给 `EpisodeCharacter / ShotPlan` 接入引用与连续状态
3. 再升级 `characterRegistry / promptEngineer`
4. 再在现有 `Consistency Checker` 上做身份一致性增强
5. 最后新增 `Continuity Checker` 并接入 `Director`

这样不会推倒现有 `director / scriptParser / promptEngineer / imageGenerator / consistencyChecker / videoComposer`，而是在主线上逐层增强。

## Task 1: Add CharacterBible Project Asset

**Files:**
- Create: `src/domain/characterBibleModel.js`
- Modify: `src/utils/fileHelper.js`
- Create: `src/utils/characterBibleStore.js`
- Test: `tests/characterBibleModel.test.js`
- Test: `tests/characterBibleStore.test.js`

**Deliverable:**
- 项目级角色身份资产 DTO
- `temp/projects/<projectId>/character-bibles/` store

## Task 2: Extend EpisodeCharacter and ShotPlan for Continuity

**Files:**
- Modify: `src/domain/characterModel.js`
- Modify: `src/domain/projectModel.js`
- Test: `tests/characterModel.test.js`
- Test: `tests/projectModel.test.js`

**Deliverable:**
- `EpisodeCharacter.characterBibleId`
- `EpisodeCharacter.lookOverride`
- `ShotCharacter.poseIntent / relativePosition / facingDirection / interactionTargetEpisodeCharacterId`
- `ShotPlan.continuityState`

## Task 3: Add Example Project Asset Layout

**Files:**
- Modify: `samples/project-example/`
- Modify: `README.md`
- Modify: `docs/agents/run-package-example.md`

**Deliverable:**
- 项目级 `character-bibles/` 示例
- 示例引用关系

## Task 4: Upgrade Character Registry to Resolve CharacterBible

**Files:**
- Modify: `src/agents/characterRegistry.js`
- Test: `tests/characterRegistry.test.js`
- Test: `tests/promptEngineer.artifacts.test.js`

**Deliverable:**
- `CharacterBible + EpisodeCharacter` 合并后的统一运行时角色视图
- registry artifacts 中增加角色锚点信息输入快照

## Task 5: Upgrade Prompt Engineer to Inject Continuity

**Files:**
- Modify: `src/agents/promptEngineer.js`
- Modify: `src/llm/prompts/promptEngineering.js`
- Test: `tests/promptEngineer.test.js`
- Test: `tests/promptEngineer.artifacts.test.js`

**Deliverable:**
- prompt 由 identity block / scene block / continuity block / camera block 组成
- `ShotContinuityState`、`ShotCharacter` 进入 prompt 构造

## Task 6: Upgrade Identity Consistency Checker

**Files:**
- Modify: `src/agents/consistencyChecker.js`
- Test: `tests/ttsAgent.artifacts.test.js`
- Create: `tests/consistencyChecker.identity.test.js`

**Deliverable:**
- 更明确的 identity drift 检查项
- 报告中增加发型 / 主服装 / 主配色 / 年龄感等漂移标签

## Task 7: Add Continuity Checker Agent

**Files:**
- Create: `src/agents/continuityChecker.js`
- Create: `src/llm/prompts/continuityCheck.js`
- Create: `tests/continuityChecker.test.js`
- Create: `tests/continuityChecker.artifacts.test.js`

**Deliverable:**
- 独立 `Continuity Checker`
- 输出 `continuity-report.json`
- 输出 `flagged-transitions.json`

## Task 8: Integrate Continuity Checker into Director

**Files:**
- Modify: `src/agents/director.js`
- Modify: `src/utils/runArtifacts.js`
- Test: `tests/director.artifacts.test.js`
- Test: `tests/pipeline.acceptance.test.js`

**Deliverable:**
- Director 顺序升级为：
  - identity consistency
  - continuity checking
- auditable run package 新增 `06-continuity-checker/`

## Task 9: Extend Auditable Artifacts and IO Docs

**Files:**
- Modify: `docs/agents/agent-io-map.md`
- Modify: `docs/agents/run-package-example.md`
- Modify: `docs/agents/consistency-checker.md`
- Create: `docs/agents/continuity-checker.md`

**Deliverable:**
- 文档口径同步
- 区分 identity consistency 与 shot continuity

## Task 10: Add Focused Acceptance Coverage

**Files:**
- Create: `tests/characterConsistency.acceptance.test.js`
- Modify: `scripts/run-tests.js`
- Modify: `package.json`

**Deliverable:**
- 一个最小可跑的角色一致性验收样本
- 断言角色锚点、continuity state、identity report、continuity report 都会落盘

## Task 11: Final Review

**Review Scope:**
- `src/agents/characterRegistry.js`
- `src/agents/promptEngineer.js`
- `src/agents/consistencyChecker.js`
- `src/agents/continuityChecker.js`
- `src/agents/director.js`
- `src/domain/characterBibleModel.js`
- `src/utils/characterBibleStore.js`

**Verification:**
```bash
node --test --test-isolation=none tests/characterBibleModel.test.js tests/characterBibleStore.test.js tests/promptEngineer.test.js tests/consistencyChecker.identity.test.js tests/continuityChecker.test.js tests/continuityChecker.artifacts.test.js tests/director.artifacts.test.js tests/pipeline.acceptance.test.js tests/characterConsistency.acceptance.test.js
```

## Notes

### What We Are Explicitly Not Doing in Phase 1

- 不上 Milvus
- 不上 MemLong
- 不做训练级骨骼网络
- 不做对抗训练

### What We Are Locking In

- 项目级身份资产
- 分镜级连续状态
- 前置约束 + 后置质检双闭环
- 可审计运行包

## Decision

如果要把“角色一致性”真正做成可控能力，应该优先执行：

- `Task 1-8`

其中最关键的主线是：

- `CharacterBible`
- `ShotContinuityState`
- `Prompt Engineer` 升级
- `Continuity Checker` 新增

这四项是整个方案最核心的控制点。
