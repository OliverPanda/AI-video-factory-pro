# AI漫剧自动化生成系统 - v1 已知限制

> 更新时间：2026-06-20

这份文档只记录当前版本已知且应显式暴露的限制，不记录理想状态。

## 1. 真实浏览器 E2E 证据仍未闭环

当前后端自动化、前端构建和部分前端纯逻辑回归已经补齐，但：

- 真实工作区产物上的浏览器链路证据仍不完整
- 特别是 `Dashboard -> ProjectDetail -> DramaDetail -> Review`
- 以及 `Editor / Character / Scene / Voice` 多页面真实数据回归

这意味着：

- 代码能力不等于已形成完整真实环境验收证据

## 2. 审片页的风险标记仍以当前已有数据为主

Review 工作台已可读取：

- `post-compose-review.json`
- `edit-task-pack.json`
- `human-review-queue.json`

但 clip 级风险标签仍受当前后处理输入结构限制，真实风险质量取决于上游后处理报告的细度。

## 3. Editor 不是完整 DCC 编辑器

当前 `Editor.tsx` 只支持有限字段编辑：

- `dialogue`
- `scene`
- `cameraType`
- `durationSec`

当前不承诺：

- 分镜 drag-sort
- 复杂批量编辑
- 多字段联动校验工作流

## 4. Style Preset 资源规格尚未收口

当前 Style Preset 预览图已存在，但：

- 资源仍是 `.png`
- 尚未统一到计划中的最终交付规格

## 5. `router.js` 仍偏大

Workbench HTTP 路由功能已经覆盖：

- 项目 / 剧本 / 分集
- review
- storyboard
- settings
- run 控制

但当前 `src/workbench/http/router.js` 仍然偏大，后续仍有拆分空间。

## 6. 真实 API 成本与稳定性仍需人为控制

视频生成、图像生成和部分外部服务具有以下特点：

- 有费用
- 有配额限制
- 有供应商波动
- 有审核 / 频控 / 超时风险

因此当前仍建议：

- 先跑 `--max-shots`
- 先跑 `--stop-before-video`
- `video` 续跑先 `--dry-run`

## 7. 当前部署形态偏本地单机

当前仓库适合：

- 单机开发
- 单机生产
- 局域网审片

当前不承诺：

- 多租户
- 云端弹性伸缩
- 完整权限体系
- SaaS 级任务调度

## 8. M5 最终上线材料仍未全部形成

截至当前状态，仍缺：

- 完整 UAT 结果
- `v1.0.0` tag
- Demo 视频

因此“功能存在”不等于“发布完成”。
