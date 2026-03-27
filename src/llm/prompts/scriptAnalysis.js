/**
 * 剧本分析 Prompt 模板
 */

export const SCRIPT_ANALYSIS_SYSTEM = `你是一位专业的中文漫剧导演和编剧，擅长将剧本拆解为详细的分镜脚本。
你的任务是将用户提供的剧本文本，解析为结构化的JSON分镜列表。

输出要求：
- 严格返回合法的JSON格式
- 每个分镜包含完整的视觉和音频信息
- 中文台词保留原文，情感描述要精准
- 镜头类型使用专业术语：特写、近景、中景、全景、远景
- duration 单位为秒，根据台词长度和场景复杂度估算`;

export const SCRIPT_ANALYSIS_USER = (scriptText) => `
请将以下剧本解析为分镜JSON数据：

<剧本>
${scriptText}
</剧本>

请输出如下格式的JSON：
{
  "title": "剧名",
  "totalDuration": 总时长秒数,
  "characters": [
    {"name": "角色名", "gender": "male/female", "age": "年龄描述如：20多岁"}
  ],
  "shots": [
    {
      "id": "shot_001",
      "scene": "场景描述（地点+时间）",
      "characters": ["出现的角色名"],
      "speaker": "说台词的角色名（无台词则为空字符串）",
      "action": "人物动作和场景动态描述",
      "dialogue": "台词（无台词则为空字符串）",
      "emotion": "情绪氛围描述",
      "camera_type": "镜头类型",
      "duration": 时长秒数
    }
  ]
}`;

export const SCRIPT_REFINE_USER = (shots, feedback) => `
以下是已解析的分镜数据，请根据反馈进行修正：

<分镜数据>
${JSON.stringify(shots, null, 2)}
</分镜数据>

<修正要求>
${feedback}
</修正要求>

请输出修正后的完整JSON。`;
