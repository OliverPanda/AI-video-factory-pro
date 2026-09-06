# 迁移计划：视频/图像生成迁移到 Vercel AI SDK

> 目标：用 AI SDK 的 `experimental_generateVideo` 和 `experimental_generateImage` 替换自定义 adapter/transport 层，实现零代码切换 provider。

## 1. 当前架构 vs 目标架构

### 当前架构（6 层）

```
Director
  → VideoRouter（构建 shotPackages）
  → VideoGenerationAgent
    → UnifiedVideoProviderClient
      → VideoRequestRouter（路由表：provider::transport → adapter + transport）
      → VideoAdapters（构建请求 payload）
      │   ├── seedanceAdapter
      │   ├── veoAdapter
      │   ├── soraAdapter
      │   └── happyHorseAdapter
      → VideoTransports（submit/poll/download）
          ├── OfficialSeedanceTransport
          ├── RelayOpenAiVideoTransport
          ├── RelaySeedanceV2VideoTransport
          ├── RelayMediaTaskTransport
          ├── DashScopeAsyncVideoTransport
          └── GatewayVideoTransport
```

**问题**：每新增一个 provider 需要写 adapter + transport，两个文件 ~200 行。

### 目标架构（3 层）

```
Director
  → VideoRouter（构建 shotPackages，不变）
  → VideoGenerationAgent
    → AI SDK generateVideo（统一接口）
      → FAL / Google / Kling / Replicate / xAI（provider 包）
```

**效果**：新增 provider 只需安装包 + 改 `.env`，零代码。

## 2. 功能映射表

| 当前功能 | AI SDK 对应 | 备注 |
|----------|-------------|------|
| 文生视频 | `prompt: '...'` | ✅ 直接对应 |
| 图生视频 | `prompt: { image, text }` | ✅ 直接对应 |
| 首末帧 | `frameImages: [{ image, frameType }]` | ✅ 直接对应 |
| 参考图 | `inputReferences: [...]` | ✅ 直接对应 |
| 时长控制 | `duration: 5` | ⚠️ 部分模型支持 |
| 分辨率 | `resolution: '1280x720'` | ⚠️ 部分模型支持 |
| 宽高比 | `aspectRatio: '16:9'` | ✅ 直接对应 |
| Seed | `seed: 1234567890` | ⚠️ 部分模型支持 |
| 多视频 | `n: 3` | ✅ SDK 自动批处理 |
| Provider 特有参数 | `providerOptions: { fal: {...} }` | ✅ 直接对应 |
| 轮询控制 | `poll: { intervalMs, timeoutMs }` | ✅ 内置 |
| Webhook | `webhook: async () => {...}` | ✅ 内置 |
| 超时中止 | `abortSignal: AbortSignal.timeout(60000)` | ✅ 直接对应 |

**不支持的功能（需保留自定义逻辑）**：

| 功能 | 原因 | 处理方案 |
|------|------|----------|
| dashscope_async 传输 | AI SDK 无 DashScope provider | 保留 happyHorse adapter 作为 fallback |
| relay_openai 格式 | AI SDK 有自己的 OpenAI video 实现 | 用 AI SDK 的 OpenAI provider |
| relay_seedance_v2 格式 | 非标准 API | 保留 adapter |
| relay_media_task 格式 | 非标准 API | 保留 adapter |
| 复合剪辑（bridge/sequence） | 需要多视频拼接 | 保留 `videoComposer.js` |

## 3. 迁移范围

### Phase 1：核心替换（高优先级）

| 文件 | 操作 | 行数变化 |
|------|------|----------|
| `src/apis/videoTransports.js` | 删除 4 个 transport factory | -600 行 |
| `src/apis/videoAdapters.js` | 删除 3 个 adapter（保留 happyHorse） | -200 行 |
| `src/apis/videoRequestRouter.js` | 简化路由逻辑 | -50 行 |
| `src/apis/unifiedVideoProviderClient.js` | 重写为 AI SDK wrapper | -200 行 → +80 行 |
| `src/agents/videoGenerationAgent.js` | 适配新 client | 小改 |
| 新建 `src/apis/aiSdkVideoClient.js` | AI SDK 视频生成封装 | +100 行 |

### Phase 2：图像生成替换（中优先级）

| 文件 | 操作 | 行数变化 |
|------|------|----------|
| `src/apis/imageProviders.js` | 保留 provider 定义，替换调用方式 | 小改 |
| `src/apis/imageGenerationClient.js` | 适配 AI SDK `generateImage` | 小改 |
| `src/apis/falAiClient.js` | 可能删除（用 AI SDK FAL provider 替代） | -150 行 |

### Phase 3：清理（低优先级）

| 文件 | 操作 | 行数变化 |
|------|------|----------|
| `src/apis/videoTransports.js` | 完全删除 | -650 行 |
| `src/apis/seedanceVideoApi.js` | 保留（bridge/sequence 仍需要） | 不变 |
| `src/apis/fallbackVideoApi.js` | 保留（fallback 仍需要） | 不变 |

## 4. 新建文件

### `src/apis/aiSdkVideoClient.js`

```javascript
/**
 * AI SDK 视频生成统一客户端
 * 替代 custom adapter + transport 层
 */
import { experimental_generateVideo as generateVideo } from 'ai';

/**
 * 生成视频（统一接口）
 * @param {Object} options
 * @param {string} options.model - 模型标识，如 'fal/minimax-video'
 * @param {string} options.prompt - 文本 prompt
 * @param {string} [options.imageUrl] - 参考图 URL（图生视频）
 * @param {string} [options.aspectRatio] - 宽高比 '16:9'
 * @param {number} [options.duration] - 时长（秒）
 * @param {number} [options.seed] - 随机种子
 * @param {AbortSignal} [options.abortSignal] - 中止信号
 * @returns {Promise<{ videoPath: string, providerMetadata: object }>}
 */
export async function generateVideoClip(options) {
  const {
    model,
    prompt,
    imageUrl,
    aspectRatio = '16:9',
    duration,
    seed,
    abortSignal,
  } = options;

  const promptConfig = imageUrl
    ? { image: imageUrl, text: prompt }
    : prompt;

  const result = await generateVideo({
    model,
    prompt: promptConfig,
    aspectRatio,
    ...(duration && { duration }),
    ...(seed && { seed }),
    ...(abortSignal && { abortSignal }),
    poll: {
      intervalMs: 5000,
      timeoutMs: 600000, // 10 分钟
    },
  });

  return {
    videoPath: result.video.uint8Array, // 需要写入文件
    providerMetadata: result.providerMetadata,
  };
}
```

### `src/apis/aiSdkImageClient.js`

```javascript
/**
 * AI SDK 图像生成统一客户端
 */
import { experimental_generateImage as generateImage } from 'ai';

export async function generateImageClip(options) {
  const { model, prompt, size = '1024x1024', seed } = options;

  const result = await generateImage({
    model,
    prompt,
    size,
    ...(seed && { seed }),
  });

  return {
    imagePath: result.image.uint8Array,
    providerMetadata: result.providerMetadata,
  };
}
```

## 5. 环境变量变更

### 新增

```env
# AI SDK 视频模型（统一接口）
# 可选值：
#   fal/minimax-video          — FAL 上的 MiniMax
#   fal/luma-dream-machine/ray-2 — Luma Ray 2
#   google/veo-3.1-generate-001 — Google Veo 3.1
#   klingai/kling-v2.6-t2v     — Kling v2.6 文生视频
#   klingai/kling-v2.6-i2v     — Kling v2.6 图生视频
#   replicate/minimax/video-01 — Replicate 上的 MiniMax
#   xai/grok-imagine-video     — xAI Grok Video
VIDEO_MODEL=fal/minimax-video

# AI SDK 图像模型（统一接口）
IMAGE_MODEL=openai/dall-e-3
```

### 保留（向后兼容）

```env
# 保留旧变量作为 fallback
VIDEO_PROVIDER=seedance        # 旧变量，优先级低于 VIDEO_MODEL
VIDEO_TRANSPORT_PROVIDER=relay_openai
```

### 删除（Phase 3）

```env
# 这些变量在 Phase 1 后不再需要
# VIDEO_MODEL_SHOT=...
# VIDEO_MODEL_BRIDGE=...
# VIDEO_MODEL_MULTI_SHOT=...
```

## 6. 实现步骤

### Step 1：安装依赖

```bash
npm install ai @ai-sdk/fal @ai-sdk/google @ai-sdk/openai
# 如果需要 Kling：
npm install @ai-sdk/klingai
# 如果需要 Replicate：
npm install @ai-sdk/replicate
# 如果需要 xAI：
npm install @ai-sdk/xai
```

### Step 2：新建 AI SDK 客户端

创建 `src/apis/aiSdkVideoClient.js` 和 `src/apis/aiSdkImageClient.js`。

### Step 3：适配 UnifiedVideoProviderClient

修改 `src/apis/unifiedVideoProviderClient.js`：

```javascript
// 旧代码
const adapter = router.resolve(request);
const requestBody = adapter.buildProviderRequest(request);
const submitResult = await transport.submit(requestBody, context);

// 新代码
import { generateVideoClip } from './aiSdkVideoClient.js';

const result = await generateVideoClip({
  model: resolveAiSdkModel(request.provider, request.model),
  prompt: request.prompt,
  imageUrl: request.referenceImages?.[0]?.path,
  aspectRatio: request.aspectRatio || '16:9',
  duration: request.targetDurationSec,
});
```

### Step 4：适配 VideoGenerationAgent

修改 `src/agents/videoGenerationAgent.js`：

```javascript
// 旧代码
const providerClient = createUnifiedVideoProviderClient();
const result = await providerClient.submit(videoPackage, outputPath);

// 新代码（保持接口不变，内部实现切换到 AI SDK）
const providerClient = createUnifiedVideoProviderClient({ useAiSdk: true });
const result = await providerClient.submit(videoPackage, outputPath);
```

### Step 5：保留 fallback 路径

对于 AI SDK 不支持的 provider（如 dashscope_async），保留旧的 adapter + transport 作为 fallback。

### Step 6：测试

```bash
# 单元测试
node --test tests/aiSdkVideoClient.test.js

# 集成测试
node --test tests/videoGenerationAgent.aiSdk.test.js

# 端到端测试
node scripts/run.js --project=project-example --script=pilot --episode=episode-1 --style=realistic --max-shots=1
```

## 7. 切换 Provider 示例

### 迁移后

```bash
# 切换到 FAL MiniMax
VIDEO_MODEL=fal/minimax-video

# 切换到 Google Veo
VIDEO_MODEL=google/veo-3.1-generate-001

# 切换到 Kling
VIDEO_MODEL=klingai/kling-v2.6-t2v

# 切换到 xAI
VIDEO_MODEL=xai/grok-imagine-video

# 只改这一行，零代码改动
```

## 8. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| AI SDK video 还是 experimental API | 中 | 保留旧 adapter 作为 fallback |
| 部分 provider 不支持某些参数 | 低 | 用 providerOptions 传递 |
| 轮询行为差异 | 低 | AI SDK 内置轮询，可配置 |
| 文件写入方式不同 | 低 | AI SDK 返回 Uint8Array，手动写文件 |
| 成本追踪 | 中 | 用 providerMetadata 获取 token 用量 |
| dashscope_async 不支持 | 高 | 保留 happyHorse adapter |

## 9. 总结

| 指标 | 迁移前 | 迁移后 |
|------|--------|--------|
| 新增 provider 工作量 | ~200 行（adapter + transport） | 0 行（改 .env） |
| 代码行数 | ~850 行（transport + adapter） | ~100 行（AI SDK wrapper） |
| 维护成本 | 高（每个 API 格式变化需改 adapter） | 低（AI SDK 维护 provider） |
| 支持的 provider | 4 个（需手动适配） | 8+ 个（开箱即用） |
| 向后兼容 | - | 保留旧 adapter 作为 fallback |
