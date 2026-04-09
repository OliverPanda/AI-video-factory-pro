# Resume Run Binding Design

**Goal:** 修复 `resume-from-step` 在指定历史 `run-id` 时可能混用其他 run 参考图的问题，确保“按某次 run 的分镜图继续跑图生视频”具备严格、可审计、可复现的语义。

**Background**

当前 `scripts/resume-from-step.js` 的恢复逻辑会优先读取 live state，在部分场景下再回退到 `state.snapshot.json`。这让“继续某次指定 run”与“继续当前最新可恢复状态”混在一起，导致 `video` 续跑时可能消费错误的 `imageResults`。

这类错配对真实性校验尤其危险，因为：

- 用户以为在验证 `run_id1` 的图生视频效果。
- 实际运行可能使用了 `run_id2` 的参考图。
- 最终结果表面成功，但结论不可追溯，QA 无法确认生成依据。

## Scope

本设计只解决 `resume-from-step` 在显式指定 `--run-id` 时的恢复绑定问题，不改变普通 `run.js` 主流程，也不改动未指定 `--run-id` 的默认续跑体验。

## Requirements

### Functional

1. 当用户传入 `--run-id=<id>` 时，恢复逻辑进入“严格 run 绑定模式”。
2. 严格绑定模式下，step 之前的前置状态必须来自该 run 的 `state.snapshot.json`。
3. 从 `video` 开始续跑时，`imageResults`、`motionPlan`、`shotPackages` 等前置输入只能来自该 run。
4. 若指定 run 缺少所需前置状态、缺少参考图、或参考图路径不合法，命令必须直接失败，不允许静默回退到其他 run 或当前 live state。
5. `--dry-run` 必须清晰打印恢复来源、快照路径、将复用的前置状态、以及将重算的状态。

### Non-Functional

1. 不放松现有质量门槛，只修正错误复用来源的问题。
2. 保持未指定 `--run-id` 时的兼容行为。
3. 恢复来源要能在日志、state、artifact 中追踪。

## Design

### 1. 恢复模式分流

在 `resume-from-step` 中引入两种恢复模式：

- `latest_recoverable`
  - 未指定 `--run-id` 时使用。
  - 维持现有“最新可恢复 run / live state 优先”的兼容语义。
- `strict_run_binding`
  - 指定 `--run-id` 时使用。
  - 明确以该 run 的 `state.snapshot.json` 作为恢复基线。

关键点是：`strict_run_binding` 不是“优先使用 snapshot”，而是“只能使用 snapshot 及其可验证产物”。

### 2. 严格绑定的数据来源

`strict_run_binding` 下：

- `state` 恢复基线来自 `getStateSnapshotPath(runJob)`。
- `context.runJob.id` 作为本次恢复的唯一来源标识。
- `live state` 只作为当前 job 的写入目标，不作为前置输入来源。

这意味着恢复流程是：

1. 读取指定 run 的 snapshot。
2. 校验该 snapshot 是否满足目标 step 的 prerequisites。
3. 将需要保留的前置字段从 snapshot 写回当前 job live state。
4. 删除目标 step 及后续字段。
5. 从目标 step 开始重新执行。

### 3. 参考图和产物路径校验

针对 `video` 及后续步骤，需要新增来源一致性校验：

- `imageResults[*].imagePath` 必须存在。
- `imageResults[*].imagePath` 必须位于允许的来源根目录中。
- 允许的来源根目录只包含：
  - 指定 run 对应 legacy job 目录下的 `images/`
  - 如后续需要，可扩展为该 run artifact 目录中经明确声明的镜头静帧输出目录

如果任一镜头缺图、路径越界、或路径来自其他 run，对应命令直接报错，例如：

`指定 run-id=run_xxx 的参考图不完整：shot_004 缺少 imagePath，无法从 video 继续恢复。`

### 4. 恢复元信息落盘

在恢复后的 live state 中新增 `resumeContext`：

```json
{
  "resumeContext": {
    "mode": "strict_run_binding",
    "sourceRunId": "run_xxx",
    "sourceSnapshotPath": ".../state.snapshot.json",
    "requestedStep": "video",
    "strictRunBinding": true,
    "resumedAt": "2026-04-09T..."
  }
}
```

用途：

- 让后续排查能快速知道“这轮图生视频到底基于哪次 run 的图”。
- 让 artifact / delivery summary 能带上恢复来源。

### 5. dry-run 输出增强

`--dry-run` 新增输出：

- 恢复模式
- 绑定的 `run-id`
- 使用的 snapshot 路径
- 将保留的前置字段
- 将删除并重算的字段
- 校验到的参考图数量

这样用户在执行前就能看出是否真的在“按 run_id1 的图继续跑 video”。

## Error Handling

以下情况必须 hard fail：

1. 指定 `--run-id` 但找不到对应 run job。
2. 找到 run job，但没有 `state.snapshot.json`。
3. snapshot 缺少目标 step 所需 prerequisites。
4. `imageResults` 数量不足、镜头 ID 不匹配、或路径不存在。
5. `imagePath` 不属于指定 run 的允许目录。

不允许自动降级为：

- 当前 live state
- 最新 run
- 其他 run 的图片

## Files Likely Affected

- `scripts/resume-from-step.js`
  - 引入严格绑定模式
  - 调整 state 选择与写回逻辑
  - 增加来源校验与 dry-run 输出
- `tests/resumeFromStep.test.js`
  - 增加 `--run-id` 严格绑定测试
  - 覆盖缺图、越界路径、snapshot 缺失、source metadata 落盘
- 可能补充：
  - `README.md` 或 `docs/sop/runbook.md`
  - 说明 `--run-id` 的严格绑定语义

## Acceptance Criteria

1. 当用户执行 `node scripts/resume-from-step.js --step=video --run-id=<run1> ...` 时，只会使用 `run1` 的参考图。
2. 若 `run1` 缺图，则命令失败并明确指出缺失镜头。
3. 不会再出现“run_id1 的 video 续跑实际用了 run_id2 图片”的情况。
4. `--dry-run` 能直观看到绑定来源。
5. 未传 `--run-id` 的旧流程行为不被破坏。
