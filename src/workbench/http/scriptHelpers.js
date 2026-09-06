import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Script Professionalization Cache ───────────────────

const scriptProfessionalizeCache = new Map();

// ── Script Professionalization Helpers ─────────────────

export function loadScriptProfessionalizerSkill(workspaceRoot) {
  const skillPath = path.join(workspaceRoot, 'skills', 'project', 'script-professionalizer', 'SKILL.md');
  try {
    return fs.readFileSync(skillPath, 'utf8');
  } catch {
    return [
      '# Script Professionalizer',
      'Convert rough story text into professional-script format for an AI drama pipeline.',
      'Output only Chinese script text split by 【画面N】.',
    ].join('\n');
  }
}

export function buildScriptProfessionalizerSystemPrompt(workspaceRoot) {
  const skill = loadScriptProfessionalizerSkill(workspaceRoot);
  const outputContract = skill.match(/## Output Contract[\s\S]*?(?=\n## |\n# |$)/)?.[0] || '';
  const rewriteRules = skill.match(/## Rewrite Rules[\s\S]*?(?=\n## |\n# |$)/)?.[0] || '';
  return [
    '# 剧本专业化改造',
    outputContract,
    rewriteRules,
    '只返回可被 professional-script 解析器识别的中文剧本文本。',
    '禁止解释、评分、表格、代码块、自检清单或任何前后缀。',
  ].filter(Boolean).join('\n\n');
}

export function stripMarkdownCodeFence(text) {
  return String(text || '')
    .replace(/^```(?:markdown|md|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function normalizeProfessionalScriptText(content, options = {}) {
  let text = String(content || '').trim();
  if (!text) return '';

  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\s*画面\s*(\d+)[：:.\s、-]*/gm, '【画面$1】\n')
    .replace(/^\s*镜头\s*(\d+)[：:.\s、-]*/gm, '【画面$1】\n')
    .replace(/【\s*画面\s*(\d+)\s*】/g, '【画面$1】')
    .replace(/[ \t]+$/gm, '');

  if (!/【画面\s*\d+】/.test(text)) {
    return '';
  }

  if (!/^第\s*\d+\s*集/m.test(text)) {
    const safeTitle = String(options.title || '优化剧本').trim().replace(/[《》]/g, '') || '优化剧本';
    text = `第1集《${safeTitle}》\n${text}`;
  }

  let shotIndex = 0;
  text = text.replace(/【画面\s*\d+】/g, () => `【画面${++shotIndex}】`);
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function canFastNormalizeProfessionalScript(content, options = {}) {
  const normalized = normalizeProfessionalScriptText(content, options);
  if (!normalized) return null;

  const blocks = normalized
    .split(/(?=【画面\d+】)/)
    .map((block) => block.trim())
    .filter((block) => /^【画面\d+】/.test(block));

  if (blocks.length === 0) return null;
  const requiredFields = ['场景', '人物', '动作', '对白', '时长'];
  const validBlocks = blocks.filter((block) => requiredFields.every((field) => new RegExp(`${field}\s*[：:]`).test(block)));
  if (validBlocks.length !== blocks.length) return null;

  return normalized;
}

export function buildScriptProfessionalizeConfig() {
  const provider = String(process.env.SCRIPT_PROFESSIONALIZER_PROVIDER || process.env.LLM_PROVIDER || 'qwen').trim();
  const model = String(process.env.SCRIPT_PROFESSIONALIZER_MODEL || process.env.LLM_MODEL || '').trim();
  const maxTokens = Number.parseInt(process.env.SCRIPT_PROFESSIONALIZER_MAX_TOKENS || '3000', 10);

  return {
    provider: provider || 'qwen',
    model: model || undefined,
    maxTokens: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : 3000,
  };
}

export function buildScriptProfessionalizeCacheKey({ title, content, config }) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      title: String(title || '').trim(),
      content: String(content || '').trim(),
      provider: config.provider,
      model: config.model || '',
      maxTokens: config.maxTokens,
      skillVersion: 'script-professionalizer:v1',
    }))
    .digest('hex');
}

export function readScriptProfessionalizeCache(cacheKey) {
  const cached = scriptProfessionalizeCache.get(cacheKey);
  if (!cached) return null;
  return {
    ...cached,
    cached: true,
  };
}

export function writeScriptProfessionalizeCache(cacheKey, result) {
  if (scriptProfessionalizeCache.size > 100) {
    const firstKey = scriptProfessionalizeCache.keys().next().value;
    if (firstKey) scriptProfessionalizeCache.delete(firstKey);
  }
  scriptProfessionalizeCache.set(cacheKey, {
    ...result,
    cached: false,
  });
}

export async function professionalizeScriptContent({ title, content, workspaceRoot, chatText }) {
  const cleanContent = String(content || '').trim();
  if (!cleanContent) {
    throw new Error('剧本内容不能为空');
  }
  if (cleanContent.length > 30000) {
    throw new Error('剧本内容过长，请先拆分后再优化');
  }

  const fastNormalized = canFastNormalizeProfessionalScript(cleanContent, { title });
  if (fastNormalized) {
    return {
      content: fastNormalized,
      source: 'local-normalize',
      cached: false,
    };
  }

  const config = buildScriptProfessionalizeConfig();
  const cacheKey = buildScriptProfessionalizeCacheKey({ title, content: cleanContent, config });
  const cached = readScriptProfessionalizeCache(cacheKey);
  if (cached) {
    return cached;
  }

  const systemPrompt = buildScriptProfessionalizerSystemPrompt(workspaceRoot);
  const messages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: `请把下面的草稿改造成 AI 漫剧系统可直接运行的 professional-script。

硬性格式：
1. 每个镜头必须以【画面1】、【画面2】递增开头。
2. 每个画面必须包含：场景、人物、动作、对白、时长。
3. 动作必须画面化，避免“痛苦、紧张、关系冷淡”这类抽象词单独出现。
4. 对白要符合人物身份，并推动关系或情节。
5. 时长使用“X秒”，单镜头建议 4-10 秒。
6. 只返回改造后的剧本文本。

标题：${String(title || '未命名剧本').trim()}

原始内容：
${cleanContent}`,
    },
  ];

  const chatResult = await chatText(messages, {
    provider: config.provider,
    model: config.model,
    temperature: 0.25,
    maxTokens: config.maxTokens,
  });
  const optimized = stripMarkdownCodeFence(
    typeof chatResult === 'string'
      ? chatResult
      : chatResult?.text || chatResult?.content || ''
  );

  if (!/【画面\s*1】/.test(optimized)) {
    throw new Error('优化结果不是专业剧本格式，请调整原文后重试');
  }

  const result = {
    content: normalizeProfessionalScriptText(optimized, { title }) || optimized,
    source: 'llm',
    cached: false,
  };
  writeScriptProfessionalizeCache(cacheKey, result);
  return result;
}
