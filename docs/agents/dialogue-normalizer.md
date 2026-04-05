# Dialogue Normalizer

本文档基于 `src/agents/dialogueNormalizer.js`。

## 负责什么

`Dialogue Normalizer` 是进入 TTS 主链前的轻量标准化层，负责把对白从“原始剧本字段”变成“可稳定投喂 TTS 的输入”。

## 入口函数

- `normalizeDialogueShots(shots, options)`
- `normalizeDialogueText(text, options)`
- `splitDialogueSegments(text, options)`
- `estimateDialogueDurationMs(text, options)`

## 输入

- `shots`
- 可选 `options`：
  - `pronunciationLexicon`
  - `maxSegmentLength`
  - `charactersPerSecond`
  - `punctuationPauseMs`
  - `artifactContext`

## 输出

每条 `shot` 会补出：

- `dialogueOriginal`
- `dialogue`
- `dialogueSegments`
- `dialogueDurationMs`

## 当前规则

- 统一空白和换行
- 按发音词典做替换
- 按句号、问号、感叹号、分号切分语段
- 超长句会按长度继续切段
- 依据字符数与标点停顿估算对白时长预算

## 当前可审计产物

当前会复用 `07-tts-agent/` 的 artifact 目录写入：

- `0-inputs/dialogue-normalized.json`
- `0-inputs/pronunciation-lexicon.json`
- `1-outputs/tts-segments.json`
- `1-outputs/dialogue-normalized.md`

## 不负责的内容

- 不做声线选择
- 不调用 TTS provider
- 不做 ASR 校验
- 不做口型生成

## 相关文档

- [TTS Agent](tts-agent.md)
- [TTS QA Agent](tts-qa-agent.md)
- [Agent 输入输出关系图](agent-io-map.md)
