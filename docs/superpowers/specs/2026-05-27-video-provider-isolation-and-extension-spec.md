# Video Provider Isolation and Extension Spec

**Goal:** 视频 provider 选择必须贯穿 shot、bridge、sequence、QA、composer 全链路。用户配置 `VIDEO_PROVIDER=seedance` 时，所有可生成的视频请求都必须保持 `seedance`；配置 `VIDEO_PROVIDER=happyhorse` 或未来新模型时同理。系统可以失败、跳过非视频 direct-cut/static 场景，但不能自动降级到另一个视频模型。

## Provider Isolation Contract

1. `preferredProvider` 是运行级视频模型意图，默认来自 `VIDEO_PROVIDER`。
2. `fallbackProviders` 不得包含另一个视频 provider。历史字段可以保留为空数组用于兼容。
3. 缺失输入资产时允许标记为 `static_image`、`skip` 或 `fallback_direct_cut`，但这些不是视频 provider，不能掩盖主 provider 失败。
4. Provider 失败必须返回 `failed` 和标准 `failureCategory`，由 QA / Director 决定是否阻断交付。
5. Director 不允许为某个 provider 增加专属分支。除历史 Seedance/Sora2 专用 runner 外，新 provider 必须走 `runVideoGeneration` / unified provider client。
6. 具体 provider 名称不得被 alias 到另一个模型。历史具体 provider 名称不得被 alias 到另一个模型；只有 `fallback_video` 这种历史抽象别名可以映射到兼容实现。

## Full-Chain Requirements

- Video Router: shot package 使用当前主 provider，`fallbackProviders=[]`，`canFallbackToStaticImage=false`。
- Bridge Planner / Router: bridge package 使用当前主 provider，`fallbackProviders=[]`，`canFallbackToOtherVideoProvider=false`。
- Bridge Clip Generator: 任意 provider 走 unified provider client；`fallback_direct_cut` 仅表示非视频剪辑跳过。
- Action Sequence Router: sequence package 使用当前主 provider，`fallbackProviders=[]`，QA rules 包含 `do_not_fallback_to_other_video_provider`。
- Sequence Clip Generator: 任意 provider 走 unified provider client；没有 provider-specific workflow 时不能跳过新模型。

## Adding a New Video Provider

新增 provider 只允许按以下步骤接入：

1. 在 `videoGenerationContract` 中确认 provider 名称可规范化。
2. 在 `videoGenerationConfig` 中配置 provider-aware model、transport、base URL、API key 和 provider params。
3. 在 `videoAdapters` 中增加 request adapter，把统一 video package 转成 provider 请求体。
4. 在 `videoTransports` 中增加或复用 transport，实现 submit / poll / download。
5. 在 `videoRequestRouter` 中注册 provider 到 adapter / transport。
6. 增加 provider contract test，覆盖 config、adapter、transport、unified client。
7. 增加或更新 harness test，证明该 provider 能跨 shot / bridge / sequence 保持同名 provider，不产生其他视频模型 fallback。

## Forbidden Patterns

- 在 `Director` 里为新 provider 增加 `if (provider === 'xxx') runXxxVideo()` 分支。
- 在 planner/router 中把 `seedance` 自动改成 `sora2`，或把任意新 provider 自动改成历史 fallback provider。
- 在 generator 中因为 provider 不在白名单就 `skipped`。
- 在 `fallbackProviders` 中写入另一个视频模型名称。
- 用 `fallback_video` 作为新 provider 接入方式；它只是历史兼容别名。

## Harness Gates

每次修改视频 provider 层，至少运行：

```powershell
node --test tests\videoProviderHarness.test.js
node --test tests\videoRouter.test.js tests\bridgeShotRouter.test.js tests\bridgeClipGenerator.test.js
node --test tests\actionSequenceRouter.test.js tests\sequenceClipGenerator.test.js
```

`tests/videoProviderHarness.test.js` 是架构护栏：它必须证明任意配置 provider 在 shot、bridge、sequence package 中保持隔离，并能通过 unified client 执行 bridge / sequence。


