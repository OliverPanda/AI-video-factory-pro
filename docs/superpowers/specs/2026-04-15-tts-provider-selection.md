# TTS Provider Selection For Chinese Short-Drama Pipeline

日期：2026-04-15

## 背景

当前项目的中文配音主链效果不达标，用户主观评价为“语音效果极差”。  
本次文档目标不是泛泛盘点市面产品，而是为当前项目给出可执行的 TTS 选型结论。

当前重点候选为：

- `MiniMax Speech`
- `ElevenLabs`
- `Cartesia`

评估维度聚焦在：

1. 中文漫剧对白的自然度与情绪表现
2. 长文本 / 批量生成的生产可用性
3. API 接入与工程改造成本
4. 单位成本与整体性价比
5. 是否适合作为当前项目的“主链”

## 结论先行

对当前项目，推荐顺序如下：

1. `MiniMax Speech`：推荐作为中文主链首测，也是当前最值得优先接入的主方案
2. `ElevenLabs`：推荐作为高自然度对照组，用于验证“上限是否明显更高”
3. `Cartesia`：推荐作为实时 / voice-agent 化备选，不建议作为当前中文漫剧主链首选

如果只选一个先做：

- 先接 `MiniMax Speech`

如果要同时做 A/B：

- `MiniMax Speech` 做中文主链候选
- `ElevenLabs` 做高自然度对照组

如果后续项目重心转向“实时互动 / 实时语音 agent / 超低延迟”：

- 再重点评估 `Cartesia`

## 性价比结论

这里的“性价比”不是只看单价，而是看“中文成片质量 / 工程可控性 / 实际成本”后的综合结果。

### 面向当前项目的综合性价比

1. `MiniMax Speech`
2. `Cartesia`
3. `ElevenLabs`

### 只看纸面单价的性价比

1. `Cartesia`
2. `MiniMax Speech`
3. `ElevenLabs`

### 为什么两个排序不一样

`Cartesia` 在纸面价格上非常强，但它的强项更偏实时 voice AI 和超低延迟，不是中文短剧配音这个单一场景。  
`MiniMax Speech` 的纸面价格不一定最低，但在“中文 + 配音生产 + 情绪表现 + 工程可用性”这个组合下，更可能给当前项目带来最高的真实回报。

这是本项目的核心判断。

## 候选分析

## 1. MiniMax Speech

### 适配度判断

对当前项目最适合。

原因：

- 官方 TTS 产品线明确覆盖同步 WebSocket、异步长文本、voice cloning、voice design
- 官方文档明确支持中文、粤语以及共 40 种语言
- 官方模型描述强调韵律、稳定性、音色相似度和自然度
- 这套产品形态更接近“内容生产配音平台”，而不是纯实时 agent 平台

### 官方信息

MiniMax 官方文档显示：

- `speech-2.8-turbo / 2.6-turbo / 02-turbo` 为 `$60 / M characters`
- `speech-2.8-hd / 2.6-hd / 02-hd` 为 `$100 / M characters`
- 同步 TTS 支持最多 `10,000` 字符单次请求
- 支持 `40` 种常用语言，包含 `Chinese` 与 `Cantonese`

来源：

- Pay as You Go 定价  
  https://platform.minimax.io/docs/guides/pricing-paygo
- API Overview / 语言与模型说明  
  https://platform.minimax.io/docs/api-reference/api-overview
- WebSocket TTS 指南  
  https://platform.minimax.io/docs/guides/speech-t2a-websocket

### 对项目的推断

基于官方产品形态，我的判断是：

- `MiniMax Turbo` 很适合做默认批量生产链
- `MiniMax HD` 很适合主角、旁白、关键情绪镜头
- 它最有希望在不显著拉高改造难度的情况下，直接替换当前中文主链

### 本项目评分

- 中文自然度：`8.5/10`
- 情绪表现：`8.2/10`
- 工程可用性：`8.8/10`
- 成本可控性：`8.2/10`
- 综合推荐度：`8.6/10`

## 2. ElevenLabs

### 适配度判断

自然度上限很高，但对当前项目未必是性价比最高的主链。

原因：

- ElevenLabs 行业口碑一直很强，尤其是真人感、表达力、音色设计
- 但它更强的心智仍然在“高质量通用 TTS / 英文与多语种 / 音色资产化”
- 对中文漫剧批量生产来说，价格并不友好

### 官方信息

ElevenLabs 官方 API 定价页面显示：

- `Flash / Turbo` TTS 为 `$0.05 / 1K characters`
- `Multilingual v2 / v3` TTS 为 `$0.10 / 1K characters`
- `Flash / Turbo` 延迟约 `~75ms`
- `Multilingual v2 / v3` 延迟约 `~250-300ms`
- 支持 `32` 种语言

换算后：

- `Flash / Turbo` 约等于 `$50 / M characters`
- `Multilingual v2 / v3` 约等于 `$100 / M characters`

来源：

- API Pricing  
  https://elevenlabs.io/pricing/api
- Pricing  
  https://elevenlabs.io/pricing

### 对项目的推断

如果目标是“做中文主链”，真正可比的通常不是它的最便宜低延迟档，而是 `Multilingual v2 / v3` 这类更像正式配音档的能力。  
在这个口径下，它和 `MiniMax HD` 已经接近同价位。

所以对当前项目更合理的使用姿势是：

- 把 `ElevenLabs` 当作高质量对照组
- 用它验证“听感上限是否显著高于 MiniMax”
- 不建议直接默认它就是最优主链

### 本项目评分

- 中文自然度：`8.7/10`
- 情绪表现：`8.8/10`
- 工程可用性：`8.4/10`
- 成本可控性：`6.8/10`
- 综合推荐度：`8.0/10`

## 3. Cartesia

### 适配度判断

非常强，但更适合实时 voice-agent，不是当前中文漫剧主链的第一优先。

原因：

- 官方产品定位极其鲜明，核心卖点是 `90ms` 首音延迟和实时 voice AI
- 官方支持中文
- 对于交互式、实时式、电话式场景，它非常有竞争力
- 但当前项目是“短剧成片配音”，不是实时通话系统

### 官方信息

Cartesia 官方定价页显示：

- `Pro` 为 `$4 / month`，含 `100K credits`
- `Startup` 为 `$39 / month`，含 `1.25M credits`
- `Scale` 为 `$239 / month`，含 `8M credits`
- Sonic Text-to-Speech 的计费规则是 `1 credit per character`
- 官方强调 `Sonic-3` 的 `time-to-first-audio` 为 `90ms`
- 官方文档显示 `Sonic-3` 支持 `Chinese (zh)` 在内的多语言

按 TTS 纯字符换算，推导值约为：

- `Pro`：约 `$40 / M characters`
- `Startup`：约 `$31.2 / M characters`
- `Scale`：约 `$29.9 / M characters`

这里是基于“1 credit = 1 character”的官方计费规则做的推算。

来源：

- Pricing  
  https://cartesia.ai/pricing
- Sonic-3 模型文档  
  https://docs.cartesia.ai/build-with-cartesia/models/tts

### 对项目的推断

它的纸面价格很好，实时指标也非常强。  
但对当前项目来说，最关键的问题不是“能不能很快说出来”，而是：

- 中文台词是否像短剧
- 长段对白是否稳定
- 情绪是否自然
- 多角色是否容易做资产化管理

在这些维度上，Cartesia 很值得测，但不应优先于 MiniMax。

### 本项目评分

- 中文自然度：`7.8/10`
- 情绪表现：`7.6/10`
- 工程可用性：`8.3/10`
- 成本可控性：`8.9/10`
- 综合推荐度：`7.9/10`

## 推荐决策

## 决策 A：当前项目主链

推荐：

- `MiniMax Speech`

不推荐当前直接作为主链：

- `ElevenLabs`
- `Cartesia`

## 决策 B：对照测试

推荐：

- `MiniMax Speech` vs `ElevenLabs`

不优先推荐：

- `MiniMax Speech` vs `Cartesia`

原因：

- 你当前主要问题是“成片配音不好听”
- 最需要验证的是“中文听感上限”
- ElevenLabs 更适合当“高自然度上限对照”

## 决策 C：后续扩展

如果后面项目要做：

- 实时语音导演
- 交互式对话角色
- 低延迟 voice agent

那时优先补接：

- `Cartesia`

## 建议落地路线

### 第一阶段

目标：

- 先验证主链替代价值

执行：

1. 保留当前 TTS 抽象层
2. 新增 `MiniMax TTS Provider`
3. 新增 `ElevenLabs TTS Provider`
4. 选 20 条典型中文短剧台词做盲听 A/B

### 第二阶段

目标：

- 决定正式主链

执行：

1. 如果 `MiniMax` 听感接近或优于 `ElevenLabs`，直接定为主链
2. 如果 `ElevenLabs` 显著更强，再决定是否让它承担主角 / 旁白高质量链

### 第三阶段

目标：

- 做角色分层

执行：

1. 默认角色走 `MiniMax Turbo`
2. 主角与旁白走 `MiniMax HD` 或 `ElevenLabs`
3. 实时交互能力再补 `Cartesia`

## 最终建议

一句话结论：

- 对当前中文漫剧项目，`MiniMax Speech` 是最值得先接的主链方案
- `ElevenLabs` 最适合做高自然度对照组
- `Cartesia` 更适合未来实时 voice-agent 化，不是当前主链首选

如果必须给一句最明确的执行建议：

1. 先接 `MiniMax Speech`
2. 同时接 `ElevenLabs` 做听感对照
3. 暂不把 `Cartesia` 放到第一优先级

## 备注

本结论基于 2026-04-15 官方公开文档与定价页整理。  
其中关于“中文短剧听感是否更优”的部分属于基于产品定位、能力说明和成本结构的工程判断，不是已经完成项目内盲测后的最终结论。  
因此，最稳妥的下一步仍然是：尽快在当前项目里做一轮标准化 A/B 试听。
