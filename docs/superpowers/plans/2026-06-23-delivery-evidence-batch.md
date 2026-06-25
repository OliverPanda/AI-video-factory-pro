# AI漫剧自动化生成系统 - 交付证据补齐批次

> 更新时间：2026-06-23  
> 目标：补齐真实样本、review 成片、voice 回读、浏览器 E2E 的可采信交付证据  
> 原则：先拿真实证据，再决定是否需要补兼容修复；不把“页面能打开”误判为“已完成交付验收”

## 1. 当前环境

- 当前代码对应的 Workbench API：`http://127.0.0.1:4192/api/workbench`
- 当前代码对应的前端 dev server：`http://127.0.0.1:4309`
- 本轮临时验证服务：
  - Workbench API：`http://127.0.0.1:4193/api/workbench`
  - 前端 dev server：`http://127.0.0.1:4400`
- 当前代码上，真实 run `run_1782144642947_6u2a7r` 的 `/api/runs/:runId/review` 已可返回 live state 兜底后的 `200`
- 当前代码上，真实 run `run_1782144642947_6u2a7r` 的 `/api/runs/:runId/review/video` 已可返回 `206 Partial Content`

## 2. 已拿到的真实证据

### 2.1 浏览器链路

- [x] 当前代码前端可以打开真实项目 `voices` 页面
- [x] 当前代码前端代理已正确连到 `4192`
- [x] 已固化空态截图：
  - [voice-manager-empty-state-4309.png](D:/My-Project/AI-video-factory-pro/voice-manager-empty-state-4309.png)

结论：

- 浏览器链路、路由和接口消费路径已打通
- 当前 `voices` 页面仍为空，不是页面故障，而是缺少真实 `audioVoiceResolution`

### 2.2 review JSON

- [x] 真实 run `run_job_regen_prompt_tighten_20260622145257206_4c5fd811`
  - `GET /api/runs/:id/review` 返回 `200`
  - `edit-task-pack.json` 中有 `4` 个 task
  - 当前 `finalVideoRef` 仍指向系统临时目录：

```text
C:\Users\zzjhy\AppData\Local\Temp\aivf-director-crQ2sh\job\output\提示词收紧测试__project_1\第01集__episode_1\final-video.mp4
```

结论：

- review 数据接口可用
- review 成片证据仍不成立，因为视频引用不持久

### 2.3 新真实 run

- [x] 已通过当前代码 Workbench 触发一条新的真实 run：
  - `run_1782144642947_6u2a7r`
- [x] 当前 run 已确认不是空转：
  - 自动从剧本文本重建 `10` 个 shot
  - 已完成 `2` 个角色三视图参考纸
  - 已完成真实视频、TTS、lipsync、compose、post compose review
- [x] 已从 `audio` 续跑成功：
  - TTS 合成 `7` 个对白镜头
  - `state.json` 中 `audioVoiceResolution` 共 `14` 条
  - `postComposeReview.status = needs_review`
  - `editTaskPack.tasks.length = 39`
  - 最终成片大小：`27,551,479` bytes

关键文件：

- [run_1782144642947_6u2a7r.log](D:/My-Project/AI-video-factory-pro/temp/projects/project_2e949b70-d2ea-49d5-a4d8-7f2d6c4180bf/scripts/script_1781538513427_203m76/episodes/episode_1781538513427_sey133/run-jobs/run_1782144642947_6u2a7r.log)

当前 artifact run dir：

```text
temp\projects\p_8bd14af8ac_双生囚笼\scripts\s_390e6b1367_双生囚笼\episodes\e01_45e46994a2_双生囚笼\runs\r_2026-06-22_161043_f4168853f9
```

真实交付文件：

```text
output\双生囚笼__project_2e949b70-d2ea-49d5-a4d8-7f2d6c4180bf\第01集__episode_1781538513427_sey133\final-video.mp4
```

## 3. 当前未完成项

### 3.1 review 成片

- [x] 新真实 run 跑到 `post_compose_review`
- [x] 确认 live `state.outputPath` 指向真实 `final-video.mp4`
- [x] 浏览器打开 `/review/:runId`
- [x] 验证成片接口可播放：
  - `GET /api/runs/run_1782144642947_6u2a7r/review/video`
  - 返回 `206`
  - `Content-Range: bytes 0-15/27551479`
- [ ] review task 写回未在真实样本上执行，避免污染本次审片任务状态

### 3.2 voice 回读

- [x] 新真实 run 产出 `audioVoiceResolution`
- [x] `voices` 页面不再是空态，显示 `3` 个说话人入口
- [x] 已验证一次保存并回读一致：
  - 将 `系统音.provider` 保存为 `minimax_verified`
  - 回读 `/storyboard?runId=run_1782144642947_6u2a7r`
  - `voices[0].provider = minimax_verified`
- [x] 已固化浏览器截图：
  - `review-run-1782144642947-after-clip-id-fix.png`
  - `voice-manager-run-1782144642947-merged-voices.png`

### 3.3 浏览器 E2E

- [x] `/review/:runId` 完整浏览器验证：
  - review API `200`
  - run detail API `200`
  - review clips API `200`
  - review video API `206`
  - 控制台 `0` error / `0` warning
- [x] `/drama/:id/voices` 完整浏览器验证：
  - project API `200`
  - run API `200`
  - episode API `200`
  - 页面显示 `3` 个说话人
  - 控制台 `0` error / `0` warning
- [ ] 如有真实 voice 数据，再补 `/editor` 关键字段保存回读

## 4. 已确认的阻塞点

- [x] 旧真实 run 的 `finalVideoRef` 多数仍指向系统临时目录
- [x] 这些临时目录下的 `final-video.mp4` 在验证时已经不存在
- [x] 因此旧 run 无法直接作为“review 成片可播放”的最终交付证据
- [x] 子进程退出后，Workbench 之前会把 run 卡在 `running`
- [x] 恢复成功后，run job 仍保留旧失败状态，artifacts 也未同步 post compose review 输出

这不是浏览器代理问题，也不是 `/review` JSON 路由问题，而是旧数据的成片引用不可复用。

补充说明：

- 本轮已补一条保守修复：当 detached run 子进程已经退出、但 run 没写 terminal 状态时，Workbench 会把该 run 收口为 `failed`，避免前端永远卡在 `running`
- 本轮新增兼容修复：review/storyboard/video API 在 artifacts 缺失时回退读取 `temp/<jobId>/state.json`
- 本轮新增 voice 修复：派生自 `audioVoiceResolution` 的 voice 可通过 PUT 创建，并与已保存 voice 配置合并展示

## 5. 当前判断

当前这批次已完成主要交付证据补齐：

1. 真实样本可从 live `state.json` 恢复出 review 数据
2. 真实成片可通过 review video API range 请求播放
3. voice 页面可显示真实 `audioVoiceResolution` 聚合数据，并完成保存回读

## 6. 本批次状态

- [x] 真实环境已搭起
- [x] 浏览器链路已验证
- [x] run 卡死状态已补保守收口
- [x] review 成片证据已完成
- [x] voice 回读证据已完成
- [x] 浏览器 E2E 证据已完成
- [ ] `/editor` 关键字段保存回读后置
