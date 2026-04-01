# 编剧 Agent（Script Parser）

## 职责
- 将用户提供的剧本文本交给结构化分析的中文漫剧导演角色，生成全剧的分镜 JSON（包含剧名、总时长、角色池、镜头列表）。
- 保证返回的每一条分镜都同时具备视觉、人物、台词和情绪等信息，方便后续角色设定、视觉设计和合成 Agent 直接消费。
- 在解析后填补缺省字段（ID、时长、台词/说话者等）并做必要的归一化，防止子 Agent 因字段缺失抛出异常。

## 输入
- `scriptText`（string）：任意中文剧本文本（可包含场景、角色、台词、舞台指示等），由导演 Agent 传入。

## 输出
- 返回结构化 JSON，至少包含 `title`、`totalDuration`、`characters`、`shots` 四大块；
- `characters` 数组中的 items 形如 `{"name": "...", "gender": "male/female", "age": "..."}`；
- `shots` 数组里每条记录包含 `id`、`scene`、`characters`、`speaker`、`action`、`dialogue`、`emotion`、`camera_type`、`duration` 等字段，完全遵循 `SCRIPT_ANALYSIS_USER` 提供的模板。
- `shots` 中的 `id` 会自动补 `shot_001`—`shot_XXX`，缺省 `duration` 填 3 秒，`dialogue`/`speaker` 空字符串表示无台词或未指明说话者；
- `characters` 字段会归一为字符串数组（如果 LLM 返回了对象，会优先读取 `.name`，否则用 `String(c)`），避免后续处理拿到非文本值；
- 所有字段在 `validateScriptData` 里都会再次校验并修复，主流程只需关注结构化输出即可。

## 主流程/处理步骤
1. 组装消息：使用 `SCRIPT_ANALYSIS_SYSTEM`（“专业中文漫剧导演” + 结构化输出要求）和 `SCRIPT_ANALYSIS_USER(scriptText)`，强调必须返回 JSON。
2. 调用 `chatJSON(messages, {temperature: 0.3, maxTokens: 8192})` 执行低温生成，`chatJSON` 本身会确保合法 JSON 并将结果解析成对象。
3. 通过 `validateScriptData`：
   - 确保 `shots` 与 `characters` 是数组，缺失则抛错给上层；
   - 遍历 `shots`，依次补全 `id`（`shot_001`、`shot_002`）、默认 `duration=3`、`characters` 空数组、`dialogue`/`speaker` 空字符串；
   - 把 `shot.characters` 里可能的对象转换为字符串（先读 `.name`，再 `String(c)`）；
4. 返回可直接交给角色设定、视觉设计、图像生成等后续 Agent 继续处理的结构化数据。
5. 如需多轮精细化某条镜头，调用 `refineShot(shot, direction)`：同样的 system prompt + 额外用户指令，要求只返回修改后的单个分镜 JSON。

## 依赖关系
- `chatJSON`（来自 `src/llm/client.js`）负责与模型交互并且在无法解析时抛错或重试；
- `SCRIPT_ANALYSIS_SYSTEM` 与 `SCRIPT_ANALYSIS_USER`（`src/llm/prompts/scriptAnalysis.js`）定义了输出模板和要求（结构化 JSON、镜头/台词/镜头类型等）；
- `validateScriptData`（`src/agents/scriptParser.js` 内部）负责默认值补齐与字段归一，保证下游只处理标准结构；
- `refineShot` 利用同一套 prompt 继续细化单条镜头，配合导演 Agent 的多轮反馈使用；
- `logger` 仅用于记录解析/细化流程，便于排查模型耗时与异常数据。

## 常见问题
- **LLM 返回非法 JSON**：`chatJSON` 会抛出解析异常，导演 Agent 应该重试或拆分剧本，确保输入不包含影响 JSON 的未闭合符号；
- **缺少 `shots`/`characters`**：此类问题直接抛错“缺少 shots 数组/characters 数组”，说明 prompt 需要加强，引导 LLM 提供完整结构；
- **镜头字段不全**：`validateScriptData` 会补充 `id`（`shot_001`）、`duration=3`、`dialogue`/`speaker` 空串，因此上游可以直接读取这些字段而不用再判空；
- **角色数组出现对象**：归一化逻辑会提取 `.name` 或 `String(c)`，严格保证 `shot.characters` 是字符串列表；
- **输出过长被截断**：`maxTokens=8192` 是 safeguard，但仍可能有剧本太长的情况，建议导演 Agent 分段调用 `parseScript`。

## 不负责的内容
- 不负责对剧本文本的剧情改写、逻辑校验、翻译或语言风格变更，严格只把现有文本翻译为结构化数据；
- 不负责生成视觉 Prompt、配音脚本、节奏控制、镜头运动参数等视觉/音频层面的内容；
- 不处理非中文漫剧的专属指令，当前 prompt 预设中文漫剧导演身份。

## 来源文件
- `src/agents/scriptParser.js`
- `src/llm/prompts/scriptAnalysis.js`

## 相关 skill
- `parseScript`：主入口，调用 `chatJSON` + prompt 输出结构化分镜，返回结果前顺便调用 `validateScriptData` 补齐缺省值。
- `refineShot`：在导演 Agent 给出方向时，用同一套 system prompt + 更高温度补充细节，并仅返回一条分镜；
- `SCRIPT_ANALYSIS_SYSTEM` / `SCRIPT_ANALYSIS_USER`：prompt skill，限定 `title`/`totalDuration`/`characters`/`shots` 等字段，配合低温生成控制结构化输出；`validateScriptData` 则扮演 field-normalization skill。
