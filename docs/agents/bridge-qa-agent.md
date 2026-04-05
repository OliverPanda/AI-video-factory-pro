# Bridge QA Agent

`Bridge QA Agent` 负责对 bridge clip 做最小工程验收和连续性验收。

当前固定输出四档决策：

- `pass`
- `fallback_to_direct_cut`
- `fallback_to_transition_stub`
- `manual_review`

工程验收至少检查：

- 文件存在
- `ffprobe` 可读
- 时长在可接受范围内

连续性验收当前最少记录：

- `continuityStatus`
- `transitionSmoothness`
- `identityDriftRisk`
- `cameraAxisStatus`

核心产物：

- `09j-bridge-qa/1-outputs/bridge-qa-report.json`
- `09j-bridge-qa/2-metrics/bridge-qa-metrics.json`

边界：

- 不负责重新生成 bridge clip
- 不负责改写主镜头链
- 只有 `finalDecision === "pass"` 的 bridge clip 才能进入 compose timeline
