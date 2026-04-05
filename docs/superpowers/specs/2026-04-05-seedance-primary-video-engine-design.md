# 2026-04-05 Seedance 主视频引擎替换设计

## 1. 目标

本次设计解决的问题不是“再加一条新视频子链”，而是：

- 在不破坏当前 `Director` 单一 orchestrator、`resume-from-step`、artifact、QA 与 fallback 体系的前提下
- 把当前单镜头视频主引擎从 `Runway` 平滑切换到 `Seedance`

当前系统已经完成：

- `Motion Planner -> Performance Planner -> Video Router -> Runway Video Agent -> Shot QA -> Video Composer` 单镜头视频主链
- `bridge shot` 子链
- `action sequence` 子链
- step 级续跑、状态缓存与 auditable artifact

因此，这次替换的核心不是重写生产线，而是把“视频 provider”从主链实现细节中抽离出来，让主链能够：

- 先支持 `Runway + Seedance` 双 provider 共存
- 再切换默认主 provider
- 最后把 `Runway` 降级为兼容路径或 fallback

## 2. 固定架构决策

### 2.1 `Director` 继续是唯一 orchestrator

本次设计明确不引入新的调度中心，也不引入 `CrewAI` 替代当前 orchestrator。

`Director` 继续负责：

- step 调度
- 状态缓存
- artifact 汇总
- provider 失败回退
- compose 输入优先级控制

### 2.2 `Video Router` 升级为 provider 无关打包层

`Video Router` 不再被视为某个单一 provider 的请求构造器，而是镜头标准件与 provider 路由决策层。

它的职责固定为：

- 根据 `shotPackage` 与参考资产决定 `preferredProvider`
- 产出 `fallbackProviders`
- 输出 provider 无关的 `providerRequestHints`
- 为具体 provider agent 提供足够的请求组装上下文

它不直接发请求。

### 2.3 `Video Composer` 不感知底层 provider

`Video Composer` 的输入仍是统一的 `videoResults`，而不是 provider 私有结果。

compose 视觉优先级保持不变：

1. `sequenceClips`
2. `videoResults`
3. `bridgeClips`
4. `lipsyncResults`
5. `animationClips`
6. `imageResults`

因此，provider 替换不应触碰 composer 的主决策逻辑。

### 2.4 `Shot QA`、resume、artifact 属于工程底座

下列能力在 provider 替换过程中必须保持稳定：

- `Shot QA` 工程验收
- `resume-from-step`
- state cache
- artifact 目录与 manifest
- summary 指标

它们不属于“旧 provider 的补丁层”，而属于生产线的工程底座。

## 3. 目标链路

替换完成后的高层主链固定为：

```text
scriptData / shotPlan
  -> imageResults
  -> motionPlan
  -> performancePlan
  -> shotPackages
  -> video routing decision
  -> Seedance Video Agent
  -> videoResults
  -> shotQaReport
  -> bridge / action sequence / lipsync fallback
  -> videoComposer
```

过渡期链路固定为：

```text
shotPackages
  -> Video Router
  -> preferredProvider=seedance | runway
  -> concrete provider agent
  -> normalized videoResults
```

## 4. Provider 协议

## 4.1 统一 request / result / error 协议

为了避免 `Director`、`Shot QA`、`Video Composer` 与具体 provider 强绑定，视频 provider 层统一收敛到下面三类字段。

### 4.1.1 provider request 摘要

每次 provider 调用至少要能回写：

- `provider`
- `providerRequest`
- `providerMetadata`

其中：

- `providerRequest` 用于保存经脱敏、可审计的请求摘要
- `providerMetadata` 用于保存 provider 私有但对排障有用的元信息

### 4.1.2 provider 执行结果

每条 `videoResults[]` 最少字段固定为：

- `shotId`
- `preferredProvider`
- `provider`
- `status`
- `videoPath`
- `outputUrl`
- `taskId`
- `providerJobId`
- `providerRequest`
- `providerMetadata`
- `targetDurationSec`
- `actualDurationSec`
- `failureCategory`
- `error`
- `errorCode`
- `errorStatus`
- `errorDetails`

说明：

- `taskId` 保留当前兼容字段
- `providerJobId` 作为 provider 无关字段新增，长期对外统一使用
- `taskId` 与 `providerJobId` 在 Phase 1 兼容期允许相同

### 4.1.3 provider 错误分类

Provider 层统一错误分类固定为：

- `provider_auth_error`
- `provider_rate_limit`
- `provider_timeout`
- `provider_invalid_request`
- `provider_generation_failed`

其他错误都要归并到以上分类之一，避免主链出现 provider 私有错误名泛滥。

## 4.2 `videoResults` 兼容原则

本次替换必须遵守：

- 原有 `videoResults` 消费方无需大改
- `Runway` 现有字段继续兼容
- 新增字段只做补充，不做破坏性删除

这意味着：

- `taskId` 继续保留
- `providerJobId` 新增
- 未来 `Seedance` 也必须输出同构的 `videoResults`

## 5. 模块边界

### 5.1 `Video Router`

输入：

- `motionPlan`
- `performancePlan`
- `imageResults`
- continuity 上下文

输出：

- `shotPackages`
- `preferredProvider`
- `fallbackProviders`
- `providerRequestHints`

边界：

- 只做路由与打包
- 不直接调用 provider
- 缺少合格参考资产时可显式路由到静图 fallback

### 5.2 `Runway Video Agent`

定位从“默认主视频引擎”调整为：

- 当前已接入 provider
- 过渡期兼容 provider
- 中期 fallback / compatibility provider

边界：

- 输出必须适配统一 provider 协议
- 不能再把 `Runway` 私有结构直接泄漏给主链

### 5.3 `Seedance Video Agent`

定位：

- 下一阶段主视频引擎

边界：

- 只负责 provider 请求、轮询、下载、错误分类与结果标准化
- 输出统一的 `videoResults`
- 不直接决定是否 compose

### 5.4 `Shot QA Agent`

输入：

- `videoResults`

输出：

- `shotQaReport`

边界：

- 只关心视频资产是否可工程使用
- 不依赖 provider 名称作分支
- provider 字段仅用于记录、归因与指标统计

## 6. 切换策略

## 6.1 第一阶段：协议抽象与双 provider 共存

先做：

- 新增 provider 协议工具
- `Runway` 接统一协议
- `Video Router` 输出 provider 无关字段

这阶段不切默认流量。

## 6.2 第二阶段：接入 `Seedance` 但不默认切流

新增：

- `seedanceVideoApi`
- `seedanceVideoAgent`

注意：

- 按 `2026-04-05` 查询到的火山引擎官方公开文档，`Seedance 2.0` 目前仍以控制台体验中心为主，官方页面明确写明“暂不支持 API 调用，敬请期待”。
- 因此工程上要把“`Seedance` 方向”与“`Seedance 2.0` 立即可直连 API”区分开：
  - 架构、协议、router 与 QA 现在就可以按 `Seedance` 主引擎方向准备
  - 真正的 provider 接入需要根据届时官方可用接口决定是：
    - 直接接入 `Seedance 2.0 API`
    - 先接可 API 化的 `Seedance 1.5 / 相关火山视频能力`
    - 或保留 `Runway` 作为过渡主 provider

这阶段允许通过配置切换：

- `VIDEO_PROVIDER=runway`
- `VIDEO_PROVIDER=seedance`

默认值仍可先保持 `runway`，用于低风险接入。

## 6.3 第三阶段：默认主 provider 切到 `Seedance`

切换条件固定为：

- `Seedance` API 可得性已验证
- 基础测试全绿
- `resume-from-step`、artifact、QA、acceptance 全部兼容
- production-style 样本验证完成

切换后：

- 默认主 provider 为 `seedance`
- `Runway` 降级为 fallback 或兼容路径

## 7. state cache 与 artifact 约束

Provider 替换过程中，以下缓存与产物必须保留：

- `shotPackages`
- `videoResults`
- `shotQaReport`
- `delivery summary`

artifact 层至少要继续记录：

- provider request 摘要
- provider 执行结果
- provider 错误分类
- provider breakdown summary

`resume-from-step --step=compose` 不能清掉已经通过 QA 的 `videoResults`。

`resume-from-step --step=video` 只清掉视频生成及其后续状态，不清理更前面的参考资产与规划结果。

## 8. 明确不做

本次替换设计明确不做：

- 第二个 orchestrator
- `CrewAI` 主运行时接管
- shot 级或 sequence 级 CLI 续跑
- 成本系统大重构
- 直接删除 `bridge`、`action sequence`、`lipsync`
- 直接删除 `Runway` 而不经过兼容期

## 9. 验收标准

本次替换的工程验收标准固定为：

- `Runway` 已输出统一 provider 协议
- `Video Router` 已 provider 无关
- `Seedance` 接入后可产出兼容 `videoResults`
- `Shot QA`、`resume`、artifact、composer 不因 provider 变化失效
- 默认主 provider 切流后，acceptance 仍能证明成片来自视频主路径，而不是退回静图默认拼接

本次替换不承诺的产品能力包括：

- 商用品质级多人群战表现
- 稳定高质量原生 lip-sync 替代所有 fallback
- 复杂桥接镜头自动消失
- 所有中间层立即可删

## 10. 对外口径

对内外统一说法固定为：

> 当前仓库已具备完整的视频主链工程底座；下一阶段重点不是继续无边界加模块，而是把单镜头视频主引擎从 `Runway` 平滑切换到 `Seedance`。切换过程中，`Director`、QA、resume、artifact 与 composer 这些工程底座保持不变，旧中间层不会被一次性激进删除，而是根据真实样本逐步降级。
