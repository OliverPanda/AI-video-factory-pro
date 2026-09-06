# AI漫剧自动化生成系统 - 部署说明

> 适用版本：当前本地单机 / 局域网部署形态  
> 更新时间：2026-06-20

## 1. 部署目标

当前仓库更适合：

- 本地开发部署
- 单机内容生产部署
- 局域网内 Workbench 浏览与人工审片

当前不包含：

- 多租户 SaaS 化部署
- 云端自动伸缩
- 独立数据库服务编排

## 2. 运行依赖

### 基础依赖

- Windows 10/11 或兼容 Node/FFmpeg 的环境
- Node.js 18+
- npm / pnpm
- FFmpeg / FFprobe

### 外部服务依赖

- 文本 LLM（默认 `qwen`）
- 图像服务（OpenAI 兼容接口）
- TTS（默认 `minimax`）
- 视频服务（默认 `happyhorse + dashscope_async`）

## 3. 目录准备

建议工作目录结构：

```text
AI-video-factory-pro/
  src/
  scripts/
  views/
  docs/
  temp/
  output/
  .env
```

说明：

- `temp/`：运行缓存、状态和 run package
- `output/`：最终交付产物

## 4. 环境变量

复制模板：

```bash
cp .env.example .env
```

最低建议配置：

```bash
LLM_PROVIDER=qwen
LLM_VISION_PROVIDER=qwen
QWEN_API_KEY=...
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

IMAGE_API_BASE_URL=...
IMAGE_API_KEY=...

TTS_PROVIDER=minimax
TTS_TRANSPORT_PROVIDER=minimax
MINIMAX_API_KEY=...
MINIMAX_GROUP_ID=...

VIDEO_PROVIDER=happyhorse
VIDEO_TRANSPORT_PROVIDER=dashscope_async
DASHSCOPE_API_KEY=...
HAPPYHORSE_MODEL_ID=happyhorse-1.0-r2v
```

更多配置参考：

- [`.env.example`](../.env.example)

## 5. 安装与启动

### 安装依赖

```bash
npm install
```

### 安装 FFmpeg

```bash
winget install Gyan.FFmpeg
```

验证：

```bash
ffmpeg -version
ffprobe -version
```

### 启动 Workbench API

```bash
npm run workbench
```

默认监听：

- `http://127.0.0.1:4180/`

说明：

- 默认建议只监听本机 `127.0.0.1`
- 当前形态适合本地单机或受控局域网使用，不应直接暴露到公网
- 如果只是本机使用，通常不需要额外鉴权配置

### 启动前端开发服务器

```bash
pnpm --dir views dev --host 127.0.0.1 --port 4305
```

默认访问：

- `http://127.0.0.1:4305/projects`

### 前端生产构建

```bash
pnpm --dir views build
```

## 6. 生产链路验证顺序

首次部署或换环境后，建议按顺序验证：

1. `.env` 配置是否齐
2. `ffmpeg / ffprobe` 可用
3. `npm run workbench` 可启动
4. `pnpm --dir views build` 可通过
5. 跑低成本冒烟：

```bash
node scripts/run.js samples/双生囚笼.txt --style=realistic --max-shots=2 --stop-at=before_video
```

6. 再跑完整样本或指定项目模式

## 7. 常用运行命令

### 初始化项目样例

```bash
node scripts/init-sample-project.js
```

### 兼容模式

```bash
node scripts/run.js samples/寒烬宫变-pro.txt --style=realistic
```

### 项目模式

```bash
node scripts/run.js --project=project-example --script=pilot --episode=episode-1 --style=realistic
```

### 续跑

```bash
node scripts/resume-from-step.js --step=lipsync samples/双生囚笼.txt --dry-run --style=realistic
node scripts/resume-from-step.js --step=video samples/双生囚笼.txt --style=realistic --confirm-paid-video
```

## 8. 端口与路径建议

推荐默认值：

- Workbench API：`4180`
- 前端 dev：`4305`

如果端口被占用：

- 改 `WORKBENCH_PORT`
- 或调整 `pnpm --dir views dev --port <new-port>`

## 9. 局域网访问与最小鉴权

如果需要让同一局域网内其他机器访问 Workbench，先满足这几个前提：

- 手动把监听 host 改成局域网可访问地址
- 配置 `WORKBENCH_TOKEN`
- 明确这只是局域网受控访问，不是公网暴露方案

推荐做法：

```bash
set WORKBENCH_TOKEN=replace-with-a-long-random-string
npm run workbench
```

当前代码行为：

- 当 `WORKBENCH_TOKEN` 未配置时，默认不拦截写请求
- 当 `WORKBENCH_TOKEN` 已配置时，`POST / PUT / PATCH / DELETE` 请求必须带：

```text
Authorization: Bearer <WORKBENCH_TOKEN>
```

- 只读接口当前默认仍可访问，这属于本地 / 局域网最小方案

不建议：

- 不带 token 就把 Workbench 开到局域网
- 把当前 Workbench 直接映射到公网
- 把这套最小鉴权误当成完整用户权限系统

## 10. 产物与备份建议

建议备份以下内容：

- `.env`
- `temp/projects/`
- `output/`

不建议直接清空：

- 正在分析中的 `temp/projects/.../runs/<runId>/`

## 11. 上线前最小检查表

- [ ] `.env` 已按真实供应商配置
- [ ] `ffmpeg` 和 `ffprobe` 可用
- [ ] `npm run workbench` 可启动
- [ ] `pnpm --dir views build` 通过
- [ ] 如需局域网访问，已配置 `WORKBENCH_TOKEN`
- [ ] `pipeline.acceptance / postProcessingLoop / resumeFromStep` 回归通过
- [ ] 至少完成 1 次低成本冒烟 run
- [ ] Workbench 页面能打开项目、剧集和 run
- [ ] 最终交付目录 `output/.../final-video.mp4` 可正常产出

## 12. 当前未纳入部署承诺的部分

- 自动化创建 Windows 服务
- 反向代理 / HTTPS 完整方案
- 容器化部署
- 多用户权限隔离
- 云端对象存储统一上传闭环
