# Phase 2 试跑与复盘 SOP

这份文档用于回答一个很具体的问题：

> Phase 2 工程链路已经完成后，下一轮真实样例试跑应该怎么跑、怎么验、怎么复盘，才能决定是否进入 Phase 3。

它不是新的设计文档，也不是新的实施计划。

它只负责三件事：

1. 固定 Phase 2 试跑前的准备动作
2. 固定 Phase 2 试跑后的验收口径
3. 固定 Phase 2 复盘输出模板，方便决定 Phase 3 优先级

## 适用范围

适用于以下场景：

- 刚完成 Phase 2，准备跑第一次真实 production-style 样例
- 调整了视频主链后，想重新做一次阶段性验收
- 想比较不同样例、不同风格、不同镜头模板的 Phase 2 实际效果

不适用于：

- 只做单元测试，不跑真实样例
- 只排查某一个孤立 bug
- 直接开始 Phase 3 设计，但没有真实试跑证据

## 本轮目标

Phase 2 试跑的目标不是证明“已经商用可交付”，而是回答下面 5 个问题：

1. `videoResults` 主路径是否稳定工作
2. 单镜头动态感是否明显优于 Phase 1
3. 哪些镜头模板已经可用，哪些仍明显像 PPT
4. fallback 比例是否过高
5. 下一阶段最应该投资源优化哪一类问题

## 试跑前检查

开始真实样例前，先完成以下最小检查：

### 1. 环境检查

- `ffmpeg -version`
- `ffprobe -version`
- `.env` 中已配置：
  - `RUNWAY_API_KEY`
  - 当前主链必需的 LLM / TTS key

### 2. 代码与测试检查

至少确认以下命令全绿：

```bash
node --test tests/performancePlanner.test.js tests/videoRouter.test.js tests/runwayVideoAgent.test.js tests/motionEnhancer.test.js tests/shotQaAgent.test.js tests/videoComposer.test.js tests/resumeFromStep.test.js tests/director.project-run.test.js tests/director.artifacts.test.js tests/pipeline.acceptance.test.js tests/runArtifacts.test.js
```

### 3. 样例选择检查

试跑样例建议至少覆盖这 3 类之一：

- 对话情绪戏
- 双人张力戏
- 动作冲击戏

如果只跑一个样例，优先选“混合型样例”：

- 既有对白
- 又有情绪推进
- 最好再带少量动作镜头

## 推荐试跑命令

### 1. 主试跑命令

```bash
node scripts/run.js samples/寒烬宫变-pro.txt --style=realistic
```

### 2. 如果中途失败，先看

- run 根目录 `qa-overview.md`
- `09f-shot-qa/1-outputs/shot-qa-report.md`
- `10-video-composer/3-errors/`

### 3. 如果只想重做视频主链

```bash
node scripts/resume-from-step.js --step=video samples/寒烬宫变-pro.txt --dry-run --style=realistic
node scripts/resume-from-step.js --step=video samples/寒烬宫变-pro.txt --style=realistic
```

### 4. 如果只想重做最终合成

```bash
node scripts/resume-from-step.js --step=compose samples/寒烬宫变-pro.txt --dry-run --style=realistic
node scripts/resume-from-step.js --step=compose samples/寒烬宫变-pro.txt --style=realistic
```

## 试跑后先看什么

建议固定按这个顺序看：

1. `qa-overview.md`
2. `09f-shot-qa/1-outputs/shot-qa-report.md`
3. `10-video-composer/1-outputs/compose-plan.json`
4. 最终 `final-video.mp4`
5. 如有异常，再下钻：
   - `09d-runway-video-agent/`
   - `09e-motion-enhancer/`
   - `09f-shot-qa/`
   - `10-video-composer/3-errors/`

## Phase 2 验收清单

### A. 工程验收

下面这些项全部满足，才算 `工程验收通过`：

- `videoResults` 主路径实际被消费
- `09a~09f` 与 `10-video-composer` artifact 齐全
- `Shot QA v2` 已输出结构化报告
- 通过的镜头进入 compose
- 未通过的镜头被显式 fallback 记账
- `resume --step=compose` 不会清掉视频链路结果
- `resume --step=video` 会清掉视频及后续状态
- 最终视频成功输出

### B. 产品体验验收

下面这些项不是“全有或全无”，而是要打标签：

- 单镜头是否明显在动
- 运镜是否像镜头而不是简单推拉裁切
- 角色动作是否和情绪一致
- 对白镜头是否至少具备基础表演感
- 动作镜头是否有冲击感而不是静帧切换
- 镜头之间是否有明显断裂感

### C. 明确不应误判为通过的情况

出现下面情况，不能说“Phase 2 已经达到商用品质”：

- 视频 technically 可播，但主体几乎不动
- 只是静图做轻微缩放或拼接
- 动作镜头依旧像 PPT 切页
- QA 通过，但视觉表现力仍明显不足
- fallback 太多，最终成片仍主要依赖静图路径

## 复盘输出模板

每次试跑结束，建议固定输出下面这份复盘。

### 1. 运行摘要

```md
# Phase 2 试跑复盘

- 样例：
- 运行时间：
- 风格：
- 是否完整跑通：
- 最终视频路径：
- run 目录：
```

### 2. 工程结果

```md
## 工程结果

- planned video shot count:
- generated raw video shot count:
- enhanced video shot count:
- qa passed video shot count:
- fallback shot count:
- manual review shot count:
- final composed video: yes / no
```

### 3. 镜头级观察表

```md
## 镜头级观察

| Shot ID | 模板 | 最终走向 | 动态感 | 主要问题 | 备注 |
| --- | --- | --- | --- | --- | --- |
| shot_001 | dialogue_closeup_react | pass_with_enhancement | 中 | 表情变化弱 | 可继续优化 |
| shot_002 | fight_impact_insert | fallback_to_image | 低 | 原始视频近静帧 | 需要更强动作模板 |
```
```

动态感建议统一打 4 档：

- `高`
- `中`
- `低`
- `无`

### 4. 模板级结论

```md
## 模板级结论

- 最稳定模板：
- 最容易失败模板：
- 增强收益最高模板：
- fallback 最高模板：
```

### 5. 根因分类

```md
## 根因分类

- provider 原生生成不足：
- enhancement 无法补救：
- shot package 提示不足：
- performance template 不够细：
- compose 前桥接正常 / 异常：
```

### 6. Phase 3 输入结论

```md
## 对 Phase 3 的建议

- 最该优先解决的问题：
- 不建议继续投入的问题：
- 建议新增的 agent / skill：
- 推荐优先路线：
```

## 复盘判定规则

### 可以进入 Phase 3 设计的条件

满足以下条件即可进入 Phase 3：

- Phase 2 工程链路已稳定跑通
- 已至少完成 1 次真实样例试跑
- 已完成一份镜头级复盘
- 已能明确说出“当前最大缺口是什么”

### 不建议直接进入 Phase 3 的条件

出现以下情况时，先不要急着开新阶段：

- 真实样例还没跑过
- 只看测试，不看成片
- 不知道 fallback 比例
- 不知道是 provider 问题、模板问题，还是增强问题

## 建议的结论口径

试跑结束后，对外建议统一用下面三段话之一：

### 口径 1：工程通过，产品未达标

> Phase 2 已完成视频主链升级，工程链路可用，但真实样例仍未达到商用品质，下一阶段需优先优化镜头表现力与镜头间连贯性。

### 口径 2：工程通过，局部模板可用

> Phase 2 已证明部分高频镜头模板可稳定生成动态镜头，但动作类和复杂表演镜头仍存在明显短板，建议 Phase 3 聚焦桥接镜头和多角色动作编排。

### 口径 3：工程与样例均达预期，可进入下一阶段

> Phase 2 已完成工程闭环，并通过真实样例验证了单镜头动态质量的第一轮提升，可以进入 Phase 3，重点解决跨镜头连续性和复杂表演场景。
