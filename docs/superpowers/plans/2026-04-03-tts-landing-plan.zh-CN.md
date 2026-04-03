# AI 漫剧 TTS 最新落地方案（2026-04）

这份文档不是行业软文，也不是平台推荐清单。

它的目标只有一个：把用户提供的两份外部文档，审核后沉淀成适合当前仓库执行的 TTS / 配音 / 口型同步落地方案，并明确输入输出、验收标准和 SOP。

适用范围：

- 当前仓库 `AI-video-factory-pro`
- 中文 AI 漫剧、条漫动态视频、角色对白驱动短视频
- 以“镜头级可审计生产”而不是“一键生成成片”为目标

## 1. 审核结论

### 1.1 两份源文档里可保留的部分

- 都正确识别了核心问题不是“能不能出声”，而是“角色一致性、情绪表达、时长控制、口型同步、批量生产稳定性”。
- 都强调了分阶段选型，这一点是对的。TTS 方案不能只看单模型效果，还要看团队阶段、SLA、成本和自动化程度。
- 都提到了长文本需要切分、分段生成、再拼接，这一点符合主流生产实践。
- 都把口型同步单独拿出来讨论，这比只做“文字转语音”更接近真实漫剧生产。

### 1.2 两份源文档里需要降权或剔除的部分

- 大量数据来自二手媒体、营销稿、聚合站和百科式站点，不能作为技术决策主依据。
- 部分平台技术细节写得过满，例如直接给出底层架构、精度数值、内部实现方式，但缺少官方技术披露支撑，应该视为推测，不应写进正式方案。
- 平台对比偏“产品导购”，不够贴合当前仓库。当前项目真正需要的是可编排、可替换、可验收的工程方案，而不是单个平台介绍。
- 文档把“TTS、配音、视频译制、口型同步、视频生成”混在一起。工程上这四层必须拆开，否则很难稳定落地。

### 1.3 本次重写后的判断

对当前仓库，最新最佳方案不是“只押一个平台”，而是：

- 角色语音层：本地开源主力 + 云端商用兜底
- 口型层：镜头级按需触发，不把每个镜头都强行做 lip-sync
- 编排层：沿用仓库现有 Director/Agent 审计体系
- QA 层：新增自动验收规则，避免只凭人工听感签收

## 2. 2026 推荐技术路线

## 2.1 先给结论

面向这个仓库，我建议采用下面这套组合：

- 文本与角色编排：保留现有 `scriptParser + characterRegistry + director`
- 主力中文 TTS：新增本地开源 provider，优先接 `CosyVoice` 或 `Fish Speech`
- 商用稳定兜底：保留现有讯飞，同时预留火山或腾讯云 provider 插槽
- 镜头级配音/口型：引入 `Fun-CineForge` 作为高价值镜头的 dubbing / lip-sync 路由
- 自动质检：补一层 `ASR + 时长预算 + speaker consistency + close-up lip-sync` 的 QA

一句话概括：

`TTS 先稳定，口型再精修；先把角色音色资产化，再做镜头级 lip-sync；开源做主力，商用做兜底。`

## 2.2 为什么不是继续单一讯飞方案

当前仓库的 TTS 已经有三个优点：

- 有独立 `ttsAgent`
- 有 `voicePreset` 机制
- 有可审计产物和失败证据

但它还有四个明显短板：

- 只有单一 provider
- 默认兜底还停留在 `gender -> voice`
- 没有时长预算控制
- 没有自动语音 QA，更没有镜头级口型决策

这意味着它适合“先出音频”，但还不适合“稳定交付漫剧成片”。

## 2.3 推荐分层架构

建议把现有 TTS 能力升级为四层：

### A. 文本标准化层

职责：

- 统一标点、停顿、数字读法、英文缩写读法、专有名词读法
- 为台词补充 `emotion / intensity / pause / speakingRate`
- 输出镜头级 `dialogue units`

推荐新增产物：

- `0-inputs/dialogue-normalized.json`
- `0-inputs/pronunciation-lexicon.json`

### B. 角色音色层

职责：

- 用项目级资产定义“这个角色该怎么说话”
- 不再靠男女默认值做主逻辑

推荐新增项目资产：

```json
{
  "characterId": "episode_char_001",
  "displayName": "沈清",
  "voiceProfile": {
    "provider": "cosyvoice",
    "voiceId": "shenqing_v1",
    "referenceAudio": "assets/voices/shenqing_ref.wav",
    "speakingRate": 0.98,
    "pitch": -1,
    "styleTags": ["冷静", "压抑", "锋利"],
    "fallbackProvider": "xfyun",
    "fallbackVoice": "x4_lingxiaoxuan_or_equivalent"
  }
}
```

推荐文件名：

- `temp/projects/<projectId>/voice-cast.json`

### C. 合成执行层

职责：

- 根据镜头类型选择合成策略

建议决策树：

1. 无正脸或无说话镜头：
   只做 TTS，不做 lip-sync
2. 条漫静帧、嘴部不显著：
   TTS + 字幕 + 简单位移/镜头动画
3. 中近景对白镜头，嘴部可见：
   TTS 后进入 `Fun-CineForge` 或同类 dubbing / lip-sync 路由
4. 高价值特写镜头：
   强制 lip-sync，并进入更严格 QA

### D. 质量验收层

职责：

- 不是“听起来差不多”就通过
- 要自动出结论：`pass / warn / block`

推荐新增产物：

- `2-metrics/tts-qa.json`
- `2-metrics/asr-report.json`
- `2-metrics/lipsync-report.json`
- `1-outputs/voice-cast-report.md`

## 3. 最新选型建议

## 3.1 开源主力

### 方案 A：CosyVoice

适合：

- 中文主场景
- 零样本或小样本角色音色生成
- 追求本地部署和低接入成本

推荐理由：

- 开源生态成熟
- 中文自然度普遍稳定
- 很适合作为项目默认 TTS 主力

落地角色：

- 本地主合成
- 角色 voice preset 的核心 provider

### 方案 B：Fish Speech

适合：

- 更强调情绪、表现力、声线辨识度
- 关键角色或高情绪台词

推荐理由：

- 在角色化表达上通常更激进
- 更适合“有戏感”的句子，而不只是播报式合成

落地角色：

- 关键镜头
- 主角高情绪台词
- 需要参考音频复刻的场景

## 3.2 影视级配音 / 口型同步

### 方案 C：Fun-CineForge

这是本次方案里最值得引入的新能力。

原因不是它“最火”，而是它正好解决了漫剧配音最难的那部分：

- 多说话人场景
- 独白、旁白、对白混合
- 人脸不一直可见时的时间对齐
- 配音和唇形不是只看局部嘴唇，而是看场景级多模态信号

在当前仓库里的正确用法不是“替换所有 TTS”，而是：

- 作为镜头级 dubbing / lip-sync 专项能力
- 重点处理高价值对白镜头
- 和基础 TTS 分层，而不是混成一个 provider

## 3.3 商用兜底

### 方案 D：保留讯飞，新增火山或腾讯云插槽

适合：

- 高并发生产
- API SLA 要求明确
- 需要云端回调、审计、权限和费用归集

为什么还要保留商用：

- 开源模型强在可控与成本
- 商用平台强在稳定性、并发、回调和交付责任

所以最佳实践不是“开源替代商用”，而是：

- 开源跑主链路
- 商用兜底失败镜头和高峰流量

## 4. 对当前仓库的正式落地方案

## 4.1 目标架构

建议在当前仓库上演进为：

```text
scriptParser
  -> characterRegistry
  -> voiceCastResolver               新增
  -> dialogueNormalizer              新增
  -> ttsAgent(provider-routed)       增强
  -> lipsyncAgent(optional)          新增
  -> ttsQaAgent                      新增
  -> videoComposer
```

建议的新增模块：

- `src/agents/voiceCastResolver.js`
- `src/agents/dialogueNormalizer.js`
- `src/agents/lipsyncAgent.js`
- `src/agents/ttsQaAgent.js`
- `src/apis/providers/cosyvoiceApi.js`
- `src/apis/providers/fishSpeechApi.js`
- `src/apis/providers/tencentTtsApi.js`
- `src/apis/providers/volcengineTtsApi.js`

现有模块建议调整：

- [src/agents/ttsAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/ttsAgent.js)
  从“gender fallback 合成器”升级为“provider-routed shot synthesizer”
- [src/apis/ttsApi.js](/d:/My-Project/AI-video-factory-pro/src/apis/ttsApi.js)
  从单一讯飞封装改成统一 provider 入口
- [docs/agents/tts-agent.md](/d:/My-Project/AI-video-factory-pro/docs/agents/tts-agent.md)
  后续需要同步更新为多 provider 版本

## 4.2 输入

一轮分集运行，TTS 子系统的最小输入应该是：

### 结构化输入

- `projectId / scriptId / episodeId`
- `shots[]`
- `characterRegistry[]`
- `voice-cast.json`

### 每镜头输入字段

- `shot.id`
- `shot.dialogue`
- `shot.speaker`
- `shot.duration`
- `shot.emotion`
- `shot.characters`
- `shot.camera_type`
- `shot.isCloseUp` 或可由镜头类型推导
- `shot.visualSpeechRequired`

### 角色输入字段

- `voiceProfile.provider`
- `voiceProfile.voiceId`
- `voiceProfile.referenceAudio`
- `voiceProfile.styleTags`
- `voiceProfile.rateRange`
- `voiceProfile.pitchRange`

## 4.3 输出

建议把输出拆成 5 类：

### 1. 合成产物

- `audio/<shotId>.wav` 或 `.mp3`
- `lipsync/<shotId>.mp4`

### 2. 结构化清单

- `voice-resolution.json`
- `dialogue-normalized.json`
- `tts-segments.json`
- `voice-cast-report.json`

### 3. QA 报告

- `tts-qa.json`
- `asr-report.json`
- `lipsync-report.json`

### 4. 人工抽查报表

- `dialogue-table.md`
- `voice-cast-report.md`

### 5. 失败证据

- `3-errors/<shotId>-tts-error.json`
- `3-errors/<shotId>-lipsync-error.json`
- `3-errors/<shotId>-qa-error.json`

## 5. 镜头级执行策略

## 5.1 台词切分规则

默认不要把一个长对白整段直接送入合成。

建议规则：

- 单段台词控制在 2 秒到 12 秒
- 中文单段建议不超过 120 字
- 超过 12 秒时强制切分
- 超过镜头时长 85% 时进入时长预警

补充说明：

- 商用云平台对长文本通常也建议切分后再拼接
- 这不是 provider 限制，而是稳定性和可控性要求

## 5.2 provider 路由规则

默认路由建议：

1. 普通对白：
   `CosyVoice`
2. 主角高情绪句：
   `Fish Speech`
3. 对外稳定交付或本地失败：
   `讯飞 / 火山 / 腾讯云`
4. 需要口型：
   `TTS -> Fun-CineForge`

## 5.3 口型触发规则

只有命中下面条件之一，才进入 lip-sync：

- 角色正脸出镜
- 台词对应镜头是中近景或特写
- 该镜头是剧情关键镜头
- 人工标记 `visualSpeechRequired=true`

不满足时，直接：

- TTS
- 字幕
- 视频合成

这样做的原因很简单：

- 不是所有镜头都值得做 lip-sync
- 漫剧生产里，真正影响观感的是关键台词镜头
- 把资源集中在关键镜头，性价比更高

## 6. 验收标准

这部分是本次方案最重要的内容之一。

## 6.1 `pass / warn / block`

沿用现有 QA 语义：

- `pass`：满足交付
- `warn`：可交付但需留证据
- `block`：阻断交付

## 6.2 TTS 硬门槛

下面条件全部满足，TTS 才能算 `pass`：

- 有对白镜头的 `audioPath` 生成成功率 = 100%
- 主角色音色绑定命中率 = 100%
- 非主角色音色绑定命中率 >= 95%
- 单镜头音频时长偏差：
  `abs(audioDuration - shotDialogueBudget) <= 300ms` 的镜头占比 >= 90%
- 不允许出现明显削波、空文件、全静音文件
- 自动 ASR 回写后，文本字符错误率建议 <= 3%

如果出现下面情况，至少记 `warn`：

- 使用了默认 voice fallback
- 单角色跨镜头音色漂移明显
- 语速为塞进镜头而被极端拉伸

出现下面情况直接 `block`：

- 有对白镜头音频缺失
- 说话者明显错配
- 主角出现跨镜头严重换声
- 文本内容与原对白明显不一致

## 6.3 Lip-sync 硬门槛

对触发 lip-sync 的镜头：

- 特写镜头音画偏移建议 <= 60ms
- 中近景镜头音画偏移建议 <= 80ms
- 关键 close-up 镜头不允许肉眼可见明显“嘴先动/声先出”
- 人脸不可见镜头只校验时间对齐，不强求嘴型

如果项目后续接入自动 lipsync evaluator：

- 可以引入 `LSE-D / LSE-C / Timing Offset`
- 当前阶段没有稳定 evaluator 时，可先保留人工抽查 + 关键镜头强检

## 6.4 人工抽查最小样本

每一集至少抽查：

- 主角 5 个镜头
- 配角 3 个镜头
- 高情绪台词 2 个镜头
- 所有 close-up 口型镜头

人工抽查结论要写入：

- `delivery-summary.md`
- `tts-qa.json`

## 7. 标准 SOP

## 7.1 资产准备

1. 维护 `characterRegistry`
2. 为核心角色建立 `voice-cast.json`
3. 为主角准备 10 到 30 秒干净参考音频
4. 为专有名词维护 `pronunciation-lexicon.json`

## 7.2 文本标准化

1. 统一数字、英文缩写、专名读法
2. 为每条台词补充情绪标签
3. 计算镜头可用时长预算
4. 对超长台词自动切分

## 7.3 初次合成

1. 按 provider 路由执行 TTS
2. 落盘音频和 `voice-resolution.json`
3. 记录是否命中 fallback

## 7.4 自动 QA

1. 计算音频时长
2. 跑 ASR 回写比对
3. 计算角色音色一致性
4. 标记 `pass / warn / block`

## 7.5 口型处理

1. 识别需要 lip-sync 的镜头
2. 对命中镜头调用 dubbing / lip-sync 路由
3. 落盘 `lipsync-report.json`

## 7.6 合成与交付

1. 非 lip-sync 镜头走原 `videoComposer`
2. lip-sync 镜头优先使用新视频片段
3. 输出 `final-video.mp4`
4. 汇总 `delivery-summary.md`

## 7.7 失败回滚策略

如果某个 provider 失败，按以下顺序降级：

1. 同 provider 重试
2. 切换到商用 fallback provider
3. 关闭 lip-sync，仅保留 TTS + 字幕
4. 仍失败则标记 `block`

## 8. 分期实施建议

## 8.1 P0：两周内能落地的版本

目标：

- 不改整体 pipeline 结构
- 先把 TTS 从“单 provider”升级成“多 provider + 角色音色资产”

必须做：

- `voice-cast.json`
- `dialogueNormalizer`
- `ttsApi` provider 路由
- `ttsQaAgent`
- 新增 tests 覆盖 voice cast、fallback、duration budget

P0 完成后的效果：

- 角色不再主要靠性别选声音
- 音频长度和文本内容开始可控
- 产物更适合自动验收

## 8.2 P1：一月内的版本

目标：

- 增加镜头级 lip-sync

必须做：

- `lipsyncAgent`
- close-up 镜头识别
- `lipsync-report.json`
- 对 `videoComposer` 增加“优先使用 lipsync clip”逻辑

## 8.3 P2：工业化版本

目标：

- 大批量生产可控

必须做：

- 云端回调与任务队列
- provider 级限流与费用统计
- 关键镜头自动重试
- 角色声纹一致性长期监控

## 9. 对当前项目的具体建议

这部分是面向仓库维护者的直白结论。

### 9.1 应该立刻保留的

- 现有 `ttsAgent` 审计思路
- `voicePreset` 机制
- `3-errors/` 证据落盘
- `dialogue-table.md` 这类人工核对产物

### 9.2 应该立刻修改的

- 不要再让 `gender` 成为主逻辑
- 不要把单个 provider 写死在 `src/apis/ttsApi.js`
- 不要只生成音频，不验证文本与时长
- 不要默认所有镜头都配同等质量策略

### 9.3 本项目的最新最佳方案

如果只允许给一句最终建议，我会给这句：

`用 CosyVoice/Fish Speech 做主力角色 TTS，保留讯飞做商用兜底，用 Fun-CineForge 只打关键对白镜头，再用 ASR + duration budget + close-up 抽检做自动验收。`

这套方案比“全押某个平台”更稳，也比“继续单一讯飞 + 人工听感验收”更接近真正可规模化的漫剧生产。

## 10. 参考与依据

以下信息在本次重写时被用作高可信依据；其中“推荐架构”和“验收阈值”部分含工程推断成分，已基于当前仓库场景做适配。

- Fun-CineForge 官方页面：
  https://huggingface.co/FunAudioLLM/Fun-CineForge
- 腾讯云 MPS AI 配音官方文档：
  https://cloud.tencent.com/document/product/862/125405
- 火山引擎豆包语音声音复刻最佳实践：
  https://www.volcengine.com/docs/6561/1204182?lang=zh
- CosyVoice 官方仓库：
  https://github.com/FunAudioLLM/CosyVoice
- Fish Speech 官方仓库：
  https://github.com/fishaudio/fish-speech

其中可以直接指导本项目实现的关键信息包括：

- 腾讯云 MPS 的 AI 配音任务需要视频文件加字幕文件或 Speaker 文件输入，这说明“视频译制”和“普通 TTS”应在架构上分层。
- 火山引擎官方最佳实践明确建议长文本先切分再拼接，说明本项目应把台词切分作为标准步骤，而不是异常处理。
- Fun-CineForge 官方说明其适用于独白、旁白、对白和多说话人场景，并在 lip-sync、音质、音色过渡和指令遵循上优于已有方法，适合作为关键镜头的 dubbing / lip-sync 方案。
