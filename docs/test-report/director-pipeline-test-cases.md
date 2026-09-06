# Director Pipeline 超级详细测试用例

> 基于源码梳理，覆盖全部 29 个 stage、13 个 gate、6 类分支条件
> 生成时间：2026-09-05

---

## 一、测试环境

- 测试框架：Node.js 内置 `node:test`
- 断言库：`node:assert/strict`
- 运行命令：`NODE_TEST_CONTEXT=1 QUEUE_EXECUTION_POLICY=test node scripts/run-tests.js`
- Mock 方式：依赖注入（createDirector overrides）

---

## 二、核心流程测试（Happy Path）

### TC-01: 全流程端到端（mock provider）
- **文件**: `tests/director.project-run.test.js`
- **步骤**: load_assets → character_registry → ref_sheets → prompts → images → backfill → consistency → continuity → scene_grammar → director_packs → motion → performance → storyboard → video_clips → cost_governance → enhance → shot_qa → bridge → sequence → dialogue → audio → tts_qa → lipsync → cross_video → av_packaging → compose → post_compose → delivery → finish
- **验证**: 每个 stage 正确读写 ctx 属性，最终 outputPath 非空

### TC-02: Mastra workflow 集成
- **文件**: `tests/director.workflow-runtime.test.js`
- **步骤**: createEpisodePipelineWorkflow → runEpisodeViaWorkflow
- **验证**: workflow 返回 outputPath，run.status !== 'failed'

---

## 三、Gate 阻断测试

### TC-03: 剧本找不到
- **触发**: load_assets 阶段，`loadScript` 返回 null
- **期望**: throw `找不到剧本`
- **文件**: `tests/director.project-run.test.js`

### TC-04: 分集找不到
- **触发**: load_assets 阶段，`loadEpisode` 返回 null
- **期望**: throw `找不到分集`

### TC-05: 角色三视图生成失败
- **触发**: executeGenerateRefSheetsStage，`assertCharacterRefSheetsSucceeded` 检测到失败
- **期望**: throw `角色三视图生成失败`
- **文件**: `tests/characterAssetGovernance.test.js`

### TC-06: Preflight 硬伤阻断
- **触发**: director.js inline，`preflightQaReport.entries` 包含 `HARD_VISUAL_BLOCK_REASON_CODES`
- **期望**: throw `发现人体结构/参考图硬伤`
- **文件**: `tests/consistencyQaPolicy.test.js`

### TC-07: Shot QA 硬伤阻断
- **触发**: executeShotQaStage，`assertNoHardVisualBlocks` 检测到硬伤
- **期望**: throw 同 TC-06

### TC-08: 动态视频未全部生成
- **触发**: executeShotQaStage，`assertAllShotsHaveApprovedDynamicVideo` 检测
- **期望**: throw `动态视频未全部生成成功`

### TC-09: TTS QA 阻断
- **触发**: executeTtsQaStage，`qaResult.status === 'block'`
- **期望**: throw `TTS QA 阻断交付`

### TC-10: Lip-sync QA 阻断
- **触发**: executeLipsyncStage，`lipsyncReport.status === 'block'`
- **期望**: throw `Lip-sync QA 阻断交付`

### TC-11: Continuity Delivery Gate 阻断
- **触发**: executeComposeVideoStage，bridge/sequence QA 缺失
- **期望**: throw `Continuity delivery gate blocked`

### TC-12: Compose 阻断
- **触发**: executeComposeVideoStage，`composeResult.status === 'blocked'`
- **期望**: throw `Compose 阻断交付`

### TC-13: Seedance 推断过高阻断
- **触发**: executeDeliverySummaryStage，`shouldBlockFormalDeliveryForSeedanceInference` 返回 true
- **期望**: throw `Seedance 输入补全占比过高`

---

## 四、stopAt 短路测试

### TC-14: stopAfterRefSheets
- **触发**: options.stopAt = 'after_ref_sheets'
- **期望**: 执行到 ref_sheets 后停止，返回 `stopped_after_ref_sheets`
- **文件**: `tests/director.stopAt.test.js`

### TC-15: stopAfterImages
- **触发**: options.stopAt = 'after_images'
- **期望**: 执行到 image_backfill 后停止，返回 `stopped_after_images`

### TC-16: stopBeforeVideo
- **触发**: options.stopAt = 'before_video'
- **期望**: 执行到 preflight QA 后停止，返回 `stopped_before_video`

---

## 五、分支条件测试

### TC-17: 空分镜 → 重新解析剧本
- **触发**: `episode.shots.length === 0` 且 `deps.parseScript` 存在
- **期望**: 调用 parseScript 重建分镜

### TC-18: maxShots 抽样
- **触发**: `options.maxShots = 2`
- **期望**: shots 被截取为前 2 个

### TC-19: 一致性检查跳过
- **触发**: `options.skipConsistencyCheck = true`
- **期望**: consistency_check 阶段直接返回

### TC-20: 连贯性检查跳过
- **触发**: `options.skipContinuityCheck = true`
- **期望**: continuity_check 阶段直接返回

### TC-21: 音频缓存复用
- **触发**: 第二次运行，audioCacheKey 匹配
- **期望**: generate_audio 阶段复用缓存

### TC-22: Lipsync 缓存复用
- **触发**: 第二次运行，lipsyncCacheKey 匹配
- **期望**: lipsync 阶段复用缓存

### TC-23: 一致性重生成触发
- **触发**: consistencyCheckDone=false, needsRegeneration.length > 0
- **期望**: 自动调用 regenerateImage

---

## 六、错误处理测试

### TC-24: Provider 执行失败
- **触发**: video provider 返回 rejected promise
- **期望**: 错误被捕获，写入 lastError/failedAt

### TC-25: 一致性重生成失败
- **触发**: regenerateImage 返回 success=false
- **期望**: 单项失败被收集，不阻断整体

### TC-26: Mastra workflow step 失败
- **触发**: workflow step throw
- **期望**: run.status === 'failed'，错误被还原抛出

### TC-27: saveState 双写
- **触发**: 任何 stage 调用 saveState
- **期望**: state.json 和 state.snapshot.json 同时更新

---

## 七、输出验证测试

### TC-28: Pipeline Summary 指标
- **验证**: buildPipelineSummaryMetrics 所有字段正确填充

### TC-29: Delivery Summary 内容
- **验证**: createDeliverySummary 生成完整 markdown

### TC-30: QA Overview 聚合
- **验证**: collectRunQaOverview agent summaries 有序，pass/warn/block 计数正确

### TC-31: Debug Signals
- **验证**: buildRunDebugSignals stopStage/failedSteps/cachedSteps 准确

---

## 八、纯函数单元测试

### TC-32~TC-50: runtimeSupport.js 纯函数
- simplifyNormalizedShotsForCache
- simplifyVoiceCastForCache
- buildAudioResultsSignature
- buildVisualEligibilityReport
- buildUpstreamFailureInsights
- assertCharacterRefSheetsSucceeded
- mergeCharacterRefSheetResults
- normalizeStringList
- buildShotQaInputs
- buildBridgeClipBridge
- buildSequenceClipBridge
- filterBridgeClipsAgainstSequences
- assertContinuityDeliveryGate
- normalizeStopAt
- collectRunQaOverview
- buildPipelineSummaryMetrics
- createDeliverySummary
- buildRunDebugSignals
- normalizeComposeResult

---

## 九、测试执行记录

| 用例 | 状态 | 耗时 | 备注 |
|------|------|------|------|
| TC-01 | ⏳ | - | |
| TC-02 | ⏳ | - | |
| ... | ⏳ | - | |
