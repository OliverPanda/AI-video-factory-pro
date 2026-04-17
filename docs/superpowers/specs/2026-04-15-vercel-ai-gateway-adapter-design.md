# Vercel AI Gateway Adapter Design

## 背景

当前项目已经完成了“业务语义统一，provider 实现仍偏直连”的第一阶段重构：

- 视频业务语义层已经统一为：
  - `shot`
  - `sequence`
  - `bridge`
- 统一入口已经存在：
  - [unifiedVideoProviderClient.js](d:/My-Project/AI-video-factory-pro/src/apis/unifiedVideoProviderClient.js)
- 图像侧目前仍是“单 provider 路由 + 单实现”：
  - [imageApi.js](d:/My-Project/AI-video-factory-pro/src/apis/imageApi.js)
- Seedance 视频侧当前仍是“业务协议 + provider HTTP 细节”耦合在一起：
  - [seedanceVideoApi.js](d:/My-Project/AI-video-factory-pro/src/apis/seedanceVideoApi.js)

这意味着：

1. 业务层已经知道“要生成什么”
2. 但底层仍然强绑定“怎么向某家 provider 发请求”

而当前项目的真实使用场景并不是长期只锁定一个模型，而是：

- 会频繁切换不同生图模型看效果
- 会频繁切换不同生视频模型看效果
- 希望保留 `shot / sequence / bridge` 这套业务语义
- 不希望每换一个模型就改一轮业务层代码

基于这一点，本项目更适合引入“统一媒体网关适配层”，而不是继续把每个模型都直接接到业务层里。

## 为什么选择 Vercel AI Gateway

在当前阶段，Vercel AI Gateway 比 Portkey 更适合本项目，原因是：

1. 它更像“统一模型调用层”
2. 已明确支持图像与视频能力
3. 更适合“频繁切模型看效果”的实验型工作流
4. 更适合放在本仓库现有 `unified provider client` 下面做 transport 层
5. 当前项目暂时不需要 Portkey 更重的治理能力，例如：
   - 团队级权限控制
   - 多租户预算控制
   - 复杂路由控制台
   - 组织级审计策略

因此，本设计选择：

- 当前推荐主方案：`Vercel AI Gateway`
- 当前定位：底层媒体 transport 适配层
- 不改变上层业务语义与 QA 体系

## 设计目标

本次设计目标不是“替换整个业务架构”，而是把现有结构升级为：

```text
Director / Router / QA
    ↓
业务语义层
shot / sequence / bridge / image
    ↓
项目适配层
unifiedVideoProviderClient
imageProviderClient
    ↓
Gateway Transport 层
vercelAiGatewayVideoTransport
vercelAiGatewayImageTransport
    ↓
具体模型
Seedance / Kling / Veo / GPT-Image / Flux / ...
```

本次设计要满足：

1. 不破坏 `Director` 主流程
2. 不破坏 `shot / sequence / bridge` 三种视频语义
3. 不破坏已有 artifact、QA、resume 规则
4. 不要求一次性删除现有 `seedanceVideoApi` / `image provider`
5. 支持通过环境变量切换不同模型
6. 支持未来继续保留“同一个中转站 / relay”的口径

## 非目标

本次设计不做下面这些事：

1. 不直接接入全部 Vercel 模型
2. 不立即删除现有 `fallbackVideoApi`
3. 不在本次设计中重写所有测试
4. 不在本次设计中修改 `Director` 的业务编排顺序
5. 不引入新的计费策略或自动生视频流程

特别说明：

- 本项目仍然遵守当前用户约束：
  - 不得在未确认的情况下触发真实生视频调用

## 当前问题拆解

### 1. 视频侧问题

当前 [seedanceVideoApi.js](d:/My-Project/AI-video-factory-pro/src/apis/seedanceVideoApi.js) 同时承担了三类职责：

1. 业务协议转模型请求
2. provider 请求发起与轮询
3. provider 错误归一化

这会导致：

- 如果从 Seedance 切到别的视频模型
- 或者切到 Vercel AI Gateway 的统一入口

就很容易把“提示词结构”和“HTTP 调用协议”绑死在一起。

### 2. 图像侧问题

当前 [imageApi.js](d:/My-Project/AI-video-factory-pro/src/apis/imageApi.js) 本质上还是：

- 任务类型路由
- 固定 provider 实现

这不利于后续统一：

- GPT-Image
- Flux
- 其他图像模型

### 3. 业务层已经足够稳定

反过来看，业务层已经比较适合继续保留：

- `videoPackage.packageType`
- `shotId / sequenceId / bridgeId`
- `providerRequestHints`
- `referenceImages / referenceVideos`
- `seedancePromptBlocks`

因此本次设计不应该从业务层往上动，而应该在“业务层以下”加一层 transport 抽象。

## 核心设计

## 一、分层原则

后续媒体生成模块拆成 3 层：

### 第 1 层：业务语义层

负责定义“要生成什么”，不关心具体调用哪家模型。

视频：

- `shot`
- `sequence`
- `bridge`

图像：

- `realistic_image`
- `threed_image`
- `image_edit`

这一层继续保留当前已有 package 协议。

### 第 2 层：项目适配层

负责把业务语义映射成统一媒体请求。

建议保留 / 新增：

- [unifiedVideoProviderClient.js](d:/My-Project/AI-video-factory-pro/src/apis/unifiedVideoProviderClient.js)
- `src/apis/unifiedImageProviderClient.js`

这层职责是：

1. 根据 `packageType` 选择 video transport 调用方式
2. 根据 `taskType` 选择 image transport 调用方式
3. 维持当前项目内部的结果协议不变

### 第 3 层：Gateway Transport 层

负责与 Vercel AI Gateway 通信。

建议新增：

- `src/apis/transports/vercelAiGatewayVideoTransport.js`
- `src/apis/transports/vercelAiGatewayImageTransport.js`

这层职责是：

1. 构造 Vercel 侧请求
2. 处理异步任务轮询 / 下载
3. 归一化错误
4. 归一化返回结果

## 二、建议新增模块

## 1. `src/apis/transports/vercelAiGatewayVideoTransport.js`

### 职责

负责统一视频生成 transport，支持：

- `shot`
- `sequence`
- `bridge`

### 输入

仍然消费项目内部 `videoPackage`

### 输出

统一返回与现有 `normalizeVideoProviderResult` 兼容的数据结构：

```js
{
  provider: 'vercel_ai_gateway',
  model: 'bytedance/seedance-v1.5-pro',
  shotId: 'shot_001',
  videoPath: '...',
  outputUrl: '...',
  taskId: '...',
  providerRequest: { ... },
  providerMetadata: { ... }
}
```

### 关键点

这层只关心：

- 模型 ID
- 输入模态
- 轮询
- 下载

不关心：

- 这个请求是 `bridge` 还是 `sequence` 的叙事价值

那部分仍属于上层业务语义。

## 2. `src/apis/transports/vercelAiGatewayImageTransport.js`

### 职责

负责统一图像生成 transport，支持：

- 写实生图
- 3D 生图
- 图像编辑

### 输入

统一输入结构建议为：

```js
{
  taskType: 'realistic_image',
  prompt: '...',
  negativePrompt: '...',
  outputPath: '...',
  model: '...',
  size: '...',
  references: []
}
```

### 输出

仍返回当前项目已经习惯的图像输出路径与必要 metadata。

## 3. `src/apis/unifiedImageProviderClient.js`

### 职责

对标当前 [unifiedVideoProviderClient.js](d:/My-Project/AI-video-factory-pro/src/apis/unifiedVideoProviderClient.js)，图像侧也补一个统一适配入口。

### 作用

将来 `imageApi.js` 不直接连某个 provider，而是：

```text
generateImage
-> unifiedImageProviderClient
-> transport
-> Vercel AI Gateway
```

## 三、现有模块如何改

## 1. `unifiedVideoProviderClient.js`

当前这个模块已经很接近目标形态，建议不要推翻。

### 当前问题

它现在仍然把 provider 分成：

- `seedance`
- `sora2`

而且默认 handler 仍直接调用：

- `createSeedanceVideoClip`
- `createSeedanceBridgeClip`
- `createSeedanceMultiShotClip`
- `createFallbackVideoClip`

### 建议改法

把“默认 handler”从“具体 provider API”改成“可配置 transport”：

```text
seedanceHandlers -> vercel gateway handlers
fallbackHandlers -> legacy fallback handlers
```

或者进一步抽成：

```text
primaryHandlers
legacyHandlers
```

### 推荐方向

最终 `normalizeProvider()` 里推荐新增：

- `vercel_ai_gateway`

同时保留：

- `seedance`
- `fallback_video`

但要明确：

- `seedance` 可以只是“模型意图”
- `vercel_ai_gateway` 才是“transport 提交通道”

也就是说，以后可以出现：

```text
preferredProvider = seedance
transportProvider = vercel_ai_gateway
model = bytedance/seedance-v1.5-pro
```

这比把 `seedance` 同时当“模型名 + 传输通道名”更干净。

## 2. `seedanceVideoApi.js`

### 当前定位

它目前同时做：

- Seedance prompt 组装
- Seedance provider 请求

### 建议新定位

后续拆成两部分：

1. 保留“Prompt / request body 组装能力”
2. 把“HTTP 请求、轮询、下载”迁到 transport 层

### 推荐拆分结果

- `seedanceVideoApi.js`
  - 只保留：
    - `buildSeedanceVideoRequest`
    - `buildSeedanceBridgeRequest`
    - `buildSeedanceMultiShotRequest`
    - `classifySeedanceError` 中与业务语义相关的部分
- `vercelAiGatewayVideoTransport.js`
  - 新负责：
    - submit
    - poll
    - download

这样可以做到：

- prompt 仍然按 Seedance 官方指南组织
- transport 改成走 Vercel

## 3. `imageApi.js`

### 当前问题

它目前的 `resolveImageProvider()` 仍然固定返回：

- `laozhangImageProvider`

### 建议改法

替换成：

```text
resolveImageTransport()
```

支持：

- `openai_compat`
- `vercel_ai_gateway`
- 未来其他 transport

### 推荐保留

`resolveImageRoute(taskType)` 仍可保留，因为：

- 它负责“任务类型 -> 模型名”
- 这与 transport 层并不冲突

## 四、模型路由设计

## 1. 新的环境变量建议

建议新增：

```bash
MEDIA_GATEWAY_PROVIDER=vercel_ai_gateway
VERCEL_AI_GATEWAY_API_KEY=
VERCEL_AI_GATEWAY_BASE_URL=
```

视频模型分开配置：

```bash
VIDEO_TRANSPORT_PROVIDER=vercel_ai_gateway
VIDEO_MODEL_SHOT=bytedance/seedance-v1.5-pro
VIDEO_MODEL_SEQUENCE=bytedance/seedance-v1.5-pro
VIDEO_MODEL_BRIDGE=bytedance/seedance-v1.5-pro
```

图像模型分开配置：

```bash
IMAGE_TRANSPORT_PROVIDER=vercel_ai_gateway
IMAGE_MODEL_REALISTIC=openai/gpt-image-1
IMAGE_MODEL_3D=black-forest-labs/flux-1.1-pro
IMAGE_MODEL_EDIT=openai/gpt-image-1
```

### 设计原则

要把下面 3 个概念分开：

1. 业务语义
   - `shot / sequence / bridge`
2. transport 通道
   - `vercel_ai_gateway`
3. 最终模型
   - `bytedance/seedance-v1.5-pro`

## 2. 为什么不要再用一个字段混三层含义

当前项目里 `VIDEO_PROVIDER=seedance` 很容易同时被理解成：

1. 主 provider
2. 模型
3. 通道

这对未来多模型切换不利。

因此推荐未来逐步转成：

```bash
VIDEO_TRANSPORT_PROVIDER=vercel_ai_gateway
VIDEO_MODEL_SHOT=bytedance/seedance-v1.5-pro
```

而不是继续只用：

```bash
VIDEO_PROVIDER=seedance
```

## 五、请求映射策略

## 1. shot

`shot` 请求仍然保留当前：

- `seedancePromptBlocks`
- `referenceImages`
- `cameraSpec`
- `durationTargetSec`

然后由 transport 层映射为 Vercel 视频请求。

## 2. sequence

`sequence` 继续保留：

- `referenceImages`
- `referenceVideos`
- `entryFrameHint`
- `exitFrameHint`
- `continuitySpec`

这样才能保留当前“连续动作段”的业务价值。

## 3. bridge

`bridge` 继续保留：

- `fromReferenceImage`
- `toReferenceImage`
- `promptDirectives`
- `negativePromptDirectives`

也就是说：

- transport 只换通道
- `bridge` 语义不消失

## 六、错误与 QA

## 1. 错误分类不变

无论是否改走 Vercel，项目内部推荐继续保留当前错误分类口径：

- `provider_auth_error`
- `provider_invalid_request`
- `provider_rate_limit`
- `provider_timeout`
- `provider_generation_failed`

因为：

- QA 层看的是稳定分类
- 不应该被 transport 替换影响

## 2. QA 逻辑不应感知 Vercel

`Shot QA / Bridge QA / Sequence QA` 应继续只关心：

- 成功与否
- 输出路径
- 实际时长
- 质量状态

而不是关心：

- 是不是走了 Vercel
- 上游 provider 到底是哪家

这意味着 transport 升级不应影响 QA 规则。

## 七、落地迁移顺序

建议按下面顺序实施。

## Step 1：先加 transport，不切默认流量

新增：

- `src/apis/transports/vercelAiGatewayVideoTransport.js`
- `src/apis/transports/vercelAiGatewayImageTransport.js`

这一阶段：

- 只新增代码
- 不切主链默认
- 不改现有行为

## Step 2：视频侧接入 unified transport

修改：

- [unifiedVideoProviderClient.js](d:/My-Project/AI-video-factory-pro/src/apis/unifiedVideoProviderClient.js)

目标：

- 允许通过 env 切到 `vercel_ai_gateway`
- 默认仍可保留当前直连行为

## Step 3：图像侧补统一 client

新增：

- `src/apis/unifiedImageProviderClient.js`

修改：

- [imageApi.js](d:/My-Project/AI-video-factory-pro/src/apis/imageApi.js)

目标：

- 图像也进入统一 transport 架构

## Step 4：拆分 `seedanceVideoApi.js`

目标：

- 把 transport 细节剥离出去
- 保留 prompt 结构与 request mapping

## Step 5：补测试

至少补下面几类测试：

1. transport request mapping
2. transport error normalization
3. unified client 路由
4. env 切模型
5. 不同 packageType 下的模型映射

## 八、推荐测试清单

建议新增测试：

- `tests/vercelAiGatewayVideoTransport.test.js`
- `tests/vercelAiGatewayImageTransport.test.js`
- `tests/unifiedImageProviderClient.test.js`

建议修改测试：

- [tests/videoRouter.test.js](d:/My-Project/AI-video-factory-pro/tests/videoRouter.test.js)
- [tests/seedanceVideoApi.test.js](d:/My-Project/AI-video-factory-pro/tests/seedanceVideoApi.test.js)
- [tests/actionSequenceRouter.test.js](d:/My-Project/AI-video-factory-pro/tests/actionSequenceRouter.test.js)
- [tests/bridgeClipGenerator.test.js](d:/My-Project/AI-video-factory-pro/tests/bridgeClipGenerator.test.js)

## 九、推荐给 Agent 的实现原则

后续 agent 按本方案实现时，优先遵守下面这些原则：

1. 不能把 `shot / sequence / bridge` 合并成一个扁平 video 请求对象
2. 不能把 prompt 结构逻辑塞回 transport 层
3. 不能让 QA 层依赖 Vercel 特有字段
4. 不能让模型名和 transport 名重新耦合
5. 不能在未确认情况下触发真实视频生成调用

## 十、最终建议

对当前项目而言，Vercel AI Gateway 的正确使用方式不是：

- “把整个项目重写成 Vercel SDK 直驱”

而是：

- “把它作为你现有统一媒体客户端下的一层 transport”

这能最大程度保留当前仓库已经沉淀下来的价值：

- Director 编排
- run package
- QA 体系
- resume 体系
- Seedance prompt 架构
- shot / sequence / bridge 业务语义

同时给你未来最重要的能力：

- 更轻松地切换不同生图模型
- 更轻松地切换不同生视频模型
- 不必每次切模型都改业务层代码

## 下一步建议

如果按本设计继续推进，建议下一份实施计划聚焦为：

1. 先做 `vercelAiGatewayVideoTransport`
2. 再改 `unifiedVideoProviderClient`
3. 再补 `unifiedImageProviderClient`
4. 最后再做图像 transport 接入

推荐计划文件名：

- `docs/superpowers/plans/2026-04-15-vercel-ai-gateway-adapter-implementation.md`
