# Resume Run Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `resume-from-step --run-id=<id>` 在从 `video` 及后续步骤续跑时严格绑定指定 run 的分镜图与前置状态，杜绝跨 run 参考图错配。

**Architecture:** 在 `scripts/resume-from-step.js` 中新增“严格 run 绑定模式”，用指定 run 的 snapshot 作为恢复基线，并在恢复前做前置状态与图片路径校验。恢复后把来源信息写入 live state，便于日志和 QA 追踪。

**Tech Stack:** Node.js, existing CLI resume flow, JSON state snapshots, node:test

---

### Task 1: 明确严格绑定模式的入口

**Files:**
- Modify: `scripts/resume-from-step.js`
- Test: `tests/resumeFromStep.test.js`

- [ ] **Step 1: 写失败测试，固定 `--run-id` 的目标语义**

在 `tests/resumeFromStep.test.js` 增加用例：
- 指定 `--run-id` 时，恢复上下文标记为严格绑定模式
- state 来源应选择指定 run 的 snapshot，而不是 live state

- [ ] **Step 2: 跑单测确认当前行为不满足**

Run: `node --test tests/resumeFromStep.test.js`
Expected: 新增用例失败，说明当前仍可能读 live state

- [ ] **Step 3: 在 `scripts/resume-from-step.js` 实现恢复模式分流**

新增类似能力：
- 判断 `parsed.runId` 时进入 `strict_run_binding`
- 将 snapshot 作为恢复基线
- 保留未传 `run-id` 时的兼容逻辑

- [ ] **Step 4: 重新运行单测**

Run: `node --test tests/resumeFromStep.test.js`
Expected: 绑定模式相关用例通过

### Task 2: 给 `video` 续跑加参考图来源校验

**Files:**
- Modify: `scripts/resume-from-step.js`
- Test: `tests/resumeFromStep.test.js`

- [ ] **Step 1: 写失败测试覆盖错配风险**

新增测试场景：
- snapshot 中 `imageResults` 路径不存在时失败
- `imagePath` 指向非指定 run 目录时失败
- `video` prerequisites 不完整时失败

- [ ] **Step 2: 跑测试确认当前没有拦住这些风险**

Run: `node --test tests/resumeFromStep.test.js`
Expected: 至少一个新增测试失败

- [ ] **Step 3: 实现严格校验函数**

在 `scripts/resume-from-step.js` 中增加小而专注的 helper：
- 解析严格绑定允许的图片根目录
- 校验 `imageResults`
- 校验 step prerequisites 在 snapshot 中完整

- [ ] **Step 4: 再跑测试**

Run: `node --test tests/resumeFromStep.test.js`
Expected: 新增失败场景全部转为 pass

### Task 3: 把恢复来源写回 live state 并增强 dry-run 输出

**Files:**
- Modify: `scripts/resume-from-step.js`
- Test: `tests/resumeFromStep.test.js`

- [ ] **Step 1: 写失败测试固定可观测性**

新增用例：
- 恢复后 live state 带 `resumeContext`
- `dry-run` 返回值或输出包含 `sourceRunId`、`sourceSnapshotPath`、恢复模式

- [ ] **Step 2: 跑测试确认当前缺这些信息**

Run: `node --test tests/resumeFromStep.test.js`
Expected: 新用例失败

- [ ] **Step 3: 实现元信息落盘与 dry-run 描述增强**

具体包括：
- 在写回 state 时保留 `resumeContext`
- `describeResumePlan()` 增加 `resumeMode` / `sourceRunId` / `sourceSnapshotPath`

- [ ] **Step 4: 再跑测试**

Run: `node --test tests/resumeFromStep.test.js`
Expected: 所有相关测试通过

### Task 4: 回归验证兼容行为

**Files:**
- Test: `tests/resumeFromStep.test.js`
- Test: `tests/runCli.test.js`

- [ ] **Step 1: 增加或确认兼容测试**

覆盖：
- 未传 `--run-id` 时仍按原有最新可恢复逻辑工作
- legacy / project 两种入口不被破坏

- [ ] **Step 2: 运行目标测试集**

Run: `node --test tests/resumeFromStep.test.js tests/runCli.test.js`
Expected: 全部通过

- [ ] **Step 3: 做语法检查**

Run: `node --check scripts/resume-from-step.js`
Expected: 无语法错误

### Task 5: 更新使用说明

**Files:**
- Modify: `README.md` or `docs/sop/runbook.md`

- [ ] **Step 1: 补充 `--run-id` 的严格绑定说明**

写明：
- 指定 `--run-id` 时会严格使用该 run 的 snapshot 和参考图
- 如果缺图会直接失败，不再自动回退

- [ ] **Step 2: 手工核对文档表述**

确认文档没有继续暗示“可能会复用最新状态”

- [ ] **Step 3: 最终验证**

Run: `node --test tests/resumeFromStep.test.js tests/runCli.test.js`
Expected: 通过
