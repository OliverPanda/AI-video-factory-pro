/**
 * 文件读写工具
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const TEMP_DIR = process.env.TEMP_DIR || './temp';

function assertSafePathSegment(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[fileHelper] Invalid ${label}: expected a non-empty string`);
  }

  if (value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error(`[fileHelper] Unsafe ${label}: ${value}`);
  }

  return value;
}

// 确保目录存在
export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getJobDir(jobId, baseTempDir = TEMP_DIR) {
  return path.join(baseTempDir, jobId);
}

export function getProjectsRoot(baseTempDir = TEMP_DIR) {
  return path.join(baseTempDir, 'projects');
}

export function getProjectDir(projectId, baseTempDir = TEMP_DIR) {
  return path.join(getProjectsRoot(baseTempDir), projectId);
}

export function getScriptDir(projectId, scriptId, baseTempDir = TEMP_DIR) {
  return path.join(getProjectDir(projectId, baseTempDir), 'scripts', scriptId);
}

export function getEpisodeDir(projectId, scriptId, episodeId, baseTempDir = TEMP_DIR) {
  return path.join(getScriptDir(projectId, scriptId, baseTempDir), 'episodes', episodeId);
}

export function getProjectFilePath(projectId, baseTempDir = TEMP_DIR) {
  return path.join(getProjectDir(projectId, baseTempDir), 'project.json');
}

export function getScriptFilePath(projectId, scriptId, baseTempDir = TEMP_DIR) {
  return path.join(getScriptDir(projectId, scriptId, baseTempDir), 'script.json');
}

export function getEpisodeFilePath(projectId, scriptId, episodeId, baseTempDir = TEMP_DIR) {
  return path.join(getEpisodeDir(projectId, scriptId, episodeId, baseTempDir), 'episode.json');
}

// 初始化项目目录结构
export function initDirs(jobId) {
  const jobDir = getJobDir(jobId);
  const dirs = {
    root: jobDir,
    images: path.join(jobDir, 'images'),
    audio: path.join(jobDir, 'audio'),
    output: OUTPUT_DIR,
  };
  Object.values(dirs).forEach(ensureDir);
  return dirs;
}

export function getVoicePresetsDir(projectId, baseTempDir = TEMP_DIR) {
  return path.join(baseTempDir, 'projects', assertSafePathSegment(projectId, 'projectId'), 'voice-presets');
}

export function getVoiceCastFilePath(projectId, baseTempDir = TEMP_DIR) {
  return path.join(
    baseTempDir,
    'projects',
    assertSafePathSegment(projectId, 'projectId'),
    'voice-cast.json'
  );
}

export function getPronunciationLexiconFilePath(projectId, baseTempDir = TEMP_DIR) {
  return path.join(
    baseTempDir,
    'projects',
    assertSafePathSegment(projectId, 'projectId'),
    'pronunciation-lexicon.json'
  );
}

export function getVoicePresetFilePath(projectId, voicePresetId, baseTempDir = TEMP_DIR) {
  return path.join(
    getVoicePresetsDir(projectId, baseTempDir),
    `${assertSafePathSegment(voicePresetId, 'voicePresetId')}.json`
  );
}

export function getCharacterBiblesDir(projectId, baseTempDir = TEMP_DIR) {
  return path.join(
    baseTempDir,
    'projects',
    assertSafePathSegment(projectId, 'projectId'),
    'character-bibles'
  );
}

export function getCharacterBibleFilePath(projectId, characterBibleId, baseTempDir = TEMP_DIR) {
  return path.join(
    getCharacterBiblesDir(projectId, baseTempDir),
    `${assertSafePathSegment(characterBibleId, 'characterBibleId')}.json`
  );
}

// 读取文本文件
export function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

// 保存 JSON 数据
export function saveJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// 读取 JSON 数据
export function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.warn(`[fileHelper] 读取 JSON 失败（${filePath}），将忽略缓存：${err.message}`);
    return null;
  }
}

// 将 Buffer 保存为文件
export function saveBuffer(filePath, buffer) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
}

// 将图片 URL 转为 base64 data URI（用于视觉LLM）
export function imageToBase64(imagePath) {
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const mime = mimeMap[ext] || 'image/jpeg';
  const data = fs.readFileSync(imagePath).toString('base64');
  return `data:${mime};base64,${data}`;
}

// 生成唯一任务ID
export function generateJobId(scriptName) {
  const ts = Date.now();
  const base = path.basename(scriptName, path.extname(scriptName)).replace(/\s+/g, '_');
  return `${base}_${ts}`;
}

export default {
  ensureDir,
  getJobDir,
  getProjectsRoot,
  getProjectDir,
  getScriptDir,
  getEpisodeDir,
  getProjectFilePath,
  getScriptFilePath,
  getEpisodeFilePath,
  initDirs,
  getVoiceCastFilePath,
  getPronunciationLexiconFilePath,
  getVoicePresetsDir,
  getVoicePresetFilePath,
  getCharacterBiblesDir,
  getCharacterBibleFilePath,
  readTextFile,
  saveJSON,
  loadJSON,
  saveBuffer,
  imageToBase64,
  generateJobId,
};
