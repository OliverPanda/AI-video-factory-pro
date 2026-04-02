# `output/` 目录说明

本文档专门解释最终交付目录 `output/` 应该放什么、不该放什么，以及如何判断一次运行是否真的交付成功。

一句话总结：

- `output/` 只放最终交付物
- `output/` 不放过程证据
- `temp/` 负责可审计中间产物

## `output/` 的定位

`output/` 不是调试目录，也不是缓存目录。

它应该只承担一件事：

- 保存用户最终要拿走的交付物

在当前项目里，最主要的交付物就是：

- 最终视频 `.mp4`

后面如果要扩展，也应该是围绕交付展开，比如：

- 封面图
- 交付摘要
- 平台上传用清单

而不是把 prompt、分镜表、错误日志堆进去。

## 当前实际输出内容

当前已经按分层结构输出，典型内容是：

```text
output/
  项目名__projectId/
    第01集__episodeId/
      final-video.mp4
      delivery-summary.md
```

其中：

- `final-video.mp4`
  - 当前最终交付视频
- `delivery-summary.md`
  - 轻量交付摘要，记录项目、分集、风格和本次运行标识

项目模式和旧单文件兼容模式现在都统一到这套结构，不再分裂成“项目模式分层、兼容模式扁平文件名”两套口径。

## 一次运行什么时候算“成功交付”

对当前系统来说，至少要满足：

1. `VideoComposer` 完成
2. `output/` 下生成了 `.mp4`
3. 文件不是空文件
4. run package 里没有 `compose_video` 失败

所以不要只看终端里前面几步都成功。

比如你刚才那次就是：

- 角色档案成功
- Prompt 成功
- TTS 成功
- 但 FFmpeg 输出失败

这种情况就不能算交付成功，因为 `output/` 最终没有拿到可用成片。

## `output/` 不应该放什么

这些都不建议放到 `output/`：

- `shots.table.md`
- `prompts.json`
- `images.index.json`
- `consistency-report.json`
- `continuity-report.json`
- `audio.index.json`
- `ffmpeg-command.txt`
- `ffmpeg-stderr.txt`

原因很简单：

- 这些都是过程证据
- 它们对排障重要
- 但对交付对象不重要

所以它们应该始终留在 `temp/` 的 run package 里。

## 当前推荐结构

```text
output/
  项目名__projectId/
    第01集__episodeId/
      final-video.mp4
      delivery-summary.md
      poster-frame.jpg
```

这样好处是：

- 项目级交付物不混在一起
- 分集成片更容易定位
- 交付和审计边界更清晰

## 现在最常见的失败模式

### 1. `output/` 里根本没有视频

通常说明：

- 生图阶段全失败
- 或 FFmpeg 合成阶段失败

这时不要在 `output/` 里找原因，要回去看 `temp/`。

### 2. 文件名存在，但视频不可用

要检查：

- 文件大小是否异常小
- FFmpeg 是否中途退出
- `08-video-composer/3-errors/ffmpeg-stderr.txt`

### 3. 有视频，但内容不对

要回看：

- 分镜表
- prompts
- images.index
- consistency report

也就是说，交付内容错误通常不是 `output/` 本身的问题，而是上游内容链的问题。

## 对应你的排障习惯

建议这样判断：

### 先看 `output/`

如果有成片：

- 先确认能否播放
- 再决定要不要回看 `temp/`

如果没有成片：

- 不要继续盯 `output/`
- 直接去 `temp/.../08-video-composer/3-errors/`

## 交付成功后的最小检查清单

我建议每次至少确认这 4 件事：

1. `output/` 下有 `.mp4`
2. 文件大小正常，不是空文件
3. `runs/<runDir>/manifest.json` 显示整轮不是 failed
4. `08-video-composer/manifest.json` 不是 failed

## 与 `temp/` 的分工

可以记成一句话：

- `temp/` 回答“过程发生了什么”
- `output/` 回答“最后交付了什么”

如果把这两个目录混用，最终就会同时失去：

- 交付清晰度
- 排障效率

## 相关文档

- [temp/ 目录说明](temp-structure.md)
- [运行包目录示例](../agents/run-package-example.md)
