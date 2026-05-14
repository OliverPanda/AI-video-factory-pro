# Queue Execution Policy Design

## 背景

当前项目的队列控制集中在 [src/utils/queue.js](/d:/My-Project/AI-video-factory-pro/src/utils/queue.js)：

- `imageQueue`
- `ttsQueue`
- `llmQueue`
- `queueWithRetry`

这套实现对生产环境是合理的，因为它承担了：

1. 并发限制
2. 请求间隔控制
3. 限流后的指数退避
4. 统一重试

但它也把“生产级等待策略”直接带进了测试环境。当前最典型的问题是：

- `[tests/characterRefSheetGenerator.test.js](/d:/My-Project/AI-video-factory-pro/tests/characterRefSheetGenerator.test.js)` 会走真实 `imageQueue`
- `imageQueue` 当前固定 `concurrency: 1`
- `interval` 默认 `3000ms`
- `queueWithRetry` 在失败时会执行真实 `setTimeout`
- `rate limit` 分支首轮退避就是 8 秒

结果是：测试超时并不是因为业务逻辑卡死，而是因为测试正在执行生产节流与退避。

同时，用户还希望把所有走 `imageQueue` 的图像任务统一提升到 `concurrency = 5`，覆盖：

- 角色三视图
- 分镜图
- 后续所有复用 `imageQueue` 的图像任务

因此，这次设计不是只修一个测试文件，而是要把“执行策略”从业务逻辑中抽离出来。

## 设计目标

1. 为全项目建立统一的执行策略层，避免测试环境误用生产等待逻辑。
2. 将 `imageQueue` 的生产并发统一提升到 `5`。
3. 保留生产环境的限流、间隔、重试、退避能力。
4. 让测试环境默认零等待、可预测、快速失败。
5. 不要求各个 agent 自己知道当前是生产还是测试。
6. 让未来的 `ttsQueue`、`llmQueue`、视频任务队列都可复用同一套机制。

## 非目标

本次不处理以下事项：

1. 不改第三方 provider 的业务路由逻辑。
2. 不改变现有 QA 判定规则。
3. 不引入新的任务调度系统或外部消息队列。
4. 不把所有 agent 改成并发执行器框架。
5. 不顺手重构整个 director 流水线。

## 设计原则

### 1. Policy First

队列的核心不是 `PQueue` 本身，而是“当前环境下允许什么执行行为”。

因此，代码应该先表达：

- 生产态怎么跑
- 测试态怎么跑
- 每类任务默认参数是什么

再决定是否由 `PQueue` 落地。

### 2. Behavior Equivalence Without Time Cost

测试环境仍然要覆盖：

- 成功路径
- 失败路径
- 重试分支是否被触发
- 调用顺序是否正确

但不应该真的等待 3 秒、8 秒、16 秒。

### 3. Centralized Execution Policy

环境差异必须集中在一处管理，不能散落到：

- agent 内部 if/else
- 测试里临时改全局环境变量
- 某些 queue 特判，某些 queue 没特判

### 4. Safe Production Concurrency Upgrade

`imageQueue` 并发从 1 提升到 5 不是纯提速动作，它会改变真实限流风险。

因此生产态必须保留：

- `interval`
- `intervalCap`
- retry
- backoff

不能只把并发调高而移除保护。

## 方案对比

### 方案 A：测试特判

在 `queueWithRetry` 或各 agent 中加：

- `NODE_ENV === 'test'` 时跳过队列
- `NODE_ENV === 'test'` 时跳过 sleep

优点：

- 改动最小
- 见效最快

缺点：

- 环境逻辑容易散落
- 后续加新队列时还会重复写特判
- 很难形成统一 harness

### 方案 B：统一执行策略层

抽出统一的 queue execution policy，按环境提供不同执行器：

- `production`
- `test`

优点：

- 结构清晰
- 测试与生产的差异集中管理
- 所有队列都能复用
- 最符合当前项目已在做的 harness engineering 方向

缺点：

- 需要多一层抽象
- 需要补一轮回归测试

### 方案 C：多环境调度矩阵

在 B 基础上再拆：

- `production`
- `development`
- `test`
- `stress`

优点：

- 理论上最完整

缺点：

- 当前需求还用不上
- 复杂度偏高

### 推荐

采用 **方案 B：统一执行策略层**。

原因：

1. 它能系统性解决测试超时，不只是修一个点。
2. 它能自然承接“imageQueue 并发 5”的生产需求。
3. 它最适合后续扩展到 `ttsQueue` / `llmQueue` / 视频任务。

## 目标架构

### 1. Policy Registry

新增一个统一的执行策略注册层，例如：

- `getExecutionPolicy()`
- `createQueueExecutor()`
- `createRetryPolicy()`

这里负责回答：

- 当前环境是哪种 policy
- image / tts / llm 分别怎么执行
- 是否允许真实 sleep
- 默认重试次数是多少

### 2. Queue Executor

对上层 agent 暴露统一接口，例如：

- `executeImageTask(fn, options)`
- `executeQueuedTask(queueType, fn, options)`

上层 agent 不再直接操作 `PQueue` 和 `setTimeout`。

### 3. Retry Controller

把 `queueWithRetry` 中的重试与等待策略抽出来，至少支持：

- `maxRetries`
- `shouldRetry(error)`
- `getDelay(error, attempt)`
- `sleep(delay)`

这样测试态可以把 `sleep` 替换成 no-op，而不是篡改业务逻辑。

### 4. Environment-specific Policies

至少定义两套：

#### production policy

- `imageQueue.concurrency = 5`
- 保留 `interval`
- 保留 `intervalCap`
- 保留真实 backoff
- 保留限流识别

#### test policy

- image/tts/llm 默认不走真实 `PQueue`
- `sleep()` 为 no-op
- 默认 `maxRetries = 1`
- 如需测试 retry 分支，由测试显式传入

## imageQueue 的新默认策略

生产态统一调整为：

- `concurrency = 5`
- `interval = IMAGE_QUEUE_INTERVAL_MS`
- `intervalCap = IMAGE_QUEUE_INTERVAL_CAP`

说明：

1. 之前固定 `concurrency = 1` 太保守，吞吐不足。
2. 只提并发不保留 `intervalCap` 会放大 429 风险。
3. 因此要把并发和节流都保留下来，只是从“单线程串行”改成“有上限的受控并发”。

建议默认配置：

- `IMAGE_QUEUE_CONCURRENCY=5`
- `IMAGE_QUEUE_INTERVAL_MS=3000`
- `IMAGE_QUEUE_INTERVAL_CAP=5`

如果 provider 实际限流更严格，后续再按 provider profile 单独收紧，但这不属于本次设计范围。

## 模块职责

### [src/utils/queue.js](/d:/My-Project/AI-video-factory-pro/src/utils/queue.js)

改造后负责：

- 定义各类任务的默认 policy
- 暴露统一执行器
- 暴露重试控制工具

不再负责：

- 把测试与生产差异硬编码在同一段业务流程里

### [src/agents/characterRefSheetGenerator.js](/d:/My-Project/AI-video-factory-pro/src/agents/characterRefSheetGenerator.js)

改造后负责：

- 提交图像任务
- 处理成功/失败结果
- 写 artifact

不再负责：

- 关心当前是否真实排队
- 关心 sleep/backoff 的实现方式

### 其他走 imageQueue 的 agent

例如：

- `[src/agents/imageGenerator.js](/d:/My-Project/AI-video-factory-pro/src/agents/imageGenerator.js)`

应统一走同一套图像执行器，确保：

- 三视图
- 分镜图
- 后续所有图像任务

都继承相同的生产 / 测试行为。

## 数据流

### 生产态

1. agent 提交 image task
2. image executor 进入 `imageQueue`
3. 按并发 5 与 interval 规则出队
4. 如果失败，retry controller 计算 backoff
5. 执行真实 sleep
6. 继续重试或返回失败

### 测试态

1. agent 提交 image task
2. test executor 直接执行任务函数
3. 若失败，按测试 policy 决定是否重试
4. 即使有 delay，也不执行真实 sleep
5. 立即返回结果

## 配置设计

建议新增或标准化以下配置项：

- `QUEUE_EXECUTION_POLICY=production|test`
- `IMAGE_QUEUE_CONCURRENCY`
- `IMAGE_QUEUE_INTERVAL_MS`
- `IMAGE_QUEUE_INTERVAL_CAP`
- `IMAGE_QUEUE_MAX_RETRIES`

测试环境不建议依赖 `.env` 手动切换，应该由测试 harness 或 helper 显式注入。

## 测试策略

### 单元测试

覆盖：

1. production policy 是否生成预期参数
2. test policy 是否关闭真实等待
3. retry controller 是否按错误类型计算 delay
4. image executor 是否正确调用 queue / direct runner

### Agent 回归测试

至少覆盖：

1. `characterRefSheetGenerator`
2. `imageGenerator`

验证点：

1. 测试态不再出现超长等待
2. 失败用例能快速返回
3. artifact 结构不变

### 配置测试

验证：

1. `imageQueue` 生产并发默认是 5
2. 测试态不会错误读取生产队列参数去真实 sleep

## 风险与缓解

### 风险 1：并发 5 导致 provider 429 上升

缓解：

- 保留 `intervalCap`
- 保留 backoff
- 允许通过 env 回调到更保守参数

### 风险 2：测试态和生产态行为偏差过大

缓解：

- 只移除时间成本，不移除执行语义
- retry 仍可被测试覆盖，只是不真实等待

### 风险 3：不同 agent 私自绕开统一执行器

缓解：

- 所有图像任务统一从 shared executor 进入
- 后续 code review 明确禁止 agent 直接 new `PQueue`

## 成功标准

如果改造成功，应满足：

1. `tests/characterRefSheetGenerator.test.js` 不再因真实退避而超时。
2. 全项目图像任务统一使用一套 shared image execution policy。
3. 生产态 `imageQueue` 默认并发为 5。
4. 测试态默认零等待，不执行真实 sleep。
5. 现有 artifact、manifest、QA 输出结构不发生破坏性变化。

## 实施建议

建议按以下顺序实施：

1. 先抽 execution policy 与 retry controller
2. 再接入 image executor
3. 再把 `characterRefSheetGenerator` 和 `imageGenerator` 切过去
4. 再补单测与回归测试
5. 最后验证三视图测试文件不再超时

这样可以把风险控制在最小范围内，避免一边提并发一边大面积改 agent。
