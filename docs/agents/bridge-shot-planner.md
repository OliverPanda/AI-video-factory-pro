# Bridge Shot Planner Agent

`Bridge Shot Planner` 只负责一件事：从 `continuityFlaggedTransitions` 里挑出真正需要桥接的高风险 cut 点，并输出 `bridgeShotPlan`。

当前 MVP 是规则版，不做 provider 调用，也不做 QA。最少覆盖四类桥接：

- `motion_carry`
- `camera_reframe`
- `spatial_transition`
- `emotional_transition`

核心产物：

- `09g-bridge-shot-planner/1-outputs/bridge-shot-plan.json`
- `09g-bridge-shot-planner/2-metrics/bridge-shot-plan-metrics.json`

边界：

- 不给所有 cut 默认插桥
- 不负责 provider 路由
- 不负责生成 bridge clip
- 不负责决定是否写入最终时间线
