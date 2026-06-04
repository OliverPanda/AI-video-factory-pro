# AI 视频流水线补跑与缓存恢复 SOP

## 适用场景

当用户要求重新跑样例、清缓存、补跑失败任务、只补缺失镜头、检查预飞检状态，或明确说“跑到生视频之前”“补跑吧”“清缓存”“重新跑电工先生”时，使用这份 SOP。

这不是通用 Codex skill，而是 `AI-video-factory-pro` 项目专属运行手册。目标是在不误删有效产物、不误触发昂贵视频生成的前提下，把流水线恢复到可检查状态。

## 操作原则

- 先确认当前目录是 `D:\My-Project\AI-video-factory-pro`。
- 运行前先读脚本、样例路径和现有状态，不直接执行昂贵步骤。
- 用户说“跑到生视频之前”时，必须带 `--stop-before-video`。
- 用户说“清缓存”时，先定位精确 job 缓存目录，只删除匹配目标样例的缓存。
- 如果上次运行已经生成了部分镜头，优先恢复或补缺失镜头，不默认冷启动重跑。
- 不要笼统删除 `temp`、`output` 或整个项目缓存目录，除非用户明确要求且路径已核验。
- 最终说明本次是复用缓存、清了缓存、补了缺失资产，还是已经到达预飞检并停在生视频前。

## 标准流程

### 1. 判断用户意图

常见短指令映射：

- `重新跑...跑到生视频之前`：重新跑指定样例，并加 `--stop-before-video`。
- `清缓存`：只删除匹配样例的 legacy job / project cache。
- `补跑吧`：基于现有状态继续，优先补缺失产物。
- `跑双生囚笼分镜`：先定位样例或脚本，再跑到分镜/预飞检阶段，避免直接生视频。

### 2. 定位样例、状态和缓存

优先用快速搜索，不做大范围递归扫全仓库。

```powershell
rg --files | rg "电工先生|双生囚笼|samples|state\.json"
Get-ChildItem temp -Directory -ErrorAction SilentlyContinue | Where-Object Name -like "*电工先生*"
Get-ChildItem temp\projects -Directory -ErrorAction SilentlyContinue | Where-Object Name -like "*电工先生*"
```

重点检查：

- `state.json`
- `imageResults`
- `preflightQaReport`
- 生成的 prompt 列表
- character reference sheets
- 单镜头输出目录

### 3. 清缓存前先确认可恢复内容

清缓存前先说明现有状态：

- 哪些步骤已经完成
- 哪些镜头或资产缺失
- 是否已有预飞检结果
- 是否只是 provider/API 失败，而不是流水线逻辑失败

只有用户明确要冷启动或“清缓存”时，才删除缓存。

### 4. 跑到生视频前

已知 legacy 样例命令：

```powershell
node scripts/run.js samples/电工先生.txt --style=realistic --stop-before-video
```

如果命令输出出现“使用缓存的角色档案”“使用缓存的Prompt列表”“使用缓存的图像结果”，说明本轮复用了缓存。若用户期待冷启动，应暂停并走定向清缓存。

### 5. 定向清缓存

缓存目录常见模式：

```text
temp\legacy_<样例名>_<hash>
temp\projects\legacy_project_<样例名>_<hash>
```

删除前必须确认解析后的绝对路径仍在本仓库目录下。Windows 下使用 PowerShell 原生命令和 `-LiteralPath`，避免拼接字符串跨 shell 删除。

### 6. 补缺失镜头

如果只有部分镜头失败：

- 先看 `state.imageResults`。
- 保留已完成镜头。
- 只补缺失或失败的 shot id。
- 补跑后再确认预飞检是否重新生成。

### 7. 完成口径

收尾只说明关键事实：

- 本次运行了什么命令或清理了什么路径
- 是否复用缓存
- 是否重新生成缺失资产
- 是否到达预飞检
- 是否已停在视频生成前

不要把大段流水线日志直接贴给用户，除非用户要求看原始输出。
