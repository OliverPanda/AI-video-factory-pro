# 配音 Agent（TTS）

本文档基于 [src/agents/ttsAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/ttsAgent.js)、[src/agents/dialogueNormalizer.js](/d:/My-Project/AI-video-factory-pro/src/agents/dialogueNormalizer.js)、[src/agents/ttsQaAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/ttsQaAgent.js) 和 [src/agents/lipsyncAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/lipsyncAgent.js)，描述当前实现里配音链路如何标准化对白、解析 speaker、选择 voice cast / voice preset、批量合成对白音频，并在合成后做最小自动验收与按需口型同步。

## 负责什么

1. 为有台词的分镜批量生成音频文件。
2. 在 TTS 前统一对白文本、切分片段并估算 `dialogueDurationMs`。
3. 根据 `ShotCharacter / shot.speaker / characters` 解析真正说话者。
4. 按 `voice-cast > voicePresetId > gender fallback` 的优先级确定 TTS 参数。
5. 输出音频索引、声线解析表、失败证据与指标。
6. 在配音后执行最小 TTS QA，给出 `pass / warn / block`。
7. 对 close-up / `visualSpeechRequired` 镜头按需生成 lip-sync 片段，并把结果交给视频合成优先使用。

## 入口函数

- `generateAllAudio(shots, characterRegistry, audioDir, options)`
- `normalizeDialogueShots(shots, options)`
- `runTtsQa(shots, audioResults, voiceResolution, options)`
- `runLipsync(shots, imageResults, audioResults, options)`

## 输入

- `shots`
  - 典型字段有 `id`、`dialogue`、`speaker`、`characters`、`shotCharacters`
  - 进入 TTS 主链路前会补充 `dialogueOriginal`、`dialogueSegments`、`dialogueDurationMs`
- `characterRegistry`
  - 至少要能提供角色稳定 ID、`name` 和 `gender`
- `audioDir`
  - 音频落盘目录
- `options`
  - `projectId`
  - `voiceCast`
  - `voicePresetLoader`
  - `textToSpeech`
  - `artifactContext`

## 说话者解析优先级

当前实现的说话者解析顺序是：

1. `ShotCharacter.isSpeaker`
2. `shot.speaker`
3. 第一个参演角色

这套逻辑来自 [character-registry.md](character-registry.md) 中的 `resolveShotSpeaker(...)`。

身份绑定约束：

- `voiceCast` 的主绑定键应是 `characterId / episodeCharacterId / mainCharacterTemplateId`
- `displayName` 和 `name` 只能留作展示字段
- 不应再靠 `displayName` 或 `name` 把历史 voice cast 自动套到新角色上

## 对白标准化

当前在 Director 进入 TTS 前，会先跑一层轻量 `dialogueNormalizer`：

1. 清理多余空白与换行
2. 应用项目级 `pronunciationLexicon`
3. 进行句级切分，生成 `dialogueSegments`
4. 估算 `dialogueDurationMs`

这层现在还不是完整的 ASR/韵律工程，但已经把“时长预算”和“标准化输入”从 QA 后验判断，前移成了正式输入产物。

项目级读音词典默认放在：

- `temp/projects/<projectId>/pronunciation-lexicon.json`

结构示例：

```json
[
  { "source": "AI", "target": "A I" },
  { "source": "TTS", "target": "T T S" }
]
```

## 声线解析优先级

当前实现的声线解析顺序是：

1. `voiceCast[].voiceProfile`
2. `speakerCard.voicePresetId + voicePresetLoader`
3. 如果 preset 加载失败，回退到 `gender`
4. 如果没有 speaker，也会兜底为 `female`

也就是：

- 项目级角色差异优先来自 `voice-cast.json`
- `voicePresetId` 仍然有效，但优先级低于 `voiceCast`
- `.env` 里的默认男女声只做最终兜底

Director 在第一次进入 TTS 时会先把当前角色表绑定成项目级 `voice-cast.json`，之后同一项目会直接复用这份绑定结果，不再重新挑声。

当前推荐把 `voice-cast.json` 理解成“项目级一次绑定，后续永久复用”的角色声音资产表；它的复用前提不是名字一样，而是角色 ID 一致。

`voiceCast` 的典型结构：

```json
[
  {
    "characterId": "ep-hero",
    "displayName": "沈清",
    "voiceProfile": {
      "provider": "fish-speech",
      "voice": "shenqing_v1",
      "rate": 42,
      "pitch": 60
    }
  }
]
```

如果角色走 `MiniMax`，推荐至少把 `provider` 和 `voice` 显式写进 `voiceProfile`：

```json
[
  {
    "characterId": "ep-hero",
    "displayName": "沈清",
    "voiceProfile": {
      "provider": "minimax",
      "voice": "Warm_Girl",
      "rate": 1.05,
      "pitch": 0,
      "volume": 1
    }
  }
]
```

如果角色走 `CosyVoice zero_shot`，则可以把参考音频和提示词也放进 `voiceProfile`：

```json
[
  {
    "characterId": "ep-hero",
    "displayName": "沈清",
    "voiceProfile": {
      "provider": "cosyvoice",
      "mode": "zero_shot",
      "voice": "shenqing_zero",
      "referenceAudio": "assets/voices/shenqing_ref.wav",
      "promptText": "你好，我是沈清。",
      "zeroShotSpeakerId": "shenqing-demo"
    }
  }
]
```

如果角色走 `Fish Speech`，则可以用预存参考音色或直接上传参考音频：

```json
[
  {
    "characterId": "ep-hero",
    "displayName": "沈清",
    "voiceProfile": {
      "provider": "fish-speech",
      "referenceId": "shenqing-reference",
      "referenceAudio": "assets/voices/shenqing_ref.wav",
      "referenceText": "你好，我是沈清。"
    }
  }
]
```

## Provider 路由现状

当前 `textToSpeech(...)` 已经从单文件实现改成 provider router。

其中 `openai_compat` 是项目内统一的 TTS 合同入口，用来把上层参数稳定下来，再由 `TTS_TRANSPORT_PROVIDER` 映射到具体供应商。

### 怎么用

默认情况直接用 MiniMax：

```bash
TTS_PROVIDER=minimax
TTS_TRANSPORT_PROVIDER=minimax
```

如果想把上层固定成统一合同，再随时切供应商：

```bash
TTS_PROVIDER=openai_compat
TTS_TRANSPORT_PROVIDER=minimax
```

后面只要把 `TTS_TRANSPORT_PROVIDER` 改成别的已接入供应商即可，比如：

```bash
TTS_TRANSPORT_PROVIDER=xfyun
TTS_TRANSPORT_PROVIDER=cosyvoice
TTS_TRANSPORT_PROVIDER=fish-speech
```

### 怎么切换

1. 只换供应商，不想改业务代码时，优先改 `TTS_TRANSPORT_PROVIDER`。
2. 如果你想让上层永远走统一合同，改 `TTS_PROVIDER=openai_compat`。
3. 如果你就是想直接指定某个供应商，也可以继续把 `TTS_PROVIDER` 设成 `minimax / xfyun / cosyvoice / fish-speech`。
4. 角色声线优先还是 `voiceCast -> voicePresetId -> gender fallback`，和 provider 切换是两层事。

当前默认主链：

- `minimax`

- 已接入：`minimax`、`xfyun`、`cosyvoice`、`fish-speech`、`mock`
- 已预留插槽：`tencent`、`volcengine`

其中：

- `minimax`
  - 当前默认云端主实现
  - 按官方 `POST /v1/t2a_v2` HTTP 形态接入
  - 返回 `data.audio` 十六进制音频并直接落盘
  - 推荐优先通过 `voiceProfile.provider + voiceProfile.voice` 管理角色声线
- `xfyun`
  - 仅保留历史兼容
- `cosyvoice`
  - 当前已按官方 `runtime/python/fastapi` 形态接入最小可用版
  - 支持 `sft`
  - 支持带 `referenceAudio` 的 `zero_shot`
- `fish-speech`
  - 当前已按官方 `POST /v1/tts` HTTP 形态接入最小可用版
  - 支持 `text`
  - 支持 `reference_id`
  - 支持 `reference_audio + reference_text`
- `tencent / volcengine`
  - 仍是保留插槽

这些未接入 provider 现在会显式抛出“尚未接入”的错误，而不是悄悄退回默认逻辑；这样后续逐个 provider 真接入时更容易做验证和回归。

## 输出

返回数组，单项通常包含：

- `shotId`
- `audioPath`
- `hasDialogue`
- `error`

同时内部还会构建 `voiceResolution`，用于审计和排查。当前每条 `voiceResolution` 里还会额外记录：

- `voiceSource`
  - `voice_cast | voice_preset | gender_fallback | none`
- `usedDefaultVoiceFallback`
- `voicePresetId`

`runLipsync(...)` 目前返回：

- `clips`
  - 已成功生成并带 `videoPath` 的镜头片段
- `report`
  - 汇总 triggered / generated / failed / skipped
- `results`
  - 全量镜头级执行明细

## 可审计成果物

### TTS Agent

传入 `artifactContext` 时，[src/agents/ttsAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/ttsAgent.js) 会落这些文件：

- `0-inputs/dialogue-normalized.json`
- `0-inputs/pronunciation-lexicon.json`
- `0-inputs/voice-resolution.json`
- `1-outputs/audio.index.json`
- `1-outputs/tts-segments.json`
- `1-outputs/dialogue-normalized.md`
- `1-outputs/dialogue-table.md`
- `2-metrics/tts-metrics.json`
- `3-errors/<shotId>-error.json`
- `manifest.json`

其中：

- `voice-resolution.json`
  - 最重要
  - 能看出每个镜头最终用了谁说、什么性别、哪个 voice preset、是否走默认兜底
- `dialogue-normalized.json`
  - 记录标准化后的对白文本、切分片段和时长预算
- `audio.index.json`
  - 记录生成结果索引
- `dialogue-table.md`
  - 适合人工快速核对角色、对白和声线

### TTS QA Agent

[src/agents/ttsQaAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/ttsQaAgent.js) 会额外落这些文件：

- `2-metrics/tts-qa.json`
- `2-metrics/asr-report.json`
- `1-outputs/voice-cast-report.md`
- `manifest.json`

其中：

- `tts-qa.json`
  - 汇总 `pass / warn / block`
  - 记录 blockers、warnings、duration budget 命中率、fallback 数量
- `asr-report.json`
  - 记录每个镜头的期望文本、ASR transcript、字符错误率和状态
- `voice-cast-report.md`
  - 适合人工快速抽查 speaker、voice source、provider、fallback 和时长偏差

### Lip-sync Agent

[src/agents/lipsyncAgent.js](/d:/My-Project/AI-video-factory-pro/src/agents/lipsyncAgent.js) 当前会额外落这些文件：

- `1-outputs/lipsync.index.json`
- `1-outputs/lipsync-report.md`
- `2-metrics/lipsync-report.json`
- `3-errors/<shotId>-lipsync-error.json`
- `manifest.json`

其中 `manifest.json` 现在会额外带出：

- `triggeredCount`
- `generatedCount`
- `failedCount`
- `skippedCount`
- `downgradedCount`
- `fallbackCount`
- `fallbackShots`
- `manualReviewCount`
- `manualReviewShots`

这样在 run package 里先看 manifest，就能快速知道这一轮 lip-sync 是否真正触发、有没有发生 provider fallback，以及还有多少镜头需要人工抽查。

当前触发规则是：

- `visualSpeechRequired === true`
- `isCloseUp === true`
- `camera_type / cameraType` 命中 `特写 / 近景 / 中景 / close-up / medium`

当前 agent 只负责“是否触发、是否成功、证据怎么落盘”。默认情况下它会调用 [lipsyncApi.js](/d:/My-Project/AI-video-factory-pro/src/apis/lipsyncApi.js) 做 provider routing；如果测试或特殊流程需要，也仍然可以通过 `generateLipsyncClip(...)` 覆盖默认实现。

当前 `lipsyncApi` 路由状态：

- 已接入：`mock`
- 已预留：`funcineforge`
- 已显式占位：`runway`

其中 `funcineforge` 现在已经支持正式 HTTP 调用、超时控制、有限重试和错误分类；同时 `lipsyncApi` 也支持 provider chain，会按：

1. `LIPSYNC_PROVIDER`
2. `LIPSYNC_FALLBACK_PROVIDERS`

依次尝试。如果主 provider 失败，会自动切换到下一个 fallback provider，并把命中情况写进执行结果和交付摘要。

相关环境变量：

- `LIPSYNC_PROVIDER`
- `LIPSYNC_FALLBACK_PROVIDERS`
- `FUNCINEFORGE_TIMEOUT_MS`
- `FUNCINEFORGE_MAX_RETRIES`
- `FUNCINEFORGE_RETRY_DELAY_MS`

## 当前 metrics

### TTS 合成 metrics

- `dialogue_shot_count`
- `synthesized_count`
- `skipped_count`
- `failure_count`
- `default_voice_fallback_count`
- `unique_voice_count`
- `voice_usage`

这些指标已经足够回答几个关键问题：

- 有多少镜头真的合成了声音
- 有多少镜头只是因为没台词被跳过
- 默认兜底用了多少次
- 当前这集到底用到了哪些声线

### TTS QA metrics

- `status`
- `blockers`
- `warnings`
- `dialogueShotCount`
- `fallbackCount`
- `fallbackRate`
- `budgetCheckedCount`
- `budgetPassingCount`
- `budgetPassRate`
- `asrReport`

另外，当前 QA 还会额外检查同一 `speakerName` 是否跨镜头切到了不同 `provider:voice` 指纹；一旦发现音色漂移，会直接记 `warn`。

### Lip-sync metrics

- `status`
- `triggeredCount`
- `generatedCount`
- `failedCount`
- `skippedCount`
- `downgradedCount`
- `fallbackCount`
- `fallbackShots`
- `manualReviewCount`
- `manualReviewShots`
- `blockers`
- `warnings`
- `entries`

这些指标主要回答：

- 这一集有多少镜头真的值得做 lip-sync
- 口型链路成功率如何
- 哪些镜头失败后已经自动降级回普通合成

当前每个镜头级 `entry` 还会补充：

- `shotScale`
  - `close_up | medium | other`
- `triggerReasons`
  - 例如 `close_up`、`visual_speech_required`
- `qaStatus`
  - `pass | warn | block`
- `qaWarnings`
- `qaBlockers`
- `manualReviewRequired`
- `downgradeApplied`
- `downgradeReason`
- `timingOffsetMs`
- `evaluator`
- `provider`
- `attemptedProviders`
- `fallbackApplied`
- `fallbackFrom`

当前判定策略是：

- close-up / 人工强制口型镜头失败时，直接记 `block`
- 非关键镜头 lip-sync 失败时，允许降级回普通合成并记 `warn`
- close-up 镜头如果已有 `timingOffsetMs`，默认按 `60ms` 门槛判定
- 中近景镜头如果已有 `timingOffsetMs`，默认按 `80ms` 门槛判定
- 没有稳定 evaluator 时，close-up / 关键镜头会被标记 `manualReviewRequired`
- 主 lip-sync provider 失败但 fallback provider 成功时，镜头仍可继续交付，但会保留 fallback 命中痕迹用于审计
- 只有 `timeout / network_error / provider_5xx` 这类可重试错误才会切到下一个 fallback provider
- `provider_4xx / invalid_response` 默认视为非可恢复错误，不继续切 fallback，直接保留失败证据

## ASR 回写现状

当前 QA 已支持注入 `transcribeAudio(...)` 做语音回写，并会产出 `asr-report.json`。

- 已接入：`mock`
- 已预留插槽：`openai`、`xfyun`

默认阈值：

- `CER > 3%` 记 `warn`
- `CER > 20%` 记 `block`

## 失败策略

当前实现里，每个镜头都通过 `ttsQueue + queueWithRetry(...)` 执行。

如果某镜头失败：

- 会自动重试 3 次
- 最终失败不会炸掉整批 Promise
- 会把该镜头标成 failed
- 错误详情落到 `3-errors/<shotId>-error.json`

这是和图像生成 Agent 一样的“保住整批结果”策略。

合成完成后，`runTtsQa(...)` 会继续判断是否允许进入视频合成：

- `pass`
  - 正常继续
- `warn`
  - 允许继续，但会把风险写入 QA 产物
- `block`
  - 由 Director 阻断后续交付

## 常见问题

### 为什么现在还保留 `voicePresetId`

因为它仍然是有效的项目级声音引用方式，尤其适合已有项目资产。但它现在不是最高优先级了。

### 为什么 `voice-cast.json` 要独立存在

因为 `.env` 适合放平台默认值，不适合表达项目内角色差异。真正的角色声线选择属于项目数据，不属于环境变量；而且 `voice-cast` 需要容纳 `provider / voice / rate / pitch` 这类项目级配置。

### 为什么 `voice-resolution.json` 要单独落盘

因为“到底是谁在说、用了什么声线、是不是走了默认兜底”是最难从最终 mp3 倒推出来的信息，必须显式保存。

### 为什么还要单独加一个 TTS QA Agent

因为“音频生成成功”不等于“可以交付”。至少还要判断：

- 有对白镜头是不是都真的有音频
- fallback 是不是过多
- 音频时长是不是明显超出镜头预算
- 是否应该阻断后续合成

### 这个 Agent 会不会决定字幕内容

不会。字幕文本来自镜头本身，最终字幕文件由 [video-composer.md](video-composer.md) 生成。

## 当前与视频合成的边界

- `lipsyncAgent`
  - 负责输出镜头级 lip-sync clip
- `videoComposer`
  - 负责在 `lipsync clip > animation clip > static image` 的优先级下选素材合成最终视频

也就是说，口型同步不是直接产出成片，而是给 `videoComposer` 提供一个更高优先级的视频来源。

## 不负责的内容

- 不负责角色模板生成
- 不负责图像和一致性检查
- 不负责视频合成

## 相关文档

- [角色设定 Agent（Character Registry）](character-registry.md)
- [导演 Agent 详细说明](director.md)
- [QA 验收 SOP](../sop/qa-acceptance.md)
- [合成 Agent（Video Composer）](video-composer.md)
