/**
 * 日志工具
 * 支持级别过滤，带时间戳和颜色
 */

import 'dotenv/config';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '\x1b[36m',  // cyan
  info: '\x1b[32m',   // green
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
  reset: '\x1b[0m',
};

const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 1;

function log(level, prefix, ...args) {
  if (LEVELS[level] < currentLevel) return;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const color = COLORS[level];
  const tag = prefix ? `[${prefix}]` : '';
  console.log(`${color}${time} ${level.toUpperCase()} ${tag}${COLORS.reset}`, ...args);
}

export const logger = {
  debug: (prefix, ...args) => log('debug', prefix, ...args),
  info: (prefix, ...args) => log('info', prefix, ...args),
  warn: (prefix, ...args) => log('warn', prefix, ...args),
  error: (prefix, ...args) => log('error', prefix, ...args),

  // 进度条式状态输出
  step: (step, total, msg) => {
    const pct = Math.round((step / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    process.stdout.write(`\r\x1b[32m[${bar}] ${pct}% ${msg}\x1b[0m`);
    if (step === total) process.stdout.write('\n');
  },
};

export default logger;
