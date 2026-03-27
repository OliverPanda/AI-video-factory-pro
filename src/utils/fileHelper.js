/**
 * 文件读写工具
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const TEMP_DIR = process.env.TEMP_DIR || './temp';

// 确保目录存在
export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// 初始化项目目录结构
export function initDirs(jobId) {
  const jobDir = path.join(TEMP_DIR, jobId);
  const dirs = {
    root: jobDir,
    images: path.join(jobDir, 'images'),
    audio: path.join(jobDir, 'audio'),
    output: OUTPUT_DIR,
  };
  Object.values(dirs).forEach(ensureDir);
  return dirs;
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

export default { ensureDir, initDirs, readTextFile, saveJSON, loadJSON, saveBuffer, imageToBase64, generateJobId };
