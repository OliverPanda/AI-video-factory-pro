# Bridge Clip Generator Agent

`Bridge Clip Generator` 负责把 `bridgeShotPackages` 变成 `bridgeClipResults`。

当前实现策略：

- 普通桥接档：可走 `image_to_video`
- 强约束桥接档：会先检查 capability
- capability 不满足时：返回可解释失败，不假成功
- `fallback_direct_cut`：直接跳过，不发 provider 请求

核心产物：

- `09i-bridge-clip-generator/1-outputs/bridge-clip-results.json`
- `09i-bridge-clip-generator/2-metrics/bridge-clip-generation-report.json`

边界：

- 不负责 bridge QA
- 不负责时间线插入
- 不负责决定 direct cut / transition stub / manual review
