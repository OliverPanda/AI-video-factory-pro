# Changelog

## Unreleased

### Added

- Workbench 审片工作台 React 页面：
  - `/review/:runId`
  - `PreviewReviewPage`
  - `PreviewTopbar`
  - `TimelineNavigator`
  - `PreviewPlayerPanel`
  - `FindingInspector`
  - `EditTaskDrawer`
- review 后端 API：
  - `GET /api/runs/:id/review`
  - `GET /api/runs/:id/review/clips`
  - `PUT /api/runs/:id/review/tasks/:taskId`
  - `GET /api/runs/:id/review/video`
- 后处理 fixtures：
  - `tests/fixtures/post-processing/`
- 自测与交付文档：
  - `docs/superpowers/test-reports/2026-06-19-M0-M4-自测报告.md`
  - `docs/superpowers/plans/2026-06-19-交付现状与开发排期勾选清单.md`

### Changed

- `Director` 已串入 4 个后处理步骤：
  - storyboard context
  - cross-video consistency
  - AV packaging
  - post-compose review
- `resume-from-step` 已支持：
  - `post_review`
  - `cross_consistency`
- `Editor.tsx` 已切换为真实 storyboard API，不再依赖原型接口
- Character / Scene / Voice 页面已切到真实 run 数据并支持基础编辑写回
- Workbench 前端对保存后回读逻辑做了修正：
  - 同一 run 重新打开时优先读取最新 episode detail
- 审片页对 grouped `review/clips` payload 的消费已修正
- 审片页过滤后选中 clip 的回退逻辑已修正
- `DramaDetail` 在失效 `run` 查询参数下会回退到当前实际 run

### Fixed

- `review/clips` grouped 返回结构导致前端 `.map()` 报错的问题
- 保存后重新打开同一 run 时，shot / character / scene / voice 被旧 snapshot 覆盖的问题
- 审片页过滤刷新后，当前选中 clip 可能落到隐藏项的问题

### Verified

- `node --test tests/pipeline.acceptance.test.js tests/postProcessingLoop.e2e.test.js tests/resumeFromStep.test.js`
- `NODE_OPTIONS=--experimental-strip-types node --test tests/workbench/reviewClips.frontend.test.mjs tests/workbench/workbenchProject.frontend.test.mjs tests/workbench/workbenchServer.test.js`
- `pnpm --dir views build`
