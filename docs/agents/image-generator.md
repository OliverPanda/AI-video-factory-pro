# 图像生成 Agent（Image Generator）

本文档基于 [src/agents/imageGenerator.js](/d:/My-Project/AI-video-factory-pro/src/agents/imageGenerator.js)，说明当前实现里图像生成 Agent 如何调图像平台、控制重试，并输出关键帧资产。

## 负责什么

1. 根据 Prompt 列表批量生成分镜图像。
2. 控制并发与重试，尽量把暂时性错误挡在图像层。
3. 把每张图包装成 `KeyframeAsset` 风格的结果对象，交给导演和合成阶段继续使用。
4. 记录 provider 配置、失败原因、重试历史等可审计证据。

## 入口函数

- `generateAllImages(promptList, imagesDir, options)`
- `regenerateImage(shotId, prompt, negativePrompt, imagesDir, options)`

## 输入

- `promptList`
  - 每项至少包含 `shotId`、`image_prompt`、`negative_prompt`
- `imagesDir`
  - 图片落盘目录
- `options`
  - 常见字段有 `style`、`taskType`、`artifactContext`
  - 可注入 `generateImage`

## 输出

`generateAllImages(...)` 返回数组，单项通常包含：

- `shotId`
- `keyframeAssetId`
- `imagePath`
- `success`
- `request`
- `error`

其中 `keyframeAssetId` 来自 `createKeyframeAsset(...)`。

## 关键流程

1. 用 `buildProviderConfigSnapshot(...)` 解析当前风格对应的任务类型、provider 和 model。
2. 把 prompt 列表变成任务列表：
   - `shotId`
   - `prompt`
   - `negativePrompt`
   - `outputPath`
3. 每个任务通过 `imageQueue + queueWithRetry(...)` 执行。
4. 成功时返回 ready keyframe result；失败时返回 failed keyframe result，但不会让整批 Promise 直接炸掉。

## 重生成

`regenerateImage(...)` 是给导演的一致性闭环用的：

- 输入单个镜头
- 重新生成同名图片文件
- 返回新的 keyframe result

它不负责“判断要不要重生成”，这部分属于 [consistency-checker.md](consistency-checker.md) 和 Director。

## 可审计成果物

传入 `artifactContext` 时，会落这些文件：

- `0-inputs/provider-config.json`
- `1-outputs/images.index.json`
- `2-metrics/image-metrics.json`
- `3-errors/retry-log.json`
- `3-errors/<shotId>-error.json`
- `manifest.json`

最有价值的是：

- `provider-config.json`
  - 记录这次到底用了哪条图像路由
- `images.index.json`
  - 每个镜头是成功还是失败，一眼可见
- `retry-log.json`
  - 能看出 403/429/503 前有没有重试
- `<shotId>-error.json`
  - 包含请求上下文和该镜头的 retry history

## 当前 metrics

- `request_count`
- `success_count`
- `failure_count`
- `success_rate`
- `retry_count`
- `http_403_count`
- `http_429_count`
- `http_503_count`

这对你排查“中转站分组不通”“某模型路由失效”“并发打爆上游”非常有帮助。

## 常见问题

### 为什么图像生成失败不会直接抛出并终止整批

因为当前设计偏向“尽量保住整批结果”。失败镜头会标 `success: false`，留给后续一致性检查、导演总结和人工排查。

### 为什么这里就开始产出资产 ID

因为从这一步开始，图片已经是 runtime object 了，不再只是临时字符串路径。后续动画片段、合成计划都会引用这些结果。

### 这个 Agent 会不会判断 prompt 对不对

不会。Prompt 质量是 [prompt-engineer.md](prompt-engineer.md) 的职责；图像生成只负责执行。

## 不负责的内容

- 不负责角色卡生成
- 不负责 prompt 设计
- 不负责一致性评分
- 不负责音频和视频合成

## 相关文档

- [视觉设计 Agent（Prompt Engineer）](prompt-engineer.md)
- [一致性验证 Agent（Consistency Checker）](consistency-checker.md)
- [合成 Agent（Video Composer）](video-composer.md)
