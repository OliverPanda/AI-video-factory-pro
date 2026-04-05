# Action Sequence Router

## 职责

- 把 `actionSequencePlan` 组装成 `actionSequencePackages`
- 按 `videoResults > bridgeClipResults > imageResults` 选择参考素材层级
- 缺少关键参考时直接 `skip`，不发无意义请求

## 典型输入

- `actionSequencePlan`
- `imageResults`
- `videoResults`
- `bridgeClipResults`
- `performancePlan`

## 典型输出

- `referenceImages`
- `referenceVideos`
- `bridgeReferences`
- `preferredProvider`
- `fallbackProviders`
- `qaRules`

## 落盘

- `09l-action-sequence-router/1-outputs/action-sequence-packages.json`
- `09l-action-sequence-router/2-metrics/action-sequence-routing-metrics.json`

## 当前 MVP 边界

- 只做最小路由层
- 默认主 provider 跟随现有视频主链，当前默认是 `Seedance`
- 显式指定 `Runway` 时保留兼容，不会被路由层强改
- 不做复杂成本路由
