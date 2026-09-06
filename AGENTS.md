# AI-video-factory-pro AGENTS.md

本文档约束本仓库内 Agent、人类开发者与自动化工具的默认工程行为。目标不是写空泛口号，而是降低重复造轮子、降低复杂度失控、提高可维护性与可交付性。

## 1. 核心原则

### 1.1 优先成熟第三方方案，不从 0 开始

这是本项目的第一原则。

- 技术选型优先使用社区活跃度高、维护稳定、文档完整、已有商业落地案例的编程语言、框架、库、中间件。
- 默认优先顺序：
  - 先复用本项目已有依赖与抽象
  - 再选成熟开源库
  - 最后才允许小范围自研胶水层
- 禁止为了"可控"或"更懂内部逻辑"而重写已有成熟能力，尤其是以下领域：
  - HTTP client / retry / queue / storage binding
  - 图像处理、embedding、face descriptor、hash
  - Web 服务、路由、文件上传、参数解析
  - 测试框架、断言库、浏览器自动化
  - 视频/音频基础处理

**新增依赖前的最小检查：**

1. 这个能力仓库里是否已经有现成依赖或现成模块？
2. License 是否允许商用？
3. Windows + Node.js + ESM 下是否可用？
4. 是否能通过 adapter 接到现有 `agent -> api -> provider` 或 `workbench` 链路？

默认优先选择：社区活跃、近一年持续维护、API 简单、与当前目录结构和调用方式兼容的库。谨慎选择：长期不维护的个人小库、License 模糊、需要常驻远程服务、必须大面积侵入现有调用栈的方案。

### 1.2 优先贴合当前技术栈

本项目当前主技术栈是 Node.js + 原生 ESM + Fastify + 前端 Workbench。

- 新功能默认优先沿用当前栈：
  - 后端/编排：Node.js ESM
  - HTTP 服务：Fastify
  - 图像/媒体处理：`sharp`、`fluent-ffmpeg`
  - AI/视觉侧优先复用仓库已接入的 `@huggingface/transformers`、`onnxruntime-node`、`@vladmandic/face-api`
- 除非现有栈明确做不到，否则不要额外引入新的语言运行时或平行技术栈。

### 1.3 复杂模块治理

任何单文件、单模块或单类一旦复杂度明显失控，就不能继续堆逻辑。

**治理阈值：**
- 文件超过 **1000 行**，必须评估拆分。
- 即使未到 1000 行，只要出现以下信号，也应优先重构而不是继续加功能：
  - 同时承担编排、状态管理、IO、协议转换、错误处理多类职责
  - 出现多个重复代码块或重复数据整形逻辑
  - 测试需要大量 mock 才能覆盖
  - 新人阅读成本明显过高
  - 单函数超过 **150 行**且承担多重职责
  - 一个函数里同时包含：参数标准化、状态恢复、业务判断、provider 调用、artifact 落盘、workbench 观测写入
  - 出现三处以上重复的 reference 拼装、report 拼装、fallback 分支

**推荐拆分方法：**
- 流程编排保留在 agent 主文件
- 纯拼装逻辑抽成 `build*` / `normalize*` / `merge*` / `collect*`
- 多处复用的 gate 判定抽到 `policy` 或 `domain`
- provider 特有逻辑抽到对应 adapter
- artifact 写入逻辑抽到独立 writer / helper
- 可测试的纯函数尽量变成无副作用工具函数

**拆分优先目录：**
- 抽公共函数到 `src/utils/`
- 抽领域规则到 `src/domain/` 或 `src/policy/`
- 抽流程辅助到 `src/utils/*Helpers.js`、`src/utils/*Builders.js`
- 抽 provider 适配到 `src/apis/`
- 抽状态协议和 contract 到 `src/runtime/`、`src/utils/contracts/`

**高复杂模块特别关注：**

以下文件修改时，不能只做局部补丁而不评估结构问题：
- `src/agents/director.js`
- `src/agents/consistencyChecker.js`
- `src/agents/continuityChecker.js`
- `src/agents/imageGenerator.js`
- `src/workbench/http/*`
- `src/workbench/transformers/*`

要求：先判断本次需求是否顺带抽离公共逻辑；新增逻辑优先放进 helper / builder / adapter；如果本次不拆，至少保证新增逻辑不继续加重耦合。

**不允许的做法：**
- 在超长文件里继续堆新阶段
- 用更多布尔开关掩盖职责混杂
- 复制相似逻辑到第二个 agent 再各自演化
- 只加注释不拆模块
- 把"复杂逻辑的注释"当作"不拆分模块"的替代品

**旧代码清理约定：**

旧代码不是"以后再说"的缓冲区。只要本次改动已经识别出废弃路径、重复分支或失效兼容层，就必须评估是否顺手清理。

- 以下情况默认要清理：
  - 已经没有调用方的旧 helper、旧 route、旧 adapter
  - 新旧实现并存，但主链路已经稳定切到新实现
  - 只服务于历史实验、临时 debug、一次性数据修复的分支
  - 已失效的注释、TODO、feature flag、兼容参数
- 清理时必须：先确认没有真实调用方；保证 workbench、artifact、state、脚本入口的可观测性不回退
- 对 legacy 模式与 project mode：如果旧路径仍有真实用户价值，先收敛入口和协议再考虑删除实现；如果旧路径只是历史残留且新主链已覆盖，优先移除
- 禁止：明知已废弃仍加新逻辑；为"保险"长期保留双套实现但没有 owner 和切换计划；只删表层调用不清理底层协议、注释、fixture、文档

## 2. 本项目的工程目标

这是一个 AI 漫剧自动化生成系统，不是通用 demo 仓库。所有改动都应服务以下目标：

- 角色一致性、场景一致性、跨镜头连贯性可交付
- Workbench 可观测，可定位失败根因
- Run artifacts 可复盘、可回放、可人工接管
- 兼容 legacy 单文件模式与 project mode，但主行为尽量收敛为一条主链
- 出问题时优先前移阻断，不要让错误一路漂到最终 QA 才暴露

## 3. 目录职责约定

新增代码前，先判断应该放到哪里，不要把所有逻辑继续堆进 `src/agents/director.js`。

- `src/agents/` — 放编排 agent、阶段 agent、主流程协调逻辑。不适合堆积纯工具函数、纯协议转换、纯数据结构拼装
- `src/apis/` — 放外部 provider 适配层、请求组装、provider 降级策略。不放业务编排
- `src/app/` — 放应用入口、workbench server 装配
- `src/billing/` — 放账单、网关同步、ledger 相关逻辑
- `src/director/` — 放实验 runtime、director 新框架、runtime 选择逻辑
- `src/domain/` — 放业务实体、领域模型、治理规则（实体工厂、数据模型、一致性阈值等）
- `src/infrastructure/` — 放更底层的基础设施封装
- `src/llm/` — 放模型 client、prompt 模板
- `src/pipeline/` — 放阶段化 pipeline 抽象
- `src/policy/` — 放 gate、阈值、策略规则（门禁判定、provider 路由决策等，消费 domain 模型产出操作决策）
- `src/runtime/` — 放 runtime 协议、schema、日志结构
- `src/utils/` — 放公共函数、helper、summary builder、contract builder、file/store 适配
- `src/workbench/` — 放 workbench 的数据源、HTTP 路由、view model 转换

**`domain/` vs `policy/` 的区别：** `domain/` 定义实体和业务规则（"是什么"），`policy/` 做门禁判定和路由决策（"怎么判"）。两者都是纯函数、无副作用。如果拿不准，先放 `domain/`，等出现多个 agent 复用同一判定逻辑时再抽到 `policy/`。

## 4. 开发约定

### 4.1 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 源文件（`src/`） | camelCase | `imageGenerator.js`, `consistencyChecker.js` |
| 测试文件（`tests/`） | `<agent>.<scope>.test.js` | `director.artifacts.test.js`, `consistencyChecker.identity.test.js` |
| 脚本文件（`scripts/`） | kebab-case | `workbench-server.js`, `run-agent-prod-tests.js` |
| 导出函数/变量 | camelCase | `generateAllImages`, `runConsistencyCheck` |
| 工厂函数 | `create*` 前缀 | `createDirector(overrides)` |
| 环境变量 | UPPER_SNAKE_CASE | `LLM_PROVIDER`, `IMAGE_STYLE` |

### 4.2 日志规范

- 统一使用 `src/utils/logger.js` 的 `logger` 对象，**禁止直接用 `console.log`**
- 调用签名：`logger.info('Prefix', 'message')` — 第一个参数是 Agent/模块名，第二个是消息
- 日志级别：`debug` / `info` / `warn` / `error`，通过 `LOG_LEVEL` 环境变量控制（默认 `info`）
- 示例：`logger.info('ImageGenerator', '开始生成图像，共 ${count} 个 prompt')`

### 4.3 错误处理规范

两套模式，按场景选择：

**阶段级失败（阻断后续流程）：** `throw new Error('中文错误描述')`
- 用于：不可恢复的阶段失败（如剧本找不到、资产治理阻断、角色三视图全部失败）
- Caller 侧用 try/catch 包裹，catch 到的 `error.message` 写入 run job 的 error 字段并重新 throw

**批量操作中的单项失败（收集结果，不阻断）：** 返回 `{ success: false, error: '原因' }`
- 用于：批量图像生成、批量 consistency check 等并发任务中的个别失败
- Caller 侧汇总失败项，决定是部分成功还是整体失败

**workbench 错误可见性：** 错误信息必须对 workbench 可读，区分以下类别：
- 资产未就绪 / provider 失败 / consistency fail / continuity fail / preflight QA block
- 禁止只写"失败了"，禁止只在控制台有错误而 workbench 看不到

### 4.4 排查与调试约束

排查问题时，默认采用“代码与日志驱动”的方式，不允许凭空猜测根因。

- 先读当前项目实际代码，再下结论。至少确认：
  - 真实入口在哪里
  - 相关请求/任务实际走的是哪条链路
  - 状态写入到了哪里
  - workbench / artifact / state / run job 到底读取哪个数据源
- 先看真实日志、artifact、run state、测试输出，再决定修改方案。
- 没有证据时，不要把“可能原因”写成“根因”；结论必须能被代码路径、日志文本、状态文件或测试复现支撑。
- 禁止跳过调用链直接改表层现象，尤其是以下问题：
  - 页面展示异常但真实数据源未确认
  - provider 调用失败但真实请求 payload / 路由未确认
  - run 没产物但状态落盘路径未确认
  - QA 误报但上游 artifact / report 未确认

**排查顺序默认如下：**

1. 先确认复现条件和影响范围
2. 读取实际代码路径，确认入口、分支和调用链
3. 检查日志、run artifacts、`state.json`、run job、QA overview 等真实证据
4. 必要时补一个最小复现测试或脚本，固定问题
5. 梳理修改方案，明确改哪一层、为什么改这一层
6. 修改后跑聚焦验证，确认根因消失且没有引入旁路回归

**排查输出要求：**

- 要能回答“为什么失败”“失败发生在哪一层”“workbench 为什么看到这个现象”“真正该改哪一层”。
- 如果只是推测，应明确标注为“待验证假设”。
- 如果日志不足以定位，优先补充结构化日志、artifact 字段或测试证据，而不是继续猜。

### 4.5 日志与观测补充约束

日志不仅用于打印过程，更用于定位根因和支撑 workbench 诊断。

- 新增关键流程时，至少补足以下观测点中的必要项：
  - 输入摘要
  - 关键决策分支
  - provider 路由与降级
  - 失败分类
  - artifact 写入结果
  - 对 workbench 可见的最终状态
- 日志要能对齐真实模块边界，不要把多个阶段的失败混成一句模糊描述。
- 对同一失败，优先保持三处信息一致：
  - 控制台/文件日志
  - artifact / state / report
  - workbench 展示文案
- 禁止制造“看起来成功”的假状态：
  - 不能用空数组、0 值、占位字符串冒充真实结果
  - 不能为了让页面可显示而回填 synthetic 成功数据
  - 不能把未完成、已跳过、已阻断误写成 completed
- 如果一个问题用户只能通过日志看到，而不能通过 workbench 或 artifact 复盘，视为可观测性不足。

### 4.6 Agent 开发模式

**当前现状：** Agent 之间没有统一的接口签名。大部分 Agent 导出裸异步函数，参数为位置参数。`createDirector(overrides)` 是唯一的工厂+依赖注入模式。这种不一致是历史演进的产物，新 Agent 按以下约定：

- 如果 Agent 需要可替换的依赖（如 mock provider），使用工厂函数 `createXxx(deps)` 返回 `{ run, ... }`
- 如果 Agent 是纯编排逻辑，直接导出命名异步函数即可
- 每个 Agent 必须产出约定目录的 artifact（见 `src/utils/runArtifacts.js`），且将关键结果写入 `state.json`

**Artifact 目录命名：** `NN-agent-name/`，NN 为两位数字序号，如 `01-script-parser/`、`05-image-generator/`。

### 4.7 环境变量

- 命名：UPPER_SNAKE_CASE（`LLM_PROVIDER`、`IMAGE_STYLE`、`CONSISTENCY_THRESHOLD`）
- 读取：直接从 `process.env` 读取，**不引入运行时验证库**（如 Zod、joi）
- 文档：`.env.example` 是环境变量的唯一权威文档，新增变量必须同步更新
- 加载：`dotenv` 在 logger 初始化时统一加载（`import 'dotenv/config'`），各 Agent 不需要重复加载

### 4.8 Git 分支与提交

- **分支命名：** `feature/<描述>`、`refactor/<描述>`、`fix/<描述>`、`phase<N>/<描述>`
- **提交信息：** Conventional Commits 格式 — `feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:`
- **提交前：** 跑相关聚焦回归测试（见 §6），不在提交中包含 `.env`、`node_modules/`、`temp/`、`output/`

### 4.9 Claude Code 集成

本项目使用 Claude Code 作为主要 AI 开发助手。

- `.claude/settings.json` — 项目级 Claude Code 配置，启用了 ponytail 插件
- `.claude/settings.local.json` — 本地权限白名单（不提交）
- `.claude/skills/` — 自定义 skill 目录
- 本文档（`AGENTS.md`）会自动注入 Claude Code 的上下文，修改本文档会影响所有 AI 辅助开发行为

## 5. 注释规则

### 5.1 总原则

注释是补充，不是说明书。

- 解释"为什么"，而不是重复"做什么"
- 解释复杂约束、兼容原因、失败兜底、门禁语义
- 优先通过命名和结构自解释
- 修改代码时，必须同步更新注释

### 5.2 必须写注释的地方

- 文件头：说明模块职责
- 公共 API：说明用途、参数、返回值、副作用
- 复杂流程边界：例如 gate、fallback、兼容桥接、artifact 协议
- 超过五行且包含非显而易见业务规则的逻辑块
- 跨系统交互：如 agent -> provider、runJobStore、artifactStore、workbench

### 5.3 不要写的注释

- 显而易见的赋值、循环、条件判断
- 与代码字面完全重复的描述
- 已经失效但未删除的旧解释

### 5.4 本项目注释风格

- 默认**中文注释**，关键术语保留英文
- 注释应是完整句子
- 重点解释：意图、约束、副作用、fallback 原因、兼容分支存在原因

## 6. 测试与验证规则

### 6.1 测试框架

- **框架：** Node.js 内置 `node:test`（`import test from 'node:test'`）
- **断言：** `node:assert/strict`（`import assert from 'node:assert/strict'`）
- **Mock 方式：** 依赖注入 —— 通过 agent 的工厂函数或 options 参数传入 mock 实现，不使用 mock 库
- **测试数据：** 优先使用本地 fixture、mock provider、snapshot artifact，不依赖真实远程模型

### 6.2 覆盖要求

任何影响以下链路的修改，都应补测试或至少跑聚焦回归：
- director 主流程
- character / scene consistency
- image provider adapter
- workbench view model / HTTP routes
- artifact / run state / QA overview

优先覆盖层级（从最贴近风险的一层开始）：
- 纯函数 / helper：单元测试
- route / transformer / store / runtime contract：集成测试
- 用户真实操作链路：E2E 测试

至少覆盖：主成功路径 + 一个关键失败路径 + 一个最容易回归的兼容/边界路径。

修改 bug 时，默认先补一个能稳定复现旧问题的测试。

### 6.3 调试型测试约定

排查问题时，测试不只是验收工具，也是定位根因的证据工具。

- 对反复出现、链路长、日志多但结论不稳的问题，优先补“最小复现测试”或“聚焦回归测试”。
- 测试要尽量固定真实根因，而不是只断言一个宽泛的失败结果。
  - 例如优先断言：失败分类、provider 路由、artifact 字段、state 转移、workbench 可见错误
  - 而不是只断言：`throws` / `status=500`
- 修 bug 时，优先形成以下三段式证据：
  - 改动前：测试能复现旧问题
  - 改动后：同一测试通过
  - 回归面：相关主链路聚焦测试仍通过
- 如果暂时无法补自动化测试，必须说明原因，并至少给出：
  - 复现步骤
  - 实际日志/artifact 证据
  - 手工验证结果
- 禁止拿一次偶然成功当成“问题已解决”；默认要求至少有可重复的测试或稳定复现/回归证据。

### 6.4 E2E 测试

- 只要改动影响 Workbench 前端交互、运行状态展示、QA 面板、人工接管入口，就应评估 E2E 覆盖
- 项目使用 Playwright（`@playwright/test`）作为 E2E 框架
- E2E 默认不直连真实远程 provider，通过 mock、fixture、假 run artifact 稳定执行
- E2E 用例应避免脆弱选择器，优先使用语义化标识或测试 id
- E2E 基础设施仍在建设中，本次改动如果确实不适合补 E2E，在提交说明里注明原因即可

### 6.5 常用测试命令

- 聚焦回归：`node --test tests/consistencyQaPolicy.test.js tests/consistencyChecker.identity.test.js tests/characterAssetGovernance.test.js`
- 单 Agent 生产测试：`npm run test:<agent-name>:prod`
- 全量生产测试：`npm run test:agents:prod`
- 全量测试：`node scripts/run-tests.js`

## 7. Workbench 与可观测性规则

- 任何影响运行状态的主流程改动，优先考虑：
  - `state.json`
  - run artifacts
  - run job
  - QA overview
  - workbench 是否能看到真实失败原因
- 不允许只在控制台日志里有错误，而 workbench 看不到。
- 失败分类必须精确（见 §4.3），不能只写"失败了"。

## 8. 框架与架构演进约束

- 优先沿用当前项目主链：Node.js ESM + Fastify + Workbench，不额外并行引入第二套后端框架或第二套路由体系。
- 能在现有抽象层解决的问题，不新增横切“平台层”或“大一统框架”。
- 新引入的库应优先落在现有边界内：
  - provider 能力放 `src/apis/`
  - 领域规则放 `src/domain/` / `src/policy/`
  - 编排辅助放 `src/utils/`
  - workbench 服务能力放 `src/app/workbench/` 或 `src/workbench/http/`
- 涉及 legacy server / Fastify 双轨时，默认策略是“收敛兼容层”，不是再复制第三套实现。
- 结构治理时优先做低风险切片：
  - 先抽 helper / builder / route handler / adapter
  - 再收敛 contract
  - 最后再考虑替换入口
- 没有迁移计划和验证闭环时，不要大面积改 runtime、store 协议、artifact 目录结构。

## 9. 媒体与中文支持

- 本项目生成语言为**中文**，适用于：图片文案、SVG、前端界面、TTS 语音、字幕
- 代码注释、commit message、错误消息、workbench UI 文本默认使用中文
- 关键术语（provider、artifact、consistency、QA、gate、workbench）保留英文
- 新增图像、海报、预览图、SVG 模板时，应确保中文不乱码、不溢出
- 涉及文本渲染时，不能假设只有英文

## 10. 提交前自检清单

提交前至少检查：

1. 有没有重复造轮子，本可以复用现有库或现有模块？
2. 有没有把复杂逻辑继续堆进超长文件？新逻辑是否放在正确目录？
3. workbench / artifact / state 是否还能看到真实状态？
4. 注释是否解释了真正复杂的地方？
5. 如果引入了新依赖，是否确认了 License 和兼容性？
6. 中文显示相关内容是否可正常工作？
7. 本次识别出的旧代码、死分支、失效注释是否已清理或明确记录？
8. 是否有对应的自动化测试或聚焦回归支撑这次改动？
9. 如果影响 Workbench 或前端主链路，是否已评估 E2E？
10. 新增/修改的环境变量是否已同步到 `.env.example`？
11. 这次排查结论是否由真实代码路径、日志、artifact 或测试证据支撑，而不是猜测？
12. 修改是否落在正确层级，而不是跳过根因只修表象？

## 11. 默认结论

在本仓库里，默认正确做法是：

- 先查现有实现和成熟开源库
- 先读代码、看日志、看 artifact，再判断根因
- 用最小接入成本复用已有框架与依赖
- 对过大模块做增量拆分
- 让主流程、artifact、workbench 三者保持一致
- 用中文注释解释复杂设计，而不是用注释掩盖复杂设计
