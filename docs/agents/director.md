# 导演 Agent（Director）

本文档基于 `src/agents/director.js`，描述当前项目中唯一 orchestrator 的真实职责。

## 负责什么

`Director` 当前负责四件事：

1. 兼容两种入口：
   - 直接传剧本文件
   - 指定 `projectId + scriptId + episodeId`
2. 串起完整生产链，并用 `state.json` 做缓存与断点续跑。
3. 维护 run package、run job、agent task run、QA overview 等可审计产物。
4. 在动态镜头、bridge shot、配音、口型、最终合成之间做统一桥接和交付决策。

另外它还负责守住一条很重要的工程约束：

- 角色、参考图、voice cast、sequence / bridge / shot 相关资产一律按稳定 ID 串联
- `name` 只能留在展示层、日志层和 prompt 文本层

## 入口函数

- `runEpisodePipeline({ projectId, scriptId, episodeId, options })`
- `runPipeline(scriptFilePath, options)`

其中：

- `runPipeline(...)` 是兼容模式入口，会先把 `.txt` 剧本桥接为临时 project/script/episode
- `runEpisodePipeline(...)` 是当前主入口

## 当前主流程

执行顺序与当前实现一致：

1. 读取 project / script / episode 或兼容模式脚本文件。
2. 初始化 `state.json`、run package、run job、artifact context。
3. 执行 `Script Parser -> Character Registry -> Character Ref Sheet Generator -> Prompt Engineer -> Image Generator`。
4. 执行 `Consistency Checker`，必要时按镜头重生成图片。
5. 执行 `Continuity Checker`。
6. 执行动态镜头主链：
   - `Motion Planner`
   - `Performance Planner`
   - `Video Router`
   - `Seedance Video Agent` 或 `Fallback Video Adapter`
   - `Motion Enhancer`
   - `Shot QA Agent`
7. 执行 bridge shot 子链：
   - `Bridge Shot Planner`
   - `Bridge Shot Router`
   - `Bridge Clip Generator`
   - `Bridge QA Agent`
8. 执行音频链：
   - `Dialogue Normalizer`
   - `TTS Agent`
   - `TTS QA Agent`
   - `Lip-sync Agent`
9. 组装 `videoClips / bridgeClips / animationClips / lipsyncClips`。
10. 调用 `Video Composer` 输出最终成片与 `delivery-summary.md`。

## 它真正桥接了什么

当前 `Director` 不是简单顺序调用，而是在几条链之间做协议桥接：

- 把兼容模式脚本桥接成临时 `project / script / episode`
- 把 `episodeCharacterId / id / mainCharacterTemplateId` 这些稳定身份继续往下游传，避免后续模块重新按 `name` 猜角色
- 把 `imageResults` 桥接成 `animationClips`
- 把通过 `Shot QA Agent` 的动态镜头桥接成 `videoClips`
- 把通过 `Bridge QA Agent` 的桥接片段桥接成 `bridgeClips`
- 把 `composeVideo(...)` 的结果标准化为 `composeResult`
- 把每个 agent 的 QA 摘要汇总成 run 根目录 `qa-overview`

同时它现在也负责视频 provider 选择：

- 默认 `Seedance Video Agent`
- `VIDEO_PROVIDER=fallback_video` 时切到用户侧的 `Fallback Video Adapter`
- 当前内部仍映射到 `sora2` runtime branch，以保持历史 run、缓存和 QA 总览兼容
- 如果 `shotPackages` 中同时存在不同 provider，`Director` 会按真实路由结果分别调用并合并结果

## 关键输入

- 兼容模式：
  - `scriptFilePath`
- 项目模式：
  - `projectId`
  - `scriptId`
  - `episodeId`
- 常用 `options`：
  - `style`
  - `skipConsistencyCheck`
  - `startedAt`
  - `runAttemptId`
  - `artifactContext`
  - `voiceProjectId`
  - `storeOptions`

## 关键输出

- 最终 `outputPath`
- `composeResult`
- `delivery-summary.md`
- `state.json`
- run 根目录：
  - `qa-overview.md`
  - `qa-overview.json`
  - `state.snapshot.json`
- 运行记录：
  - `run-jobs`
  - `AgentTaskRun`
  - agent manifests

## 缓存与续跑原则

`Director` 当前是“按 state 字段是否存在决定是否跳过”，不是按步骤号硬编码恢复。

例如：

- 有 `motionPlan` 就复用动态规划
- 有 `bridgeQaReport` 就复用整条 bridge 子链
- 有 `normalizedShots` 就不再重复跑对白标准化
- 有 `lipsyncResults` 就不再重复生成口型片段

这也是 `resume-from-step.js` 可以统一工作的基础。

## 交付阻断规则

当前会直接阻断交付的情况主要有：

- `TTS QA Agent` 返回 `block`
- `Lip-sync Agent` 返回 `block`
- `Video Composer` 返回 `blocked`
- 项目 / 剧本 / 分集不存在

不会阻断主链但会触发回退的情况主要有：

- `Shot QA Agent` 判定镜头 `fallback_to_image`
- `Bridge QA Agent` 判定 `fallback_to_direct_cut`
- `Bridge QA Agent` 判定 `fallback_to_transition_stub`
- `Fallback Video Adapter` 生成失败但静图回退仍可用
- `Seedance Video Agent` 生成失败但静图回退仍可用

## 关键落盘

- 兼容模式缓存：`temp/<jobId>/state.json`
- 运行记录：`temp/projects/.../run-jobs/`
- 审计运行包：`temp/projects/.../runs/<runId>/`
- 最终交付：`output/<project>/<episode>/final-video.mp4`
- 交付摘要：`output/<project>/<episode>/delivery-summary.md`

## 不负责的内容

- 不直接决定各 agent 的内部算法细节
- 不直接生成图像、视频、音频、口型
- 不做发布分发
- 不负责 UI 或多任务队列服务化调度

## 相关文档

- [Agent 总览](README.md)
- [Agent 输入输出关系图](agent-io-map.md)
- [断点续跑说明](../runtime/resume-from-step.md)
- [合成 Agent（Video Composer）](video-composer.md)
