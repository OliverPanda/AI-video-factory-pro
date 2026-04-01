/**
 * 编剧Agent - 将剧本文本拆解为分集与分镜 JSON
 */

import fs from 'node:fs';
import path from 'node:path';
import { chatJSON as defaultChatJSON } from '../llm/client.js';
import {
  SCRIPT_DECOMPOSITION_SYSTEM,
  SCRIPT_DECOMPOSITION_USER,
  EPISODE_STORYBOARD_SYSTEM,
  EPISODE_STORYBOARD_USER,
} from '../llm/prompts/scriptAnalysis.js';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import logger from '../utils/logger.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function buildShotsTable(shots) {
  const lines = [
    '| Shot ID | Scene | Characters | Action | Dialogue | Duration |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const shot of shots) {
    lines.push(
      `| ${shot.id} | ${shot.scene || ''} | ${(shot.characters || []).join(', ')} | ${shot.action || ''} | ${shot.dialogue || ''} | ${shot.duration || 0} |`
    );
  }

  return `${lines.join('\n')}\n`;
}

function buildParserMetrics(result) {
  const shots = Array.isArray(result?.shots) ? result.shots : [];
  return {
    shot_count: shots.length,
    dialogue_shot_count: shots.filter((shot) => shot.dialogue).length,
    silent_shot_count: shots.filter((shot) => !shot.dialogue).length,
    character_count: Array.isArray(result?.characters) ? result.characters.length : 0,
    total_duration_sec: Number(result?.totalDuration) || shots.reduce((sum, shot) => sum + (shot.duration || 0), 0),
    avg_shot_duration_sec:
      shots.length > 0
        ? (shots.reduce((sum, shot) => sum + (shot.duration || 0), 0) / shots.length)
        : 0,
  };
}

function writeParserArtifacts(scriptText, result, artifactContext) {
  if (!artifactContext) {
    return;
  }

  writeTextFile(path.join(artifactContext.inputsDir, 'source-script.txt'), scriptText);
  saveJSON(path.join(artifactContext.inputsDir, 'parser-config.json'), {
    mode: 'legacy-flat-parse',
    decompositionPrompt: 'script_decomposition',
    storyboardPrompt: 'episode_storyboard',
  });
  saveJSON(path.join(artifactContext.outputsDir, 'shots.flat.json'), result.shots);
  writeTextFile(path.join(artifactContext.outputsDir, 'shots.table.md'), buildShotsTable(result.shots));
  saveJSON(path.join(artifactContext.outputsDir, 'characters.extracted.json'), result.characters);
  saveJSON(path.join(artifactContext.metricsDir, 'parser-metrics.json'), buildParserMetrics(result));
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    outputFiles: [
      'characters.extracted.json',
      'shots.flat.json',
      'shots.table.md',
      'parser-metrics.json',
    ],
    shotCount: result.shots.length,
    characterCount: result.characters.length,
  });
}

/**
 * 解析剧本为分集数据
 * @param {string} scriptText - 原始剧本文本
 * @param {{ chatJSON?: Function }} deps
 * @returns {Promise<{title, totalDuration, characters, episodes}>}
 */
export async function decomposeScriptToEpisodes(scriptText, deps = {}) {
  logger.info('ScriptParser', '开始拆解剧本分集...');

  const chatJSON = deps.chatJSON || defaultChatJSON;
  const messages = [
    { role: 'system', content: SCRIPT_DECOMPOSITION_SYSTEM },
    { role: 'user', content: SCRIPT_DECOMPOSITION_USER(scriptText) },
  ];

  const result = await chatJSON(messages, {
    temperature: 0.3,
    maxTokens: 8192,
  });

  const normalized = normalizeEpisodeData(result);
  logger.info('ScriptParser', `分集拆解完成：${normalized.episodes.length} 集`);
  return normalized;
}

export const parseScriptToEpisodes = decomposeScriptToEpisodes;

/**
 * 解析单集为分镜数据
 * @param {string|Object} episodeTextOrSummary - 分集摘要或分集对象
 * @param {{ chatJSON?: Function }} deps
 * @returns {Promise<{shots}>}
 */
export async function parseEpisodeToShots(episodeTextOrSummary, deps = {}) {
  if (episodeTextOrSummary?.shots && Array.isArray(episodeTextOrSummary.shots)) {
    return { shots: normalizeShots(episodeTextOrSummary.shots) };
  }

  const chatJSON = deps.chatJSON || defaultChatJSON;
  const episodeContent = formatEpisodeInput(episodeTextOrSummary);
  logger.info('ScriptParser', '开始拆解单集分镜...');

  const messages = [
    { role: 'system', content: EPISODE_STORYBOARD_SYSTEM },
    { role: 'user', content: EPISODE_STORYBOARD_USER(episodeContent) },
  ];

  const result = await chatJSON(messages, {
    temperature: 0.3,
    maxTokens: 8192,
  });

  validateStoryboardData(result);
  return {
    shots: normalizeShots(result.shots),
  };
}

/**
 * 兼容旧接口：返回扁平 shots
 * @param {string} scriptText - 原始剧本文本
 * @param {{ chatJSON?: Function }} deps
 * @returns {Promise<{title, totalDuration, characters, shots}>}
 */
export async function parseScript(scriptText, deps = {}) {
  logger.info('ScriptParser', '开始解析剧本...');

  const episodeData = await decomposeScriptToEpisodes(scriptText, deps);
  const shots = [];

  for (const episode of episodeData.episodes) {
    const shotResult = await parseEpisodeToShots(episode, deps);
    shots.push(...normalizeShots(shotResult.shots, shots.length, { renumber: true }));
  }

  const result = {
    title: episodeData.title,
    totalDuration: episodeData.totalDuration || shots.reduce((sum, shot) => sum + shot.duration, 0),
    characters: episodeData.characters,
    shots,
  };

  validateLegacyScriptData(result);
  writeParserArtifacts(scriptText, result, deps.artifactContext);
  logger.info('ScriptParser', `解析完成：${result.shots.length} 个分镜，共 ${result.characters.length} 个角色`);
  return result;
}

/**
 * 细化特定场景（多轮对话）
 * @param {Object} shot - 分镜对象
 * @param {string} direction - 细化方向（如："增加更多情感细节"）
 * @param {{ chatJSON?: Function }} deps
 */
export async function refineShot(shot, direction, deps = {}) {
  logger.debug('ScriptParser', `细化分镜 ${shot.id}：${direction}`);

  const chatJSON = deps.chatJSON || defaultChatJSON;
  const messages = [
    { role: 'system', content: EPISODE_STORYBOARD_SYSTEM },
    {
      role: 'user',
      content: `请细化以下分镜数据，${direction}：\n${JSON.stringify(shot, null, 2)}\n\n只返回修改后的单个分镜JSON对象。`,
    },
  ];

  return chatJSON(messages, { temperature: 0.5 });
}

function normalizeEpisodeData(data) {
  const characters = Array.isArray(data?.characters) ? data.characters : [];

  if (Array.isArray(data?.episodes)) {
    return {
      title: data?.title || '',
      totalDuration: Number(data?.totalDuration) || 0,
      characters,
      episodes: data.episodes.map((episode, index) => ({
        ...episode,
        episodeNo: Number(episode?.episodeNo) || index + 1,
        title: episode?.title || `第${index + 1}集`,
        summary: episode?.summary || '',
      })),
    };
  }

  if (Array.isArray(data?.shots)) {
    return {
      title: data?.title || '',
      totalDuration: Number(data?.totalDuration) || 0,
      characters,
      episodes: [
        {
          episodeNo: 1,
          title: '第1集',
          summary: '',
          shots: data.shots,
        },
      ],
    };
  }

  throw new Error('剧本解析结果缺少 episodes 数组');
}

function formatEpisodeInput(episodeTextOrSummary) {
  if (typeof episodeTextOrSummary === 'string') {
    return episodeTextOrSummary;
  }

  if (!episodeTextOrSummary || typeof episodeTextOrSummary !== 'object') {
    return '';
  }

  return JSON.stringify({
    episodeNo: episodeTextOrSummary.episodeNo,
    title: episodeTextOrSummary.title,
    summary: episodeTextOrSummary.summary,
  }, null, 2);
}

function validateLegacyScriptData(data) {
  if (!data.shots || !Array.isArray(data.shots)) {
    throw new Error('剧本解析结果缺少 shots 数组');
  }
  if (!data.characters || !Array.isArray(data.characters)) {
    throw new Error('剧本解析结果缺少 characters 数组');
  }

  data.shots = normalizeShots(data.shots);
}

function validateStoryboardData(data) {
  if (!data?.shots || !Array.isArray(data.shots)) {
    throw new Error('分镜解析结果缺少 shots 数组');
  }
}

function normalizeShots(shots, startIndex = 0, options = {}) {
  return shots.map((shot, i) => {
    const normalized = { ...shot };
    const hasGeneratedId = typeof normalized.id === 'string' && /^shot_\d+$/i.test(normalized.id);

    if ((options.renumber && (!normalized.id || hasGeneratedId)) || !normalized.id) {
      normalized.id = `shot_${String(startIndex + i + 1).padStart(3, '0')}`;
    }
    if (!normalized.duration) normalized.duration = 3;
    if (!normalized.characters) normalized.characters = [];
    if (!normalized.dialogue) normalized.dialogue = '';
    if (!normalized.speaker) normalized.speaker = '';

    normalized.characters = normalized.characters.map((character) =>
      typeof character === 'string' ? character : (character?.name || String(character))
    );

    return normalized;
  });
}
