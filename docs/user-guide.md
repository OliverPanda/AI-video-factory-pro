# AI漫剧自动化生成系统 - 用户使用指南

> 适用范围：当前仓库已落地的 CLI + Workbench + 审片工作台能力  
> 更新时间：2026-06-20

## 1. 你能用它做什么

当前系统支持两类主要工作：

1. 用 CLI 从剧本生成漫剧视频
2. 用 Workbench 查看项目、运行记录、后处理结果、审片任务和可编辑资产

当前推荐把它理解成一套“生成 + 复核 + 编辑修正”的本地工作台，而不是纯黑盒一键生成器。

## 2. 最小使用前提

你至少需要准备：

- Node.js 18+
- FFmpeg / FFprobe
- `.env` 中的 LLM / 图像 / TTS / 视频相关配置

安装依赖：

```bash
npm install
```

安装 FFmpeg：

```bash
winget install Gyan.FFmpeg
ffmpeg -version
ffprobe -version
```

复制环境变量模板：

```bash
cp .env.example .env
```

## 3. 运行模式

> v1.2（D1）起只保留**项目模式**；兼容单文件模式（位置参数 `.txt` 直跑自动桥接）已整体移除。

### 3.1 项目模式

适合多项目、多剧集管理：

```bash
node scripts/init-sample-project.js
node scripts/run.js --project=project-example --script=pilot --episode=episode-1 --style=realistic
```

小说 / 大纲类输入在剧本文本落为项目数据时按 `--input-format=raw-novel` 解析（默认 `professional-script`）。

## 4. 低成本冒烟建议

第一次接新环境时，不建议直接跑完整视频生成。

推荐先用：

```bash
node scripts/run.js --project=project-example --script=pilot --episode=episode-1 --style=realistic --max-shots=2 --stop-at=before_video
```

这个组合适合先验证：

- 剧本解析
- 角色档案
- Prompt
- 出图
- 一致性 / 连贯性
- 后处理 JSON 产物

同时避免直接进入高成本视频阶段。

## 5. 断点续跑

最常用命令：

```bash
node scripts/resume-from-step.js --step=lipsync --project=project-example --script-id=pilot --episode=episode-1 --dry-run --style=realistic
node scripts/resume-from-step.js --step=lipsync --project=project-example --script-id=pilot --episode=episode-1 --style=realistic
node scripts/resume-from-step.js --step=video --project=project-example --script-id=pilot --episode=episode-1 --style=realistic --confirm-paid-video
```

说明：

- `--dry-run` 先看恢复计划，不做实际变更
- `--step=video` 默认不会直接执行付费视频生成
- 必须显式传 `--confirm-paid-video` 才会真正执行

如果要严格绑定某次历史 run：

```bash
node scripts/resume-from-step.js --step=video --project=project-example --script-id=pilot --episode=episode-1 --run-id=run_xxx --dry-run --style=realistic
node scripts/resume-from-step.js --step=video --project=project-example --script-id=pilot --episode=episode-1 --run-id=run_xxx --style=realistic --confirm-paid-video
```

## 6. Workbench 怎么用

启动本地 Workbench：

```bash
npm run workbench
```

默认地址：

- API：`http://127.0.0.1:4180/api/workbench`
- Web：`http://127.0.0.1:4180/`

前端开发态：

```bash
pnpm --dir views dev --host 127.0.0.1 --port 4305
```

常用页面：

- `/projects`：项目列表
- `/project/:id`：项目详情 / 剧本管理 / 运行入口
- `/drama/:id`：剧集详情 / QA / 成片预览 / 审片入口
- `/review/:runId`：审片工作台
- `/editor?...`：分镜编辑器
- `/drama/:id/characters`：角色管理
- `/drama/:id/scenes`：场景管理
- `/drama/:id/voices`：配音管理

## 7. 审片工作台使用路径

推荐路径：

1. 进入 `/projects`
2. 打开一个项目
3. 在项目详情选择某个剧集
4. 点击“审片”
5. 在 `/review/:runId` 做以下动作：
   - 浏览 clips
   - 查看 findings
   - 审批 task（Approve / Skip / Manual Review）

当前已验证能力：

- `GET /api/runs/:id/review`
- `GET /api/runs/:id/review/clips`
- `PUT /api/runs/:id/review/tasks/:taskId`
- `GET /api/runs/:id/review/video`
- 视频流支持 `Range 206`

## 8. 编辑器与资产页怎么用

### 8.1 分镜编辑器

入口：

- 项目页中的“编辑分镜”
- 或直接打开 `/editor?projectId=...&scriptId=...&episodeId=...&runId=...`

当前支持修改：

- `dialogue`
- `scene`
- `cameraType`
- `durationSec`

### 8.2 角色 / 场景 / 配音

入口：

- `/drama/:id/characters`
- `/drama/:id/scenes`
- `/drama/:id/voices`

当前支持：

- 角色：基础信息、性格、视觉描述、prompt token
- 场景：标题、目标、地点、cast、视觉母题、校验状态
- 配音：provider、gender、voiceSource、角色绑定

当前前端已补一层保护：

- 保存失败会回滚到上一次成功状态
- 同一 run 重新打开时，优先回读最新 episode detail，而不是旧 snapshot

## 9. 如何判断一轮 run 过没过

优先看：

1. `run-jobs/<runId>.json`
2. `delivery-summary.md`
3. `qa-overview.md`
4. 对应 agent 的 `manifest.json`

关键判断规则见：

- [docs/sop/qa-acceptance.md](docs/sop/qa-acceptance.md)

## 10. 常见排查入口

### 看运行状态

- `temp/projects/.../run-jobs/*.json`
- run 根目录 `qa-overview.md`

### 看最终交付

- `output/<project>/<episode>/final-video.mp4`
- `output/<project>/<episode>/delivery-summary.md`

### 看中间产物

- `temp/projects/.../runs/<runId>/`

### 看后处理

- `10b-post-compose-review/1-outputs/post-compose-review.json`
- `10b-post-compose-review/1-outputs/edit-task-pack.json`
- `12-human-review-queue/1-outputs/human-review-queue.json`

## 11. 当前已知边界

当前系统不是“无条件一键交付”：

- 真实工作区浏览器 E2E 证据仍需补足
- 文档里未承诺 drag-sort 分镜
- Style Preset 当前仍为 `.png`
- M5 的最终 UAT / Demo / Tag 还未形成完整交付闭环

已知限制请看：

- [docs/limitations-v1.md](docs/limitations-v1.md)
