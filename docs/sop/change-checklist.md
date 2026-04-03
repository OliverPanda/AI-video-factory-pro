# 变更检查清单

这份清单用于“改了某个 agent 或其上下游后，提交前至少要确认什么”。

## 改动前

开始修改前先确认：

- 这次变更主要落在哪个 agent
- 它的上游输入是谁
- 它的下游消费者是谁
- 它会不会影响现有 artifact 文件名、结构或字段

如果还不确定，先看：

- [docs/agents/agent-io-map.md](/d:/My-Project/AI-video-factory-pro/docs/agents/agent-io-map.md)
- [docs/agents/README.md](/d:/My-Project/AI-video-factory-pro/docs/agents/README.md)

## 改动后必须检查

至少检查这 5 项：

1. 入口函数签名有没有变化
2. 下游消费方会不会被字段变化打断
3. 该 agent 的 artifact 文件是否仍存在且路径稳定
4. 指标或错误证据是否仍可读
5. 对应文档是否需要同步

## 文档同步规则

涉及以下变化时，必须同步文档：

- 职责边界变化
  更新对应 `docs/agents/*.md`
- 运行步骤、重跑策略、排障顺序变化
  更新 [runbook.md](runbook.md)
- 验收门槛变化
  更新 [qa-acceptance.md](qa-acceptance.md) 或 [agent-matrix.md](agent-matrix.md)
- CLI 用法、环境变量、输出路径变化
  更新 [README.md](/d:/My-Project/AI-video-factory-pro/README.md)

## 测试最小要求

提交前至少满足：

- 跑过该 agent 对应的 focused tests
- 如果改到 `director`、artifact contract、主流程编排，再补至少一条 acceptance 或 project-run 测试
- 如果改到输出路径、交付行为或 FFmpeg 逻辑，再补 `video composer` 相关测试

推荐映射见 [agent-matrix.md](agent-matrix.md)。

## 常见高风险改动

下面这些改动不要只跑单测：

- `director` 编排顺序变化
- 缓存字段变化
- artifact 目录结构变化
- `skipConsistencyCheck` 或 continuity 修复逻辑变化
- voice preset 解析优先级变化
- FFmpeg 合成计划变化

## 提交前自查

提交前快速过一遍：

- 代码是否和当前文档一致
- 产物路径是否还是旧约定
- 错误文件是否仍能留下原始证据
- README 入口有没有被改漏
- 是否需要把新的验证步骤补进 SOP
